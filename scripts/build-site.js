// Builds the static website into _site/ — one folder per game, each installable as its own app.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, '_site');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const { execSync } = require('child_process');
const reportCfg = JSON.parse(read('report.config.json'));
let version = (process.env.GITHUB_SHA || '').slice(0, 7);
if (!version) { try { version = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch (e) { version = 'local'; } }
version += ' ' + new Date().toISOString().slice(0, 10);
// built: exact build time. The update notice compares it with version.json to spot old cached copies,
// and lists changelog.json entries dated after it as "fixed since your version".
const built = new Date().toISOString();
const changelog = JSON.parse(read('changelog.json'));
// Saved-game keys each app keeps in localStorage — attached to bug reports so bugs can be replayed
const SAVE_KEYS = {
  flip7: ['flip7.save.v1', 'flip7.prefs.v1'],
  tap4: ['tap4.save.v1', 'tap4.prefs.v1'],
  mahj: ['mahj-settings', 'mahj-scores', 'mahj-dealer', 'mahj-names'],
  tally: ['tally-v1'],
  doomlings: [],   // no saved games yet
  paydirt: ['paydirt.save.v1', 'paydirt.prefs.v1'],
  uno: ['uno.save.v1', 'uno.prefs.v1'],
  phase10: ['phase10.save.v1', 'phase10.prefs.v1'],
  skipbo: ['skipbo.save.v1', 'skipbo.prefs.v1'],
  yahtzee: ['yahtzee.save.v1', 'yahtzee.prefs.v1', 'yahtzee.best.v1'],
  farkle: ['farkle.save.v1', 'farkle.prefs.v1'],
  monopoly: ['monopoly.save.v1', 'monopoly.prefs.v1'],
  site: [],
};
const reportTags = (game, prefix) =>
  `<script>window.GN=${JSON.stringify({ game, version, built, base: prefix, repo: 'BigHoss96/game-night', games: GAME_NAMES, keys: SAVE_KEYS[game] || [], endpoint: reportCfg.endpoint || '', turnstile: reportCfg.turnstileSiteKey || '' })};</script>\n` +
  ['known-issues.js', 'report.js', 'update.js'].map(f => `<script src="${prefix}${f}?v=${built.replace(/\D/g, '')}"></script>\n`).join('');

// fit: the virtual screen a game lays its table out on when played on a desktop; it's scaled up
// (at most `max`×) to fill the window. Games without fit just use their desktop.css at normal size.
const TABLE_FIT = { w: 960, h: 600, max: 1.75 };
const GAMES = [
  { id: 'flip7', name: 'Flip 7', fit: TABLE_FIT, color: '#15122a', bg: '#1b110b', build: () => read('games/flip7/src.html').replace('/*ENGINE*/', read('games/flip7/engine.js')) },
  { id: 'tap4', name: 'Tap 4', fit: { w: 960, h: 700, max: 1.6 } /* taller: its tray has two card rows */, color: '#1b110b', bg: '#1b110b', build: () => read('games/tap4/src.html').replace('/*ENGINE*/', read('games/tap4/engine.js')).replace('/*APP*/', read('games/tap4/app.js')) },
  { id: 'mahj', name: 'Mahj', fit: { w: 1100, h: 680, max: 1.6 }, color: '#0f3f22', bg: '#0d3a26', build: () => read('games/mahj/index.html') },
  { id: 'tally', name: 'Tally', color: '#f4efe6', bg: '#f4efe6', build: () => read('games/tally/index.html') },
  // testing: true → listed only on testing.html (not the home page), kept out of search engines
  { id: 'doomlings', name: 'Doomlings', color: '#131219', bg: '#131219', build: () => read('games/doomlings/index.html') },
  { id: 'yahtzee', name: 'Yahtzee', color: '#14213d', bg: '#14213d', build: () => read('games/yahtzee/src.html').replace('/*DICE3D*/', () => read('shared/dice3d.js')).replace('/*ENGINE*/', () => read('games/yahtzee/engine.js')) },
  { id: 'farkle', name: 'Farkle', color: '#3b1d12', bg: '#3b1d12', build: () => read('games/farkle/src.html').replace('/*DICE3D*/', () => read('shared/dice3d.js')).replace('/*ENGINE*/', () => read('games/farkle/engine.js')) },
  { id: 'uno', name: 'Uno', color: '#7a1010', bg: '#7a1010', build: () => read('games/uno/src.html').replace('/*TABLEKIT*/', () => read('shared/tablekit.js')).replace('/*ENGINE*/', () => read('games/uno/engine.js')) },
  { id: 'phase10', name: 'Phase 10', color: '#13275e', bg: '#13275e', build: () => read('games/phase10/src.html').replace('/*TABLEKIT*/', () => read('shared/tablekit.js')).replace('/*ENGINE*/', () => read('games/phase10/engine.js')) },
  { id: 'skipbo', name: 'Skip-Bo', color: '#0b4a52', bg: '#0b4a52', build: () => read('games/skipbo/src.html').replace('/*TABLEKIT*/', () => read('shared/tablekit.js')).replace('/*ENGINE*/', () => read('games/skipbo/engine.js')) },
  { id: 'monopoly', name: 'Monopoly', testing: true, color: '#123d2a', bg: '#123d2a', build: () => read('games/monopoly/src.html').replace('/*TABLEKIT*/', () => read('shared/tablekit.js')).replace('/*ENGINE*/', () => read('games/monopoly/engine.js')) },
  { id: 'paydirt', name: 'Paydirt', testing: true, color: '#1f3d24', bg: '#1f3d24', build: () => read('games/paydirt/src.html').replace('/*TEAMS*/', () => read('games/paydirt/teams.js')).replace('/*ENGINE*/', () => read('games/paydirt/engine.js')) },
];
const GAME_NAMES = Object.fromEntries(GAMES.map(g => [g.id, g.name]).concat([['site', 'Home page']]));
const NOINDEX = '<meta name="robots" content="noindex">\n';
// Desktop/mobile switch (shared/layout.js) + each game's games/<id>/desktop.css, inlined so there's no flash
const LAYOUT_JS = read('shared/layout.js');
const BOTNAMES_JS = read('shared/botnames.js');
const layoutTags = g => `<script>window.GN_FIT=${JSON.stringify(g.fit || null)};\n${LAYOUT_JS}</script>\n<script>${BOTNAMES_JS}</script>\n`;
const desktopCss = g => { const f = `games/${g.id}/desktop.css`; return fs.existsSync(path.join(root, f)) ? `<style>\n${read(f)}</style>\n` : ''; };

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

// site shell + icons
for (const f of fs.readdirSync(path.join(root, 'site'))) fs.copyFileSync(path.join(root, 'site', f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'icons'))) fs.copyFileSync(path.join(root, 'icons', f), path.join(out, 'icons', f));
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
  name: 'Game Night', short_name: 'Game Night', start_url: './', scope: './', display: 'standalone',
  background_color: '#1b110b', theme_color: '#1b110b',
  icons: [192, 512].map(s => ({ src: `icons/site-${s}.png`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' })),
}, null, 2));

