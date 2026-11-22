// Farkle rules + bot. Pure functions; no DOM.
// Scoring (common modern set): 1 = 100, 5 = 50, three of a kind = face x 100 (three 1s = 1000),
// 4 / 5 / 6 of a kind = 1000 / 2000 / 3000, 1-6 straight = 1500, three pairs = 1500 (4 of a kind + a pair counts),
// two triplets = 2500.
(function (root) {
'use strict';
const DEFAULT_OPTS = { target: 10000, entry: 500, hot: false, three: false, final: true };

const countsOf = d => { const c = [0, 0, 0, 0, 0, 0, 0]; d.forEach(v => c[v]++); return c; };
const memo = new Map();
// Best score using ALL dice described by counts c (index 1..6); -Infinity if some die can't score.
function best(c) {
  const key = c.join('');
  if (memo.has(key)) return memo.get(key).pts;
  const r = solve(c); memo.set(key, r); return r.pts;
}
function combos(c) { best(c); return memo.get(c.join('')).parts; }
function solve(c) {
  const n = c.reduce((a, b) => a + b, 0);
  if (n === 0) return { pts: 0, parts: [] };
  let bestR = { pts: -Infinity, parts: [] };
  const consider = (pts, used, label) => {
    const rest = c.slice(); for (let v = 1; v <= 6; v++) rest[v] -= used[v] || 0;
    const r = best(rest);
    if (pts + r > bestR.pts) bestR = { pts: pts + r, parts: [label].concat(memo.get(rest.join('')).parts) };
  };
  if (n === 6) {
    if ([1, 2, 3, 4, 5, 6].every(v => c[v] === 1)) consider(1500, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }, 'Straight');
    const pairs = [1, 2, 3, 4, 5, 6].reduce((a, v) => a + (c[v] === 2 ? 1 : c[v] === 4 ? 2 : c[v] === 6 ? 0 : 0), 0);
    if (pairs === 3 && [1, 2, 3, 4, 5, 6].every(v => c[v] % 2 === 0)) consider(1500, c, 'Three pairs');
    const trips = [1, 2, 3, 4, 5, 6].filter(v => c[v] === 3);
    if (trips.length === 2) consider(2500, c, 'Two triplets');
  }
  for (let v = 1; v <= 6; v++) {
    if (c[v] >= 6) consider(3000, { [v]: 6 }, `Six ${v}s`);
    if (c[v] >= 5) consider(2000, { [v]: 5 }, `Five ${v}s`);
    if (c[v] >= 4) consider(1000, { [v]: 4 }, `Four ${v}s`);
    if (c[v] >= 3) consider(v === 1 ? 1000 : v * 100, { [v]: 3 }, `Three ${v}s`);
  }
  if (c[1]) consider(100, { 1: 1 }, 'One');
  if (c[5]) consider(50, { 5: 1 }, 'Five');
  return bestR;
}
function scoreOf(dice) { const p = best(countsOf(dice)); return p > 0 ? p : 0; }
function describe(dice) { const s = scoreOf(dice); if (!s) return ''; const parts = combos(countsOf(dice)); const ones = parts.filter(p => p === 'One').length, fives = parts.filter(p => p === 'Five').length;
  const big = parts.filter(p => p !== 'One' && p !== 'Five'); if (ones) big.push(ones > 1 ? `${ones} ones` : 'a one'); if (fives) big.push(fives > 1 ? `${fives} fives` : 'a five'); return big.join(' + '); }
// Does a roll contain anything that scores?
function canScore(dice) { const c = countsOf(dice); if (c[1] || c[5]) return true; if (c.some(x => x >= 3)) return true; return dice.length === 6 && best(c) > 0; }
// All index subsets of `idx` (positions in dice) that score in full
function options(dice, idx) {
  const out = [];
  for (let m = 1; m < (1 << idx.length); m++) {
    const sub = idx.filter((_, k) => m & (1 << k));
    const s = scoreOf(sub.map(i => dice[i]));
    if (s > 0) out.push({ idx: sub, pts: s });
  }
  return out;
}

// Scoring-chart rows, and which of them the dice in front of you can make right now.
const CHART = [
  { k: 'one', label: 'Each 1', pts: '100' }, { k: 'five', label: 'Each 5', pts: '50' },
  { k: 'three1', label: 'Three 1s', pts: '1,000' }, { k: 'threeN', label: 'Three 2s–6s', pts: '×100' },
  { k: 'four', label: '4 of a kind', pts: '1,000' }, { k: 'fivek', label: '5 of a kind', pts: '2,000' },
  { k: 'six', label: '6 of a kind', pts: '3,000' }, { k: 'straight', label: 'Straight 1–6', pts: '1,500' },
  { k: 'pairs', label: 'Three pairs', pts: '1,500' }, { k: 'trips', label: 'Two triplets', pts: '2,500' },
];
function available(dice) {
  const c = countsOf(dice), out = {};
  if (c[1]) out.one = c[1] > 1 ? `${c[1]} × 100` : '100';
  if (c[5]) out.five = c[5] > 1 ? `${c[5]} × 50` : '50';
  if (c[1] >= 3) out.three1 = '1,000';
  const tri = [2, 3, 4, 5, 6].filter(v => c[v] >= 3);
  if (tri.length) out.threeN = tri.map(v => `${v}s = ${v * 100}`).join(', ');
  for (let v = 1; v <= 6; v++) { if (c[v] >= 4) out.four = `${v}s`; if (c[v] >= 5) out.fivek = `${v}s`; if (c[v] >= 6) out.six = `${v}s`; }
  if (dice.length === 6) {
    if ([1, 2, 3, 4, 5, 6].every(v => c[v] === 1)) out.straight = '1,500';
    if ([1, 2, 3, 4, 5, 6].every(v => c[v] % 2 === 0) && c.reduce((a, x) => a + (x === 2 ? 1 : x === 4 ? 2 : 0), 0) === 3) out.pairs = '1,500';
    if ([1, 2, 3, 4, 5, 6].filter(v => c[v] === 3).length === 2) out.trips = '2,500';
  }
  return out;
}

// ---------- game ----------
function newGame(players, opts) {
  const g = { players: players.map(p => ({ name: p.name, bot: !!p.bot, skill: p.skill || 'sharp', score: 0, on: false, farkles: 0 })),
    opts: Object.assign({}, DEFAULT_OPTS, opts || {}), turn: 0, finalRound: null, over: false, winner: null, log: [] };
  startTurn(g); return g;
}
function startTurn(g) { g.dice = [1, 2, 3, 4, 5, 6]; g.state = Array(6).fill('free'); g.turnPts = 0; g.rolled = false; g.picked = false; g.farkled = false; g.hot = false; }
const freeIdx = g => g.state.map((s, i) => s === 'free' ? i : -1).filter(i => i >= 0);
function roll(g, rng) {
  rng = rng || Math.random;
  if (g.state.every(s => s === 'locked')) { g.state = Array(6).fill('free'); g.hot = false; }   // hot dice
  const idx = freeIdx(g);
  idx.forEach(i => g.dice[i] = 1 + Math.floor(rng() * 6));
  g.rolled = true; g.picked = false;
  g.farkled = !canScore(idx.map(i => g.dice[i]));
  return idx;
}
// Set aside dice idx (must all be free and must score in full). Returns points.
function keep(g, idx) {
  if (!idx.length || idx.some(i => g.state[i] !== 'free')) throw new Error('bad keep');
  const pts = scoreOf(idx.map(i => g.dice[i]));
  if (!pts) throw new Error('those dice do not score');
  idx.forEach(i => g.state[i] = 'locked');
  g.turnPts += pts; g.picked = true;
  if (g.state.every(s => s === 'locked')) g.hot = true;
  return pts;
}
// All six scored: with hot dice on you may roll all six again. With it off you must bank,
// unless you can't bank yet (under the 500 entry), in which case you roll all six again.
const canRollAgain = g => g.picked && (freeIdx(g).length > 0 || (g.hot && (g.opts.hot || !canBank(g))));
function canBank(g) { const p = g.players[g.turn]; return g.picked && g.turnPts > 0 && (p.on || g.turnPts >= g.opts.entry); }
function bank(g) {
  const p = g.players[g.turn];
  if (!canBank(g)) throw new Error('cannot bank');
  p.score += g.turnPts; p.on = true; p.farkles = 0;
  const ev = { type: 'bank', player: g.turn, pts: g.turnPts, total: p.score };
  g.log.push(ev);
  if (!g.opts.final && p.score >= g.opts.target) { g.over = true; g.winner = g.turn; ev.win = true; return ev; }
  if (!g.finalRound && p.score >= g.opts.target) { g.finalRound = { by: g.turn, left: g.players.length - 1 }; ev.final = true; }
  next(g); return ev;
}
function farkle(g) {
  const p = g.players[g.turn];
  const ev = { type: 'farkle', player: g.turn, lost: g.turnPts, penalty: 0 };
  p.farkles++;
  if (g.opts.three && p.farkles >= 3) { p.score -= 1000; p.farkles = 0; ev.penalty = 1000; }
  g.log.push(ev);
  next(g); return ev;
}
function next(g) {
  if (g.finalRound && g.turn !== g.finalRound.by) g.finalRound.left--;
  if (g.finalRound && g.finalRound.left <= 0) { g.over = true; const top = Math.max(...g.players.map(p => p.score)); g.winner = g.players.findIndex(p => p.score === top); return; }
  g.turn = (g.turn + 1) % g.players.length;
  if (g.players.length === 1 && g.finalRound) { g.over = true; g.winner = 0; return; }
  startTurn(g);
}

// ---------- bot ----------
// The sharp bot plays the turn that maximizes expected points, solved exactly by dynamic programming
// over (points so far this turn, dice left to roll, on the board yet). Casual uses rough thresholds.
const STEP = 50, CAP = 6000;
const tables = {};
function rollOutcomes(n) {
  const m = new Map();
  const rec = (k, arr) => { if (!k) { const key = arr.slice().sort().join(''); m.set(key, (m.get(key) || 0) + 1); return; } for (let v = 1; v <= 6; v++) { arr.push(v); rec(k - 1, arr); arr.pop(); } };
  rec(n, []);
  const tot = Math.pow(6, n);
  return [...m].map(([key, cnt]) => {
    const dice = key.split('').map(Number), c = countsOf(dice), opts = new Map();
    // every sub-multiset that scores in full -> best points for each number of dice used
    const sub = (v, u) => {
      if (v > 6) { const k = u.reduce((a, b) => a + b, 0); if (!k) return; const p = best(u); if (p > 0 && p > (opts.get(k) || 0)) opts.set(k, p); return; }
      for (let x = 0; x <= c[v]; x++) { u[v] = x; sub(v + 1, u); } u[v] = 0;
    };
    sub(1, [0, 0, 0, 0, 0, 0, 0]);
    return { p: cnt / tot, opts: [...opts].map(([k, pts]) => ({ k, pts })) };
  });
}
const OUT = {};
function table(opts) {
  const key = (opts.hot ? 'h' : '') + opts.entry;
  if (tables[key]) return tables[key];
  for (let n = 1; n <= 6; n++) OUT[n] = OUT[n] || rollOutcomes(n);
  const T = Math.round(CAP / STEP);
  // V[on][n][ti] = best expected final turn points before deciding, R = value of rolling
  const V = [[], []], R = [[], []];
  for (const on of [0, 1]) for (let n = 0; n <= 6; n++) { V[on][n] = new Float64Array(T + 1); R[on][n] = new Float64Array(T + 1); }
  const canB = (on, t) => t > 0 && (on || t >= opts.entry);
  const val = (on, n, t) => {
    if (t >= CAP) return t;
    const ti = t / STEP;
    if (n === 0) return opts.hot || !canB(on, t) ? V[on][6][ti] : t;
    return V[on][n][ti];
  };
  for (let ti = T; ti >= 0; ti--) {
    const t = ti * STEP;
    for (const on of [0, 1]) for (let n = 1; n <= 6; n++) {
      let r = 0;
      for (const o of OUT[n]) {
        let bestO = 0;
        for (const op of o.opts) { const v = val(on, n - op.k, t + op.pts); if (v > bestO) bestO = v; }
        r += o.p * bestO;
      }
      R[on][n][ti] = r;
      V[on][n][ti] = Math.max(canB(on, t) ? t : 0, r);
    }
  }
  return (tables[key] = { V, R, val, canB });
}
const BANK_AT = [0, 250, 300, 350, 600, 1500, 1e9];
// easy = rough rules of thumb, hard = exact expected value, normal = exact most of the time
const rough = skill => skill === 'casual' || skill === 'easy' || (skill === 'normal' && Math.random() < 0.3);
function shouldBank(g, tt, rem, skill) {
  const p = g.players[g.turn];
  if (!p.on && tt < g.opts.entry) return false;
  if (rem === 0 && !g.opts.hot) return true;
  const n = rem === 0 ? 6 : rem;
  const others = g.players.filter((_, i) => i !== g.turn).map(q => q.score);
  const lead = others.length ? Math.max(...others) : 0;
  if (g.finalRound) return p.score + tt > lead;
  if (p.score + tt >= g.opts.target) return true;
  if (rough(skill)) return tt >= BANK_AT[n];
  const tb = table(g.opts);
  if (tt >= CAP) return true;
  let roll = tb.R[p.on ? 1 : 0][n][Math.round(tt / STEP)];
  // an opponent about to win: take more risk; three-farkle penalty looming: take less
  if (lead >= g.opts.target * 0.85 && lead - (p.score + tt) > 1500) roll *= 1.25;
  if (g.opts.three && p.farkles >= 2) roll -= 120;
  return tt >= roll;
}
// Pick which scoring dice to set aside; returns { idx, bank }.
function botPick(g, skill) {
  const free = freeIdx(g), p = g.players[g.turn];
  const opts = options(g.dice, free);
  const tb = table(g.opts);
  let bestO = null, bestV = -1e9;
  for (const o of opts) {
    const tt = g.turnPts + o.pts, rem = free.length - o.idx.length;
    const bank = shouldBank(g, tt, rem, skill);
    let v = rough(skill) ? o.pts + rem * 40 + Math.random() * 80 : bank ? tt : tb.val(p.on ? 1 : 0, rem, tt);
    v += 1e-6 * o.pts;
    if (v > bestV) { bestV = v; bestO = { idx: o.idx, bank }; }
  }
  return bestO;
}

const api = { CHART, available, table, DEFAULT_OPTS, scoreOf, describe, canScore, options, newGame, startTurn, roll, keep, bank, farkle, canBank, canRollAgain, freeIdx, botPick, shouldBank };
if (typeof module !== 'undefined') module.exports = api; else root.FK = api;
})(this);
