// Paydirt rules engine. Pure functions over a plain game object; no DOM.
// Ball position `ball` is yards from the possessing team's own goal line (0..100).
(function (root) {
'use strict';

const PLAYS = { 1: 'Line Plunge', 2: 'Off Tackle', 3: 'End Run', 4: 'Draw', 5: 'Screen', 6: 'Short Pass', 7: 'Medium Pass', 8: 'Long Pass', 9: 'Sideline Pass',
  P: 'Punt', FG: 'Field Goal', K: 'QB Kneel', S: 'Spike', KO: 'Kickoff', ONS: 'Onside Kick', XP: 'Extra Point', '2PT': 'Two-Point Try' };
const FORMS = { A: 'Standard', B: 'Short Yardage', C: 'Spread', D: 'Short Pass', E: 'Long Pass', F: 'Blitz' };
const SCRIM = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const BLACK = [1, 2, 2, 3, 3, 3], WHITE = [0, 1, 2, 3, 4, 5], WHITE2 = [0, 0, 1, 2, 3, 4], RED = [0, 0, 0, 1, 1, 2], GREEN = [1, 1, 1, 2, 2, 3];

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
function rollOff(rng) { const d = [pick(BLACK, rng), pick(WHITE, rng), pick(WHITE2, rng)]; return { dice: d, total: 10 * d[0] + d[1] + d[2] }; }
function rollDef(rng) { const d = [pick(RED, rng), pick(GREEN, rng)]; return { dice: d, total: d[0] + d[1] }; }

// ---------- chart entries ----------
function parse(s) {
  s = (s || '').trim();
  if (!s) return { t: 'blank' };
  let m;
  if ((m = s.match(/^\((-?\d+)\)$/))) return { t: 'Y', y: +m[1], paren: true };
  if ((m = s.match(/^\[(-?\d+)\]$/))) return { t: 'Y', y: +m[1], brack: true };
  if ((m = s.match(/^(-?\d+)([*†]?)$/))) return { t: 'Y', y: +m[1], oob: m[2] === '*', dag: m[2] === '†' };
  if ((m = s.match(/^(INT|F|PI|OFF|DEF)\s*([+-]?\d+)$/))) return { t: m[1], y: +m[2] };
  if (/^(INC|QT|B|TD|TB|OB|BLK)$/.test(s)) return { t: s };
  if (s === '(TD)' || s === '[TD]') return { t: 'TD' };
  return { t: 'blank', raw: s };
}

// ---------- game setup ----------
function newGame(opts) {
  const rng = opts.rng || Math.random;
  const qlen = opts.qlen || 900;
  const receiver = opts.receiver != null ? opts.receiver : (rng() < 0.5 ? 0 : 1);
  return {
    v: 1, teams: opts.teams.slice(), qlen, qtr: 1, clock: qlen, score: [0, 0], to: [3, 3],
    poss: 1 - receiver, phase: 'kickoff', from: 35, ball: 35, down: 1, togo: 10,
    openKicker: 1 - receiver, tmw: {}, untimed: false, lastTime: 0, lastRunning: false, over: false, plays: 0,
    stats: [blankStats(), blankStats()], log: [],
  };
}
function blankStats() { return { rushY: 0, rush: 0, passY: 0, att: 0, comp: 0, int: 0, fum: 0, sacks: 0, first: 0, pen: 0, penY: 0 }; }

let TEAMS = (typeof PD_TEAMS !== 'undefined') ? PD_TEAMS : null;
function setTeams(t) { TEAMS = t; }
const team = (g, side) => (g.charts && g.charts[side]) || TEAMS[g.teams[side]];
const abbr = (g, side) => team(g, side).id;

// ---------- helpers ----------
const late = g => (g.qtr === 2 && g.clock <= 120) || (g.qtr >= 4 && g.clock <= 300);
function spotText(g, side, ball) {
  if (ball === 50) return '50';
  return ball < 50 ? `${abbr(g, side)} ${ball}` : `${abbr(g, 1 - side)} ${100 - ball}`;
}
function downText(g) {
  const n = ['', '1st', '2nd', '3rd', '4th'][g.down];
  const togo = g.ball + g.togo >= 100 ? 'Goal' : g.togo;
  return `${n} & ${togo}`;
}
function clockText(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; }
function clone(g) { const c = JSON.parse(JSON.stringify(Object.assign({}, g, { log: [] }))); return c; }

function useTime(g, secs, running) {
  if (g.untimed) { g.untimed = false; g.lastTime = 0; g.lastRunning = false; return; }
  const before = g.clock; let after = Math.max(0, before - secs);
  if ((g.qtr === 2 || g.qtr === 4) && before > 120 && after < 120 && !g.tmw[g.qtr]) { after = 120; g.tmw[g.qtr] = true; g.notice = 'Two-minute warning'; }
  g.clock = after; g.lastTime = before - after; g.lastRunning = !!running;
}

function score(g, side, pts) { g.score[side] += pts; }

function changePoss(g, newBall) {
  g.poss = 1 - g.poss; g.ball = Math.max(1, Math.min(99, newBall)); g.down = 1; g.togo = Math.min(10, 100 - g.ball);
}
function firstDown(g) { g.down = 1; g.togo = Math.min(10, 100 - g.ball); }
function touchdown(g, side) {
  score(g, side, 6); g.poss = side; g.phase = 'pat'; g.ball = 98;
  if (g.qtr >= 5) { g.phase = 'over'; g.over = true; }
}
function safety(g, scoringSide) {
  score(g, scoringSide, 2); g.poss = 1 - scoringSide; g.phase = 'kickoff'; g.from = 20;
  if (g.qtr >= 5) { g.phase = 'over'; g.over = true; }
}
function kickoffNext(g, kicker) { g.poss = kicker; g.phase = 'kickoff'; g.from = 35; }

// Advance downs after a scrimmage gain of y (ball already moved). Returns text.
function downs(g, startBall) {
  const line = startBall + g.togo;
  if (g.ball >= line) { firstDown(g); return ' First down!'; }
  g.togo = line - g.ball; g.down++;
  if (g.down > 4) { changePoss(g, 100 - g.ball); return ' Turnover on downs.'; }
  return '';
}

// rough expected points for the team with the ball (used for penalty choices and bot decisions)
function ep(ball, down, togo) { return -1.3 + 0.072 * ball - 0.45 * (down - 1) - 0.05 * Math.max(0, togo - 2); }
function value(g, side) {
  let v = g.score[side] - g.score[1 - side];
  if (g.phase === 'pat') v += (g.poss === side ? 0.95 : -0.95) + (g.poss === side ? -0.6 : 0.6);
  else if (g.phase === 'kickoff') v += g.poss === side ? -0.6 : 0.6;
  else if (g.phase === 'scrimmage') v += (g.poss === side ? 1 : -1) * ep(g.ball, g.down, g.togo);
  return v;
}

// ---------- combining a scrimmage play ----------
// Returns a deterministic outcome; any extra dice (B, QT, fumble recovery, INT return) are rolled here.
function combine(g, call, ores, dres, rng, det) {
  const O = team(g, g.poss), D = team(g, 1 - g.poss);
  const isPass = +call >= 5;
  const reroll = (col) => { const r = rollOff(rng); const s = O.off[col][r.total - 10]; det.rerolls.push({ col, dice: r.dice, total: r.total, res: s }); return parse(s); };
  const fumble = (y) => { const r = rollOff(rng); const rec = O.fumRec.indexOf(r.total) >= 0; det.rerolls.push({ col: 'Fumble', dice: r.dice, total: r.total, res: rec ? 'Recovered' : 'Lost' }); return { kind: 'fum', y, rec }; };
  const qt = () => { const q = reroll('QT'); if (q.t === 'F') return Object.assign(fumble(q.y), { sack: true }); return { kind: 'gain', y: q.t === 'Y' ? q.y : 0, oob: !!q.oob, sack: q.y < 0, scramble: q.y >= 0 }; };
  if (ores.t === 'QT') return qt();
  if (ores.t === 'B') { const b = reroll('B'); return { kind: 'gain', y: b.y || 20, oob: !!b.oob, big: true }; }
  if (ores.t === 'TD') return { kind: 'td' };
  if (ores.t === 'F') return fumble(ores.y);
  if (ores.t === 'INT') {
    if (dres.t === 'INC') return { kind: 'inc' };
    const r = rollOff(rng); const s = D.off.IR[r.total - 10]; det.rerolls.push({ col: 'INT Return', dice: r.dice, total: r.total, res: s, def: true });
    const p = parse(s); return { kind: 'int', depth: ores.y, ret: p.t === 'Y' ? p.y : 0, retTD: p.t === 'TD' };
  }
  if (ores.t === 'INC') { if (isPass && dres.t === 'QT') return qt(); return { kind: 'inc' }; }
  if (ores.t === 'Y') {
    if (ores.paren) return { kind: 'gain', y: ores.y, oob: !!ores.oob };
    if (dres.t === 'QT' && isPass) return qt();
    if (dres.t === 'B' && !isPass) { const b = reroll('B'); return { kind: 'gain', y: b.y || 20, oob: !!b.oob, big: true }; }
    if (dres.t === 'Y' && (dres.brack || dres.paren)) return { kind: 'gain', y: dres.y, oob: false };
    if (dres.t === 'INC' && isPass) return { kind: 'inc' };
    if (dres.t === 'TD') return { kind: 'td' };
    const dy = dres.t === 'Y' ? dres.y : 0;
    return { kind: 'gain', y: ores.y + dy, oob: !!ores.oob };
  }
  return { kind: 'gain', y: 0 };
}

// Apply a deterministic outcome to g (mutates). Returns sentence describing it.
function apply(g, out, call) {
  const side = g.poss, start = g.ball, st = g.stats[side];
  const isPass = +call >= 5, run = !isPass;
  const name = abbr(g, side);
  let txt = '', time = 40, running = true;
  switch (out.kind) {
    case 'gain': {
      if (out.sack) { st.sacks++; } else if (run || out.scramble) { st.rush++; st.rushY += out.y; } else { st.att++; st.comp++; st.passY += out.y; }
      g.ball = start + out.y;
      const what = out.sack ? `Sacked for ${-out.y}` : out.scramble && isPass ? `QB scrambles for ${out.y}` : out.y > 0 ? `${isPass && !out.scramble ? 'Complete, ' : ''}gain of ${out.y}` : out.y < 0 ? `${isPass ? 'Complete, ' : ''}loss of ${-out.y}` : `${isPass ? 'Complete, ' : ''}no gain`;
      if (out.big && out.y > 0) txt = 'Breakaway! ';
      if (g.ball >= 100) { touchdown(g, side); txt += `${100 - start}-yard touchdown ${isPass && !out.scramble ? 'pass' : 'run'}! TOUCHDOWN ${name}!`; time = 10; running = false; break; }
      if (g.ball <= 0) { safety(g, 1 - side); txt += `${what}, tackled in the end zone. SAFETY!`; time = 10; running = false; break; }
      txt += what + (out.oob ? ', out of bounds.' : '.');
      txt += downs(g, start);
      if (g.poss !== side) running = false;
      if (out.oob && late(g)) { time = 10; running = false; }
      break;
    }
    case 'inc': st.att++; g.ball = start; txt = 'Incomplete.' + downs(g, start); time = 10; running = false; break;
    case 'td': if (isPass) { st.att++; st.comp++; st.passY += 100 - start; } else { st.rush++; st.rushY += 100 - start; } touchdown(g, side); txt = `TOUCHDOWN ${name}!`; time = 10; running = false; break;
    case 'int': {
      st.att++; st.int++; time = 10; running = false;
      const spot = start + out.depth;              // offense POV
      let db = 100 - Math.min(spot, 109);           // defense POV, may be negative (end zone)
      db += out.ret;
      const who = abbr(g, 1 - side);
      if (out.retTD || db >= 100) { g.poss = 1 - side; touchdown(g, 1 - side); txt = `INTERCEPTED! ${who} returns it all the way. TOUCHDOWN!`; break; }
      if (db <= 0) { changePoss(g, 20); txt = `INTERCEPTED in the end zone by ${who}. Touchback.`; break; }
      changePoss(g, db);
      txt = `INTERCEPTED by ${who}` + (out.ret ? `, returned ${out.ret} yards.` : '.');
      break;
    }
    case 'fum': {
      st.fum++; time = 10;
      const spot = start + out.y;
      if (out.rec) {
        if (out.sack) st.sacks++; else if (run) { st.rush++; st.rushY += out.y; } else { st.att++; st.comp++; st.passY += out.y; }
        g.ball = spot;
        if (spot >= 100) { touchdown(g, side); txt = `Fumble, recovered by ${name} in the end zone. TOUCHDOWN!`; running = false; break; }
        if (spot <= 0) { safety(g, 1 - side); txt = `Fumble, recovered by ${name} in the end zone. SAFETY!`; running = false; break; }
        txt = `Fumble! ${name} recovers.` + downs(g, start);
        if (g.poss !== side) running = false;
        break;
      }
      running = false;
      if (run) { st.rush++; st.rushY += out.y; } else if (!out.sack) { st.att++; st.comp++; st.passY += out.y; } else st.sacks++;
      const who = abbr(g, 1 - side);
      if (spot <= 0) { g.poss = 1 - side; touchdown(g, 1 - side); txt = `FUMBLE! ${who} recovers in the end zone. TOUCHDOWN!`; break; }
      if (spot >= 100) { changePoss(g, 20); txt = `FUMBLE! ${who} recovers in the end zone. Touchback.`; break; }
      changePoss(g, 100 - spot); txt = `FUMBLE! Recovered by ${who}.`;
      break;
    }
    case 'pi': {
      g.stats[1 - side].pen++; g.stats[1 - side].penY += out.y;
      let spot = start + out.y; if (spot >= 100) spot = 99;
      g.ball = spot; firstDown(g); txt = `Pass interference on ${abbr(g, 1 - side)}, ${spot - start} yards. First down.`; time = 10; running = false; break;
    }
    case 'pen': {
      time = 10; running = false;
      if (out.who === 'OFF') {
        const mv = Math.min(out.y, Math.floor(start / 2)); g.ball = start - mv; g.togo += mv; st.pen++; st.penY += mv;
        txt = `Penalty on ${name}, ${mv} yards${mv < out.y ? ' (half the distance)' : ''}. Replay ${downText(g).split(' &')[0]} down.`;
      } else {
        const mv = Math.min(out.y, Math.floor((100 - start) / 2)); g.ball = Math.min(99, start + mv); g.stats[1 - side].pen++; g.stats[1 - side].penY += mv;
        if (out.y >= 15 || g.ball >= start + g.togo) { firstDown(g); txt = `Penalty on ${abbr(g, 1 - side)}, ${mv} yards${mv < out.y ? ' (half the distance)' : ''}. First down.`; }
        else { g.togo = Math.max(1, g.togo - mv); txt = `Penalty on ${abbr(g, 1 - side)}, ${mv} yards.`; }
      }
      break;
    }
    case 'offset': txt = 'Offsetting penalties. Replay the down.'; time = 10; running = false; break;
  }
  if (g.phase === 'scrimmage' && g.poss === side && g.down === 1 && out.kind !== 'pen' && out.kind !== 'offset' && txt.indexOf('First down') >= 0) st.first++;
  return { txt, time, running };
}

// ---------- the play ----------
function play(g, offCall, defCall, rng) {
  rng = rng || Math.random;
  g.notice = null;
  const side = g.poss, pre = { qtr: g.qtr, clock: g.clock, spot: spotText(g, side, g.ball), down: g.phase === 'scrimmage' ? downText(g) : null, poss: side };
  let r;
  if (g.phase === 'kickoff') r = kickoff(g, offCall, rng);
  else if (g.phase === 'pat') r = pat(g, offCall, defCall, rng);
  else if (offCall === 'P') r = punt(g, rng);
  else if (offCall === 'FG') r = fieldGoal(g, rng);
  else if (offCall === 'K') { const s = g.ball; g.ball = Math.max(1, s - 2); const t = 'QB kneels.' + downs(g, s); useTime(g, 40, true); r = { txt: t }; }
  else if (offCall === 'S') {
    const refund = Math.max(0, g.lastTime - 17); if (g.lastRunning) g.clock = Math.min(g.qlen, g.clock + refund);
    const s = g.ball; const t = 'Spike to stop the clock.' + downs(g, s); g.stats[side].att++; useTime(g, 3, false); r = { txt: t };
  }
  else r = scrimmage(g, offCall, defCall, rng);
  g.plays++;
  const entry = Object.assign({ off: offCall, def: defCall, txt: r.txt, det: r.det || null, score: g.score.slice(), notice: g.notice }, pre);
  g.log.push(entry);
  if (g.log.length > 400) g.log.splice(0, g.log.length - 400);
  return entry;
}

function scrimmage(g, call, form, rng) {
  const O = team(g, g.poss), D = team(g, 1 - g.poss);
  const od = rollOff(rng), dd = rollDef(rng);
  const ostr = O.off[call][od.total - 10], dstr = D.def[form][call][dd.total - 1];
  const det = { call, form, off: { dice: od.dice, total: od.total, res: ostr }, def: { dice: dd.dice, total: dd.total, res: dstr }, rerolls: [] };
  let ores = parse(ostr); const dres = parse(dstr);
  let out, choice = null;
  if (ores.t === 'PI') out = { kind: 'pi', y: ores.y };
  else if (ores.t === 'OFF' || ores.t === 'DEF') {
    const pens = [ores];
    let n = 0;
    while (n++ < 12) {
      const r = rollOff(rng); const s = O.off[call][r.total - 10]; const p = parse(s);
      det.rerolls.push({ col: call, dice: r.dice, total: r.total, res: s });
      if (p.t === 'OFF' || p.t === 'DEF' || p.t === 'PI') { pens.push(p.t === 'PI' ? { t: 'DEF', y: p.y } : p); continue; }
      ores = p; break;
    }
    const kinds = new Set(pens.map(p => p.t));
    if (kinds.size > 1) out = { kind: 'offset' };
    else {
      const playOut = combine(g, call, ores, dres, rng, det);
      const penOut = { kind: 'pen', who: pens[0].t, y: Math.max(...pens.map(p => p.y)) };
      const fouled = penOut.who === 'OFF' ? 1 - g.poss : g.poss;
      const a = clone(g), b = clone(g);
      const ra = apply(a, playOut, call), rb = apply(b, penOut, call);
      useTime(a, ra.time, ra.running); useTime(b, rb.time, rb.running);
      const accept = value(b, fouled) > value(a, fouled);
      choice = { fouled, accept, playTxt: ra.txt };
      out = accept ? penOut : playOut;
      det.penalty = { who: penOut.who, y: penOut.y, accepted: accept, by: abbr(g, fouled) };
    }
  } else out = combine(g, call, ores, dres, rng, det);
  const res = apply(g, out, call);
  let txt = res.txt;
  if (choice) txt = choice.accept ? txt + ` (${abbr(g, choice.fouled)} accepts; play was: ${choice.playTxt})` : `${choice.playTxt} (Penalty declined by ${abbr(g, choice.fouled)}.)`;
  useTime(g, res.time, res.running);
  if (g.clock === 0 && (out.kind === 'pi' || (out.kind === 'pen' && out.who === 'DEF')) && g.phase === 'scrimmage') g.untimed = true;
  return { txt, det };
}

function punt(g, rng) {
  const K = team(g, g.poss), R = team(g, 1 - g.poss), side = g.poss, start = g.ball;
  const r = rollOff(rng); const s = K.off.P[r.total - 10]; const p = parse(s);
  const det = { call: 'P', off: { dice: r.dice, total: r.total, res: s }, rerolls: [] };
  const rk = abbr(g, 1 - side);
  let txt;
  if (p.t === 'BLK') {
    const spot = start - 7;
    if (spot <= 0) { safety(g, 1 - side); txt = 'Punt BLOCKED out of the end zone. SAFETY!'; }
    else { changePoss(g, 100 - spot); txt = `Punt BLOCKED! ${rk} takes over.`; }
    useTime(g, 10, false); return { txt, det };
  }
  if (p.t === 'TB') { changePoss(g, 20); useTime(g, 10, false); return { txt: 'Punt into the end zone. Touchback.', det }; }
  const dist = p.y || 40, land = start + dist;
  if (land >= 100) { changePoss(g, 20); useTime(g, 10, false); return { txt: `${dist}-yard punt into the end zone. Touchback.`, det }; }
  let rb = 100 - land;
  if (p.dag || p.oob) { changePoss(g, rb); useTime(g, 10, false); return { txt: `${dist}-yard punt, ${p.dag ? 'downed' : 'fair catch'} at the ${spotText(g, g.poss, g.ball)}.`, det }; }
  const rr = rollOff(rng); const rs = R.off.PR[rr.total - 10]; const rp = parse(rs);
  det.rerolls.push({ col: 'Punt Return', dice: rr.dice, total: rr.total, res: rs, def: true });
  if (rp.t === 'TD') { g.poss = 1 - side; touchdown(g, 1 - side); useTime(g, 15, false); return { txt: `${dist}-yard punt, returned for a TOUCHDOWN by ${rk}!`, det }; }
  if (rp.t === 'F') { const spot = rb + (rp.y || 0); changePoss(g, rb); changePoss(g, 100 - Math.max(1, spot)); useTime(g, 15, false); return { txt: `${dist}-yard punt. Muffed! ${abbr(g, side)} recovers.`, det }; }
  rb += rp.t === 'Y' ? rp.y : 0;
  if (rb >= 100) { g.poss = 1 - side; touchdown(g, 1 - side); useTime(g, 15, false); return { txt: `${dist}-yard punt, returned for a TOUCHDOWN by ${rk}!`, det }; }
  changePoss(g, rb); useTime(g, 15, false);
  return { txt: `${dist}-yard punt, returned ${rp.y || 0} yards to the ${spotText(g, g.poss, g.ball)}.`, det };
}

function fgNeed(g) { return 100 - g.ball; }
function fgChance(g, side, ball) { const col = team(g, side).off.FG; const need = 100 - ball; let p = 0; col.forEach((v, i) => { const n = parseInt(v, 10); if (!isNaN(n) && n >= need) p += OPROB[10 + i]; }); return p; }
function fieldGoal(g, rng) {
  const K = team(g, g.poss), side = g.poss, start = g.ball;
  const r = rollOff(rng); const s = K.off.FG[r.total - 10]; const p = parse(s);
  const det = { call: 'FG', off: { dice: r.dice, total: r.total, res: s }, rerolls: [] };
  const len = 100 - start + 17;
  let txt;
  if (p.t === 'BLK') { changePoss(g, Math.max(1, 100 - (start - 7))); txt = `${len}-yard field goal BLOCKED!`; }
  else if (p.t === 'Y' && p.y >= 100 - start) { score(g, side, 3); txt = `${len}-yard field goal is GOOD!`; if (g.qtr >= 5) { g.phase = 'over'; g.over = true; } else kickoffNext(g, side); }
  else { changePoss(g, Math.max(20, 100 - (start - 7))); txt = `${len}-yard field goal is no good.`; }
  useTime(g, 5, false);
  return { txt, det };
}

function kickoff(g, call, rng) {
  const K = team(g, g.poss), R = team(g, 1 - g.poss), side = g.poss, from = g.from || 35;
  const r = rollOff(rng);
  const rk = abbr(g, 1 - side);
  g.phase = 'scrimmage';
  if (call === 'ONS') {
    const det = { call, off: { dice: r.dice, total: r.total, res: r.total >= 13 && r.total <= 20 ? 'Recovered' : 'Lost' }, rerolls: [] };
    g.ball = from + 12;
    if (r.total >= 13 && r.total <= 20) { g.down = 1; g.togo = 10; useTime(g, 5, false); return { txt: `Onside kick... RECOVERED by ${abbr(g, side)}!`, det }; }
    changePoss(g, 100 - (from + 12)); useTime(g, 5, false); return { txt: `Onside kick recovered by ${rk}.`, det };
  }
  const s = K.off.KO[r.total - 10]; const p = parse(s);
  const det = { call: 'KO', off: { dice: r.dice, total: r.total, res: s }, rerolls: [] };
  if (p.t === 'TB') { changePoss(g, 35); useTime(g, 0, false); return { txt: 'Kickoff, touchback.', det }; }
  if (p.t === 'OB') { changePoss(g, 40); useTime(g, 0, false); return { txt: 'Kickoff out of bounds. Ball at the 40.', det }; }
  const land = 100 - from - (p.y || 60);
  if (land <= 0) { changePoss(g, 35); useTime(g, 0, false); return { txt: `${p.y}-yard kickoff into the end zone. Touchback.`, det }; }
  const rr = rollOff(rng); const rs = R.off.KR[rr.total - 10]; const rp = parse(rs);
  det.rerolls.push({ col: 'Kick Return', dice: rr.dice, total: rr.total, res: rs, def: true });
  if (rp.t === 'TD') { g.poss = 1 - side; touchdown(g, 1 - side); useTime(g, 10, false); return { txt: `Kickoff returned for a TOUCHDOWN by ${rk}!`, det }; }
  if (rp.t === 'F') { const spot = land + (rp.y || 0); g.poss = side; g.ball = Math.min(99, Math.max(1, 100 - spot)); firstDown(g); useTime(g, 10, false); return { txt: `Kickoff return FUMBLED! ${abbr(g, side)} recovers.`, det }; }
  const ret = rp.t === 'Y' ? rp.y : 0, rb = land + ret;
  if (rb >= 100) { g.poss = 1 - side; touchdown(g, 1 - side); useTime(g, 10, false); return { txt: `Kickoff returned for a TOUCHDOWN by ${rk}!`, det }; }
  changePoss(g, rb); useTime(g, 10, false);
  return { txt: `Kickoff fielded at the ${land}, returned ${ret} yards to the ${spotText(g, g.poss, g.ball)}.`, det };
}

function pat(g, call, form, rng) {
  const O = team(g, g.poss), side = g.poss;
  if (call === 'XP') {
    const r = rollOff(rng); const miss = O.patMiss.indexOf(r.total) >= 0;
    const det = { call, off: { dice: r.dice, total: r.total, res: miss ? 'No good' : 'Good' }, rerolls: [] };
    if (!miss) score(g, side, 1);
    kickoffNext(g, side);
    return { txt: miss ? 'Extra point is NO GOOD.' : 'Extra point is good.', det };
  }
  // two-point try: one scrimmage play from the 2, penalties ignored
  const D = team(g, 1 - side); let od, ostr, ores, n = 0;
  do { od = rollOff(rng); ostr = O.off[call][od.total - 10]; ores = parse(ostr); } while (['OFF', 'DEF', 'PI'].indexOf(ores.t) >= 0 && n++ < 12);
  const dd = rollDef(rng); const dstr = D.def[form][call][dd.total - 1];
  const det = { call, form, off: { dice: od.dice, total: od.total, res: ostr }, def: { dice: dd.dice, total: dd.total, res: dstr }, rerolls: [] };
  const out = combine(g, call, ores, parse(dstr), rng, det);
  const good = out.kind === 'td' || ((out.kind === 'gain' || (out.kind === 'fum' && out.rec)) && out.y >= 2);
  if (good) score(g, side, 2);
  kickoffNext(g, side);
  return { txt: `Two-point try (${PLAYS[call]}) ${good ? 'is GOOD!' : 'fails.'}`, det };
}

// ---------- between plays ----------
// Handles quarter / half / game end. Returns list of notices.
function prepare(g, rng) {
  rng = rng || Math.random;
  const out = [];
  if (g.over) return out;
  if (g.phase === 'pat') return out;
  if (g.clock > 0 || g.untimed) return out;
  if (g.qtr === 1 || g.qtr === 3) { g.qtr++; g.clock = g.qlen; out.push(`End of quarter ${g.qtr - 1}`); }
  else if (g.qtr === 2) {
    g.qtr = 3; g.clock = g.qlen; g.to = [3, 3]; out.push('Halftime');
    g.phase = 'kickoff'; g.poss = 1 - g.openKicker; g.from = 35;
  } else if (g.qtr === 4 && g.score[0] === g.score[1]) {
    g.qtr = 5; g.clock = Math.round(g.qlen * 2 / 3); g.to = [2, 2]; const rec = rng() < 0.5 ? 0 : 1;
    g.phase = 'kickoff'; g.poss = 1 - rec; g.from = 35; out.push(`Overtime! ${abbr(g, rec)} wins the toss and will receive. Next score wins.`);
  } else { g.over = true; g.phase = 'over'; out.push('Final'); }
  g.lastRunning = false; g.lastTime = 0;
  return out;
}

function canTimeout(g, side) { return !g.over && g.to[side] > 0 && g.lastRunning && g.lastTime > 10 && g.phase !== 'pat'; }
function timeout(g, side) {
  if (!canTimeout(g, side)) return false;
  g.to[side]--; const back = g.lastTime - 10; g.clock += back; g.lastTime = 10; g.lastRunning = false;
  g.log.push({ qtr: g.qtr, clock: g.clock, txt: `Timeout ${abbr(g, side)} (${g.to[side]} left).`, timeout: side, score: g.score.slice() });
  return true;
}

function legalOff(g) {
  if (g.phase === 'kickoff') return ['KO', 'ONS'];
  if (g.phase === 'pat') return ['XP'].concat(SCRIM);  // a play number = two-point try with that play
  const c = SCRIM.slice(); c.push('P');
  if (100 - g.ball + 17 <= 68) c.push('FG');
  c.push('K');
  if (g.lastRunning && g.clock > 0) c.push('S');
  return c;
}
function needsDefense(g, offCall) { return g.phase === 'scrimmage' ? SCRIM.indexOf(offCall) >= 0 : g.phase === 'pat' ? offCall !== 'XP' : false; }

// ---------- bot ----------
const OPROB = {};
for (const b of BLACK) for (const w1 of WHITE) for (const w2 of WHITE2) { const t = 10 * b + w1 + w2; OPROB[t] = (OPROB[t] || 0) + 1 / 216; }
function colEV(T, c) {
  let e = 0; T.off[c].forEach((v, i) => { const p = parse(v), pr = OPROB[10 + i]; if (p.t === 'Y') e += p.y * pr; else if (p.t === 'B') e += 22 * pr; else if (p.t === 'INT') e -= 25 * pr; else if (p.t === 'F') e -= 12 * pr; else if (p.t === 'QT') e -= 5 * pr; });
  return e;
}
function wpick(w, rng) { let tot = 0; for (const k in w) tot += Math.max(0, w[k]); let x = rng() * tot; for (const k in w) { x -= Math.max(0, w[k]); if (x <= 0) return k; } return Object.keys(w)[0]; }

function botOffense(g, rng) {
  rng = rng || Math.random;
  const side = g.poss, T = team(g, side), diff = g.score[side] - g.score[1 - side];
  const q4 = g.qtr >= 4, q2 = g.qtr === 2;
  if (g.phase === 'kickoff') return (q4 && diff < 0 && diff >= -16 && g.clock < 150 && g.qtr === 4) ? 'ONS' : 'KO';
  if (g.phase === 'pat') {
    const d = diff; // already includes the 6
    if (g.qtr === 4 && g.clock < 600 && [-2, -5, -10, 1, 5, -9, -12].indexOf(d) >= 0) return pickPlay(Object.assign({}, g, { togo: 2, down: 3 }), T, 2, false, rng);
    return 'XP';
  }
  const oppTO = g.to[1 - side];
  // run out the clock
  if (q4 && diff > 0 && g.clock <= (5 - g.down) * 40 - oppTO * 40 + 1 && g.clock > 0) return 'K';
  if (q2 && g.clock <= 30 && g.ball < 40 && diff >= 0) return 'K';
  const togo = g.togo, ball = g.ball, fgP = fgChance(g, side, ball);
  const hurry = (g.qtr === 4 && diff < 0 && g.clock <= 240) || (q2 && g.clock <= 120) || (g.qtr === 5);
  // end of half / game: kick if it wins or ties, or before time is gone
  const lastChance = (g.qtr === 2 || g.qtr === 4) && (g.clock <= 20 || (g.clock <= 45 && g.to[side] === 0));
  if (lastChance && fgP > 0.25 && (g.qtr === 2 || (diff >= -3 && diff <= 0))) return 'FG';
  if (g.qtr === 5 && fgP > 0.6 && g.down >= 3) return 'FG';
  if (g.down === 4) {
    const desperate = g.qtr === 4 && diff < 0 && g.clock <= 300 && !(diff >= -3 && fgP > 0.5);
    if (desperate) return pickPlay(g, T, togo, true, rng);
    if (g.qtr === 4 && g.clock <= 120 && diff < 0 && diff >= -3 && fgP > 0.3) return 'FG';
    if (togo <= 1 && ball >= 45 && ball < 97) return pickPlay(g, T, togo, hurry, rng);
    if (fgP >= 0.55) return 'FG';
    if (togo <= 2 && ball >= 55) return pickPlay(g, T, togo, hurry, rng);
    if (fgP >= 0.35 && ball >= 62) return 'FG';
    if (togo <= 4 && ball >= 62) return pickPlay(g, T, togo, hurry, rng);
    return 'P';
  }
  return pickPlay(g, T, togo, hurry, rng);
}
// base play mix is roughly the NFL's; a team leans toward the columns its chart is best at
const MIX = { 1: 0.15, 2: 0.11, 3: 0.11, 4: 0.06, 5: 0.11, 6: 0.24, 7: 0.10, 8: 0.06, 9: 0.06 };
function pickPlay(g, T, togo, hurry, rng) {
  if (g.botLevel === 'easy') return SCRIM[Math.floor(rng() * SCRIM.length)];   // easy: no game plan
  const ev = {}; let run = 0, pas = 0;
  for (const c of SCRIM) { ev[c] = Math.max(0.5, colEV(T, c)); if (+c >= 5) pas += ev[c] * MIX[c]; else run += ev[c] * MIX[c]; }
  const runAvg = run / 0.43, passAvg = pas / 0.57;
  const w = {};
  const diff = g.score[g.poss] - g.score[1 - g.poss];
  const killClock = g.qtr >= 4 && diff > 0 && g.clock <= 360;
  for (const c of SCRIM) {
    const pass = +c >= 5;
    let x = MIX[c] * Math.pow(ev[c] / (pass ? passAvg : runAvg), 1.5);
    if (togo <= 2) x *= pass ? (c === '6' ? 0.7 : 0.3) : (c === '1' || c === '2' ? 2.2 : 1.2);
    else if (togo >= 8 && g.down >= 2) x *= pass ? (c === '7' || c === '8' ? 2.6 : 1.6) : (c === '4' ? 0.8 : 0.3);
    if (g.ball >= 92) x *= pass ? (c === '8' || c === '7' ? 0.1 : 0.8) : 1.5;
    if (hurry) x *= pass ? (c === '9' ? 3 : c === '5' ? 0.6 : 1.5) : 0.25;
    if (killClock) x *= pass ? 0.35 : 2;
    w[c] = x;
  }
  return wpick(w, rng);
}

function botDefense(g, rng) {
  rng = rng || Math.random;
  if (g.botLevel === 'easy') return 'ABCDEF'[Math.floor(rng() * 6)];
  const oppDiff = g.score[g.poss] - g.score[1 - g.poss];
  let w;
  if (g.phase === 'pat' || g.ball >= 95) w = { A: 3, B: 5, F: 2, D: 1 };
  else if (g.togo <= 2) w = { A: 2, B: 5, F: 1.5, C: 1, D: 0.5 };
  else if ((g.qtr === 4 && oppDiff < 0 && g.clock <= 240) || (g.qtr === 2 && g.clock <= 120)) w = { A: 1, C: 2, D: 3.5, E: 3.5 };
  else if (g.togo >= 8 && g.down >= 2) w = { A: 1, C: 1.5, D: 3, E: 3, F: 1.5 };
  else w = { A: 3, B: 1, C: 1.5, D: 2, E: 1, F: 1.5 };
  return wpick(w, rng);
}

function botTimeout(g, side) {
  if (!canTimeout(g, side)) return false;
  const diff = g.score[side] - g.score[1 - side];
  if (g.poss === side && g.phase === 'scrimmage') {
    if (g.qtr === 2 && g.clock <= 110 && g.ball >= 30) return true;
    if (g.qtr >= 4 && diff <= 0 && g.clock <= 150) return true;
  } else if (g.poss !== side && g.phase === 'scrimmage') {
    if (g.qtr >= 4 && diff < 0 && diff >= -16 && g.clock <= 180) return true;
    if (g.qtr === 2 && g.clock <= 60 && g.ball <= 40 && g.down >= 3) return true;
  }
  return false;
}

// Screen spot measured from the LEFT goal line. The field is drawn fixed, matching the scoreboard:
// side 0 (visitors, left) defends the left end zone and drives right; side 1 (home) drives left.
// `yard` is counted from that side's own goal line, like g.ball.
function fieldX(side, yard) { return side === 0 ? yard : 100 - yard; }

// Is this play a big moment worth a banner? before = { poss, score, ball, phase } snapshot taken
// just before PD.play(); g is the game after it; e is the log entry it returned.
// Returns { kind: 'td' | 'turnover' | 'safety' | 'big', label, side } or null for ordinary plays.
function highlight(before, g, e) {
  if (!before || !e) return null;
  const txt = e.txt || '', call = e.det && e.det.call;
  const gain = [0, 1].map(s => g.score[s] - before.score[s]);
  const scrim = before.phase === 'scrimmage' && SCRIM.indexOf(call) >= 0;
  const lostBall = scrim && g.poss !== before.poss;
  for (const s of [0, 1]) {
    if (gain[s] >= 6) {
      const lab = /INTERCEPTED/.test(txt) ? 'PICK SIX!' : s !== before.poss && /FUMBLE/i.test(txt) ? 'FUMBLE RETURN TD!' : 'TOUCHDOWN!';
      return { kind: 'td', label: lab, side: s };
    }
    if (gain[s] === 2 && /SAFETY/.test(txt)) return { kind: 'safety', label: 'SAFETY!', side: s };
  }
  if (lostBall) {
    const label = /INTERCEPTED/.test(txt) ? 'INTERCEPTED!' : /FUMBLE/i.test(txt) ? 'FUMBLE!' : /on downs/i.test(txt) ? 'TURNOVER ON DOWNS' : 'TURNOVER!';
    return { kind: 'turnover', label, side: g.poss };
  }
  if (/BLOCKED/.test(txt)) return { kind: 'turnover', label: 'BLOCKED!', side: 1 - before.poss };
  if (/FUMBLED!/.test(txt) && before.phase === 'kickoff') return { kind: 'turnover', label: 'FUMBLE!', side: before.poss };
  if (scrim && g.poss === before.poss && (g.phase === 'scrimmage' || g.phase === before.phase)) {
    const y = g.ball - before.ball;
    if (y >= 20 || (/^Breakaway!/.test(txt) && y > 0)) return { kind: 'big', label: `BIG PLAY! +${y}`, side: g.poss };
  }
  const ret = /returned (\d+) yards/.exec(txt);
  if (ret && +ret[1] >= 40 && (before.phase === 'kickoff' || call === 'P')) return { kind: 'big', label: `BIG RETURN! ${ret[1]} yds`, side: g.poss };
  return null;
}

const api = { PLAYS, fieldX, highlight, FORMS, SCRIM, OPROB, parse, newGame, setTeams, team, abbr, play, prepare, legalOff, needsDefense, canTimeout, timeout,
  botOffense, botDefense, botTimeout, spotText, downText, clockText, fgChance, rollOff, rollDef, value, colEV };
if (typeof module !== 'undefined') module.exports = api; else root.PD = api;
})(this);
