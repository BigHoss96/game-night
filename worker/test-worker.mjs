// Tests the relay with GitHub's API faked out. Run: node worker/test-worker.mjs
import assert from 'node:assert';
import worker, { buildIssue } from './bug-report-worker.js';

const ORIGIN = 'https://bighoss96.github.io';
const env = { GITHUB_TOKEN: 'test-token', REPO: 'BigHoss96/game-night', ALLOWED_ORIGINS: ORIGIN };
let calls = [], status = 201, recent = [], tsOk = true, verifies = [];
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).includes('siteverify')) { verifies.push(opts.body.get('response')); return new Response(JSON.stringify({ success: tsOk })); }
  if (!opts.method || opts.method === 'GET') return new Response(JSON.stringify(recent), { status: 200 }); // hourly-cap lookup
  calls.push({ url, opts, body: JSON.parse(opts.body) });
  const s = typeof status === 'function' ? status(calls.length) : status;
  return new Response(JSON.stringify({ number: 42 }), { status: s });
};
const post = (body, origin = ORIGIN, ip = '1.1.1.1') => worker.fetch(new Request('https://w.example/', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: typeof body === 'string' ? body : JSON.stringify(body),
}), env);
const report = { game: 'flip7', what: 'Bot froze after Flip Three\n@everyone look', name: 'Kate @here', version: 'abc123', page: '/flip7/', device: 'Android Chrome', screen: '412x915',
  events: ['Rosie flips a 7', 'Gus busts!'], errors: ['TypeError: x is undefined'], snapshot: { round: 3, deck: [1, 2, 3], note: 'has ``` and ~~~ inside' }, time: '2026-11-17T20:00Z' };

