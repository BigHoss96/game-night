// Yahtzee rules + bot. Pure functions; no DOM.
(function (root) {
'use strict';
const CATS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'three', 'four', 'full', 'small', 'large', 'yahtzee', 'chance'];
const NAMES = { ones: 'Ones', twos: 'Twos', threes: 'Threes', fours: 'Fours', fives: 'Fives', sixes: 'Sixes', three: '3 of a Kind', four: '4 of a Kind',
  full: 'Full House', small: 'Sm. Straight', large: 'Lg. Straight', yahtzee: 'YAHTZEE', chance: 'Chance' };
const UPPER = CATS.slice(0, 6);

const counts = d => { const c = [0, 0, 0, 0, 0, 0, 0]; d.forEach(v => c[v]++); return c; };
const sum = d => d.reduce((a, b) => a + b, 0);
const isYahtzee = d => d.length === 5 && d.every(v => v === d[0]);
function hasRun(c, n) { let run = 0; for (let v = 1; v <= 6; v++) { run = c[v] ? run + 1 : 0; if (run >= n) return true; } return false; }

// Raw score for a category, ignoring joker rules.
function raw(cat, d) {
  const c = counts(d);
  const ui = UPPER.indexOf(cat);
  if (ui >= 0) return c[ui + 1] * (ui + 1);
  switch (cat) {
    case 'three': return c.some(x => x >= 3) ? sum(d) : 0;
    case 'four': return c.some(x => x >= 4) ? sum(d) : 0;
    case 'full': return (c.indexOf(3) > 0 && c.indexOf(2) > 0) ? 25 : 0;
    case 'small': return hasRun(c, 4) ? 30 : 0;
    case 'large': return hasRun(c, 5) ? 40 : 0;
    case 'yahtzee': return isYahtzee(d) ? 50 : 0;
    case 'chance': return sum(d);
  }
  return 0;
}

// Joker rules (official): a Yahtzee rolled after the Yahtzee box is filled must go in the matching
// upper box if it is open; otherwise any open lower box (Full House / straights score in full);
// otherwise any open upper box for zero.
function legal(card, d) {
  const open = CATS.filter(k => card[k] == null);
  if (!isYahtzee(d) || card.yahtzee == null) return open;
  const up = UPPER[d[0] - 1];
  if (card[up] == null) return [up];
  const lower = open.filter(k => UPPER.indexOf(k) < 0);
  return lower.length ? lower : open;
}
function score(card, cat, d) {
  if (isYahtzee(d) && card.yahtzee != null && UPPER.indexOf(cat) < 0 && cat !== 'yahtzee') {
    if (cat === 'full') return 25; if (cat === 'small') return 30; if (cat === 'large') return 40;
  }
  return raw(cat, d);
}
function yahtzeeBonus(card, d) { return isYahtzee(d) && card.yahtzee === 50 ? 100 : 0; }

function newCard() { const c = {}; CATS.forEach(k => c[k] = null); c.ybonus = 0; return c; }
function upperSum(card) { return UPPER.reduce((a, k) => a + (card[k] || 0), 0); }
function totals(card) {
  const up = upperSum(card), bonus = up >= 63 ? 35 : 0;
  const low = CATS.slice(6).reduce((a, k) => a + (card[k] || 0), 0);
  return { up, bonus, low, ybonus: card.ybonus, total: up + bonus + low + card.ybonus };
}
function apply(card, cat, d) {
  if (legal(card, d).indexOf(cat) < 0) throw new Error('illegal category ' + cat);
  card.ybonus += yahtzeeBonus(card, d);
  card[cat] = score(card, cat, d);
  return card[cat];
}
const done = card => CATS.every(k => card[k] != null);

// ---------- game ----------
function newGame(players) {
  return { players: players.map(p => ({ name: p.name, bot: !!p.bot, skill: p.skill || 'sharp', card: newCard() })), turn: 0, round: 1, dice: [1, 2, 3, 4, 5], held: [false, false, false, false, false], rolls: 0, over: false };
}
function roll(g, rng) { rng = rng || Math.random; const idx = []; g.dice = g.dice.map((v, i) => g.held[i] ? v : (idx.push(i), 1 + Math.floor(rng() * 6))); g.rolls++; return idx; }
function scoreTurn(g, cat) {
  const p = g.players[g.turn];
  const pts = apply(p.card, cat, g.dice);
  g.held = [false, false, false, false, false]; g.rolls = 0;
  g.turn = (g.turn + 1) % g.players.length;
  if (g.turn === 0) g.round++;
  if (g.players.every(q => done(q.card))) g.over = true;
  return pts;
}

// ---------- bot ----------
// Value of putting the final dice in each open box: points now, minus what that box is usually worth,
// plus a nudge toward the 35-point upper bonus.
const AVG = { ones: 2.1, twos: 5.3, threes: 8.6, fours: 12.2, fives: 15.7, sixes: 19.2, three: 21.7, four: 13.1, full: 22.6, small: 29.5, large: 32.7, yahtzee: 16.9, chance: 22.0 };
function finalValue(card, d) {
  let best = -1e9, bestCat = null;
  const up = upperSum(card), openUp = UPPER.filter(k => card[k] == null);
  const need = 63 - up;
  const bonusAlive = need > 0 && openUp.reduce((a, k) => a + 5 * (UPPER.indexOf(k) + 1), 0) >= need;
  for (const k of legal(card, d)) {
    const s = score(card, k, d);
    let v = s - AVG[k];
    const ui = UPPER.indexOf(k);
    if (ui >= 0 && bonusAlive) {
      const par = 3 * (ui + 1);
      v += (s - par) * 0.9;
      if (up < 63 && up + s >= 63) v += 18;
    }
    if (k === 'yahtzee' && s === 50) v += 30;      // future Yahtzee bonuses
    if (k === 'chance' && s < 20) v -= 4;           // keep chance as a safety net
    if (s === 0 && k === 'yahtzee') v += 6;         // zeroing Yahtzee is the cheapest dump late
    v += yahtzeeBonus(card, d);
    if (v > best) { best = v; bestCat = k; }
  }
  return { v: best, cat: bestCat };
}
// enumerate multisets of k dice with probabilities
const OUTCOMES = {};
function outcomes(k) {
  if (OUTCOMES[k]) return OUTCOMES[k];
  const m = new Map();
  const rec = (n, arr) => { if (n === 0) { const key = arr.slice().sort().join(''); m.set(key, (m.get(key) || 0) + 1); return; } for (let v = 1; v <= 6; v++) { arr.push(v); rec(n - 1, arr); arr.pop(); } };
  rec(k, []);
  const tot = Math.pow(6, k);
  return (OUTCOMES[k] = [...m].map(([key, n]) => ({ dice: key ? key.split('').map(Number) : [], p: n / tot })));
}
// Best hold for dice with `left` rerolls remaining. Returns { held:[bool], ev }.
function bestHold(card, dice, left, skill) {
  const vm = new Map(), em = new Map();
  const V = (d, r) => {     // value of sorted dice d with r rerolls left
    const key = d.join('') + r;
    let v = vm.get(key); if (v !== undefined) return v;
    v = finalValue(card, d).v;
    if (r > 0) for (const kk of keeps(d)) { const e = E(kk, r - 1); if (e > v) v = e; }
    vm.set(key, v); return v;
  };
  const E = (kk, r) => {     // expected value after keeping kk and rolling the rest, r rerolls left after that
    const key = kk + '|' + r;
    let e = em.get(key); if (e !== undefined) return e;
    e = 0; const keep = kk ? kk.split('').map(Number) : [];
    for (const o of outcomes(5 - keep.length)) e += o.p * V(keep.concat(o.dice).sort(), r);
    em.set(key, e); return e;
  };
  const order = dice.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const sd = order.map(x => x[0]);
  let best = { kk: sd.join(''), ev: finalValue(card, sd).v };
  for (const kk of keeps(sd)) {
    let e = E(kk, left - 1);
    if (skill === 'casual' || skill === 'easy') e += (Math.random() - 0.5) * 8;
    else if (skill === 'normal') e += (Math.random() - 0.5) * 3;
    if (e > best.ev + 1e-9) best = { kk, ev: e };
  }
  // map the kept values back onto dice positions
  const held = [false, false, false, false, false], need = best.kk.split('').map(Number);
  order.forEach(x => { const j = need.indexOf(x[0]); if (j >= 0) { held[x[1]] = true; need.splice(j, 1); } });
  return { held, ev: best.ev, stop: held.every(Boolean) };
}
const KEEPS = new Map();
function keeps(d) {     // distinct sub-multisets of sorted dice, as strings
  const k = d.join(''); let r = KEEPS.get(k); if (r) return r;
  const set = new Set();
  for (let mask = 0; mask < 32; mask++) set.add(d.filter((_, i) => mask & (1 << i)).join(''));
  r = [...set]; KEEPS.set(k, r); return r;
}
function botChoose(card, dice, skill) {
  if (skill === 'casual' || skill === 'easy' || (skill === 'normal' && Math.random() < 0.2)) {
    const opts = legal(card, dice).map(k => ({ k, s: score(card, k, dice) - AVG[k] + Math.random() * 6 }));
    opts.sort((a, b) => b.s - a.s); return opts[0].k;
  }
  return finalValue(card, dice).cat;
}

const api = { CATS, NAMES, UPPER, raw, score, legal, apply, totals, newCard, done, isYahtzee, yahtzeeBonus, newGame, roll, scoreTurn, bestHold, botChoose, finalValue };
if (typeof module !== 'undefined') module.exports = api; else root.YZ = api;
})(this);
