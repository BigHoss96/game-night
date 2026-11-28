// Monopoly: rules checks + bot self-play with money and building invariants.
const assert = require('assert');
const M = require('./engine.js');
const rngs = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rng = rngs(7);
const P = (n, lv) => Array.from({ length: n }, (_, i) => ({ name: 'b' + i, bot: true, level: lv ? lv[i % lv.length] : 'normal' }));
const ok = ev => { assert(!(ev[0] && ev[0].t === 'err'), ev[0] && ev[0].text); return ev; };
const fresh = (n, o) => { const g = M.newGame(P(n || 2), o, rng); g.turn = 0; g.first = 0; return g; };

// board sanity
assert.strictEqual(M.SPACES.length, 40);
assert.strictEqual(M.OWNABLE.length, 28);
assert.strictEqual(M.CHANCE.length, 16); assert.strictEqual(M.CHEST.length, 16);
assert.strictEqual(M.GROUP_OF.rr.length, 4); assert.strictEqual(M.GROUP_OF.dblue.length, 2); assert.strictEqual(M.GROUP_OF.orange.length, 3);

// a plain move, passing GO, buying
let g = fresh();
g.players[0].pos = 35;
ok(M.act(g, { a: 'roll', dice: [2, 4] }, rng));           // 35 + 6 = 41 → 1 (Mediterranean), passes GO
assert.strictEqual(g.players[0].pos, 1); assert.strictEqual(g.players[0].cash, 1700); assert.strictEqual(g.phase, 'buy');
ok(M.act(g, { a: 'buy' }, rng)); assert.strictEqual(g.owner[1], 0); assert.strictEqual(g.players[0].cash, 1640); assert.strictEqual(g.phase, 'done');
ok(M.act(g, { a: 'end' }, rng)); assert.strictEqual(g.turn, 1);
// rent, doubled with the whole group
g.players[1].pos = 38; ok(M.act(g, { a: 'roll', dice: [1, 2] }, rng));   // → 1
assert.strictEqual(g.players[1].cash, 1498 + 0 + 200 - 0); // 1500 + 200 (GO) - 2 rent
g.owner[3] = 0; assert.strictEqual(M.rent(g, 1, 7), 4, 'double rent for the full group');
// houses: even building, bank supply, hotels
g = fresh(); g.owner[1] = g.owner[3] = 0;
assert(M.canBuild(g, 0, 1) && M.canBuild(g, 0, 3));
ok(M.act(g, { a: 'build', pos: 1 }, rng)); assert(!M.canBuild(g, 0, 1), 'even build rule');
ok(M.act(g, { a: 'build', pos: 3 }, rng)); assert.strictEqual(g.bank.houses, 30);
for (let k = 0; k < 3; k++) { ok(M.act(g, { a: 'build', pos: 1 }, rng)); ok(M.act(g, { a: 'build', pos: 3 }, rng)); }
assert.strictEqual(g.bank.houses, 24); ok(M.act(g, { a: 'build', pos: 1 }, rng));
assert.strictEqual(g.houses[1], 5); assert.strictEqual(g.bank.hotels, 11); assert.strictEqual(g.bank.houses, 28);
assert.strictEqual(M.rent(g, 1, 7), 250);
assert(!M.canMortgage(g, 0, 3), 'no mortgages while the group has buildings');
assert(!M.canSell(g, 0, 3) && M.canSell(g, 0, 1), 'even selling: hotel goes first');
ok(M.act(g, { a: 'sell', pos: 1 }, rng)); assert.strictEqual(g.houses[1], 4); assert.strictEqual(g.bank.houses, 24);
// house shortage blocks building
g.bank.houses = 0; g.owner[6] = g.owner[8] = g.owner[9] = 0; assert(!M.canBuild(g, 0, 6));
// mortgages
g = fresh(); g.owner[39] = 0; ok(M.act(g, { a: 'mortgage', pos: 39 }, rng));
assert.strictEqual(g.players[0].cash, 1700); assert.strictEqual(M.rent(g, 39, 7), 0);
ok(M.act(g, { a: 'unmortgage', pos: 39 }, rng)); assert.strictEqual(g.players[0].cash, 1700 - 220);
// railroads and utilities
g = fresh(); g.owner[5] = g.owner[15] = g.owner[25] = 1; assert.strictEqual(M.rent(g, 5, 7), 100);
g.owner[12] = 1; assert.strictEqual(M.rent(g, 12, 9), 36); g.owner[28] = 1; assert.strictEqual(M.rent(g, 12, 9), 90);
// jail: three doubles, the 50 fine, cards
g = fresh();
ok(M.act(g, { a: 'roll', dice: [1, 1] }, rng)); if (g.phase === 'buy') ok(M.act(g, { a: 'decline' }, rng)); while (g.phase === 'auction') ok(M.act(g, M.botAction(g, rng), rng));
while (g.phase === 'debt') ok(M.act(g, M.botAction(g, rng), rng));
if (g.players[0].jail === 0 && g.phase === 'roll') {
  g.players[0].pos = 0; g.doubles = 2;
  ok(M.act(g, { a: 'roll', dice: [3, 3] }, rng));
  assert.strictEqual(g.players[0].pos, M.JAIL); assert.strictEqual(g.players[0].jail, 1); assert.strictEqual(g.phase, 'done');
}
g = fresh(); g.players[0].pos = 30 - 4; ok(M.act(g, { a: 'roll', dice: [1, 3] }, rng));
assert.strictEqual(g.players[0].pos, 10); assert(g.players[0].jail);
ok(M.act(g, { a: 'end' }, rng)); g.turn = 0;
g.phase = 'roll'; ok(M.act(g, { a: 'roll', dice: [1, 2] }, rng)); assert.strictEqual(g.players[0].pos, 10, 'no doubles: stay');
g.phase = 'roll'; g.dice = null; ok(M.act(g, { a: 'roll', dice: [1, 2] }, rng));
g.phase = 'roll'; g.dice = null; const before = g.players[0].cash; ok(M.act(g, { a: 'roll', dice: [1, 2] }, rng));
assert.strictEqual(g.players[0].pos, 13, 'third try: pay and move'); assert(g.players[0].cash <= before - 50);
g = fresh(); g.players[0].jail = 1; g.players[0].pos = 10; g.players[0].cards = ['chance'];
g.decks.chance = g.decks.chance.filter(i => !M.CHANCE[i].free);
ok(M.act(g, { a: 'jailCard' }, rng)); assert.strictEqual(g.players[0].jail, 0); assert.strictEqual(g.decks.chance.length, 16);
// cards: nearest railroad pays double
g = fresh(); g.owner[15] = 1; g.players[0].pos = 7;
g.decks.chance.unshift(g.decks.chance.splice(g.decks.chance.indexOf(4), 1)[0]);
g.players[0].pos = 4; ok(M.act(g, { a: 'roll', dice: [1, 2] }, rng));
assert.strictEqual(g.players[0].pos, 15); assert.strictEqual(g.players[1].cash, 1550, 'double railroad rent');
// birthday collects from everyone
g = fresh(3); const bd = M.CHEST.findIndex(c => c.each === 10);
g.decks.chest.unshift(g.decks.chest.splice(g.decks.chest.indexOf(bd), 1)[0]);
g.players[0].pos = 0; ok(M.act(g, { a: 'roll', dice: [1, 1] }, rng));
assert.strictEqual(g.players[0].cash, 1520); assert.strictEqual(g.players[2].cash, 1490);
// auction: highest bid wins, payment taken
g = fresh(3, { auction: true }); g.players[0].pos = 37; ok(M.act(g, { a: 'roll', dice: [1, 1] }, rng));
assert.strictEqual(g.phase, 'buy'); ok(M.act(g, { a: 'decline' }, rng)); assert.strictEqual(g.phase, 'auction');
ok(M.act(g, { a: 'bid', amt: 50 }, rng)); ok(M.act(g, { a: 'bid', amt: 80 }, rng)); ok(M.act(g, { a: 'pass' }, rng));
ok(M.act(g, { a: 'pass' }, rng));    // player 0 drops, player 1 is left holding the high bid
assert.strictEqual(g.owner[39], 1); assert.strictEqual(g.players[1].cash, 1420); assert.strictEqual(g.phase, 'roll', 'doubles: roll again');
// debt → bankruptcy hands everything to the creditor
g = fresh(); g.owner[39] = 1; g.houses[39] = 5; g.owner[37] = 1; g.houses[37] = 5; g.bank.hotels = 10;
g.players[0].cash = 100; g.owner[1] = 0; g.players[0].pos = 37; ok(M.act(g, { a: 'roll', dice: [1, 1] }, rng));
assert.strictEqual(g.phase, 'debt'); assert.strictEqual(M.actor(g), 0);
assert(M.act(g, { a: 'payDebt' }, rng)[0].t === 'err');
ok(M.act(g, { a: 'bankrupt' }, rng));
assert(g.over && g.winner === 1); assert.strictEqual(g.owner[1], 1); assert.strictEqual(g.players[1].cash, 1500 + 100);
// trades: validation, buildings block trading, mortgage interest
g = fresh(); g.owner[1] = 0; g.owner[3] = 1; g.owner[39] = 1; g.mortgaged[39] = true;
assert(M.tradeError(g, { from: 0, to: 1, give: { cash: 5000 }, get: {} }));
const t = { from: 0, to: 1, give: { cash: 100, props: [1] }, get: { props: [39] } };
assert.strictEqual(M.tradeError(g, t), '');
ok(M.act(g, { a: 'offer', trade: t }, rng)); assert.strictEqual(M.actor(g), 1);
assert(M.act(g, { a: 'roll' }, rng)[0].t === 'err', 'trade answer comes first');
ok(M.act(g, { a: 'answer', pi: 1, yes: true }, rng));
assert.strictEqual(g.owner[39], 0); assert.strictEqual(g.owner[1], 1); assert.strictEqual(g.players[0].cash, 1500 - 100 - 20);
g.owner[3] = 1; g.owner[1] = 1; g.houses[1] = 1; assert(M.tradeError(g, { from: 0, to: 1, give: {}, get: { props: [3] } }));
// house rules: Free Parking jackpot, $400 on GO, time limit
g = fresh(2, { parking: true }); g.players[0].pos = 0; ok(M.act(g, { a: 'roll', dice: [1, 3] }, rng));
assert.strictEqual(g.pot, 200); ok(M.act(g, { a: 'end' }, rng)); g.players[1].pos = 15; ok(M.act(g, { a: 'roll', dice: [2, 3] }, rng));
assert.strictEqual(g.players[1].cash, 1700); assert.strictEqual(g.pot, 0);
g = fresh(2, { goDouble: true }); g.players[0].pos = 36; ok(M.act(g, { a: 'roll', dice: [1, 3] }, rng)); assert.strictEqual(g.players[0].cash, 1900);
g = fresh(2, { rounds: 1 }); g.players[1].cash = 3000; ok(M.act(g, { a: 'roll', dice: [1, 2] }, rng)); if (g.phase === 'buy') ok(M.act(g, { a: 'buy' }, rng));
ok(M.act(g, { a: 'end' }, rng)); assert(!g.over); ok(M.act(g, { a: 'roll', dice: [1, 2] }, rng)); if (g.phase === 'buy') ok(M.act(g, { a: 'buy' }, rng));
ok(M.act(g, { a: 'end' }, rng)); assert(g.over && g.winner === 1, 'richest wins when time is up');

