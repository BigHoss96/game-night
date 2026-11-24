/**
 * Doomlings — core rules engine (base game).
 *
 * No DOM, no I/O. Everything here is a plain function over a `game` object so
 * the same code runs in the browser, in Node tests, and later inside bots.
 *
 * The one idea worth understanding before reading further: EFFECTS ARE
 * GENERATORS. A card effect that needs a decision does
 *
 *     const colour = yield ctx.ask.colour({ prompt: "Choose a colour" });
 *
 * and the engine suspends the whole game on `game.pending`. A human answers it
 * by tapping; a bot answers it by calling the same `answer()` function. Neither
 * knows about the other, which is what keeps bots honest — they cannot see or
 * do anything a player could not.
 *
 * Consequence worth knowing: a suspended generator cannot be JSON-serialised,
 * so a game cannot be saved mid-effect. Save between turns instead.
 */

const COLOURS = ["Blue", "Green", "Red", "Purple", "Colorless"];
const RULES = {
  startingHand: 5,
  startingGenePool: 5,
  genePoolMin: 1,
  genePoolMax: 8,
  dominantLimit: 2,
  emptyHandDraw: 5,
  stuckDraw: 3,
};
const VARIANTS = {
  "3x3": { eras: 3, agesPerEra: 3, label: "3 eras of 3 ages" },
  "3x4": { eras: 3, agesPerEra: 4, label: "3 eras of 4 ages" },
  "4x3": { eras: 4, agesPerEra: 3, label: "4 eras of 3 ages" },
};

/* ------------------------------------------------------------------ *
 * Card helpers
 * ------------------------------------------------------------------ */
const norm = (s) => (s || "").trim().toLowerCase();

const SPLIT = " | ";
const listOf = (raw) =>
  (raw || "").split(SPLIT).map((v) => v.trim()).filter(Boolean);
const hasSubtype = (card, want) =>
  listOf(card.subtype).some((s) => norm(s) === norm(want));

/** Catastrophes are card_type "Age" with subtype "Catastrophe" — they share the
 *  AGES back on purpose so players cannot see one coming. Never test card_type. */
const isCatastrophe = (c) => norm(c.card_type) === "age" && hasSubtype(c, "Catastrophe");
const isBirthOfLife = (c) => norm(c.name) === "the birth of life";
const isAge = (c) => norm(c.card_type) === "age" && !isCatastrophe(c) && !isBirthOfLife(c);
const isTrait = (c) => norm(c.card_type) === "trait";
const isDominant = (c) => hasSubtype(c, "Dominant");
const isAction = (c) => hasSubtype(c, "Action");

/**
 * Rulebook p.6: once played, a dominant trait "cannot be swapped, stolen,
 * given, returned, discarded, or removed from your trait pile." Every removal
 * path funnels through this so no single card can forget the rule.
 */
const isProtected = (c) => isDominant(c);

/**
 * Pile shields from Overlush: Ironwood keeps a small green pile in place, Meek a
 * small red one. Checked wherever a trait would leave its owner's pile, alongside
 * the dominant rule, so the shield can't be forgotten by any one card.
 */
function shieldOf(owner, card) {
  if (!owner || !card || isProtected(card)) return null;
  const holds = (n) => owner.traitPile.some((c) => norm(c.name) === n && c.uid !== card.uid);
  const count = (col) => owner.traitPile.filter((c) => hasColour(c, col)).length;
  if (holds("ironwood") && hasColour(card, "Green") && count("Green") <= 5) return "Ironwood keeps green traits from being removed.";
  if (holds("meek") && hasColour(card, "Red") && count("Red") <= 3) return "Meek keeps red traits from being removed.";
  return null;
}
/** Can this trait be taken out of `owner`'s pile right now? */
const isLocked = (owner, card) => isProtected(card) || Boolean(shieldOf(owner, card));
const lockReason = (owner, card) => (isProtected(card) ? PROTECTED_REASON : shieldOf(owner, card));

/** Reforestation shields EVERY trait for the round, not just dominants. */
function isRemovable(g, card) {
  if (isProtected(card)) return false;
  if (activeRestrict(topAge(g)).noRemoval) return false;
  return true;
}
const PROTECTED_REASON =
  "Dominant traits can't be swapped, stolen, given, returned or discarded.";

/** "Multi-color" is a marker, not a colour. Big Ears (Blue|Purple|Multi-color)
 *  counts as both blue and purple everywhere a colour is counted. */
const coloursOf = (card) =>
  listOf(card.color).filter((c) => norm(c) !== "multi-color");
const isMulti = (card) => listOf(card.color).some((c) => norm(c) === "multi-color");
const hasColour = (card, colour) =>
  coloursOf(card).some((c) => norm(c) === norm(colour));
const faceValue = (card) => {
  const n = parseFloat(card.points);
  return Number.isFinite(n) ? n : 0;
};

/* ------------------------------------------------------------------ *
 * Deterministic RNG — seeded so a failing game can be replayed exactly.
 * ------------------------------------------------------------------ */
function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Deal
 * ------------------------------------------------------------------ */

let uidSeq = 0;
const resetUids = () => { uidSeq = 0; };
const tag = (card) => ({ ...card, uid: `c${++uidSeq}` });
function inventory(pool) {
  return {
    traits: pool.filter(isTrait),
    ages: pool.filter(isAge),
    catastrophes: pool.filter(isCatastrophe),
    birth: pool.find(isBirthOfLife) || null,
  };
}

/**
 * Table setting, rulebook pages 1–2: deal 5 traits each; separate ages and
 * catastrophes and shuffle them apart; give each era pile its ages plus exactly
 * one catastrophe and shuffle that pile on its own (this is what hides when
 * doom arrives); stack the piles, Birth of Life on top.
 */
function dealGame(pool, { names, variantKey = "3x3", seed = 1, bots = [] } = {}) {
  const rng = makeRng(seed);
  const v = VARIANTS[variantKey];
  const inv = inventory(pool);

  const traits = shuffle(inv.traits, rng).map(tag);
  const players = names.map((name, i) => ({
    id: i,
    name: name || `Player ${i + 1}`,
    isBot: Boolean(bots[i]),
    hand: traits.splice(0, RULES.startingHand),
    traitPile: [],
    genePool: RULES.startingGenePool,
    dominants: 0,
    adjust: 0,
    flags: {},           // per-player persistent state (e.g. denialArmed)
  }));

  const ages = shuffle(inv.ages, rng).map(tag);
  const cats = shuffle(inv.catastrophes, rng).map(tag);

  const eraPiles = [];
  for (let e = 0; e < v.eras; e++) {
    const pile = ages.splice(0, v.agesPerEra);
    if (cats.length) pile.push(cats.shift());
    eraPiles.push(shuffle(pile, rng));
  }

  const ageDeck = eraPiles.flat();
  if (inv.birth) ageDeck.unshift(tag(inv.birth));

  return {
    rng,
    seed,
    players,
    traitDeck: traits,
    discard: [],
    ageDeck,
    eras: Array.from({ length: v.eras }, () => []),
    currentEra: 0,
    activeSeat: 0,
    firstSeat: 0,
    round: 0,
    phase: "age",            // "age" | "turn" | "worldsEnd" | "over"
    catastrophes: 0,
    pendingNewEra: false,
    playsLeft: 0,            // plays remaining this turn (1 normally)
    stabilizeWaived: false,
    variantKey,
    pending: null,           // suspended effect awaiting an answer
    log: [],
    scores: null,
  };
}

