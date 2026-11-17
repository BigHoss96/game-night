const T = require('./engine.js');
const assert = require('assert');
const d = T.buildDeck();
assert.strictEqual(d.length, 114);
assert.strictEqual(d.filter(c => c.t === 'num' && c.v === 7).length, 8);
assert.strictEqual(d.filter(c => c.t === 'in').length, 11);
assert.strictEqual(d.filter(c => c.t === 'out').length, 7);

function countAll(g) {
  let n = g.stack.length + g.discard.length + g.aside.length;
  for (const p of g.players) n += p.hand.length + p.outs.length + p.piles.reduce((a, pl) => a + pl.length, 0);
  return n;
}
let seed = 7;
const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const stats = { turns: 0, games: 0, rounds: 0, taps4: 0, tapIns: 0, outsOther: 0, outsSelf: 0, skips: 0, cancels: 0, pickups: 0, flipFails: 0, wins: {}, maxHand: 0 };
(async () => {
  for (let gi = 0; gi < 2000; gi++) {
    const n = 2 + (gi % 5); // 2..6
    const levels = ['easy', 'normal', 'hard'];
    const seats = [...Array(n)].map((_, i) => ({ name: 'P' + i, level: levels[(i + gi) % 3] }));
    let g;
    const emit = async (type, e) => {
      if (g.round > 0 && type !== 'gameEnd') assert.strictEqual(countAll(g), 114, 'count at ' + type);
      if (type === 'play') { for (let i = 1; i < g.stack.length; i++) assert(g.stack[i].v <= g.stack[i - 1].v, 'stack not descending'); }
      if (type === 'tapped' && e.by === 'four') { stats.taps4++; assert(g.topRun() >= 4); }
      if (type === 'tapped' && e.by === 'tapin') stats.tapIns++;
      if (type === 'tapOutOther') { stats.outsOther++; assert(!g.twoP); }
      if (type === 'tapOutSelf') stats.outsSelf++;
      if (type === 'skipped') stats.skips++;
      if (type === 'turn') stats.turns++;
      if (type === 'cancelSkip') stats.cancels++;
      if (type === 'pickup') { stats.pickups++; stats.maxHand = Math.max(stats.maxHand, e.p.hand.length); }
      if (type === 'flipFail') stats.flipFails++;
      if (type === 'roundStart') {
        for (const p of g.players) {
          assert.strictEqual(p.hand.length, 11);
          assert.strictEqual(p.piles.reduce((a, pl) => a + pl.length, 0), g.twoP ? 16 : 8);
        }
      }
      if (type === 'roundEnd') {
        stats.rounds++;
        if (e.out) assert.strictEqual(T.cardsLeft(e.out), 0); else stats.stalls = (stats.stalls || 0) + 1;
      }
    };
    g = new T.Game(seats, { rng, emit });
    await g.run();
    stats.games++;
    assert(g.over && g.winners.length);
    assert(Math.max(...g.players.map(p => p.total)) >= 150);
    for (const w of g.winners) stats.wins[w.level] = (stats.wins[w.level] || 0) + 1 / g.winners.length;
  }
  // snapshot round trip
  {
    let snap = null, g; const stop = new Error('stop');
    g = new T.Game([{ name: 'A' }, { name: 'B' }, { name: 'C' }], { rng, emit: async (t) => { if (t === 'turn' && g.round === 2 && !snap) { snap = g.snapshot('turn'); throw stop; } } });
    try { await g.run(); } catch (e) { if (e !== stop) throw e; }
    const g2 = T.Game.restore(JSON.parse(JSON.stringify(snap)), { rng, emit: async () => assert.strictEqual(countAll(g2), 114) });
    await g2.run({ phase: 'turn', turnIdx: snap.turnIdx });
    assert(g2.over);
  }
  for (const k in stats.wins) stats.wins[k] = Math.round(stats.wins[k]);
  console.log('OK', stats);
})().catch(e => { console.error(e); process.exit(1); });
