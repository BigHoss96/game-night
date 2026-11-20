// Farkle: scoring + bot self-play.
const assert = require('assert');
const F = require('./engine.js');
const S = F.scoreOf;
assert.strictEqual(S([1]), 100); assert.strictEqual(S([5]), 50); assert.strictEqual(S([1, 5]), 150);
assert.strictEqual(S([2]), 0, 'a 2 alone scores nothing'); assert.strictEqual(S([1, 2]), 0, 'selection must score in full');
assert.strictEqual(S([2, 2, 2]), 200); assert.strictEqual(S([1, 1, 1]), 1000); assert.strictEqual(S([5, 5, 5]), 500);
assert.strictEqual(S([3, 3, 3, 3]), 1000); assert.strictEqual(S([3, 3, 3, 3, 3]), 2000); assert.strictEqual(S([3, 3, 3, 3, 3, 3]), 3000);
assert.strictEqual(S([1, 2, 3, 4, 5, 6]), 1500); assert.strictEqual(S([2, 2, 4, 4, 6, 6]), 1500);
assert.strictEqual(S([2, 2, 2, 2, 6, 6]), 1500, '4 of a kind + pair = three pairs');
assert.strictEqual(S([2, 2, 2, 6, 6, 6]), 2500); assert.strictEqual(S([1, 1, 1, 1, 5, 5]), 1500);
assert.strictEqual(S([1, 1, 1, 5]), 1050); assert.strictEqual(S([4, 4, 4, 1, 5]), 550);
assert.strictEqual(S([1, 1, 1, 1, 1, 1]), 3000);
assert(F.canScore([2, 3, 3, 6, 6, 2]) === true, 'three pairs scores');
assert(F.canScore([2, 3, 4, 6, 6, 3]) === false);
assert(F.canScore([2, 3]) === false && F.canScore([2, 2, 2]) === true);
assert.strictEqual(F.describe([1, 1, 5, 4, 4, 4]), 'Three 4s + 2 ones + a five');

// entry rule and final round
let g = F.newGame([{ name: 'A' }, { name: 'B' }]);
g.dice = [1, 2, 3, 4, 6, 6]; g.rolled = true; F.keep(g, [0]);
assert(!F.canBank(g), 'needs 500 to get on the board');
g.turnPts = 600; assert(F.canBank(g)); F.bank(g); assert.strictEqual(g.players[0].score, 600); assert.strictEqual(g.turn, 1);
g = F.newGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
g.players.forEach(p => p.on = true); g.players[0].score = 9800;
g.dice = [1, 1, 1, 2, 3, 4]; g.rolled = true; F.keep(g, [0, 1, 2]); F.bank(g);
assert(g.finalRound && !g.over); F.startTurn(g);
g.dice = [5, 2, 3, 4, 6, 6]; F.keep(g, [0]); F.bank(g); assert(!g.over);
g.dice = [5, 2, 3, 4, 6, 6]; F.keep(g, [0]); F.bank(g); assert(g.over && g.winner === 0, 'everyone else gets one turn');
// hot dice off: must bank once all six score (if on the board)
g = F.newGame([{ name: 'A' }, { name: 'B' }]); g.players[0].on = true;
g.dice = [1, 2, 3, 4, 5, 6]; g.rolled = true; F.keep(g, [0, 1, 2, 3, 4, 5]); assert(!F.canRollAgain(g) && F.canBank(g));
g = F.newGame([{ name: 'A' }, { name: 'B' }], { hot: true }); g.players[0].on = true;
g.dice = [1, 2, 3, 4, 5, 6]; g.rolled = true; F.keep(g, [0, 1, 2, 3, 4, 5]); assert(F.canRollAgain(g));
assert.strictEqual(F.roll(g, Math.random).length, 6);
g = F.newGame([{ name: 'A' }, { name: 'B' }], { final: false }); g.players[0].on = true; g.players[0].score = 9900;
g.dice = [1, 2, 3, 4, 6, 6]; g.rolled = true; F.keep(g, [0]); F.bank(g); assert(g.over && g.winner === 0, 'no final round: first to target wins');
// three farkles
g = F.newGame([{ name: 'A' }, { name: 'B' }], { three: true }); g.players[0].score = 2000; g.players[0].farkles = 2; F.farkle(g);
assert.strictEqual(g.players[0].score, 1000);

// bot self-play
let seed = 5; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const N = +(process.env.FK_GAMES || 400);
for (const opts of [{}, { hot: true, three: true }]) {
  let turns = 0; const wins = { sharp: 0, casual: 0 };
  for (let n = 0; n < N; n++) {
    const order = n % 2 ? ['sharp', 'casual'] : ['casual', 'sharp'];
    g = F.newGame(order.map(s => ({ name: s, bot: true, skill: s })), opts);
    let guard = 0;
    while (!g.over) {
      assert(guard++ < 5000, 'game did not end');
      const p = g.players[g.turn], before = g.turn;
      F.roll(g, rng);
      if (g.farkled) { F.farkle(g); turns++; continue; }
      const pick = F.botPick(g, p.skill);
      assert(pick && pick.idx.length);
      F.keep(g, pick.idx);
      if (pick.bank && F.canBank(g)) { F.bank(g); turns++; }
      else if (!F.canRollAgain(g)) { assert(F.canBank(g), 'stuck: cannot roll or bank'); F.bank(g); turns++; }
      assert(g.over || g.players[before]);
    }
    wins[g.players[g.winner].skill]++;
  }
  console.log(`farkle ${JSON.stringify(opts)}: ${N} games, ${(turns / N).toFixed(1)} turns/game, sharp wins ${(100 * wins.sharp / N).toFixed(0)}%`);
  assert(wins.sharp > wins.casual, 'sharp bot should beat casual');
}
