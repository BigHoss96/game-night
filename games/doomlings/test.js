// Doomlings smoke test. The full rules suite (unit tests + fuzzed games) lives with the
// engine sources in the Doomlings project; this file only guards the bundled build that
// the site serves: the card data is intact and every script block compiles.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const m = html.match(/window\.__DOOMLINGS_CARDS__ = (\[.*\]);/);
assert(m, 'inlined card data not found');
const cards = JSON.parse(m[1]);
const count = (t) => cards.filter((c) => c.card_type === t).length;
assert.strictEqual(count('Trait'), 113, 'base game has 113 traits');
assert(count('Age') > 0, 'age deck is empty');
assert(cards.some((c) => /catastrophe/i.test(c.subtype)), 'no catastrophes (subtype column lost?)');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
assert(scripts.length >= 2, 'expected the card-data and game script blocks');
scripts.forEach((src, i) => new vm.Script(src, { filename: `doomlings/index.html#script${i}` }));

console.log(`Doomlings: ${cards.length} cards, ${scripts.length} script blocks compile`);

// ---------------------------------------------------------------------------
// Rules engine: run the engine part of the bundle in a sandbox and play games
// with a random bot answering every prompt the way a player could.
// ---------------------------------------------------------------------------
const engineSrc = html.slice(html.indexOf('/* ---- engine/ages.js ---- */'), html.indexOf('/* ---- mobile/ui.js ---- */'));
assert(engineSrc.length > 1000, 'engine section markers not found');

const driver = `
var __run = function (cards, seed, players, setup) {
  resetUids();
  const g = dealGame(cards, { names: Array.from({ length: players }, (_, i) => 'P' + i), seed });
  if (setup) setup(g);
  const rnd = makeRng(seed * 7 + 1);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const asked = [];
  const auto = (req) => {
    asked.push(req);
    switch (req.kind) {
      case 'colour': return pick(req.options && req.options.length ? req.options : COLOURS);
      case 'player': return pick(req.options);
      case 'confirm': return rnd() < 0.5;
      case 'cards': {
        const n = req.optional ? Math.floor(rnd() * ((req.max || 1) + 1)) : Math.min(req.count || 1, req.options.length);
        return req.options.slice().sort(() => rnd() - 0.5).slice(0, n);
      }
      case 'trait': { const ok = req.options.filter((o) => !o.disabled); return ok.length ? pick(ok) : null; }
      case 'reaction': return rnd() < 0.3 ? pick(req.options) : null;
      case 'blind': return Array.from({ length: req.total }, (_, i) => i).sort(() => rnd() - 0.5).slice(0, req.count);
      case 'choose': return pick(req.options);
      default: throw new Error('unknown request kind ' + req.kind);
    }
  };
  const drive = (gen) => { let r = gen.next(); let k = 0; while (!r.done) { if (k++ > 500) throw new Error('runaway effect'); r = gen.next(auto(r.value)); } return r.value; };
  const pump = () => { let k = 0; while (g.pending) { if (k++ > 500) throw new Error('runaway pending'); answer(g, auto(g.pending.request)); } };
  let steps = 0, fails = 0;
  while (g.phase !== 'over') {
    if (steps++ > 4000) throw new Error('game did not finish');
    if (g.phase === 'age') {
      flipAge(g, EFFECTS); pump(); drive(resolveAgeReveal(g, EFFECTS));
      if (g.phase === 'worldsEnd') { drive(resolveWorldsEnd(g, EFFECTS)); drive(scoreGame(g, EFFECTS)); }
      continue;
    }
    const p = seatOf(g);
    if (g.playsLeft > 0 && !g.stabilizeWaived) {
      const legal = playableCards(g, p, EFFECTS);
      if (legal.length && fails < 3) { const r = playTrait(g, pick(legal).uid, EFFECTS); pump(); if (g.playsLeft > 0) fails++; }
      else { cantPlay(g); fails = 0; }
      continue;
    }
    fails = 0;
    const t = targetHand(g, p);
    while (p.hand.length < t && drawCard(g, p));
    while (p.hand.length > t && !activeRestrict(topAge(g)).stabilizeOptional) discardFromHand(g, p, p.hand[0].uid);
    const r = beginEndTurn(g, EFFECTS); pump();
    if (r.ok === false && !r.request) throw new Error('could not end turn');
  }
  const all = [...g.traitDeck, ...g.discard, ...g.players.flatMap((x) => [...x.hand, ...x.traitPile])];
  return { g, asked, traitCount: all.filter(isTrait).length };
};
`;
const ctx = vm.createContext({ console });
vm.runInContext(engineSrc + driver, ctx, { filename: 'doomlings-engine' });
const run = vm.runInContext('__run', ctx);

