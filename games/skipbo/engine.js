// Skip-Bo rules + bots. Pure functions over a plain game object; no DOM.
// Cards: { id, v: 1..12 | 'SB' (wild) }. 162 cards: twelve of each number and 18 wilds.
(function (root) {
'use strict';
const isSB = c => c.v === 'SB';
function makeDeck() { const d = []; let id = 0; for (let k = 0; k < 12; k++) for (let v = 1; v <= 12; v++) d.push({ id: id++, v }); for (let k = 0; k < 18; k++) d.push({ id: id++, v: 'SB' }); return d; }
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const stockSize = (n, quick) => quick ? (n <= 4 ? 15 : 10) : (n <= 4 ? 30 : 20);

function newGame(players, opts, rng) {
  rng = rng || Math.random;
  const g = { players: players.map(p => ({ name: p.name, bot: !!p.bot, level: p.level || 'normal', hand: [], stock: [], discards: [[], [], [], []] })),
    opts: Object.assign({ quick: false }, opts || {}), build: [[], [], [], []], done: [], deck: shuffle(makeDeck(), rng), over: false, winner: null, log: [] };
  const n = stockSize(g.players.length, g.opts.quick);
  for (let k = 0; k < n; k++) g.players.forEach(p => p.stock.push(g.deck.pop()));
  g.turn = Math.floor(rng() * g.players.length);
  startTurn(g, rng);
  return g;
}
function log(g, e) { g.log.push(e); if (g.log.length > 200) g.log.splice(0, g.log.length - 200); }
function refill(g, rng) { if (g.deck.length || !g.done.length) return; g.deck = shuffle(g.done, rng || Math.random); g.done = []; }
function fillHand(g, pi, rng) { const p = g.players[pi]; while (p.hand.length < 5) { refill(g, rng); if (!g.deck.length) break; p.hand.push(g.deck.pop()); } }
function startTurn(g, rng) { fillHand(g, g.turn, rng); g.step = 'play'; }

const need = (g, b) => g.build[b].length + 1;                // the number a build pile wants next
const fits = (g, card, b) => isSB(card) || card.v === need(g, b);
const stockTop = p => p.stock[p.stock.length - 1];
// where a card comes from: { from: 'hand', id } | { from: 'stock' } | { from: 'discard', k }
function cardAt(g, pi, src) {
  const p = g.players[pi];
  if (src.from === 'hand') return p.hand.find(c => c.id === src.id);
  if (src.from === 'stock') return stockTop(p);
  const pile = p.discards[src.k]; return pile && pile[pile.length - 1];
}
function canPlay(g, pi, src, b) { const c = cardAt(g, pi, src); return !!c && g.step === 'play' && pi === g.turn && b >= 0 && b < 4 && fits(g, c, b); }
function play(g, pi, src, b, rng) {
  if (!canPlay(g, pi, src, b)) throw new Error("that card can't go there");
  const p = g.players[pi];
  let card;
  if (src.from === 'hand') card = p.hand.splice(p.hand.findIndex(c => c.id === src.id), 1)[0];
  else if (src.from === 'stock') card = p.stock.pop();
  else card = p.discards[src.k].pop();
  const as = need(g, b);
  g.build[b].push(Object.assign({}, card, { as }));            // remember what a wild stood for
  const ev = { t: 'play', p: pi, card, from: src.from, b, as };
  if (g.build[b].length === 12) { g.done.push(...g.build[b].map(c => ({ id: c.id, v: c.v }))); g.build[b] = []; ev.cleared = true; }
  log(g, ev); g.passes = 0;
  if (!p.stock.length) { g.over = true; g.winner = pi; g.step = 'over'; log(g, { t: 'win', p: pi }); return ev; }
  if (!p.hand.length) { fillHand(g, pi, rng); ev.refilled = true; }   // empty hand mid-turn: draw five more
  return ev;
}
// End the turn by putting a hand card on one of your four discard piles.
function discard(g, pi, id, k, rng) {
  const p = g.players[pi];
  if (pi !== g.turn || g.step !== 'play' || k < 0 || k > 3) throw new Error('cannot discard now');
  const i = p.hand.findIndex(c => c.id === id); if (i < 0) throw new Error('card not in hand');
  p.discards[k].push(p.hand.splice(i, 1)[0]);
  log(g, { t: 'discard', p: pi, k });
  g.turn = (pi + 1) % g.players.length;
  startTurn(g, rng);
}
// A player with no cards in hand (deck ran dry) just passes.
function pass(g, pi) {
  if (g.players[pi].hand.length) throw new Error('discard to end your turn');
  g.passes = (g.passes || 0) + 1;
  // nobody can draw or play: fewest stock cards left wins
  if (g.passes >= g.players.length) { const m = Math.min(...g.players.map(p => p.stock.length)); g.over = true; g.winner = g.players.findIndex(p => p.stock.length === m); g.step = 'over'; return; }
  g.turn = (pi + 1) % g.players.length; startTurn(g);
}

// ---------- bots ----------
// Search for a chain of plays (hand cards and discard tops) that lets the stock card go down.
function sources(g, pi) {
  const p = g.players[pi], out = [];
  const seen = new Set();
  for (const c of p.hand) { const key = 'h' + c.v; if (seen.has(key)) continue; seen.add(key); out.push({ from: 'hand', id: c.id }); }
  p.discards.forEach((pile, k) => { if (pile.length) out.push({ from: 'discard', k }); });
  return out;
}
function cloneLite(g) { return { players: g.players.map(p => ({ hand: p.hand.slice(), stock: p.stock.slice(), discards: p.discards.map(d => d.slice()) })), build: g.build.map(b => b.slice()), turn: g.turn, step: 'play' }; }
function applyLite(s, pi, src, b) {
  const p = s.players[pi]; let card;
  if (src.from === 'hand') card = p.hand.splice(p.hand.findIndex(c => c.id === src.id), 1)[0];
  else if (src.from === 'stock') card = p.stock.pop();
  else card = p.discards[src.k].pop();
  s.build[b].push(card); if (s.build[b].length === 12) s.build[b] = [];
  return card;
}
// Returns the first move of the shortest plan that ends with a stock play, or null.
function planToStock(g, pi, maxDepth, saveWilds) {
  let best = null;
  const dfs = (s, depth, first, used) => {
    if (best && depth >= best.depth) return;
    const st = s.players[pi].stock[s.players[pi].stock.length - 1];
    for (let b = 0; b < 4; b++) if (st && (isSB(st) || st.v === s.build[b].length + 1)) { best = { depth, move: first || { src: { from: 'stock' }, b }, wilds: used }; return; }
    if (depth >= maxDepth) return;
    const p = s.players[pi];
    const srcs = [];
    const seen = new Set();
    for (const c of p.hand) { const key = 'h' + c.v; if (!seen.has(key)) { seen.add(key); srcs.push({ from: 'hand', id: c.id, c }); } }
    p.discards.forEach((pile, k) => { if (pile.length) srcs.push({ from: 'discard', k, c: pile[pile.length - 1] }); });
    for (const src of srcs) for (let b = 0; b < 4; b++) {
      if (!(isSB(src.c) || src.c.v === s.build[b].length + 1)) continue;
      if (isSB(src.c) && saveWilds && used >= 1) continue;
      const t = { players: s.players.map((q, i) => i === pi ? { hand: q.hand.slice(), stock: q.stock, discards: q.discards.map(d => d.slice()) } : q), build: s.build.map(x => x.slice()) };
      applyLite(t, pi, { from: src.from, id: src.id, k: src.k }, b);
      dfs(t, depth + 1, first || { src: { from: src.from, id: src.id, k: src.k }, b }, used + (isSB(src.c) ? 1 : 0));
    }
  };
  dfs(cloneLite(g), 0, null, 0);
  return best;
}
// Next bot move: { a: 'play', src, b } or { a: 'discard', id, k } (or { a: 'pass' }).
function botMove(g, pi, rng) {
  rng = rng || Math.random;
  const p = g.players[pi], lvl = p.level;
  const depth = lvl === 'easy' ? 1 : lvl === 'normal' ? 2 : 8;
  const plan = planToStock(g, pi, depth, lvl !== 'easy');
  if (plan) return { a: 'play', src: plan.move.src, b: plan.move.b };
  // free plays: hand numbers that fit (never wilds), so the hand empties and refills
  const next = g.players[(pi + 1) % g.players.length], nextTop = stockTop(next);
  for (const c of p.hand.slice().sort((a, b) => (a.v === 'SB') - (b.v === 'SB') || a.v - b.v)) {
    if (isSB(c)) continue;
    for (let b = 0; b < 4; b++) if (fits(g, c, b)) {
      // hard bots avoid setting up the next player's stock card
      if (lvl === 'hard' && nextTop && !isSB(nextTop) && nextTop.v === c.v + 1) continue;
      if (lvl === 'easy' && rng() < 0.6) continue;
      return { a: 'play', src: { from: 'hand', id: c.id }, b };
    }
  }
  // discard tops that fit, if it doesn't hand the next player their stock card
  for (let k = 0; k < 4; k++) { const pile = p.discards[k]; const c = pile[pile.length - 1]; if (!c || isSB(c)) continue;
    for (let b = 0; b < 4; b++) if (fits(g, c, b) && !(lvl === 'hard' && nextTop && !isSB(nextTop) && nextTop.v === c.v + 1)) return { a: 'play', src: { from: 'discard', k }, b }; }
  if (!p.hand.length) return { a: 'pass' };
  return Object.assign({ a: 'discard' }, chooseDiscard(g, pi, rng));
}
// keep piles in descending order so they can be played back later; wilds and the stock-adjacent card last
function chooseDiscard(g, pi, rng) {
  const p = g.players[pi], st = stockTop(p);
  let best = null;
  for (const c of p.hand) for (let k = 0; k < 4; k++) {
    const pile = p.discards[k], top = pile[pile.length - 1];
    let v = 0;
    if (isSB(c)) v -= 100;
    if (st && !isSB(st) && !isSB(c) && c.v < st.v && st.v - c.v <= 3) v -= 15;       // a step toward the stock card — keep it
    if (!isSB(c)) v += c.v * 0.6;
    if (!top) v += 4 - pile.length;
    else if (!isSB(top) && !isSB(c)) { if (top.v === c.v) v += 12; else if (top.v === c.v + 1) v += 10; else if (top.v > c.v) v += 4; else v -= 6 + (c.v - top.v); }
    v -= pile.length * 0.5;
    if (p.level === 'easy') v += rng() * 45;
    else if (p.level === 'normal') v += rng() * 10;
    if (!best || v > best.v) best = { v, id: c.id, k };
  }
  return { id: best.id, k: best.k };
}

const api = { makeDeck, stockSize, newGame, need, fits, cardAt, canPlay, play, discard, pass, stockTop, botMove, planToStock, isSB };
if (typeof module !== 'undefined') module.exports = api; else root.SB = api;
})(this);
