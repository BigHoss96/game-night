// Uno: rules checks + bot self-play with every house-rule combination.
const assert = require('assert');
const U = require('./engine.js');
assert.strictEqual(U.makeDeck().length, 108);
assert.strictEqual(U.makeDeck().filter(c => c.v === 'W4').length, 4);
assert.strictEqual(U.points({ c: 'R', v: '7' }), 7); assert.strictEqual(U.points({ c: 'R', v: 'S' }), 20); assert.strictEqual(U.points({ c: 'W', v: 'W' }), 50);

// mulberry32: small seeded generator that's good enough for card shuffles
let seed = 3; const rng = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const P = n => Array.from({ length: n }, (_, i) => ({ name: 'B' + i, bot: true, level: ['easy', 'normal', 'hard'][i % 3] }));
function fixed(g, hands, topCard, color) {   // set up a position by hand
  g.players.forEach((p, i) => p.hand = hands[i].map((c, k) => ({ id: 1000 + i * 50 + k, c: c[0], v: c.slice(1) })));
  g.discard = [{ id: 999, c: topCard[0], v: topCard.slice(1) }]; g.color = color || topCard[0]; g.turn = 0; g.dir = 1; g.phase = 'play'; g.pending = null; g.drawn = null;
}
// Wild Draw Four only without a card of the color
let g = U.newGame(P(3), {}, rng);
fixed(g, [['W W4', 'R5'], ['B1'], ['G2']], 'R3');
g.players[0].hand[0] = { id: 1, c: 'W', v: 'W4' };
assert(!U.canPlay(g, 0, g.players[0].hand[0]), 'W4 illegal while holding red');
fixed(g, [['B5', 'G1'], ['B1', 'B2'], ['G2', 'G3']], 'R3'); g.players[0].hand.push({ id: 2, c: 'W', v: 'W4' });
assert(U.canPlay(g, 0, g.players[0].hand[2]));
U.play(g, 0, 2, 'G', rng); assert.strictEqual(g.players[1].hand.length, 6, 'next player draws 4'); assert.strictEqual(g.turn, 2, 'and is skipped'); assert.strictEqual(g.color, 'G');
// Reverse with two players acts as a skip
g = U.newGame(P(2), {}, rng); fixed(g, [['R9', 'RR'], ['B1', 'B2']], 'R3');
U.play(g, 0, g.players[0].hand[1].id, null, rng); assert.strictEqual(g.turn, 0);
// stacking
g = U.newGame(P(3), { stack: true }, rng); fixed(g, [['RD2', 'B1'], ['YD2', 'B4'], ['G2', 'G7']], 'R3');
U.play(g, 0, g.players[0].hand[0].id, null, rng); assert.deepStrictEqual(g.pending, { v: 'D2', n: 2 });
assert(U.canPlay(g, 1, g.players[1].hand[0]) && !U.canPlay(g, 1, g.players[1].hand[1]));
U.play(g, 1, g.players[1].hand[0].id, null, rng); assert.strictEqual(g.pending.n, 4);
U.draw(g, 2, rng); assert.strictEqual(g.players[2].hand.length, 6); assert.strictEqual(g.turn, 0, 'penalty taker loses the turn');
// 7-0
g = U.newGame(P(3), { sevenO: true }, rng); fixed(g, [['R7', 'B1', 'B2'], ['G1'], ['Y1', 'Y2', 'Y3', 'Y4']], 'R3');
U.play(g, 0, g.players[0].hand[0].id, null, rng); assert.strictEqual(g.phase, 'seven'); U.swap(g, 0, 1);
assert.strictEqual(g.players[0].hand.length, 1); assert.strictEqual(g.players[1].hand.length, 2);
// UNO catch
g = U.newGame(P(3), {}, rng); fixed(g, [['R1', 'R2'], ['B1'], ['G2']], 'R3');
U.play(g, 0, g.players[0].hand[0].id, null, rng); assert(U.canCatch(g, 1)); U.catchUno(g, 1, rng); assert.strictEqual(g.players[0].hand.length, 3);
g = U.newGame(P(3), {}, rng); fixed(g, [['R1', 'R2'], ['B1'], ['G2']], 'R3');
U.callUno(g, 0); U.play(g, 0, g.players[0].hand[0].id, null, rng); assert(!U.canCatch(g, 1), 'called UNO is safe');
// jump-in
g = U.newGame(P(3), { jumpIn: true }, rng); fixed(g, [['B1'], ['B2'], ['R3', 'G9']], 'R3');
assert(U.canJump(g, 2, g.players[2].hand[0])); U.play(g, 2, g.players[2].hand[0].id, null, rng, true); assert.strictEqual(g.turn, 0);
// scoring
g = U.newGame(P(2), { target: 0 }, rng); fixed(g, [['R5'], ['W W', 'BS', 'G7']], 'R3'); g.players[1].hand[0] = { id: 5, c: 'W', v: 'W' };
U.play(g, 0, g.players[0].hand[0].id, null, rng); assert(g.over && g.winner === 0 && g.players[0].score === 77);

// self-play
const N = +(process.env.UNO_GAMES || 300);
const combos = [{}, { stack: true }, { drawUntil: true }, { sevenO: true }, { jumpIn: true }, { stack: true, drawUntil: true, sevenO: true, jumpIn: true }];
const wins = { easy: 0, normal: 0, hard: 0 };
let rounds = 0, turns = 0;
for (let n = 0; n < N; n++) {
  const opts = Object.assign({ target: 500 }, combos[n % combos.length]);
  const np = 2 + (n % 5);
  g = U.newGame(P(np), opts, rng);
  let guard = 0;
  while (!g.over) {
    assert(guard++ < 40000, 'game did not end');
    if (g.phase === 'roundover') { U.nextRound(g, rng); rounds++; continue; }
    const total = g.deck.length + g.discard.length + g.players.reduce((a, p) => a + p.hand.length, 0);
    assert.strictEqual(total, 108, 'cards lost');
    // anyone may catch, anyone may jump in
    for (let i = 0; i < np; i++) if (U.canCatch(g, i) && U.botCatches(g.players[i], rng)) U.catchUno(g, i, rng);
    if (g.opts.jumpIn) for (let i = 0; i < np; i++) { const c = U.botJump(g, i, rng); if (c) { U.play(g, i, c.id, null, rng, true); break; } }
    if (g.phase === 'roundover') continue;
    const pi = g.phase === 'seven' ? g.sevenBy : g.turn;
    const act = U.botAct(g, pi, rng);
    turns++;
    if (act.a === 'color') U.chooseStartColor(g, act.color);
    else if (act.a === 'swap') U.swap(g, pi, act.with);
    else if (act.a === 'draw') { const r = U.draw(g, pi, rng); }
    else if (act.a === 'pass') U.pass(g, pi);
    else { if (g.players[pi].hand.length === 2 && U.botCallsUno(g.players[pi], rng)) U.callUno(g, pi); U.play(g, pi, act.id, act.color, rng); }
  }
  wins[g.players[g.winner].level]++;
}
console.log(`uno: ${N} games to 500, ${(rounds / N + 1).toFixed(1)} rounds/game, ${(turns / N).toFixed(0)} turns/game, wins by level ${JSON.stringify(wins)}`);
assert(wins.hard + wins.normal > wins.easy, 'smarter bots should win more');
