// Builds games/doomlings/index.html from the sources in src/ and the card data in data/.
//
//   node games/doomlings/build.js           write index.html
//   node games/doomlings/build.js --check   fail if index.html is out of date (npm test runs this)
//
// index.html is generated: edit src/ or data/, then re-run this.
const fs = require('fs');
const path = require('path');
const here = __dirname;
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');

/* ---- card data ---------------------------------------------------------- */
function parseCSV(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const releases = (r) => (r.release || '').split('|').map((s) => s.trim());

/* Each playable set: which rows of all_cards.csv belong to it. The `set` field is
   added to every card so the game can build a deck from the sets a player picks. */
const SETS = [
  { id: 'base', test: (r) => releases(r).includes('Base Game') },
  // The retail Overlush collection (traits, ages, catastrophes). Kickstarter-only
  // extras (Signs, Meaning of Life) aren't part of the retail set.
  { id: 'overlush', test: (r) => releases(r).includes('Overlush') && /(^|\|)\s*Overlush\s*($|\|)/.test(r.collection) },
];

function cards() {
  const all = parseCSV(read('data/all_cards.csv'));
  const out = [];
  for (const s of SETS) {
    const rows = all.filter(s.test);
    if (!rows.length) throw new Error(`no cards found for set "${s.id}"`);
    for (const r of rows) out.push({ ...r, set: s.id });
  }
  return out;
}

/* ---- bundle ------------------------------------------------------------- */
const MODULES = ['engine/ages.js', 'engine/core.js', 'engine/effects.js', 'engine/overlush.js', 'engine/bots.js', 'mobile/ui.js'];

function build() {
  const bundle = [
    '<script>',
    `window.__DOOMLINGS_CARDS__ = ${JSON.stringify(cards())};`,
    '</script>',
    '<script>',
    ...MODULES.map((m) => `/* ---- ${m} ---- */\n${read('src/' + m)}`),
    '</script>',
    '',
  ].join('\n');
  return read('src/shell.html').replace('<!--BUNDLE-->\n', () => bundle);
}

if (require.main === module) {
  const html = build();
  const target = path.join(here, 'index.html');
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8') !== html) {
      console.error('games/doomlings/index.html is out of date — run: node games/doomlings/build.js');
      process.exit(1);
    }
    console.log('Doomlings: index.html is up to date with src/');
  } else {
    fs.writeFileSync(target, html);
    console.log(`games/doomlings/index.html written (${(html.length / 1024).toFixed(0)} KB)`);
  }
}

module.exports = { build, cards, SETS };
