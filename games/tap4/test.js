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
      if (type === 'roundEnd') for (const p of g.players) {
        // #18: the round summary shows every leftover card, face-down ones included, and they add up to the score
        const left = T.leftovers(p);
        assert.strictEqual(left.reduce((a, x) => a + T.POINTS(x.c), 0), p.lastScore, 'leftovers must add up to the round score');
        assert.strictEqual(left.filter(x => x.down).length, p.piles.reduce((a, pl) => a + pl.filter(s => !s.up).length, 0), 'face-down cards missing from leftovers');
        if (left.some(x => x.down)) stats.revealed = (stats.revealed || 0) + 1;
      }
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

// Wording (#19): a seat named "You" must read "You win!", not "You wins!".
{
  const S = T.Say;
  const you = { name: 'You' }, rosie = { name: 'Rosie' }, gus = { name: 'Gus' };
  assert.strictEqual(S.winners([you]), 'You win!');
  assert.strictEqual(S.winners([rosie]), 'Rosie wins!');
  assert.strictEqual(S.winners([gus, you]), 'You & Gus win!');
  assert.strictEqual(S.winners([rosie, gus]), 'Rosie & Gus win!');
  const pickup = (p, n) => `${S.who(p)} ${S.verb(p, 'picks', 'pick')} up ${n} cards`;
  assert.strictEqual(pickup(you, 3), 'You pick up 3 cards');
  assert.strictEqual(pickup(rosie, 3), 'Rosie picks up 3 cards');
  assert.strictEqual(`${S.cap(S.whose(you))} turn`, 'Your turn');
  assert.strictEqual(`${S.cap(S.whose(rosie))} turn`, "Rosie's turn");
  assert.strictEqual(`${S.who(you)} ${S.is(you)} out`, 'You are out');
  assert.strictEqual(`${S.who(gus)} ${S.verb(gus, 'loses', 'lose')} ${S.their(gus)} next turn`, 'Gus loses their next turn');
  assert.strictEqual(`${S.who(you)} ${S.verb(you, 'loses', 'lose')} ${S.their(you)} next turn`, 'You lose your next turn');
  assert(S.isYou({ name: ' you ' }) && !S.isYou({ name: 'Youssef' }));
  // Every caption in the app goes through the helpers: no raw "<name> plays/picks/is …".
  const app = require('fs').readFileSync(require('path').join(__dirname, 'app.js'), 'utf8');
  const raw = app.match(/\$\{esc\(e\.(p|starter|to)\.name\)\} (\w+)/g) || [];
  const bad = raw.filter(m => /(s|is)$/.test(m.split(' ').pop()));
  assert.deepStrictEqual(bad, [], 'captions that would say "You plays" etc.');
  console.log('Tap 4 wording OK');
}

// #20: a blank name is "You" for a lone human, typed names are trimmed and kept.
{
  const n = T.seatNames;
  assert.deepStrictEqual(n([{ name: '', kind: 'human' }, { name: 'Rosie', kind: 'bot' }]), ['You', 'Rosie']);
  assert.deepStrictEqual(n([{ name: '  Austin ', kind: 'human' }, { name: '', kind: 'bot' }]), ['Austin', 'Bot 2']);
  assert.deepStrictEqual(n([{ name: '', kind: 'human' }, { name: ' ', kind: 'human' }]), ['Player 1', 'Player 2']);
  assert.deepStrictEqual(n([{ name: 'You', kind: 'human' }, { name: 'Gus', kind: 'bot' }]), ['You', 'Gus']);
  console.log('Tap 4 seat names OK');
}

// #39: Rematch keeps the same table: bot names, kinds and levels don't change
{
  const seats = [{ name: 'Rob', kind: 'human' }, { name: 'Iris', kind: 'bot', level: 'normal' }, { name: 'Mabel', kind: 'bot', level: 'hard' }];
  const g = new T.Game(seats, { target: 50 });
  const again = T.rematchSeats(g.players);
  assert.deepStrictEqual(again, [{ name: 'Rob', kind: 'human', level: 'normal' }, { name: 'Iris', kind: 'bot', level: 'normal' }, { name: 'Mabel', kind: 'bot', level: 'hard' }]);
  assert.deepStrictEqual(new T.Game(again, { target: 50 }).players.map(p => [p.name, p.kind, p.level]), [['Rob', 'human', 'normal'], ['Iris', 'bot', 'normal'], ['Mabel', 'bot', 'hard']]);
  const app = require('fs').readFileSync(require('path').join(__dirname, 'app.js'), 'utf8');
  assert(/#againB'\)\.onclick = \(\) => \{[^\n]*Tap4\.rematchSeats\(G\.players\)/.test(app) && !/#againB[^\n]*freshBots/.test(app), 'tap4 rematch keeps names');
  console.log('Tap 4 rematch keeps names OK');
}
