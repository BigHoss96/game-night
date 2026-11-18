// Known issues: the open bug reports (GitHub Issues labeled bug-report), read straight from
// GitHub's public API so players can see what's already reported before filing a duplicate.
// Used by the report sheet (report.js) and the Known issues page (issues.html).
// The build injects window.GN = { game, base, repo, games, ... } before this script.
(function () {
  const STATUS = [ // first matching label wins
    ['fix-planned', 'Fix planned', '#1d4ed8'],
    ['fix-in-review', 'Fix waiting for review', '#7c3aed'],
    ['needs-info', 'Needs more details', '#b45309'],
  ];
  const STOP = new Set('the a an and or but to of in on at it is was i my me you your when if then that this with for not dont doesnt didnt cant its im be as so just have has had are were do did game card cards play played'.split(' '));

  const cleanTitle = t => String(t || '').replace(/^\[[^\]]*\]\s*/, '').trim();
  const gameOf = issue => {
    const l = (issue.labels || []).map(x => typeof x === 'string' ? x : x.name).find(n => /^game:/.test(n));
    return l ? l.slice(5) : 'site';
  };
  const statusOf = issue => {
    const names = (issue.labels || []).map(x => typeof x === 'string' ? x : x.name);
    const s = STATUS.find(([l]) => names.includes(l));
    return s ? { label: s[1], color: s[2] } : { label: 'Reported', color: '#6b6157' };
  };
  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
  // How much a draft report overlaps an existing issue's title (shared meaningful words)
  const similarity = (text, issue) => {
    const a = new Set(words(text)), b = new Set(words(cleanTitle(issue.title)));
    let n = 0; b.forEach(w => { if (a.has(w)) n++; });
    return n;
  };
  const simplify = list => (list || [])
    .filter(i => !i.pull_request)
    .map(i => ({ number: i.number, title: cleanTitle(i.title), game: gameOf(i), status: statusOf(i), url: i.html_url, created: i.created_at, labels: (i.labels || []).map(x => x.name || x) }));

  const pure = { cleanTitle, gameOf, statusOf, similarity, simplify };
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }

  const GN = window.GN || {};
  const repo = GN.repo || 'BigHoss96/game-night';
  const KEY = 'gn.knownIssues', TTL = 5 * 60 * 1000;
  let pending = null;
  // Open bug reports, cached for 5 minutes so we stay well under GitHub's anonymous rate limit
  function load(force) {
    if (!force) {
      try { const c = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (c && Date.now() - c.at < TTL) return Promise.resolve(c.list); } catch (_) {}
    }
    if (pending) return pending;
    pending = fetch(`https://api.github.com/repos/${repo}/issues?state=open&labels=bug-report&per_page=100`, { headers: { Accept: 'application/vnd.github+json' } })
      .then(r => { if (!r.ok) throw new Error('GitHub ' + r.status); return r.json(); })
      .then(j => { const list = simplify(j); try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), list })); } catch (_) {} return list; })
      .finally(() => { pending = null; });
    return pending;
  }
  const gameName = id => (GN.games && GN.games[id]) || id;
  window.GNIssues = { load, gameName, ...pure };
})();
