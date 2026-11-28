/**
 * Doomlings — Overlush expansion: traits, ages and catastrophes.
 *
 * Registers into the same EFFECTS / AGES / CATASTROPHES tables as the base game,
 * so the engine treats an Overlush card exactly like a base card. Hooks that the
 * base game didn't need and Overlush does:
 *
 *   *onLeave(ctx, ev)        this card left its owner's pile (ev.how: discard,
 *                            move, return; ev.by: the effect that did it)
 *   *afterStabilize(ctx)     Persistent, after its owner stabilizes
 *   ability {from, label,…}  a button on the card ("discard Nimble to …")
 *   reactive windows         traitRemoved, catastrophe, roundEnd, afterAge
 *
 * "Left" is the next seat in play order and "right" the previous one, the same
 * convention as Super Spreader and Mega Tsunami.
 */

const COLOURS4 = ["Blue", "Green", "Red", "Purple"];
const effectless = (c) => !(c.effect || "").trim();
const isDoL = (c) => hasSubtype(c, "Drop of Life");
const leftOf = (g, p) => g.players[(g.players.findIndex((x) => x.id === p.id) + 1) % g.players.length];
const rightOf = (g, p) => g.players[(g.players.findIndex((x) => x.id === p.id) - 1 + g.players.length) % g.players.length];
const ownTurn = (g, p) => g.phase === "turn" && g.activeSeat === p.id;
const pickedUids = (res) => (res || []).map((x) => (typeof x === "string" ? x : x && x.uid)).filter(Boolean);
const cardOpts = (list) => list.map((c) => ({ uid: c.uid, name: c.name }));
const inHand = (p, uid) => p.hand.some((c) => c.uid === uid);

/** Ask `player` to pick cards out of `list` (by default their own hand). */
function* chooseCards(ctx, player, list, { prompt, count = 1, max = count, optional = false, from = "hand" } = {}) {
  if (!list.length) return [];
  const res = yield ctx.ask.cards({
    playerId: player.id, prompt, from,
    count: optional ? 0 : Math.min(count, list.length),
    max: Math.min(max, list.length), optional,
    options: cardOpts(list),
  });
  const want = new Set(pickedUids(res));
  let out = list.filter((c) => want.has(c.uid));
  if (!optional && out.length < Math.min(count, list.length)) {
    out = out.concat(list.filter((c) => !want.has(c.uid)).slice(0, Math.min(count, list.length) - out.length));
  }
  return out;
}

/** "You may play 1 of these now", with the action optionally ignored. */
function* mayPlay(ctx, cards, { filter = () => true, label, ignoreAction = false, required = false } = {}) {
  if (lonelyBlocks(ctx.g, ctx.me)) {
    ctx.say(`Lonely Age: ${ctx.me.name} can't play another trait this turn.`);
    return null;
  }
  const ok = cards.filter((c) => inHand(ctx.me, c.uid) && filter(c) && canPlayCard(ctx.g, ctx.me, c, EFFECTS));
  if (!ok.length) return null;
  const [pick] = yield* chooseCards(ctx, ctx.me, ok, { prompt: label, count: 1, max: 1, optional: !required });
  if (!pick) return null;
  return yield* ctx.playNow(pick.uid, { ignoreAction });
}

/** Run a trait's action without playing it (Electroreception, Booming Call). */
function* runActionOf(ctx, card) {
  const h = EFFECTS[norm(card.copyOf || card.name)];
  if (!h || !h.onPlay || !isAction(card)) return false;
  ctx.say(`${ctx.me.name} used ${card.name}'s action.`);
  yield* replayGuarded(ctx.g, h.onPlay({ ...ctx, card }));
  return true;
}

/** Replay an action from a filtered set of pile traits; returns the trait used. */
function* replayFrom(ctx, candidates, prompt, { optional = true } = {}) {
  const pool = candidates.filter(({ card }) => card.uid !== ctx.card.uid && isAction(card) && EFFECTS[norm(card.name)] && EFFECTS[norm(card.name)].onPlay);
  if (!pool.length) { ctx.say(`${ctx.card.name}: no action to play.`); return null; }
  const hit = yield* pickTrait(ctx, pool, prompt, optional, false);
  if (!hit) return null;
  yield* runActionOf(ctx, hit.card);
  return hit;
}

/** Swap this card with an opponent's trait (Contagious, Noxious, Toxic…). */
function* swapSelfWith(ctx, filter, prompt) {
  if (!ctx.me.traitPile.some((c) => c.uid === ctx.card.uid)) return null;
  const hit = yield* pickTrait(ctx, opponentTraits(ctx, filter), prompt);
  if (!hit) return null;
  if (!moveTrait(ctx.g, hit.player, ctx.me, hit.card.uid, EFFECTS)) return null;
  moveTrait(ctx.g, ctx.me, hit.player, ctx.card.uid, EFFECTS);
  ctx.say(`${ctx.card.name} swapped into ${hit.player.name}'s pile for ${hit.card.name}.`);
  return hit.card;
}

/** Everyone passes the cards a test picks out of their hand, all at once. */
function passAll(g, dir, test) {
  const moving = g.players.map((p) => { const go = p.hand.filter(test); p.hand = p.hand.filter((c) => !test(c)); return go; });
  g.players.forEach((p, i) => { (dir === "left" ? leftOf(g, p) : rightOf(g, p)).hand.push(...moving[i]); });
}
const passColourRight = (colour) => function* (ctx) {
  passAll(ctx.g, "right", (c) => hasColour(c, colour));
  ctx.say(`Everyone passed their ${colour.toLowerCase()} cards right.`);
  yield ctx.ask.confirm({ acknowledge: true, prompt: `${ctx.card.name} — every ${colour.toLowerCase()} card in hand passed to the right.` });
};

function discardWhere(g, p, test) {
  const gone = p.hand.filter(test);
  for (const c of gone) discardFromHand(g, p, c.uid);
  return gone;
}
const stabilizeNow = (g, p, card) => makeCtx(g, p, card, EFFECTS).restabilize();
const takeFromHand = (from, to, uid) => {
  const i = from.hand.findIndex((c) => c.uid === uid);
  if (i < 0) return null;
  const c = from.hand.splice(i, 1)[0];
  to.hand.push(c);
  return c;
};
function* pickOpponent(ctx, prompt, filter = () => true) {
  const opps = ctx.opponents().filter(filter);
  if (!opps.length) return null;
  if (opps.length === 1) return opps[0];
  const t = yield ctx.ask.player({ prompt, options: opps.map((p) => ({ id: p.id, name: p.name, handSize: p.hand.length })) });
  return opps.find((p) => p.id === (t && t.id)) || opps[0];
}
function* chooseOne(ctx, player, prompt, options) {
  const res = yield { kind: "choose", playerId: player.id, prompt, options };
  return (options.find((o) => o.uid === (res && res.uid)) || options[0]).uid;
}
const minPair = (a, b) => ({ *score(ctx) { return Math.min(pileColourCount(ctx.me, a), pileColourCount(ctx.me, b)); } });
const ifAtLeast = (colour, n, award) => ({ *score(ctx) { return pileColourCount(ctx.me, colour) >= n ? award : 0; } });
const ANY_TIME = ["traitPlayed", "afterStabilize"];
/** "Cannot be played on your turn!" */
const notOnYourTurn = (g, p) => !ownTurn(g, p);
/** Abilities that put a Play When card down for free on your own turn. */
const playFreeAbility = { from: "hand", ownTurn: true, label: "Play it now (free)", *use(ctx) { yield* ctx.playNow(ctx.card.uid); } };

