/**
 * Doomlings — base game card effects.
 *
 * One entry per card, keyed by lowercased name. A handler may define:
 *
 *   canPlay(g, player, card) -> bool      Requirement gate, checked before play
 *   *cost(ctx)               -> bool      Price paid before the card lands
 *   *onPlay(ctx)                          Action / Gene Pool, on entering play
 *   *score(ctx)              -> number    Drop of Life bonus for the owner
 *   *scoreOthers(ctx)        -> {id:n}    Bonus/penalty applied to other players
 *   *onTurnStart(ctx)                     Persistent, at the owner's turn start
 *   *onTraitDiscarded(ctx,c)              Persistent, when a trait leaves the pile
 *   reactive: true                        Play When — needs an interrupt window
 *   manual: "reason"                      Needs a human ruling; UI must prompt
 *
 * Cards with no entry are Effectless and do nothing, which is correct.
 */

/* ================================================================== *
 * Counting helpers
 * ================================================================== */

const pileColourCount = (p, colour) =>
  p.traitPile.filter((c) => hasColour(c, colour)).length;

const handColourCount = (p, colour) =>
  p.hand.filter((c) => hasColour(c, colour)).length;

/** Colour tallies for a trait pile, multi-colour cards counting under each. */
function colourTally(p) {
  const t = {};
  for (const colour of COLOURS) t[colour] = pileColourCount(p, colour);
  return t;
}

const presentColours = (p) =>
  COLOURS.filter((c) => pileColourCount(p, c) > 0);

/* ================================================================== *
 * Factories for the repetitive Drop of Life patterns
 * ================================================================== */

/** "+N for each <colour> trait in your trait pile. (Including this.)" */
const perColour = (colour, per = 1) => ({
  *score(ctx) { return per * pileColourCount(ctx.me, colour); },
});

/** "+N for every N <colour> traits in your trait pile." */
const perGroup = (colour, size, award) => ({
  *score(ctx) { return Math.floor(pileColourCount(ctx.me, colour) / size) * award; },
});

/** Simple "+N Gene Pool" / "-N Gene Pool" cards. */
const genePool = (delta) => ({
  gpDelta: delta,
  *onPlay(ctx) {
    const ok = adjustGenePool(ctx.g, ctx.me, delta);
    ctx.say(ok
      ? `${ctx.me.name} gene pool ${delta > 0 ? "+" : ""}${delta} → ${ctx.me.genePool}.`
      : `${ctx.card.name}: gene pool already at its limit, change ignored.`);
  },
});

/** Cards whose only job is to count copies of themselves by name prefix. */
const countByPrefix = (prefix, scope) => ({
  *score(ctx) {
    const piles = scope === "all" ? ctx.g.players : [ctx.me];
    return piles.reduce(
      (n, p) => n + p.traitPile.filter((c) => norm(c.name).startsWith(prefix)).length, 0);
  },
});

/* ================================================================== *
 * Shared interaction helpers
 * ================================================================== */

/**
 * Ask for one trait out of a set of candidate {player, card} pairs.
 *
 * With `removal: true` the card is about to leave its pile, so dominants are
 * still LISTED — players need to see what an opponent holds — but shown
 * disabled with the reason. Hiding them would misrepresent the board.
 */
function* pickTrait(ctx, candidates, prompt, optional = false, removal = true, playerId = ctx.me.id) {
  if (!candidates.length) return null;

  const options = candidates.map(({ player, card }) => {
    const locked = removal && isLocked(player, card);
    return {
      playerId: player.id, uid: card.uid, name: card.name,
      colour: coloursOf(card).join("/"), value: faceValue(card),
      disabled: locked || undefined,
      reason: locked ? lockReason(player, card) : undefined,
    };
  });

  // Nothing legally selectable — don't open a dead prompt.
  if (!options.some((o) => !o.disabled)) return null;

  const choice = yield ctx.ask.trait({ playerId, prompt, optional, options });
  if (!choice) return null;
  const hit = candidates.find((c) => c.card.uid === choice.uid);
  if (!hit) return null;
  if (removal && isLocked(hit.player, hit.card)) return null;   // defensive
  return hit;
}

const opponentTraits = (ctx, filter = () => true) =>
  ctx.opponents().flatMap((p) =>
    p.traitPile.filter(filter).map((card) => ({ player: p, card })));

const myTraits = (ctx, filter = () => true) =>
  ctx.me.traitPile.filter(filter).map((card) => ({ player: ctx.me, card }));

/** "Steal 1 trait from an opponent's trait pile." */
function* stealTrait(ctx, filter, prompt) {
  const cands = opponentTraits(ctx, filter);
  const hit = yield* pickTrait(ctx, cands, prompt);
  if (!hit) return null;
  moveTrait(ctx.g, hit.player, ctx.me, hit.card.uid, EFFECTS);
  ctx.say(`${ctx.me.name} stole ${hit.card.name} from ${hit.player.name}.`);
  return hit.card;
}