for (const g of GAMES) {
  const dir = path.join(out, g.id);
  fs.mkdirSync(dir, { recursive: true });
  let html = g.build();
  const head = (g.testing ? NOINDEX : '') + layoutTags(g) + reportTags(g.id, '../') + `<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="../icons/${g.id}-192.png">\n<link rel="apple-touch-icon" href="../icons/${g.id}-180.png">\n`;
  html = html.replace(/<\/title>/i, m => m + '\n' + head);
  html = html.replace(/<\/head>/i, m => desktopCss(g) + m);   // after the game's own styles so desktop rules win
  // "Continue" on the home page links to <game>/index.html#continue: press the game's own resume button
  const cont = `<script>(function(){if(location.hash!=='#continue')return;history.replaceState(null,'',location.pathname+location.search);var n=0;(function go(){var b=document.querySelector('#tkResume,#resume,#resumeBtn');if(b)b.click();else if(++n<40)setTimeout(go,50);})();})();</script>\n`;
  const sw = cont + `<script>if('serviceWorker' in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('../sw.js',{scope:'../'}).catch(()=>{});</script>\n`;
  const i = html.lastIndexOf('</body>');
  html = html.slice(0, i) + sw + html.slice(i);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify({
    name: g.name, short_name: g.name, start_url: './', scope: './', display: 'standalone',
    background_color: g.bg, theme_color: g.color,
    icons: [192, 512].map(s => ({ src: `../icons/${g.id}-${s}.png`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' })),
  }, null, 2));
}
// home page and testing area get the report sheet too
for (const page of ['index.html', 'classic.html', 'testing.html', 'issues.html']) {
  const f = path.join(out, page);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/<\/title>/i, m => m + '\n' + reportTags('site', '')));
}
// version.json: what the newest build is + recent fixes. Fetched fresh (never cached) by update.js and issues.html.
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({
  version, built, changes: changelog.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 80),
}, null, 1));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('Built _site/ with', GAMES.map(g => g.id + (g.testing ? ' (testing)' : '')).join(', '));
