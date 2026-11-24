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
const allCards = JSON.parse(m[1]);
// The base game is what most of these tests (and the original rules suite) are
// about; Overlush gets its own fuzzing further down.
const cards = allCards.filter((c) => c.set === 'base');
const overlush = allCards.filter((c) => c.set === 'overlush');
const count = (t) => cards.filter((c) => c.card_type === t).length;
assert.strictEqual(count('Trait'), 113, 'base game has 113 traits');
assert.strictEqual(overlush.filter((c) => c.card_type === 'Trait').length, 135, 'Overlush has 135 traits');
assert.strictEqual(overlush.filter((c) => /catastrophe/i.test(c.subtype)).length, 15, 'Overlush has 15 catastrophes');
assert(count('Age') > 0, 'age deck is empty');
assert(cards.some((c) => /catastrophe/i.test(c.subtype)), 'no catastrophes (subtype column lost?)');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
assert(scripts.length >= 2, 'expected the card-data and game script blocks');
scripts.forEach((src, i) => new vm.Script(src, { filename: `doomlings/index.html#script${i}` }));

console.log(`Doomlings: ${cards.length} base + ${overlush.length} Overlush cards, ${scripts.length} script blocks compile`);

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
const breakdown = vm.runInContext('scoreBreakdown', ctx);
const winners = vm.runInContext('scoreWinners', ctx);
// ties: everyone on the top total wins
assert.deepStrictEqual([...winners([{ id: 2, total: 30 }, { id: 0, total: 30 }, { id: 1, total: 12 }])], [2, 0]);
assert.deepStrictEqual([...winners([{ id: 1, total: 31 }, { id: 0, total: 30 }])], [1]);

