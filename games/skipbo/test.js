// Skip-Bo: rules checks + bot self-play.
const assert = require('assert');
const S = require('./engine.js');
assert.strictEqual(S.makeDeck().length, 162);
assert.strictEqual(S.makeDeck().filter(S.isSB).length, 18);
const rngs = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rng = rngs(21);
const P = (n, lv) => Array.from({ length: n }, (_, i) => ({ name: 'b' + i, bot: true, level: lv ? lv[i % lv.length] : 'normal' }));
let g = S.newGame(P(3), {}, rng);
assert(g.players.every(p => p.stock.length === 30) && g.players[g.turn].hand.length === 5);
assert.strictEqual(S.newGame(P(5), {}, rng).players[0].stock.length, 20);
assert.strictEqual(S.newGame(P(2), { quick: true }, rng).players[0].stock.length, 15);
// build piles count up from 1; wilds take the needed number; a full pile clears
g = S.newGame(P(2), {}, rng); const me = g.turn, p = g.players[me];
p.hand = [{ id: 900, v: 1 }, { id: 901, v: 'SB' }, { id: 902, v: 3 }, { id: 903, v: 5 }, { id: 904, v: 9 }];
assert(!S.canPlay(g, me, { from: 'hand', id: 902 }, 0));
S.play(g, me, { from: 'hand', id: 900 }, 0); S.play(g, me, { from: 'hand', id: 901 }, 0); S.play(g, me, { from: 'hand', id: 902 }, 0);
assert.strictEqual(S.need(g, 0), 4); assert.strictEqual(g.build[0][1].as, 2);
g.build[1] = Array.from({ length: 11 }, (_, i) => ({ id: 2000 + i, v: i + 1, as: i + 1 }));
p.hand.push({ id: 905, v: 12 }); S.play(g, me, { from: 'hand', id: 905 }, 1); assert.strictEqual(g.build[1].length, 0, 'a finished pile clears');
// empty hand mid-turn draws five
g = S.newGame(P(2), {}, rng); const q = g.players[g.turn]; q.hand = [{ id: 950, v: 1 }];
S.play(g, g.turn, { from: 'hand', id: 950 }, 0); assert.strictEqual(q.hand.length, 5);

// discarding onto a pile that already has cards stacks on top (#34)
g = S.newGame(P(2), {}, rng); { const pi = g.turn, d = g.players[pi];
  d.discards[1] = [{ id: 960, v: 9 }]; const id = d.hand[0].id;
  S.discard(g, pi, id, 1); assert.strictEqual(d.discards[1].length, 2); assert.strictEqual(d.discards[1][1].id, id); }

// self-play
const N = +(process.env.SB_GAMES || 150);
const wins = { easy: 0, normal: 0, hard: 0 }; let turns = 0;
for (let n = 0; n < N; n++) {
  const np = 2 + (n % 4);
  const lv = ['easy', 'normal', 'hard'].map((_, i, a) => a[(i + n) % 3]);
  g = S.newGame(P(np, lv), { quick: n % 2 === 0 }, rng);
  let guard = 0;
  while (!g.over) {
    assert(guard++ < 60000, 'game did not end');
    const total = g.deck.length + g.done.length + g.build.reduce((a, b) => a + b.length, 0) + g.players.reduce((a, p) => a + p.hand.length + p.stock.length + p.discards.reduce((s, d) => s + d.length, 0), 0);
    assert.strictEqual(total, 162, 'cards lost');
    const pi = g.turn, m = S.botMove(g, pi, rng);
    if (m.a === 'play') S.play(g, pi, m.src, m.b, rng);
    else if (m.a === 'discard') { S.discard(g, pi, m.id, m.k, rng); turns++; }
    else { S.pass(g, pi); turns++; }
  }
  wins[g.players[g.winner].level]++;
}
console.log(`skipbo: ${N} games, ${(turns / N).toFixed(0)} turns/game, wins by level ${JSON.stringify(wins)}`);
assert(wins.hard + wins.normal > wins.easy * 1.5, 'smarter bots should win more');