/** Discard N cards chosen from a player's own hand. */
function* discardFromOwnHand(ctx, player, count, { optional = false, max = null } = {}) {
  if (!player.hand.length) return [];
  const picked = yield ctx.ask.cards({
    prompt: optional
      ? `Discard up to ${max ?? count} card(s)`
      : `Discard ${count} card(s)`,
    playerId: player.id,
    from: "hand",
    count: optional ? 0 : Math.min(count, player.hand.length),
    max: max ?? count,
    optional,
    options: player.hand.map((c) => ({ uid: c.uid, name: c.name })),
  });
  const uids = (picked || []).map((x) => (typeof x === "string" ? x : x.uid));
  const out = [];
  for (const uid of uids) {
    const c = discardFromHand(ctx.g, player, uid);
    if (c) out.push(c);
  }
  return out;
}

/** Lonely Age: "Cannot play more than 1 trait on your turn." True when this
 *  player is on their own turn under it, so a "you may play it now" is off. */
function lonelyBlocks(g, player) {
  return Boolean(activeRestrict(topAge(g)).maxPlays) && g.phase === "turn" && seatOf(g) === player;
}

/** "You may play 1 of them now" over a specific set of just-drawn cards. */
function* mayPlayOneOf(ctx, cards, { filter = () => true, label = "Play one now?" } = {}) {
  if (lonelyBlocks(ctx.g, ctx.me)) {
    ctx.say(`Lonely Age: ${ctx.me.name} can't play another trait this turn.`);
    return null;
  }
  const eligible = cards.filter((c) => ctx.me.hand.some((h) => h.uid === c.uid) && filter(c));
  if (!eligible.length) return null;
  const choice = yield ctx.ask.cards({
    prompt: label,
    playerId: ctx.me.id,
    from: "hand",
    count: 0, max: 1, optional: true,
    options: eligible.map((c) => ({ uid: c.uid, name: c.name })),
  });
  const uid = (choice || []).map((x) => (typeof x === "string" ? x : x.uid))[0];
  if (!uid) return null;
  return yield* ctx.playNow(uid);
}

/* ================================================================== *
 * THE REGISTRY
 * ================================================================== */