(async () => {
  // happy path
  let r = await post(report); let j = await r.json();
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(j, { ok: true, number: 42 });
  const c = calls[0];
  assert.strictEqual(c.url, 'https://api.github.com/repos/BigHoss96/game-night/issues');
  assert.strictEqual(c.opts.headers.Authorization, 'Bearer test-token');
  assert.strictEqual(c.body.title, '[Flip 7] Bot froze after Flip Three');
  assert.deepStrictEqual(c.body.labels, ['bug-report', 'game:flip7']);
  assert(c.body.body.includes('~~~text\nBot froze after Flip Three\n@everyone look\n~~~'), 'user text fenced');
  assert(c.body.body.includes('Reported by: Kate here'), 'name sanitized');
  assert(/### Details\n~~~text\nGame: Flip 7\n/.test(c.body.body), 'details fenced');
  assert(c.body.body.includes('Saved game snapshot'));
  assert(!/```/.test(c.body.body.split('<details>')[1]), 'no stray code fences from snapshot');
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);

  // CORS preflight + health check
  r = await worker.fetch(new Request('https://w.example/', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
  assert.strictEqual(r.status, 204);
  r = await worker.fetch(new Request('https://w.example/'), env); j = await r.json();
  assert.strictEqual(j.configured, true);

  // other sites rejected
  calls = [];
  r = await post(report, 'https://evil.example', '2.2.2.2');
  assert.strictEqual(r.status, 403); assert.strictEqual(calls.length, 0);

  // empty description rejected; honeypot silently dropped
  r = await post({ game: 'tap4', what: ' ' }, ORIGIN, '3.3.3.3'); assert.strictEqual(r.status, 400);
  r = await post({ game: 'tap4', what: 'spam spam', website: 'http://spam' }, ORIGIN, '3.3.3.3');
  assert.strictEqual(r.status, 200); assert.strictEqual(calls.length, 0);

  // bad JSON
  r = await post('{nope', ORIGIN, '4.4.4.4'); assert.strictEqual(r.status, 400);

  // label refusal → retried with just bug-report, then without labels
  calls = []; status = n => (n === 1 ? 422 : 201);
  r = await post({ game: 'mahj', what: 'Joker swap missing' }, ORIGIN, '5.5.5.5');
  assert.strictEqual(r.status, 200); assert.strictEqual(calls.length, 2); assert.deepStrictEqual(calls[1].body.labels, ['bug-report']);
  calls = []; status = n => (n <= 2 ? 422 : 201);
  r = await post({ game: 'mahj', what: 'Joker swap missing again' }, ORIGIN, '5.5.5.5');
  assert.strictEqual(r.status, 200); assert.strictEqual(calls.length, 3); assert.strictEqual(calls[2].body.labels, undefined);
  status = 201;

  // links can't be smuggled into the issue through the name/page/device fields
  const sneaky = buildIssue({ game: 'uno', what: 'hi there', name: '[click](https://evil.example)', page: '![x](https://evil.example/t.png)', device: '[Download fix](https://evil.example/fix.exe)' });
  const details = sneaky.body.split('### Details\n')[1];
  assert(details.startsWith('~~~text\n') && details.trimEnd().endsWith('~~~'), 'every detail is inside the text fence');
  assert.strictEqual(sneaky.title, '[Uno] hi there');

  // only known games become labels
  assert.deepStrictEqual(buildIssue({ game: 'zzzzzzzz', what: 'hi there' }).labels, ['bug-report', 'game:site']);
  assert.deepStrictEqual(buildIssue({ game: 'toString', what: 'hi there' }).labels, ['bug-report', 'game:site']);
  assert.deepStrictEqual(buildIssue({ game: 'phase10', what: 'hi there' }).labels, ['bug-report', 'game:phase10']);

  // site-wide hourly cap (counts what GitHub already has), no matter how many IPs it comes from
  const fresh = new Date().toISOString();
  recent = Array.from({ length: 20 }, (_, i) => ({ number: i, created_at: fresh }));
  calls = [];
  r = await post({ game: 'tap4', what: 'flood' }, ORIGIN, '8.8.8.8');
  assert.strictEqual(r.status, 429); assert.strictEqual(calls.length, 0);
  r = await worker.fetch(new Request('https://w.example/', { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '8.8.8.9' }, body: JSON.stringify({ game: 'tap4', what: 'flood' }) }), { ...env, HOURLY_CAP: '50' });
  assert.strictEqual(r.status, 200, 'cap is configurable');
  recent = [];

  // Turnstile, when configured: missing/failed token is refused, a good one goes through
  const tsEnv = { ...env, TURNSTILE_SECRET: 'ts-secret' };
  const tsPost = (body, ip) => worker.fetch(new Request('https://w.example/', { method: 'POST', headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip }, body: JSON.stringify(body) }), tsEnv);
  calls = []; tsOk = false;
  r = await tsPost({ game: 'uno', what: 'bot report' }, '9.9.9.1'); assert.strictEqual(r.status, 403); assert.strictEqual(calls.length, 0);
  tsOk = true;
  r = await tsPost({ game: 'uno', what: 'real report', turnstile: 'tok-1' }, '9.9.9.2'); assert.strictEqual(r.status, 200);
  assert.strictEqual(verifies.at(-1), 'tok-1'); assert.strictEqual(calls.length, 1);

  // GitHub failure surfaces as 502
  status = 401;
  r = await post({ game: 'tally', what: 'Scores vanished' }, ORIGIN, '6.6.6.6');
  assert.strictEqual(r.status, 502); status = 201;

  // rate limit: 10 per 10 minutes per visitor
  for (let i = 0; i < 10; i++) { r = await post({ game: 'tap4', what: 'again ' + i }, ORIGIN, '7.7.7.7'); assert.strictEqual(r.status, 200); }
  r = await post({ game: 'tap4', what: 'one too many' }, ORIGIN, '7.7.7.7'); assert.strictEqual(r.status, 429);

  // unknown game id falls back, huge snapshot is truncated, body stays under GitHub's limit
  const big = buildIssue({ game: '../../x', what: 'hi there', snapshot: { s: 'x'.repeat(100000) } });
  assert(big.title.startsWith('[Home page]')); assert(big.body.length <= 64001); assert(big.body.includes('(truncated)'));

  // not configured
  r = await worker.fetch(new Request('https://w.example/', { method: 'POST', headers: { Origin: ORIGIN }, body: '{}' }), { ALLOWED_ORIGINS: ORIGIN });
  assert.strictEqual(r.status, 503);
  console.log('worker tests OK');
})().catch(e => { console.error(e); process.exit(1); });