Object.assign(EFFECTS, {

  /* ================= Actions ================= */
  "collector": {
    *onPlay(ctx) {
      const drawn = ctx.draw(4);
      for (const c of drawn.filter(isDominant)) discardFromHand(ctx.g, ctx.me, c.uid);
      const used = new Set();
      for (let k = 0; k < 5; k++) {
        const left = drawn.filter((c) => inHand(ctx.me, c.uid) && !isDominant(c) && coloursOf(c).some((col) => !used.has(col)));
        const played = yield* mayPlay(ctx, left, { label: "Collector — play one of each colour drawn? (actions ignored)", ignoreAction: true });
        if (!played) break;
        coloursOf(played).forEach((col) => used.add(col));
      }
    },
  },

  "agile": {
    *onPlay(ctx) {
      for (let k = 0; k < 3 && ctx.me.hand.length; k++) {
        const hit = yield* pickTrait(ctx, myTraits(ctx, (c) => c.uid !== ctx.card.uid), "Agile — discard a trait from your pile? (costs 1 card from hand)", true);
        if (!hit) break;
        if (!(yield* ctx.discardTrait(ctx.me, hit.card.uid))) break;
        yield* discardChosen(ctx, ctx.me, 1, "Agile — discard 1 card from your hand");
      }
    },
  },

  "antennae": {
    *onPlay(ctx) {
      yield* replayFrom(ctx, myTraits(ctx, (c) => hasColour(c, "Red")), "Antennae — play an action from a red trait in your pile", { optional: false });
      discardHand(ctx.g, ctx.me);
      ctx.say(`${ctx.me.name} discarded their hand (Antennae).`);
    },
  },

  "compound eyes": {
    *onPlay(ctx) {
      yield* replayFrom(ctx, myTraits(ctx, (c) => hasColour(c, "Purple")), "Compound Eyes — play an action from a purple trait in your pile", { optional: false });
      const [c] = randomCardsFromHand(ctx.g, ctx.me, 1);
      if (c) { discardFromHand(ctx.g, ctx.me, c.uid); ctx.say(`Compound Eyes: ${ctx.me.name} discarded ${c.name} at random.`); }
    },
  },

  "arrested muscles": {
    *onPlay(ctx) {
      const twos = ctx.g.discard.filter((c) => isTrait(c) && faceValue(c) === 2);
      const [pick] = yield* chooseCards(ctx, ctx.me, twos, { prompt: "Arrested Muscles — take a face value 2 trait from the discard pile", from: "discard" });
      if (!pick) return;
      ctx.g.discard.splice(ctx.g.discard.indexOf(pick), 1);
      ctx.me.hand.push(pick);
      ctx.say(`${ctx.me.name} took ${pick.name} from the discard pile.`);
    },
  },

  "booming call": {
    *onPlay(ctx) {
      if (ctx.g.boomingClock === ctx.g.clock) return;   // "may not use Booming Call's action again this turn"
      ctx.g.boomingClock = ctx.g.clock;
      const got = yield* swapSelfWith(ctx, () => true, "Booming Call — swap with which trait?");
      if (got) yield* runActionOf(ctx, got);
    },
  },

  "bushwhacker": {
    *onPlay(ctx) {
      for (const p of ctx.playersInOrder()) yield* discardChosen(ctx, p, 1, `Bushwhacker — ${p.name}, discard 1 card`);
      const [pick] = yield* chooseCards(ctx, ctx.me, ctx.g.discard.slice(), { prompt: "Bushwhacker — take any card from the discard pile?", optional: true, from: "discard" });
      if (pick) { ctx.g.discard.splice(ctx.g.discard.indexOf(pick), 1); ctx.me.hand.push(pick); }
    },
  },

  "caffeinated": {
    *onPlay(ctx) {
      const gifts = [];
      for (const p of ctx.playersInOrder()) {
        drawMany(ctx.g, p, 3);
        const [c] = yield* chooseCards(ctx, p, p.hand.slice(), { prompt: `Caffeinated — ${p.name}, give 1 card to ${rightOf(ctx.g, p).name}` });
        if (c) gifts.push([p, c]);
      }
      for (const [p, c] of gifts) takeFromHand(p, rightOf(ctx.g, p), c.uid);
      ctx.say("Caffeinated: everyone drew 3 and passed 1 right.");
    },
  },

  "cheek pouches": {
    *onPlay(ctx) {
      ctx.draw(2);
      if (ownTurn(ctx.g, ctx.me)) { ctx.g.noStabilizeFor = ctx.me.id; ctx.say(`${ctx.me.name} drew 2 and won't stabilize this turn.`); }
    },
  },

  "cocoa": {
    *onPlay(ctx) {
      ctx.draw(3);
      for (let k = 0; k < 2 && ctx.me.hand.length; k++) {
        const opp = yield* pickOpponent(ctx, `Cocoa — give card ${k + 1} of 2 to whom?`);
        if (!opp) return;
        const [c] = yield* chooseCards(ctx, ctx.me, ctx.me.hand.slice(), { prompt: `Cocoa — give a card to ${opp.name}` });
        if (c) takeFromHand(ctx.me, opp, c.uid);
      }
    },
  },

  "electroreception": {
    *onPlay(ctx) {
      const drawn = ctx.drawBottom(3);
      const acts = drawn.filter((c) => isAction(c) && EFFECTS[norm(c.name)] && EFFECTS[norm(c.name)].onPlay && c.uid !== ctx.card.uid);
      const [pick] = yield* chooseCards(ctx, ctx.me, acts, { prompt: "Electroreception — use the action of one drawn card?", optional: true });
      if (pick) yield* runActionOf(ctx, pick);
    },
  },

  "eusocial": {
    *onPlay(ctx) {
      const g = ctx.g;
      const moving = g.players.map((p) => randomCardsFromHand(g, p, 1)[0] || null);
      g.players.forEach((p, i) => { if (moving[i]) takeFromHand(p, leftOf(g, p), moving[i].uid); });
      ctx.say("Eusocial: everyone passed a random card left.");
    },
  },

  "eyestalks": {
    *onPlay(ctx) {
      const opp = yield* pickOpponent(ctx, "Eyestalks — peek at whose hand?");
      if (opp) {
        yield ctx.ask.confirm({
          playerId: ctx.me.id, acknowledge: true,
          prompt: opp.hand.length ? `Eyestalks — ${opp.name} holds: ${opp.hand.map((c) => c.name).join(", ")}.` : `Eyestalks — ${opp.name}'s hand is empty.`,
        });
      }
      ctx.grantPlay(1);
    },
  },

  "fearful symmetry": {
    *onPlay(ctx) {
      yield* mayPlay(ctx, ctx.me.hand.slice(), { filter: (c) => faceValue(c) === 2, label: "Fearful Symmetry — play a face value 2 trait? (its action resolves)" });
    },
  },

  "grooming claws": {
    *onPlay(ctx) {
      for (const p of ctx.playersInOrder()) {
        const [c] = randomCardsFromHand(ctx.g, p, 1);
        if (c) discardFromHand(ctx.g, p, c.uid);
      }
      ctx.say("Grooming Claws: everyone discarded a random card.");
    },
  },

  "haustorium": {
    *onPlay(ctx) {
      ctx.g.traitDeck = shuffle(ctx.g.traitDeck.concat(ctx.g.discard), ctx.g.rng);
      ctx.g.discard = [];
      discardHand(ctx.g, ctx.me);
      ctx.say(`Haustorium: the discard pile was shuffled into the deck and ${ctx.me.name} discarded their hand.`);
    },
  },

  "hydrofuge": {
    *onPlay(ctx) {
      const hit = yield* replayFrom(ctx, opponentTraits(ctx, (c) => hasColour(c, "Blue")), "Hydrofuge — play an action from an opponent's blue trait", { optional: false });
      if (hit && returnTraitToHand(ctx.g, hit.player, hit.card.uid, EFFECTS)) ctx.say(`${hit.card.name} returned to ${hit.player.name}'s hand.`);
    },
  },

  "jumpy": {
    *onPlay(ctx) {
      const richer = new Set(ctx.opponents().filter((p) => p.genePool > ctx.me.genePool).map((p) => p.id));
      const cands = opponentTraits(ctx).filter(({ player }) => richer.has(player.id));
      const hit = yield* pickTrait(ctx, cands, "Jumpy — steal a trait from a bigger Gene Pool");
      if (hit && moveTrait(ctx.g, hit.player, ctx.me, hit.card.uid, EFFECTS)) ctx.say(`${ctx.me.name} stole ${hit.card.name} from ${hit.player.name}.`);
    },
  },

  "mandibles": {
    *onPlay(ctx) {
      const hit = yield* replayFrom(ctx, opponentTraits(ctx, (c) => hasColour(c, "Green")), "Mandibles — play an action from an opponent's green trait", { optional: false });
      if (hit && returnTraitToHand(ctx.g, hit.player, hit.card.uid, EFFECTS)) ctx.say(`${hit.card.name} returned to ${hit.player.name}'s hand.`);
    },
  },

  "nutty": {
    *onPlay(ctx) {
      const opp = yield* pickOpponent(ctx, "Nutty — which opponent draws 3?");
      if (!opp) return;
      drawMany(ctx.g, opp, 3);
      const [c] = yield* chooseCards(ctx, opp, opp.hand.slice(), { prompt: `Nutty — ${opp.name}, give 1 card to ${ctx.me.name}` });
      if (c) takeFromHand(opp, ctx.me, c.uid);
    },
  },

  "playful": {
    *onPlay(ctx) {
      for (const opp of ctx.opponents()) {
        const [c] = randomCardsFromHand(ctx.g, opp, 1);
        if (c) takeFromHand(opp, ctx.me, c.uid);
      }
      for (const opp of ctx.opponents()) {
        const [c] = yield* chooseCards(ctx, ctx.me, ctx.me.hand.slice(), { prompt: `Playful — give a card back to ${opp.name}` });
        if (c) takeFromHand(ctx.me, opp, c.uid);
      }
    },
  },

  "psychedelic": {
    *onPlay(ctx) {
      const g = ctx.g;
      const age = topAge(g);
      if (!ownTurn(g, ctx.me) || !age || isCatastrophe(age)) return;
      g.firstSeat = g.activeSeat = ctx.me.id;
      g.ageApplied = [];
      g.inExtraTurn = false;
      g.playsLeft = 1;
      resetTurnState(g);
      ctx.say(`Psychedelic: the age restarts with ${ctx.me.name} as first player.`, true);
      yield* turnStartEffects(g, EFFECTS);
    },
  },

  "rover": {
    *onPlay(ctx) {
      const colour = yield ctx.ask.colour({ prompt: "Rover — choose a colour to look for" });
      const bottom = ctx.g.traitDeck.slice(-5);
      const ok = bottom.filter((c) => hasColour(c, colour) && canPlayCard(ctx.g, ctx.me, c, EFFECTS));
      if (lonelyBlocks(ctx.g, ctx.me) || !ok.length) {
        yield ctx.ask.confirm({ playerId: ctx.me.id, acknowledge: true, prompt: `Rover — the bottom 5: ${bottom.map((c) => c.name).join(", ") || "nothing"}. Nothing to play.` });
        return;
      }
      const [pick] = yield* chooseCards(ctx, ctx.me, ok, { prompt: `Rover — play a ${String(colour).toLowerCase()} trait from the bottom 5?`, optional: true, from: "deck" });
      if (!pick) return;
      ctx.g.traitDeck.splice(ctx.g.traitDeck.indexOf(pick), 1);
      ctx.me.hand.push(pick);
      yield* ctx.playNow(pick.uid);
    },
  },

  "sapient": {
    *onPlay(ctx) {
      const deck = ctx.g.ageDeck;
      if (!deck.length) return;
      const which = yield* chooseOne(ctx, ctx.me, "Sapient — peek at which ages?", [
        { uid: "next", name: "The next age", effect: "Look at the top card of the age pile." },
        { uid: "last", name: "The final 2 ages", effect: "Look at the bottom 2 cards of the age pile." },
      ]);
      const seen = which === "last" ? deck.slice(-2) : deck.slice(0, 1);
      yield ctx.ask.confirm({
        playerId: ctx.me.id, acknowledge: true,
        prompt: `Sapient — ${which === "last" ? "the final ages are" : "the next age is"} ${seen.map((c) => c.name).join(" then ")}.`,
        peek: { name: seen[0].name, effect: seen[0].effect },
      });
    },
  },

  "seeker": {
    *onPlay(ctx) {
      const values = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
      const v = Number(yield* chooseOne(ctx, ctx.me, "Seeker — choose a face value",
        [1, 2, 3, 0, 4, -1, 5, -2, 6, 7].filter((x) => values.includes(x)).map((x) => ({ uid: String(x), name: `Face value ${x}` }))));
      const drawn = ctx.draw(5);
      const played = yield* mayPlay(ctx, drawn, { filter: (c) => faceValue(c) === v, label: `Seeker — play a face value ${v} trait`, required: true });
      for (const c of drawn) if (inHand(ctx.me, c.uid) && (!played || c.uid !== played.uid)) discardFromHand(ctx.g, ctx.me, c.uid);
    },
  },

  "self-pruning": {
    *onPlay(ctx) {
      const pile = myTraits(ctx, (c) => c.uid !== ctx.card.uid && !isLocked(ctx.me, c));
      const where = pile.length && ctx.me.hand.length
        ? yield* chooseOne(ctx, ctx.me, "Self-Pruning — discard from where?", [
          { uid: "hand", name: "1 card from your hand" }, { uid: "pile", name: "1 trait from your trait pile" }])
        : (pile.length ? "pile" : "hand");
      if (where === "pile") {
        const hit = yield* pickTrait(ctx, pile, "Self-Pruning — discard which trait?");
        if (hit) yield* ctx.discardTrait(ctx.me, hit.card.uid);
      } else yield* discardChosen(ctx, ctx.me, 1, "Self-Pruning — discard 1 card");
    },
  },

  "shady": {
    *onPlay(ctx) {
      ctx.draw(3);
      const ok = ctx.me.hand.filter((c) => !isDominant(c));
      const [c] = yield* chooseCards(ctx, ctx.me, ok, { prompt: "Shady — pick a card to play into an opponent's pile" });
      if (!c) return;
      const opp = yield* pickOpponent(ctx, `Shady — play ${c.name} into whose pile?`);
      if (!opp) return;
      ctx.me.hand.splice(ctx.me.hand.indexOf(c), 1);
      opp.traitPile.push(c);
      const d = gpDeltaOf(c, EFFECTS);
      if (d) adjustGenePool(ctx.g, opp, d);
      ctx.say(`${ctx.me.name} played ${c.name} into ${opp.name}'s pile.`);
    },
  },

  "sleek": {
    *onPlay(ctx) {
      const hit = yield* pickTrait(ctx, myTraits(ctx, (c) => isAction(c) && c.uid !== ctx.card.uid), "Sleek — return an action trait to your hand");
      if (hit) returnTraitToHand(ctx.g, ctx.me, hit.card.uid, EFFECTS);
    },
  },

  "snuffler": {
    *onPlay(ctx) {
      const gone = discardWhere(ctx.g, ctx.me, (c) => !effectless(c));
      ctx.say(`Snuffler: ${ctx.me.name} discarded ${gone.length} card(s) with effects.`);
    },
  },

  "sprightly": {
    *onPlay(ctx) {
      const hit = yield* replayFrom(ctx, myTraits(ctx), "Sprightly — play an action from your pile (then discard it)", { optional: false });
      if (hit) yield* ctx.discardTrait(ctx.me, hit.card.uid);
    },
  },

  "stasher": {
    *onPlay(ctx) {
      const picks = yield* chooseCards(ctx, ctx.me, ctx.me.hand.slice(), { prompt: "Stasher — put up to 3 cards at the bottom of the deck?", count: 0, max: 3, optional: true });
      for (const c of picks) { ctx.me.hand.splice(ctx.me.hand.indexOf(c), 1); ctx.g.traitDeck.push(c); }
    },
  },

  "stinging tendrils": { *onPlay(ctx) { yield* swapDifferentOrSame(ctx, "different"); } },
  "swampy": { *onPlay(ctx) { ctx.drawBottom(3); ctx.say(`${ctx.me.name} drew 3 from the bottom of the deck.`); } },
  "toe beans": { *onPlay(ctx) { yield* stealTrait(ctx, (c) => faceValue(c) < 0, "Toe Beans — steal a negative trait"); } },

  "torpor": {
    *onPlay(ctx) {
      const which = ctx.me.hand.length
        ? yield* chooseOne(ctx, ctx.me, "Torpor — which?", [
          { uid: "draw", name: "Draw 2 from the bottom of the deck" }, { uid: "place", name: "Put 1 card from your hand at the bottom" }])
        : "draw";
      if (which === "draw") { ctx.drawBottom(2); return; }
      const [c] = yield* chooseCards(ctx, ctx.me, ctx.me.hand.slice(), { prompt: "Torpor — put which card at the bottom of the deck?" });
      if (c) { ctx.me.hand.splice(ctx.me.hand.indexOf(c), 1); ctx.g.traitDeck.push(c); }
    },
  },

  "trapper": {
    *onPlay(ctx) {
      const doms = ctx.g.discard.filter(isDominant);
      const picks = yield* chooseCards(ctx, ctx.me, doms, { prompt: "Trapper — put up to 5 dominants on top of the deck (first pick ends up on top)", count: 0, max: 5, optional: true, from: "discard" });
      for (const c of picks.slice().reverse()) { ctx.g.discard.splice(ctx.g.discard.indexOf(c), 1); ctx.g.traitDeck.unshift(c); }
      if (picks.length) ctx.say(`Trapper: ${picks.length} dominant(s) placed on top of the deck.`);
    },
  },

  "tricky vines": {
    *onPlay(ctx) {
      const g = ctx.g;
      const hands = g.players.map((p) => p.hand);
      g.players.forEach((p, i) => { rightOf(g, p).hand = hands[i]; });
      ctx.say("Tricky Vines: every hand passed to the right.");
      ctx.grantPlay(1);
    },
  },

  "vagabond": {
    *onPlay(ctx) {
      const played = [];
      for (const opp of ctx.opponents()) {
        const ok = opp.hand.filter((c) => !isDominant(c) && canPlayCard(ctx.g, opp, c, EFFECTS));
        const [c] = yield* chooseCards(ctx, opp, ok, { prompt: `Vagabond — ${opp.name}, play 1 trait (no dominants, action ignored)` });
        if (c && (yield* playTraitInner(ctx.g, opp, c.uid, EFFECTS, { ignoreAction: true, free: true }))) played.push({ player: opp, card: c });
      }
      const stealable = played.filter(({ player, card }) => player.traitPile.includes(card));
      const which = stealable.length
        ? yield* chooseOne(ctx, ctx.me, "Vagabond — steal or play?", [
          { uid: "steal", name: "Steal 1 of those traits" }, { uid: "play", name: "Play an additional trait" }])
        : "play";
      if (which === "steal") {
        const hit = yield* pickTrait(ctx, stealable, "Vagabond — steal which trait?");
        if (hit) moveTrait(ctx.g, hit.player, ctx.me, hit.card.uid, EFFECTS);
      } else ctx.grantPlay(1);
    },
  },

  "wanderlust": {
    *onPlay(ctx) {
      const [a] = ctx.draw(1);
      if (a && (yield* mayPlay(ctx, [a], { label: `Wanderlust — play ${a.name} now? (or draw from the bottom)` }))) return;
      const [b] = ctx.drawBottom(1);
      if (b) yield* mayPlay(ctx, [b], { label: `Wanderlust — play ${b.name} now?` });
    },
  },

  "willow": {
    *onPlay(ctx) {
      ctx.draw(3);
      const picks = yield* chooseCards(ctx, ctx.me, ctx.me.hand.slice(), { prompt: "Willow — put 3 cards at the bottom of the deck", count: 3, max: 3 });
      for (const c of picks) { ctx.me.hand.splice(ctx.me.hand.indexOf(c), 1); ctx.g.traitDeck.push(c); }
    },
  },

  "woolly": {
    *onPlay(ctx) {
      const g = ctx.g;
      const top = g.traitDeck.shift();
      if (!top) return;
      g.discard.unshift(top);
      const cols = coloursOf(top);
      for (const p of ctx.playersInOrder()) {
        discardWhere(g, p, (c) => cols.some((col) => hasColour(c, col)));
        stabilizeNow(g, p, ctx.card);
      }
      ctx.say(`Woolly turned over ${top.name}: everyone discarded ${cols.join("/").toLowerCase()} cards and stabilized.`);
    },
  },

  "contagious": {
    *onPlay(ctx) { yield* swapSelfWith(ctx, (c) => hasColour(c, "Red"), "Contagious — swap with a red trait"); },
    *score(ctx) { return -pileColourCount(ctx.me, "Green"); },
  },
  "noxious": {
    *onPlay(ctx) { yield* swapSelfWith(ctx, (c) => hasColour(c, "Purple"), "Noxious — swap with a purple trait"); },
    *score(ctx) { return -pileColourCount(ctx.me, "Red"); },
  },
  "bottomfeeder": {
    gpDelta: +2,
    *onPlay(ctx) { adjustGenePool(ctx.g, ctx.me, +2); ctx.drawBottom(2); },
  },
  "infectious": {
    gpDelta: -1,
    *onPlay(ctx) {
      adjustGenePool(ctx.g, ctx.me, -1);
      yield* swapSelfWith(ctx, (c) => hasColour(c, "Blue"), "Infectious — swap with a blue trait");
    },
  },
  "toxic": {
    *onPlay(ctx) { yield* swapSelfWith(ctx, (c) => hasColour(c, "Green"), "Toxic — swap with a green trait"); },
    *onLeave(ctx, ev) { if (ev.how === "discard") { ctx.draw(2); ctx.say(`Toxic was discarded — ${ctx.me.name} drew 2.`); } },
  },

  /* ================= Dominants ================= */
  "fierce": {
    *onPlay(ctx) {
      for (let k = 0; k < 2; k++) {
        const hit = yield* pickTrait(ctx, myTraits(ctx, (c) => c.uid !== ctx.card.uid), "Fierce — discard a trait to draw 2?", true);
        if (!hit || !(yield* ctx.discardTrait(ctx.me, hit.card.uid))) break;
        ctx.draw(2);
      }
    },
  },

  "hive mind": {
    *onPlay(ctx) {
      for (let k = 0; k < 2; k++) {
        const mine = yield* pickTrait(ctx, myTraits(ctx, (c) => faceValue(c) > 0), "Hive Mind — swap which of your positive traits?", true);
        if (!mine) break;
        const theirs = yield* pickTrait(ctx, opponentTraits(ctx), `Hive Mind — swap ${mine.card.name} for which trait?`);
        if (!theirs) break;
        moveTrait(ctx.g, theirs.player, ctx.me, theirs.card.uid, EFFECTS);
        moveTrait(ctx.g, ctx.me, theirs.player, mine.card.uid, EFFECTS);
        ctx.say(`${ctx.me.name} swapped ${mine.card.name} for ${theirs.card.name}.`);
      }
    },
  },

  "big feller": { *score(ctx) { return ctx.me.traitPile.filter((c) => faceValue(c) <= 1).length <= 4 ? 6 : 0; } },
  "harmony": { *score(ctx) { return 2 * Math.min(...COLOURS4.map((c) => pileColourCount(ctx.me, c))); } },
  "nuptial plumage": { *score(ctx) { return 2 * COLOURS4.filter((c) => pileColourCount(ctx.me, c) >= 3).length; } },
  "prowler": {
    *scoreOthers(ctx) {
      const out = {};
      for (const opp of ctx.opponents()) {
        const n = COLOURS4.filter((c) => pileColourCount(opp, c) < pileColourCount(ctx.me, c)).length;
        if (n) out[opp.id] = -2 * n;
      }
      return out;
    },
  },
  "lily pad": {
    worldsEnd: true,
    *onWorldsEnd(ctx) {
      let n = 0;
      for (let k = 0; k < 3; k++) {
        const hit = yield* pickTrait(ctx, myTraits(ctx, (c) => c.uid !== ctx.card.uid), "Lily Pad — return a trait to your hand for +1?", true);
        if (!hit || !returnTraitToHand(ctx.g, ctx.me, hit.card.uid, EFFECTS)) break;
        n++;
      }
      ctx.me.flags.lilyPad = n;
    },
    *score(ctx) { return ctx.me.flags.lilyPad || 0; },
  },
  "constrictor": {
    *onPlay(ctx) { for (const p of ctx.opponents()) adjustGenePool(ctx.g, p, -1); ctx.say("Constrictor: every opponent's gene pool -1."); },
  },
  "indomitable": genePool(-2),
  "mutualism": {
    *onPlay(ctx) { for (const p of ctx.opponents()) adjustGenePool(ctx.g, p, +1); ctx.say("Mutualism: every opponent's gene pool +1."); },
    *score(ctx) { return Math.max(...ctx.g.players.map((p) => p.genePool)); },
  },
  "apricity": { /* core: mayskipStabilize */ },
  "ironwood": { /* core: shieldOf */ },
  "meek": { /* core: shieldOf */ },
  "ravenous": { /* core: playTraitInner */ },
  "scavenger": { /* core: beforeStabilize */ },
  "whistler": { /* core: beforeStabilize */ },

  "harrier": {
    *afterStabilize(ctx) {
      const plain = ctx.me.hand.filter(effectless);
      if (!plain.length) return;
      const [c] = yield* chooseCards(ctx, ctx.me, plain, { prompt: "Harrier — discard an effectless card to draw 3?", optional: true });
      if (c && discardFromHand(ctx.g, ctx.me, c.uid)) ctx.draw(3);
    },
  },

  "mimicry": {
    *afterStabilize(ctx) {
      if ((ctx.g.turnPlays || []).length !== 1) return;
      yield* mayPlay(ctx, ctx.me.hand.slice(), { filter: (c) => faceValue(c) === 1, label: "Mimicry — play a face value 1 trait? (action ignored)", ignoreAction: true });
    },
  },

  "skimmer": {
    *onTraitPlayed(ctx, ev) {
      if (!ev.actor || ev.actor.id !== ctx.me.id || !ev.card || ev.card.uid === ctx.card.uid) return;
      if (!effectless(ev.card) || ctx.g.skimmerUsed) return;
      if (!myTraits(ctx, isAction).length) return;
      ctx.g.skimmerUsed = true;
      yield* replayFrom(ctx, myTraits(ctx), "Skimmer — replay an action from your pile?");
    },
  },

  "patches": {
    reactive: {
      window: "traitRemoved",
      eligible: (g, holder, ev) => ev.owner && ev.owner.id === holder.id && !(ev.by && ev.by.dominant) &&
        !holder.traitPile.some((c) => c.uid === ev.card.uid),
      *respond(ctx, ev) {
        const at = findAnywhere(ctx.g, ev.card.uid);
        if (!at) return;
        const card = at.list.splice(at.i, 1)[0];
        if (at.where === "traitPile") {
          if (isDominant(card)) at.player.dominants--;
          const d = gpDeltaOf(card, EFFECTS); if (d) adjustGenePool(ctx.g, at.player, -d);
        }
        ctx.me.traitPile.push(card);
        const d = gpDeltaOf(card, EFFECTS); if (d) adjustGenePool(ctx.g, ctx.me, d);
        ctx.say(`Patches: ${card.name} returned to ${ctx.me.name}'s trait pile.`);
      },
    },
  },

  "snap-trap": {
    reactive: {
      window: "traitPlayed",
      eligible: (g, holder, ev) => ev.actor && ev.actor.id !== holder.id && g.activeSeat === ev.actor.id && (g.turnPlays || []).length >= 2,
      *respond(ctx, ev) {
        const uids = new Set(ctx.g.turnPlays || []);
        const hit = yield* pickTrait(ctx, ev.actor.traitPile.filter((c) => uids.has(c.uid)).map((card) => ({ player: ev.actor, card })), "Snap-Trap — steal which of those traits?");
        if (hit && moveTrait(ctx.g, ev.actor, ctx.me, hit.card.uid, EFFECTS)) ctx.say(`Snap-Trap: ${ctx.me.name} stole ${hit.card.name}.`);
      },
    },
  },

  "elusive": {
    canPlay: notOnYourTurn,
    reactive: {
      window: ["traitPlayed", "afterAge", "traitRemoved"],
      eligible: (g, holder, ev, card) => card.enteredAt === (g.clock || 0) && (card.enteredByAge || !ownTurn(g, holder)),
    },
  },

  "muse": { canPlay: notOnYourTurn /* playing it on discard: core discardFromHand */ },

  "opposable thumbs": {
    canPlay: (g, p) => p.traitPile.some(isDominant),
    *onPlay(ctx) {
      const doms = myTraits(ctx, (c) => isDominant(c) && c.uid !== ctx.card.uid);
      if (!doms.length) return;
      const hit = doms.length === 1 ? doms[0] : yield* pickTrait(ctx, doms, "Opposable Thumbs — copy which dominant?", false, false);
      if (!hit) return;
      const src = hit.card;
      Object.assign(ctx.card, { copyOf: src.name, points: src.points, color: src.color });
      ctx.say(`Opposable Thumbs is now a copy of ${src.name}.`);
      const h = EFFECTS[norm(src.name)];
      if (h && h.gpDelta) adjustGenePool(ctx.g, ctx.me, h.gpDelta);
      if (h && h.onPlay) yield* h.onPlay(ctx);
    },
    *score(ctx) { const h = ctx.card.copyOf && EFFECTS[norm(ctx.card.copyOf)]; return h && h.score ? yield* h.score(ctx) : 0; },
    *scoreOthers(ctx) { const h = ctx.card.copyOf && EFFECTS[norm(ctx.card.copyOf)]; return h && h.scoreOthers ? yield* h.scoreOthers(ctx) : {}; },
    *onWorldsEnd(ctx) { const h = ctx.card.copyOf && EFFECTS[norm(ctx.card.copyOf)]; if (h && h.onWorldsEnd) yield* h.onWorldsEnd(ctx); },
    *onTurnStart(ctx) { const h = ctx.card.copyOf && EFFECTS[norm(ctx.card.copyOf)]; if (h && h.onTurnStart) yield* h.onTurnStart(ctx); },
    *afterStabilize(ctx) { const h = ctx.card.copyOf && EFFECTS[norm(ctx.card.copyOf)]; if (h && h.afterStabilize) yield* h.afterStabilize(ctx); },
  },

  "epic": {
    canPlay: (g, p) => p.dominants === 0,
    *onPlay(ctx) { ctx.me.dominants = Math.max(ctx.me.dominants, RULES.dominantLimit); ctx.say("Epic fills both dominant slots."); },
  },

  "metamorphosis": {
    canPlay: (g, p) => p.traitPile.filter((c) => faceValue(c) >= 1 && !isLocked(p, c)).length >= 3,
    *cost(ctx) {
      for (let k = 0; k < 3; k++) {
        const hit = yield* pickTrait(ctx, myTraits(ctx, (c) => faceValue(c) >= 1), `Metamorphosis — discard trait ${k + 1} of 3 (face value 1+)`);
        if (!hit) return false;
        yield* ctx.discardTrait(ctx.me, hit.card.uid);
      }
      return true;
    },
  },

  "fabled": {
    gpDelta: +1,
    canPlay: (g, p, card) => COLOURS4.filter((col) => p.hand.some((c) => c.uid !== card.uid && hasColour(c, col))).length >= 4,
    *cost(ctx) {
      const used = new Set();
      for (let k = 0; k < 4; k++) {
        const ok = ctx.me.hand.filter((c) => c.uid !== ctx.card.uid && coloursOf(c).some((col) => COLOURS4.includes(col) && !used.has(col)));
        const [c] = yield* chooseCards(ctx, ctx.me, ok, { prompt: `Fabled — discard a card of a new colour (${k + 1} of 4)` });
        if (!c) return false;
        coloursOf(c).filter((col) => !used.has(col)).slice(0, 1).forEach((col) => used.add(col));
        discardFromHand(ctx.g, ctx.me, c.uid);
      }
      return true;
    },
    *onPlay(ctx) { adjustGenePool(ctx.g, ctx.me, +1); },
  },

  "blossom": {
    worldsEnd: true,
    *onWorldsEnd(ctx) {
      ctx.draw(4);
      yield* mayPlay(ctx, ctx.me.hand.slice(), { label: "Blossom — play 1 card from your hand? (its action resolves)" });
    },
  },

  "chompers": {
    worldsEnd: true,
    *onWorldsEnd(ctx) {
      let n = 0;
      for (const opp of ctx.opponents()) {
        const pool = opp.traitPile.filter((c) => effectless(c) && !isLocked(opp, c));
        if (!pool.length) continue;
        const victim = pool[Math.floor(ctx.g.rng() * pool.length)];
        if (yield* ctx.discardTrait(opp, victim.uid)) { n++; ctx.say(`Chompers: ${opp.name} discarded ${victim.name}.`); }
      }
      if (n) ctx.draw(n);
    },
  },

  "nectar": {
    worldsEnd: true,
    *onWorldsEnd(ctx) {
      const colour = yield ctx.ask.colour({ playerId: ctx.me.id, prompt: "Nectar — choose a colour for your opponents" });
      for (const opp of ctx.opponents()) {
        const ok = opp.hand.filter((c) => hasColour(c, colour) && !isDominant(c));
        const [c] = yield* chooseCards(ctx, opp, ok, { prompt: `Nectar — ${opp.name}, play a ${String(colour).toLowerCase()} trait? (action ignored)`, optional: true });
        if (c) yield* playTraitInner(ctx.g, opp, c.uid, EFFECTS, { ignoreAction: true, free: true });
      }
    },
  },

  "pyrophyte": {
    worldsEnd: true,
    *onWorldsEnd(ctx) {
      const drawn = ctx.draw(4);
      for (let k = 0; k < 4; k++) {
        const played = yield* mayPlay(ctx, drawn, { filter: (c) => faceValue(c) <= 2, label: "Pyrophyte — play a face value 2-or-lower card? (action ignored)", ignoreAction: true });
        if (!played) break;
      }
    },
  },

  "spots": {
    worldsEnd: true,
    *onWorldsEnd(ctx) {
      const colour = yield ctx.ask.colour({ playerId: ctx.me.id, prompt: "Spots — choose a colour; opponents reveal it" });
      const shown = ctx.opponents().flatMap((p) => p.hand.filter((c) => hasColour(c, colour)).map((card) => ({ player: p, card })));
      if (!shown.length) { ctx.say(`Spots: nobody held a ${String(colour).toLowerCase()} card.`); return; }
      const res = yield ctx.ask.trait({
        playerId: ctx.me.id, prompt: "Spots — play one of the revealed cards (action ignored)",
        options: shown.map(({ player, card }) => ({ playerId: player.id, uid: card.uid, name: card.name })),
      });
      const hit = shown.find((s) => s.card.uid === (res && res.uid)) || shown[0];
      takeFromHand(hit.player, ctx.me, hit.card.uid);
      yield* ctx.playNow(hit.card.uid, { ignoreAction: true });
    },
  },

  /* ================= Drop of Life ================= */
  "backbiter": { *score(ctx) { return ctx.me.traitPile.some((c) => faceValue(c) < 0) ? 3 : 0; } },
  "bitter berries": minPair("Purple", "Green"),
  "sour grapes": minPair("Blue", "Red"),
  "spicy": minPair("Red", "Green"),
  "sweet": minPair("Green", "Blue"),
  "euphoric": ifAtLeast("Purple", 4, 6),
  "prolific": ifAtLeast("Green", 4, 6),
  "tenacious": ifAtLeast("Red", 4, 6),
  "vivacious": ifAtLeast("Blue", 4, 6),
  "shy": { *score(ctx) { return COLOURS4.every((c) => pileColourCount(ctx.me, c) >= 2) ? 5 : 0; } },
  "sycophant": { *score(ctx) { return ctx.opponents().some((p) => pileColourCount(p, "Red") >= 5) ? 5 : 0; } },

  /* ================= Gene Pool ================= */
  "filter feeder": genePool(+1),
  "cap": {
    ...genePool(+1),
    *onLeave(ctx, ev) { if (ev.how === "discard") { ctx.draw(3); ctx.say(`Cap was discarded — ${ctx.me.name} drew 3.`); } },
  },
  "spores": {
    *onLeave(ctx, ev) { if (ev.how === "discard" && adjustGenePool(ctx.g, ctx.me, +1)) ctx.say(`Spores was discarded — ${ctx.me.name}'s gene pool +1.`); },
  },
  "citrus": { ...genePool(+2), canPlay: (g, p) => p.traitPile.some((c) => faceValue(c) < 0) },
  "silk": { ...genePool(+2), canPlay: (g, p) => p.genePool <= 4 },
  "xylophage": {
    ...genePool(+1),
    canPlay: (g, p) => p.traitPile.some((c) => hasColour(c, "Green") && !isLocked(p, c)),
    *cost(ctx) {
      const hit = yield* pickTrait(ctx, myTraits(ctx, (c) => hasColour(c, "Green")), "Xylophage — discard a green trait to play");
      if (!hit) return false;
      yield* ctx.discardTrait(ctx.me, hit.card.uid);
      return true;
    },
  },

  /* ================= Persistent ================= */
  "fleshy scales": {
    *onLeave(ctx) { ctx.draw(1); ctx.say(`Fleshy Scales left ${ctx.me.name}'s pile — they drew 1.`); },
  },
  "mycelium": {
    *onLeave(ctx, ev) {
      if (!ev.ownTurn || !ctx.g.discard.length) return;
      const top = ctx.g.discard[0];
      if (!isTrait(top) || !canPlayCard(ctx.g, ctx.me, top, EFFECTS)) return;
      const yes = yield ctx.ask.confirm({ playerId: ctx.me.id, prompt: `Mycelium — play ${top.name} from the top of the discard pile?` });
      if (!yes) return;
      ctx.g.discard.shift();
      ctx.me.hand.push(top);
      yield* ctx.playNow(top.uid);
    },
  },
  "mycotoxins": {
    *onLeave(ctx, ev) {
      if (ev.how !== "discard") return;
      for (const p of ctx.playersInOrder()) {
        for (const c of randomCardsFromHand(ctx.g, p, 2)) discardFromHand(ctx.g, p, c.uid);
        stabilizeNow(ctx.g, p, ctx.card);
      }
      ctx.say("Mycotoxins: everyone discarded 2 at random and stabilized.");
    },
  },
  "seedwing": {
    ability: {
      from: "pile", ownTurn: true, label: "Discard Seedwing to play another trait",
      eligible: (g, p) => !lonelyBlocks(g, p) && p.hand.length > 0,
      *use(ctx) {
        if (!(yield* ctx.discardTrait(ctx.me, ctx.card.uid))) return;
        yield* mayPlay(ctx, ctx.me.hand.slice(), { label: "Seedwing — play another trait (action ignored)", ignoreAction: true });
      },
    },
  },
  "adrenalized": {
    *onTurnStart(ctx) { if (ctx.me.hand.length <= 2) { ctx.draw(4); ctx.say(`Adrenalized: ${ctx.me.name} drew 4.`); } },
  },
  "motion dazzle": {
    ...genePool(+1),
    reactive: {
      window: "traitRemoved",
      eligible: (g, holder, ev) => ev.owner && ev.owner.id === holder.id,
      *respond(ctx) { adjustGenePool(ctx.g, ctx.me, +1); },
    },
  },

  /* ================= Play When ================= */
  "booster": {
    ability: playFreeAbility,
    reactive: { window: ANY_TIME, *respond(ctx) { ctx.restabilize(); } },
    *onPlay(ctx) { ctx.restabilize(); },
  },
  "trippy": {
    ability: playFreeAbility,
    reactive: { window: ANY_TIME, *respond(ctx) { ctx.draw(3); } },
    *onPlay(ctx) { ctx.draw(3); },
  },
  "lucky": {
    ability: playFreeAbility,
    reactive: { window: ANY_TIME },
  },
  "firebite": {
    reactive: {
      window: "afterStabilize",
      eligible: (g, holder, ev) => ev.actor && ev.actor.id === holder.id,
      *respond(ctx) {
        for (const opp of ctx.opponents()) {
          const [c] = randomCardsFromHand(ctx.g, opp, 1);
          if (c) takeFromHand(opp, ctx.me, c.uid);
        }
        ctx.say(`Firebite: ${ctx.me.name} stole a random card from each opponent.`);
      },
    },
  },
  "nimble": {
    ability: {
      from: "hand", ownTurn: true, label: "Discard Nimble to discard one of your traits",
      eligible: (g, p) => p.traitPile.some((c) => !isLocked(p, c)),
      *use(ctx) {
        const hit = yield* pickTrait(ctx, myTraits(ctx), "Nimble — discard which trait from your pile?", true);
        if (!hit) return;
        discardFromHand(ctx.g, ctx.me, ctx.card.uid);
        yield* ctx.discardTrait(ctx.me, hit.card.uid);
      },
    },
  },
  "pinchy": {
    reactive: {
      window: "traitPlayed",
      eligible: (g, holder, ev) => ev.actor && ev.actor.id !== holder.id,
      *respond(ctx, ev) {
        ev.cancelled = true;
        const at = ev.actor.traitPile.findIndex((c) => c.uid === ev.card.uid);
        if (at >= 0 && !isLocked(ev.actor, ev.card)) {
          ev.actor.traitPile.splice(at, 1);
          const d = gpDeltaOf(ev.card, EFFECTS); if (d) adjustGenePool(ctx.g, ev.actor, -d);
          ctx.me.hand.push(ev.card);
          noteLeft(ctx.g, ev.actor, ev.card, "move", ctx.me);
          ctx.say(`Pinchy: ${ctx.me.name} took ${ev.card.name} into their hand.`);
        }
        if (ctx.g.activeSeat === ev.actor.id && ctx.g.phase === "turn") makeCtx(ctx.g, ev.actor, ev.card, EFFECTS).grantPlay(1);
      },
    },
  },
  "procrastination": {
    reactive: {
      window: "roundEnd",
      eligible: (g) => !g.inExtraTurn && g.extraTurnFor == null,
      *respond(ctx) { ctx.g.extraTurnFor = ctx.me.id; ctx.say(`${ctx.me.name} will take another turn this age.`); },
    },
  },
  "quills": {
    reactive: {
      window: "traitRemoved",
      eligible: (g, holder, ev) => ev.owner && ev.owner.id === holder.id && ev.by && ev.by.playerId != null && ev.by.playerId !== holder.id,
      intoPile: (g, holder, ev) => g.players.find((p) => p.id === ev.by.playerId),
    },
  },
  "sleepy": {
    reactive: {
      window: "catastrophe",
      *respond(ctx) { ctx.me.flags.sleepyRound = ctx.g.round; },
    },
  },
  "dart": {
    canPlay: notOnYourTurn,
    reactive: {
      window: "traitRemoved",
      eligible: (g, holder, ev) => ev.owner && ev.owner.id === holder.id && ev.by && ev.by.playerId != null && ev.by.playerId !== holder.id,
    },
  },
  "super sneaky": {
    canPlay: notOnYourTurn,
    worldsEnd: true,
    reactive: { window: "worldsEnd" },
  },
});

