// Game Night bug-report relay — a Cloudflare Worker.
// The website POSTs a report here; this files it as a GitHub Issue in your repo.
// It holds the GitHub token so the public website never has to.
//
// Settings (Cloudflare dashboard → your worker → Settings → Variables and Secrets):
//   GITHUB_TOKEN    (Secret)  fine-grained token: game-night repo only, Issues: Read and write
//   REPO            (Text)    BigHoss96/game-night
//   ALLOWED_ORIGINS (Text)    https://bighoss96.github.io   (comma-separate to add more)
//   HOURLY_CAP      (Text)    optional: most reports filed per hour, site-wide (default 20)
//   TURNSTILE_SECRET (Secret) optional: Cloudflare Turnstile secret key. When set, every report
//                             must pass the bot check (also put the site key in report.config.json)

// Only these ids are accepted as a game (and become a game:<id> label); anything else is filed as 'site'.
export const GAME_NAMES = {
  flip7: 'Flip 7', tap4: 'Tap 4', mahj: 'Mahj', tally: 'Tally', doomlings: 'Doomlings', yahtzee: 'Yahtzee',
  farkle: 'Farkle', uno: 'Uno', phase10: 'Phase 10', skipbo: 'Skip-Bo', paydirt: 'Paydirt', site: 'Home page',
};
const LIMIT = { perWindow: 10, windowMs: 10 * 60 * 1000 }; // per visitor, best effort
const hits = new Map();

export default {
  async fetch(req, env) {
    const allowed = String(env.ALLOWED_ORIGINS || 'https://bighoss96.github.io').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET') return reply({ ok: true, service: 'game-night bug reports', configured: !!(env.GITHUB_TOKEN && env.REPO) });
    if (req.method !== 'POST') return reply({ error: 'Use POST' }, 405);
    if (!allowed.includes(origin)) return reply({ error: 'This site is not allowed to send reports' }, 403);
    if (!env.GITHUB_TOKEN || !env.REPO) return reply({ error: 'Bug reports are not configured yet' }, 503);

    // Best-effort rate limit (per Cloudflare instance)
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < LIMIT.windowMs);
    if (recent.length >= LIMIT.perWindow) return reply({ error: 'Too many reports — try again in a few minutes' }, 429);
    recent.push(now); hits.set(ip, recent);

    let b;
    try {
      const text = await req.text();
      if (text.length > 250000) return reply({ error: 'Report too large' }, 413);
      b = JSON.parse(text);
    } catch (e) { return reply({ error: 'Bad request' }, 400); }

    if (b.website) return reply({ ok: true, number: 0 }); // honeypot field: bots fill it, people never see it

    const isRequest = b.kind === 'request';
    const issue = isRequest ? buildRequest(b) : buildIssue(b);
    if (!issue) return reply({ error: isRequest ? 'Please name the game you\u2019d like' : 'Please describe what went wrong' }, 400);

    // Bot check (only when a Turnstile secret is configured). The Origin header above can be
    // faked by any script, so this is what actually proves a real visitor sent the report.
    if (env.TURNSTILE_SECRET) {
      const form = new FormData();
      form.append('secret', env.TURNSTILE_SECRET);
      form.append('response', String(b.turnstile || ''));
      if (ip !== 'unknown') form.append('remoteip', ip);
      let pass = false;
      try {
        const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
        pass = !!(await v.json()).success;
      } catch (e) { pass = false; }
      if (!pass) return reply({ error: 'The robot check didn\u2019t go through — please try again' }, 403);
    }

    const api = `https://api.github.com/repos/${env.REPO}/issues`;
    const headers = {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'game-night-bug-reports',
      'Content-Type': 'application/json',
    };

    // Site-wide cap. The per-visitor limit above lives in one Cloudflare server's memory and is easy
    // to dodge, so also count the reports GitHub already has from the last hour. Works with no setup.
    const cap = Math.max(1, parseInt(env.HOURLY_CAP, 10) || 20);
    try {
      const since = new Date(now - 60 * 60 * 1000).toISOString();
      const q = await fetch(`${api}?state=all&since=${encodeURIComponent(since)}&per_page=100`, { headers });
      if (q.ok) {
        const fromSite = i => (i.labels || []).some(l => ['bug-report', 'game-request'].includes(l.name || l));
        const recentIssues = (await q.json()).filter(i => !i.pull_request && i.created_at >= since && fromSite(i));
        if (recentIssues.length >= cap) return reply({ error: 'Lots of reports are coming in right now — please try again in an hour' }, 429);
      }
    } catch (e) { /* if GitHub can't be asked, don't block real reports */ }

    let res = await fetch(api, { method: 'POST', headers, body: JSON.stringify(issue) });
    if (res.status === 422) { // a label can be refused; keep the main one so the hourly cap still counts it
      res = await fetch(api, { method: 'POST', headers, body: JSON.stringify({ ...issue, labels: issue.labels.slice(0, 1) }) });
    }
    if (res.status === 422) { // labels refused entirely; file it without them
      const { labels, ...plain } = issue;
      res = await fetch(api, { method: 'POST', headers, body: JSON.stringify(plain) });
    }
    if (!res.ok) return reply({ error: `GitHub refused the report (${res.status})` }, 502);
    const made = await res.json();
    return reply({ ok: true, number: made.number });
  },
};

