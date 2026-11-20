// Offline support: serve from cache instantly, refresh the cache in the background.
const CACHE = 'gamenight-v5';
const CORE = ['./', './index.html', './flip7/', './tap4/', './mahj/', './yahtzee/', './farkle/', './tally/', './report.js', './known-issues.js', './update.js', './issues.html', './icons/cover-flip7.svg', './icons/cover-tap4.svg', './icons/cover-yahtzee.svg', './icons/cover-farkle.svg', './icons/cover-mahj.svg', './icons/cover-doomlings.svg', './icons/cover-paydirt.svg', './icons/cover-tally.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !fonts) return;
  if (sameOrigin && /\/version\.json$/.test(url.pathname)) return; // always ask the network: it's how old copies find out they're old
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
