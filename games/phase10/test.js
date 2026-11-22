// Phase 10: group rules, the phase solver, and bot self-play.
const assert = require('assert');
const P = require('./engine.js');
let id = 0; const C = (v, c) => ({ id: id++, c: typeof v === 'number' ? (c || 'R') : null, v });
assert.strictEqual(P.makeDeck().length, 108);
// groups
assert(P.makeGroup('set', 3, [C(7), C(7, 'B'), C('W')]));
assert(!P.makeGroup('set', 3, [C(7), C(8), C('W')]));
assert(!P.makeGroup('set', 3, [C('W'), C('W'), C('W')]), 'needs a natural card');
let r = P.makeGroup('run', 4, [C(3), C(5), C('W'), C(6)]); assert(r && r.lo === 3 && r.hi === 6);
r = P.makeGroup('run', 4, [C(11), C(12), C('W'), C('W')]); assert(r && r.lo === 9 && r.hi === 12, 'wilds go below when the run tops out');
assert(!P.makeGroup('run', 4, [C(3), C(3, 'B'), C(4), C(5)]), 'no repeated numbers in a run');
assert(!P.makeGroup('run', 4, [C(1), C(6), C('W'), C('W')]), 'gap too wide');
assert(P.makeGroup('color', 7, [1, 3, 5, 8, 9, 11].map(v => C(v, 'G')).concat([C('W')])));
assert(!P.makeGroup('set', 3, [C(7), C(7), C('S')]), 'skips never go in a group');
r = P.makeGroup('run', 4, [C(3), C(4), C(5), C(6)]);
assert(P.canHit(r, C(7)) && P.canHit(r, C(2)) && !P.canHit(r, C(9)) && P.canHit(r, C('W')));
// solver
let hand = [C(4), C(4, 'B'), C(9), C(9, 'G'), C('W'), C(2), C(3), C(11), C(12), C(1)];
let s = P.solve(hand, 1); assert.strictEqual(s.need, 1, 'two pairs + wild is one short of two sets of 3');
hand.push(C(9, 'Y')); s = P.solve(hand, 1); assert.strictEqual(s.need, 0); assert(s.lay && s.lay.length === 2);
hand = [C(7), C(7, 'B'), C(7, 'G'), C(7, 'Y'), C(5), C(6), C(8), C(1), C(1), C(2)];
s = P.solve(hand, 2); assert.strictEqual(s.need, 0, 'set of 3 sevens + run 5-6-7-8 shares the fourth 7');
hand = [3, 4, 5, 6, 7, 8].map(v => C(v)).concat([C('W'), C(12), C(12, 'B'), C(1)]);
assert.strictEqual(P.solve(hand, 4).need, 0); assert.strictEqual(P.solve(hand, 5).need, 0, '1 + 3..8 + wild as the 2'); assert.strictEqual(P.solve(hand, 6).need, 1);
const sp = P.splitPhase([C(5), C(5, 'B'), C('W'), C(10), C(10, 'G'), C(10, 'Y')], 1); assert(sp && sp.length === 2);

// a full game by bots
const rngs = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rng = rngs(11);
const N = +(process.env.P10_GAMES || 120);
const wins = { easy: 0, normal: 0, hard: 0 }; let rounds = 0;
for (let n = 0; n < N; n++) {
  const np = 2 + (n % 5);
  const levels = ['easy', 'normal', 'hard'];
  const g = P.newGame(Array.from({ length: np }, (_, i) => ({ name: 'b' + i, bot: true, level: levels[(i + n) % 3] })), {}, rng);
  let guard = 0;
  while (!g.over) {
    assert(guard++ < 20000, 'game did not end');
    if (g.step === 'roundover') { P.nextRound(g, rng); rounds++; continue; }
    const total = g.deck.length + g.discard.length + g.players.reduce((a, p) => a + p.hand.length + (p.laid || []).reduce((s, gr) => s + gr.cards.length, 0), 0);
    assert.strictEqual(total, 108, 'cards lost');
    const pi = g.turn;
    const d = P.botDraw(g, pi, rng); if (d.a === 'deck') P.drawDeck(g, pi, rng); else P.drawDiscard(g, pi);
    for (const a of P.botPlays(g, pi)) P.lay(g, pi, a.groups);
    if (g.step === 'roundover') continue;
    for (let k = 0; k < 12 && g.step === 'play'; k++) { const h = P.botHits(g, pi); if (!h.length) break; P.hit(g, pi, h[0].owner, h[0].gi, h[0].id); }
    if (g.step !== 'play') continue;
    const x = P.botDiscard(g, pi, rng); P.discard(g, pi, x.id, x.target);
  }
  wins[g.players[g.winner].level]++;
}
console.log(`phase10: ${N} games, ${(rounds / N + 1).toFixed(1)} rounds/game, wins by level ${JSON.stringify(wins)}`);
assert(wins.hard + wins.normal > wins.easy * 1.5, 'smarter bots should win more');