const EFFECTS = {

  /* ---------------- Gene Pool ---------------- */
  "dreamer": genePool(+1),
  "fecundity": genePool(+1),
  "just": genePool(+1),
  "mitochondrion": genePool(+1),
  "saliva": genePool(+1),
  "teeth": genePool(+1),
  "warm blood": genePool(+2),
  "brute strength": genePool(-1),

  // "Choose a color. All players pass all cards of that color from their hand
  //  to the player on their left."
  "super spreader": {
    *onPlay(ctx) {
      const colour = yield ctx.ask.colour({ prompt: "Choose a colour to pass left" });
      if (!colour) return;
      const g = ctx.g;
      const moving = g.players.map((p) => {
        const keep = [], go = [];
        for (const c of p.hand) (hasColour(c, colour) ? go : keep).push(c);
        p.hand = keep;
        return go;
      });
      // "the player on their left" — next seat in play order.
      for (let i = 0; i < g.players.length; i++) {
        const left = g.players[(i + 1) % g.players.length];
        left.hand.push(...moving[i]);
      }
      ctx.say(`Super Spreader: all ${colour} cards passed left.`);
    },
  },

  /* ---------------- Actions: pure draw ---------------- */
  "introspective": { *onPlay(ctx) { ctx.draw(3); ctx.say("Introspective: drew 3."); } },
  "iridescent scales": { *onPlay(ctx) { ctx.draw(4); ctx.say("Iridescent Scales: drew 4."); } },

  "cold blood": {
    *onPlay(ctx) {
      const drawn = ctx.draw(3);
      yield* mayPlayOneOf(ctx, drawn, { label: "Cold Blood — play one of the drawn cards?" });
    },
  },

  "photosynthesis": {
    *onPlay(ctx) {
      const drawn = ctx.draw(3);
      yield* mayPlayOneOf(ctx, drawn, {
        filter: (c) => hasColour(c, "Green"),
        label: "Photosynthesis — play a drawn green trait?",
      });
    },
  },

  /* ---------------- Actions: discard ---------------- */
  "hot temper": {
    *onPlay(ctx) { yield* discardFromOwnHand(ctx, ctx.me, 2); },
  },
  "sweat": {
    *onPlay(ctx) { yield* discardFromOwnHand(ctx, ctx.me, 1); },
  },
  "wilted": {
    *onPlay(ctx) {
      yield* discardFromOwnHand(ctx, ctx.me, 0, { optional: true, max: 3 });
    },
  },

  // "Opponents discard 2 cards from their hand at random."
  "bad": {
    *onPlay(ctx) {
      for (const opp of ctx.opponents()) {
        const gone = yield* blindPick(ctx.g, ctx.me, opp, 2,
          `Bad — pick 2 of ${opp.name}'s cards to discard`);
        for (const c of gone) discardFromHand(ctx.g, opp, c.uid);
        if (gone.length) ctx.say(`Bad: ${opp.name} discarded ${gone.map((c) => c.name).join(" and ")}.`);
      }
    },
  },

  // "Choose a color. All players discard all cards of that color from their
  //  hand. (Including you!)"
  "persuasive": {
    *onPlay(ctx) {
      const colour = yield ctx.ask.colour({ prompt: "Choose a colour — everyone discards it" });
      if (!colour) return;
      for (const p of ctx.g.players) {
        for (const c of p.hand.slice()) {
          if (hasColour(c, colour)) discardFromHand(ctx.g, p, c.uid);
        }
      }
      ctx.say(`Persuasive: all ${colour} cards discarded from hands.`);
    },
  },

  // "All opponents discard 1 red trait from their trait pile."
  "irritable": {
    *onPlay(ctx) {
      for (const opp of ctx.opponents()) {
        const reds = opp.traitPile.filter((c) => hasColour(c, "Red"));
        if (!reds.length) continue;
        const hit = yield* pickTrait(
          ctx, reds.map((card) => ({ player: opp, card })),
          `${opp.name}: discard a red trait`);
        if (hit) yield* ctx.discardTrait(opp, hit.card.uid);
      }
    },
  },

  /* ---------------- Actions: steal ---------------- */
  "selfish": {
    *onPlay(ctx) {
      yield* stealTrait(ctx, (c) => hasColour(c, "Red"), "Steal a red trait");
    },
  },
  "tiny little melons": {
    *onPlay(ctx) {
      yield* stealTrait(ctx, (c) => hasColour(c, "Green"), "Steal a green trait");
    },
  },
  "directly register": {
    *onPlay(ctx) {
      yield* stealTrait(ctx, (c) => faceValue(c) === 1, "Steal a face value 1 trait");
    },
  },

  // "Steal 1 trait from an opponent's trait pile. Play its action (a)."
  "vampirism": {
    *onPlay(ctx) {
      const card = yield* stealTrait(ctx, () => true, "Vampirism — steal a trait");
      if (!card) return;
      const h = EFFECTS[norm(card.name)];
      if (h && h.onPlay && isAction(card)) {
        yield* replayGuarded(ctx.g, h.onPlay({ ...ctx, card }));
      }
    },
  },

  // "Steal 2 random cards from an opponent's hand. You may play 1 of them now."
  "nosy": {
    *onPlay(ctx) {
      const withCards = ctx.opponents().filter((p) => p.hand.length);
      if (!withCards.length) return;
      const pick = yield ctx.ask.player({
        prompt: "Nosy — steal from which opponent?",
        options: withCards.map((p) => ({ id: p.id, name: p.name, handSize: p.hand.length })),
      });
      const opp = withCards.find((p) => p.id === (pick && pick.id)) || withCards[0];
      const taken = yield* blindPick(ctx.g, ctx.me, opp, 2,
        `Nosy — pick 2 of ${opp.name}'s cards to steal`);
      for (const c of taken) {
        const i = opp.hand.findIndex((x) => x.uid === c.uid);
        if (i >= 0) ctx.me.hand.push(opp.hand.splice(i, 1)[0]);
      }
      ctx.say(`${ctx.me.name} stole ${taken.length} card(s) from ${opp.name}.`);
      yield* mayPlayOneOf(ctx, taken, { label: "Nosy — play a stolen card?" });
    },
  },

  // "Opponents reveal 1 card in their hand to all players. Steal 1. You may
  //  play it now."
  "clever": {
    *onPlay(ctx) {
      const revealed = [];
      // Each opponent chooses which card they reveal.
      for (const opp of ctx.opponents()) {
        if (!opp.hand.length) continue;
        const pick = yield ctx.ask.cards({
          playerId: opp.id,
          prompt: `Clever — ${ctx.me.name} is looking. Reveal 1 card from your hand to everyone`,
          from: "hand", count: 1, max: 1,
          options: opp.hand.map((c) => ({ uid: c.uid, name: c.name })),
        });
        const uid = (pick || []).map((x) => (typeof x === "string" ? x : x.uid))[0];
        const c = opp.hand.find((x) => x.uid === uid) || opp.hand[0];
        revealed.push({ player: opp, card: c });
      }
      if (!revealed.length) return;
      const choice = yield ctx.ask.trait({
        playerId: ctx.me.id,
        prompt: "Clever — steal one revealed card",
        options: revealed.map(({ player, card }) => ({
          playerId: player.id, uid: card.uid, name: card.name,
        })),
      });
      const hit = revealed.find((r) => r.card.uid === (choice && choice.uid)) || revealed[0];
      const i = hit.player.hand.findIndex((x) => x.uid === hit.card.uid);
      if (i < 0) return;
      ctx.me.hand.push(hit.player.hand.splice(i, 1)[0]);
      ctx.say(`${ctx.me.name} took ${hit.card.name} from ${hit.player.name}.`);
      yield* mayPlayOneOf(ctx, [hit.card], { label: "Clever — play it now?" });
    },
  },

  /* ---------------- Actions: give away ---------------- */
  "doting": {
    *onPlay(ctx) {
      if (!ctx.me.hand.length) return;
      const target = yield ctx.ask.player({
        prompt: "Doting — give a card to which opponent?",
        options: ctx.opponents().map((p) => ({ id: p.id, name: p.name })),
      });
      const opp = ctx.opponents().find((p) => p.id === (target && target.id)) || ctx.opponents()[0];
      const chosen = yield ctx.ask.cards({
        prompt: `Give a card to ${opp.name}`,
        playerId: ctx.me.id, from: "hand", count: 1,
        options: ctx.me.hand.map((c) => ({ uid: c.uid, name: c.name })),
      });
      const uid = (chosen || []).map((x) => (typeof x === "string" ? x : x.uid))[0];
      const i = ctx.me.hand.findIndex((c) => c.uid === uid);
      if (i >= 0) opp.hand.push(ctx.me.hand.splice(i, 1)[0]);
    },
  },

  "scutes": {
    *onPlay(ctx) {
      const mine = myTraits(ctx, (c) => c.uid !== ctx.card.uid);
      if (!mine.length) return;
      const target = yield ctx.ask.player({
        prompt: "Scutes — give a trait to which opponent?",
        options: ctx.opponents().map((p) => ({ id: p.id, name: p.name })),
      });
      const opp = ctx.opponents().find((p) => p.id === (target && target.id)) || ctx.opponents()[0];
      const hit = yield* pickTrait(ctx, mine, `Give a trait to ${opp.name}`);
      if (hit) moveTrait(ctx.g, ctx.me, opp, hit.card.uid, EFFECTS);
    },
  },

  "flight": {
    *onPlay(ctx) {
      const target = yield ctx.ask.player({
        prompt: "Flight — swap hands with whom?",
        options: ctx.opponents().map((p) => ({ id: p.id, name: p.name, handSize: p.hand.length })),
      });
      const opp = ctx.opponents().find((p) => p.id === (target && target.id)) || ctx.opponents()[0];
      [ctx.me.hand, opp.hand] = [opp.hand, ctx.me.hand];
      ctx.say(`${ctx.me.name} swapped hands with ${opp.name}.`);
    },
  },

  /* ---------------- Actions: swap traits ---------------- */
  // "Swap Poisonous with a trait from an opponent's trait pile."
  "poisonous": {
    *onPlay(ctx) {
      const cands = opponentTraits(ctx);
      const hit = yield* pickTrait(ctx, cands, "Swap Poisonous with which trait?");
      if (!hit) return;
      moveTrait(ctx.g, hit.player, ctx.me, hit.card.uid, EFFECTS);
      moveTrait(ctx.g, ctx.me, hit.player, ctx.card.uid, EFFECTS);
      ctx.say(`Poisonous swapped into ${hit.player.name}'s pile for ${hit.card.name}.`);
    },
  },

  "telekinetic": {
    *onPlay(ctx) { yield* swapDifferentOrSame(ctx, "different"); },
  },
  "tentacles": {
    *onPlay(ctx) { yield* swapDifferentOrSame(ctx, "same"); },
  },

  // "Return an opponent's trait to their hand. Then play 1 more trait."
  "costly signaling": {
    *onPlay(ctx) {
      const hit = yield* pickTrait(ctx, opponentTraits(ctx), "Return which trait to its owner's hand?");
      if (hit) {
        returnTraitToHand(ctx.g, hit.player, hit.card.uid, EFFECTS);
        ctx.say(`${hit.card.name} returned to ${hit.player.name}'s hand.`);
      }
      ctx.grantPlay(1);
    },
  },

  "pappus": {
    *onPlay(ctx) {
      const hit = yield* pickTrait(ctx, opponentTraits(ctx),
        "Pappus — return a trait to its owner's hand?", true);
      if (hit) {
        returnTraitToHand(ctx.g, hit.player, hit.card.uid, EFFECTS);
        ctx.say(`${hit.card.name} returned to ${hit.player.name}'s hand.`);
      }
    },
  },

  /* ---------------- Actions: extra plays ---------------- */
  "propagation": { *onPlay(ctx) { if (ctx.grantPlay(1)) ctx.say("Propagation: play 1 more."); } },

  "the third eye": {
    *onPlay(ctx) {
      const next = ctx.g.ageDeck[0];
      if (next) {
        yield ctx.ask.confirm({
          prompt: `The Third Eye — the next age is ${next.name}.`,
          peek: { name: next.name, effect: next.effect },
          acknowledge: true,
        });
      }
      ctx.grantPlay(1);
    },
  },

  // "Play 1 more trait. Then move Venomous to an opponent's trait pile."
  // The move waits until that next trait has been played (see afterPlay in
  // core.js). If the extra play can't happen (Lonely Age) or goes unused,
  // Venomous stays where it is.
  "venomous": {
    *onPlay(ctx) {
      if (!ctx.grantPlay(1)) return;
      ctx.g.venomous = { playerId: ctx.me.id, uid: ctx.card.uid };
      ctx.say("Venomous: play 1 more trait, then Venomous moves to an opponent.");
    },
  },

  // "Play 1 more trait. Then discard 1 trait from your trait pile."
  "voracious": {
    *onPlay(ctx) {
      ctx.grantPlay(1);
      const mine = myTraits(ctx);
      const hit = yield* pickTrait(ctx, mine, "Voracious — discard one of your traits");
      if (hit) yield* ctx.discardTrait(ctx.me, hit.card.uid);
    },
  },

  /* ---------------- Actions: replay other actions ---------------- */
  // "Play an action (a) from your trait pile."
  "painted shell": {
    *onPlay(ctx) {
      yield* replayAction(ctx, myTraits(ctx, isAction),
        "Painted Shell: you have no other action traits in your pile to replay.");
    },
  },
  // "Play an action (a) from an opponent's trait pile."
  "inventive": {
    *onPlay(ctx) {
      yield* replayAction(ctx, opponentTraits(ctx, isAction),
        "Inventive: no opponent has an action trait in their pile.");
    },
  },

  // "Play 1 card from the discard pile. Play its action (a)."
  "selective memory": {
    *onPlay(ctx) { yield* playFromDiscard(ctx, { ignoreAction: false, topOnly: false }); },
  },
  // "Play the top card of the discard pile. Play its action (a)."
  "trunk": {
    *onPlay(ctx) { yield* playFromDiscard(ctx, { ignoreAction: false, topOnly: true }); },
  },
  // "Play 1 card from the discard pile. Ignore its action (a). When you play
  //  another green trait from your hand, you may return this to your hand."
  "self-replicating": {
    *onPlay(ctx) { yield* playFromDiscard(ctx, { ignoreAction: true, topOnly: false }); },

    // "When you play another green trait from your hand, you may return this
    //  to your hand." Watches from the trait pile rather than the hand, so it
    //  is a pile reaction, not an interrupt.
    *onTraitPlayed(ctx, ev) {
      if (!ev.actor || ev.actor.id !== ctx.me.id) return;
      if (!ev.card || ev.card.uid === ctx.card.uid) return;
      if (!hasColour(ev.card, "Green")) return;
      if (!ctx.me.traitPile.some((c) => c.uid === ctx.card.uid)) return;
      const yes = yield ctx.ask.confirm({
        playerId: ctx.me.id,
        prompt: "Self-Replicating — return it to your hand?",
      });
      if (!yes) return;
      const i = ctx.me.traitPile.findIndex((c) => c.uid === ctx.card.uid);
      if (i < 0) return;
      ctx.me.hand.push(ctx.me.traitPile.splice(i, 1)[0]);
      ctx.say(`${ctx.me.name} returned Self-Replicating to hand.`);
    },
  },

  /* ---------------- Requirements ---------------- */
  "delicious": {
    canPlay: (g, p) => p.traitPile.some((c) => hasColour(c, "Colorless")),
  },
  "heroic": {
    canPlay: (g, p) => p.traitPile.filter((c) => hasColour(c, "Green")).length >= 3,
  },
  "retractable claws": {
    canPlay: (g, p) => p.traitPile.some((c) => hasColour(c, "Red")),
    *cost(ctx) {
      const reds = myTraits(ctx, (c) => hasColour(c, "Red"));
      const hit = yield* pickTrait(ctx, reds, "Retractable Claws — discard a red trait to play");
      if (!hit) return false;
      yield* ctx.discardTrait(ctx.me, hit.card.uid);
      return true;
    },
  },
  "morality": {
    canPlay: (g, p) => p.traitPile.some((c) => faceValue(c) > 0),
    *cost(ctx) {
      const pos = myTraits(ctx, (c) => faceValue(c) > 0);
      if (!pos.length) return false;
      const target = yield ctx.ask.player({
        prompt: "Morality — give a positive trait to whom?",
        options: ctx.opponents().map((p) => ({ id: p.id, name: p.name })),
      });
      const opp = ctx.opponents().find((p) => p.id === (target && target.id)) || ctx.opponents()[0];
      const hit = yield* pickTrait(ctx, pos, `Give a positive trait to ${opp.name}`);
      if (!hit) return false;
      moveTrait(ctx.g, ctx.me, opp, hit.card.uid, EFFECTS);
      return true;
    },
  },
  "optimistic nihilism": {
    canPlay: (g, p) => g.players.every((x) => x.traitPile.length >= 3),
    *onPlay(ctx) {
      for (const p of ctx.g.players) {
        const cands = p.traitPile.map((card) => ({ player: p, card }));
        const hit = yield* pickTrait(ctx, cands, `${p.name}: discard 1 trait`);
        if (hit) yield* ctx.discardTrait(p, hit.card.uid);
      }
    },
  },

  /* ---------------- Persistent ---------------- */
  "echolocation": {
    *onTurnStart(ctx) {
      const yes = yield ctx.ask.confirm({ prompt: "Echolocation — draw 1 card?" });
      if (yes) { ctx.draw(1); ctx.say(`${ctx.me.name} drew from Echolocation.`); }
    },
  },

  "endurance": { /* handled inside discardTrait — it returns itself */ },

  // "When this or any trait is discarded from your trait pile, draw 1 card.
  //  You may play it now. (Excluding dominants.) Ignore actions (a)."
  "regenerative tissue": {
    *onTraitDiscarded(ctx, discarded) {
      if (isDominant(discarded)) return;
      const [drawn] = ctx.draw(1);
      if (!drawn) return;
      ctx.say(`Regenerative Tissue: ${ctx.me.name} drew a card.`);
      if (lonelyBlocks(ctx.g, ctx.me)) return;   // Lonely Age: no second trait on your turn
      const yes = yield ctx.ask.confirm({
        prompt: `Regenerative Tissue — play ${drawn.name} now? (its action is ignored)`,
      });
      if (yes) yield* ctx.playNow(drawn.uid, { ignoreAction: true });
    },
  },

  "denial": {
    *onPlay(ctx) {
      ctx.me.flags.denialArmed = true;
      ctx.say("Denial armed — the next catastrophe may be ignored.");
    },
  },

  /* ---------------- Play When (reactive) ----------------
   * These play out of turn through the reaction windows in core.js. Each one
   * names the window it listens on and when it is allowed to answer.
   */

  // "You may play this at any time to stop an action (a)."
  "automimicry": {
    reactive: {
      window: "traitPlayed",
      eligible: (g, holder, ev) => Boolean(ev.isAction),
      *respond(ctx, ev) { ev.cancelled = true; },
    },
  },
  "chromatophores": {
    reactive: {
      window: "traitPlayed",
      eligible: (g, holder, ev) => Boolean(ev.isAction),
      *respond(ctx, ev) { ev.cancelled = true; },
    },
  },

  // "You may play this when an opponent plays a trait. Stop its action (a).
  //  Then steal it."  Triggers on any opponent trait, not only actions.
  "parasitic": {
    reactive: {
      window: "traitPlayed",
      eligible: (g, holder, ev) => Boolean(ev.actor) && ev.actor.id !== holder.id,
      eligibleNote: "Parasitic cannot take a dominant trait.",
      *respond(ctx, ev) {
        ev.cancelled = true;
        const taken = ctx.takeTrait(ev.actor, ctx.me, ev.card.uid);
        if (taken) ctx.say(`Parasitic: ${ctx.me.name} stole ${taken.name} from ${ev.actor.name}.`);
        else ctx.say(`Parasitic stopped ${ev.card.name}, but a dominant can't be stolen.`);
      },
    },
  },

  // "You may play this at any time into any trait pile." The point of the card
  // is that it is worth -1, so you dump it on somebody else.
  "self-awareness": {
    reactive: {
      window: ["traitPlayed", "afterStabilize"],
      intoAnyPile: true,
    },
  },

  // "You may play this after you stabilize."
  "late": {
    reactive: {
      window: "afterStabilize",
      eligible: (g, holder, ev) => Boolean(ev.actor) && ev.actor.id === holder.id,
    },
  },

  // "You may play this when you play a green trait."
  "leaves": {
    reactive: {
      window: "traitPlayed",
      eligible: (g, holder, ev) =>
        Boolean(ev.actor) && ev.actor.id === holder.id &&
        ev.card && hasColour(ev.card, "Green") && norm(ev.card.name) !== "leaves",
    },
  },

  /* ---------------- World's End ---------------- */
  // "At World's End: You may play this."
  "sneaky": {
    worldsEnd: true,
    reactive: { window: "worldsEnd" },
  },
  "cherished": {
    worldsEnd: true,
    *onWorldsEnd(ctx) {
      const mine = myTraits(ctx, (c) => c.uid !== ctx.card.uid);
      const hit = yield* pickTrait(ctx, mine, "Cherished — return a trait to your hand?", true);
      if (hit) returnTraitToHand(ctx.g, ctx.me, hit.card.uid, EFFECTS);
    },
  },
  "eloquence": {
    worldsEnd: true,
    *onWorldsEnd(ctx) {
      if (!ctx.me.hand.length) return;
      const chosen = yield ctx.ask.cards({
        prompt: "Eloquence — play 1 more trait (action ignored)?",
        playerId: ctx.me.id, from: "hand", count: 0, max: 1, optional: true,
        options: ctx.me.hand.map((c) => ({ uid: c.uid, name: c.name })),
      });
      const uid = (chosen || []).map((x) => (typeof x === "string" ? x : x.uid))[0];
      if (uid) yield* ctx.playNow(uid, { ignoreAction: true });
    },
  },
  "boredom": {
    worldsEnd: true,
    *onWorldsEnd(ctx) { ctx.draw(2); },
    *score(ctx) { return 2 * handColourCount(ctx.me, "Colorless"); },
  },
  // "At World's End: You may change one color to a different color on traits
  //  in your trait pile." Rewrites the colour on every trait of the chosen
  //  colour, which is what makes it swing Branches, Sentience and Symbiosis.
  "faith": {
    worldsEnd: true,
    *onWorldsEnd(ctx) {
      const present = presentColours(ctx.me);
      if (!present.length) return;
      const from = yield ctx.ask.colour({
        playerId: ctx.me.id,
        prompt: "Faith — change which colour?",
        options: present, optional: true,
      });
      if (!from) return;
      const to = yield ctx.ask.colour({
        playerId: ctx.me.id,
        prompt: `Faith — change ${from} to what?`,
        options: COLOURS.filter((c) => norm(c) !== norm(from)),
      });
      if (!to) return;
      let n = 0;
      for (const c of ctx.me.traitPile) {
        if (!hasColour(c, from)) continue;
        const next = listOf(c.color).map((x) => (norm(x) === norm(from) ? to : x));
        c.color = [...new Set(next)].join(" | ");
        n++;
      }
      ctx.say(`Faith: ${ctx.me.name} changed ${n} trait(s) from ${from} to ${to}.`);
    },
  },
  // Handled in core's resolveWorldsEnd — it has to run before any other
  // World's End effect, since it decides which catastrophe is the ending one.
  "prepper": { worldsEnd: true },
  "hyper-intelligence": {
    worldsEnd: true,
    *onWorldsEnd(ctx) {
      for (const opp of ctx.opponents()) {
        const present = presentColours(opp);
        if (!present.length) continue;
        const colour = yield ctx.ask.colour({
          prompt: `Hyper-Intelligence — choose a colour for ${opp.name}`,
          options: present,
        });
        const pool = opp.traitPile.filter((c) => hasColour(c, colour) && !isLocked(opp, c));
        if (!pool.length) continue;
        const victim = pool[Math.floor(ctx.g.rng() * pool.length)];
        yield* ctx.discardTrait(opp, victim.uid);
        ctx.say(`${opp.name} discarded ${victim.name} to Hyper-Intelligence.`);
      }
    },
  },

  /* ---------------- Drop of Life: colour counters ---------------- */
  "egg clusters":       perColour("Blue"),
  "heat vision":        perColour("Red"),
  "overgrowth":         perColour("Green"),
  "sticky secretions":  perColour("Purple"),
  "mindful":            perColour("Colorless"),

  "puffy":      perGroup("Blue", 3, 3),
  "fire skin":  perGroup("Red", 3, 3),
  "deep roots": perGroup("Green", 3, 3),
  "nocturnal":  perGroup("Purple", 3, 3),

  /* ---------------- Drop of Life: the rest ---------------- */
  "altruistic":  { *score(ctx) { return ctx.me.genePool; } },
  "fortunate":   { *score(ctx) { return ctx.me.hand.length; } },
  "brave":       { *score(ctx) { return 2 * ctx.me.hand.filter(isDominant).length; } },
  "fangs":       { *score(ctx) { return ctx.me.traitPile.some((c) => norm(c.name) === "vampirism") ? 3 : 0; } },

  "pollination": { *score(ctx) { return ctx.me.traitPile.filter((c) => faceValue(c) === 1).length; } },

  "saudade": {
    *score(ctx) {
      const n = COLOURS.filter((c) => handColourCount(ctx.me, c) > 0).length;
      return Math.min(n, 4);
    },
  },

  // "+4 if green is the most common color in your trait pile. (No ties!)"
  "branches": {
    *score(ctx) {
      const t = colourTally(ctx.me);
      const green = t.Green;
      if (!green) return 0;
      const strictlyMost = COLOURS.every((c) => c === "Green" || t[c] < green);
      return strictlyMost ? 4 : 0;
    },
  },

  "immunity": {
    *score(ctx) { return 2 * ctx.me.traitPile.filter((c) => faceValue(c) < 0).length; },
  },

  // "-1 for each trait in your trait pile. (Excluding dominants.)"
  "tiny": {
    *score(ctx) { return -ctx.me.traitPile.filter((c) => !isDominant(c)).length; },
  },

  // "+1 for every 2 traits of the same color in your trait pile."
  "pack behavior": {
    *score(ctx) {
      const t = colourTally(ctx.me);
      return COLOURS.reduce((n, c) => n + Math.floor(t[c] / 2), 0);
    },
  },

  // "+2 if you have the most traits. +2 for each opponent with fewer traits
  //  than you. (Ties don't count!)"
  "apex predator": {
    *score(ctx) {
      const mine = ctx.me.traitPile.length;
      const opps = ctx.opponents();
      const most = opps.every((o) => o.traitPile.length < mine);
      const fewer = opps.filter((o) => o.traitPile.length < mine).length;
      return (most ? 2 : 0) + 2 * fewer;
    },
  },

  // "+1 for each trait of the most common color in your trait pile. (If
  //  there's a tie, pick 1!)"
  "sentience": {
    *score(ctx) {
      const t = colourTally(ctx.me);
      const max = Math.max(...COLOURS.map((c) => t[c]));
      if (max <= 0) return 0;
      const tied = COLOURS.filter((c) => t[c] === max);
      if (tied.length > 1) {
        const pick = yield ctx.ask.colour({
          prompt: "Sentience — most common colour is tied; pick one",
          options: tied,
        });
        return t[pick] || max;
      }
      return max;
    },
  },

  // "+2 for each trait of the rarest color in your trait pile. (Must have 2 or
  //  more colors. If there's a tie, pick 1.)"
  "symbiosis": {
    *score(ctx) {
      const t = colourTally(ctx.me);
      const present = COLOURS.filter((c) => t[c] > 0);
      if (present.length < 2) return 0;
      const min = Math.min(...present.map((c) => t[c]));
      const tied = present.filter((c) => t[c] === min);
      if (tied.length > 1) {
        const pick = yield ctx.ask.colour({
          prompt: "Symbiosis — rarest colour is tied; pick one",
          options: tied,
        });
        return 2 * (t[pick] || min);
      }
      return 2 * min;
    },
  },

  // "Opponents receive -1 for each trait of the most common color in their
  //  trait pile. (If there's a tie, pick 1!)"
  "viral": {
    *scoreOthers(ctx) {
      const out = {};
      for (const opp of ctx.opponents()) {
        const t = colourTally(opp);
        const max = Math.max(...COLOURS.map((c) => t[c]));
        if (max <= 0) continue;
        const tied = COLOURS.filter((c) => t[c] === max);
        let n = max;
        if (tied.length > 1) {
          const pick = yield ctx.ask.colour({
            prompt: `Viral — pick the counted colour for ${opp.name}`,
            options: tied,
          });
          n = t[pick] || max;
        }
        out[opp.id] = -n;
      }
      return out;
    },
  },

  // "+1 Gene Pool +1 for each card in your hand."
  "camouflage": {
    gpDelta: +1,
    *onPlay(ctx) { adjustGenePool(ctx.g, ctx.me, +1); },
    *score(ctx) { return ctx.me.hand.length; },
  },
};