/* The Living Library's replay ("Before you stabilize, you may replay an action
   in your trait pile"), called from core's beforeStabilize. */
EFFECTS.__replay = function* (ctx, prompt) {
  const acts = myTraits(ctx, (c) => isAction(c) && EFFECTS[norm(c.name)] && EFFECTS[norm(c.name)].onPlay);
  if (!acts.length) return;
  const hit = yield* pickTrait(ctx, acts, prompt, true, false);
  if (hit) yield* runActionOf({ ...ctx, card: hit.card }, hit.card);
};

/* ================================================================== *
 * Ages
 * ================================================================== */
const mayDiscardAll = (colour) => ({
  *each(ctx) {
    const n = handColourCount(ctx.me, colour);
    if (!n) return;
    const yes = yield ctx.ask.confirm({ playerId: ctx.me.id, prompt: `${ctx.card.name} — discard all ${n} ${colour.toLowerCase()} card${n === 1 ? "" : "s"} from your hand?` });
    if (yes) discardWhere(ctx.g, ctx.me, (c) => hasColour(c, colour));
  },
});

Object.assign(AGES, {
  "age of adventure": {
    *each(ctx) {
      const gone = yield* chooseCards(ctx, ctx.me, ctx.me.hand.slice(), { prompt: "Age of Adventure — discard up to 4 cards", count: 0, max: 4, optional: true });
      const cols = new Set(gone.flatMap(coloursOf));
      for (const c of gone) discardFromHand(ctx.g, ctx.me, c.uid);
      const [d] = ctx.draw(1);
      if (d && !isDominant(d) && coloursOf(d).some((c) => cols.has(c))) {
        yield* mayPlay(ctx, [d], { label: `Age of Adventure — play ${d.name} now? (action ignored)`, ignoreAction: true });
      }
    },
  },
  "age of certainty": { restrict: { deckFlipped: true } },
  "age of discovery": { *each(ctx) { ctx.draw(3); ctx.say(`${ctx.me.name} drew 3 from Age of Discovery.`); } },
  "age of doubt": { restrict: { noNegative: true } },
  "age of envy": { restrict: { envy: true } },
  "backwoods melodies": {
    *each(ctx) {
      for (const c of ctx.me.hand.filter((x) => faceValue(x) < 0 && !isDominant(x))) {
        if (inHand(ctx.me, c.uid)) yield* ctx.playNow(c.uid, { ignoreAction: true });
      }
    },
  },
  "cleansing rains": {
    *each(ctx) {
      const gone = yield* chooseCards(ctx, ctx.me, ctx.me.hand.slice(), { prompt: "Cleansing Rains — discard any number of cards", count: 0, max: ctx.me.hand.length, optional: true });
      for (const c of gone) discardFromHand(ctx.g, ctx.me, c.uid);
    },
  },
  "crackletown": {
    *each(ctx) {
      const left = leftOf(ctx.g, ctx.me);
      if (left === ctx.me) return;
      const colour = yield ctx.ask.colour({ playerId: ctx.me.id, prompt: `Crackletown — which colour should ${left.name} pass you?` });
      const ok = left.hand.filter((c) => hasColour(c, colour));
      const [c] = yield* chooseCards(ctx, left, ok, { prompt: `Crackletown — ${left.name}, pass a ${String(colour).toLowerCase()} card to ${ctx.me.name}` });
      if (c) takeFromHand(left, ctx.me, c.uid);
    },
  },
  "dueling moons": {
    *each(ctx) {
      const which = ctx.me.hand.length
        ? yield* chooseOne(ctx, ctx.me, "Dueling Moons — which?", [
          { uid: "draw", name: "Draw 1 from the bottom of the deck" }, { uid: "top", name: "Put 1 card from your hand on top of the deck" }])
        : "draw";
      if (which === "draw") { ctx.drawBottom(1); return; }
      const [c] = yield* chooseCards(ctx, ctx.me, ctx.me.hand.slice(), { prompt: "Dueling Moons — put which card on top of the deck?" });
      if (c) { ctx.me.hand.splice(ctx.me.hand.indexOf(c), 1); ctx.g.traitDeck.unshift(c); }
    },
  },
  "glimmering gardens": {
    *each(ctx) {
      const hit = yield* pickTrait(ctx, myTraits(ctx), "Glimmering Gardens — discard a trait from your pile?", true);
      if (hit) yield* ctx.discardTrait(ctx.me, hit.card.uid);
    },
  },
  "harlequin falls": {
    *each(ctx) {
      const colour = yield ctx.ask.colour({ playerId: ctx.me.id, prompt: "Harlequin Falls — choose a colour to keep" });
      const drawn = ctx.draw(3);
      for (const c of drawn) if (!hasColour(c, colour)) discardFromHand(ctx.g, ctx.me, c.uid);
      ctx.say(`Harlequin Falls: ${ctx.me.name} kept ${drawn.filter((c) => hasColour(c, colour)).length} of 3.`);
    },
  },
  "king of the jungle": {
    *each(ctx) {
      if (!ctx.me.hand.length) return;
      const shown = [];
      for (const p of ctx.playersInOrder()) {
        const [c] = yield* chooseCards(ctx, p, p.hand.slice(), { prompt: `King of the Jungle — ${p.name}, reveal 1 card (highest face value wins)` });
        if (c) shown.push({ p, v: faceValue(c), name: c.name });
      }
      const mine = shown.find((s) => s.p === ctx.me);
      const best = Math.max(...shown.map((s) => s.v));
      const win = mine && mine.v === best && shown.filter((s) => s.v === best).length === 1;
      const summary = shown.map((s) => `${s.p.name}: ${s.name} (${s.v})`).join(", ");
      if (!win) { discardHand(ctx.g, ctx.me); ctx.draw(3); }
      yield ctx.ask.confirm({ playerId: ctx.me.id, acknowledge: true, prompt: `King of the Jungle — ${summary}. ${win ? "You keep your cards." : "You discard your hand and draw 3."}` });
    },
  },
  "lingering shadows": { restrict: { noMulti: true } },
  "lunar advance": mayDiscardAll("Purple"),
  "misty groves": mayDiscardAll("Green"),
  "rainstorms": mayDiscardAll("Blue"),
  "summer solstice": mayDiscardAll("Red"),
  "nostalgia": {
    *each(ctx) {
      const hit = yield* pickTrait(ctx, myTraits(ctx), "Nostalgia — return a trait to your hand?", true);
      if (hit) returnTraitToHand(ctx.g, ctx.me, hit.card.uid, EFFECTS);
    },
  },
  "ramblin' river markets": {
    *onReveal(ctx) {
      const g = ctx.g;
      g.colourBans = { round: g.round, by: {} };
      for (const p of playersFrom(g, g.firstSeat)) {
        const colour = yield ctx.ask.colour({ playerId: p.id, prompt: `Ramblin' River Markets — ${p.name}, ban a colour for you and ${leftOf(g, p).name}`, options: COLOURS });
        if (!colour) continue;
        for (const who of [p, leftOf(g, p)]) (g.colourBans.by[who.id] ||= []).push(colour);
        say(g, `${p.name} banned ${colour.toLowerCase()} for themselves and ${leftOf(g, p).name}.`);
      }
    },
  },
  "rustling meadows": {
    *each(ctx) {
      const [c] = yield* chooseCards(ctx, ctx.me, ctx.me.hand.slice(), { prompt: "Rustling Meadows — discard 1 to draw 1?", optional: true });
      if (c && discardFromHand(ctx.g, ctx.me, c.uid)) ctx.draw(1);
    },
  },
  "slumberwood": { restrict: { noDominant: true } },
  "star tails": {
    *each(ctx) {
      ctx.draw(3);
      ctx.g.noDrawFor = ctx.me.id;
      ctx.say(`${ctx.me.name} drew 3 and can't draw again this turn (Star Tails).`);
    },
  },
  "swamplands": { restrict: { discardPlayedActions: true } },
  "tangled canopies": {
    *onReveal(ctx) {
      ctx.g.traitDeck = shuffle(ctx.g.traitDeck.concat(ctx.g.discard), ctx.g.rng);
      ctx.g.discard = [];
      ctx.say("Tangled Canopies: the discard pile was shuffled into the deck.");
    },
  },
  "the legend of mokoko village": {
    *each(ctx) {
      ctx.draw(1);
      if (!ctx.me.traitPile.some((c) => norm(c.name) === "heroic")) return;
      const yes = yield ctx.ask.confirm({ playerId: ctx.me.id, prompt: "Mokoko Village — play 2 traits this turn, ignoring their actions?" });
      if (yes) { ctx.g.ignoreActionsFor = ctx.me.id; ctx.grantPlay(1); }
    },
  },
  "the living library": { restrict: { replayBeforeStabilize: true } },
  "the painted valley": {
    *each(ctx) {
      const colour = yield ctx.ask.colour({ playerId: ctx.me.id, prompt: "The Painted Valley — guess a colour, then draw 1" });
      const [c] = ctx.draw(1);
      if (c && hasColour(c, colour)) {
        for (const opp of ctx.opponents()) drawMany(ctx.g, opp, 1);
        ctx.say(`The Painted Valley: ${ctx.me.name} drew ${c.name} — every opponent draws 1.`);
      }
    },
  },
  "the stranger": {
    *each(ctx) {
      const [c] = ctx.draw(1);
      if (c && !isDominant(c)) yield* mayPlay(ctx, [c], { label: `The Stranger — play ${c.name} now? (action ignored)`, ignoreAction: true });
    },
  },
});

