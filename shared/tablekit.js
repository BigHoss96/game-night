// Shared table kit for the card games (Uno, Phase 10, Skip-Bo): the setup screen, pass-the-phone
// screens, sheets, toasts, banners and card-flight animation. Inlined into each game by the site build.
// Colors come from CSS variables the game sets: --tk-bg --tk-panel --tk-ink --tk-mute --tk-line --tk-accent --tk-accent-ink
(function (root) {
'use strict';
const CSS = `
.tk-wrap{max-width:520px;margin:0 auto;padding:14px 12px 32px}
.tk-logo{text-align:center;margin:18px 0 4px;font-weight:900;font-size:52px;letter-spacing:-.03em;line-height:1}
.tk-tag{text-align:center;color:var(--tk-mute);margin-bottom:16px}
.tk-panel{background:var(--tk-panel);color:var(--tk-ink);border-radius:16px;padding:14px;margin:10px 0;box-shadow:0 2px 0 rgba(0,0,0,.2)}
.tk-panel h3{margin:0 0 8px;font-size:17px}
.tk-f{display:block;font-size:12px;font-weight:800;color:var(--tk-mute);text-transform:uppercase;letter-spacing:.06em;margin:12px 0 6px}
.tk-seg{display:flex;background:rgba(0,0,0,.07);border-radius:10px;padding:3px;gap:3px}
.tk-seg button{flex:1;padding:10px 4px;border-radius:8px;font-weight:800;color:var(--tk-mute);border:0;background:none;font:inherit;font-weight:800;cursor:pointer}
.tk-seg button.on{background:var(--tk-ink);color:var(--tk-panel)}
.tk-in{width:100%;font:inherit;font-size:16px;padding:11px;border:1px solid var(--tk-line);border-radius:10px;background:#fff;color:#222;margin-bottom:6px}
.tk-tog{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid var(--tk-line)}
.tk-tog:last-child{border-bottom:0}.tk-tog b{display:block}.tk-tog small{color:var(--tk-mute)}
.tk-sw{width:50px;height:30px;border-radius:15px;background:#c9c3b8;position:relative;flex:none;border:0;cursor:pointer;transition:background .2s}
.tk-sw:after{content:'';position:absolute;left:3px;top:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.tk-sw.on{background:#2f9a5a}.tk-sw.on:after{left:23px}
.tk-big{display:block;width:100%;padding:15px;border-radius:14px;border:0;background:var(--tk-accent);color:var(--tk-accent-ink,#fff);font:inherit;font-weight:900;font-size:19px;margin-top:12px;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.3)}
.tk-big:active{transform:translateY(2px);box-shadow:0 2px 0 rgba(0,0,0,.3)}
.tk-big:disabled{opacity:.4}
.tk-ghost{display:block;width:100%;padding:12px;border-radius:12px;border:0;background:rgba(255,255,255,.1);color:inherit;font:inherit;font-weight:800;margin-top:8px;cursor:pointer;text-align:center;text-decoration:none}
.tk-panel .tk-ghost{background:rgba(0,0,0,.07)}
.tk-scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;z-index:60}
.tk-sheet{background:var(--tk-panel);color:var(--tk-ink);width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom))}
.tk-sheet h2{margin:0 0 12px}.tk-sheet .tk-x{float:right;font-size:26px;font-weight:900;border:0;background:none;color:inherit;cursor:pointer}
.tk-sheet p,.tk-sheet li{line-height:1.5}
html.gn-desktop .tk-scrim{align-items:center}html.gn-desktop .tk-sheet{border-radius:18px}
.tk-hand{position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:30px;background:var(--tk-bg);color:#fff}
.tk-hand h2{font-size:30px;margin:0 0 8px}.tk-hand p{color:rgba(255,255,255,.75);margin:0 0 18px}.tk-hand .tk-big{max-width:320px}
.tk-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:10px;font-weight:800;z-index:80;max-width:90vw;text-align:center}
.tk-banner{position:fixed;left:50%;top:40%;z-index:75;font-weight:900;font-size:60px;color:#fff;white-space:nowrap;pointer-events:none;opacity:0;text-shadow:0 5px 0 var(--tk-accent),0 12px 30px rgba(0,0,0,.6)}
.tk-banner.show{animation:tkban 1.5s ease forwards}
@keyframes tkban{0%{opacity:0;transform:translate(-50%,-50%) scale(.4) rotate(-6deg)}15%{opacity:1;transform:translate(-50%,-50%) scale(1.12) rotate(2deg)}25%{transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-62%)}}
.tk-fly{position:fixed;left:0;top:0;z-index:65;pointer-events:none;will-change:transform}
.tk-rank{display:flex;justify-content:space-between;padding:10px 4px;border-bottom:1px solid var(--tk-line);font-size:18px;font-weight:800}
.tk-rank:first-of-type{color:#2f9a5a}
`;
function css() { if (document.getElementById('tk-css')) return; const s = document.createElement('style'); s.id = 'tk-css'; s.textContent = CSS; document.head.appendChild(s); }
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Bot names for a list of players [{name, bot}] — fresh every game (shared/botnames.js)
function nameBots(ps) {
  const n = ps.filter(p => p.bot).length;
  const names = root.GNBotNames ? root.GNBotNames.pick(n, ps.filter(p => !p.bot).map(p => p.name)) : Array.from({ length: n }, (_, i) => 'Bot ' + (i + 1));
  let k = 0; return ps.map(p => p.bot ? Object.assign({}, p, { name: names[k++] }) : p);
}

// ---------- setup screen ----------
// cfg: { el, title, tagline, prefsKey, minP, maxP, options:[{key,label,desc,type:'toggle'|'seg',choices:[[v,label]]}],
//        defaults, resume:{text, onResume} | null, onStart(players, prefs), rules(), extra (html after the panel) }
function setup(cfg) {
  css();
  const prefs = Object.assign({ mode: 'bots', count: Math.min(cfg.maxP, Math.max(cfg.minP, 4)), level: 'normal', names: [] }, cfg.defaults || {}, store.get(cfg.prefsKey, {}));
  prefs.names = prefs.names || [];
  const save = () => store.set(cfg.prefsKey, prefs);
  const opt = o => o.type === 'toggle'
    ? `<div class="tk-tog"><div><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</div><button class="tk-sw ${prefs[o.key] ? 'on' : ''}" data-opt="${o.key}" aria-label="${esc(o.label)}"></button></div>`
    : `<label class="tk-f">${esc(o.label)}</label><div class="tk-seg" data-optseg="${o.key}">${o.choices.map(([v, l]) => `<button data-v="${v}" class="${String(prefs[o.key]) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>${o.desc ? `<div class="small" style="color:var(--tk-mute);font-size:13px;margin-top:4px">${esc(o.desc)}</div>` : ''}`;
  const groups = {};
  (cfg.options || []).forEach(o => { const g = o.group || 'Options'; (groups[g] = groups[g] || []).push(o); });
  cfg.el.innerHTML = `<div class="tk-wrap">
    <div class="tk-logo">${cfg.title}</div><div class="tk-tag">${esc(cfg.tagline)}</div>
    ${cfg.resume ? `<div class="tk-panel"><h3>Game in progress</h3><div style="color:var(--tk-mute);font-size:14px">${esc(cfg.resume.text)}</div><button class="tk-big" id="tkResume">Continue</button></div>` : ''}
    <div class="tk-panel">
      <h3>New game</h3>
      <label class="tk-f">Mode</label><div class="tk-seg" id="tkMode"><button data-v="bots">Vs bots</button><button data-v="pnp">Pass &amp; play</button></div>
      <label class="tk-f">Players</label><div class="tk-seg" id="tkCount"></div>
      <div id="tkLvl"><label class="tk-f">Bot difficulty</label><div class="tk-seg" id="tkLevel"><button data-v="easy">Easy</button><button data-v="normal">Normal</button><button data-v="hard">Hard</button></div></div>
      <div id="tkNames"></div>
      ${Object.entries(groups).map(([g, os]) => `<label class="tk-f">${esc(g)}</label>${os.map(opt).join('')}`).join('')}
      <button class="tk-big" id="tkGo">Deal</button>
    </div>
    ${cfg.extra || ''}
    <button class="tk-ghost" id="tkRules">How to play</button>
    ${(location.protocol.startsWith('http')) ? '<a class="tk-ghost" href="../index.html">← All games</a>' : ''}
    ${root.GNReport ? '<button class="tk-ghost" id="tkBug">⚑ Report a bug</button>' : ''}
  </div>`;
  const $ = s => cfg.el.querySelector(s);
  const draw = () => {
    prefs.count = Math.max(cfg.minP, Math.min(cfg.maxP, prefs.count));
    $('#tkCount').innerHTML = Array.from({ length: cfg.maxP - cfg.minP + 1 }, (_, k) => `<button data-v="${k + cfg.minP}" class="${prefs.count === k + cfg.minP ? 'on' : ''}">${k + cfg.minP}</button>`).join('');
    $('#tkMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.mode));
    $('#tkLevel').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === prefs.level));
    $('#tkLvl').style.display = prefs.mode === 'bots' ? '' : 'none';
    const n = prefs.mode === 'bots' ? 1 : prefs.count;
    $('#tkNames').innerHTML = `<label class="tk-f">${n > 1 ? 'Names' : 'Your name'}</label>` + Array.from({ length: n }, (_, i) =>
      `<input class="tk-in" data-nm="${i}" maxlength="12" placeholder="${n > 1 ? 'Player ' + (i + 1) : 'You'}" value="${esc(prefs.names[i] || '')}">`).join('')
      + (prefs.mode === 'bots' ? `<div style="color:var(--tk-mute);font-size:13px">${prefs.count - 1} bot${prefs.count > 2 ? 's' : ''}, named fresh each game</div>` : '');
    cfg.el.querySelectorAll('[data-nm]').forEach(inp => inp.oninput = () => { prefs.names[+inp.dataset.nm] = inp.value; save(); });
  };
  const seg = (id, key, num) => $(id).onclick = e => { const b = e.target.closest('button'); if (!b) return; prefs[key] = num ? +b.dataset.v : b.dataset.v; save(); draw(); };
  seg('#tkMode', 'mode'); seg('#tkCount', 'count', true); seg('#tkLevel', 'level');
  cfg.el.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => { const k = b.dataset.opt; prefs[k] = !prefs[k]; b.classList.toggle('on', prefs[k]); save(); });
  cfg.el.querySelectorAll('[data-optseg]').forEach(sg => sg.onclick = e => { const b = e.target.closest('button'); if (!b) return; const k = sg.dataset.optseg; const v = b.dataset.v; prefs[k] = isNaN(+v) ? v : +v; sg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); save(); });
  draw();
  $('#tkGo').onclick = () => {
    const nm = i => String(prefs.names[i] || '').trim();
    const ps = prefs.mode === 'bots'
      ? [{ name: nm(0) || 'You', bot: false }].concat(Array.from({ length: prefs.count - 1 }, () => ({ bot: true, level: prefs.level })))
      : Array.from({ length: prefs.count }, (_, i) => ({ name: nm(i) || 'Player ' + (i + 1), bot: false }));
    cfg.onStart(nameBots(ps), prefs);
  };
  if (cfg.resume) $('#tkResume').onclick = cfg.resume.onResume;
  $('#tkRules').onclick = cfg.rules;
  if ($('#tkBug')) $('#tkBug').onclick = () => root.GNReport.open();
  return prefs;
}

