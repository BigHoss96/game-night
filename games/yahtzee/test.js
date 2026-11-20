// Yahtzee: scoring rules + bot self-play.
const assert = require('assert');
const Y = require('./engine.js');
const c0 = Y.newCard();
const S = (cat, d, card) => Y.score(card || c0, cat, d);
assert.strictEqual(S('threes', [3, 3, 1, 3, 6]), 9);
assert.strictEqual(S('three', [2, 2, 2, 5, 6]), 17);
assert.strictEqual(S('three', [2, 2, 1, 5, 6]), 0);
assert.strictEqual(S('four', [4, 4, 4, 4, 1]), 17);
assert.strictEqual(S('full', [3, 3, 5, 5, 5]), 25);
assert.strictEqual(S('full', [5, 5, 5, 5, 5]), 0, 'yahtzee is not a full house without joker');
assert.strictEqual(S('small', [1, 2, 3, 4, 6]), 30);
assert.strictEqual(S('small', [3, 4, 5, 6, 6]), 30);
assert.strictEqual(S('small', [1, 2, 3, 5, 6]), 0);
assert.strictEqual(S('large', [2, 3, 4, 5, 6]), 40);
assert.strictEqual(S('yahtzee', [6, 6, 6, 6, 6]), 50);
assert.strictEqual(S('chance', [1, 2, 3, 4, 6]), 16);
// joker rules
const c = Y.newCard(); c.yahtzee = 50;
assert.deepStrictEqual(Y.legal(c, [4, 4, 4, 4, 4]), ['fours'], 'forced upper box');
c.fours = 12;
assert(Y.legal(c, [4, 4, 4, 4, 4]).indexOf('full') >= 0 && Y.legal(c, [4, 4, 4, 4, 4]).indexOf('ones') < 0);
assert.strictEqual(Y.score(c, 'large', [4, 4, 4, 4, 4]), 40);
assert.strictEqual(Y.score(c, 'full', [4, 4, 4, 4, 4]), 25);
Y.apply(c, 'large', [4, 4, 4, 4, 4]); assert.strictEqual(c.ybonus, 100);
const z = Y.newCard(); z.yahtzee = 0;
assert.strictEqual(Y.yahtzeeBonus(z, [2, 2, 2, 2, 2]), 0, 'no bonus after zeroing yahtzee');
// upper bonus
const u = Y.newCard(); Object.assign(u, { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
assert.strictEqual(Y.totals(u).bonus, 35);

// bot self-play
let seed = 11; const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const N = +(process.env.YZ_GAMES || 40);
for (const skill of ['sharp', 'casual']) {
  let tot = 0, ys = 0, bonus = 0;
  const t0 = Date.now();
  for (let n = 0; n < N; n++) {
    const g = Y.newGame([{ name: 'A', bot: true, skill }]);
    while (!g.over) {
      g.held = [false, false, false, false, false]; g.rolls = 0;
      Y.roll(g, rng);
      while (g.rolls < 3) {
        const h = Y.bestHold(g.players[0].card, g.dice, 3 - g.rolls, skill);
        if (h.stop) break;
        g.held = h.held; Y.roll(g, rng);
      }
      const cat = Y.botChoose(g.players[0].card, g.dice, skill);
      assert(Y.legal(g.players[0].card, g.dice).indexOf(cat) >= 0);
      Y.scoreTurn(g, cat);
    }
    const t = Y.totals(g.players[0].card); tot += t.total; if (g.players[0].card.yahtzee === 50) ys++; if (t.bonus) bonus++;
  }
  console.log(`yahtzee ${skill}: avg ${(tot / N).toFixed(1)}  yahtzee ${(100 * ys / N).toFixed(0)}%  upper bonus ${(100 * bonus / N).toFixed(0)}%  ${((Date.now() - t0) / N).toFixed(0)} ms/game`);
  if (skill === 'sharp') assert(tot / N > 205, 'sharp bot should average over 205');
}