let games = 0;
for (let seed = 1; seed <= 300; seed++) {
  const players = 2 + (seed % 5);
  const { g, traitCount } = run(cards, seed, players);
  assert.strictEqual(g.phase, 'over', `seed ${seed}: game did not reach scoring`);
  assert.strictEqual(g.scores.length, players, `seed ${seed}: missing scores`);
  assert.strictEqual(traitCount, 113, `seed ${seed}: traits were lost or duplicated`);
  // #27: the Final scores breakdown must add up to each player's total, and every
  // card line must point at a card in that player's trait pile.
  for (const sc of g.scores) {
    const b = breakdown(g, sc);
    const lines = b.sections.flatMap((x) => x.lines);
    assert.strictEqual(lines.reduce((a, l) => a + l.amount, 0), sc.total, `seed ${seed}: ${sc.name} breakdown != total`);
    assert.strictEqual(b.face + b.bonus + b.adjust, sc.total, `seed ${seed}: ${sc.name} sum check`);
    const uids = new Set(b.cards.map((c) => c.uid));
    for (const l of lines) if (l.uid && l.from == null) assert(uids.has(l.uid), `seed ${seed}: ${l.name} not in ${sc.name}'s pile`);
  }
  const w = winners(g.scores);
  assert(w.length >= 1 && w.every((id) => g.scores.find((x) => x.id === id).total === g.scores[0].total), `seed ${seed}: winners`);
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

// ---------------------------------------------------------------------------
// Regression (#7): Venomous is "Play 1 more trait. THEN move Venomous". It
// moves only after that extra trait is played, and Lonely Age ("Cannot play
// more than 1 trait on your turn") blocks the extra play, so it stays put.
// ---------------------------------------------------------------------------
const venomCheck = vm.runInContext(`(function (cards, ageName, playExtra) {
  resetUids();
  const g = dealGame(cards, { names: ['A', 'B'], seed: 7 });
  const take = (name) => {
    for (const pile of [g.traitDeck, g.discard, ...g.players.map((p) => p.hand)]) {
      const i = pile.findIndex((c) => c.name === name);
      if (i >= 0) return pile.splice(i, 1)[0];
    }
    throw new Error('card not found: ' + name);
  };
  g.eras[0].push({ ...cards.find((c) => c.name.toLowerCase() === ageName), uid: 'forced-age' });
  g.phase = 'turn'; g.activeSeat = 0; g.playsLeft = 1;
  const [a, b] = g.players;
  a.hand = [take('VENOMOUS'), take('ADORABLE')];
  b.hand = [];
  const where = () => (a.traitPile.some((c) => c.name === 'VENOMOUS') ? 'A' : b.traitPile.some((c) => c.name === 'VENOMOUS') ? 'B' : '?');
  const drive = (r) => { while (!r.done) r = answer(g, r.request.kind === 'player' ? r.request.options[0] : null); };
  drive(playTrait(g, a.hand[0].uid, EFFECTS));
  const afterVenomous = { where: where(), playsLeft: g.playsLeft };
  if (playExtra && g.playsLeft > 0) drive(playTrait(g, a.hand.find((c) => c.name === 'ADORABLE').uid, EFFECTS));
  return { afterVenomous, final: where(), adorablePlayed: a.traitPile.some((c) => c.name === 'ADORABLE') };
})`, ctx);
{
  const normal = venomCheck(cards, 'flourish', true);
  assert.strictEqual(normal.afterVenomous.where, 'A', 'Venomous moved before the extra trait was played');
  assert.strictEqual(normal.afterVenomous.playsLeft, 1, 'Venomous should grant 1 more play');
  assert(normal.adorablePlayed, 'extra trait was not played');
  assert.strictEqual(normal.final, 'B', 'Venomous did not move after the extra trait');
  const lonely = venomCheck(cards, 'lonely age', true);
  assert.strictEqual(lonely.afterVenomous.playsLeft, 0, 'Lonely Age: Venomous granted an extra play');
  assert(!lonely.adorablePlayed, 'Lonely Age: a second trait was played');
  assert.strictEqual(lonely.final, 'A', 'Lonely Age: Venomous moved even though no extra trait could be played');
}
console.log('Doomlings: Venomous moves after the extra trait; Lonely Age blocks extra plays');

// Lonely Age also switches off "you may play it now" (Cold Blood, Nosy, Clever,
// Photosynthesis) on your own turn (PR #16 review).
const coldBloodCheck = vm.runInContext(`(function (cards, ageName) {
  resetUids();
  const g = dealGame(cards, { names: ['A', 'B'], seed: 9 });
  const take = (name) => {
    for (const pile of [g.traitDeck, g.discard, ...g.players.map((p) => p.hand)]) {
      const i = pile.findIndex((c) => c.name === name);
      if (i >= 0) return pile.splice(i, 1)[0];
    }
    throw new Error('card not found: ' + name);
  };
  g.eras[0].push({ ...cards.find((c) => c.name.toLowerCase() === ageName), uid: 'forced-age' });
  g.phase = 'turn'; g.activeSeat = 0; g.playsLeft = 1;
  const a = g.players[0];
  a.hand = [take('COLD BLOOD')];
  g.players[1].hand = [];
  const asked = [];
  let r = playTrait(g, a.hand[0].uid, EFFECTS);
  while (!r.done) { asked.push(r.request); r = answer(g, r.request.kind === 'cards' ? [] : null); }
  return { offered: asked.some((q) => /cold blood/i.test(q.prompt || '')), drew: a.hand.length };
})`, ctx);
{
  const lonely = coldBloodCheck(cards, 'lonely age');
  assert.strictEqual(lonely.drew, 3, 'Lonely Age: Cold Blood should still draw 3');
  assert(!lonely.offered, 'Lonely Age: Cold Blood still offered to play a drawn card');
  const normal = coldBloodCheck(cards, 'flourish');
  assert(normal.offered, 'control: Cold Blood should offer to play a drawn card');
}
console.log('Doomlings: Lonely Age also blocks "you may play it now"');

// Lonely Age also blocks playing from the discard pile (Selective Memory, Trunk,
// Self-Replicating) on your own turn (PR #16 review).
const discardPlayCheck = vm.runInContext(`(function (cards, ageName) {
  resetUids();
  const g = dealGame(cards, { names: ['A', 'B'], seed: 11 });
  const take = (name) => {
    for (const pile of [g.traitDeck, g.discard, ...g.players.map((p) => p.hand)]) {
      const i = pile.findIndex((c) => c.name === name);
      if (i >= 0) return pile.splice(i, 1)[0];
    }
    throw new Error('card not found: ' + name);
  };
  g.eras[0].push({ ...cards.find((c) => c.name.toLowerCase() === ageName), uid: 'forced-age' });
  g.phase = 'turn'; g.activeSeat = 0; g.playsLeft = 1;
  const a = g.players[0];
  a.hand = [take('TRUNK')];
  g.players[1].hand = [];
  g.discard.unshift(take('ADORABLE'));
  let r = playTrait(g, a.hand[0].uid, EFFECTS);
  while (!r.done) r = answer(g, r.request.kind === 'cards' ? [] : null);
  return { piled: a.traitPile.map((c) => c.name).join(',') };
})`, ctx);
{
  const lonely = discardPlayCheck(cards, 'lonely age');
  assert.strictEqual(lonely.piled, 'TRUNK', 'Lonely Age: Trunk still played a card from the discard pile');
  const normal = discardPlayCheck(cards, 'flourish');
  assert.strictEqual(normal.piled, 'TRUNK,ADORABLE', 'control: Trunk should play the top discard');
}
console.log('Doomlings: Lonely Age also blocks plays from the discard pile');
// Regression (#17): swiping between cards in the card viewer froze the page.
// Every card open added another pair of touch listeners to #sheetBody, so each
// swipe ran all the old handlers, which re-rendered and added even more.
// Run the whole UI script against a tiny fake DOM and swipe through a hand.
// ---------------------------------------------------------------------------
{
  const noop = () => {};
  class FakeEl {
    constructor(tag) {
      this.tagName = (tag || 'div').toUpperCase();
      this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {};
      this.hidden = false; this.disabled = false; this.value = ''; this.textContent = '';
      const cls = new Set();
      this.classList = {
        add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)),
        toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : on; v ? cls.add(c) : cls.delete(c); return v; },
        contains: (c) => cls.has(c),
      };
      this.style = new Proxy({ setProperty: noop, removeProperty: noop }, { set: () => true });
    }
    set innerHTML(v) { this.children = []; } get innerHTML() { return ''; }
    set className(v) { this.classList.add(...String(v).split(/\s+/).filter(Boolean)); }
    appendChild(c) { this.children.push(c); return c; }
    append(...c) { c.forEach((x) => this.appendChild(x)); }
    prepend(...c) { this.children.unshift(...c); }
    replaceChildren(...c) { this.children = c; }
    remove() {} insertBefore(c) { return this.appendChild(c); } removeChild() {}
    setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; } removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
    fire(t, e) { (this.listeners[t] || []).slice().forEach((f) => f(e)); }
    querySelector() { return new FakeEl(); } querySelectorAll() { return []; }
    closest() { return null; } contains() { return false; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
    scrollIntoView() {} scrollTo() {} focus() {} blur() {} click() {} select() {}
  }
  const byId = new Map();
  const get = (sel) => { if (!byId.has(sel)) byId.set(sel, new FakeEl()); return byId.get(sel); };
  const document = {
    querySelector: get, getElementById: (id) => get('#' + id), querySelectorAll: () => [],
    createElement: (t) => new FakeEl(t), createTextNode: (t) => ({ textContent: t }),
    addEventListener: noop, removeEventListener: noop, body: new FakeEl('body'), documentElement: new FakeEl('html'),
    visibilityState: 'visible', hidden: false,
  };
  const store = {};
  const win = {
    document, console, setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop, addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    navigator: { userAgent: 'test', vibrate: noop }, location: { search: '', hash: '', href: 'http://x/' },
    history: { replaceState: noop, pushState: noop }, innerWidth: 411, innerHeight: 751,
    getComputedStyle: () => ({ getPropertyValue: () => '' }), performance: { now: () => 0 },
  };
  win.window = win; win.self = win; win.globalThis = win;
  const uiCtx = vm.createContext(win);
  scripts.forEach((src, i) => vm.runInContext(src, uiCtx, { filename: `doomlings-ui#${i}` }));

  const body = get('#sheetBody');
  const hand = vm.runInContext('window.__DOOMLINGS_CARDS__', uiCtx).filter((c) => c.card_type === 'Trait').slice(0, 5)
    .map((c, i) => ({ ...c, uid: 'swipe' + i }));
  uiCtx.__hand = hand;
  vm.runInContext('openCard(__hand[0], { siblings: __hand })', uiCtx);
  const swipe = (dx) => {
    body.fire('touchstart', { touches: [{ clientX: 200, clientY: 300 }] });
    body.fire('touchend', { changedTouches: [{ clientX: 200 + dx, clientY: 300 }] });
  };
  const index = () => vm.runInContext('sheetNav && sheetNav.index', uiCtx);
  for (let k = 0; k < 20; k++) swipe(k % 7 === 6 ? 120 : -120);
  assert.strictEqual((body.listeners.touchend || []).length, 1, 'card viewer keeps adding swipe listeners (#17)');
  assert.strictEqual((body.listeners.touchstart || []).length, 1, 'card viewer keeps adding swipe listeners (#17)');
  assert.strictEqual(index(), 4, 'swiping should land on the last card');
  swipe(120); swipe(120);
  assert.strictEqual(index(), 2, 'swiping right should go back two cards');
  // A plain sheet afterwards must not react to swipes.
  vm.runInContext('openSheet(() => {})', uiCtx);
  assert.strictEqual(body.classList.contains('cd-swipe'), false, 'cd-swipe left on a non-card sheet');
  swipe(-120);
  assert.strictEqual(index(), null, 'a swipe on a later sheet jumped back to a stale card');
  console.log('Doomlings: card viewer swipe keeps one listener and stops after the viewer closes');
}

