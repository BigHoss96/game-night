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
  const watched = new WeakSet();
  const watch = sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    // Re-arming (on every click) must not stack a second observer on the same
    // element, or each caption gets logged once per click so far.
    if (watched.has(el)) return true;
    watched.add(el);
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
  .gnr .gnr-note{font-size:12px;color:#8a7f72;margin-top:12px;line-height:1.4}
  .gnr .row{display:flex;gap:8px;margin-top:16px}
  .gnr button{font:inherit;border:0;border-radius:14px;padding:14px;font-size:16px;font-weight:700;cursor:pointer}
  .gnr .go{flex:2;background:linear-gradient(180deg,#5aa0ff,#2f6cf0);color:#fff}
  .gnr .go:disabled{opacity:.5}
  .gnr .no{flex:1;background:#efe6d6;color:#3d362e}
  .gnr .hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
  .gnr .msg{margin-top:12px;padding:12px;border-radius:12px;font-size:14px;line-height:1.4}
  .gnr .msg.ok{background:#e3f6ea;color:#14532d}.gnr .msg.bad{background:#fde8e8;color:#7f1d1d}
  .gnr .big{text-align:center;padding:14px 0 4px}.gnr .big div{font-size:46px}
  .gnr .known{margin-top:14px;border:1.5px solid #e3d8c7;border-radius:14px;background:#fbf6ec;padding:10px 12px}
  .gnr .known h4{margin:0 0 6px;font-size:13px;font-weight:800;color:#3d362e}
  .gnr .known ul{list-style:none;margin:0;padding:0}
  .gnr .known li button{all:unset;box-sizing:border-box;display:flex;gap:8px;align-items:flex-start;width:100%;padding:8px 2px;border-top:1px solid #eee3d2;cursor:pointer;font-size:14px;line-height:1.3;color:#1f1b16}
  .gnr .known li:first-child button{border-top:0}
  .gnr .known .st{flex:none;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:3px 6px;border-radius:6px;color:#fff;margin-top:1px}
  .gnr .known .more{display:block;margin-top:6px;font-size:13px;font-weight:700;color:#2f6cf0;text-decoration:none}
  .gnr .known.hit{border-color:#2f6cf0;background:#eef4ff}
  .gnr .dup{margin-top:10px;padding:10px 12px;border-radius:12px;background:#e3f6ea;color:#14532d;font-size:14px;line-height:1.4}
  .gnr .dup a{color:#14532d;font-weight:700}`;

  let scrim = null;
  function close() { if (scrim) { scrim.remove(); scrim = null; } }

  function open(opts) {
    if (scrim) return;
    const req = !!(opts && opts.kind === 'request');
    if (!document.getElementById('gnr-css')) { const s = document.createElement('style'); s.id = 'gnr-css'; s.textContent = css; document.head.appendChild(s); }
    const hasGame = !req && !!snapshot();
    let name = ''; try { name = localStorage.getItem('gn.reporter') || ''; } catch (_) {}
    scrim = document.createElement('div');
    scrim.className = 'gnr-scrim';
    scrim.innerHTML = `
      <form class="gnr" novalidate>
        ${req ? `
        <h2>Request a game</h2>
        <p>What should go on the shelf next? Austin will look into it.</p>
        <label for="gnr-game">Which game?</label>
        <input type="text" id="gnr-game" maxlength="80" placeholder="e.g. Ticket to Ride, Euchre, Sushi Go">
        <label for="gnr-what">Anything that would help? <span style="text-transform:none;letter-spacing:0;font-weight:500">(optional)</span></label>
        <textarea id="gnr-what" maxlength="4000" placeholder="How it's played, a link to the rules, house rules you use, how many players…"></textarea>` : `
        <h2>Report a bug</h2>
        <p>Something broken, confusing, or against the rules? Tell us what happened.</p>
        <div class="known" hidden></div>
        <div class="match known hit" hidden></div>
        <label for="gnr-what">What happened?</label>
        <textarea id="gnr-what" maxlength="4000" placeholder="e.g. I played a Tap In and the stack didn't clear. I expected it to…"></textarea>`}
        <label for="gnr-name">Your name <span style="text-transform:none;letter-spacing:0;font-weight:500">(optional)</span></label>
        <input type="text" id="gnr-name" maxlength="40" autocomplete="nickname" placeholder="So we know who to thank">
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        ${GN.turnstile ? '<div class="gnr-ts" style="margin-top:14px;min-height:65px"></div>' : ''}
        ${hasGame ? `<div class="chk"><input type="checkbox" id="gnr-snap" checked><label for="gnr-snap" style="all:unset">Include my current game so it can be replayed (player names included)</label></div>` : ''}
        <div class="gnr-note">${req ? 'Requests are posted' : 'Reports are posted'} on this site's public GitHub page, so please don't include private info.${req ? '' : ' Your device and browser type are included automatically.'}</div>
        <div class="msg" hidden></div>
        <div class="row"><button type="button" class="no">Cancel</button><button type="submit" class="go">${req ? 'Send request' : 'Send report'}</button></div>
      </form>`;
    document.body.appendChild(scrim);
    const f = scrim.querySelector('form'), what = f.querySelector('#gnr-what'), nm = f.querySelector('#gnr-name'), gameIn = f.querySelector('#gnr-game');
    const msg = f.querySelector('.msg'), go = f.querySelector('.go');
    nm.value = name;
    scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
    f.querySelector('.no').onclick = close;
    setTimeout(() => (gameIn || what).focus(), 250);
    if (!req) showKnown(f, what);
    // Optional Cloudflare Turnstile bot check (report.config.json → turnstileSiteKey)
    let tsToken = '', tsId = null;
    if (GN.turnstile) loadTurnstile().then(ts => {
      const el = f.querySelector('.gnr-ts'); if (!el || !scrim) return;
      tsId = ts.render(el, { sitekey: GN.turnstile, callback: t => { tsToken = t; }, 'expired-callback': () => { tsToken = ''; }, 'error-callback': () => { tsToken = ''; } });
    }).catch(() => {});

    const show = (kind, html) => { msg.hidden = false; msg.className = 'msg ' + kind; msg.innerHTML = html; };
    f.onsubmit = async e => {
      e.preventDefault();
      const text = what.value.trim();
      const wanted = gameIn ? gameIn.value.trim() : '';
      if (req && wanted.length < 2) { show('bad', 'Which game would you like? Type its name.'); gameIn.focus(); return; }
      if (!req && text.length < 3) { show('bad', 'Add a few words about what went wrong.'); what.focus(); return; }
      try { localStorage.setItem('gn.reporter', nm.value.trim()); } catch (_) {}
      const snapBox = f.querySelector('#gnr-snap');
      const payload = req
        ? { kind: 'request', request: wanted, what: text, name: nm.value.trim(), website: f.website.value, game: 'site', version: GN.version || '', page: location.pathname, time: new Date().toISOString() }
        : { ...details(snapBox ? snapBox.checked : false), what: text, name: nm.value.trim(), website: f.website.value };
      if (GN.turnstile) {
        if (!tsToken) { show('bad', 'One moment — finishing the quick robot check above, then tap Send again.'); return; }
        payload.turnstile = tsToken;
      }
      if (!GN.endpoint) { show('bad', 'Bug reports aren’t switched on for this site yet. Please tell the person who sent you the link.'); return; }
      go.disabled = true; go.textContent = 'Sending…';
      try {
        const res = await fetch(GN.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) throw new Error(j.error || `Error ${res.status}`);
        f.innerHTML = `<div class="big"><div>🙌</div><h2>Thanks — got it!</h2><p>Your ${req ? 'request' : 'report'} ${j.number ? `is #${j.number}` : 'was sent'}. ${req ? 'Austin will look into it.' : "We'll take a look."}</p></div>
          <div class="row"><button type="button" class="go">${req ? 'Done' : 'Back to the game'}</button></div>`;
        f.querySelector('.go').onclick = close;
      } catch (err) {
        go.disabled = false; go.textContent = 'Try again';
        if (tsId !== null && window.turnstile) { tsToken = ''; try { window.turnstile.reset(tsId); } catch (_) {} } // tokens are single-use
        show('bad', `Couldn't send that (${String(err.message || err).replace(/[<>]/g, '')}). Check your connection and try again.`);
      }
    };
  }

  let tsLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!tsLoading) tsLoading = new Promise((ok, fail) => {
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      sc.async = true; sc.onload = () => (window.turnstile ? ok(window.turnstile) : fail()); sc.onerror = () => { tsLoading = null; fail(); };
      document.head.appendChild(sc);
    });
    return tsLoading;
  }

  // --- "Already on our list": open reports for this game, so people don't file duplicates ---
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const issuesPage = () => (GN.base || '') + 'issues.html';
  function showKnown(f, what) {
    const I = window.GNIssues; if (!I) return;
    const box = f.querySelector('.known:not(.match)'), match = f.querySelector('.match');
    const game = GN.game || 'site';
    const row = i => `<li><button type="button" data-n="${i.number}"><span class="st" style="background:${i.status.color}">${esc(i.status.label)}</span><span>${esc(i.title)}</span></button></li>`;
    const dupNote = i => `<div class="dup">✓ <b>#${i.number} is already on our list</b>, so there's no need to send it again. ${i.status.label === 'Fix planned' ? 'A fix is planned — usually within a day.' : 'We\u2019re on it.'} <a href="${esc(i.url)}" target="_blank" rel="noopener">Details</a> · <a href="#" data-close>Close</a><br><span style="font-size:12.5px">Something different, or extra details that might help? Keep typing below.</span></div>`;
    const wire = (el, list) => el.querySelectorAll('button[data-n]').forEach(b => b.onclick = () => {
      const i = list.find(x => x.number === +b.dataset.n);
      const old = el.querySelector('.dup'); if (old) old.remove();
      el.insertAdjacentHTML('beforeend', dupNote(i));
      const c = el.querySelector('[data-close]'); if (c) c.onclick = e => { e.preventDefault(); close(); };
    });
    I.load().then(all => {
      if (!scrim) return;
      const mine = all.filter(i => i.game === game);
      if (mine.length) {
        box.hidden = false;
        box.innerHTML = `<h4>Already reported for ${esc(I.gameName(game))} — is it one of these?</h4><ul>${mine.slice(0, 6).map(row).join('')}</ul>` +
          `<a class="more" href="${issuesPage()}" target="_blank" rel="noopener">See all known issues (${all.length}) ›</a>`;
        wire(box, mine);
      }
      // As they type, point out an existing report that sounds like the same thing
      let t = 0;
      what.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => {
        const best = all.map(i => ({ i, s: I.similarity(what.value, i) })).sort((a, b) => b.s - a.s)[0];
        if (best && best.s >= 2) {
          match.hidden = false;
          match.innerHTML = `<h4>This sounds like a known issue:</h4><ul>${row(best.i)}</ul>`;
          wire(match, [best.i]);
        } else match.hidden = true;
      }, 350); });
    }).catch(() => {});
  }

  // Only show report buttons once the relay is set up (report.config.json → endpoint)
  if (GN.endpoint) window.GNReport = { open, details };
})();
