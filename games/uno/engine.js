// Uno rules + bots. Pure functions over a plain game object; no DOM.
// Cards: { id, c: 'R'|'Y'|'G'|'B'|'W', v: '0'..'9' | 'S' (skip) | 'R' (reverse) | 'D2' | 'W' | 'W4' }
// House rules (all off by default): stack (+2 on +2, +4 on +4), drawUntil (draw until you can play),
// sevenO (7 swaps hands, 0 rotates all hands), jumpIn (play an identical card out of turn).
(function (root) {
'use strict';
const COLORS = ['R', 'Y', 'G', 'B'];
const CNAME = { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue', W: 'Wild' };
const VNAME = { S: 'Skip', R: 'Reverse', D2: 'Draw Two', W: 'Wild', W4: 'Wild Draw Four' };
const DEFAULTS = { stack: false, drawUntil: false, sevenO: false, jumpIn: false, target: 500 };

function makeDeck() {
  const d = []; let id = 0;
  for (const c of COLORS) {
    d.push({ id: id++, c, v: '0' });
    for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'R', 'D2']) { d.push({ id: id++, c, v }); d.push({ id: id++, c, v }); }
  }
  for (let k = 0; k < 4; k++) { d.push({ id: id++, c: 'W', v: 'W' }); d.push({ id: id++, c: 'W', v: 'W4' }); }
  return d;   // 108
}
const points = card => /^\d$/.test(card.v) ? +card.v : card.c === 'W' ? 50 : 20;
const label = card => card.c === 'W' ? VNAME[card.v] : `${CNAME[card.c]} ${VNAME[card.v] || card.v}`;
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function newGame(players, opts, rng) {
  const g = { players: players.map(p => ({ name: p.name, bot: !!p.bot, level: p.level || 'normal', hand: [], score: 0 })),
    opts: Object.assign({}, DEFAULTS, opts || {}), round: 0, dealer: Math.floor((rng || Math.random)() * players.length), over: false, winner: null, log: [] };
  deal(g, rng); return g;
}
function deal(g, rng) {
  rng = rng || Math.random;
  g.round++; g.deck = shuffle(makeDeck(), rng); g.discard = []; g.dir = 1; g.pending = null; g.drawn = null; g.uno = null; g.roundWinner = null;
  g.players.forEach(p => { p.hand = []; });
  for (let k = 0; k < 7; k++) g.players.forEach(p => p.hand.push(g.deck.pop()));
  g.dealer = (g.dealer + 1) % g.players.length;
  g.turn = (g.dealer + 1) % g.players.length;
  g.phase = 'play';
  // flip the first card; a Wild Draw Four goes back in the deck
  let first;
  while (true) { first = g.deck.pop(); if (first.v !== 'W4') break; g.deck.unshift(first); shuffle(g.deck, rng); }
  g.discard.push(first); g.color = first.c === 'W' ? null : first.c;
  if (first.v === 'W') g.phase = 'color';                                  // first player names the color
  else if (first.v === 'S') g.turn = nextIdx(g, g.turn, 1);
  else if (first.v === 'R') { g.dir = -1; g.turn = g.dealer; }               // dealer starts, play goes the other way
  else if (first.v === 'D2') { drawN(g, g.turn, 2, rng); g.turn = nextIdx(g, g.turn, 1); }
  log(g, { t: 'start', card: first });
}
const top = g => g.discard[g.discard.length - 1];
const nextIdx = (g, i, steps) => { const n = g.players.length; return ((i + g.dir * (steps || 1)) % n + n) % n; };
function log(g, e) { g.log.push(e); if (g.log.length > 200) g.log.splice(0, g.log.length - 200); }

function refill(g, rng) {
  if (g.deck.length || g.discard.length < 2) return;
  const t = g.discard.pop(); g.deck = shuffle(g.discard, rng || Math.random); g.discard = [t];
}
function drawN(g, pi, n, rng) {
  const got = [];
  for (let k = 0; k < n; k++) { refill(g, rng); if (!g.deck.length) break; const c = g.deck.pop(); g.players[pi].hand.push(c); got.push(c); }
  return got;
}

// ---------- legality ----------
function canPlay(g, pi, card) {
  if (g.phase !== 'play' || pi !== g.turn) return false;
  if (g.drawn != null && card.id !== g.drawn) return false;           // after drawing you may only play that card
  const t = top(g);
  if (g.pending) return g.opts.stack && card.v === g.pending.v;
  if (card.v === 'W') return true;
  if (card.v === 'W4') return !g.players[pi].hand.some(c => c.c === g.color);   // only when you have no card of the color
  return card.c === g.color || card.v === t.v;
}
const legal = (g, pi) => g.players[pi].hand.filter(c => canPlay(g, pi, c));
const canJump = (g, pi, card) => g.opts.jumpIn && g.phase === 'play' && !g.pending && pi !== g.turn && card.c !== 'W' && card.c === top(g).c && card.v === top(g).v && g.color === card.c;

// ---------- actions ----------
// Play a card. color is required for wilds; target for a 7 when 7-0 is on (or chosen later via swap()).
function play(g, pi, cardId, color, rng, jump) {
  const p = g.players[pi], card = p.hand.find(c => c.id === cardId);
  if (!card) throw new Error('card not in hand');
  if (jump) { if (!canJump(g, pi, card)) throw new Error('cannot jump in'); g.turn = pi; }
  else if (!canPlay(g, pi, card)) throw new Error('illegal play ' + label(card));
  if (card.c === 'W' && COLORS.indexOf(color) < 0) throw new Error('pick a color');
  p.hand.splice(p.hand.indexOf(card), 1);
  g.discard.push(card); g.drawn = null;
  g.color = card.c === 'W' ? color : card.c;
  if (g.uno && g.uno.p !== pi) g.uno = null;                         // the window to catch someone closes
  if (p.hand.length === 1) g.uno = { p: pi, called: !!(g.unoArmed === pi) };
  g.unoArmed = null;
  const ev = { t: 'play', p: pi, card, color: g.color, jump: !!jump };
  log(g, ev);
  const n = g.players.length;
  let skip = 0;
  if (card.v === 'S') skip = 1;
  else if (card.v === 'R') { if (n === 2) skip = 1; else g.dir *= -1; }
  else if (card.v === 'D2' || card.v === 'W4') {
    const add = card.v === 'D2' ? 2 : 4;
    if (g.opts.stack) g.pending = { v: card.v, n: (g.pending ? g.pending.n : 0) + add };
    else { const vic = nextIdx(g, pi, 1); drawN(g, vic, add, rng); ev.victim = vic; ev.drew = add; skip = 1; }
  }
  if (!p.hand.length) { endRound(g, pi); return ev; }
  if (g.opts.sevenO && card.v === '0') { rotateHands(g); ev.rotate = true; }
  if (g.opts.sevenO && card.v === '7' && n > 1) { g.phase = 'seven'; g.sevenBy = pi; return ev; }
  g.turn = nextIdx(g, pi, 1 + skip);
  return ev;
}
function swap(g, pi, other) {
  if (g.phase !== 'seven' || g.sevenBy !== pi || other === pi) throw new Error('bad swap');
  const a = g.players[pi], b = g.players[other];
  [a.hand, b.hand] = [b.hand, a.hand];
  g.uno = null;
  log(g, { t: 'swap', p: pi, with: other });
  g.phase = 'play'; g.turn = nextIdx(g, pi, 1);
}
function rotateHands(g) {
  const hands = g.players.map(p => p.hand), n = hands.length;
  g.players.forEach((p, i) => { p.hand = hands[((i - g.dir) % n + n) % n]; });
  g.uno = null;
}
// Draw for your turn. With a stacked penalty pending you take it all and lose your turn.
// Returns { cards, playable } — if playable you may play it (or pass).
function draw(g, pi, rng) {
  if (pi !== g.turn || g.phase !== 'play' || g.drawn != null) throw new Error('cannot draw now');
  if (g.uno && g.uno.p !== pi) g.uno = null;
  if (g.pending) {
    const cards = drawN(g, pi, g.pending.n, rng);
    log(g, { t: 'penalty', p: pi, n: cards.length });
    g.pending = null; g.turn = nextIdx(g, pi, 1);
    return { cards, playable: null, penalty: true };
  }
  const cards = [];
  while (true) {
    const got = drawN(g, pi, 1, rng); if (!got.length) break;
    cards.push(got[0]);
    g.drawn = got[0].id;
    if (canPlay(g, pi, got[0])) { log(g, { t: 'draw', p: pi, n: cards.length }); return { cards, playable: got[0] }; }
    g.drawn = null;
    if (!g.opts.drawUntil) break;
  }
  g.drawn = null;
  log(g, { t: 'draw', p: pi, n: cards.length });
  g.turn = nextIdx(g, pi, 1);
  return { cards, playable: null };
}
function pass(g, pi) { if (pi !== g.turn || g.drawn == null) throw new Error('cannot pass'); g.drawn = null; g.turn = nextIdx(g, pi, 1); log(g, { t: 'pass', p: pi }); }
// Name the color when the first card flipped is a Wild
function chooseStartColor(g, color) { if (g.phase !== 'color') throw new Error('no color to choose'); g.color = color; g.phase = 'play'; }

// UNO: arm it before playing your second-to-last card, or call it right after.
function callUno(g, pi) {
  if (g.uno && g.uno.p === pi) { g.uno.called = true; return true; }
  if (g.players[pi].hand.length === 2 && pi === g.turn) { g.unoArmed = pi; return true; }
  return false;
}
function canCatch(g, by) { return !!(g.uno && !g.uno.called && g.uno.p !== by && g.players[g.uno.p].hand.length === 1); }
function catchUno(g, by, rng) {
  if (!canCatch(g, by)) return false;
  const vic = g.uno.p; drawN(g, vic, 2, rng); g.uno = null;
  log(g, { t: 'caught', p: vic, by }); return true;
}

function endRound(g, pi) {
  // a Draw Two / Draw Four as the last card still makes the next player draw
  if (g.pending) { drawN(g, nextIdx(g, pi, 1), g.pending.n); g.pending = null; }
  const pts = g.players.reduce((a, p, i) => i === pi ? a : a + p.hand.reduce((s, c) => s + points(c), 0), 0);
  g.players[pi].score += pts;
  g.roundWinner = pi; g.roundPoints = pts; g.phase = 'roundover'; g.uno = null;
  log(g, { t: 'out', p: pi, pts });
  if (!g.opts.target || g.players[pi].score >= g.opts.target) { g.over = true; g.winner = pi; }
}
function nextRound(g, rng) { if (g.phase !== 'roundover' || g.over) throw new Error('no next round'); deal(g, rng); }

// ---------- bots ----------
// Returns an action: { a: 'play', id, color } | { a: 'draw' } | { a: 'pass' } | { a: 'swap', with } | { a: 'color', color }
function bestColor(hand, rng) {
  const n = { R: 0, Y: 0, G: 0, B: 0 };
  hand.forEach(c => { if (c.c !== 'W') n[c.c] += 1 + (/^\d$/.test(c.v) ? 0 : 0.5); });
  const best = Math.max(...COLORS.map(k => n[k]));
  const top = COLORS.filter(k => n[k] === best);
  return top[Math.floor((rng || Math.random)() * top.length)];
}
function botAct(g, pi, rng) {
  rng = rng || Math.random;
  const p = g.players[pi], lvl = p.level;
  if (g.phase === 'color') return { a: 'color', color: bestColor(p.hand, rng) };
  if (g.phase === 'seven') {
    let best = -1, bi = -1;
    g.players.forEach((q, i) => { if (i === pi) return; const v = -q.hand.length + (lvl === 'easy' ? rng() * 6 : 0); if (bi < 0 || v > best) { best = v; bi = i; } });
    return { a: 'swap', with: bi };
  }
  const opts = legal(g, pi);
  if (g.drawn != null) {
    const c = opts[0];
    if (c && !(lvl === 'hard' && c.c === 'W' && p.hand.length > 3 && rng() < 0.5)) return { a: 'play', id: c.id, color: c.c === 'W' ? bestColor(p.hand.filter(x => x.id !== c.id), rng) : null };
    return { a: 'pass' };
  }
  if (!opts.length) return { a: 'draw' };
  if (g.pending) { if (lvl === 'easy' && rng() < 0.3) return { a: 'draw' }; const c = opts[0]; return { a: 'play', id: c.id, color: c.c === 'W' ? bestColor(p.hand.filter(x => x.id !== c.id), rng) : null }; }
  let pick;
  if (lvl === 'easy') pick = opts[Math.floor(rng() * opts.length)];
  else {
    const next = g.players[nextIdx(g, pi, 1)], threat = Math.min(...g.players.filter((_, i) => i !== pi).map(q => q.hand.length));
    const colorCount = c => p.hand.filter(x => x.c === c).length;
    let bestV = -1e9;
    for (const c of opts) {
      let v = 0;
      if (c.c === 'W') v -= lvl === 'hard' ? 30 : 15;                                   // save wilds
      else v += colorCount(c.c) * 2 + (c.c === g.color ? 1 : 0);
      if (/^\d$/.test(c.v)) v += +c.v * (threat <= 3 ? 0.8 : 0.3);                        // dump points when someone is close
      if (['S', 'R', 'D2', 'W4'].indexOf(c.v) >= 0) v += next.hand.length <= 2 ? 25 : next.hand.length <= 4 ? 6 : -2;
      if (c.v === 'W4') v += next.hand.length <= 2 ? 20 : -10;
      if (lvl === 'hard' && c.v === '7' && g.opts.sevenO) v += Math.min(...g.players.filter((_, i) => i !== pi).map(q => q.hand.length)) < p.hand.length - 1 ? 15 : -10;
      v += rng() * (lvl === 'normal' ? 3 : 1);
      if (v > bestV) { bestV = v; pick = c; }
    }
  }
  return { a: 'play', id: pick.id, color: pick.c === 'W' ? bestColor(p.hand.filter(x => x.id !== pick.id), rng) : null };
}
// Will this bot remember to call UNO? Will it catch someone?
const botCallsUno = (p, rng) => (rng || Math.random)() < ({ easy: 0.6, normal: 0.9, hard: 1 }[p.level] || 0.9);
const botCatches = (p, rng) => (rng || Math.random)() < ({ easy: 0.25, normal: 0.6, hard: 0.9 }[p.level] || 0.6);
// A bot that can jump in might (only with an identical card).
function botJump(g, pi, rng) {
  const p = g.players[pi]; if (!g.opts.jumpIn) return null;
  const c = p.hand.find(x => canJump(g, pi, x));
  if (!c) return null;
  return (rng || Math.random)() < ({ easy: 0.3, normal: 0.55, hard: 0.8 }[p.level] || 0.5) ? c : null;
}

const api = { COLORS, CNAME, VNAME, DEFAULTS, makeDeck, points, label, newGame, deal, top, nextIdx, canPlay, legal, canJump, play, swap, draw, pass, chooseStartColor,
  callUno, canCatch, catchUno, nextRound, botAct, botCallsUno, botCatches, botJump, bestColor };
if (typeof module !== 'undefined') module.exports = api; else root.UNO = api;
})(this);