// ---------------------------------------------------------------------------
// Bots: full games where every seat is a bot (engine/bots.js), mixed levels.
// ---------------------------------------------------------------------------
{
  const botDriver = `
var __botRun = function (cards, seed, levels) {
  resetUids();
  const g = dealGame(cards, { names: levels.map((l, i) => l + i), seed, bots: levels.map(() => true) });
  const lv = (id) => levels[id];
  const pump = () => { let k = 0; while (g.pending) { if (k++ > 500) throw new Error('runaway pending'); const r = g.pending.request; const who = r.playerId != null ? r.playerId : g.activeSeat; answer(g, botAnswer(g, r, who, lv(who))); } };
  const drive = (gen) => { let r = gen.next(), k = 0; while (!r.done) { if (k++ > 500) throw new Error('runaway effect'); const who = r.value.playerId != null ? r.value.playerId : g.activeSeat; r = gen.next(botAnswer(g, r.value, who, lv(who))); } };
  let steps = 0, fails = 0;
  while (g.phase !== 'over') {
    if (steps++ > 4000) throw new Error('bot game did not finish');
    if (g.phase === 'age') { flipAge(g, EFFECTS); pump(); drive(resolveAgeReveal(g, EFFECTS)); if (g.phase === 'worldsEnd') { drive(resolveWorldsEnd(g, EFFECTS)); drive(scoreGame(g, EFFECTS)); } continue; }
    const p = seatOf(g);
    if (g.playsLeft > 0 && !g.stabilizeWaived) {
      const uid = fails < 3 ? botChoosePlay(g, EFFECTS, lv(p.id)) : null;
      if (uid) { playTrait(g, uid, EFFECTS); pump(); if (g.playsLeft > 0) fails++; } else { cantPlay(g); fails = 0; }
      continue;
    }
    fails = 0;
    const t = targetHand(g, p);
    while (p.hand.length < t && drawCard(g, p));
    if (!activeRestrict(topAge(g)).stabilizeOptional) for (const uid of botStabilizeDiscards(g, p, t)) discardFromHand(g, p, uid);
    const r = beginEndTurn(g, EFFECTS); pump();
    if (r.ok === false && !r.request) throw new Error('bot could not end turn');
  }
  return g;
};`;
  vm.runInContext(botDriver, ctx, { filename: 'doomlings-bots' });
  const botRun = vm.runInContext('__botRun', ctx);
  const wins = { easy: 0, normal: 0, hard: 0 };
  const N = +(process.env.DOOM_BOT_GAMES || 40);
  for (let seed = 1; seed <= N; seed++) {
    const n = 2 + (seed % 3);
    const levels = Array.from({ length: n }, (_, i) => ['easy', 'normal', 'hard'][(i + seed) % 3]);
    const g = botRun(cards, seed, levels);
    assert.strictEqual(g.phase, 'over', `bot seed ${seed}: no score`);
    const top = g.scores[0].total;
    for (const s of g.scores) if (s.total === top) wins[levels[s.id]]++;
  }
  console.log(`Doomlings bots: ${N} games, wins by level ${JSON.stringify(wins)}`);
  assert(wins.normal + wins.hard > wins.easy, 'smarter bots should win more');
}

