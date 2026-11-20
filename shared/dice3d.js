// Shared 3D dice tray for Yahtzee and Farkle.
// Real CSS 3D cubes with pips. Rolls are thrown in from the corner of the tray, tumble,
// bounce (lift + shadow) and settle on the rolled face. Held / set-aside dice slide down to a rail.
//
//   const tray = Dice3D.create(el, { count: 5 });
//   tray.onTap = i => ...;              // tap on a die
//   tray.setState(i, 'held')            // 'free' | 'held' | 'locked' | 'hidden'
//   await tray.roll([0,2,3], [6,6,1])   // animate those dice to those values
//   tray.lineup(values)                 // dice in a neat row, no animation (start of turn)
//   tray.mark(i, 'pick', true)          // extra highlight class on a die
//   Dice3D.sound = false                // mute the clacks
//   options: count, max (die px), rows / ratio (play-area height in dice / as share of width), railLabel
(function (root) {
'use strict';
const CSS = `
.d3-tray{position:relative;width:100%;border-radius:18px;overflow:hidden;perspective:900px;
  background:radial-gradient(ellipse at 50% 35%,#2f8a52 0%,#1f6b3d 55%,#164f2d 100%);
  box-shadow:inset 0 0 0 6px #6b3f22,inset 0 0 0 9px #4a2a15,inset 0 10px 30px rgba(0,0,0,.45),0 4px 0 rgba(0,0,0,.3);touch-action:manipulation;user-select:none;-webkit-user-select:none}
.d3-tray:before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,.025) 0 2px,transparent 2px 5px);pointer-events:none}
.d3-rail{position:absolute;left:12px;right:12px;bottom:10px;border-radius:12px;background:rgba(0,0,0,.22);box-shadow:inset 0 2px 6px rgba(0,0,0,.35)}
.d3-rail span{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:rgba(255,255,255,.28);font:700 11px system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;pointer-events:none}
.d3-die{position:absolute;left:0;top:0;width:var(--s);height:var(--s);will-change:transform;cursor:pointer;z-index:2}
.d3-shadow{position:absolute;left:8%;top:12%;width:92%;height:92%;border-radius:22%;background:rgba(0,0,0,.45);filter:blur(4px);transform:translate(4px,6px)}
.d3-lift{position:absolute;inset:0;transform-style:preserve-3d}
.d3-cube{position:absolute;inset:0;transform-style:preserve-3d}
.d3-face{position:absolute;inset:0;border-radius:18%;background:radial-gradient(circle at 30% 25%,#ffffff 0%,#f4f1ea 55%,#e2ddd2 100%);
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.08),inset -3px -4px 8px rgba(0,0,0,.12);display:grid;grid-template:repeat(3,1fr)/repeat(3,1fr);padding:14%;backface-visibility:hidden}
.d3-pip{width:62%;height:62%;margin:auto;border-radius:50%;background:radial-gradient(circle at 35% 30%,#555 0%,#111 70%);box-shadow:inset 0 1px 1px rgba(255,255,255,.2)}
.d3-face.v1 .d3-pip{background:radial-gradient(circle at 35% 30%,#e0524a 0%,#9c1f18 75%);width:78%;height:78%}
.d3-die.held .d3-face,.d3-die.pick .d3-face{background:radial-gradient(circle at 30% 25%,#fffbe8 0%,#fbe9a6 60%,#eccb62 100%)}
.d3-die.held .d3-shadow,.d3-die.pick .d3-shadow{background:rgba(255,200,40,.55)}
.d3-die.locked{cursor:default}
.d3-die.locked .d3-face{background:radial-gradient(circle at 30% 25%,#e9e6df 0%,#cfcac0 100%);opacity:.92}
.d3-die.locked .d3-pip{opacity:.55}
.d3-die.hidden{opacity:0;pointer-events:none}
.d3-die.dim{opacity:.45}
.d3-die.nope .d3-lift{animation:d3nope .35s}
@keyframes d3nope{25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.d3-tray.frozen .d3-die{cursor:default}
`;
const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// face shown toward the viewer for each value (front=1, right=2, top=3, bottom=4, left=5, back=6)
const FACE_ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
const FACE_POS = { 1: 'translateZ(h)', 2: 'rotateY(90deg) translateZ(h)', 3: 'rotateX(90deg) translateZ(h)', 4: 'rotateX(-90deg) translateZ(h)', 5: 'rotateY(-90deg) translateZ(h)', 6: 'rotateY(180deg) translateZ(h)' };
const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let audio = null;
function clack(vol) {
  if (!api.sound) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const n = audio.sampleRate * 0.05, buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
    const src = audio.createBufferSource(); src.buffer = buf;
    const f = audio.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 1600; f.Q.value = 2.5;
    const gn = audio.createGain(); gn.gain.value = 0.25 * vol;
    src.connect(f); f.connect(gn); gn.connect(audio.destination); src.start();
  } catch (e) {}
}

function injectCss() { if (document.getElementById('d3-css')) return; const s = document.createElement('style'); s.id = 'd3-css'; s.textContent = CSS; document.head.appendChild(s); }

function create(el, opts) {
  injectCss();
  opts = opts || {};
  const count = opts.count || 5;
  el.classList.add('d3-tray');
  el.innerHTML = '<div class="d3-rail"><span>' + (opts.railLabel || 'held') + '</span></div>';
  const rail = el.querySelector('.d3-rail');
  const dice = [];
  const tray = { el, count, values: [], state: [], onTap: null, frozen: false };
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div'); d.className = 'd3-die'; d.dataset.i = i;
    d.innerHTML = '<div class="d3-shadow"></div><div class="d3-lift"><div class="d3-cube">' +
      [1, 2, 3, 4, 5, 6].map(v => `<div class="d3-face v${v}" data-f="${v}">${Array.from({ length: 9 }, (_, k) => PIPS[v].indexOf(k) >= 0 ? '<i class="d3-pip"></i>' : '<i></i>').join('')}</div>`).join('') +
      '</div></div>';
    d.addEventListener('click', () => { if (!tray.frozen && tray.onTap && tray.state[i] !== 'hidden') tray.onTap(i); });
    el.appendChild(d);
    dice.push({ el: d, cube: d.querySelector('.d3-cube'), lift: d.querySelector('.d3-lift'), shadow: d.querySelector('.d3-shadow'), x: 0, y: 0, fx: 0.5, fy: 0.5, rx: 0, ry: 0, rz: 0, anim: [] });
    tray.values.push(1 + (i % 6)); tray.state.push('free');
  }
  let S = 48;
  function size() {
    const w = el.clientWidth || 340;
    S = Math.round(Math.max(38, Math.min(opts.max || 76, (w - 40) / (count + 1.3))));
    el.style.setProperty('--s', S + 'px');
    const railH = S + 16;
    rail.style.height = railH + 'px';
    if (!el.style.height) el.style.height = Math.round(Math.max(S * (opts.rows || 3.6), w * (opts.ratio || 0.5)) + railH) + 'px';
    dice.forEach(d => d.el.querySelectorAll('.d3-face').forEach(f => { f.style.transform = FACE_POS[f.dataset.f].replace('h', (S / 2) + 'px'); }));
  }
  function playArea() { const w = el.clientWidth, h = el.clientHeight - (S + 26); return { w, h }; }
  function railSlot(i) { const w = el.clientWidth - 24; const gap = w / count; return { x: 12 + gap * i + (gap - S) / 2, y: el.clientHeight - 10 - (S + 16) / 2 - S / 2 }; }
  function place(d, x, y) { d.x = x; d.y = y; d.el.style.transform = `translate(${x}px,${y}px)`; }
  function orient(d, v, spinZ) {
    const r = FACE_ROT[v]; d.rx = r[0]; d.ry = r[1]; d.rz = spinZ != null ? spinZ : d.rz;
    d.cube.style.transform = `rotateZ(${d.rz}deg) rotateX(${d.rx}deg) rotateY(${d.ry}deg)`;
  }
  // scatter free dice without overlap; returns map i -> {x,y}
  function scatter(idxs, keep) {
    const { w, h } = playArea(), pad = 14, out = {}, taken = [];
    dice.forEach((d, i) => { if (keep && keep.indexOf(i) >= 0 && tray.state[i] === 'free') taken.push({ x: d.x, y: d.y }); });
    for (const i of idxs) {
      let best = null, bestD = -1;
      for (let t = 0; t < 60; t++) {
        const p = { x: pad + Math.random() * Math.max(1, w - S - 2 * pad), y: pad + Math.random() * Math.max(1, h - S - pad) };
        const md = taken.reduce((m, q) => Math.min(m, Math.hypot(p.x - q.x, p.y - q.y)), 1e9);
        if (md > S * 1.25) { best = p; break; }
        if (md > bestD) { bestD = md; best = p; }
      }
      taken.push(best); out[i] = best;
    }
    return out;
  }
  function stopAnims(d) { d.anim.forEach(a => { try { a.cancel(); } catch (e) {} }); d.anim = []; }

  tray.setValue = (i, v) => { tray.values[i] = v; orient(dice[i], v); };
  tray.mark = (i, cls, on) => dice[i].el.classList.toggle(cls, !!on);
  tray.nope = i => { const e = dice[i].el; e.classList.remove('nope'); void e.offsetWidth; e.classList.add('nope'); };
  tray.setFrozen = f => { tray.frozen = !!f; el.classList.toggle('frozen', !!f); };
  tray.setState = (i, st, animate) => {
    const d = dice[i], prev = tray.state[i];
    tray.state[i] = st;
    ['held', 'locked', 'hidden'].forEach(c => d.el.classList.toggle(c, st === c));
    let to;
    if (st === 'held' || st === 'locked') to = railSlot(i);
    else if (st === 'free' && (prev === 'held' || prev === 'locked')) {
      // come back to where it was on the table (if that spot is still clear)
      to = { x: d.fx * el.clientWidth, y: d.fy * el.clientHeight };
      if (to.y + S > playArea().h) to = scatter([i], dice.map((_, k) => k).filter(k => k !== i))[i];
    }
    if (!to) return;
    if (animate === false || reduce) { place(d, to.x, to.y); return; }
    stopAnims(d);
    const from = `translate(${d.x}px,${d.y}px)`;
    place(d, to.x, to.y);
    d.anim.push(d.el.animate([{ transform: from }, { transform: `translate(${to.x}px,${to.y}px)` }], { duration: 260, easing: 'cubic-bezier(.3,.7,.3,1)' }));
    d.anim.push(d.lift.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 260 }));
  };
  tray.lineup = (values, states) => {
    size();
    const { w, h } = playArea();
    const freeIdx = dice.map((_, i) => i).filter(i => !states || states[i] === 'free');
    const gap = Math.min(S * 1.3, (w - 30) / Math.max(1, freeIdx.length));
    const x0 = (w - gap * freeIdx.length) / 2 + (gap - S) / 2;
    dice.forEach((d, i) => {
      stopAnims(d);
      const st = states ? states[i] : 'free';
      tray.state[i] = st;
      ['held', 'locked', 'hidden'].forEach(c => d.el.classList.toggle(c, st === c));
      if (values) tray.values[i] = values[i];
      orient(d, tray.values[i], 0);
      if (st === 'free') { const k = freeIdx.indexOf(i); place(d, x0 + gap * k, (h - S) / 2); d.fx = d.x / el.clientWidth; d.fy = d.y / el.clientHeight; }
      else { const p = railSlot(i); place(d, p.x, p.y); }
    });
  };
  // Throw dice `idxs` so they land showing `vals`. Resolves when all have settled.
  tray.roll = (idxs, vals, o) => {
    o = o || {};
    size();
    const dest = scatter(idxs, dice.map((_, i) => i).filter(i => idxs.indexOf(i) < 0));
    const W = el.clientWidth, H = el.clientHeight;
    const fromRight = Math.random() < 0.5;
    const base = reduce ? 350 : (o.fast ? 750 : 1150);
    const proms = idxs.map((i, k) => {
      const d = dice[i], v = vals[k];
      stopAnims(d);
      tray.values[i] = v; tray.state[i] = 'free';
      ['held', 'locked', 'hidden'].forEach(c => d.el.classList.toggle(c, false));
      const to = dest[i];
      const start = { x: fromRight ? W + S * (0.3 + Math.random()) : -S * (1.3 + Math.random()), y: H * (0.55 + Math.random() * 0.35) };
      const dur = base + Math.random() * 300 + k * 60;
      // tumbling: whole turns plus the rolled face, random spin about the view axis
      const r = FACE_ROT[v];
      const sx = (2 + Math.floor(Math.random() * 3)) * 360 * (Math.random() < 0.5 ? -1 : 1);
      const sy = (2 + Math.floor(Math.random() * 3)) * 360 * (Math.random() < 0.5 ? -1 : 1);
      const rz = Math.round(Math.random() * 50 - 25);
      const rotFrom = `rotateZ(${d.rz + (Math.random() * 180 - 90)}deg) rotateX(${d.rx}deg) rotateY(${d.ry}deg)`;
      const rotTo = `rotateZ(${rz}deg) rotateX(${r[0] + sx}deg) rotateY(${r[1] + sy}deg)`;
      d.rx = r[0]; d.ry = r[1]; d.rz = rz;
      const mid1 = { x: start.x + (to.x - start.x) * 0.55 + (Math.random() - 0.5) * S, y: start.y + (to.y - start.y) * 0.55 - S * 0.4 };
      const mid2 = { x: start.x + (to.x - start.x) * 0.85, y: start.y + (to.y - start.y) * 0.85 };
      place(d, to.x, to.y); d.fx = to.x / W; d.fy = to.y / H;
      const t = (p) => `translate(${p.x}px,${p.y}px)`;
      d.anim.push(d.el.animate([
        { transform: t(start), offset: 0 }, { transform: t(mid1), offset: 0.38 }, { transform: t(mid2), offset: 0.66 },
        { transform: t({ x: to.x + (to.x - mid2.x) * 0.06, y: to.y + (to.y - mid2.y) * 0.06 }), offset: 0.86 }, { transform: t(to), offset: 1 }],
        { duration: dur, easing: 'cubic-bezier(.2,.6,.35,1)' }));
      d.anim.push(d.cube.animate([{ transform: rotFrom }, { transform: rotTo }], { duration: dur * 0.92, easing: 'cubic-bezier(.15,.55,.25,1)', fill: 'backwards' }));
      d.cube.style.transform = rotTo.replace(`rotateX(${r[0] + sx}deg) rotateY(${r[1] + sy}deg)`, `rotateX(${r[0]}deg) rotateY(${r[1]}deg)`);
      // hops: big lift as it flies in, then two smaller bounces
      d.anim.push(d.lift.animate([
        { transform: 'scale(1.55)', offset: 0 }, { transform: 'scale(1.0)', offset: 0.38 }, { transform: 'scale(1.18)', offset: 0.52 },
        { transform: 'scale(1.0)', offset: 0.66 }, { transform: 'scale(1.05)', offset: 0.76 }, { transform: 'scale(1)', offset: 0.86 }, { transform: 'scale(1)', offset: 1 }],
        { duration: dur }));
      d.anim.push(d.shadow.animate([
        { transform: 'translate(22px,30px) scale(.8)', opacity: 0.25, offset: 0 }, { transform: 'translate(4px,6px)', opacity: 1, offset: 0.38 },
        { transform: 'translate(10px,14px) scale(.9)', opacity: 0.6, offset: 0.52 }, { transform: 'translate(4px,6px)', opacity: 1, offset: 0.66 },
        { transform: 'translate(4px,6px)', opacity: 1, offset: 1 }], { duration: dur }));
      if (!reduce) { setTimeout(() => clack(0.9), dur * 0.38); setTimeout(() => clack(0.5), dur * 0.66); setTimeout(() => clack(0.25), dur * 0.86); }
      return new Promise(res => setTimeout(res, dur + 20));
    });
    return Promise.all(proms);
  };
  tray.resize = () => {
    const ow = tray._w || el.clientWidth; size();
    const k = el.clientWidth / ow; tray._w = el.clientWidth;
    dice.forEach((d, i) => { stopAnims(d); if (tray.state[i] === 'free') place(d, Math.min(d.x * k, el.clientWidth - S - 8), Math.min(d.y, playArea().h - S)); else { const p = railSlot(i); place(d, p.x, p.y); } });
  };
  size(); tray._w = el.clientWidth;
  tray.lineup(tray.values);
  if (typeof ResizeObserver !== 'undefined') { let raf; new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (Math.abs((tray._w || 0) - el.clientWidth) > 2) tray.resize(); }); }).observe(el); }
  return tray;
}

const api = { create, sound: true, clack };
root.Dice3D = api;
})(typeof window !== 'undefined' ? window : this);