/* Kidney (1)–(8) and Swarm (2)–(6): generated rather than hand-listed so a
   future expansion's extra copies pick up the same rule automatically. */
for (let i = 1; i <= 8; i++) {
  EFFECTS[`kidney (${i})`] = countByPrefix("kidney", "self");
}
for (let i = 1; i <= 8; i++) {
  EFFECTS[`swarm (${i})`] = countByPrefix("swarm", "all");
}

/* ================================================================== *
 * Shared action bodies that needed EFFECTS in scope
 * ================================================================== */

function* swapDifferentOrSame(ctx, mode) {
  const mine = myTraits(ctx, (c) => c.uid !== ctx.card.uid);
  if (!mine.length) return;
  const first = yield* pickTrait(ctx, mine, "Swap which of your traits?");
  if (!first) return;

  const myColours = coloursOf(first.card);
  const match = (c) => {
    const theirs = coloursOf(c);
    const shares = theirs.some((t) => myColours.some((m) => norm(m) === norm(t)));
    return mode === "same" ? shares : !shares;
  };

  const cands = opponentTraits(ctx, match);
  const second = yield* pickTrait(
    ctx, cands,
    mode === "same" ? "Swap with a same-colour trait" : "Swap with a different-colour trait");
  if (!second) return;

  moveTrait(ctx.g, ctx.me, second.player, first.card.uid, EFFECTS);
  moveTrait(ctx.g, second.player, ctx.me, second.card.uid, EFFECTS);
  ctx.say(`${ctx.me.name} swapped ${first.card.name} for ${second.card.name}.`);
}

