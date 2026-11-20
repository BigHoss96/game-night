// Checks for the site-wide pieces: changelog.json (the "what's fixed" list), the update notice and known-issues helpers.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { changesBetween, isNewer } = require('../site/update.js');
const KI = require('../site/known-issues.js');

// changelog.json must stay valid: the nightly fix run appends to it
const log = JSON.parse(fs.readFileSync(path.join(root, 'changelog.json'), 'utf8'));
const GAMES = ['flip7', 'tap4', 'mahj', 'tally', 'doomlings', 'paydirt', 'yahtzee', 'farkle', 'site'];
assert(Array.isArray(log), 'changelog.json must be an array');
log.forEach((c, i) => {
  const at = `changelog.json[${i}]`;
  assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/.test(c.date), `${at}.date must be an ISO UTC time like 2026-11-18T03:16:00Z`);
  assert(GAMES.includes(c.game), `${at}.game must be one of ${GAMES.join(', ')}`);
  assert(typeof c.text === 'string' && c.text.length >= 8 && c.text.length <= 220, `${at}.text must be a short player-friendly sentence (8–220 chars)`);
  assert(c.issue === undefined || Number.isInteger(c.issue), `${at}.issue must be an issue number`);
});

// update notice: which fixes count as "since your version"
const ch = [
  { date: '2026-11-18T03:00:00Z', game: 'tap4', text: 'a' },
  { date: '2026-11-19T03:00:00Z', game: 'tap4', text: 'b' },
  { date: '2026-11-20T03:00:00Z', game: 'flip7', text: 'c' },
];
assert.deepStrictEqual(changesBetween(ch, '2026-11-18T12:00:00Z', '2026-11-20T04:00:00Z').map(c => c.text), ['c', 'b']);
assert.deepStrictEqual(changesBetween(ch, '2026-11-18T12:00:00Z', '2026-11-19T04:00:00Z').map(c => c.text), ['b']);
assert.deepStrictEqual(changesBetween(ch, '2026-11-21T00:00:00Z', null), []);
assert.strictEqual(isNewer({ built: '2026-11-20T04:00:00Z' }, '2026-11-19T04:00:00Z'), true);
assert.strictEqual(isNewer({ built: '2026-11-19T04:00:00Z' }, '2026-11-19T04:00:00Z'), false);
assert.strictEqual(isNewer(null, '2026-11-19T04:00:00Z'), false);

// known issues: title cleanup, game/status from labels, duplicate matching
const raw = [
  { number: 19, title: '[Tap 4] The language is a little broken. If I win it says you is the winner', labels: [{ name: 'bug-report' }, { name: 'game:tap4' }, { name: 'fix-planned' }], html_url: 'u' },
  { number: 3, title: 'a PR', pull_request: {}, labels: [] },
  { number: 17, title: '[Home page] The swip to see other cards is bugged', labels: [{ name: 'bug-report' }, { name: 'game:site' }], html_url: 'u' },
];
const s = KI.simplify(raw);
assert.strictEqual(s.length, 2, 'pull requests are not issues');
assert.strictEqual(s[0].title, 'The language is a little broken. If I win it says you is the winner');
assert.strictEqual(s[0].game, 'tap4');
assert.strictEqual(s[0].status.label, 'Fix planned');
assert.strictEqual(s[1].status.label, 'Reported');
assert(KI.similarity('the winner screen says you is the winner when I win', raw[0]) >= 2, 'similar report should match');
assert(KI.similarity('the bots take forever', raw[0]) < 2, 'unrelated report should not match');
console.log('site checks passed (' + log.length + ' changelog entries)');

// shared bot names: unique, never a human's name, short enough for every game's name spots
{
  const BN = require('../shared/botnames.js');
  for (let k = 0; k < 200; k++) {
    const names = BN.pick(7, ['Rosie', 'Austin']);
    assert.strictEqual(names.length, 7);
    assert.strictEqual(new Set(names.map(n => n.toLowerCase())).size, 7, 'bot names repeat within a game');
    assert(!names.some(n => /^(rosie|austin)$/i.test(n)), 'bot took a human name');
    assert(names.every(n => n.length <= 12), 'bot name too long: ' + names);
  }
}
