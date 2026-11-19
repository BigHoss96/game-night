// Update notice shared by every app on the site.
// The service worker serves the cached copy first, so after a fix ships people can keep
// playing an old version without knowing. This checks version.json (written by the build,
// never cached) when an app opens, when you come back to it, and when you start a new game.
//  • Running an old copy → a splash that says so, lists what's been fixed, and refreshes it.
//  • First open after updating → a "what's fixed since your last visit" card (once).
// The build injects window.GN = { game, base, built, games, ... } before this script.
(function () {
  // Changes made after `after` and up to `upTo` (ISO timestamps; either may be missing), newest first
  const changesBetween = (changes, after, upTo) => (changes || [])
    .filter(c => c && c.date && (!after || c.date > after) && (!upTo || c.date <= upTo))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const isNewer = (info, built) => !!(info && info.built && built && info.built > built);
  const pure = { changesBetween, isNewer };
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }

  const GN = window.GN || {};
  const base = GN.base || '', built = GN.built || '';
  if (!built || !/^https?:/.test(location.protocol)) return;
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const gameName = id => (GN.games && GN.games[id]) || (id === 'site' ? 'Home page' : id);

  const css = `
  .gnu-scrim{position:fixed;inset:0;z-index:100000;background:rgba(8,6,12,.66);display:flex;align-items:center;justify-content:center;padding:16px;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;animation:gnufade .2s}
  @keyframes gnufade{from{opacity:0}}
  .gnu{width:100%;max-width:440px;max-height:88dvh;overflow:auto;background:#fffaf2;color:#1f1b16;border-radius:22px;padding:22px 20px 18px;
    box-shadow:0 20px 60px rgba(0,0,0,.45);animation:gnupop .28s cubic-bezier(.2,.9,.3,1.2)}
  @keyframes gnupop{from{transform:scale(.92);opacity:0}}
  .gnu .ic{font-size:40px;line-height:1;text-align:center}
  .gnu h2{margin:8px 0 0;font-size:22px;font-weight:800;letter-spacing:-.01em;text-align:center}
  .gnu p{margin:8px 0 0;color:#5f564b;font-size:14.5px;line-height:1.45;text-align:center}
  .gnu h4{margin:16px 0 6px;font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#7a6f61}
  .gnu ul{list-style:none;margin:0;padding:0;border:1.5px solid #e3d8c7;border-radius:14px;background:#fbf6ec}
  .gnu li{padding:9px 12px;border-top:1px solid #eee3d2;font-size:14px;line-height:1.35}
  .gnu li:first-child{border-top:0}
  .gnu li .g{display:inline-block;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#fff;background:#15803d;border-radius:6px;padding:2px 6px;margin-right:6px;vertical-align:1px}
  .gnu li.here .g{background:#2f6cf0}
  .gnu .how{margin-top:14px;font-size:12.5px;color:#7a6f61;line-height:1.45;background:#f3ecdf;border-radius:12px;padding:10px 12px}
  .gnu .gnu-row{display:flex;gap:8px;margin-top:16px;padding:0;background:none;border:0;box-shadow:none}
  .gnu button{font:inherit;border:0;border-radius:14px;padding:14px;font-size:16px;font-weight:700;cursor:pointer}
  .gnu .go{flex:2;background:linear-gradient(180deg,#5aa0ff,#2f6cf0);color:#fff}
  .gnu .no{flex:1;background:#efe6d6;color:#3d362e}
  .gnu-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);transform:translateX(-50%);z-index:100000;background:#14532d;color:#fff;
    font:600 14px system-ui,sans-serif;padding:10px 16px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.35);animation:gnufade .2s}`;
  let scrim = null;
  function sheet(html) {
    if (!document.getElementById('gnu-css')) { const s = document.createElement('style'); s.id = 'gnu-css'; s.textContent = css; document.head.appendChild(s); }
    if (scrim) scrim.remove();
    scrim = document.createElement('div');
    scrim.className = 'gnu-scrim';
    scrim.innerHTML = `<div class="gnu" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(scrim);
    return scrim;
  }
  const close = () => { if (scrim) { scrim.remove(); scrim = null; } };
  function toast(text) {
    if (!document.getElementById('gnu-css')) { const s = document.createElement('style'); s.id = 'gnu-css'; s.textContent = css; document.head.appendChild(s); }
    const t = document.createElement('div'); t.className = 'gnu-toast'; t.textContent = text;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
  }
  // This game's fixes first, then the rest
  const list = items => {
    const here = GN.game || 'site';
    const sorted = items.filter(c => c.game === here).concat(items.filter(c => c.game !== here));
    const shown = sorted.slice(0, 12);
    return `<ul>${shown.map(c => `<li class="${c.game === here ? 'here' : ''}"><span class="g">${esc(gameName(c.game))}</span>${esc(c.text)}</li>`).join('')}</ul>` +
      (sorted.length > shown.length ? `<p style="font-size:13px">…and ${sorted.length - shown.length} more.</p>` : '');
  };
  const latest = items => items.reduce((m, c) => (c.date > m ? c.date : m), '');
  const markNotified = d => { if (d && d > (ls.get('gn.notifiedUpTo') || '')) ls.set('gn.notifiedUpTo', d); };

  async function refreshNow(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
    try { if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } } catch (_) {}
    try { const r = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } catch (_) {}
    location.reload();
  }

  function showUpdate(info) {
    const items = changesBetween(info.changes, built, info.built);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const s = sheet(`
      <div class="ic">✨</div>
      <h2>A newer version is ready</h2>
      <p>You're playing an older copy saved on this device. Refresh to get the latest${items.length ? ` — ${items.length === 1 ? 'one fix' : items.length + ' fixes'} since your copy` : ''}.</p>
      ${items.length ? `<h4>Fixed since your version</h4>${list(items)}` : ''}
      <div class="how"><b>Refresh</b> takes a second. Your saved games and scores stay on this device.
        If it still looks the same afterwards, ${standalone ? 'close the app completely (swipe it away) and open it again' : 'reload the page once more'}.</div>
      <div class="gnu-row"><button class="no" type="button">Later</button><button class="go" type="button">Refresh now</button></div>`);
    markNotified(latest(items));
    s.querySelector('.go').onclick = e => refreshNow(e.target);
    s.querySelector('.no').onclick = () => { snoozedUntil = Date.now() + 10 * 60 * 1000; close(); };
  }

  function showWhatsNew(info) {
    const seen = ls.get('gn.seenBuilt');
    ls.set('gn.seenBuilt', built > (seen || '') ? built : seen);
    if (!seen || seen >= built) return;               // first visit, or nothing new
    const notified = ls.get('gn.notifiedUpTo') || '';
    const items = changesBetween(info.changes, notified > seen ? notified : seen, built);
    if (!items.length) { if (notified > seen) toast('✓ Updated — you have the latest version'); return; }
    markNotified(latest(items));
    const s = sheet(`
      <div class="ic">🛠️</div>
      <h2>Fixed since your last visit</h2>
      <p>Thanks to everyone who reported bugs — here's what changed.</p>
      ${list(items)}
      <div class="gnu-row"><button class="go" type="button">Let's play</button></div>
      <p style="font-size:12.5px"><a href="${base}issues.html" style="color:#2f6cf0;font-weight:700;text-decoration:none">See known issues ›</a></p>`);
    s.querySelector('.go').onclick = close;
  }

  let lastCheck = 0, snoozedUntil = 0, checking = false;
  async function check(reason) {
    const now = Date.now();
    if (checking || scrim) return;
    if (reason !== 'open' && reason !== 'newgame' && now < snoozedUntil) return;
    if (reason !== 'open' && now - lastCheck < 30 * 1000) return;
    lastCheck = now; checking = true;
    try {
      const r = await fetch(`${base}version.json?t=${now}`, { cache: 'no-store' });
      if (!r.ok) return;
      const info = await r.json();
      if (isNewer(info, built)) showUpdate(info);
      else if (reason === 'open') showWhatsNew(info);
    } catch (_) { /* offline: try again next time */ } finally { checking = false; }
  }

  // When: opening the app, coming back to it, and starting a new game
  const start = () => setTimeout(() => check('open'), 800);
  if (document.readyState === 'complete') start(); else addEventListener('load', start);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check('return'); });
  addEventListener('pageshow', e => { if (e.persisted) check('return'); });
  const NEW_GAME = /\b(new game|play again|rematch|start game|start|new round|next round|deal|restart)\b/i;
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button,a,[role=button]');
    if (b && NEW_GAME.test((b.innerText || b.getAttribute('aria-label') || '').slice(0, 40))) setTimeout(() => check('newgame'), 400);
  }, true);
  window.GNUpdate = { check, refreshNow };
})();