// ---------- formatting ----------
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
// User text goes inside a ~~~ fence so it can't @mention people, add links or inject HTML.
const fenceSafe = s => String(s ?? '').replace(/~~~/g, '~ ~ ~').replace(/```/g, "'''");
const oneLine = s => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/[`<>@|]/g, '').trim();

export function buildIssue(b) {
  const what = clip(String(b.what || '').trim(), 4000);
  if (what.length < 3) return null;
  const game = Object.prototype.hasOwnProperty.call(GAME_NAMES, b.game) ? b.game : 'site';
  const gname = GAME_NAMES[game];
  const who = clip(oneLine(b.name), 40);
  const first = clip(oneLine(what.split('\n')[0]), 70) || 'Bug report';

  const rows = [
    ['Game', gname],
    ['Reported by', who || 'anonymous'],
    ['Site version', clip(oneLine(b.version), 40)],
    ['Page', clip(oneLine(b.page), 120)],
    ['Device', clip(oneLine(b.device), 200)],
    ['Screen', clip(oneLine(b.screen), 40)],
    ['Installed app', b.standalone ? 'yes' : 'no'],
    ['Time', clip(oneLine(b.time), 40)],
  ].filter(r => r[1]);

  // Details go in a text fence too: in a markdown table, a "name" like [Download fix](https://…)
  // would render as a real link on the public issue.
  let body = `### What happened\n~~~text\n${fenceSafe(what)}\n~~~\n\n### Details\n~~~text\n${fenceSafe(rows.map(r => `${r[0]}: ${r[1]}`).join('\n'))}\n~~~\n`;

  const events = Array.isArray(b.events) ? b.events.slice(-25).map(e => clip(oneLine(e), 160)).filter(Boolean) : [];
  if (events.length) body += `\n### Last things that happened on screen\n~~~text\n${fenceSafe(events.join('\n'))}\n~~~\n`;

  const errors = Array.isArray(b.errors) ? b.errors.slice(-10).map(e => clip(String(e), 600)) : [];
  if (errors.length) body += `\n### Errors caught\n~~~text\n${fenceSafe(errors.join('\n\n'))}\n~~~\n`;

  if (b.snapshot && typeof b.snapshot === 'object') {
    let snap = JSON.stringify(b.snapshot);
    if (snap.length > 45000) snap = snap.slice(0, 45000) + ' …(truncated)';
    body += `\n<details><summary>Saved game snapshot (for reproducing the bug)</summary>\n\n~~~json\n${fenceSafe(snap)}\n~~~\n</details>\n`;
  }
  body = clip(body, 64000);

  return {
    title: `[${gname}] ${first}`,
    body,
    labels: ['bug-report', `game:${game}`],
  };
}

// A "Request a game" submission from the home page → a feature request issue.
export function buildRequest(b) {
  const wanted = clip(oneLine(b.request), 80);
  if (wanted.length < 2) return null;
  const notes = clip(String(b.what || '').trim(), 4000);
  const rows = [
    ['Requested by', clip(oneLine(b.name), 40) || 'anonymous'],
    ['Site version', clip(oneLine(b.version), 40)],
    ['Time', clip(oneLine(b.time), 40)],
  ].filter(r => r[1]);
  let body = `### Game requested\n~~~text\n${fenceSafe(wanted)}\n~~~\n`;
  if (notes) body += `\n### Notes from the requester\n~~~text\n${fenceSafe(notes)}\n~~~\n`;
  body += `\n### Details\n~~~text\n${fenceSafe(rows.map(r => `${r[0]}: ${r[1]}`).join('\n'))}\n~~~\n`;
  body += `\n### To figure out\n- [ ] Rules source and any publisher/IP concerns\n- [ ] Player count, bots needed?\n- [ ] Fits an existing engine (tablekit, dice3d) or needs a new one\n`;
  return { title: `[Game request] ${wanted}`, body: clip(body, 64000), labels: ['game-request', 'enhancement'] };
}
