// Paydirt: chart format checks + bot-vs-bot season simulation.
const assert = require('assert');
const TEAMS = require('./teams.js');
const E = require('./engine.js');
E.setTeams(TEAMS);

// ---- charts ----
const ids = Object.keys(TEAMS);
assert.strictEqual(ids.length, 32, '32 teams');
const OFFCOLS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'B', 'QT', 'KO', 'KR', 'P', 'PR', 'IR', 'FG'];
for (const id of ids) {
  const t = TEAMS[id];
  for (const c of OFFCOLS) {
    assert.strictEqual(t.off[c].length, 30, `${id} ${c} rows`);
    for (const s of t.off[c]) assert(E.parse(s).t !== 'blank' || s === '', `${id} ${c} unreadable "${s}"`);
  }
  for (const f of 'ABCDEF') for (const p of E.SCRIM) {
    assert.strictEqual(t.def[f][p].length, 5, `${id} def ${f}${p}`);
    for (const s of t.def[f][p]) assert(s === '' || E.parse(s).t !== 'blank', `${id} def unreadable "${s}"`);
  }
  assert(t.fumRec.every(n => n >= 10 && n <= 39) && t.patMiss.every(n => n >= 10 && n <= 39));
}
// dice
let sum = 0; for (const k in E.OPROB) sum += E.OPROB[k];
assert(Math.abs(sum - 1) < 1e-9 && Object.keys(E.OPROB).length === 30);
const rd = E.rollDef(Math.random); assert(rd.total >= 1 && rd.total <= 5);

// parse
assert.deepStrictEqual(E.parse('(3)'), { t: 'Y', y: 3, paren: true });
assert.strictEqual(E.parse('INT 14').y, 14);
assert.strictEqual(E.parse('F -2').y, -2);
assert(E.parse('44†').dag && E.parse('7*').oob);

// field orientation (#28): fixed field, visitors (side 0) drive right, home (side 1) drives left
assert.strictEqual(E.fieldX(0, 25), 25);
assert.strictEqual(E.fieldX(1, 25), 75);
assert.strictEqual(E.fieldX(1, 0), 100, 'home goal line is on the right');
let fxChecked = 0;

// big-moment banners (#26)
{
  const H = (b, a, txt, call) => E.highlight(Object.assign({ poss: 0, score: [0, 0], ball: 30, phase: 'scrimmage' }, b),
    Object.assign({ poss: 0, score: [0, 0], ball: 30, phase: 'scrimmage' }, a), { txt, det: { call } });
  assert.strictEqual(H({}, { score: [6, 0], phase: 'pat', ball: 98 }, '70-yard touchdown pass! TOUCHDOWN GB!', '8').kind, 'td');
  // the reported play: GB long pass picked off at the GB 22, CHI returns it 30 yards
  const intc = H({ ball: 22 }, { poss: 1, ball: 58 }, 'INTERCEPTED by CHI, returned 30 yards.', '8');
  assert.strictEqual(intc.kind, 'turnover'); assert.strictEqual(intc.label, 'INTERCEPTED!'); assert.strictEqual(intc.side, 1);
  assert.strictEqual(H({}, { poss: 1, score: [0, 6], phase: 'pat' }, 'INTERCEPTED! CHI returns it all the way. TOUCHDOWN!', '7').label, 'PICK SIX!');
  assert.strictEqual(H({}, { poss: 1, ball: 70 }, 'FUMBLE! Recovered by CHI.', '2').label, 'FUMBLE!');
  assert.strictEqual(H({}, { poss: 1, ball: 45 }, 'Gain of 2. Turnover on downs.', '1').label, 'TURNOVER ON DOWNS');
  const big = H({}, { ball: 55 }, 'Complete, gain of 25. First down!', '7');
  assert.strictEqual(big.kind, 'big'); assert.strictEqual(big.label, 'BIG PLAY! +25');
  assert.strictEqual(H({}, { poss: 1, ball: 25 }, '45-yard punt, returned 5 yards to the CHI 25.', 'P'), null, 'a punt is not a turnover');
  assert.strictEqual(H({}, { ball: 34 }, 'Gain of 4.', '2'), null);
  assert.strictEqual(H({}, { score: [3, 0], phase: 'kickoff' }, '40-yard field goal is GOOD.', 'FG'), null);
  assert.strictEqual(H({}, { poss: 1, score: [0, 2], phase: 'kickoff' }, 'Sacked, tackled in the end zone. SAFETY!', '8').kind, 'safety');
}
const hlCount = { td: 0, turnover: 0, big: 0, safety: 0 }; let hlPlays = 0;