// ---------- overlays ----------
function sheet(html, onOpen) {
  css();
  const s = document.createElement('div'); s.className = 'tk-scrim';
  s.innerHTML = `<div class="tk-sheet"><button class="tk-x" aria-label="Close">×</button>${html}</div>`;
  s.onclick = e => { if (e.target === s || e.target.classList.contains('tk-x')) s.remove(); };
  document.body.appendChild(s); onOpen && onOpen(s); return s;
}
function toast(t, ms) { css(); const d = document.createElement('div'); d.className = 'tk-toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), ms || 2000); }
function banner(t) { css(); let b = document.getElementById('tk-banner'); if (!b) { b = document.createElement('div'); b.id = 'tk-banner'; b.className = 'tk-banner'; document.body.appendChild(b); } b.textContent = t; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
// Full-screen "pass the phone" cover; resolves when the named player taps.
function handoff(name, sub) {
  css();
  return new Promise(res => {
    const d = document.createElement('div'); d.className = 'tk-hand';
    d.innerHTML = `<h2>Pass to ${esc(name)}</h2><p>${esc(sub || 'No peeking at the other hands!')}</p><button class="tk-big">I'm ${esc(name)} — show my cards</button>`;
    d.querySelector('button').onclick = () => { d.remove(); res(); };
    document.body.appendChild(d);
  });
}
// Fly a copy of `html` from one element's box to another's. Resolves when it lands.
function fly(fromEl, toEl, html, ms) {
  if (!fromEl || !toEl) return Promise.resolve();
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  const f = document.createElement('div'); f.className = 'tk-fly'; f.innerHTML = html;
  f.style.width = b.width + 'px'; f.style.height = b.height + 'px';
  document.body.appendChild(f);
  const s0 = a.width / (b.width || 1);
  const anim = f.animate([
    { transform: `translate(${a.left}px,${a.top}px) scale(${s0})` },
    { transform: `translate(${(a.left + b.left) / 2}px,${Math.min(a.top, b.top) - 30}px) scale(${(s0 + 1) / 2 * 1.08}) rotate(${(Math.random() - .5) * 16}deg)`, offset: 0.55 },
    { transform: `translate(${b.left}px,${b.top}px) scale(1)` }], { duration: ms || 380, easing: 'cubic-bezier(.3,.7,.3,1)', transformOrigin: '0 0' });
  f.style.transformOrigin = '0 0';
  return new Promise(r => { anim.onfinish = () => { f.remove(); r(); }; });
}
function shuffle(a, rng) { rng = rng || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

root.TK = { setup, sheet, toast, banner, handoff, fly, store, esc, sleep, shuffle, nameBots, css };
})(typeof window !== 'undefined' ? window : this);
