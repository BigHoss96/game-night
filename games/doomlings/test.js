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
