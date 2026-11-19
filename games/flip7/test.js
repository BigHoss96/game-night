const F = require('./engine.js');
const assert = require('assert');

// deck composition
const d = F.buildDeck();
assert.strictEqual(d.length, 94);
assert.strictEqual(d.filter(c => c.t === 'num').length, 79);
assert.strictEqual(d.filter(c => c.t === 'num' && c.v === 12).length, 12);
assert.strictEqual(d.filter(c => c.t === 'mod').length, 6);
assert.strictEqual(d.filter(c => c.t === 'act').length, 9);

// scoring example: 3+11+5+7+10 with +10 => 46; with x2 => 82
const sc = (nums, mods = [], status = 'stayed') => F.roundScore({ nums: nums.map(v => ({ v })), mods, status });
assert.strictEqual(sc([3, 11, 5, 7, 10], [{ add: 10 }]), 46);
assert.strictEqual(sc([3, 11, 5, 7, 10], [{ mult: true }, { add: 10 }]), 82);
assert.strictEqual(sc([3, 11, 5, 7, 10, 9, 4], [{ add: 10 }]), 49 + 10 + 15);
assert.strictEqual(sc([3, 4], [{ add: 10 }], 'busted'), 0);

function countAll(g) {
  let n = g.deck.length + g.discard.length + g.pending.length + (g.inFlight ? 1 : 0);
  for (const p of g.players) n += p.nums.length + p.mods.length + p.acts.length;
  return n;
}

let seed = 1;
const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const stats = { games: 0, rounds: 0, flip7: 0, busts: 0, saves: 0, freezes: 0, f3: 0, deferred: 0, reshuffles: 0, wins: {} };

(async () => {
  for (let gi = 0; gi < 3000; gi++) {
    const n = 2 + (gi % 7);
    const levels = ['easy', 'normal', 'hard'];
    const seats = [...Array(n)].map((_, i) => ({ name: 'P' + i, level: levels[(i + gi) % 3] }));
    let g;
    const emit = async (type, e) => {
      assert.strictEqual(countAll(g), 94, `card count broke at ${type}`);
      for (const p of g.players) {
        const vals = p.nums.map(c => c.v);
        if (p.status !== 'busted') assert.strictEqual(new Set(vals).size, vals.length, 'dup without bust');
        assert(p.acts.filter(a => a.v === 'second').length <= 1, 'two second chances');
        assert.strictEqual(p.sc, p.acts.some(a => a.v === 'second'), 'sc flag mismatch');
      }
      if (type === 'redraw') { assert(g.modRedraw, 'redraw while off'); assert(!g.pullNum && e.p.status === 'active'); stats.redraws = (stats.redraws || 0) + 1; }
      if (type === 'hit' || type === 'deal') { pullOpen = true; pullP = e.p; }
      if (type === 'turn' || type === 'roundEnd') {
        // previous pull must have ended on a number (or the puller is out / round over)
        if (pullOpen && g.modRedraw && pullP.status === 'active' && type === 'turn') assert(lastNumFor === pullP, 'pull ended without a number');
        pullOpen = false; lastNumFor = null;
      }
      if (type === 'placed' || type === 'bust' || type === 'saved') { if (e.card.t === 'num' && e.p === pullP) lastNumFor = e.p; }
      if (type === 'draw' && !e.inF3) { if (pullOpen && lastWasMod && g.modRedraw) assert(true); }
      if (type === 'flip7') stats.flip7++;
      if (type === 'bust') stats.busts++;
      if (type === 'saved') stats.saves++;
      if (type === 'frozen') stats.freezes++;
      if (type === 'flip3Start') stats.f3++;
      if (type === 'deferred') stats.deferred++;
      if (type === 'reshuffle') stats.reshuffles++;
      if (type === 'roundEnd') stats.rounds++;
    };
    g = new F.Game(seats, { rng, emit, modRedraw: gi % 2 === 0 });
    let pullOpen = false, lastWasMod = false, pullP = null, lastNumFor = null;
    // exercise snapshot/restore mid-game sometimes
    await g.run();
    stats.games++;
    assert(g.winner && g.winner.total >= 200);
    const lvl = g.winner.level; stats.wins[lvl] = (stats.wins[lvl] || 0) + 1;
  }

  // snapshot / restore round-trip mid-round
  {
    let snap = null, g;
    const stopErr = new Error('stop');
    const emit = async (type) => { if (type === 'turn' && g.round === 3 && !snap) { snap = JSON.parse(JSON.stringify(g.snapshot('turn'))); throw stopErr; } };
    g = new F.Game([{ name: 'A' }, { name: 'B' }, { name: 'C' }], { rng, emit });
    try { await g.run(); } catch (e) { if (e !== stopErr) throw e; }
    const g2 = F.Game.restore(snap, { rng, emit: async () => assert.strictEqual(countAll(g2), 94) });
    await g2.run({ phase: 'turn', turnIdx: snap.turnIdx });
    assert(g2.winner);
  }
  console.log('OK', stats);
})().catch(e => { console.error(e); process.exit(1); });

// Seat names: a blank name is "You" for a lone human, typed names are trimmed and kept.
{
  const n = require('./engine.js').seatNames;
  assert.deepStrictEqual(n([{ name: '', kind: 'human' }, { name: 'Rosie', kind: 'bot' }]), ['You', 'Rosie']);
  assert.deepStrictEqual(n([{ name: ' Rob ', kind: 'human' }, { name: '', kind: 'bot' }]), ['Rob', 'Bot 2']);
  assert.deepStrictEqual(n([{ name: '', kind: 'human' }, { name: '', kind: 'human' }]), ['Player 1', 'Player 2']);
}
