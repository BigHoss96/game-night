(() => {
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const PREFS_KEY = 'tap4.prefs.v1', SAVE_KEY = 'tap4.save.v1';
const BOT_NAMES = ['Rosie', 'Gus', 'Mabel', 'Otto', 'Juno', 'Pip'];
const defaults = {
  seats: [{ name: 'You', kind: 'human' }, { name: 'Rosie', kind: 'bot', level: 'normal' }, { name: 'Gus', kind: 'bot', level: 'normal' }, { name: 'Mabel', kind: 'bot', level: 'hard' }],
  target: 150, speed: 'normal',
};
let prefs = Object.assign({}, defaults, store.get(PREFS_KEY, {}));
const savePrefs = () => store.set(PREFS_KEY, prefs);
const SPEED = { slow: 1.6, normal: 1, fast: 0.45 };
const T = ms => ms * SPEED[prefs.speed];
const sleep = ms => new Promise(r => setTimeout(r, T(ms)));
const ABORT = { abort: true };
const WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
let G = null, cur = null, runId = 0, pending = null, between = false;
let viewerId = 0, handHidden = false, uiTurn = null; // uiTurn: active human selection state
const humans = () => G ? G.players.filter(p => p.kind === 'human') : [];
const multiHuman = () => humans().length > 1;
const cardsLeft = p => Tap4.cardsLeft(p);
const Say = Tap4.Say;

const ICON = {
  in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10"/><path d="M12 10V4.5a1.5 1.5 0 0 1 3 0V10"/><path d="M15 10V6.5a1.5 1.5 0 0 1 3 0v6.5c0 4-2.5 7-6.5 7-3 0-4.6-1.6-6-4l-2.2-3.9a1.5 1.5 0 0 1 2.6-1.5L9 13"/><path d="M3 4l2 1.5M2.5 8.5H5"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l9 7-9 7z"/><path d="M18 5v14"/></svg>',
};
const HUES = [250, 200, 222, 262, 290, 322, 350, 12, 30, 44, 140, 168, 186];
function cardHTML(c, size = 'sm', extra = '') {
  if (!c) return `<div class="card back ${size} ${extra}"></div>`;
  if (c.t === 'num') {
    const ix = `<span class="ix tl">${c.v}</span><span class="ix br">${c.v}</span>`;
    return `<div class="card num ${size} ${extra}" style="--h:${HUES[c.v]}">${ix}<b>${c.v}</b></div>`;
  }
  const k = c.t === 'in' ? 'tin' : 'tout';
  return `<div class="card ${k} ${size} ${extra}">${ICON[c.t]}<i>${c.t === 'in' ? 'Tap In' : 'Tap Out'}</i><span class="pts">${c.t === 'in' ? 20 : 30} pts</span></div>`;
}
const cardWord = (v, n) => `${n === 1 ? 'a' : WORDS[n] ? WORDS[n].toLowerCase() : n} ${v}${n > 1 ? 's' : ''}`;
const tmpl = document.createElement('template');
function el(html) { tmpl.innerHTML = html.trim(); return tmpl.content.firstElementChild; }

/* ================= SETUP ================= */
function renderSetup() {
  const save = store.get(SAVE_KEY, null);
  const seg = (key, opts, val, idx) => `<div class="seg" data-seg="${key}" ${idx != null ? `data-i="${idx}"` : ''}>${opts.map(([v, l]) => `<button data-v="${v}" class="${v == val ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  $('#setup').innerHTML = `
    <div class="logo">Tap <span class="seven">4</span></div>
    <p class="sub">Play equal or lower. Make four of a kind to tap the stack. First to empty their hand and piles wins the round — lowest score wins the game.</p>
    ${save && !save.over ? `<button class="big resume" id="resumeBtn">Resume game · Round ${save.phase === 'between' ? save.round + 1 : save.round}</button>` : ''}
    <div>
      <div class="h">Players</div>
      <div class="seats">
        ${prefs.seats.map((s, i) => `
          <div class="seat">
            <input value="${esc(s.name)}" maxlength="12" data-name="${i}" aria-label="Player name">
            ${seg('kind', [['human', 'Human'], ['bot', 'Bot']], s.kind, i)}
            <button class="x" data-del="${i}" ${prefs.seats.length <= 2 ? 'disabled style="opacity:.25"' : ''} aria-label="Remove">✕</button>
            ${s.kind === 'bot' ? `<div class="lvl">${seg('level', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], s.level || 'normal', i)}</div>` : ''}
          </div>`).join('')}
        ${prefs.seats.length < 6 ? `<button class="addseat" id="addSeat">+ Add player</button>` : ''}
      </div>
      ${prefs.seats.length === 2 ? `<p class="note" style="margin-top:8px">Two players: 27 cards each, piles two deep, and Tap Out can only skip your own turn.</p>` : ''}
      ${prefs.seats.filter(s => s.kind === 'human').length > 1 ? `<p class="note" style="margin-top:8px">Pass-and-play: hands stay hidden and you'll pass the phone between human turns.</p>` : ''}
    </div>
    <div>
      <div class="h">Options</div>
      <div class="panel">
        <div class="opt"><label>Game ends at<small>Lowest total wins</small></label>${seg('target', [[100, '100'], [150, '150'], [200, '200']], prefs.target)}</div>
        <div class="opt"><label>Speed</label>${seg('speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], prefs.speed)}</div>
      </div>
    </div>
    <button class="big" id="startBtn" style="background:linear-gradient(180deg,#5aa0ff,#2f6cf0);box-shadow:0 10px 30px rgba(47,108,240,.35)">${save && !save.over ? 'New game' : 'Deal me in'}</button>
    <button class="ghost" id="rulesBtn">How to play</button>
    ${(location.protocol.startsWith('http') && !window.Capacitor) ? '<a class="ghost" href="../index.html" style="display:block;text-align:center;text-decoration:none">← All games</a>' : ''}
    ${window.GNReport ? '<button class="ghost" onclick="GNReport.open()">⚑ Report a bug</button>' : ''}`;
  const root = $('#setup');
  root.querySelectorAll('[data-name]').forEach(inp => inp.oninput = () => { prefs.seats[+inp.dataset.name].name = inp.value; savePrefs(); });
  root.querySelectorAll('[data-seg]').forEach(sg => sg.querySelectorAll('button').forEach(b => b.onclick = () => {
    const key = sg.dataset.seg, i = sg.dataset.i, v = b.dataset.v;
    if (i != null) {
      const s = prefs.seats[+i]; s[key] = v;
      if (key === 'kind' && v === 'bot') { s.level = s.level || 'normal'; if (s.name === 'You' || !s.name) s.name = pickBotName(); }
      if (key === 'kind' && v === 'human' && BOT_NAMES.includes(s.name)) s.name = 'Player ' + (+i + 1);
    } else prefs[key] = key === 'target' ? +v : v;
    savePrefs(); renderSetup();
  }));
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (prefs.seats.length > 2) { prefs.seats.splice(+b.dataset.del, 1); savePrefs(); renderSetup(); } });
  const add = $('#addSeat'); if (add) add.onclick = () => { prefs.seats.push({ name: pickBotName(), kind: 'bot', level: 'normal' }); savePrefs(); renderSetup(); };
  $('#startBtn').onclick = () => startGame();
  $('#rulesBtn').onclick = () => showRules();
  const rb = $('#resumeBtn'); if (rb) rb.onclick = () => resumeGame(save);
}
function pickBotName() { const used = new Set(prefs.seats.map(s => s.name)); return BOT_NAMES.find(n => !used.has(n)) || 'Bot ' + (prefs.seats.length + 1); }

/* ================= GAME FLOW ================= */
function seatsForGame() {
  return prefs.seats.map((s, i) => ({ name: (s.name || '').trim() || (s.kind === 'bot' ? 'Bot ' + (i + 1) : 'Player ' + (i + 1)), kind: s.kind, level: s.level || 'normal' }));
}
function makeEmit(myRun) {
  return async (type, e) => {
    if (myRun !== runId) throw ABORT;
    await onEvent(type, e);
    if (myRun !== runId) throw ABORT;
  };
}
function launch(g, resume) {
  const myRun = ++runId;
  G = g; G.emit = makeEmit(myRun); G.agents = agents;
  cur = null; uiTurn = null; between = !!(resume && resume.between);
  const hs = humans();
  viewerId = hs.length ? hs[0].id : 0;
  handHidden = hs.length > 1;
  $('#setup').classList.add('hidden'); $('#table').classList.remove('hidden');
  buildTable(); update(); caption(''); controlsWait('');
  G.run(resume && resume.phase === 'turn' ? resume : null).catch(err => { if (err !== ABORT) { console.error(err); toast('Something went wrong — game saved', 'bad'); } });
}
function startGame(seats) { store.del(SAVE_KEY); launch(new Tap4.Game(seats || seatsForGame(), { target: prefs.target })); }
function resumeGame(snap) { launch(Tap4.Game.restore(snap, {}), snap.phase === 'turn' ? { phase: 'turn', turnIdx: snap.turnIdx } : { between: true }); }
function quitToSetup() {
  runId++;
  if (pending) { const p = pending; pending = null; p.rej(ABORT); }
  closeSheet(); $('#handoff').classList.add('hidden'); G = null; uiTurn = null;
  $('#table').classList.add('hidden'); $('#setup').classList.remove('hidden');
  renderSetup();
}
function save(phase) { if (G) store.set(SAVE_KEY, G.snapshot(phase)); }
function waitUI(setup) {
  return new Promise((res, rej) => { pending = { rej }; setup(v => { pending = null; res(v); }); });
}

// Before a human acts in pass-and-play, hide the table until the right person has the phone.
async function ensureViewer(p) {
  if (p.kind !== 'human') return;
  if (!multiHuman()) { if (viewerId !== p.id) { viewerId = p.id; buildTable(); update(); } return; }
  if (viewerId === p.id && !handHidden) return;
  await waitUI(done => {
    const h = $('#handoff');
    h.innerHTML = `<div><div style="font-size:52px">📱</div><h2>Pass to ${esc(p.name)}</h2><p>Everyone else, look away — ${esc(p.name)}'s hand is about to show.</p>
      <button class="big" id="showB" style="background:linear-gradient(180deg,#5aa0ff,#2f6cf0)">I'm ${esc(p.name)} — show my cards</button></div>`;
    h.classList.remove('hidden');
    $('#showB').onclick = () => { h.classList.add('hidden'); done(); };
  });
  viewerId = p.id; handHidden = false; buildTable(); update();
}
function endHumanTurn(p) {
  uiTurn = null;
  if (p.kind === 'human' && multiHuman()) { handHidden = true; update(); }
}

const agents = {
  async action(g, p, L) {
    if (p.kind !== 'human') {
      controlsWait(`${esc(p.name)} is thinking…`);
      await sleep(L.ctx.fresh || L.ctx.afterOut ? 500 : 700);
      return Tap4.Bot.action(g, p, L);
    }
    await ensureViewer(p);
    return humanAction(p, L);
  },
  async cancelSkip(g, p, tapIns) {
    if (p.kind !== 'human') { await sleep(500); return Tap4.Bot.cancelSkip(g, p, tapIns); }
    await ensureViewer(p);
    return waitUI(done => {
      openSheet(`<div style="display:flex;gap:14px;align-items:center">${cardHTML({ t: 'out' }, 'md')}<div><h2>You're Tapped Out</h2>
        <p class="lead" style="margin:4px 0 0">You lose this turn — unless you cancel it with a Tap In.</p></div></div>
        <div class="btnrow" style="margin-top:16px"><button class="ghost" id="loseB">Lose my turn</button>
        <button class="big" id="useB" style="background:linear-gradient(180deg,#3ddc97,#1ea770);color:#062b1b">Use Tap In</button></div>`, false);
      $('#loseB').onclick = () => { closeSheet(); done(null); };
      $('#useB').onclick = () => { closeSheet(); done(tapIns[0]); };
    });
  },
  async addMatching(g, p, v, ids) {
    if (p.kind !== 'human') { await sleep(300); return Tap4.Bot.addMatching(g, p, v, ids); }
    return waitUI(done => {
      openSheet(`<h2>You flipped a ${v}!</h2><p class="lead">It goes on the stack. Play your other ${v}s with it?</p>
        <div style="display:flex;gap:6px;margin-bottom:16px">${ids.map(() => cardHTML({ t: 'num', v }, 'tr')).join('')}</div>
        <div class="btnrow"><button class="ghost" id="noB">Just the flipped card</button>
        <button class="big" id="allB" style="background:linear-gradient(180deg,#5aa0ff,#2f6cf0)">Play ${ids.length} more</button></div>`, false);
      $('#noB').onclick = () => { closeSheet(); done([]); };
      $('#allB').onclick = () => { closeSheet(); done(ids); };
    });
  },
  async chooseOut(g, p, targets, flipped) {
    if (p.kind !== 'human') { await sleep(500); return Tap4.Bot.chooseOut(g, p, targets, flipped); }
    return pickOutTarget(p, targets, true, flipped);
  },
};

function pickOutTarget(p, targets, allowSelf, flipped) {
  return waitUI(done => {
    openSheet(`<div style="display:flex;gap:14px;align-items:center">${cardHTML({ t: 'out' }, 'md')}<div><h2>${flipped ? 'You flipped a Tap Out' : 'Tap Out'}</h2>
      <p class="lead" style="margin:4px 0 0">Skip your own turn, or make another player lose their next turn (then you still play to the stack).</p></div></div>
      <div style="margin-top:14px">
      ${allowSelf ? `<button class="pick self" data-t="self"><div><div class="pn">Skip my turn</div><div class="meta">Discard it and pass — no pickup</div></div></button>` : ''}
      ${targets.map(id => { const q = G.players[id]; return `<button class="pick" data-t="${id}"><div><div class="pn">${esc(q.name)}</div>
        <div class="meta">${cardsLeft(q)} cards left${q.outs.length ? ' · already tapped out' : ''} · score ${q.total}</div></div></button>`; }).join('')}
      </div>${!flipped ? '<button class="ghost" id="cancelO" style="margin-top:4px">Cancel</button>' : ''}`, false);
    $('#sheetCard').querySelectorAll('[data-t]').forEach(b => b.onclick = () => { closeSheet(); done(b.dataset.t === 'self' ? null : +b.dataset.t); });
    const c = $('#cancelO'); if (c) c.onclick = () => { closeSheet(); done('cancel'); };
  });
}

/* ---------- human turn: selection on the tray ---------- */
function humanAction(p, L) {
  return waitUI(done => {
    uiTurn = { p, L, sel: null, done };
    const top = G.top();
    caption(`${multiHuman() ? esc(p.name) + ', your' : 'Your'} turn<small>${L.ctx.afterOut ? 'Now play to the stack' : L.ctx.fresh || !top ? 'Start a new stack with anything' : `Play ${top.v} or lower`}</small>`);
    update(); renderControls();
  });
}
function selectNum(v, pileIdx) {
  const t = uiTurn; if (!t) return;
  if (!t.L.values.includes(v)) { toast(G.top() ? `Too high — play ${G.top().v} or lower` : 'Not playable'); return; }
  const p = t.p;
  const handCt = p.hand.filter(c => c.t === 'num' && c.v === v).length;
  const pileIdxs = p.piles.map((pl, i) => { const s = Tap4.pileTop(pl); return s && s.up && s.c.t === 'num' && s.c.v === v ? i : -1; }).filter(i => i >= 0);
  const s = t.sel;
  if (s && s.kind === 'num' && s.v === v) {
    if (pileIdx != null) { // toggle a single pile card
      const set = new Set(s.piles); set.has(pileIdx) ? set.delete(pileIdx) : set.add(pileIdx);
      s.piles = [...set];
    } else { // cycle hand count down, then deselect
      s.hand = s.hand > 0 ? s.hand - 1 : handCt;
    }
    if (!s.piles.length && !s.hand) t.sel = null;
  } else {
    t.sel = { kind: 'num', v, hand: handCt, piles: pileIdxs };
  }
  update(); renderControls();
}
function selectOther(kind, payload) {
  const t = uiTurn; if (!t) return;
  if (t.sel && t.sel.kind === kind && JSON.stringify(t.sel.x) === JSON.stringify(payload)) t.sel = null;
  else t.sel = { kind, x: payload };
  update(); renderControls();
}
function finishHuman(act) {
  const t = uiTurn; if (!t) return;
  const p = t.p, done = t.done;
  uiTurn = null; controlsWait('');
  done(act);
}
function selIds(t) {
  const s = t.sel, p = t.p;
  const ids = s.piles.map(i => Tap4.pileTop(p.piles[i]).c.id);
  const hand = p.hand.filter(c => c.t === 'num' && c.v === s.v).slice(0, s.hand).map(c => c.id);
  return [...ids, ...hand];
}
function renderControls() {
  const t = uiTurn; const box = $('#controls'); box.className = '';
  if (!t) return;
  const L = t.L, s = t.sel;
  const pick = L.canPickup ? `<button class="cbtn pku" id="pickB">Pick up<small>${G.stack.length} card${G.stack.length === 1 ? '' : 's'}</small></button>` : '';
  let main = '', hint = '';
  if (!s) {
    main = `<button class="cbtn go" disabled>Tap a card</button>`;
    const nothing = !L.values.length && !L.flips.length && !L.tapIns.length && !L.tapOuts.length;
    hint = nothing ? 'Nothing playable — pick up the stack' : L.flips.length && !L.values.length ? 'Try flipping a face-down pile card' : '';
  } else if (s.kind === 'num') {
    const n = s.hand + s.piles.length;
    const run = G.top() && G.top().v === s.v ? G.topRun() : 0;
    main = `<button class="cbtn go" id="playB">Play ${cardWord(s.v, n)}${run + n >= 4 ? ' — TAP!' : ''}</button>`;
    hint = s.hand > 1 || s.piles.length ? 'Tap the hand group again to play fewer' : '';
  } else if (s.kind === 'flip') {
    main = `<button class="cbtn go" id="flipB">Flip it</button>`;
    hint = G.top() ? `Plays if it's ${G.top().v} or lower — higher and you pick up` : 'Anything plays on an empty stack';
  } else if (s.kind === 'in') {
    main = `<button class="cbtn grn" id="inB">Tap In · clear stack</button>`;
    hint = 'Discards the stack, then you start a new one';
  } else if (s.kind === 'out') {
    const canSelf = !L.ctx.afterOut || G.twoP;
    const canOther = L.outTargets.length > 0;
    main = (canSelf ? `<button class="cbtn red" id="outSelfB">Skip my turn</button>` : '') + (canOther ? `<button class="cbtn red" id="outOtherB">Tap Out a player</button>` : '');
    hint = G.twoP ? 'Two players: Tap Out only skips your own turn' : '';
  }
  box.innerHTML = pick + main + (hint ? `<div class="hint">${hint}</div>` : '');
  const nb = box.querySelectorAll('.cbtn').length;
  box.style.gridTemplateColumns = nb === 1 ? '1fr' : nb === 2 ? (pick ? '1fr 1.6fr' : '1fr 1fr') : '1fr 1fr 1fr';
  const on = (id, f) => { const b = document.getElementById(id); if (b) b.onclick = f; };
  on('pickB', () => finishHuman({ type: 'pickup' }));
  on('playB', () => finishHuman({ type: 'play', ids: selIds(t) }));
  on('flipB', () => finishHuman({ type: 'flip', pile: s.x }));
  on('inB', () => finishHuman({ type: 'tapin', id: s.x }));
  on('outSelfB', () => finishHuman({ type: 'tapout', id: s.x, target: null }));
  on('outOtherB', async () => {
    const tt = uiTurn; const pend = pending; // keep the outer promise alive while we ask
    pending = null;
    const target = await pickOutTarget(t.p, L.outTargets, false, false);
    pending = pend;
    if (target === 'cancel' || target == null) { uiTurn = tt; renderControls(); return; }
    finishHuman({ type: 'tapout', id: s.x, target });
  });
}

/* ================= TABLE ================= */
const SLOTS = {
  1: [[50, 15]],
  2: [[27, 16], [73, 16]],
  3: [[18.5, 44], [50, 13], [81.5, 44]],
  4: [[18.5, 48], [31, 13], [69, 13], [81.5, 48]],
  5: [[18.5, 50], [18.5, 14], [50, 12], [81.5, 14], [81.5, 50]],
};
const CENTER_Y = { 1: 56, 2: 58, 3: 62, 4: 60, 5: 62 };
// Desktop tables are wide and short, so seats spread along the top and sides instead.
const DESK_SLOTS = {
  1: [[50, 20]],
  2: [[30, 22], [70, 22]],
  3: [[13, 52], [50, 20], [87, 52]],
  4: [[13, 56], [32, 20], [68, 20], [87, 56]],
  5: [[11, 64], [19, 24], [50, 19], [81, 24], [89, 64]],
  6: [[10, 70], [13, 28], [37, 19], [63, 19], [87, 28], [90, 70]],
  7: [[9, 74], [10, 34], [29, 18], [50, 18], [71, 18], [90, 34], [91, 74]],
};
const slotsFor = n => ((window.GNLayout && GNLayout.desktop) ? DESK_SLOTS : SLOTS)[n] || [];
// Switching between desktop and phone layout (e.g. resizing the window) moves the seats
window.addEventListener('gn-layout', () => {
  const pods = [...document.querySelectorAll('.ring .pod')], s = slotsFor(pods.length);
  pods.forEach((p, i) => { if (s[i]) { p.style.left = s[i][0] + '%'; p.style.top = s[i][1] + '%'; } });
});
function seatEl(p) { return document.querySelector(`[data-seat="${p.id}"]`); }

function buildTable() {
  const n = G.players.length, b = viewerId;
  const others = []; for (let k = 1; k < n; k++) others.push(G.players[(b + k) % n]);
  const slots = slotsFor(others.length);
  const me = G.players[b];
  $('#felt').innerHTML = `
    <div class="ring">
      ${others.map((p, i) => `
        <div class="pod" data-seat="${p.id}" style="left:${slots[i][0]}%;top:${slots[i][1]}%">
          <div class="ph"><span class="nm">${esc(p.name)}</span><span class="dl hidden">1st</span><span class="tot">0</span></div>
          <div class="prow"></div>
          <div class="hc"><div class="card back mini"></div><span><span class="n">0</span> in hand</span><span class="outb"></span></div>
        </div>`).join('')}
      <div class="center" style="top:${CENTER_Y[others.length] || 58}%">
        <div class="stackwrap" id="stack"></div>
        <div class="stacklbl2" id="stackLbl"></div>
        <div class="caption" id="caption"></div>
      </div>
    </div>
    <div class="tray" data-seat="${me.id}">
      <div class="ph"><span class="nm">${esc(me.name)}</span><span class="dl hidden">1st</span><span class="outb"></span><span class="sub2"></span>
        <span class="tot">0<small>pts</small></span></div>
      <div class="trow piles2"><span class="lab">Piles</span><div class="tpiles" style="display:flex;gap:8px"></div></div>
      <div class="trow"><span class="lab">Hand</span><div class="hand"></div></div>
    </div>`;
  $('#felt').onclick = onFeltClick;
}

function onFeltClick(e) {
  const t = uiTurn; if (!t) return;
  const g = e.target.closest('[data-act]'); if (!g) return;
  const a = g.dataset.act;
  if (a === 'num') selectNum(+g.dataset.v, g.dataset.pile != null ? +g.dataset.pile : null);
  else if (a === 'flip') { if (t.L.flips.includes(+g.dataset.pile)) selectOther('flip', +g.dataset.pile); }
  else if (a === 'in') selectOther('in', +g.dataset.id);
  else if (a === 'out') selectOther('out', +g.dataset.id);
}

function update() {
  if (!G) return;
  $('#rd').innerHTML = `Round ${Math.max(1, G.round + (between ? 1 : 0))}<small>ends at ${G.target}</small>`;
  // stack
  const st = $('#stack');
  if (!G.stack.length) st.innerHTML = `<div class="empty">${between ? '' : 'Empty<br>stack'}</div>`;
  else {
    const run = G.topRun(), show = G.stack.slice(-Math.min(4, Math.max(run, 1)));
    const under = G.stack.length - show.length;
    const pos = (x, y, r, html) => `<div style="position:absolute;left:${x}px;top:${y}px;transform:rotate(${r}deg)">${html}</div>`;
    st.innerHTML = (under ? pos(4, 3, -5, cardHTML(null, 'fl')) : '') +
      show.map((c, i) => pos(18 + i * 9, i * 2, 0, cardHTML(c, 'fl'))).join('');
  }
  $('#stackLbl').innerHTML = G.stack.length ? `<b>${WORDS[G.topRun()] || G.topRun()} ${G.top().v}${G.topRun() > 1 ? 's' : ''}</b><br>${G.stack.length} in stack${G.discard.length ? ' · ' + G.discard.length + ' out' : ''}` : (G.discard.length && !between ? `${G.discard.length} out of play` : '');
  const t = uiTurn;
  for (const p of G.players) {
    const s = seatEl(p); if (!s) continue;
    const isTray = s.classList.contains('tray');
    s.classList.toggle('cur', p === cur);
    s.querySelector('.tot').innerHTML = isTray ? `${p.total}<small>pts</small>` : p.total;
    s.querySelector('.dl').classList.toggle('hidden', !(p.id === G.starter && !between && G.round));
    s.querySelector('.outb').textContent = p.outs.length ? `Skip${p.outs.length > 1 ? ' ×' + p.outs.length : ''}` : '';
    if (!isTray) {
      s.querySelector('.n').textContent = p.hand.length;
      s.querySelector('.prow').innerHTML = p.piles.map(pl => {
        const top = Tap4.pileTop(pl);
        const depth = pl.length > 1 ? `<span class="depth">${pl.length}</span>` : '';
        if (!top) return `<div class="slot0"></div>`;
        return `<div class="pslot">${depth}${cardHTML(top.up ? top.c : null, 'xs')}</div>`;
      }).join('');
      continue;
    }
    // ---- your tray ----
    s.querySelector('.sub2').textContent = between ? '' : `${cardsLeft(p)} cards left`;
    const mine = t && t.p === p;
    const sel = mine ? t.sel : null;
    const L = mine ? t.L : null;
    s.querySelector('.tpiles').innerHTML = p.piles.map((pl, i) => {
      const top = Tap4.pileTop(pl);
      const depth = pl.length > 1 ? `<span class="depth">${pl.length}</span>` : '';
      if (!top) return `<div class="slot0" style="width:44px;height:62px;border-radius:6px"></div>`;
      if (!top.up) {
        const can = L && L.flips.includes(i);
        const isSel = sel && sel.kind === 'flip' && sel.x === i;
        return `<div class="pslot hgrp ${can ? 'pick-ok' : mine ? 'dim' : ''} ${isSel ? 'selc' : ''}" data-act="flip" data-pile="${i}">${depth}${cardHTML(null, 'tr')}</div>`;
      }
      const c = top.c;
      let act = '', can = false, isSel = false;
      if (c.t === 'num') { act = `data-act="num" data-v="${c.v}" data-pile="${i}"`; can = L && L.values.includes(c.v); isSel = sel && sel.kind === 'num' && sel.v === c.v && sel.piles.includes(i); }
      else { act = `data-act="${c.t}" data-id="${c.id}"`; can = L && (c.t === 'in' ? L.tapIns : L.tapOuts).includes(c.id); isSel = sel && sel.kind === c.t && sel.x === c.id; }
      return `<div class="pslot hgrp ${can ? 'pick-ok' : mine ? 'dim' : ''} ${isSel ? 'selc' : ''}" ${act}>${depth}${cardHTML(c, 'tr')}</div>`;
    }).join('');
    const hand = s.querySelector('.hand');
    if (handHidden && multiHuman()) {
      hand.innerHTML = `<div class="hidden-hand">${cardHTML(null, 'tr')}<span>${p.hand.length} cards · hidden until it's ${esc(Say.whose(p))} turn</span></div>`;
    } else {
      const groups = [];
      for (let v = 12; v >= 1; v--) { const cs = p.hand.filter(c => c.t === 'num' && c.v === v); if (cs.length) groups.push({ kind: 'num', v, cs }); }
      const ins = p.hand.filter(c => c.t === 'in'), outs = p.hand.filter(c => c.t === 'out');
      if (ins.length) groups.push({ kind: 'in', cs: ins });
      if (outs.length) groups.push({ kind: 'out', cs: outs });
      hand.innerHTML = groups.map(gp => {
        let act, can, isSel, selN = 0;
        if (gp.kind === 'num') {
          act = `data-act="num" data-v="${gp.v}"`; can = L && L.values.includes(gp.v);
          isSel = sel && sel.kind === 'num' && sel.v === gp.v && sel.hand > 0; selN = isSel ? sel.hand : 0;
        } else {
          act = `data-act="${gp.kind}" data-id="${gp.cs[0].id}"`; can = L && (gp.kind === 'in' ? L.tapIns : L.tapOuts).length > 0;
          isSel = sel && sel.kind === gp.kind && gp.cs.some(c => c.id === sel.x); selN = isSel ? 1 : 0;
        }
        const badge = gp.cs.length > 1 || selN ? `<span class="cnt ${selN ? 'sel' : ''}">${selN && selN !== gp.cs.length ? selN + '/' : ''}${gp.cs.length > 1 || selN ? '×' + gp.cs.length : ''}</span>` : '';
        return `<div class="hgrp ${can ? 'pick-ok' : mine ? 'dim' : ''} ${isSel ? 'selc' : ''}" ${act}>${badge}${cardHTML(gp.cs[0], 'tr')}</div>`;
      }).join('') || `<span class="sub2" style="align-self:center">No cards in hand</span>`;
    }
  }
  const tray = $('.tray'); if (tray) $('#felt').style.setProperty('--tray-h', (tray.offsetHeight + 16) + 'px');
}

/* ---------- flying cards ---------- */
async function fly(fromEl, toEl, html, badge) {
  if (!fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  const f = el(`<div class="floater">${html}${badge ? `<span class="depth" style="font-size:11px;line-height:16px;padding:0 5px;right:-6px;top:-6px">${badge}</span>` : ''}</div>`);
  f.style.left = (a.left + a.width / 2 - 30) + 'px'; f.style.top = (a.top + a.height / 2 - 42) + 'px';
  document.body.appendChild(f);
  // On desktop the floater is scaled up by GNLayout.k (desktop.css), which also scales its travel
  const k = (window.GNLayout && GNLayout.k) || 1;
  const dx = ((b.left + b.width / 2) - (a.left + a.width / 2)) / k, dy = ((b.top + b.height / 2) - (a.top + a.height / 2)) / k;
  await f.animate([{ transform: 'translate(0,0) scale(.6)', opacity: .6 }, { transform: 'translate(0,0) scale(1)', opacity: 1, offset: .25 }, { transform: `translate(${dx}px,${dy}px) scale(1)` }],
    { duration: T(480), easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' }).finished.catch(() => {});
  f.remove();
}

/* ================= EVENTS ================= */
async function onEvent(type, e) {
  switch (type) {
    case 'roundStart':
      between = false; cur = null; update();
      caption(`Round ${e.round}<small>${esc(Say.who(e.starter))} ${Say.verb(e.starter, 'goes', 'go')} first</small>`); controlsWait('Dealing…');
      await sleep(900); break;
    case 'resume': update(); break;
    case 'turn':
      if (multiHuman() && !handHidden && e.p.id !== viewerId) handHidden = true;
      cur = e.p; save('turn'); update();
      caption(e.p.kind === 'human' ? '' : `${esc(Say.cap(Say.whose(e.p)))} turn`);
      break;
    case 'cancelSkip':
      update(); caption(`${esc(Say.who(e.p))} ${Say.verb(e.p, 'cancels', 'cancel')} the Tap Out<small>with a Tap In</small>`); await sleep(900); break;
    case 'skipped':
      update(); caption(`${esc(Say.who(e.p))} ${Say.is(e.p)} Tapped Out<small>${Say.verb(e.p, 'Loses', 'You lose')} this turn</small>`); controlsWait(''); await sleep(1000); endHumanTurn(e.p); break;
    case 'flip': {
      const s = seatEl(e.p);
      const slot = s && (s.querySelectorAll('.tpiles > *, .prow > *')[e.pile]);
      caption(`${esc(Say.who(e.p))} ${Say.verb(e.p, 'flips', 'flip')} a face-down card…`);
      await fly(slot || s, $('#stack'), cardHTML(e.card, 'fl'));
      break;
    }
    case 'play':
      if (!e.flipped) await fly(seatEl(e.p), $('#stack'), cardHTML(e.cards[0], 'fl'), e.cards.length > 1 ? '×' + e.cards.length : '');
      update();
      caption(`${esc(Say.who(e.p))} ${Say.verb(e.p, 'plays', 'play')} ${cardWord(e.cards[0].v, e.cards.length)}`);
      await sleep(e.p.kind === 'human' ? 250 : 450); break;
    case 'flipFail':
      update(); caption(`${esc(Say.who(e.p))} flipped a ${e.card.v}<small>Too high — ${Say.verb(e.p, 'picks up the stack', 'you pick up the stack')}</small>`); await sleep(900); break;
    case 'tapped':
      update(); toast('TAPPED!', 'tap'); buzz([40, 30, 40]);
      caption(e.by === 'tapin' ? `${esc(Say.who(e.p))} ${Say.verb(e.p, 'plays', 'play')} a Tap In<small>Stack cleared — go again</small>` : `${esc(Say.who(e.p))} ${Say.verb(e.p, 'makes', 'make')} ${WORDS[e.n] ? WORDS[e.n].toLowerCase() : e.n} ${e.v}s<small>Stack cleared — go again</small>`);
      await sleep(1100); break;
    case 'stackCleared': update(); break;
    case 'tapOutSelf':
      update(); caption(`${esc(Say.who(e.p))} ${Say.verb(e.p, 'plays', 'play')} a Tap Out<small>${Say.verb(e.p, 'Skips their', 'You skip your')} own turn</small>`); await sleep(900); endHumanTurn(e.p); break;
    case 'tapOutOther':
      await fly(seatEl(e.p), seatEl(e.to), cardHTML(e.card, 'fl'));
      update(); caption(`${esc(Say.who(e.p))} ${Say.verb(e.p, 'taps', 'tap')} ${Say.isYou(e.to) ? 'you out' : 'out ' + esc(e.to.name)}<small>${esc(Say.who(e.to))} ${Say.verb(e.to, 'loses', 'lose')} ${Say.their(e.to)} next turn</small>`); await sleep(900); break;
    case 'pickup': {
      const s = seatEl(e.p);
      await fly($('#stack'), s, cardHTML(null, 'fl'), '×' + e.n);
      update(); caption(`${esc(Say.who(e.p))} ${Say.verb(e.p, 'picks', 'pick')} up ${e.n} card${e.n === 1 ? '' : 's'}`);
      if (s) { s.classList.remove('shake'); void s.offsetWidth; s.classList.add('shake'); }
      await sleep(800); endHumanTurn(e.p); break;
    }
    case 'wentOut': update(); toast(`${esc(Say.who(e.p))} ${Say.is(e.p)} out!`, 'big'); burst(); await sleep(1500); break;
    case 'stalled': toast('Nobody could finish — round called'); await sleep(1000); break;
    case 'roundEnd': cur = null; update(); controlsWait(''); await sleep(500); await roundSummary(e); break;
    case 'gameEnd': store.del(SAVE_KEY); await gameOver(e.winners); break;
  }
  // a number play or Tap In ends a human's turn unless they continue
  if ((type === 'play' || type === 'tapOutOther') && e.p && e.p.kind === 'human') { /* continues or ends via next agent call */ }
}

function roundSummary(e) {
  return waitUI(done => {
    between = true;
    const sorted = [...G.players].sort((a, b) => a.total - b.total);
    const low = sorted[0].total;
    openSheet(`
      <h2>${e.over ? 'Final round' : `Round ${G.round} done`}</h2>
      <p class="lead">${e.out ? `${esc(e.out.name)} went out.` : 'Round called.'} Cards left in hand and piles count against you. ${e.over ? '' : `Game ends when someone reaches ${G.target}.`}</p>
      <div class="rows">${sorted.map(p => `
        <div class="row ${p.total === low ? 'lead' : ''}"><div class="pn">${esc(p.name)}</div>
        <span class="res ${p === e.out ? 'f7' : p.lastScore > 40 ? 'bust' : 'ok'}">${p === e.out ? 'Out! +0' : '+' + p.lastScore}</span><div class="tot">${p.total}</div>
        <div class="bar"><i style="width:${Math.min(100, p.total / G.target * 100)}%"></i></div></div>`).join('')}</div>
      <button class="big" id="nextB" style="background:linear-gradient(180deg,#5aa0ff,#2f6cf0)">${e.over ? 'See results' : 'Next round'}</button>`, false);
    $('#nextB').onclick = () => { closeSheet(); save(G.over ? 'over' : 'between'); done(); };
  });
}
function gameOver(ws) {
  return waitUI(done => {
    const sorted = [...G.players].sort((a, b) => a.total - b.total);
    burst();
    openSheet(`
      <div style="text-align:center;margin-bottom:10px"><div style="font-size:54px">🏆</div><h2>${esc(Say.winners(ws))}</h2><p class="lead">Lowest score: ${ws[0].total} after ${G.round} rounds</p></div>
      <div class="rows">${sorted.map((p, i) => `<div class="row ${ws.includes(p) ? 'lead' : ''}"><div class="pn">${i + 1}. ${esc(p.name)}</div><span></span><div class="tot">${p.total}</div></div>`).join('')}</div>
      <button class="big" id="againB" style="background:linear-gradient(180deg,#5aa0ff,#2f6cf0)">Rematch</button>
      <div class="btnrow"><button class="ghost" id="setupB">Change players</button></div>`, false);
    $('#againB').onclick = () => { closeSheet(); done(); startGame(G.players.map(p => ({ name: p.name, kind: p.kind, level: p.level }))); };
    $('#setupB').onclick = () => { done(); quitToSetup(); };
  });
}

function caption(h) { const c = $('#caption'); if (c) c.innerHTML = h; }
function controlsWait(t) { const b = $('#controls'); b.className = ''; b.style.gridTemplateColumns = ''; b.innerHTML = `<div class="wait">${t || '&nbsp;'}</div>`; }
function buzz(pat) { try { navigator.vibrate && navigator.vibrate(pat); } catch (e) {} }
function toast(h, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.innerHTML = h;
  const box = $('#toasts'); box.appendChild(t);
  while (box.children.length > 2) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'big' || kind === 'tap' ? 1500 : 1800);
}
function burst() {
  const colors = ['#ff5d5d', '#ffc94d', '#3ddc97', '#7fd3ff', '#5aa0ff', '#b18cff'];
  for (let i = 0; i < 60; i++) {
    const s = document.createElement('div'); s.className = 'spark';
    s.style.left = (Math.random() * 100) + 'vw'; s.style.top = '-20px';
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
    s.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    s.style.animationDelay = (Math.random() * 0.4) + 's';
    document.body.appendChild(s); setTimeout(() => s.remove(), 2200);
  }
}

/* ================= SHEETS ================= */
let sheetDismiss = false;
function openSheet(html, dismissable = true) { $('#toasts').innerHTML = ''; $('#sheetCard').innerHTML = html; $('#sheet').classList.remove('hidden'); sheetDismiss = dismissable; }
function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheetCard').innerHTML = ''; }
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet' && sheetDismiss) closeSheet(); });

function showRules() {
  const n = v => cardHTML({ t: 'num', v });
  openSheet(`<div class="rules">
    <h2>How to play</h2>
    <p class="lead">Be the first to get rid of every card in your hand and piles. Everyone else scores what they're left holding — lowest total wins.</p>
    <h3>Setup</h3>
    <p>Each player gets 19 cards: four face-down cards, each covered by a face-up card (your <b>piles</b>), and an 11-card hand. With two players it's 27 cards each and piles are two deep.</p>
    <h3>On your turn, do one thing</h3>
    <ul>
      <li><b>Play</b> one or more cards of the same number, <b>equal to or lower</b> than the top of the stack. Mix hand cards and face-up pile cards freely.</li>
      <li><b>Play a Tap In or Tap Out.</b></li>
      <li><b>Pick up the stack</b> if you can't (or won't) play. That ends your turn.</li>
    </ul>
    <div class="ex">${n(9)}${n(9)}${n(7)}${n(4)}</div>
    <h3>Face-down cards</h3>
    <p>Once a pile's face-up card is gone, you can flip the face-down card as your play. If it's equal or lower, it goes on the stack (and you can add matching cards). If it's higher, it joins the stack and you pick the whole thing up.</p>
    <h3>Tap the stack</h3>
    <p>When your play makes <b>four or more of the same number</b> on top of the stack — counting cards already there — the stack is cleared and you go again, starting a fresh stack.</p>
    <h3>Tap In <span style="font-weight:600;color:var(--dim)">(20 pts if stuck with it)</span></h3>
    <div class="ex">${cardHTML({ t: 'in' })}</div>
    <p>Clears the stack, then you start a new one. Or use it to cancel a Tap Out played on you.</p>
    <h3>Tap Out <span style="font-weight:600;color:var(--dim)">(30 pts)</span></h3>
    <div class="ex">${cardHTML({ t: 'out' })}</div>
    <p>Skip your own turn (no pickup), or put it on another player so they lose their next turn — then you still play to the stack. With two players it can only skip your own turn.</p>
    <h3>Scoring</h3>
    <p>The round ends the moment someone plays their last card. Everyone else adds up what's left: numbers at face value, Tap In 20, Tap Out 30. The game ends when someone reaches ${G ? G.target : prefs.target}; lowest total wins.</p>
    <button class="big" style="margin-top:16px;background:linear-gradient(180deg,#5aa0ff,#2f6cf0)" id="closeR">Got it</button></div>`);
  $('#closeR').onclick = closeSheet;
}
function showMenu() {
  const seg = (key, opts, val) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v == val ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  openSheet(`<h2>Menu</h2><p class="lead">Your game saves at the start of every turn.</p>
    <div class="panel" style="margin-bottom:12px"><div class="opt"><label>Speed</label>${seg('speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], prefs.speed)}</div></div>
    <button class="ghost" id="rulesM" style="margin-bottom:8px">How to play</button>
    ${window.GNReport ? '<button class="ghost" id="bugM" style="margin-bottom:8px">⚑ Report a bug</button>' : ''}
    <button class="ghost" id="quitM" style="margin-bottom:8px">Back to main menu</button>
    <button class="big" id="closeM" style="background:linear-gradient(180deg,#5aa0ff,#2f6cf0)">Back to game</button>`);
  $('#sheetCard').querySelectorAll('[data-seg] button').forEach(b => b.onclick = () => { prefs.speed = b.dataset.v; savePrefs(); showMenu(); });
  $('#rulesM').onclick = showRules;
  $('#quitM').onclick = () => quitToSetup();
  if ($('#bugM')) $('#bugM').onclick = () => { closeSheet(); GNReport.open(); };
  $('#closeM').onclick = closeSheet;
}
$('#menuBtn').onclick = () => { if (!$('#sheet').classList.contains('hidden') && !sheetDismiss) return; showMenu(); };
window.addEventListener('resize', () => { const tray = $('.tray'); if (tray) $('#felt').style.setProperty('--tray-h', (tray.offsetHeight + 16) + 'px'); });

renderSetup();
})();