/* ------------------------------------------------------------------ *
 * Small accessors
 * ------------------------------------------------------------------ */
const seatOf = (g) => g.players[g.activeSeat];
const opponentsOf = (g, p) => g.players.filter((x) => x.id !== p.id);
const topAge = (g) => {
  const pile = g.eras[g.currentEra];
  return pile && pile.length ? pile[pile.length - 1] : null;
};
const say = (g, text, big = false) => { g.log.unshift({ text, big }); };

/* ------------------------------------------------------------------ *
 * Primitive operations — these are what card effects are built from.
 * ------------------------------------------------------------------ */

/** Star Tails: "You may not draw any more cards this turn." */
const drawBlocked = (g, player) => Boolean(g.noDrawFor != null && g.noDrawFor === player.id && g.phase === "turn");

/** Drawing reshuffles the discard when the trait deck runs dry (FAQ p.8).
 *  `bottom` draws from the bottom of the deck (Overlush). Age of Certainty
 *  turns the deck upside down, which swaps top and bottom for the round. */
function drawCard(g, player, { bottom = false } = {}) {
  if (drawBlocked(g, player)) return null;
  if (!g.traitDeck.length && g.discard.length) {
    g.traitDeck = shuffle(g.discard, g.rng);
    g.discard = [];
    say(g, "Trait deck ran out — discard reshuffled in.");
  }
  if (!g.traitDeck.length) return null;
  const flipped = Boolean(activeRestrict(topAge(g)).deckFlipped);
  const card = (bottom !== flipped) ? g.traitDeck.pop() : g.traitDeck.shift();
  card.enteredAt = g.clock || 0;           // Elusive: when did this land in hand?
  card.enteredByAge = Boolean(g.inAgeEffect);
  player.hand.push(card);
  return card;
}
function drawBottom(g, player, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const c = drawCard(g, player, { bottom: true }); if (!c) break; out.push(c); }
  return out;
}
function drawMany(g, player, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = drawCard(g, player);
    if (!c) break;
    out.push(c);
  }
  return out;
}
function discardFromHand(g, player, uid) {
  const i = player.hand.findIndex((c) => c.uid === uid);
  if (i < 0) return null;
  const card = player.hand.splice(i, 1)[0];
  // Muse: "If Muse is discarded from your hand, you may instead play it into
  // your trait pile." Always worth doing, so it happens without a prompt.
  if (norm(card.name) === "muse" && player.dominants < RULES.dominantLimit) {
    player.traitPile.push(card);
    player.dominants++;
    say(g, `Muse was discarded — ${player.name} played it into their trait pile instead.`);
    return card;
  }
  g.discard.unshift(card);
  return card;
}
/** Discard a whole hand, one card at a time so Muse still gets its chance. */
function discardHand(g, player) {
  for (const c of player.hand.slice()) discardFromHand(g, player, c.uid);
}
function randomCardsFromHand(g, player, n) {
  const picks = [];
  const pool = player.hand.slice();
  for (let i = 0; i < n && pool.length; i++) {
    picks.push(pool.splice(Math.floor(g.rng() * pool.length), 1)[0]);
  }
  return picks;
}

/**
 * "At random" from a hand, done the way the table does it: the hand is shuffled
 * face down and a player taps the cards. The engine keeps the shuffled order, so
 * the UI only ever sees backs and positions — it cannot peek.
 * Answer: an array of positions (0-based). Missing picks are filled in order.
 */
function* blindPick(g, picker, owner, n, prompt) {
  const want = Math.min(n, owner.hand.length);
  if (want <= 0) return [];
  const order = shuffle(owner.hand.map((c) => c.uid), g.rng);
  const res = yield {
    kind: "blind", playerId: picker.id, ownerId: owner.id, ownerName: owner.name,
    total: order.length, count: want, prompt,
  };
  const idx = [...new Set((res || []).filter((i) => Number.isInteger(i) && i >= 0 && i < order.length))]
    .slice(0, want);
  for (let i = 0; idx.length < want && i < order.length; i++) if (!idx.includes(i)) idx.push(i);
  return idx.map((i) => owner.hand.find((c) => c.uid === order[i])).filter(Boolean);
}

/** Gene Pool moves are clamped by being IGNORED out of range, not capped. */
function adjustGenePool(g, player, delta) {
  const next = player.genePool + delta;
  if (next < RULES.genePoolMin || next > RULES.genePoolMax) return false;
  player.genePool = next;
  return true;
}

/**
 * Gene Pool effects live with the trait (rulebook p.5): "If the trait leaves
 * your trait pile, adjust your Gene Pool accordingly." Handlers declare the
 * size of their effect as `gpDelta`, and this undoes or re-applies it.
 */
function gpDeltaOf(card, registry) {
  const h = registry && registry[norm(card.name)];
  return h && typeof h.gpDelta === "number" ? h.gpDelta : 0;
}
function moveTrait(g, from, to, uid, registry) {
  if (!from || !to) return null;
  const i = from.traitPile.findIndex((c) => c.uid === uid);
  if (i < 0) return null;
  const card = from.traitPile[i];
  if (isLocked(from, card)) return null;       // the rule, enforced centrally
  from.traitPile.splice(i, 1);
  to.traitPile.push(card);
  if (isDominant(card)) { from.dominants--; to.dominants++; }

  const d = gpDeltaOf(card, registry);
  if (d) { adjustGenePool(g, from, -d); adjustGenePool(g, to, d); }
  noteLeft(g, from, card, "move", to);
  return card;
}
function returnTraitToHand(g, player, uid, registry) {
  const i = player.traitPile.findIndex((c) => c.uid === uid);
  if (i < 0) return null;
  const card = player.traitPile[i];
  if (isLocked(player, card)) return null;
  player.traitPile.splice(i, 1);
  if (isDominant(card)) player.dominants--;
  player.hand.push(card);

  const d = gpDeltaOf(card, registry);
  if (d) adjustGenePool(g, player, -d);
  noteLeft(g, player, card, "return", null);
  return card;
}