// ---------------------------------------------------------------------------
// Overlush: every card scripted, then base + Overlush games played to scoring,
// first with random answers (to shake out every prompt path) and then by bots.
// ---------------------------------------------------------------------------
{
  const pool = cards.concat(overlush);
  const coverage = vm.runInContext('coverage', ctx);
  const ageHandler = vm.runInContext('ageHandler', ctx);
  const cov = coverage(pool);
  assert.deepStrictEqual([...cov.missing], [], 'traits with text but no script: ' + cov.missing.join(', '));
  const ageless = pool.filter((c) => c.card_type === 'Age' && !ageHandler(c)).map((c) => c.name);
  assert.deepStrictEqual(ageless, [], 'ages/catastrophes with no handler: ' + ageless.join(', '));

  const traitTotal = pool.filter((c) => c.card_type === 'Trait').length;
  const N = +(process.env.DOOM_OVERLUSH_GAMES || 300);
  for (let seed = 1; seed <= N; seed++) {
    const players = 2 + (seed % 5);
    let res;
    try { res = run(pool, 1000 + seed, players); } catch (e) { e.message = `Overlush seed ${1000 + seed} (${players}p): ${e.message}`; throw e; }
    const { g, traitCount } = res;
    assert.strictEqual(g.phase, 'over', `Overlush seed ${seed}: game did not reach scoring`);
    assert.strictEqual(traitCount, traitTotal, `Overlush seed ${seed}: traits were lost or duplicated`);
    for (const p of g.players) {
      assert(p.genePool >= 1 && p.genePool <= 8, `Overlush seed ${seed}: gene pool out of range`);
      const doms = p.traitPile.filter((c) => /dominant/i.test(c.subtype));
      // Birth of a Hero lets Heroic in as a third (rulebook p.6).
      const limit = doms.some((c) => c.name === 'HEROIC') ? 3 : 2;
      assert(doms.length <= limit, `Overlush seed ${seed}: ${p.name} has ${doms.length} dominants`);
    }
    for (const sc of g.scores) {
      const b = breakdown(g, sc);
      assert.strictEqual(b.face + b.bonus + b.adjust, sc.total, `Overlush seed ${seed}: ${sc.name} sum check`);
      assert(Number.isFinite(sc.total), `Overlush seed ${seed}: score is not a number`);
    }
  }
  console.log(`Doomlings + Overlush: all ${cov.total} traits scripted; ${N} fuzzed games played to scoring`);

  const botRun = vm.runInContext('__botRun', ctx);
  const BN = +(process.env.DOOM_OVERLUSH_BOT_GAMES || 30);
  for (let seed = 1; seed <= BN; seed++) {
    const n = 2 + (seed % 4);
    const levels = Array.from({ length: n }, (_, i) => ['easy', 'normal', 'hard'][(i + seed) % 3]);
    const g = botRun(pool, 2000 + seed, levels);
    assert.strictEqual(g.phase, 'over', `Overlush bot seed ${seed}: no score`);
  }
  console.log(`Doomlings + Overlush bots: ${BN} games played to scoring`);
}