function* replayAction(ctx, candidates, emptyNote) {
  // Never offer the card doing the replaying — picking it just re-asks forever.
  const pool = candidates.filter(({ card }) => card.uid !== ctx.card.uid);
  if (!pool.length) {
    yield ctx.ask.confirm({
      playerId: ctx.me.id, acknowledge: true,
      prompt: emptyNote || "There is no action to replay.",
    });
    return;
  }
  const hit = yield* pickTrait(ctx, pool, "Play which action?", true, false);
  if (!hit) return;
  const h = EFFECTS[norm(hit.card.name)];
  if (h && h.onPlay) {
    ctx.say(`${ctx.me.name} replayed ${hit.card.name}'s action.`);
    yield* replayGuarded(ctx.g, h.onPlay({ ...ctx, card: hit.card }));
  }
}

/** Replays can chain (Painted Shell replaying Inventive replaying Hydrofuge…).
 *  Two levels deep is plenty for any real play; past that, stop. */
const MAX_REPLAY_DEPTH = 2;
function* replayGuarded(g, gen) {
  if ((g.replayDepth || 0) >= MAX_REPLAY_DEPTH) { say(g, "That would replay actions forever — stopping the chain."); return; }
  g.replayDepth = (g.replayDepth || 0) + 1;
  try { yield* gen; } finally { g.replayDepth--; }
}

