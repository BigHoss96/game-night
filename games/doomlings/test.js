// Doomlings smoke test. The full rules suite (unit tests + fuzzed games) lives with the
// engine sources in the Doomlings project; this file only guards the bundled build that
// the site serves: the card data is intact and every script block compiles.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const m = html.match(/window\.__DOOMLINGS_CARDS__ = (\[.*\]);/);
assert(m, 'inlined card data not found');
const cards = JSON.parse(m[1]);
const count = (t) => cards.filter((c) => c.card_type === t).length;
assert.strictEqual(count('Trait'), 113, 'base game has 113 traits');
assert(count('Age') > 0, 'age deck is empty');
assert(cards.some((c) => /catastrophe/i.test(c.subtype)), 'no catastrophes (subtype column lost?)');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
assert(scripts.length >= 2, 'expected the card-data and game script blocks');
scripts.forEach((src, i) => new vm.Script(src, { filename: `doomlings/index.html#script${i}` }));

console.log(`Doomlings: ${cards.length} cards, ${scripts.length} script blocks compile`);