let games = 0;
for (let seed = 1; seed <= 300; seed++) {
  const players = 2 + (seed % 5);
  const { g, traitCount } = run(cards, seed, players);
  assert.strictEqual(g.phase, 'over', `seed ${seed}: game did not reach scoring`);
  assert.strictEqual(g.scores.length, players, `seed ${seed}: missing scores`);
  assert.strictEqual(traitCount, 113, `seed ${seed}: traits were lost or duplicated`);
  games++;
}

// Regression: an "each player" age that asks a question must ask EVERY player,
// not just whoever started the round.
// Put the age right after The Birth of Life (only 9 ages are dealt, so it may
// not be in this game's deck at all).
const forceAge = (name) => (g) => {
  const i = g.ageDeck.findIndex((c) => c.name.toLowerCase() === name);
  const card = i >= 0 ? g.ageDeck.splice(i, 1)[0]
    : { ...cards.find((c) => c.name.toLowerCase() === name), uid: 'forced' };
  g.ageDeck.splice(1, 0, card);
};
for (const age of ['high tides', 'age of exploration', 'northern winds']) {
  for (let seed = 1; seed <= 20; seed++) {
    const { asked } = run(cards, seed, 3, forceAge(age));
    const who = new Set(asked.filter((r) => (r.prompt || '').toLowerCase().startsWith(age)).map((r) => r.playerId));
    assert.strictEqual(who.size, 3, `${age} (seed ${seed}) asked ${who.size} of 3 players`);
  }
}
console.log(`Doomlings: ${games} fuzzed games played to scoring; each-player ages ask everyone`);

// ---------------------------------------------------------------------------
// Regression (#5): under Age of Peace an action is ignored, so it must not run
// and nobody should be offered Automimicry/Chromatophores to "stop" it.
// ---------------------------------------------------------------------------
const peaceCheck = vm.runInContext(`(function (cards, ageName) {
  resetUids();
  const g = dealGame(cards, { names: ['A', 'B'], seed: 5 });
  const take = (name) => {
    const all = [g.traitDeck, g.discard, ...g.players.map((p) => p.hand)];
    for (const pile of all) {
      const i = pile.findIndex((c) => c.name === name);
      if (i >= 0) return pile.splice(i, 1)[0];
    }
    throw new Error('card not found: ' + name);
  };
  const age = g.ageDeck.find((c) => c.name.toLowerCase() === ageName) ||
    { ...cards.find((c) => c.name.toLowerCase() === ageName), uid: 'forced-age' };
  g.eras[0].push(age);
  g.phase = 'turn'; g.activeSeat = 0; g.playsLeft = 1;
  const [a, b] = g.players;
  a.hand = [take('INTROSPECTIVE')];
  b.hand = [take('AUTOMIMICRY')];
  const before = a.hand.length;
  const asked = [];
  let r = playTrait(g, a.hand[0].uid, EFFECTS);
  while (!r.done) { asked.push(r.request); r = answer(g, r.request.kind === 'reaction' ? null : undefined); }
  return { reactions: asked.filter((q) => q.kind === 'reaction').length, drew: a.hand.length - (before - 1) };
})`, ctx);
{
  const peace = peaceCheck(cards, 'age of peace');
  assert.strictEqual(peace.drew, 0, 'Age of Peace: Introspective still drew cards');
  assert.strictEqual(peace.reactions, 0, 'Age of Peace: opponent was offered to stop an ignored action');
  const normal = peaceCheck(cards, 'flourish');
  assert.strictEqual(normal.drew, 3, 'control: Introspective should draw 3 outside Age of Peace');
  assert.strictEqual(normal.reactions, 1, 'control: Automimicry should be offered against a live action');
}
console.log('Doomlings: Age of Peace ignores actions and offers no stop-the-action reactions');
