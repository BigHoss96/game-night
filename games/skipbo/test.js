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

// discard piles render as a readable fan with a count (#35)
{ const src = require('fs').readFileSync(require('path').join(__dirname, 'src.html'), 'utf8');
  const grab = re => { const m = src.match(re); assert(m, 'missing ' + re); return m[0]; };
  const code = [grab(/const ccol = [^\n]+/), grab(/function cardHtml\([\s\S]*?\n\}/), grab(/const FAN = [^\n]+/),
    grab(/function dpHtml\([\s\S]*?\n\}/), grab(/function oppDpHtml\([\s\S]*?\n\}/)].join('\n');
  const R = new Function('SB', code + '\nreturn { cardHtml, dpHtml, oppDpHtml };')(S);
  const styles = h => h.match(/style=/g) || [];
  const one = R.cardHtml({ id: 1, v: 5 }, '', 'data-src="d0"', 'top:16px');
  assert.strictEqual(styles(one).length, 1, 'a card has exactly one style attribute');
  assert(/style="--cc:[^"]*;top:16px"/.test(one), 'colour and position share one style');
  const C = vs => vs.map((v, i) => ({ id: 3000 + i, v }));
  const deep = R.dpHtml(C([12, 10, 9, 7, 6, 5, 4, 3]), 0, '', false);
  assert((deep.match(/class="card /g) || []).length === 6, 'fans the last six cards');
  assert(deep.includes('+2 more') && deep.includes('<span class="cnt">8</span>'));
  deep.split('<div class="card').slice(1).forEach(c => assert(styles(c).length <= 1));
  const tops = [...deep.matchAll(/top:calc\((\d+) \*/g)].map(m => +m[1]);
  assert.deepStrictEqual(tops, [0, 1, 2, 3, 4, 5], 'each fanned card gets its own offset');
  assert(R.dpHtml(C([8, 8, 4]), 1, '', false).includes('<span class="cnt">3</span>'));
  assert(!R.dpHtml(C([11]), 2, '', false).includes('cnt') && !R.dpHtml([], 3, '', false).includes('cnt'), 'no badge under 2 cards');
  assert(R.dpHtml(C([9, 2]), 1, '', false).includes('data-src="d1"'), 'top card is still tappable');
  assert(R.oppDpHtml(C([12, 9, 5])).includes('<b>3</b>') && !R.oppDpHtml(C([5])).includes('<b>')); }

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