// ---- simulation ----
let seed = 7;
const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const N = +(process.env.PD_GAMES || 600);
const agg = { pts: 0, plays: 0, rushY: 0, rush: 0, passY: 0, att: 0, comp: 0, int: 0, fum: 0, sacks: 0, pen: 0, ot: 0, ties: 0, byTeam: {} };
for (let gi = 0; gi < N; gi++) {
  const a = ids[gi % 32]; let b; do { b = ids[Math.floor(rng() * 32)]; } while (b === a);
  const g = E.newGame({ teams: [a, b], rng });
  let guard = 0;
  while (!g.over) {
    assert(guard++ < 600, 'game did not end');
    E.prepare(g, rng);
    if (g.over) break;
    const call = E.botOffense(g, rng);
    assert(E.legalOff(g).indexOf(call) >= 0, `illegal call ${call} in ${g.phase}`);
    const form = E.needsDefense(g, call) ? E.botDefense(g, rng) : null;
    const bf = { poss: g.poss, ball: g.ball, phase: g.phase, score: g.score.slice() };
    const ent = E.play(g, call, form, rng);
    const hl = E.highlight(bf, g, ent); hlPlays++; if (hl) hlCount[hl.kind]++;
    if (bf.phase === 'scrimmage' && g.phase === 'scrimmage' && g.poss === bf.poss && !g.over) {
      // a gain of N moves the ball N yards toward the offense's goal: right for side 0, left for side 1
      const d = E.fieldX(g.poss, g.ball) - E.fieldX(bf.poss, bf.ball);
      assert(d === (g.ball - bf.ball) * (g.poss === 0 ? 1 : -1), 'field direction');
      fxChecked++;
    }
    if (g.phase === 'scrimmage') {
      assert(g.ball >= 1 && g.ball <= 99, `ball ${g.ball}`);
      assert(g.down >= 1 && g.down <= 4, `down ${g.down}`);
      assert(g.togo >= 1 && g.ball + g.togo <= 100, `togo ${g.togo} at ${g.ball}`);
    }
    assert(g.clock >= 0 && g.clock <= g.qlen);
    for (const s of [0, 1]) if (E.botTimeout(g, s)) assert(E.timeout(g, s));
    assert(g.to[0] >= 0 && g.to[1] >= 0);
  }
  agg.pts += g.score[0] + g.score[1]; agg.plays += g.plays;
  if (g.qtr >= 5) agg.ot++;
  if (g.score[0] === g.score[1]) agg.ties++;
  for (const s of [0, 1]) {
    const st = g.stats[s]; for (const k of ['rushY', 'rush', 'passY', 'att', 'comp', 'int', 'fum', 'sacks', 'pen']) agg[k] += st[k];
    const t = g.teams[s]; const bt = agg.byTeam[t] = agg.byTeam[t] || { pf: 0, pa: 0, w: 0, n: 0 };
    bt.pf += g.score[s]; bt.pa += g.score[1 - s]; bt.n++; if (g.score[s] > g.score[1 - s]) bt.w++;
  }
}
const per = x => (x / (2 * N)).toFixed(1);
const ppg = agg.pts / (2 * N);
console.log(`paydirt: ${N} games  pts/team ${ppg.toFixed(1)}  plays/game ${(agg.plays / N).toFixed(0)}  ypc ${(agg.rushY / agg.rush).toFixed(2)}  comp ${(100 * agg.comp / agg.att).toFixed(0)}%  ypa ${(agg.passY / agg.att).toFixed(2)}  int/team ${per(agg.int)}  fum/team ${per(agg.fum)}  sacks/team ${per(agg.sacks)}  pen/team ${per(agg.pen)}  OT ${agg.ot} ties ${agg.ties}`);
if (process.env.PD_TEAMS) {
  const rows = Object.entries(agg.byTeam).map(([t, v]) => [t, (v.pf / v.n).toFixed(1), (v.pa / v.n).toFixed(1), (v.w / v.n).toFixed(2), TEAMS[t].record]).sort((x, y) => y[3] - x[3]);
  for (const r of rows) console.log(r.join('\t'));
}
for (const k of ['td', 'turnover', 'big']) assert(hlCount[k] > 0 && hlCount[k] / hlPlays < 0.2, `highlight rate ${k} ${hlCount[k]}/${hlPlays}`);
assert((hlCount.td + hlCount.turnover + hlCount.big + hlCount.safety) / hlPlays < 0.25, 'too many highlights');
console.log(`paydirt highlights per game: td ${(hlCount.td / N).toFixed(1)} turnover ${(hlCount.turnover / N).toFixed(1)} big ${(hlCount.big / N).toFixed(1)} safety ${(hlCount.safety / N).toFixed(2)}`);
assert(fxChecked > 1000, 'field direction checked on many plays');
// sanity bands around real NFL numbers
assert(ppg > 15 && ppg < 32, `points per team ${ppg}`);
assert(agg.rushY / agg.rush > 3.2 && agg.rushY / agg.rush < 5.6, 'yards per carry');
const cp = agg.comp / agg.att; assert(cp > 0.52 && cp < 0.72, `completion % ${cp}`);
