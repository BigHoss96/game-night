// Phase 10 rules + bots. Pure functions over a plain game object; no DOM.
// Cards: { id, c: 'R'|'B'|'G'|'Y' (numbers), v: 1..12 | 'W' (wild) | 'S' (skip) }
(function (root) {
'use strict';
const COLORS = ['R', 'B', 'G', 'Y'];
const PHASES = [null,
  [{ t: 'set', n: 3 }, { t: 'set', n: 3 }],
  [{ t: 'set', n: 3 }, { t: 'run', n: 4 }],
  [{ t: 'set', n: 4 }, { t: 'run', n: 4 }],
  [{ t: 'run', n: 7 }],
  [{ t: 'run', n: 8 }],
  [{ t: 'run', n: 9 }],
  [{ t: 'set', n: 4 }, { t: 'set', n: 4 }],
  [{ t: 'color', n: 7 }],
  [{ t: 'set', n: 5 }, { t: 'set', n: 2 }],
  [{ t: 'set', n: 5 }, { t: 'set', n: 3 }],
];
const GNAME = { set: 'Set of', run: 'Run of', color: 'Color' };
const groupName = gr => gr.t === 'color' ? `${gr.n} of one color` : `${GNAME[gr.t]} ${gr.n}`;
const phaseName = n => PHASES[n].map(groupName).join(' + ');

function makeDeck() {
  const d = []; let id = 0;
  for (let k = 0; k < 2; k++) for (const c of COLORS) for (let v = 1; v <= 12; v++) d.push({ id: id++, c, v });
  for (let k = 0; k < 8; k++) d.push({ id: id++, c: null, v: 'W' });
  for (let k = 0; k < 4; k++) d.push({ id: id++, c: null, v: 'S' });
  return d;   // 108
}
const isW = c => c.v === 'W', isS = c => c.v === 'S';
const penalty = c => isW(c) ? 25 : isS(c) ? 15 : c.v >= 10 ? 10 : 5;
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- groups ----------
// Check `cards` as a group of type t with at least n cards. Returns the group (with run bounds) or null.
function makeGroup(t, n, cards) {
  if (cards.length < n || cards.some(isS)) return null;
  const nat = cards.filter(c => !isW(c));
  if (!nat.length) return null;                                    // at least one natural card
  if (t === 'set') return nat.every(c => c.v === nat[0].v) ? { t, n, cards: cards.slice(), v: nat[0].v } : null;
  if (t === 'color') return nat.every(c => c.c === nat[0].c) ? { t, n, cards: cards.slice(), c: nat[0].c } : null;
  // run: distinct naturals that fit inside a window as long as the group
  const vals = nat.map(c => c.v).sort((a, b) => a - b);
  for (let i = 1; i < vals.length; i++) if (vals[i] === vals[i - 1]) return null;
  const L = cards.length; if (L > 12) return null;
  if (vals[vals.length - 1] - vals[0] + 1 > L) return null;
  let lo = vals[0]; if (lo + L - 1 > 12) lo = 13 - L;              // wilds extend upward, or down when at 12
  return { t, n, cards: cards.slice(), lo, hi: lo + L - 1 };
}
function canHit(gr, card) {
  if (isS(card)) return false;
  if (gr.t === 'set') return isW(card) || card.v === gr.v;
  if (gr.t === 'color') return isW(card) || card.c === gr.c;
  if (isW(card)) return gr.hi < 12 || gr.lo > 1;
  return card.v === gr.lo - 1 || card.v === gr.hi + 1;
}
function addToGroup(gr, card) {
  gr.cards.push(card);
  if (gr.t !== 'run') return;
  if (isW(card)) { if (gr.hi < 12) gr.hi++; else gr.lo--; }
  else if (card.v === gr.hi + 1) gr.hi++; else gr.lo--;
}

// ---------- the phase solver ----------
// How many cards short of `phase` a hand is, and (when 0) the cards to lay for each group.
// Candidate groups use naturals by value / window / color; wilds fill the gaps.
function candidates(hand, gr) {
  const nat = hand.filter(c => !isW(c) && !isS(c)), out = [];
  if (gr.t === 'set') for (let v = 1; v <= 12; v++) { const cs = nat.filter(c => c.v === v); if (cs.length) out.push({ cs, short: Math.max(0, gr.n - cs.length), key: 'v' + v }); }
  if (gr.t === 'color') for (const c of COLORS) { const cs = nat.filter(x => x.c === c); if (cs.length) out.push({ cs, short: Math.max(0, gr.n - cs.length), key: 'c' + c }); }
  if (gr.t === 'run') for (let s = 1; s + gr.n - 1 <= 12; s++) {
    const cs = []; for (let v = s; v < s + gr.n; v++) { const c = nat.find(x => x.v === v); if (c) cs.push(c); }
    if (cs.length) out.push({ cs, short: gr.n - cs.length, key: 'r' + s, win: s });
  }
  return out;
}
function solve(hand, phase) {
  const groups = PHASES[phase], wilds = hand.filter(isW);
  let best = { need: 99, lay: null };
  const consider = (picks) => {
    const ids = new Set(); let short = 0; const use = [];
    for (let k = 0; k < picks.length; k++) {
      const gr = groups[k];
      // a later group can't reuse cards the earlier group took
      let cs;
      if (gr.t === 'run') {   // one natural per value in the window, using another copy if the first was taken
        cs = [];
        for (let v = picks[k].win; v < picks[k].win + gr.n; v++) { const c = hand.find(x => !isW(x) && !isS(x) && x.v === v && !ids.has(x.id)); if (c) cs.push(c); }
      } else cs = picks[k].cs.filter(c => !ids.has(c.id)).slice(0, gr.n);   // exactly n naturals; extras stay for hitting
      cs.forEach(c => ids.add(c.id)); short += Math.max(0, gr.n - cs.length); use.push(cs);
    }
    const need = Math.max(0, short - wilds.length);
    if (need < best.need) {
      let lay = null;
      if (need === 0) {   // hand out the wilds
        const w = wilds.slice(); lay = use.map((cs, k) => cs.concat(w.splice(0, Math.max(0, groups[k].n - cs.length))));
        if (!lay.every((cs, k) => makeGroup(groups[k].t, groups[k].n, cs))) lay = null;
      }
      if (need > 0 || lay) best = { need, lay };
    }
  };
  const c0 = candidates(hand, groups[0]);
  if (groups.length === 1) { c0.forEach(a => consider([a])); if (!c0.length) best.need = Math.max(0, groups[0].n - wilds.length) || 99; return best; }
  const c1 = candidates(hand, groups[1]);
  for (const a of c0) for (const b of c1) consider([a, b]);
  if (!c0.length || !c1.length) best.need = Math.min(best.need, groups.reduce((s, g) => s + g.n, 0));
  return best;
}
// Split chosen cards into the phase's groups (for a person who picked cards by hand).
function splitPhase(cards, phase) {
  const groups = PHASES[phase];
  if (groups.length === 1) { const g = makeGroup(groups[0].t, groups[0].n, cards); return g ? [g] : null; }
  const n = cards.length;
  for (let m = 1; m < (1 << n) - 1; m++) {
    const a = cards.filter((_, i) => m & (1 << i)), b = cards.filter((_, i) => !(m & (1 << i)));
    const ga = makeGroup(groups[0].t, groups[0].n, a), gb = ga && makeGroup(groups[1].t, groups[1].n, b);
    if (ga && gb) return [ga, gb];
  }
  return null;
}

// ---------- game ----------
function newGame(players, opts, rng) {
  const g = { players: players.map(p => ({ name: p.name, bot: !!p.bot, level: p.level || 'normal', hand: [], phase: 1, laid: null, score: 0, skipped: false })),
    opts: Object.assign({}, opts || {}), round: 0, dealer: Math.floor((rng || Math.random)() * players.length), over: false, winner: null, log: [] };
  deal(g, rng); return g;
}
function deal(g, rng) {
  rng = rng || Math.random;
  g.round++; g.deck = shuffle(makeDeck(), rng); g.discard = []; g.roundWinner = null;
  g.players.forEach(p => { p.hand = []; p.laid = null; p.skipped = false; p.madePhase = false; });
  for (let k = 0; k < 10; k++) g.players.forEach(p => p.hand.push(g.deck.pop()));
  g.dealer = (g.dealer + 1) % g.players.length;
  g.turn = (g.dealer + 1) % g.players.length;
  const up = g.deck.pop(); g.discard.push(up);
  if (isS(up)) g.players[g.turn].skipped = true;
  g.step = 'draw';
  startTurn(g);
  log(g, { t: 'deal', round: g.round });
}
function log(g, e) { g.log.push(e); if (g.log.length > 200) g.log.splice(0, g.log.length - 200); }
const top = g => g.discard[g.discard.length - 1];
// skip anyone who was skipped
function startTurn(g) {
  let guard = 0;
  while (g.players[g.turn].skipped && guard++ < g.players.length) { g.players[g.turn].skipped = false; log(g, { t: 'skipped', p: g.turn }); g.turn = (g.turn + 1) % g.players.length; }
  g.step = 'draw';
}
function refill(g, rng) { if (g.deck.length) return; const t = g.discard.pop(); g.deck = shuffle(g.discard, rng || Math.random); g.discard = t ? [t] : []; }
function drawDeck(g, pi, rng) {
  if (pi !== g.turn || g.step !== 'draw') throw new Error('not your draw');
  refill(g, rng); const c = g.deck.pop(); if (c) g.players[pi].hand.push(c);
  g.step = 'play'; log(g, { t: 'draw', p: pi, from: 'deck' }); return c;
}
function canTakeDiscard(g) { const t = top(g); return !!t && !isS(t); }
function drawDiscard(g, pi) {
  if (pi !== g.turn || g.step !== 'draw' || !canTakeDiscard(g)) throw new Error('cannot take the discard');
  const c = g.discard.pop(); g.players[pi].hand.push(c);
  g.step = 'play'; log(g, { t: 'draw', p: pi, from: 'discard', card: c }); return c;
}
function take(p, ids) { return ids.map(id => { const i = p.hand.findIndex(c => c.id === id); if (i < 0) throw new Error('card not in hand'); return p.hand.splice(i, 1)[0]; }); }
// lay down the current phase: cardIds is either [[ids], [ids]] (one list per group) or a flat [ids] to split
function lay(g, pi, cardIds) {
  const p = g.players[pi];
  if (pi !== g.turn || g.step !== 'play' || p.laid) throw new Error('cannot lay now');
  const flat = Array.isArray(cardIds[0]) ? cardIds.flat() : cardIds;
  const cards = flat.map(id => p.hand.find(c => c.id === id));
  if (cards.some(c => !c) || new Set(flat).size !== flat.length) throw new Error('bad cards');
  let groups;
  if (Array.isArray(cardIds[0])) { groups = PHASES[p.phase].map((gr, k) => makeGroup(gr.t, gr.n, cardIds[k].map(id => p.hand.find(c => c.id === id)))); if (groups.some(x => !x)) groups = null; }
  else groups = splitPhase(cards, p.phase);
  if (!groups) throw new Error("those cards don't make the phase");
  take(p, flat); p.laid = groups; p.madePhase = true;
  log(g, { t: 'lay', p: pi, phase: p.phase });
  checkOut(g, pi);
  return groups;
}
function hit(g, pi, owner, gi, cardId) {
  const p = g.players[pi], gr = g.players[owner].laid && g.players[owner].laid[gi];
  if (pi !== g.turn || g.step !== 'play' || !p.laid || !gr) throw new Error('cannot hit now');
  const card = p.hand.find(c => c.id === cardId);
  if (!card || !canHit(gr, card)) throw new Error("that card doesn't fit there");
  take(p, [cardId]); addToGroup(gr, card);
  log(g, { t: 'hit', p: pi, owner, card });
  checkOut(g, pi);
}
// discard to end the turn; a skip needs a target
function discard(g, pi, cardId, target) {
  const p = g.players[pi];
  if (pi !== g.turn || g.step !== 'play') throw new Error('cannot discard now');
  const [card] = take(p, [cardId]);
  g.discard.push(card);
  if (isS(card)) { const t = target != null ? target : (pi + 1) % g.players.length; if (t !== pi) g.players[t].skipped = true; }
  log(g, { t: 'discard', p: pi, card, target });
  if (checkOut(g, pi)) return;
  g.turn = (pi + 1) % g.players.length; startTurn(g);
}
function checkOut(g, pi) {
  if (g.players[pi].hand.length) return false;
  g.step = 'roundover'; g.roundWinner = pi;
  g.players.forEach(p => { p.roundPts = p.hand.reduce((s, c) => s + penalty(c), 0); p.score += p.roundPts; if (p.madePhase) p.phase++; });
  log(g, { t: 'out', p: pi });
  const done = g.players.filter(p => p.phase > 10);
  if (done.length) {
    g.over = true;
    const best = Math.min(...done.map(p => p.score));
    g.winner = g.players.findIndex(p => p.phase > 10 && p.score === best);
  }
  return true;
}
function nextRound(g, rng) { if (g.step !== 'roundover' || g.over) throw new Error('no next round'); deal(g, rng); }

// ---------- bots ----------
// One full bot turn as a list of actions the UI can animate:
//   {a:'deck'} {a:'discardPile'} {a:'lay', groups:[[ids],[ids]]} {a:'hit', owner, gi, id} {a:'discard', id, target}
function botDraw(g, pi, rng) {
  rng = rng || Math.random;
  const p = g.players[pi], t = top(g);
  if (!canTakeDiscard(g)) return { a: 'deck' };
  if (p.level === 'easy') return rng() < 0.25 ? { a: 'discardPile' } : { a: 'deck' };
  if (isW(t)) return { a: 'discardPile' };
  if (p.laid) return allGroups(g).some(({ gr }) => canHit(gr, t)) ? { a: 'discardPile' } : { a: 'deck' };
  const before = solve(p.hand, p.phase).need, after = solve(p.hand.concat([t]), p.phase).need;
  return after < before ? { a: 'discardPile' } : { a: 'deck' };
}
const allGroups = g => g.players.flatMap((q, owner) => (q.laid || []).map((gr, gi) => ({ owner, gi, gr })));
function botPlays(g, pi) {
  const p = g.players[pi], out = [];
  if (!p.laid) { const s = solve(p.hand, p.phase); if (s.need === 0 && s.lay) out.push({ a: 'lay', groups: s.lay.map(cs => cs.map(c => c.id)) }); }
  return out;
}
function botHits(g, pi) {
  const p = g.players[pi]; if (!p.laid) return [];
  // naturals first, then wilds (after laying down, a wild in hand is only a 25-point risk)
  for (const c of p.hand.slice().sort((a, b) => (isW(a) ? 1 : 0) - (isW(b) ? 1 : 0))) {
    for (const { owner, gi, gr } of allGroups(g)) if (canHit(gr, c)) return [{ a: 'hit', owner, gi, id: c.id }];
  }
  return [];
}
function botDiscard(g, pi, rng) {
  rng = rng || Math.random;
  const p = g.players[pi], n = g.players.length;
  const skip = p.hand.find(isS);
  if (skip) {
    // skip whoever is most dangerous: furthest phase, then fewest cards
    let best = -1, bt = (pi + 1) % n;
    g.players.forEach((q, i) => { if (i === pi || q.skipped) return; const v = q.phase * 20 + (q.laid ? 15 : 0) - q.hand.length + (i === (pi + 1) % n ? 2 : 0) + (p.level === 'easy' ? rng() * 30 : 0); if (v > best) { best = v; bt = i; } });
    return { a: 'discard', id: skip.id, target: bt };
  }
  let choice = null, bestV = -1e9;
  for (const c of p.hand) {
    if (isW(c) && p.hand.some(x => !isW(x))) continue;
    const rest = p.hand.filter(x => x !== c);
    let v;
    if (p.laid) v = (allGroups(g).some(({ gr }) => canHit(gr, c)) ? -40 : 0) + penalty(c);
    else v = -solve(rest, p.phase).need * 100 + penalty(c) + (p.level === 'hard' ? -usefulness(rest, c) : 0);
    if (p.level === 'easy') v += rng() * 60;
    else v += rng() * 2;
    if (v > bestV) { bestV = v; choice = c; }
  }
  return { a: 'discard', id: (choice || p.hand[0]).id };
}
// how much a card helps (pairs, neighbours, same color) — hard bots keep connected cards
function usefulness(rest, c) {
  if (isW(c) || isS(c)) return 0;
  return rest.reduce((s, x) => s + (x.v === c.v ? 6 : 0) + (typeof x.v === 'number' && Math.abs(x.v - c.v) === 1 ? 3 : 0) + (x.c === c.c ? 1 : 0), 0);
}

const api = { COLORS, PHASES, phaseName, groupName, makeDeck, penalty, makeGroup, canHit, solve, splitPhase, newGame, deal, top, canTakeDiscard, drawDeck, drawDiscard, lay, hit, discard, nextRound,
  botDraw, botPlays, botHits, botDiscard, isW, isS };
if (typeof module !== 'undefined') module.exports = api; else root.P10 = api;
})(this);
