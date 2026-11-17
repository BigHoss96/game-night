// "Report a bug" sheet shared by every app on the site.
// The build injects window.GN = { game, version, keys, endpoint } before this script.
// Games open it with GNReport.open(). It sends the report to the relay (worker/),
// which files it as a GitHub Issue.
(() => {
  const GN = window.GN || {};
  const events = [], errors = [];
  const keep = (arr, item, max) => { arr.push(item); if (arr.length > max) arr.shift(); };
  const stamp = () => new Date().toTimeString().slice(0, 8);

  // --- collect context quietly in the background ---
  window.addEventListener('error', e => keep(errors, `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`, 10));
  window.addEventListener('unhandledrejection', e => keep(errors, 'Unhandled: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason), 10));
  const origErr = console.error;
  console.error = function (...a) { try { keep(errors, a.map(x => (x && x.stack) || String(x)).join(' '), 10); } catch (_) {} return origErr.apply(this, a); };
  // On-screen captions and toasts make a readable trail of what just happened
  const watch = sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    let last = '';
    new MutationObserver(() => {
      const t = el.innerText.replace(/\s+/g, ' ').trim();
      if (t && t !== last) { last = t; keep(events, `${stamp()} ${t}`, 25); }
    }).observe(el, { childList: true, subtree: true, characterData: true });
    return true;
  };
  const watchAll = () => ['#caption', '#toasts', '#status', '#log', '#toast'].forEach(s => { if (!watch.done) watch.done = {}; if (!watch.done[s] && watch(s)) watch.done[s] = 1; });
  document.addEventListener('DOMContentLoaded', watchAll);
  setTimeout(watchAll, 1500);
  // #caption is rebuilt with the table in some games, so re-arm on clicks too
  document.addEventListener('click', () => { if (watch.done) delete watch.done['#caption']; watchAll(); }, true);

  function snapshot() {
    const out = {};
    (GN.keys || []).forEach(k => { try { const v = localStorage.getItem(k); if (v) out[k] = JSON.parse(v); } catch (_) {} });
    return Object.keys(out).length ? out : null;
  }
  function details(includeGame) {
    return {
      game: GN.game || 'site',
      version: GN.version || '',
      page: location.pathname,
      device: navigator.userAgent,
      screen: `${innerWidth}x${innerHeight} @${devicePixelRatio || 1}x`,
      standalone: matchMedia('(display-mode: standalone)').matches || !!navigator.standalone,
      time: new Date().toISOString(),
      events: events.slice(),
      errors: errors.slice(),
      snapshot: includeGame ? snapshot() : null,
    };
  }

  // --- the sheet ---
  const css = `
  .gnr-scrim{position:fixed;inset:0;z-index:99999;background:rgba(8,6,12,.62);display:flex;align-items:flex-end;justify-content:center;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;animation:gnrfade .18s}
  @keyframes gnrfade{from{opacity:0}}
  .gnr{width:100%;max-width:520px;max-height:92dvh;overflow:auto;background:#fffaf2;color:#1f1b16;border-radius:22px 22px 0 0;
    padding:20px 18px calc(env(safe-area-inset-bottom,0px) + 18px);box-shadow:0 -10px 40px rgba(0,0,0,.35);animation:gnrup .25s cubic-bezier(.2,.9,.3,1)}
  @keyframes gnrup{from{transform:translateY(30%)}}
  .gnr h2{margin:0;font-size:22px;font-weight:800;letter-spacing:-.01em}
  .gnr p{margin:6px 0 0;color:#6b6157;font-size:14px;line-height:1.4}
  .gnr label{display:block;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#7a6f61;margin:16px 0 6px}
  .gnr textarea,.gnr input[type=text]{width:100%;box-sizing:border-box;border:1.5px solid #e3d8c7;border-radius:12px;background:#f7f1e6;color:#1f1b16;
    font:inherit;font-size:16px;padding:11px 12px;outline:none}
  .gnr textarea{min-height:110px;resize:vertical}
  .gnr textarea:focus,.gnr input[type=text]:focus{border-color:#2f6cf0}
  .gnr .chk{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-size:14px;color:#3d362e;line-height:1.35}
  .gnr .chk input{width:20px;height:20px;margin:0;flex:none;accent-color:#2f6cf0}
  .gnr .note{font-size:12px;color:#8a7f72;margin-top:12px;line-height:1.4}
  .gnr .row{display:flex;gap:8px;margin-top:16px}
  .gnr button{font:inherit;border:0;border-radius:14px;padding:14px;font-size:16px;font-weight:700;cursor:pointer}
  .gnr .go{flex:2;background:linear-gradient(180deg,#5aa0ff,#2f6cf0);color:#fff}
  .gnr .go:disabled{opacity:.5}
  .gnr .no{flex:1;background:#efe6d6;color:#3d362e}
  .gnr .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
  .gnr .msg{margin-top:12px;padding:12px;border-radius:12px;font-size:14px;line-height:1.4}
  .gnr .msg.ok{background:#e3f6ea;color:#14532d}.gnr .msg.bad{background:#fde8e8;color:#7f1d1d}
  .gnr .big{text-align:center;padding:14px 0 4px}.gnr .big div{font-size:46px}`;

  let scrim = null;
  function close() { if (scrim) { scrim.remove(); scrim = null; } }

  function open() {
    if (scrim) return;
    if (!document.getElementById('gnr-css')) { const s = document.createElement('style'); s.id = 'gnr-css'; s.textContent = css; document.head.appendChild(s); }
    const hasGame = !!snapshot();
    let name = ''; try { name = localStorage.getItem('gn.reporter') || ''; } catch (_) {}
    scrim = document.createElement('div');
    scrim.className = 'gnr-scrim';
    scrim.innerHTML = `
      <form class="gnr" novalidate>
        <h2>Report a bug</h2>
        <p>Something broken, confusing, or against the rules? Tell us what happened.</p>
        <label for="gnr-what">What happened?</label>
        <textarea id="gnr-what" maxlength="4000" placeholder="e.g. I played a Tap In and the stack didn't clear. I expected it to…"></textarea>
        <label for="gnr-name">Your name <span style="text-transform:none;letter-spacing:0;font-weight:500">(optional)</span></label>
        <input type="text" id="gnr-name" maxlength="40" autocomplete="nickname" placeholder="So we know who to thank">
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        ${hasGame ? `<div class="chk"><input type="checkbox" id="gnr-snap" checked><label for="gnr-snap" style="all:unset">Include my current game so it can be replayed (player names included)</label></div>` : ''}
        <div class="note">Reports are posted on this site's public GitHub page, so please don't include private info. Your device and browser type are included automatically.</div>
        <div class="msg" hidden></div>
        <div class="row"><button type="button" class="no">Cancel</button><button type="submit" class="go">Send report</button></div>
      </form>`;
    document.body.appendChild(scrim);
    const f = scrim.querySelector('form'), what = f.querySelector('#gnr-what'), nm = f.querySelector('#gnr-name');
    const msg = f.querySelector('.msg'), go = f.querySelector('.go');
    nm.value = name;
    scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
    f.querySelector('.no').onclick = close;
    setTimeout(() => what.focus(), 250);

    const show = (kind, html) => { msg.hidden = false; msg.className = 'msg ' + kind; msg.innerHTML = html; };
    f.onsubmit = async e => {
      e.preventDefault();
      const text = what.value.trim();
      if (text.length < 3) { show('bad', 'Add a few words about what went wrong.'); what.focus(); return; }
      try { localStorage.setItem('gn.reporter', nm.value.trim()); } catch (_) {}
      const snapBox = f.querySelector('#gnr-snap');
      const payload = { ...details(snapBox ? snapBox.checked : false), what: text, name: nm.value.trim(), website: f.website.value };
      if (!GN.endpoint) { show('bad', 'Bug reports aren’t switched on for this site yet. Please tell the person who sent you the link.'); return; }
      go.disabled = true; go.textContent = 'Sending…';
      try {
        const res = await fetch(GN.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) throw new Error(j.error || `Error ${res.status}`);
        f.innerHTML = `<div class="big"><div>🙌</div><h2>Thanks — got it!</h2><p>Your report ${j.number ? `is #${j.number}` : 'was sent'}. We'll take a look.</p></div>
          <div class="row"><button type="button" class="go">Back to the game</button></div>`;
        f.querySelector('.go').onclick = close;
      } catch (err) {
        go.disabled = false; go.textContent = 'Try again';
        show('bad', `Couldn't send that (${String(err.message || err).replace(/[<>]/g, '')}). Check your connection and try again.`);
      }
    };
  }

  // Only show report buttons once the relay is set up (report.config.json → endpoint)
  if (GN.endpoint) window.GNReport = { open, details };
})();