/* ================================================================== *
 * Catastrophes
 * ================================================================== */
/** World's End scoring helpers. */
const weEach = (fn) => ({
  *weScore(ctx) {
    const out = {};
    for (const p of ctx.g.players) { const d = fn(ctx.g, p); if (d) out[p.id] = d; }
    return out;
  },
});
const weLeftColour = (colour) => weEach((g, p) => pileColour(leftOf(g, p), colour));
const weFewColour = (colour) => weEach((g, p) => (pileColour(p, colour) <= 2 ? -4 : 0));

Object.assign(CATASTROPHES, {
  "algal superbloom": {
    gp: 0,
    *each(ctx) { const n = ctx.me.traitPile.filter((c) => faceValue(c) < 0).length; if (n) ctx.draw(n); },
    ...weLeftColour("Blue"),
  },
  "ancient corruption": {
    gp: -1,
    *each(ctx) { discardWhere(ctx.g, ctx.me, isAction); },
    ...weEach((g, p) => -p.traitPile.filter(isAction).length),
  },
  "ashlands": {
    gp: -1,
    *each(ctx) { discardWhere(ctx.g, ctx.me, (c) => hasColour(c, "Purple") || hasColour(c, "Blue")); ctx.restabilize(); },
    ...weFewColour("Purple"),
  },
  // "Ignore blue and green actions" has nothing to act on: the era ends on a
  // catastrophe, so no trait is played while it is face up.
  "choking vines": { gp: -1, ...weLeftColour("Green") },
  "jungle rot": { gp: -1, ...weFewColour("Green") },
  "ecological collapse": {
    gp: -1,
    *each(ctx) {
      const n = presentColours(ctx.me).length;
      if (n) yield* discardChosen(ctx, ctx.me, n, `Ecological Collapse — discard ${n} (1 for each colour in your pile)`);
    },
    ...weEach((g, p) => 2 * p.traitPile.filter((c) => faceValue(c) < 0).length),
  },
  "endless monsoon": { gp: -1, onReveal: passColourRight("Purple"), ...weEach((g, p) => -p.hand.length) },
  "great deluge": { gp: -1, onReveal: passColourRight("Blue"), ...weFewColour("Blue") },
  "invasive species": {
    gp: -1,
    onReveal: passColourRight("Green"),
    *worldsEnd(ctx) {
      for (const p of ctx.playersInOrder()) {
        const ok = p.hand.filter((c) => faceValue(c) <= 7);
        const [c] = yield* chooseCards(ctx, p, ok, { prompt: `Invasive Species — ${p.name}, discard a card (face value 7 or less) to add it to your score` });
        if (c && discardFromHand(ctx.g, p, c.uid)) p.invasiveBonus = faceValue(c);
      }
    },
    ...weEach((g, p) => p.invasiveBonus || 0),
  },
  "planetary deforestation": {
    gp: -1,
    *each(ctx) { discardWhere(ctx.g, ctx.me, (c) => hasColour(c, "Green") || hasColour(c, "Red")); ctx.restabilize(); },
    ...weEach((g, p) => -p.genePool),
  },
  "sacrifice": {
    gp: -1,
    *each(ctx) {
      const hit = yield* pickTrait(ctx, myTraits(ctx, (c) => faceValue(c) > 0), `Sacrifice — ${ctx.me.name}, return a positive trait to your hand`);
      if (hit) returnTraitToHand(ctx.g, ctx.me, hit.card.uid, EFFECTS);
    },
    ...weFewColour("Red"),
  },
  "strange matter": { gp: -1, onReveal: passColourRight("Red"), ...weEach((g, p) => -2 * p.traitPile.filter(isDoL).length) },
  "tragedy of the commons": {
    gp: -1,
    *each(ctx) {
      const cols = COLOURS.filter((c) => handColourCount(ctx.me, c) > 0);
      if (!cols.length) return;
      const keep = yield ctx.ask.colour({ playerId: ctx.me.id, prompt: "Tragedy of the Commons — keep which colour? (discard the rest)", options: cols });
      discardWhere(ctx.g, ctx.me, (c) => !hasColour(c, keep || cols[0]));
    },
    *worldsEnd(ctx) {
      for (const p of ctx.playersInOrder()) {
        const doms = p.traitPile.filter((c) => isDoL(c) && !isLocked(p, c));
        if (!doms.length) continue;
        const hit = yield* pickTrait(ctx, doms.map((card) => ({ player: p, card })), `Tragedy of the Commons — ${p.name}, discard a Drop of Life trait`, false, true, p.id);
        if (hit) yield* ctx.discardTrait(p, hit.card.uid);
      }
    },
  },
  "tropical superstorm": { gp: -1, onReveal: passColourRight("Colorless"), ...weLeftColour("Purple") },
  "volcanic winter": {
    gp: -1,
    *each(ctx) { discardWhere(ctx.g, ctx.me, (c) => faceValue(c) >= 4); },
    ...weLeftColour("Red"),
  },
});