/**
 * Discard a trait OUT of a trait pile. Routed through here rather than spliced
 * inline because two base-game cards react to it: Endurance returns itself, and
 * Regenerative Tissue draws when any trait leaves.
 */
function* discardTrait(g, player, uid, registry) {
  const i = player.traitPile.findIndex((c) => c.uid === uid);
  if (i < 0) return null;
  if (isLocked(player, player.traitPile[i])) return null;   // dominants never leave
  const card = player.traitPile.splice(i, 1)[0];
  if (isDominant(card)) player.dominants--;

  const d = gpDeltaOf(card, registry);
  if (d) adjustGenePool(g, player, -d);

  if (norm(card.name) === "endurance") {
    player.traitPile.push(card);
    say(g, `${card.name} returned itself to ${player.name}'s trait pile.`);
    yield* fireOnTraitDiscarded(g, player, card, registry);
    return card;
  }

  g.discard.unshift(card);
  noteLeft(g, player, card, "discard", null);
  yield* fireOnTraitDiscarded(g, player, card, registry);
  yield* flushLeaves(g, registry);
  return card;
}

/* ------------------------------------------------------------------ *
 * Leaving a trait pile (Overlush)
 *
 * Several Overlush cards care when a trait leaves a pile — by discard, steal,
 * swap or return. The move functions above can't prompt (they're plain
 * functions), so each departure is queued here and played out at the next
 * flush point: the card's own `onLeave` handler, then a `traitRemoved` window
 * for anyone holding Patches, Quills, Dart or Motion Dazzle.
 * ------------------------------------------------------------------ */
function noteLeft(g, owner, card, how, to) {
  (g.leaves ||= []).push({
    ownerId: owner.id, uid: card.uid, how, toId: to ? to.id : null,
    by: g.effectSrc ? { ...g.effectSrc } : null,
    ownTurn: g.phase === "turn" && g.activeSeat === owner.id,
  });
}
function findAnywhere(g, uid) {
  for (const p of g.players) {
    for (const where of ["traitPile", "hand"]) {
      const i = p[where].findIndex((c) => c.uid === uid);
      if (i >= 0) return { list: p[where], i, player: p, where };
    }
  }
  for (const [name, list] of [["discard", g.discard], ["deck", g.traitDeck]]) {
    const i = list.findIndex((c) => c.uid === uid);
    if (i >= 0) return { list, i, player: null, where: name };
  }
  return null;
}
function* flushLeaves(g, registry) {
  if (!registry || g.flushing) return;
  g.flushing = true;
  try {
    let guard = 0;
    while (g.leaves && g.leaves.length && guard++ < 40) {
      const ev = g.leaves.shift();
      const owner = g.players.find((p) => p.id === ev.ownerId);
      const at = findAnywhere(g, ev.uid);
      if (!owner || !at) continue;
      const card = at.list[at.i];
      const h = registry[norm(card.name)];
      if (h && h.onLeave) yield* h.onLeave(makeCtx(g, owner, card, registry), ev);
      yield* offerReactions(g, "traitRemoved", { type: "traitRemoved", card, owner, actor: owner, how: ev.how, by: ev.by }, registry);
    }
  } finally {
    g.flushing = false;
  }
}
/** Run an effect with `card` recorded as the source of anything it removes. */
function* asSource(g, player, card, gen) {
  const prev = g.effectSrc;
  g.effectSrc = { uid: card ? card.uid : null, name: card ? card.name : null, playerId: player ? player.id : null, dominant: Boolean(card && isDominant(card)) };
  try { return yield* gen; } finally { g.effectSrc = prev; }
}