// bots won't hand someone a monopoly for free, but will swap to complete both sides
g = fresh(); g.players[1].level = 'hard';
g.owner[1] = 0; g.owner[3] = 1; g.owner[6] = 1; g.owner[8] = 1; g.owner[9] = 0;
assert(!M.botAccepts(g, 1, { from: 0, to: 1, give: { cash: 0, props: [], cards: 0 }, get: { cash: 0, props: [3], cards: 0 } }));
assert(M.botAccepts(g, 1, { from: 0, to: 1, give: { cash: 0, props: [9], cards: 0 }, get: { cash: 0, props: [3], cards: 0 } }), 'swap: brown for light blue');

// ---------- self-play ----------
const N = +(process.env.MONO_GAMES || 120);
const wins = { easy: 0, normal: 0, hard: 0 }; let turns = 0, trades = 0, finished = 0, auctions = 0;
for (let n = 0; n < N; n++) {
  const np = 2 + (n % 5);
  const lv = ['easy', 'normal', 'hard'].map((_, i, a) => a[(i + n) % 3]);
  g = M.newGame(P(np, lv), { parking: n % 4 === 1, goDouble: n % 5 === 2, rounds: n % 3 === 0 ? 0 : 60, auction: n % 7 !== 3 }, rng);
  let guard = 0;
  while (!g.over) {
    assert(guard++ < 200000, 'game did not end');
    const a = M.botAction(g, rng), ev = M.act(g, a, rng);
    assert(!(ev[0] && ev[0].t === 'err'), `bot made an illegal move ${JSON.stringify(a)} in ${g.phase}: ${ev[0] && ev[0].text}`);
    if (a.a === 'end') turns++;
    if (ev.some(e => e.t === 'trade')) trades++;
    if (ev.some(e => e.t === 'auction')) auctions++;
    // invariants
    const h = g.houses.reduce((s, x) => s + (x === 5 ? 0 : x), 0), H = g.houses.filter(x => x === 5).length;
    assert.strictEqual(h + g.bank.houses, M.HOUSES, 'houses lost'); assert.strictEqual(H + g.bank.hotels, M.HOTELS, 'hotels lost');
    g.players.forEach((p, i) => { assert(p.cash >= 0, `${p.name} has negative cash`); if (p.out) assert(M.owned(g, i).length === 0); });
    for (const i of M.OWNABLE) {
      if (g.houses[i]) { assert(M.ownsGroup(g, g.owner[i], M.SPACES[i].group), 'houses without the full group'); assert(!g.mortgaged[i]); }
      if (g.owner[i] == null) assert(!g.mortgaged[i] && !g.houses[i]);
    }
    for (const grp of Object.keys(M.GROUP_OF)) { const hs = M.GROUP_OF[grp].map(i => g.houses[i]); assert(Math.max(...hs) - Math.min(...hs) <= 1 || hs.includes(5) && Math.min(...hs) >= 3, 'uneven building ' + grp + ' ' + hs + ' ' + JSON.stringify(a) + ' bank ' + g.bank.houses); }
    const free = g.players.reduce((a, p) => a + p.cards.length, 0) + g.decks.chance.length + g.decks.chest.length;
    assert.strictEqual(free, 32, 'a card went missing');
  }
  if (!g.opts.rounds) finished++;
  wins[g.players[g.winner].level]++;
}
console.log(`monopoly: ${N} games, ${(turns / N).toFixed(0)} turns/game, ${(trades / N).toFixed(1)} trades/game, ${(auctions / N).toFixed(1)} auctions/game, wins ${JSON.stringify(wins)}`);
assert(trades > N / 4, 'bots should trade now and then');
assert(wins.hard + wins.normal > wins.easy * 1.5, 'smarter bots should win more');