function* playFromDiscard(ctx, { ignoreAction, topOnly }) {
  if (!ctx.g.discard.length) return;
  if (lonelyBlocks(ctx.g, ctx.me)) {
    ctx.say(`Lonely Age: ${ctx.me.name} can't play another trait this turn.`);
    return;
  }
  let card = ctx.g.discard[0];
  if (!topOnly) {
    const choice = yield ctx.ask.cards({
      prompt: "Play which card from the discard pile?",
      from: "discard", count: 1,
      options: ctx.g.discard.map((c) => ({ uid: c.uid, name: c.name })),
    });
    const uid = (choice || []).map((x) => (typeof x === "string" ? x : x.uid))[0];
    card = ctx.g.discard.find((c) => c.uid === uid) || card;
  }
  const i = ctx.g.discard.findIndex((c) => c.uid === card.uid);
  if (i < 0) return;
  ctx.g.discard.splice(i, 1);
  ctx.me.hand.push(card);
  yield* ctx.playNow(card.uid, { ignoreAction });
}

/* ================================================================== *
 * Coverage report — used by the tests and worth reading.
 * ================================================================== */
function coverage(cards) {
  const traits = cards.filter((c) => norm(c.card_type) === "trait");
  const out = { total: traits.length, scripted: 0, effectless: 0, reactive: 0, manual: [], missing: [] };
  for (const c of traits) {
    const h = EFFECTS[norm(c.name)];
    const hasText = Boolean((c.effect || "").trim());
    if (!hasText) { out.effectless++; continue; }
    if (!h) { out.missing.push(c.name); continue; }
    out.scripted++;
    if (h.reactive) out.reactive = (out.reactive || 0) + 1;
    if (h.manual) out.manual.push({ name: c.name, why: h.manual });
  }
  return out;
}