// ---------------------------------------------------------------------------
// Overlush rule hooks, one scripted situation each.
// ---------------------------------------------------------------------------
{
  const pool = cards.concat(overlush);
  vm.runInContext(`var __scene = function (cards, spec) {
    resetUids();
    const g = dealGame(cards, { names: spec.names || ['A', 'B'], seed: 3 });
    const take = (name) => {
      for (const pile of [g.traitDeck, g.discard, ...g.players.flatMap((p) => [p.hand, p.traitPile])]) {
        const i = pile.findIndex((c) => c.name === name);
        if (i >= 0) return pile.splice(i, 1)[0];
      }
      const proto = cards.find((c) => c.name === name);
      if (!proto) throw new Error('card not found: ' + name);
      return tag(proto);
    };
    g.eras[0].push({ ...cards.find((c) => c.name.toLowerCase() === (spec.age || 'flourish')), uid: 'forced-age' });
    g.phase = 'turn'; g.activeSeat = 0; g.firstSeat = 0; g.playsLeft = 1; g.ageApplied = g.players.map((p) => p.id);
    g.players.forEach((p, i) => {
      p.hand = (spec.hands[i] || []).map(take);
      p.traitPile = (spec.piles[i] || []).map(take);
      p.dominants = p.traitPile.filter(isDominant).length;
    });
    const asked = [];
    const answerWith = spec.answer || ((req) => req.kind === 'reaction' ? req.options[0] : req.kind === 'trait' ? (req.options.find((o) => !o.disabled) || null) : req.kind === 'cards' ? req.options.slice(0, req.count || 0) : req.kind === 'player' ? req.options[0] : true);
    const drive = (r) => { let k = 0; while (r && !r.done) { if (k++ > 200) throw new Error('runaway'); asked.push(r.request); r = answer(g, answerWith(r.request, g)); } return r; };
    const play = (name) => drive(playTrait(g, g.players[g.activeSeat].hand.find((c) => c.name === name).uid, EFFECTS));
    const names = (list) => list.map((c) => c.name).join(',');
    return { g, play, drive, asked, names, A: g.players[0], B: g.players[1] };
  };`, ctx);
  const scene = (spec) => vm.runInContext('__scene', ctx)(pool, spec);

  // Patches: a stolen trait comes straight back.
  {
    const s = scene({ hands: [['SELFISH'], ['PATCHES']], piles: [[], ['FIRE SKIN']] });
    s.play('SELFISH');
    assert.strictEqual(s.names(s.B.traitPile.slice().sort((x, y) => x.name.localeCompare(y.name))), 'FIRE SKIN,PATCHES', 'Patches should return the stolen trait: ' + s.names(s.B.traitPile));
    assert.strictEqual(s.names(s.A.traitPile), 'SELFISH', 'Patches: thief kept the trait');
  }
  // Quills: played into the remover's pile.
  {
    const s = scene({ hands: [['SELFISH'], ['QUILLS']], piles: [[], ['FIRE SKIN']] });
    s.play('SELFISH');
    assert(s.A.traitPile.some((c) => c.name === 'QUILLS'), 'Quills should land in the remover\'s pile');
  }
  // Ironwood: a small green pile can't be stolen from.
  {
    const s = scene({ hands: [['TINY LITTLE MELONS'], []], piles: [[], ['IRONWOOD', 'BARK']] });
    s.play('TINY LITTLE MELONS');
    assert(s.B.traitPile.some((c) => c.name === 'BARK'), 'Ironwood should keep Bark in place');
  }
  // Muse: discarded from hand, it lands in the pile instead.
  {
    const s = scene({ hands: [[], ['MUSE']], piles: [[], []] });
    vm.runInContext('discardFromHand', ctx)(s.g, s.B, s.B.hand[0].uid);
    assert.strictEqual(s.names(s.B.traitPile), 'MUSE', 'Muse should be played when discarded from hand');
    assert.strictEqual(s.B.dominants, 1, 'Muse counts as a dominant');
  }
  // Fabled: pays 4 colours from hand, and Fabled itself ends up in the pile, once.
  {
    const s = scene({ hands: [['FABLED', 'BARK', 'BLUBBER', 'BRAVE', 'DREAMER'], []], piles: [[], []] });
    s.play('FABLED');
    assert.strictEqual(s.names(s.A.traitPile), 'FABLED', 'Fabled should be played');
    assert.strictEqual(s.A.hand.length, 0, 'Fabled should discard 4 cards of different colours: ' + s.names(s.A.hand));
  }
  // Epic fills both dominant slots.
  {
    const s = scene({ hands: [['EPIC', 'HEROIC'], []], piles: [[], []] });
    s.play('EPIC');
    const canPlay = vm.runInContext('canPlayCard', ctx);
    assert.strictEqual(s.A.dominants, 2, 'Epic should count as two dominants');
    assert(!canPlay(s.g, s.A, s.A.hand[0], vm.runInContext('EFFECTS', ctx)), 'no third dominant after Epic');
  }
  // Cheek Pouches: draw 2, end the turn without stabilizing.
  {
    const s = scene({ hands: [['CHEEK POUCHES'], []], piles: [[], []] });
    s.A.genePool = 8;
    s.play('CHEEK POUCHES');
    const before = s.A.hand.length;
    s.drive(vm.runInContext('beginEndTurn', ctx)(s.g, vm.runInContext('EFFECTS', ctx)));
    assert.strictEqual(before, 2, 'Cheek Pouches draws 2');
    assert.strictEqual(s.A.hand.length, 2, 'Cheek Pouches: the hand was stabilized anyway');
    assert.strictEqual(s.g.activeSeat, 1, 'Cheek Pouches: the turn should end');
  }
  // Procrastination: the last player's turn ends, the holder takes another turn.
  {
    const s = scene({ hands: [['BARK'], ['PROCRASTINATION', 'BLUBBER']], piles: [[], []] });
    s.g.activeSeat = 1; s.B.genePool = 1;
    s.drive(vm.runInContext('playTrait', ctx)(s.g, s.B.hand.find((c) => c.name === 'BLUBBER').uid, vm.runInContext('EFFECTS', ctx)));
    s.drive(vm.runInContext('beginEndTurn', ctx)(s.g, vm.runInContext('EFFECTS', ctx)));
    assert.strictEqual(s.g.phase, 'turn', 'Procrastination: the round should not end yet');
    assert.strictEqual(s.g.activeSeat, 1, 'Procrastination: the holder takes another turn');
    assert(s.B.traitPile.some((c) => c.name === 'PROCRASTINATION'), 'Procrastination should be in the pile');
  }
  console.log('Doomlings + Overlush: Patches, Quills, Ironwood, Muse, Fabled, Epic, Cheek Pouches and Procrastination behave');
}
