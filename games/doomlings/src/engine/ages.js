/**
 * Doomlings — age and catastrophe effects (base game).
 *
 * Ages come in two shapes and the engine treats them differently:
 *
 *   *each(ctx)      fires once for a player, at the start of their turn. This
 *                   is "Draw 2 cards", "Discard 1 at random" and friends.
 *   restrict {...}  a standing rule for the whole round — colours that can't
 *                   be played, a different stabilize target, actions ignored.
 *   *onReveal(ctx)  fires once for the table when the card turns over.
 *
 * Catastrophes additionally carry:
 *
 *   gp              Gene Pool delta applied to every player on reveal.
 *   *worldsEnd(ctx) only when this is the THIRD catastrophe.
 *   *weScore(ctx)   World's End scoring, returns {playerId: delta}.
 *
 * The split matters: a catastrophe's white text happens the moment it turns
 * over, but its World's End text sits dormant unless it ends the game — and
 * Prepper can choose which catastrophe that is.
 */

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

const pileColour = (p, c) => p.traitPile.filter((x) => hasColour(x, c)).length;

/** Ask a player to discard exactly n of their own cards. */
function* discardChosen(ctx, player, n, label) {
  const want = Math.min(n, player.hand.length);
  if (want <= 0) return [];
  const picked = yield ctx.ask.cards({
    playerId: player.id,
    prompt: label || `Discard ${want} card${want === 1 ? "" : "s"}`,
    from: "hand",
    count: want,
    max: want,
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

/** Discard n "at random": the picker taps face-down cards from the owner's hand. */
function* discardBlind(ctx, picker, owner, n, label) {
  const out = [];
  for (const c of yield* blindPick(ctx.g, picker, owner, n, label)) {
    const d = discardFromHand(ctx.g, owner, c.uid);
    if (d) out.push(d);
  }
  return out;
}

/** Ask a player to discard one trait of a given colour from their pile. */
function* discardTraitOfColour(ctx, player, colour, label) {
  const pool = player.traitPile.filter((c) => hasColour(c, colour) && !isLocked(player, c));
  if (!pool.length) return null;
  const choice = yield ctx.ask.trait({
    playerId: player.id,
    prompt: label || `Discard a ${colour.toLowerCase()} trait`,
    options: player.traitPile
      .filter((c) => hasColour(c, colour))
      .map((c) => ({
        playerId: player.id, uid: c.uid, name: c.name,
        disabled: isLocked(player, c) || undefined,
        reason: isLocked(player, c) ? lockReason(player, c) : undefined,
      })),
  });
  const uid = choice && choice.uid;
  if (!uid) return null;
  return yield* ctx.discardTrait(player, uid);
}

/* ------------------------------------------------------------------ *
 * AGES
 * ------------------------------------------------------------------ */
const AGES = {

  // The opening card — its text is the base rules, nothing to execute.
  "the birth of life": {},

  /* ---- draw / discard on your turn ---- */
  "flourish": {
    *each(ctx) { ctx.draw(2); ctx.say(`${ctx.me.name} drew 2 from Flourish.`); },
  },

  "comet showers": {
    *each(ctx) {
      const gone = yield* discardBlind(ctx, ctx.me, ctx.me, 1, "Comet Showers — discard 1 card at random");
      if (gone.length) {
        yield ctx.ask.confirm({
          playerId: ctx.me.id, acknowledge: true,
          prompt: `Comet Showers: ${gone[0].name} was discarded at random.`,
        });
      }
    },
  },

  "northern winds": {
    *each(ctx) {
      ctx.draw(1);
      yield* discardChosen(ctx, ctx.me, 1, "Northern Winds — discard 1 card");
    },
  },

  "high tides": {
    *each(ctx) {
      const draw = yield ctx.ask.confirm({
        playerId: ctx.me.id,
        prompt: "High Tides — draw 1 card? (No discards 1 instead)",
      });
      if (draw) ctx.draw(1);
      else yield* discardChosen(ctx, ctx.me, 1, "High Tides — discard 1 card");
    },
  },

  "age of reason": {
    *each(ctx) {
      const drawn = ctx.draw(2);
      if (drawn.length < 2) return;
      const keep = yield ctx.ask.cards({
        playerId: ctx.me.id,
        prompt: "Age of Reason — keep 1, discard the other",
        from: "hand", count: 1, max: 1,
        options: drawn.map((c) => ({ uid: c.uid, name: c.name })),
      });
      const keptUid = (keep || []).map((x) => (typeof x === "string" ? x : x.uid))[0];
      for (const c of drawn) if (c.uid !== keptUid) discardFromHand(ctx.g, ctx.me, c.uid);
    },
  },

  "age of exploration": {
    *each(ctx) {
      if (!ctx.me.hand.length) return;
      const yes = yield ctx.ask.confirm({
        playerId: ctx.me.id,
        prompt: "Age of Exploration — discard 1 card to draw 2?",
      });
      if (!yes) return;
      const gone = yield* discardChosen(ctx, ctx.me, 1, "Discard 1 to draw 2");
      if (gone.length) ctx.draw(2);
    },
  },

  "age of nietzsche": {
    *each(ctx) {
      if (!ctx.me.hand.length) return;
      const yes = yield ctx.ask.confirm({
        playerId: ctx.me.id,
        prompt: `Age of Nietzsche — discard your hand (${ctx.me.hand.length}) and draw 3?`,
      });
      if (!yes) return;
      discardHand(ctx.g, ctx.me);
      ctx.draw(3);
    },
  },

  "enlightenment": {
    *each(ctx) {
      if (!ctx.me.hand.length) return;
      const picked = yield ctx.ask.cards({
        playerId: ctx.me.id,
        prompt: "Enlightenment — discard up to 2 cards",
        from: "hand", count: 0, max: 2, optional: true,
        options: ctx.me.hand.map((c) => ({ uid: c.uid, name: c.name })),
      });
      for (const x of picked || []) discardFromHand(ctx.g, ctx.me, x.uid || x);
    },
  },

  "alien terraform": {
    *each(ctx) {
      const doms = ctx.me.hand.filter(isDominant);
      if (!doms.length) return;
      const yes = yield ctx.ask.confirm({
        playerId: ctx.me.id,
        prompt: `Alien Terraform — discard ${doms.length} dominant card(s) from hand and stabilize?`,
      });
      if (!yes) return;
      for (const c of doms) discardFromHand(ctx.g, ctx.me, c.uid);
      ctx.restabilize();
    },
  },

  "coastal formations": {
    restrict: { stabilizePlus: 1 },
    *each(ctx) {
      yield ctx.ask.confirm({
        playerId: ctx.me.id, acknowledge: true,
        prompt: "Coastal Formations: you may stabilize to 1 over your Gene Pool this round.",
      });
    },
  },

  "awakening": {
    *onReveal(ctx) {
      const next = ctx.g.ageDeck[0];
      if (!next) return;
      yield ctx.ask.confirm({
        acknowledge: true,
        prompt: "Awakening — the next age is revealed to everyone.",
        peek: { name: next.name, effect: next.effect },
      });
    },
  },

  "birth of a hero": {
    // Rulebook p.6: the one base-game exception to the 2-dominant limit.
    restrict: { heroicFree: true },
    *each(ctx) {
      const heroic = ctx.me.hand.find((c) => norm(c.name) === "heroic");
      if (!heroic) return;
      const yes = yield ctx.ask.confirm({
        playerId: ctx.me.id,
        prompt: "Birth of a Hero — play Heroic now, without restriction?",
      });
      if (yes) yield* ctx.playNow(heroic.uid, { ignoreRequirements: true });
    },
  },

  /* ---- standing restrictions ---- */
  "arid lands":      { restrict: { noColour: "Blue" } },
  "eclipse":         { restrict: { noColour: "Red" } },
  "tectonic shift":  { restrict: { noColour: "Green" } },
  "lunar retreat":   { restrict: { noColour: "Purple" } },
  "tropical lands":  { restrict: { noColour: "Colorless" } },
  "glacial drift":   { restrict: { noFaceAtLeast: 4 } },
  "migration shifts":{ restrict: { noFaceExactly: 2 } },
  "age of peace":    { restrict: { ignoreActions: true } },
  "lonely age":      { restrict: { maxPlays: 1 } },
  "age of wonder":   { restrict: { stabilizeTo: 4 } },
  "prosperity":      { restrict: { stabilizeOptional: true } },
  "reforestation":   { restrict: { noRemoval: true } },
  "galactic drift":  { restrict: { extraColourlessPlay: true } },
};

/* ------------------------------------------------------------------ *
 * CATASTROPHES
 * ------------------------------------------------------------------ */

/** "-1 Gene Pool. Discard 1 card from your hand for each <colour> trait." */
const perColourDiscard = (gp, colour, we) => ({
  gp,
  *each(ctx) {
    const n = pileColour(ctx.me, colour);
    if (!n) return;
    yield* discardChosen(ctx, ctx.me, n,
      `Discard ${n} card${n === 1 ? "" : "s"} — 1 for each ${colour.toLowerCase()} trait`);
  },
  ...we,
});

/** World's End: "-1 for each <colour> trait in your trait pile." */
const weMinusPerColour = (colour, per = 1) => ({
  *weScore(ctx) {
    const out = {};
    for (const p of ctx.g.players) {
      const n = pileColour(p, colour);
      if (n) out[p.id] = -per * n;
    }
    return out;
  },
});

/** World's End: "Discard 1 <colour> trait from your trait pile." */
const weDiscardColour = (colour) => ({
  *worldsEnd(ctx) {
    for (const p of ctx.playersInOrder()) {
      yield* discardTraitOfColour(ctx, p, colour,
        `${p.name}: discard a ${colour.toLowerCase()} trait`);
    }
  },
});
const CATASTROPHES = {

  "super volcano":    perColourDiscard(-1, "Blue",      weMinusPerColour("Blue")),
  "ice age":          perColourDiscard(-1, "Red",       weMinusPerColour("Red")),
  "retrovirus":       perColourDiscard(-1, "Green",     weMinusPerColour("Green")),
  "pulse event":      perColourDiscard(-1, "Purple",    weDiscardColour("Purple")),
  "mass extinction":  perColourDiscard(-1, "Colorless", weDiscardColour("Green")),

  "ai takeover": {
    gp: -1,
    *each(ctx) {
      const over = ctx.me.hand.length - 2;
      if (over > 0) yield* discardChosen(ctx, ctx.me, over, "AI Takeover — keep only 2 cards");
    },
    // "Set the face value of all colorless traits to 2. Ignore all colorless
    //  effects. (Excluding dominants.)" Rewrites the pile before scoring.
    *worldsEnd(ctx) {
      for (const p of ctx.g.players) {
        for (const c of p.traitPile) {
          if (isDominant(c) || !hasColour(c, "Colorless")) continue;
          c.points = "2";
          c.aiSuppressed = true;
        }
      }
      ctx.say("AI Takeover: colorless traits are worth 2 and their effects are ignored.");
    },
  },

  "deus ex machina": {
    gp: 0,
    *each(ctx) { ctx.restabilize(); },
    *worldsEnd(ctx) {
      for (const p of ctx.playersInOrder()) {
        const [c] = drawMany(ctx.g, p, 1);
        if (!c) continue;
        p.deusBonus = Math.min(faceValue(c), 7);
        yield ctx.ask.confirm({
          playerId: p.id, acknowledge: true,
          prompt: `${p.name} drew ${c.name} — +${p.deusBonus} to their final score.`,
        });
      }
    },
    *weScore(ctx) {
      const out = {};
      for (const p of ctx.g.players) if (p.deusBonus) out[p.id] = p.deusBonus;
      return out;
    },
  },

  "glacial meltdown": {
    gp: -1,
    *each(ctx) {
      const gone = yield* discardBlind(ctx, ctx.me, ctx.me, 2, "Glacial Meltdown — discard 2 cards at random");
      if (gone.length) {
        yield ctx.ask.confirm({
          playerId: ctx.me.id, acknowledge: true,
          prompt: `Glacial Meltdown discarded ${gone.map((c) => c.name).join(" and ")}.`,
        });
      }
    },
    ...weDiscardColour("Blue"),
  },

  "grey goo": {
    gp: 0,
    // "The player(s) with the most traits discard their hand and stabilize."
    *each(ctx) {
      const most = Math.max(...ctx.g.players.map((p) => p.traitPile.length));
      if (ctx.me.traitPile.length !== most || most === 0) return;
      discardHand(ctx.g, ctx.me);
      ctx.restabilize();
      ctx.say(`${ctx.me.name} discarded their hand to Grey Goo.`);
    },
    *weScore(ctx) {
      const most = Math.max(...ctx.g.players.map((p) => p.traitPile.length));
      const out = {};
      if (most <= 0) return out;
      for (const p of ctx.g.players) if (p.traitPile.length === most) out[p.id] = -5;
      return out;
    },
  },

  "mega tsunami": {
    gp: 0,
    // Hands pass as one simultaneous move, so it runs on reveal, not per turn.
    *onReveal(ctx) {
      const g = ctx.g;
      const hands = g.players.map((p) => p.hand);
      g.players.forEach((p, i) => {
        // "Pass your hand to the right" — the previous seat in play order.
        p.hand = hands[(i + 1) % g.players.length];
      });
      ctx.say("Mega Tsunami: every hand passed to the right.");
      yield ctx.ask.confirm({ acknowledge: true, prompt: "Mega Tsunami — hands passed to the right." });
    },
    ...weDiscardColour("Red"),
  },

  "nuclear winter": {
    gp: -1,
    *each(ctx) {
      ctx.restabilize();
      yield* discardChosen(ctx, ctx.me, 1, "Nuclear Winter — discard 1 card");
    },
    ...weDiscardColour("Colorless"),
  },

  "overpopulation": {
    gp: +1,
    *each(ctx) {
      const n = Math.min(COLOURS.filter((c) => pileColour(ctx.me, c) > 0).length, 4);
      if (n) { ctx.draw(n); ctx.say(`${ctx.me.name} drew ${n} from Overpopulation.`); }
    },
    *weScore(ctx) {
      const fewest = Math.min(...ctx.g.players.map((p) => p.traitPile.length));
      const out = {};
      for (const p of ctx.g.players) if (p.traitPile.length === fewest) out[p.id] = 5;
      return out;
    },
  },

  "solar flare": {
    gp: 0,
    *each(ctx) {
      yield* discardChosen(ctx, ctx.me, 3, "Solar Flare — discard 3 cards");
      ctx.draw(2);
    },
    ...weMinusPerColour("Purple"),
  },

  "the big one": {
    gp: -1,
    *onReveal(ctx) {
      const g = ctx.g;
      // Face-down picks, so whoever holds the phone can pick for everyone.
      const moving = [];
      for (const p of g.players) {
        moving.push(yield* blindPick(g, ctx.me, p, 2,
          `The Big One — pick 2 of ${p.name}'s cards to pass left`));
      }
      g.players.forEach((p, i) => {
        for (const c of moving[i]) {
          const k = p.hand.findIndex((x) => x.uid === c.uid);
          if (k >= 0) g.players[(i + 1) % g.players.length].hand.push(p.hand.splice(k, 1)[0]);
        }
      });
      ctx.say("The Big One: 2 random cards passed left.");
      yield ctx.ask.confirm({ acknowledge: true, prompt: "The Big One — 2 random cards passed to the left." });
    },
    // "-4 if you have 4 or more traits of the same color."
    *weScore(ctx) {
      const out = {};
      for (const p of ctx.g.players) {
        if (COLOURS.some((c) => pileColour(p, c) >= 4)) out[p.id] = -4;
      }
      return out;
    },
  },

  "the four horsemen": {
    gp: 0,
    *each(ctx) {
      const pool = ctx.me.traitPile.filter((c) => !isLocked(ctx.me, c));
      if (!pool.length) return;
      const choice = yield ctx.ask.trait({
        playerId: ctx.me.id,
        prompt: "The Four Horsemen — discard 1 trait from your pile",
        options: ctx.me.traitPile.map((c) => ({
          playerId: ctx.me.id, uid: c.uid, name: c.name,
          disabled: isLocked(ctx.me, c) || undefined,
          reason: isLocked(ctx.me, c) ? lockReason(ctx.me, c) : undefined,
        })),
      });
      if (choice && choice.uid) yield* ctx.discardTrait(ctx.me, choice.uid);
    },
    // "Discard 1 face value (4) trait or higher from your trait pile."
    *worldsEnd(ctx) {
      for (const p of ctx.playersInOrder()) {
        const pool = p.traitPile.filter((c) => faceValue(c) >= 4 && !isLocked(p, c));
        if (!pool.length) continue;
        const choice = yield ctx.ask.trait({
          playerId: p.id,
          prompt: `${p.name}: discard a trait with face value 4 or higher`,
          options: p.traitPile.filter((c) => faceValue(c) >= 4).map((c) => ({
            playerId: p.id, uid: c.uid, name: c.name,
            disabled: isLocked(p, c) || undefined,
            reason: isLocked(p, c) ? lockReason(p, c) : undefined,
          })),
        });
        if (choice && choice.uid) yield* ctx.discardTrait(p, choice.uid);
      }
    },
  },
};

/* ------------------------------------------------------------------ *
 * Lookup + restriction queries
 * ------------------------------------------------------------------ */
function ageHandler(card) {
  if (!card) return null;
  const k = norm(card.name);
  return CATASTROPHES[k] || AGES[k] || null;
}

/** The standing rules in force this round, from the face-up age. */
function activeRestrict(card) {
  const h = ageHandler(card);
  return (h && h.restrict) || {};
}

/** Can this trait legally be played under the current age? */
function ageAllowsPlay(card, restrict) {
  if (!restrict) return true;
  if (restrict.noColour && hasColour(card, restrict.noColour)) return false;
  if (restrict.noFaceAtLeast != null && faceValue(card) >= restrict.noFaceAtLeast) return false;
  if (restrict.noFaceExactly != null && faceValue(card) === restrict.noFaceExactly) return false;
  if (restrict.noNegative && faceValue(card) < 0) return false;
  if (restrict.noMulti && isMulti(card)) return false;
  if (restrict.noDominant && isDominant(card)) return false;
  return true;
}
function ageBlockReason(card, restrict) {
  if (!restrict) return null;
  if (restrict.noColour && hasColour(card, restrict.noColour)) {
    return `This age blocks ${restrict.noColour.toLowerCase()} traits.`;
  }
  if (restrict.noFaceAtLeast != null && faceValue(card) >= restrict.noFaceAtLeast) {
    return `This age blocks face value ${restrict.noFaceAtLeast} and higher.`;
  }
  if (restrict.noFaceExactly != null && faceValue(card) === restrict.noFaceExactly) {
    return `This age blocks face value ${restrict.noFaceExactly} traits.`;
  }
  if (restrict.noNegative && faceValue(card) < 0) return "This age blocks traits with a negative face value.";
  if (restrict.noMulti && isMulti(card)) return "This age blocks multi-color traits.";
  if (restrict.noDominant && isDominant(card)) return "This age blocks dominant traits.";
  return null;
}

/** Hand size a player must reach when stabilizing, under the current age. */
function stabilizeTarget(player, restrict, g) {
  if (restrict && restrict.stabilizeTo != null) return restrict.stabilizeTo;
  // Age of Envy: "stabilize to the size of the Gene Pool on your right."
  if (restrict && restrict.envy && g) {
    const i = g.players.findIndex((p) => p.id === player.id);
    const right = g.players[(i - 1 + g.players.length) % g.players.length];
    if (right) return right.genePool;
  }
  return player.genePool;
}

/** Which catastrophes have been revealed, for Prepper. */
function revealedCatastrophes(g) {
  return g.eras.flat().filter((c) => CATASTROPHES[norm(c.name)]);
}
