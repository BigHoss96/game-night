// Builds the static website into _site/ — one folder per game, each installable as its own app.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, '_site');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const GAMES = [
  { id: 'flip7', name: 'Flip 7', color: '#15122a', bg: '#1b110b', build: () => read('games/flip7/src.html').replace('/*ENGINE*/', read('games/flip7/engine.js')) },
  { id: 'tap4', name: 'Tap 4', color: '#1b110b', bg: '#1b110b', build: () => read('games/tap4/src.html').replace('/*ENGINE*/', read('games/tap4/engine.js')).replace('/*APP*/', read('games/tap4/app.js')) },
  { id: 'mahj', name: 'Mahj', color: '#0f3f22', bg: '#0d3a26', build: () => read('games/mahj/index.html') },
  { id: 'tally', name: 'Tally', color: '#f4efe6', bg: '#f4efe6', build: () => read('games/tally/index.html') },
];

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
  const head = `<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="../icons/${g.id}-192.png">\n<link rel="apple-touch-icon" href="../icons/${g.id}-180.png">\n`;
  html = html.replace(/<\/title>/i, m => m + '\n' + head);
  const sw = `<script>if('serviceWorker' in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('../sw.js',{scope:'../'}).catch(()=>{});</script>\n`;
  const i = html.lastIndexOf('</body>');
  html = html.slice(0, i) + sw + html.slice(i);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify({
    name: g.name, short_name: g.name, start_url: './', scope: './', display: 'standalone',
    background_color: g.bg, theme_color: g.color,
    icons: [192, 512].map(s => ({ src: `../icons/${g.id}-${s}.png`, sizes: `${s}x${s}`, type: 'image/png', purpose: 'any' })),
  }, null, 2));
}
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('Built _site/ with', GAMES.map(g => g.id).join(', '));