function* fireOnTraitDiscarded(g, player, card, registry) {
  if (!registry) return;
  for (const held of player.traitPile.slice()) {
    const h = registry[norm(held.name)];
    if (h && h.onTraitDiscarded) {
      yield* h.onTraitDiscarded(makeCtx(g, player, held, registry), card);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Effect context — the sandbox a card script is given.
 * ------------------------------------------------------------------ */
const ask = {
  cards: (o) => ({ kind: "cards", ...o }),
  colour: (o) => ({ kind: "colour", ...o }),
  player: (o) => ({ kind: "player", ...o }),
  trait: (o) => ({ kind: "trait", ...o }),
  confirm: (o) => ({ kind: "confirm", ...o }),
};
function makeCtx(g, player, card, registry) {
  return {
    g,
    game: g,
    me: player,
    card,
    registry,
    ask,
    opponents: () => opponentsOf(g, player),
    draw: (n = 1) => drawMany(g, player, n),
    drawBottom: (n = 1) => drawBottom(g, player, n),
    say: (t, big) => say(g, t, big),

    /** Grant an extra play this turn ("Play 1 more trait"). Lonely Age
     *  ("Cannot play more than 1 trait on your turn") blocks it. Returns
     *  whether the extra play was granted. */
    grantPlay: (n = 1) => {
      if (activeRestrict(topAge(g)).maxPlays) {
        say(g, `Lonely Age: ${player.name} can't play another trait this turn.`);
        return false;
      }
      g.playsLeft += n;
      return true;
    },

    /** Play a specific card from hand immediately, resolving its action unless
     *  told otherwise. Used by "You may play 1 of them now". */
    playNow: function* (uid, { ignoreAction = false, suppressReactions = false } = {}) {
      return yield* playTraitInner(g, player, uid, registry,
        { ignoreAction, free: true, suppressReactions });
    },

    /** Move a trait between piles, used by Parasitic's steal. */
    takeTrait: (from, to, uid) => moveTrait(g, from, to, uid, registry),

    discardTrait: function* (owner, uid) {
      return yield* discardTrait(g, owner, uid, registry);
    },

    /** Players starting from the first player, for table-wide effects. */
    playersInOrder: () => playersFrom(g, g.firstSeat),

    /** "Stabilize" as an instruction from a card, not an end-of-turn step. */
    restabilize: () => {
      const target = stabilizeTarget(player, activeRestrict(topAge(g)), g);
      let guard = 0;
      while (player.hand.length < target && guard++ < 20) if (!drawCard(g, player)) break;
      while (player.hand.length > target && guard++ < 40) {
        const c = player.hand[player.hand.length - 1];
        discardFromHand(g, player, c.uid);
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Playing a trait
 * ------------------------------------------------------------------ */

/** Requirement subtype cards gate their own play. */
function canPlayCard(g, player, card, registry) {
  const restrict = activeRestrict(topAge(g));

  // The face-up age can forbid whole colours or face values this round.
  if (!ageAllowsPlay(card, restrict)) return false;
  if (bannedColourFor(g, player, card)) return false;

  const h = registry[norm(card.name)];
  if (h && h.canPlay && !h.canPlay(g, player, card)) return false;

  if (isDominant(card) && player.dominants >= RULES.dominantLimit) {
    // Rulebook p.6: Heroic during Birth of a Hero is the one base-game
    // exception to the limit of two.
    if (!(restrict.heroicFree && norm(card.name) === "heroic")) return false;
  }
  return true;
}

/** Why a card can't be played, for the UI to explain. */
function playBlockReason(g, player, card, registry) {
  const restrict = activeRestrict(topAge(g));
  const ageWhy = ageBlockReason(card, restrict);
  if (ageWhy) return ageWhy;
  const ban = bannedColourFor(g, player, card);
  if (ban) return `Ramblin' River Markets: ${ban.toLowerCase()} is off-limits for you this age.`;
  if (isDominant(card) && player.dominants >= RULES.dominantLimit &&
      !(restrict.heroicFree && norm(card.name) === "heroic")) {
    return `You have already played ${RULES.dominantLimit} dominant traits.`;
  }
  const h = registry[norm(card.name)];
  if (h && h.canPlay && !h.canPlay(g, player, card)) {
    return card.effect || "Its requirement is not met.";
  }
  return null;
}
/** Ramblin' River Markets: colours a player may not play this age. */
function bannedColourFor(g, player, card) {
  const bans = (g.colourBans && g.colourBans.round === g.round && g.colourBans.by[player.id]) || [];
  return bans.find((c) => hasColour(card, c)) || null;
}
function playableCards(g, player, registry) {
  return player.hand.filter((c) => canPlayCard(g, player, c, registry));
}

function* playTraitInner(g, player, uid, registry, { ignoreAction = false, free = false, suppressReactions = false } = {}) {
  const i = player.hand.findIndex((c) => c.uid === uid);
  if (i < 0) return null;
  const card = player.hand[i];
  if (!canPlayCard(g, player, card, registry)) return null;

  const h = registry[norm(card.name)] || {};

  // A Requirement's cost is paid before the card lands.
  if (h.cost) {
    const paid = yield* h.cost(makeCtx(g, player, card, registry));
    if (paid === false) return null;
  }

  // Look the card up again: a cost can reshuffle the hand (Fabled discards from
  // it, and a discarded trait can make its owner draw).
  const at = player.hand.findIndex((c) => c.uid === uid);
  if (at < 0) return null;
  player.hand.splice(at, 1);
  player.traitPile.push(card);
  if (isDominant(card)) player.dominants++;
  if (!free) g.playsLeft = Math.max(0, g.playsLeft - 1);
  say(g, `${player.name} played ${card.name}.`);
  const onOwnTurn = g.phase === "turn" && g.activeSeat === player.id;
  if (onOwnTurn) (g.turnPlays ||= []).push(card.uid);
  // The Legend of Mokoko Village: the extra play only counts with actions ignored.
  if (onOwnTurn && g.ignoreActionsFor === player.id) ignoreAction = true;

  // Age of Peace suppresses every action for the round. Work that out first:
  // an ignored action is not "an action about to resolve", so nobody should be
  // offered Automimicry / Chromatophores to stop it.
  const peace = Boolean(activeRestrict(topAge(g)).ignoreActions) && isAction(card);

  // Reaction window: anyone holding an interrupt may answer this play before
  // its action resolves. Parasitic can also steal the card out from under it,
  // which is why the window opens after the card has landed, not before.
  const event = {
    type: "traitPlayed",
    card,
    actor: player,
    isAction: isAction(card) && Boolean(h.onPlay) && !ignoreAction && !peace,
    cancelled: false,
  };
  if (!suppressReactions) {
    yield* offerReactions(g, "traitPlayed", event, registry);
  }

  // Cards already in a trait pile that watch for plays (Self-Replicating).
  if (!suppressReactions) {
    for (const p of g.players) {
      for (const held of p.traitPile.slice()) {
        const hh = registry[norm(held.name)];
        if (hh && hh.onTraitPlayed) {
          yield* hh.onTraitPlayed(makeCtx(g, p, held, registry), event);
        }
      }
    }
  }

  if (event.cancelled) {
    say(g, `${card.name}'s action was stopped.`);
    return card;
  }

  // Parasitic may have moved the card to another pile; its action still does
  // not resolve, which the cancelled flag above already handled.
  if (peace) say(g, `${card.name}'s action is ignored this age.`);

  // Ravenous: "When you play a red trait on your turn, draw 3 cards before
  // playing its effect."
  if (onOwnTurn && hasColour(card, "Red") &&
      player.traitPile.some((c) => norm(c.name) === "ravenous" && c.uid !== card.uid)) {
    drawMany(g, player, 3);
    say(g, `Ravenous: ${player.name} drew 3.`);
  }

  if (!ignoreAction && !peace && h.onPlay) {
    yield* asSource(g, player, card, h.onPlay(makeCtx(g, player, card, registry)));
  }
  yield* flushLeaves(g, registry);
  return card;
}

/** Public entry: start playing a card. Returns {done} or {done:false,request}. */
function playTrait(g, uid, registry) {
  const player = seatOf(g);
  if (g.phase !== "turn" || g.playsLeft <= 0 || g.pending) return { done: true, ok: false };
  return runEffect(g, (function* () {
    const v = g.venomous;
    const card = yield* playTraitInner(g, player, uid, registry);
    if (card && v && g.venomous === v) yield* settleVenomous(g, registry);
    yield* flushLeaves(g, registry);
    return card;
  })());
}

/** Venomous: "Play 1 more trait. Then move Venomous to an opponent's trait
 *  pile." Runs once that extra trait has been played. */
function* settleVenomous(g, registry) {
  const v = g.venomous;
  g.venomous = null;
  if (!v) return;
  const owner = g.players.find((p) => p.id === v.playerId);
  if (!owner || !owner.traitPile.some((c) => c.uid === v.uid)) return;  // already moved on
  const opps = opponentsOf(g, owner);
  if (!opps.length) return;
  const target = yield {
    kind: "player",
    playerId: owner.id,
    prompt: "Venomous — move it to whose pile?",
    options: opps.map((p) => ({ id: p.id, name: p.name })),
  };
  const opp = opps.find((p) => p.id === (target && target.id)) || opps[0];
  const moved = moveTrait(g, owner, opp, v.uid, registry);
  if (moved) say(g, `Venomous moved to ${opp.name}'s pile.`);
}

/* ------------------------------------------------------------------ *
 * Card abilities (Overlush): things a card lets you do from your hand or
 * pile on your own turn, outside the normal play — Nimble, Seedwing, and the
 * "play at any time" cards (Lucky, Trippy, Booster). The UI shows a button.
 * ------------------------------------------------------------------ */
function abilityOf(g, p, card, registry) {
  const h = registry[norm(card.name)];
  const a = h && h.ability;
  if (!a || !p || g.pending) return null;
  const where = a.from === "pile" ? p.traitPile : p.hand;
  if (!where.some((c) => c.uid === card.uid)) return null;
  if (a.ownTurn && !(g.phase === "turn" && g.activeSeat === p.id)) return null;
  if (a.eligible && !a.eligible(g, p, card)) return null;
  if (a.from !== "pile" && !a.eligible && !canPlayCard(g, p, card, registry)) return null;
  return a;
}
function useAbility(g, uid, registry) {
  const p = seatOf(g);
  const card = p.hand.find((c) => c.uid === uid) || p.traitPile.find((c) => c.uid === uid);
  const a = card && abilityOf(g, p, card, registry);
  if (!a) return { done: true, ok: false };
  say(g, `${p.name} used ${card.name}.`);
  return runEffect(g, (function* () {
    yield* asSource(g, p, card, a.use(makeCtx(g, p, card, registry)));
    yield* flushLeaves(g, registry);
  })());
}

/* ------------------------------------------------------------------ *
 * Effect runner — drives generators and parks them on game.pending.
 * ------------------------------------------------------------------ */
function runEffect(g, gen) {
  return stepEffect(g, gen, undefined);
}

function stepEffect(g, gen, input) {
  const { value, done } = gen.next(input);
  if (done) {
    g.pending = null;
    return { done: true, ok: true, value };
  }
  g.pending = { request: value, gen };
  return { done: false, request: value };
}

/** Answer the outstanding request. Same call for humans and bots. */
function answer(g, response) {
  if (!g.pending) return { done: true, ok: false };
  const { gen } = g.pending;
  g.pending = null;
  return stepEffect(g, gen, response);
}

/* ------------------------------------------------------------------ *
 * Reaction windows
 *
 * Six base-game cards play OUT of turn. Rather than six special cases, every
 * one of them declares a `reactive` block naming the window it listens on, and
 * the turn flow opens those windows at the right moments.
 *
 * Windows:
 *   traitPlayed     a trait has just entered a pile, before its action resolves
 *   afterStabilize  the active player has stabilized, before the turn ends
 *   worldsEnd       the final catastrophe has turned over
 *
 * A responder is only ever asked when they actually hold an eligible card, so
 * in practice these windows are silent almost every turn.
 * ------------------------------------------------------------------ */

/** Cap on reaction chains — a Parasitic can be met by a Parasitic, and without
 *  a ceiling a pathological hand could ping-pong forever. */
const MAX_REACTION_DEPTH = 3;
function playersFrom(g, startSeat) {
  const n = g.players.length;
  return Array.from({ length: n }, (_, k) => g.players[(startSeat + k) % n]);
}

function eligibleReactions(g, player, windowName, event, registry) {
  return player.hand.filter((c) => {
    const r = (registry[norm(c.name)] || {}).reactive;
    if (!r) return false;
    // A dominant answering out of turn still counts toward the limit of two.
    if (isDominant(c) && player.dominants >= RULES.dominantLimit) return false;
    const windows = [].concat(r.window || []);
    if (!windows.includes(windowName)) return false;
    return r.eligible ? r.eligible(g, player, event, c) : true;
  });
}

/**
 * Offer a reaction window to every player holding something that listens on it.
 * Mutates `event` — a responder may set `event.cancelled`.
 */
function* offerReactions(g, windowName, event, registry) {
  g.reactionDepth = (g.reactionDepth || 0);
  if (g.reactionDepth >= MAX_REACTION_DEPTH) return event;
  g.reactionDepth++;
  try {
    // Turn order starting from whoever is active, so priority is deterministic.
    for (const p of playersFrom(g, g.activeSeat)) {
      const options = eligibleReactions(g, p, windowName, event, registry);
      if (!options.length) continue;

      const choice = yield {
        kind: "reaction",
        window: windowName,
        playerId: p.id,
        playerName: p.name,
        optional: true,
        prompt: reactionPrompt(windowName, event, p),
        event: {
          type: event.type,
          cardName: event.card ? event.card.name : null,
          actorName: event.actor ? event.actor.name : null,
          isAction: Boolean(event.isAction),
        },
        options: options.map((c) => ({ uid: c.uid, name: c.name })),
      };

      const uid = choice && (typeof choice === "string" ? choice : choice.uid);
      if (!uid) continue;
      const card = p.hand.find((c) => c.uid === uid);
      if (!card) continue;

      // The interrupt enters play for free — it does not spend a turn's play.
      const i = p.hand.findIndex((c) => c.uid === uid);
      p.hand.splice(i, 1);
      const r = registry[norm(card.name)].reactive;

      if (r.intoPile) {
        // Quills: lands in a pile the card itself names (the remover's).
        const owner = r.intoPile(g, p, event) || p;
        owner.traitPile.push(card);
        if (isDominant(card)) owner.dominants++;
        say(g, `${p.name} played ${card.name} into ${owner.name}'s pile.`);
      } else if (r.intoAnyPile) {
        // Self-Awareness: choose whose pile it lands in.
        const target = yield {
          kind: "player",
          playerId: p.id,
          prompt: `${card.name} — into whose trait pile?`,
          options: g.players.map((x) => ({ id: x.id, name: x.name })),
        };
        const owner = g.players.find((x) => x.id === (target && target.id)) || p;
        owner.traitPile.push(card);
        if (isDominant(card)) owner.dominants++;
        say(g, `${p.name} played ${card.name} into ${owner.name}'s pile.`);
      } else {
        p.traitPile.push(card);
        if (isDominant(card)) p.dominants++;
        say(g, `${p.name} played ${card.name} in response.`);
      }

      if (r.respond) {
        yield* asSource(g, p, card, r.respond(makeCtx(g, p, card, registry), event));
      }

      if (event.cancelled) break;
    }
  } finally {
    g.reactionDepth--;
  }
  return event;
}

function reactionPrompt(windowName, event, p) {
  if (windowName === "traitPlayed") {
    const who = event.actor && event.actor.id === p.id ? "You" : (event.actor || {}).name;
    return `${who} played ${event.card ? event.card.name : "a trait"} — respond?`;
  }
  if (windowName === "afterStabilize") return "You have stabilized — play anything?";
  if (windowName === "worldsEnd") return "World's End — play anything from hand?";
  if (windowName === "traitRemoved") {
    const whose = event.owner && event.owner.id === p.id ? "your" : `${(event.owner || {}).name}'s`;
    return `${event.card ? event.card.name : "A trait"} left ${whose} trait pile — respond?`;
  }
  if (windowName === "catastrophe") return `${event.card ? event.card.name : "A catastrophe"} turned over — respond?`;
  if (windowName === "roundEnd") return "Everyone has had their turn — play anything?";
  if (windowName === "afterAge") return "The age has resolved — play anything?";
  return "Respond?";
}

/* ------------------------------------------------------------------ *
 * Turn flow
 * ------------------------------------------------------------------ */

/** The hand size this player must reach, under the face-up age. */
function targetHand(g, p) {
  return stabilizeTarget(p, activeRestrict(topAge(g)), g);
}
/** Prosperity, or Apricity ("If you hold 8 or fewer cards, you may choose not
 *  to stabilize"): ending the turn without stabilizing is allowed. */
function mayskipStabilize(g, p) {
  if (activeRestrict(topAge(g)).stabilizeOptional) return true;
  return p.hand.length <= 8 && p.traitPile.some((c) => norm(c.name) === "apricity");
}
/** Cheek Pouches: "Do not stabilize this turn." */
const noStabilize = (g, p) => g.noStabilizeFor != null && g.noStabilizeFor === p.id;
/** Cards that change HOW you stabilize, so the engine does the drawing
 *  (Scavenger, Whistler, The Living Library) instead of the UI's auto-draw. */
function engineStabilizes(g, p) {
  if (activeRestrict(topAge(g)).replayBeforeStabilize && !g.libraryUsed) return true;
  return p.traitPile.some((c) => ["scavenger", "whistler"].includes(norm(c.name)));
}
const isStabilized = (g, p) => {
  const restrict = activeRestrict(topAge(g));
  if (mayskipStabilize(g, p)) return true;            // Prosperity, Apricity
  if (noStabilize(g, p)) return true;                 // Cheek Pouches
  const target = stabilizeTarget(p, restrict, g);
  if (drawBlocked(g, p) && p.hand.length <= target) return true;   // Star Tails
  const slack = restrict.stabilizePlus || 0;          // Coastal Formations
  if (p.hand.length === target) return true;
  if (slack && p.hand.length > target && p.hand.length <= target + slack) return true;
  if (g.stabilizeWaived) return true;
  return p.hand.length < target && !g.traitDeck.length && !g.discard.length;
};
function canEndTurn(g) {
  const p = seatOf(g);
  if (g.phase !== "turn" || g.pending) return false;
  const played = g.playsLeft === 0 || g.stabilizeWaived;
  if (played && engineStabilizes(g, p) && p.hand.length <= targetHand(g, p)) return true;
  return played && isStabilized(g, p);
}

/**
 * End the turn, opening the afterStabilize window first (Late, Self-Awareness).
 * This is the entry point the UI and bots should call; `endTurn` below is the
 * plain version used once reactions have resolved.
 */
function beginEndTurn(g, registry) {
  if (!canEndTurn(g)) return { done: true, ok: false };
  return runEffect(g, (function* () {
    const actor = seatOf(g);
    yield* beforeStabilize(g, actor, registry);
    yield* offerReactions(g, "afterStabilize", { type: "afterStabilize", actor }, registry);
    yield* afterStabilize(g, actor, registry);
    // Procrastination: "after last player's turn ends, take another turn".
    const last = (g.activeSeat + 1) % g.players.length === g.firstSeat;
    if (last && !g.inExtraTurn) {
      yield* offerReactions(g, "roundEnd", { type: "roundEnd", actor }, registry);
    }
    yield* flushLeaves(g, registry);
    // The next player's start-of-turn effects run INSIDE this effect. Starting a
    // second runner here would be dropped when this one finishes — which is how
    // the second player used to miss "each player" age prompts.
    endTurn(g, registry, false);
    if (g.phase === "turn") yield* turnStartEffects(g, registry);
  })());
}
function endTurn(g, registry, startNow = true) {
  if (g.phase !== "turn") return false;
  g.playsLeft = 0;
  g.stabilizeWaived = false;
  g.venomous = null;
  resetTurnState(g);

  const next = (g.activeSeat + 1) % g.players.length;
  if (g.extraTurnFor != null && !g.inExtraTurn && (next === g.firstSeat)) {
    // Procrastination: one more turn this age, before the next flip.
    g.activeSeat = g.extraTurnFor;
    g.inExtraTurn = true;
    g.extraTurnFor = null;
    say(g, `${g.players[g.activeSeat].name} takes another turn (Procrastination).`);
    if (startNow) startTurn(g, registry);
    else g.playsLeft = 1;
    return true;
  }
  if (next === g.firstSeat || g.inExtraTurn) {
    g.inExtraTurn = false;
    g.extraTurnFor = null;
    g.phase = "age";
    g.activeSeat = g.firstSeat;
  } else {
    g.activeSeat = next;
    if (startNow) startTurn(g, registry);
    else g.playsLeft = 1;
  }
  return true;
}

/** Per-turn bookkeeping for Overlush cards, cleared between turns. */
function resetTurnState(g) {
  g.turnPlays = [];
  g.noStabilizeFor = null;
  g.noDrawFor = null;
  g.ignoreActionsFor = null;
  g.skimmerUsed = false;
  g.libraryUsed = false;
  g.clock = (g.clock || 0) + 1;
}

/** Start-of-turn triggers (Echolocation). Returns a runner result. */
function startTurn(g, registry) {
  g.playsLeft = 1;
  return runEffect(g, turnStartEffects(g, registry));
}

/** What the active player owes at the start of their turn: the age, then
 *  Persistent traits (Echolocation). */
function* turnStartEffects(g, registry) {
  const p = seatOf(g);
  const age = topAge(g);
  const ah = ageHandler(age);
  const ageOwed = ah && ah.each && !(g.ageApplied || []).includes(p.id);
  const holders = p.traitPile.filter((c) => {
    const h = registry[norm(c.name)];
    return h && h.onTurnStart;
  });

  // The age acts first — it may change the hand the player then plays from.
  if (ageOwed) {
    (g.ageApplied ||= []).push(p.id);
    g.inAgeEffect = true;
    try { yield* asSource(g, null, age, ah.each(makeCtx(g, p, age, registry))); }
    finally { g.inAgeEffect = false; }
    yield* flushLeaves(g, registry);
    yield* offerReactions(g, "afterAge", { type: "afterAge", actor: p }, registry);
  }
  for (const c of holders) {
    const h = registry[norm(c.name)];
    if (!p.traitPile.some((x) => x.uid === c.uid)) continue;
    yield* asSource(g, p, c, h.onTurnStart(makeCtx(g, p, c, registry)));
    yield* flushLeaves(g, registry);
  }
}

/**
 * Overlush cards that change how a turn ends. "Before you stabilize" runs
 * first (The Living Library, Whistler), then the engine draws any shortfall
 * itself when Scavenger lets you draw from the discard instead.
 */
function* beforeStabilize(g, p, registry) {
  const lib = activeRestrict(topAge(g)).replayBeforeStabilize;
  if (lib && !g.libraryUsed) {
    g.libraryUsed = true;
    const h = registry["__replay"];
    if (h) yield* h(makeCtx(g, p, topAge(g), registry), "The Living Library — replay an action in your pile?");
  }
  if (noStabilize(g, p)) return;
  if (p.traitPile.some((c) => norm(c.name) === "whistler") && p.hand.length) {
    const picked = yield {
      kind: "cards", playerId: p.id, from: "hand", count: 0, max: Math.min(2, p.hand.length), optional: true,
      prompt: "Whistler — discard up to 2 before you stabilize?",
      options: p.hand.map((c) => ({ uid: c.uid, name: c.name })),
    };
    for (const x of picked || []) discardFromHand(g, p, typeof x === "string" ? x : x.uid);
  }
  if (mayskipStabilize(g, p) && !engineStabilizes(g, p)) return;
  const target = targetHand(g, p);
  if (p.hand.length >= target) return;
  if (p.traitPile.some((c) => norm(c.name) === "scavenger") && g.discard.length) {
    const yes = yield {
      kind: "confirm", playerId: p.id,
      prompt: `Scavenger — stabilize from the top of the discard pile (${g.discard[0].name} on top)?`,
    };
    if (yes) {
      while (p.hand.length < target && g.discard.length) p.hand.push(g.discard.shift());
      say(g, `${p.name} stabilized from the discard pile (Scavenger).`);
    }
  }
  let guard = 0;
  while (p.hand.length < target && guard++ < 20) if (!drawCard(g, p)) break;
}

function* afterStabilize(g, p, registry) {
  for (const c of p.traitPile.slice()) {
    const h = registry[norm(c.name)];
    if (h && h.afterStabilize && p.traitPile.some((x) => x.uid === c.uid)) {
      yield* asSource(g, p, c, h.afterStabilize(makeCtx(g, p, c, registry)));
    }
  }
  // Swamplands: "If you play any traits with actions, discard them after you
  // stabilize, wherever they are."
  if (activeRestrict(topAge(g)).discardPlayedActions) {
    for (const uid of (g.turnPlays || []).slice()) {
      const at = findAnywhere(g, uid);
      if (!at || !isAction(at.list[at.i])) continue;
      const card = at.list[at.i];
      if (at.where === "traitPile") yield* discardTrait(g, at.player, uid, registry);
      else if (at.where === "hand") discardFromHand(g, at.player, uid);
      else continue;
      say(g, `Swamplands: ${card.name} was discarded.`);
    }
  }
}

/** Empty hand: draw 5 and skip. Stuck: dump hand, draw 3. Neither stabilizes. */
function cantPlay(g) {
  const p = seatOf(g);
  if (!p.hand.length) {
    drawMany(g, p, RULES.emptyHandDraw);
    say(g, `${p.name} had an empty hand — drew ${RULES.emptyHandDraw} and skipped.`);
  } else {
    discardHand(g, p);
    drawMany(g, p, RULES.stuckDraw);
    say(g, `${p.name} couldn't play — discarded their hand and drew ${RULES.stuckDraw}.`);
  }
  g.stabilizeWaived = true;
  g.playsLeft = 0;
  return true;
}

/**
 * Flip the next age. A catastrophe rotates the first player and closes the era;
 * the THIRD one ends the world immediately.
 */
function flipAge(g, registry) {
  if (g.phase !== "age" || !g.ageDeck.length || g.pending) return false;

  if (g.pendingNewEra) {
    g.currentEra = Math.min(g.currentEra + 1, g.eras.length - 1);
    g.pendingNewEra = false;
  }

  const card = g.ageDeck.shift();
  g.eras[g.currentEra].push(card);
  g.round++;
  g.ageApplied = [];            // the new age owes every player its effect
  resetTurnState(g);

  if (isCatastrophe(card)) {
    const ignorers = g.players.filter((p) => p.flags.denialArmed);
    g.catastrophes++;
    const last = g.catastrophes >= g.eras.length;

    if (last) {
      say(g, `${card.name} — the final catastrophe. The world ends.`, true);
      g.phase = "worldsEnd";
      return true;
    }

    for (const p of ignorers) {
      p.flags.denialArmed = false;
      say(g, `${p.name} ignored ${card.name} with Denial.`);
    }

    g.firstSeat = (g.firstSeat + 1) % g.players.length;
    g.pendingNewEra = true;
    say(g, `Catastrophe ${g.catastrophes}: ${card.name}. First player is now ${g.players[g.firstSeat].name}.`, true);

    // Revealing a catastrophe ENDS the era. Players apply its effects and the
    // round is over — nobody takes a turn. The next flip opens a new era.
    g.activeSeat = g.firstSeat;
    g.playsLeft = 0;
    g.phase = "age";
    return true;
  }

  say(g, `Age flipped: ${card.name}.`);
  g.activeSeat = g.firstSeat;
  g.phase = "turn";
  startTurn(g, registry);
  return true;
}

/**
 * Effects a freshly turned age or catastrophe owes immediately.
 *
 *  - onReveal runs once for the table (Awakening's preview, hands passing).
 *  - a catastrophe's Gene Pool delta and white text hit EVERY player, in turn
 *    order starting from the first player, because the era ends here and
 *    nobody gets a turn to apply it on.
 */
function* resolveAgeReveal(g, registry) {
  const card = topAge(g);
  if (!card) return;
  const h = ageHandler(card);
  if (!h) return;

  g.inAgeEffect = true;
  try {
    if (h.onReveal) yield* asSource(g, null, card, h.onReveal(makeCtx(g, seatOf(g), card, registry)));
  } finally { g.inAgeEffect = false; }
  yield* flushLeaves(g, registry);

  if (isCatastrophe(card)) {
    // Sleepy: "play after a catastrophe is turned to ignore the Gene Pool effect."
    if (typeof h.gp === "number" && h.gp !== 0) {
      yield* offerReactions(g, "catastrophe", { type: "catastrophe", card }, registry);
    }
    for (const p of playersFrom(g, g.firstSeat)) {
      if (p.flags.sleepyRound === g.round) {
        say(g, `${p.name} slept through ${card.name}'s Gene Pool change (Sleepy).`);
      } else if (typeof h.gp === "number" && h.gp !== 0) {
        const moved = adjustGenePool(g, p, h.gp);
        say(g, moved
          ? `${p.name} gene pool ${h.gp > 0 ? "+" : ""}${h.gp} → ${p.genePool}.`
          : `${p.name}'s gene pool is at its limit — ${card.name}'s change is ignored.`);
      }
      if (h.each) {
        g.inAgeEffect = true;
        try { yield* asSource(g, null, card, h.each(makeCtx(g, p, card, registry))); }
        finally { g.inAgeEffect = false; }
        yield* flushLeaves(g, registry);
      }
    }
    yield* offerReactions(g, "afterAge", { type: "afterAge", actor: null }, registry);
  }
}

/* ------------------------------------------------------------------ *
 * World's End
 * ------------------------------------------------------------------ */

/**
 * Resolve World's End before scoring: first the play-from-hand window (Sneaky),
 * then every onWorldsEnd handler in turn order starting from the first player.
 * Scoring is a separate call so the UI can show the board in between.
 */
function* resolveWorldsEnd(g, registry) {
  if (g.worldsEndResolved) return;
  g.worldsEndResolved = true;

  // 1. Play-from-hand window (Sneaky).
  yield* offerReactions(g, "worldsEnd", { type: "worldsEnd" }, registry);

  // 2. Prepper chooses WHICH catastrophe the table ends on. Default is the
  //    one that just turned over.
  const revealed = g.eras.flat().filter(isCatastrophe);
  let ender = revealed[revealed.length - 1] || null;

  const prepper = g.players.find((p) =>
    p.traitPile.some((c) => norm(c.name) === "prepper"));

  if (prepper && revealed.length > 1) {
    const choice = yield {
      kind: "choose",
      playerId: prepper.id,
      prompt: "Prepper — choose which catastrophe everyone ends on",
      sub: "Read each one, check the trait piles, then confirm.",
      showPiles: true,
      options: revealed.map((c) => ({ uid: c.uid, name: c.name })),
    };
    const picked = revealed.find((c) => c.uid === (choice && choice.uid));
    if (picked) {
      ender = picked;
      say(g, `Prepper: the table ends on ${picked.name}.`, true);
    }
  }
  g.endingCatastrophe = ender;

  // 3. The ending catastrophe's World's End text.
  const ch = ageHandler(ender);
  if (ch && ch.worldsEnd) {
    yield* asSource(g, null, ender, ch.worldsEnd(makeCtx(g, seatOf(g), ender, registry)));
    yield* flushLeaves(g, registry);
  }

  // 4. Trait World's End effects, in turn order.
  for (const p of playersFrom(g, g.firstSeat)) {
    for (const card of p.traitPile.slice()) {
      const h = registry[norm(card.name)];
      if (h && h.onWorldsEnd && p.traitPile.some((x) => x.uid === card.uid)) {
        yield* asSource(g, p, card, h.onWorldsEnd(makeCtx(g, p, card, registry)));
        yield* flushLeaves(g, registry);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */
const faceScore = (player) =>
  player.traitPile.reduce((n, c) => n + faceValue(c), 0);

/**
 * Final scoring. Drop of Life bonuses are generators because a few need a
 * decision ("if there's a tie, pick 1"), so this runs through the same
 * request/answer machinery as everything else.
 */
function* scoreGame(g, registry) {
  const results = [];
  for (const p of g.players) {
    let bonus = 0;

    // Per-card line items, so the UI can walk a player through their score
    // rather than just naming a number.
    const faceLines = p.traitPile
      .filter((c) => faceValue(c) !== 0)
      .map((c) => ({ kind: "face", uid: c.uid, name: c.name, amount: faceValue(c) }));
    const bonusLines = [];

    for (const card of p.traitPile) {
      if (card.aiSuppressed) continue;        // AI Takeover ignores these
      const h = registry[norm(card.name)];
      if (h && h.score) {
        const n = yield* h.score(makeCtx(g, p, card, registry));
        if (n) {
          bonus += n;
          bonusLines.push({ kind: "bonus", uid: card.uid, name: card.name, amount: n });
        }
      }
    }
    // Effects that penalise OTHER players (Viral) register as `scoreOthers`.
    results.push({ id: p.id, name: p.name, face: faceScore(p), bonus, faceLines, bonusLines });
  }

  for (const p of g.players) {
    for (const card of p.traitPile) {
      const h = registry[norm(card.name)];
      if (h && h.scoreOthers) {
        const deltas = yield* h.scoreOthers(makeCtx(g, p, card, registry));
        for (const [id, d] of Object.entries(deltas || {})) {
          const row = results.find((r) => r.id === Number(id));
          if (row && d) {
            row.bonus += d;
            row.bonusLines.push({
              kind: "bonus", uid: card.uid, name: card.name, amount: d, from: p.name,
            });
          }
        }
      }
    }
  }

  // The ending catastrophe's World's End scoring (Ice Age, Grey Goo, ...).
  const ch = ageHandler(g.endingCatastrophe);
  if (ch && ch.weScore) {
    const deltas = yield* ch.weScore(makeCtx(g, seatOf(g), g.endingCatastrophe, registry));
    for (const [id, d] of Object.entries(deltas || {})) {
      const row = results.find((r) => r.id === Number(id));
      if (row && d) {
        row.bonus += d;
        row.bonusLines.push({
          kind: "bonus", name: g.endingCatastrophe.name, amount: d, from: "World's End",
        });
      }
    }
  }

  for (const r of results) {
    const p = g.players.find((x) => x.id === r.id);
    r.adjust = p.adjust || 0;
    r.total = r.face + r.bonus + r.adjust;
  }
  results.sort((a, b) => b.total - a.total);
  g.scores = results;
  g.phase = "over";
  return results;
}

/**
 * Read-only breakdown of one final score row, for the Final scores screen:
 * the player's trait cards plus the line items grouped the way the scoring
 * walkthrough shows them. The line amounts always add up to s.total.
 */
function scoreBreakdown(g, s) {
  const p = g.players.find((x) => x.id === s.id);
  const sections = [
    { title: "Face values", lines: (s.faceLines || []).slice() },
    { title: "Drop of Life bonuses", lines: (s.bonusLines || []).slice() },
    { title: "Adjustments", lines: s.adjust ? [{ kind: "adjust", name: "Gene Pool adjustments", amount: s.adjust }] : [] },
  ].filter((x) => x.lines.length);
  const sum = (ls) => ls.reduce((a, l) => a + l.amount, 0);
  return {
    cards: p ? p.traitPile.slice() : [],
    sections,
    face: sum(s.faceLines || []),
    bonus: sum(s.bonusLines || []),
    adjust: s.adjust || 0,
  };
}

/** Everyone sharing the top total (more than one means a tie). */
function scoreWinners(scores) {
  if (!scores || !scores.length) return [];
  const top = Math.max(...scores.map((s) => s.total));
  return scores.filter((s) => s.total === top).map((s) => s.id);
}
