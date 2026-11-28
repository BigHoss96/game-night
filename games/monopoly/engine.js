// Monopoly rules + bots. Pure functions over a plain game object; no DOM.
// Everything a player (or bot) can do goes through act(g, action, rng), which returns a list of
// events ({ t, text, ... }) the UI can animate. actor(g) says whose decision it is right now.
//
// Phases: 'roll' (start of turn, or after doubles) → 'buy' (landed on an unowned lot) → 'auction'
//   → 'debt' (someone owes more cash than they have: raise it or go bankrupt) → 'done' (end your turn) → 'over'
// House rules (opts): auction (unbought lots go to auction, on by default), parking (taxes and fees
//   go into a Free Parking jackpot), goDouble ($400 for landing exactly on GO), rounds (0 = play until
//   one player is left; N = after N rounds the richest player wins).
(function (root) {
'use strict';

// ---------- the board ----------
const GROUPS = {
  brown: { color: '#8a4b2a', name: 'Brown' }, lblue: { color: '#9fd7f5', name: 'Light blue' }, pink: { color: '#d6409f', name: 'Pink' },
  orange: { color: '#f39324', name: 'Orange' }, red: { color: '#e2272c', name: 'Red' }, yellow: { color: '#f2d82b', name: 'Yellow' },
  green: { color: '#1f9e4a', name: 'Green' }, dblue: { color: '#1f4fa8', name: 'Dark blue' }, rr: { color: '#333', name: 'Railroads' }, util: { color: '#888', name: 'Utilities' },
};
const P = (name, short, group, price, house, rent) => ({ type: 'prop', name, short, group, price, house, rent });
const RR = (name, short) => ({ type: 'rr', name, short, group: 'rr', price: 200 });
const UT = (name, short) => ({ type: 'util', name, short, group: 'util', price: 150 });
const SPACES = [
  { type: 'go', name: 'GO', short: 'GO' },
  P('Mediterranean Avenue', 'Mediterr.', 'brown', 60, 50, [2, 10, 30, 90, 160, 250]),
  { type: 'chest', name: 'Community Chest', short: 'Chest' },
  P('Baltic Avenue', 'Baltic', 'brown', 60, 50, [4, 20, 60, 180, 320, 450]),
  { type: 'tax', name: 'Income Tax', short: 'Tax', amount: 200 },
  RR('Reading Railroad', 'Reading'),
  P('Oriental Avenue', 'Oriental', 'lblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  { type: 'chance', name: 'Chance', short: 'Chance' },
  P('Vermont Avenue', 'Vermont', 'lblue', 100, 50, [6, 30, 90, 270, 400, 550]),
  P('Connecticut Avenue', 'Conn.', 'lblue', 120, 50, [8, 40, 100, 300, 450, 600]),
  { type: 'jail', name: 'Jail / Just Visiting', short: 'Jail' },
  P('St. Charles Place', 'St. Charles', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
  UT('Electric Company', 'Electric'),
  P('States Avenue', 'States', 'pink', 140, 100, [10, 50, 150, 450, 625, 750]),
  P('Virginia Avenue', 'Virginia', 'pink', 160, 100, [12, 60, 180, 500, 700, 900]),
  RR('Pennsylvania Railroad', 'Penn. RR'),
  P('St. James Place', 'St. James', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  { type: 'chest', name: 'Community Chest', short: 'Chest' },
  P('Tennessee Avenue', 'Tennessee', 'orange', 180, 100, [14, 70, 200, 550, 750, 950]),
  P('New York Avenue', 'New York', 'orange', 200, 100, [16, 80, 220, 600, 800, 1000]),
  { type: 'parking', name: 'Free Parking', short: 'Parking' },
  P('Kentucky Avenue', 'Kentucky', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  { type: 'chance', name: 'Chance', short: 'Chance' },
  P('Indiana Avenue', 'Indiana', 'red', 220, 150, [18, 90, 250, 700, 875, 1050]),
  P('Illinois Avenue', 'Illinois', 'red', 240, 150, [20, 100, 300, 750, 925, 1100]),
  RR('B. & O. Railroad', 'B&O RR'),
  P('Atlantic Avenue', 'Atlantic', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  P('Ventnor Avenue', 'Ventnor', 'yellow', 260, 150, [22, 110, 330, 800, 975, 1150]),
  UT('Water Works', 'Water'),
  P('Marvin Gardens', 'Marvin G.', 'yellow', 280, 150, [24, 120, 360, 850, 1025, 1200]),
  { type: 'gotojail', name: 'Go to Jail', short: 'To Jail' },
  P('Pacific Avenue', 'Pacific', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  P('North Carolina Avenue', 'N. Carolina', 'green', 300, 200, [26, 130, 390, 900, 1100, 1275]),
  { type: 'chest', name: 'Community Chest', short: 'Chest' },
  P('Pennsylvania Avenue', 'Penn. Ave', 'green', 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  RR('Short Line', 'Short Line'),
  { type: 'chance', name: 'Chance', short: 'Chance' },
  P('Park Place', 'Park Place', 'dblue', 350, 200, [35, 175, 500, 1100, 1300, 1500]),
  { type: 'tax', name: 'Luxury Tax', short: 'Lux. Tax', amount: 100 },
  P('Boardwalk', 'Boardwalk', 'dblue', 400, 200, [50, 200, 600, 1400, 1700, 2000]),
];
const JAIL = 10, GO_PAY = 200, JAIL_FINE = 50, START_CASH = 1500, HOUSES = 32, HOTELS = 12;
const OWNABLE = SPACES.map((s, i) => s.price ? i : -1).filter(i => i >= 0);
const GROUP_OF = {};
SPACES.forEach((s, i) => { if (s.group) (GROUP_OF[s.group] = GROUP_OF[s.group] || []).push(i); });
const RR_RENT = [0, 25, 50, 100, 200];
const mortgageValue = pos => SPACES[pos].price / 2;
const unmortgageCost = pos => Math.ceil(mortgageValue(pos) * 11 / 10);

// ---------- cards (effects only; wording is our own) ----------
const CHANCE = [
  { text: 'Advance to Boardwalk.', go: 39 },
  { text: 'Advance to GO. Collect $200.', go: 0 },
  { text: 'Advance to Illinois Avenue. If you pass GO, collect $200.', go: 24 },
  { text: 'Advance to St. Charles Place. If you pass GO, collect $200.', go: 11 },
  { text: 'Advance to the nearest railroad. If someone owns it, pay them double rent.', near: 'rr' },
  { text: 'Advance to the nearest railroad. If someone owns it, pay them double rent.', near: 'rr' },
  { text: 'Advance to the nearest utility. If someone owns it, roll the dice and pay them 10× the roll.', near: 'util' },
  { text: 'The bank pays you a $50 dividend.', cash: 50 },
  { text: 'Get Out of Jail Free. Keep this card until you need it.', free: true },
  { text: 'Go back three spaces.', back: 3 },
  { text: 'Go straight to Jail. Do not pass GO, do not collect $200.', jail: true },
  { text: 'Repairs on all your property: pay $25 per house and $100 per hotel.', repairs: [25, 100] },
  { text: 'Speeding ticket. Pay $15.', cash: -15 },
  { text: 'Take a trip to Reading Railroad. If you pass GO, collect $200.', go: 5 },
  { text: 'You were voted chair of the board. Pay every player $50.', each: -50 },
  { text: 'Your building loan comes due in your favor. Collect $150.', cash: 150 },
];
const CHEST = [
  { text: 'Advance to GO. Collect $200.', go: 0 },
  { text: 'A bank mistake in your favor. Collect $200.', cash: 200 },
  { text: 'Doctor visit. Pay $50.', cash: -50 },
  { text: 'You sell some stock. Collect $50.', cash: 50 },
  { text: 'Get Out of Jail Free. Keep this card until you need it.', free: true },
  { text: 'Go straight to Jail. Do not pass GO, do not collect $200.', jail: true },
  { text: 'Your holiday savings pay out. Collect $100.', cash: 100 },
  { text: 'Tax refund. Collect $20.', cash: 20 },
  { text: 'It\'s your birthday! Collect $10 from every player.', each: 10 },
  { text: 'A life insurance policy pays out. Collect $100.', cash: 100 },
  { text: 'Hospital bill. Pay $100.', cash: -100 },
  { text: 'School fees. Pay $50.', cash: -50 },
  { text: 'You did some consulting. Collect $25.', cash: 25 },
  { text: 'Street repairs: pay $40 per house and $115 per hotel.', repairs: [40, 115] },
  { text: 'Second place in a beauty contest. Collect $10.', cash: 10 },
  { text: 'You inherit $100.', cash: 100 },
];
const DECKS = { chance: CHANCE, chest: CHEST };

const DEFAULTS = { auction: true, parking: false, goDouble: false, rounds: 0, cash: START_CASH };
const TOKENS = ['#e8453c', '#2f7de1', '#2fae5b', '#f2b51d', '#9b59d0', '#ff7a2f', '#17b3b3', '#e05aa8'];
function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const R = rng => rng || Math.random;
const die = rng => 1 + Math.floor(R(rng)() * 6);

function newGame(players, opts, rng) {
  rng = R(rng);
  const o = Object.assign({}, DEFAULTS, opts || {});
  const g = {
    players: players.map((p, i) => ({ name: p.name, bot: !!p.bot, level: p.level || 'normal', color: TOKENS[i % TOKENS.length],
      cash: o.cash, pos: 0, jail: 0, cards: [], out: false })),
    owner: SPACES.map(() => null), houses: SPACES.map(() => 0), mortgaged: SPACES.map(() => false),
    bank: { houses: HOUSES, hotels: HOTELS }, pot: 0,
    decks: { chance: shuffle(CHANCE.map((_, i) => i), rng), chest: shuffle(CHEST.map((_, i) => i), rng) },
    opts: o, turn: Math.floor(rng() * players.length), phase: 'roll', dice: null, doubles: 0, again: false,
    pending: null, auction: null, debts: [], offer: null, next: 'done', round: 1, turns: 0, first: 0,
    memo: {}, offered: false, over: false, winner: null, log: [],
  };
  g.first = g.turn;
  return g;
}

// ---------- helpers ----------
const sp = pos => SPACES[pos];
const alive = g => g.players.map((p, i) => p.out ? -1 : i).filter(i => i >= 0);
const owned = (g, pi) => OWNABLE.filter(i => g.owner[i] === pi);
const ownsGroup = (g, pi, grp) => GROUP_OF[grp].every(i => g.owner[i] === pi);
const groupBuilt = (g, grp) => GROUP_OF[grp].some(i => g.houses[i] > 0);
function rrCount(g, pi) { return GROUP_OF.rr.filter(i => g.owner[i] === pi).length; }
function utilCount(g, pi) { return GROUP_OF.util.filter(i => g.owner[i] === pi).length; }
const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US');
function say(g, ev, text, extra) { const e = Object.assign({ t: 'msg', text }, extra || {}); ev.push(e); g.log.push(text); if (g.log.length > 200) g.log.shift(); return e; }
function actor(g) {
  if (g.over) return null;
  if (g.offer) return g.offer.to;
  if (g.phase === 'debt' && g.debts.length) return g.debts[0].pi;
  if (g.phase === 'auction' && g.auction) return g.auction.active[g.auction.at];
  return g.turn;
}

// rent owed for landing on pos (dice = the roll that got you there; mult from cards)
function rent(g, pos, dice, ctx) {
  const s = sp(pos), o = g.owner[pos];
  if (o == null || g.mortgaged[pos]) return 0;
  ctx = ctx || {};
  if (s.type === 'rr') return RR_RENT[rrCount(g, o)] * (ctx.double ? 2 : 1);
  if (s.type === 'util') return (ctx.ten ? 10 : utilCount(g, o) === 2 ? 10 : 4) * (dice || 7);
  const h = g.houses[pos];
  if (h) return s.rent[h];
  return s.rent[0] * (ownsGroup(g, o, s.group) ? 2 : 1);
}
// the rent this lot would charge right now (for display; utilities shown per point of dice)
function rentNow(g, pos) { const s = sp(pos); return s.type === 'util' ? (utilCount(g, g.owner[pos]) === 2 ? 10 : 4) : rent(g, pos, 1); }

// ---------- money ----------
// to: player index | 'bank' | 'pot'. Short of cash → it becomes a debt to settle before play goes on.
function charge(g, pi, to, amt, why, ev) {
  if (amt <= 0) return;
  const p = g.players[pi];
  if (to === 'pot' && !g.opts.parking) to = 'bank';
  if (p.cash >= amt) { transfer(g, pi, to, amt); say(g, ev, `${p.name} pays ${money(amt)}${to === 'bank' || to === 'pot' ? '' : ' to ' + g.players[to].name} — ${why}`, { t: 'pay', pi, to, amt }); }
  else { g.debts.push({ pi, to, amt, why }); say(g, ev, `${p.name} owes ${money(amt)} (${why}) but has only ${money(p.cash)}`, { t: 'owe', pi, to, amt }); }
}
function transfer(g, pi, to, amt) {
  g.players[pi].cash -= amt;
  if (typeof to === 'number') g.players[to].cash += amt;
  else if (to === 'pot') g.pot += amt;
}
function gain(g, pi, amt, why, ev) { g.players[pi].cash += amt; say(g, ev, `${g.players[pi].name} collects ${money(amt)} — ${why}`, { t: 'gain', pi, amt }); }

// What a player could raise by selling every building and mortgaging everything
function liquid(g, pi) {
  let v = g.players[pi].cash;
  for (const i of owned(g, pi)) { if (!g.mortgaged[i]) v += mortgageValue(i); if (g.houses[i]) v += g.houses[i] * sp(i).house / 2; }
  return v;
}
// Total worth: cash + printed price of each lot (half if mortgaged) + what the buildings cost
function worth(g, pi) {
  let v = g.players[pi].cash;
  for (const i of owned(g, pi)) v += (g.mortgaged[i] ? sp(i).price / 2 : sp(i).price) + g.houses[i] * (sp(i).house || 0);
  return v;
}
function debtOf(g, pi) { return g.debts.filter(d => d.pi === pi).reduce((a, d) => a + d.amt, 0); }

// ---------- movement ----------
function goTo(g, pi, to, ev, opts) {
  const p = g.players[pi], from = p.pos;
  const steps = opts && opts.back ? -opts.back : (to - from + 40) % 40;
  p.pos = to;
  ev.push({ t: 'move', pi, from, to, steps, text: '' });
  if (steps > 0 && from + steps >= 40 && !(opts && opts.noGo)) {
    const amt = to === 0 && g.opts.goDouble ? GO_PAY * 2 : GO_PAY;
    gain(g, pi, amt, to === 0 ? 'landed on GO' : 'passed GO', ev);
  }
}
function sendToJail(g, pi, ev, why) {
  const p = g.players[pi];
  const from = p.pos; p.pos = JAIL; p.jail = 1; g.again = false; g.doubles = 0;
  ev.push({ t: 'move', pi, from, to: JAIL, steps: 0, jail: true, text: '' });
  say(g, ev, `${p.name} goes to Jail${why ? ' — ' + why : ''}`, { t: 'jail', pi });
}
function land(g, pi, ev, ctx) {
  const p = g.players[pi], pos = p.pos, s = sp(pos);
  ctx = ctx || {};
  if (s.type === 'go' || s.type === 'jail') return;
  if (s.type === 'gotojail') return sendToJail(g, pi, ev);
  if (s.type === 'parking') { if (g.opts.parking && g.pot > 0) { const a = g.pot; g.pot = 0; gain(g, pi, a, 'Free Parking jackpot', ev); } return; }
  if (s.type === 'tax') return charge(g, pi, 'pot', s.amount, s.name, ev);
  if (s.type === 'chance' || s.type === 'chest') return drawCard(g, pi, s.type, ev);
  const o = g.owner[pos];
  if (o == null) { g.pending = { pos, ctx }; return; }
  if (o === pi) return;
  if (g.mortgaged[pos]) { say(g, ev, `${s.name} is mortgaged — no rent`); return; }
  if (g.players[o].out) return;
  let dice = g.dice ? g.dice[0] + g.dice[1] : 7;
  if (ctx.ten) { const d = [die(ctx.rng), die(ctx.rng)]; dice = d[0] + d[1]; ev.push({ t: 'roll', d, pi, text: `${p.name} rolls ${dice} for the utility` }); }
  charge(g, pi, o, rent(g, pos, dice, ctx), `rent on ${s.name}`, ev);
}
function drawCard(g, pi, deck, ev) {
  const id = g.decks[deck].shift(), c = DECKS[deck][id], p = g.players[pi];
  ev.push({ t: 'card', deck, id, pi, text: c.text });
  g.log.push(`${p.name} draws ${deck === 'chance' ? 'Chance' : 'Community Chest'}: ${c.text}`);
  if (c.free) { p.cards.push(deck); return; }
  g.decks[deck].push(id);
  if (c.cash > 0) return gain(g, pi, c.cash, 'card', ev);
  if (c.cash < 0) return charge(g, pi, 'pot', -c.cash, 'card', ev);
  if (c.jail) return sendToJail(g, pi, ev);
  if (c.go != null) { goTo(g, pi, c.go, ev); return land(g, pi, ev, { rng: ev.rng }); }
  if (c.back) { goTo(g, pi, (p.pos + 40 - c.back) % 40, ev, { back: c.back }); return land(g, pi, ev, { rng: ev.rng }); }
  if (c.near) {
    let t = p.pos; do t = (t + 1) % 40; while (sp(t).type !== c.near);
    goTo(g, pi, t, ev);
    return land(g, pi, ev, c.near === 'rr' ? { double: true } : { ten: true, rng: ev.rng });
  }
  if (c.repairs) {
    let h = 0, H = 0; owned(g, pi).forEach(i => { if (g.houses[i] === 5) H++; else h += g.houses[i]; });
    const amt = h * c.repairs[0] + H * c.repairs[1];
    if (amt) charge(g, pi, 'pot', amt, `repairs on ${h} house${h === 1 ? '' : 's'} and ${H} hotel${H === 1 ? '' : 's'}`, ev);
    else say(g, ev, `${p.name} has no buildings — nothing to pay`);
    return;
  }
  if (c.each) {
    const others = alive(g).filter(i => i !== pi);
    if (c.each > 0) others.forEach(i => charge(g, i, pi, c.each, `${p.name}'s birthday`, ev));
    else others.forEach(i => charge(g, pi, i, -c.each, 'chair of the board', ev));
  }
}

// After a move or decision: settle debts first, then any buy decision, then carry on.
function settle(g) {
  if (g.over) return;
  if (g.debts.length) { g.phase = 'debt'; return; }
  if (g.players[g.turn].out) { nextTurn(g); return; }
  if (g.pending) { g.phase = 'buy'; return; }
  g.phase = g.again ? 'roll' : 'done';
}

// ---------- buildings & mortgages ----------
function canBuild(g, pi, pos) {
  const s = sp(pos);
  if (s.type !== 'prop' || g.owner[pos] !== pi || !ownsGroup(g, pi, s.group)) return false;
  const grp = GROUP_OF[s.group];
  if (grp.some(i => g.mortgaged[i])) return false;
  const h = g.houses[pos];
  if (h >= 5 || h > Math.min(...grp.map(i => g.houses[i]))) return false;
  if (h < 4 ? g.bank.houses < 1 : g.bank.hotels < 1) return false;
  return g.players[pi].cash >= s.house;
}
function canSell(g, pi, pos) {
  const s = sp(pos);
  if (s.type !== 'prop' || g.owner[pos] !== pi || !g.houses[pos]) return false;
  return g.houses[pos] >= Math.max(...GROUP_OF[s.group].map(i => g.houses[i]));
}
function build(g, pi, pos, ev) {
  if (!canBuild(g, pi, pos)) return false;
  const s = sp(pos), p = g.players[pi];
  p.cash -= s.house;
  if (g.houses[pos] === 4) { g.bank.houses += 4; g.bank.hotels--; } else g.bank.houses--;
  g.houses[pos]++;
  say(g, ev, `${p.name} builds ${g.houses[pos] === 5 ? 'a hotel' : 'a house'} on ${s.name} for ${money(s.house)}`, { t: 'build', pi, pos });
  return true;
}
function sell(g, pi, pos, ev) {
  if (!canSell(g, pi, pos)) return false;
  const s = sp(pos), p = g.players[pi];
  if (g.houses[pos] === 5 && g.bank.houses >= 4) {
    g.bank.hotels++; g.bank.houses -= 4; g.houses[pos] = 4; p.cash += s.house / 2;
    say(g, ev, `${p.name} sells the hotel on ${s.name} for ${money(s.house / 2)}`, { t: 'sell', pi, pos });
  } else if (g.houses[pos] === 5) {
    // the bank has too few houses to break the hotel down: every building in the group is sold
    let back = 0;
    GROUP_OF[s.group].forEach(i => { const h = g.houses[i]; if (h === 5) g.bank.hotels++; else g.bank.houses += h; back += h; g.houses[i] = 0; });
    p.cash += back * s.house / 2;
    say(g, ev, `The bank is out of houses, so ${p.name} sells every building on the ${GROUPS[s.group].name.toLowerCase()} lots for ${money(back * s.house / 2)}`, { t: 'sell', pi, pos });
  } else {
    g.houses[pos]--; g.bank.houses++; p.cash += s.house / 2;
    say(g, ev, `${p.name} sells a house on ${s.name} for ${money(s.house / 2)}`, { t: 'sell', pi, pos });
  }
  return true;
}
const canMortgage = (g, pi, pos) => g.owner[pos] === pi && !g.mortgaged[pos] && !(sp(pos).type === 'prop' && groupBuilt(g, sp(pos).group));
const canUnmortgage = (g, pi, pos) => g.owner[pos] === pi && g.mortgaged[pos] && g.players[pi].cash >= unmortgageCost(pos);
function mortgage(g, pi, pos, ev) {
  if (!canMortgage(g, pi, pos)) return false;
  g.mortgaged[pos] = true; g.players[pi].cash += mortgageValue(pos);
  say(g, ev, `${g.players[pi].name} mortgages ${sp(pos).name} for ${money(mortgageValue(pos))}`, { t: 'mortgage', pi, pos });
  return true;
}
function unmortgage(g, pi, pos, ev) {
  if (!canUnmortgage(g, pi, pos)) return false;
  g.mortgaged[pos] = false; g.players[pi].cash -= unmortgageCost(pos);
  say(g, ev, `${g.players[pi].name} pays off the mortgage on ${sp(pos).name} (${money(unmortgageCost(pos))})`, { t: 'unmortgage', pi, pos });
  return true;
}

// ---------- auctions ----------
function startAuction(g, pos, ev) {
  // bidding goes round the table starting with the player who passed on it
  const order = []; for (let k = 0; k < g.players.length; k++) { const i = (g.turn + k) % g.players.length; if (!g.players[i].out) order.push(i); }
  g.auction = { pos, high: 0, bidder: null, active: order, at: 0 };
  g.phase = 'auction';
  say(g, ev, `${sp(pos).name} goes up for auction`, { t: 'auction', pos });
}
function auctionAdvance(g, ev) {
  const a = g.auction;
  if (a.active.length === 0 || (a.active.length === 1 && a.bidder === a.active[0])) return endAuction(g, ev);
  a.at = a.at % a.active.length;
  if (a.active[a.at] === a.bidder) a.at = (a.at + 1) % a.active.length;
}
function endAuction(g, ev) {
  const a = g.auction; g.auction = null; g.pending = null;
  if (a.bidder != null) {
    g.players[a.bidder].cash -= a.high; g.owner[a.pos] = a.bidder;
    say(g, ev, `${g.players[a.bidder].name} wins ${sp(a.pos).name} for ${money(a.high)}`, { t: 'buy', pi: a.bidder, pos: a.pos, amt: a.high });
  } else say(g, ev, `No bids — ${sp(a.pos).name} stays with the bank`);
  settle(g);
}

// ---------- bankruptcy ----------
function bankrupt(g, pi, ev) {
  const p = g.players[pi];
  const d = g.debts.find(x => x.pi === pi);
  const to = d && typeof d.to === 'number' && !g.players[d.to].out ? d.to : null;
  g.debts = g.debts.filter(x => x.pi !== pi && x.to !== pi);
  const props = owned(g, pi);
  if (to != null) {
    const q = g.players[to];
    props.forEach(i => { if (!g.houses[i]) return; p.cash += g.houses[i] * sp(i).house / 2; if (g.houses[i] === 5) { g.bank.hotels++; } else g.bank.houses += g.houses[i]; g.houses[i] = 0; });
    q.cash += Math.max(0, p.cash);
    let fee = 0;
    props.forEach(i => { g.owner[i] = to; if (g.mortgaged[i]) fee += Math.ceil(mortgageValue(i) / 10); });
    q.cards.push(...p.cards);
    say(g, ev, `${p.name} is bankrupt! ${q.name} takes everything they had`, { t: 'bankrupt', pi, to });
    if (fee) charge(g, to, 'bank', fee, '10% interest on the mortgaged lots taken over', ev);
  } else {
    props.forEach(i => { if (g.houses[i] === 5) g.bank.hotels++; else g.bank.houses += g.houses[i]; g.houses[i] = 0; g.owner[i] = null; g.mortgaged[i] = false; });
    p.cards.forEach(dk => g.decks[dk].push(DECKS[dk].findIndex(c => c.free)));
    say(g, ev, `${p.name} is bankrupt! Their lots go back to the bank`, { t: 'bankrupt', pi, to: null });
  }
  p.cash = 0; p.cards = []; p.out = true; p.jail = 0;
  if (g.offer && (g.offer.from === pi || g.offer.to === pi)) g.offer = null;
  checkOver(g, ev);
}
function checkOver(g, ev) {
  const live = alive(g);
  if (live.length <= 1) { g.over = true; g.phase = 'over'; g.winner = live[0]; say(g, ev, `${g.players[live[0]].name} wins!`, { t: 'over' }); return true; }
  return false;
}

// ---------- turns ----------
function nextTurn(g, ev) {
  ev = ev || [];
  g.again = false; g.doubles = 0; g.dice = null; g.pending = null; g.offered = false; g.turns++;
  let i = g.turn;
  do { i = (i + 1) % g.players.length; if (i === g.first) g.round++; } while (g.players[i].out);
  if (g.opts.rounds && g.round > g.opts.rounds) {
    const live = alive(g), best = live.reduce((a, b) => worth(g, b) > worth(g, a) ? b : a);
    g.over = true; g.phase = 'over'; g.winner = best;
    say(g, ev, `Time's up after ${g.opts.rounds} rounds — ${g.players[best].name} is the richest and wins!`, { t: 'over' });
    return;
  }
  g.turn = i; g.phase = 'roll';
}
function doRoll(g, rng, ev, forced) {
  const pi = g.turn, p = g.players[pi];
  const d = forced || [die(rng), die(rng)], dbl = d[0] === d[1];
  g.dice = d;
  ev.push({ t: 'roll', d, pi, text: `${p.name} rolls ${d[0]} + ${d[1]}${dbl ? ' — doubles!' : ''}` });
  g.log.push(ev[ev.length - 1].text);
  if (p.jail) {
    if (dbl) { p.jail = 0; say(g, ev, `${p.name} rolled doubles and walks out of Jail`); g.again = false; }
    else if (p.jail >= 3) { p.jail = 0; charge(g, pi, 'pot', JAIL_FINE, 'third try in Jail — must pay to leave', ev); g.again = false; }
    else { p.jail++; say(g, ev, `${p.name} stays in Jail`); g.again = false; return settle(g); }
  } else if (dbl) {
    g.doubles++;
    if (g.doubles >= 3) { sendToJail(g, pi, ev, 'three doubles in a row'); return settle(g); }
    g.again = true;
  } else g.again = false;
  goTo(g, pi, (p.pos + d[0] + d[1]) % 40, ev);
  land(g, pi, ev, { rng });
  settle(g);
}

// ---------- trades ----------
// trade: { from, to, give: { cash, props: [pos], cards: n }, get: { cash, props, cards } }
function tradeError(g, t) {
  const A = g.players[t.from], B = g.players[t.to];
  if (!A || !B || A.out || B.out || t.from === t.to) return 'Pick another player';
  const side = (s, pi) => {
    s.cash = Math.max(0, Math.floor(s.cash || 0)); s.props = s.props || []; s.cards = s.cards || 0;
    if (g.players[pi].cash < s.cash) return `${g.players[pi].name} doesn't have ${money(s.cash)}`;
    if (g.players[pi].cards.length < s.cards) return `${g.players[pi].name} doesn't have that card`;
    for (const i of s.props) {
      if (g.owner[i] !== pi) return `${g.players[pi].name} doesn't own ${sp(i).name}`;
      if (sp(i).type === 'prop' && groupBuilt(g, sp(i).group)) return `Sell the buildings on the ${GROUPS[sp(i).group].name.toLowerCase()} lots before trading them`;
    }
    return '';
  };
  const e = side(t.give, t.from) || side(t.get, t.to); if (e) return e;
  if (!t.give.cash && !t.give.props.length && !t.give.cards && !t.get.cash && !t.get.props.length && !t.get.cards) return 'Put something in the deal';
  const fee = (props) => props.filter(i => g.mortgaged[i]).reduce((a, i) => a + Math.ceil(mortgageValue(i) / 10), 0);
  if (A.cash - t.give.cash + t.get.cash < fee(t.get.props)) return `${A.name} can't cover the 10% interest on mortgaged lots`;
  if (B.cash - t.get.cash + t.give.cash < fee(t.give.props)) return `${B.name} can't cover the 10% interest on mortgaged lots`;
  return '';
}
function doTrade(g, t, ev) {
  const A = g.players[t.from], B = g.players[t.to];
  A.cash += t.get.cash - t.give.cash; B.cash += t.give.cash - t.get.cash;
  const move = (props, to) => props.forEach(i => { g.owner[i] = to; if (g.mortgaged[i]) { const f = Math.ceil(mortgageValue(i) / 10); g.players[to].cash -= f; } });
  move(t.give.props, t.to); move(t.get.props, t.from);
  for (let k = 0; k < t.give.cards; k++) B.cards.push(A.cards.pop());
  for (let k = 0; k < t.get.cards; k++) A.cards.push(B.cards.pop());
  say(g, ev, `${B.name} accepts ${A.name}'s trade`, { t: 'trade', from: t.from, to: t.to });
}
function describe(g, s) {
  const parts = s.props.map(i => sp(i).name + (g.mortgaged[i] ? ' (mortgaged)' : ''));
  if (s.cash) parts.push(money(s.cash));
  if (s.cards) parts.push(s.cards > 1 ? `${s.cards} Get Out of Jail Free cards` : 'a Get Out of Jail Free card');
  return parts.join(', ') || 'nothing';
}

// ---------- the one entry point ----------
// Returns the events, or [{ t: 'err', text }] when the move isn't allowed right now.
function act(g, a, rng) {
  rng = R(rng);
  const ev = []; ev.rng = rng;
  const err = text => [{ t: 'err', text }];
  if (g.over) return err('The game is over');
  const who = a.pi != null ? a.pi : actor(g);
  const p = g.players[who];
  if (g.offer && a.a !== 'answer') return err('Waiting on a trade answer');
  switch (a.a) {
    case 'roll':
      if (g.phase !== 'roll' || who !== g.turn) return err('Not time to roll');
      doRoll(g, rng, ev, a.dice); break;
    case 'payJail':
      if (g.phase !== 'roll' || who !== g.turn || !p.jail || g.dice) return err('Not in Jail');
      if (p.cash < JAIL_FINE) return err(`You need ${money(JAIL_FINE)}`);
      transfer(g, who, g.opts.parking ? 'pot' : 'bank', JAIL_FINE); p.jail = 0;
      say(g, ev, `${p.name} pays ${money(JAIL_FINE)} to get out of Jail`); break;
    case 'jailCard':
      if (g.phase !== 'roll' || who !== g.turn || !p.jail || !p.cards.length) return err('No card to use');
      { const dk = p.cards.pop(); g.decks[dk].push(DECKS[dk].findIndex(c => c.free)); }
      p.jail = 0; say(g, ev, `${p.name} uses a Get Out of Jail Free card`); break;
    case 'buy': {
      if (g.phase !== 'buy' || who !== g.turn) return err('Nothing to buy');
      const pos = g.pending.pos, s = sp(pos);
      if (p.cash < s.price) return err(`You need ${money(s.price)}`);
      p.cash -= s.price; g.owner[pos] = who; g.pending = null;
      say(g, ev, `${p.name} buys ${s.name} for ${money(s.price)}`, { t: 'buy', pi: who, pos, amt: s.price });
      settle(g); break;
    }
    case 'decline': {
      if (g.phase !== 'buy' || who !== g.turn) return err('Nothing to pass on');
      const pos = g.pending.pos;
      if (g.opts.auction) startAuction(g, pos, ev);
      else { g.pending = null; say(g, ev, `${p.name} passes on ${sp(pos).name}`); settle(g); }
      break;
    }
    case 'bid': {
      const A = g.auction;
      if (g.phase !== 'auction' || who !== A.active[A.at]) return err('Not your bid');
      const amt = Math.floor(a.amt);
      if (!(amt > A.high)) return err(`Bid more than ${money(A.high)}`);
      if (amt > p.cash) return err(`You only have ${money(p.cash)}`);
      A.high = amt; A.bidder = who; A.at = (A.at + 1) % A.active.length;
      say(g, ev, `${p.name} bids ${money(amt)}`, { t: 'bid', pi: who, amt });
      auctionAdvance(g, ev); break;
    }
    case 'pass': {
      const A = g.auction;
      if (g.phase !== 'auction' || who !== A.active[A.at]) return err('Not your bid');
      A.active.splice(A.at, 1);
      say(g, ev, `${p.name} drops out`, { t: 'drop', pi: who });
      auctionAdvance(g, ev); break;
    }
    case 'build': if (!manageOk(g, who) || !build(g, who, a.pos, ev)) return err("Can't build there"); break;
    case 'sell': if (!manageOk(g, who, true) || !sell(g, who, a.pos, ev)) return err("Can't sell there"); break;
    case 'mortgage': if (!manageOk(g, who, true) || !mortgage(g, who, a.pos, ev)) return err("Can't mortgage that"); break;
    case 'unmortgage': if (!manageOk(g, who) || !unmortgage(g, who, a.pos, ev)) return err("Can't pay that off"); break;
    case 'payDebt': {
      if (g.phase !== 'debt') return err('No debts');
      const d = g.debts[0];
      if (who !== d.pi) return err('Not your debt');
      if (p.cash < d.amt) return err(`Raise ${money(d.amt - p.cash)} more first`);
      g.debts.shift(); transfer(g, who, d.to === 'pot' && !g.opts.parking ? 'bank' : d.to, d.amt);
      say(g, ev, `${p.name} pays ${money(d.amt)}${typeof d.to === 'number' ? ' to ' + g.players[d.to].name : ''} — ${d.why}`, { t: 'pay', pi: who, to: d.to, amt: d.amt });
      settle(g); break;
    }
    case 'bankrupt':
      if (g.phase !== 'debt' || who !== g.debts[0].pi) return err('Only when you owe more than you can pay');
      bankrupt(g, who, ev); settle(g); break;
    case 'end':
      if (g.phase !== 'done' || who !== g.turn) return err('Not done yet');
      nextTurn(g, ev); break;
    case 'offer': {
      const t = a.trade;
      if (!['roll', 'done'].includes(g.phase) || t.from !== g.turn) return err('Trade on your turn, before you roll or when you\'re done');
      const e = tradeError(g, t); if (e) return err(e);
      g.offer = t; g.offered = true;
      say(g, ev, `${g.players[t.from].name} offers ${g.players[t.to].name} a trade: ${describe(g, t.give)} for ${describe(g, t.get)}`, { t: 'offer', trade: t }); break;
    }
    case 'answer': {
      const t = g.offer;
      if (!t || who !== t.to) return err('No trade to answer');
      g.offer = null;
      const key = t.from + '>' + t.to + ':' + t.get.props.join(',');
      g.memo[key] = g.turns;
      if (a.yes) { const e = tradeError(g, t); if (e) { say(g, ev, `The trade fell through: ${e}`); break; } doTrade(g, t, ev); }
      else say(g, ev, `${g.players[t.to].name} turns down the trade`, { t: 'decline', from: t.from, to: t.to });
      break;
    }
    default: return err('Unknown move');
  }
  return ev;
}
// You manage your own lots on your turn (and anyone may raise cash while they owe money)
function manageOk(g, pi, raising) {
  if (g.phase === 'debt') return raising && g.debts[0] && g.debts[0].pi === pi;
  return pi === g.turn && ['roll', 'done', 'buy'].includes(g.phase);
}

// ---------- bots ----------
// level: easy (careless), normal, hard (keeps cash for rent, trades shrewdly, builds to three houses first)
const RESERVE = { easy: 40, normal: 120, hard: 100 };
function danger(g, pi) {   // the biggest rent an opponent could hit this player with right now
  let m = 0;
  for (const i of OWNABLE) { const o = g.owner[i]; if (o == null || o === pi || g.mortgaged[i]) continue; m = Math.max(m, sp(i).type === 'util' ? (utilCount(g, o) === 2 ? 70 : 28) : rent(g, i, 7)); }
  return m;
}
function reserve(g, pi) {
  const lv = g.players[pi].level;
  if (lv === 'easy') return RESERVE.easy;
  const d = danger(g, pi);
  return Math.min(lv === 'hard' ? 500 : 450, Math.max(RESERVE[lv], d * (lv === 'hard' ? 0.45 : 0.5)));
}
// How much a player values owning the lots in `set` (a group-aware score; complete groups are worth a lot more)
function holdings(g, pi, override) {
  const own = i => (override && i in override ? override[i] : g.owner[i]) === pi;
  let v = 0;
  for (const [grp, lots] of Object.entries(GROUP_OF)) {
    const mine = lots.filter(own);
    if (!mine.length) continue;
    const base = mine.reduce((a, i) => a + sp(i).price, 0);
    if (grp === 'rr') v += base * [0, 1, 1.25, 1.6, 2.2][mine.length];
    else if (grp === 'util') v += base * (mine.length === 2 ? 1.3 : 1);
    else if (mine.length === lots.length) v += base * 3.2;                          // a monopoly: houses can go up
    else {
      // partial groups are worth a bit more when nobody else is in the group (still in reach)
      const others = lots.filter(i => !own(i) && (override && i in override ? override[i] : g.owner[i]) != null).length;
      v += base * (others ? 1 : 1.15);
    }
  }
  return v;
}
// The change in a player's position after a trade, net of what it does for the other side.
function tradeScore(g, pi, t, k) {
  const ov = {}; t.give.props.forEach(i => ov[i] = t.to); t.get.props.forEach(i => ov[i] = t.from);
  const other = pi === t.from ? t.to : t.from;
  const cashIn = pi === t.from ? t.get.cash - t.give.cash : t.give.cash - t.get.cash;
  const cardsIn = (pi === t.from ? t.get.cards - t.give.cards : t.give.cards - t.get.cards) * 40;
  const fee = (pi === t.from ? t.get.props : t.give.props).filter(i => g.mortgaged[i]).reduce((a, i) => a + mortgageValue(i) * 0.1, 0);
  const mine = holdings(g, pi, ov) - holdings(g, pi);
  const theirs = holdings(g, other, ov) - holdings(g, other);
  return mine + cashIn + cardsIn - fee - k * theirs;
}
const SHREWD = { easy: 0.25, normal: 0.55, hard: 0.6 };
function botAccepts(g, pi, t) {
  const lv = g.players[pi].level;
  const s = tradeScore(g, pi, t, SHREWD[lv]);
  if (g.players[pi].cash + (pi === t.to ? t.give.cash - t.get.cash : 0) < 0) return false;
  return s > (lv === 'hard' ? 40 : lv === 'normal' ? 15 : -20);
}
// Look for a deal that completes one of this bot's groups.
function botFindTrade(g, pi, rng) {
  const me = g.players[pi], lv = me.level;
  if (lv === 'easy') return null;
  const spare = me.cash - reserve(g, pi);
  for (const [grp, lots] of Object.entries(GROUP_OF)) {
    if (grp === 'util') continue;
    const missing = lots.filter(i => g.owner[i] !== pi);
    if (missing.length !== 1 || lots.length - missing.length < 1 || (grp === 'rr' && lots.length - missing.length < 2)) continue;
    const want = missing[0], q = g.owner[want];
    if (q == null || g.players[q].out || groupBuilt(g, grp)) continue;
    const key = pi + '>' + q + ':' + want;
    if (g.memo[key] != null && g.turns - g.memo[key] < (g.players[q].bot ? 6 : 12) * g.players.length) continue;
    // candidate sweeteners: lots of ours that help them (complete or extend one of their groups)
    const mineFree = owned(g, pi).filter(i => i !== want && !(sp(i).type === 'prop' && (groupBuilt(g, sp(i).group) || ownsGroup(g, pi, sp(i).group))) && GROUP_OF[sp(i).group].some(j => g.owner[j] === q));
    const sweet = [[]].concat(mineFree.map(i => [i]));
    const k = g.players[q].bot ? SHREWD[g.players[q].level] : 0.3;      // a person is easier to talk into a fair-looking deal
    for (const give of sweet) {
      for (let cash = 0; cash <= Math.max(0, spare); cash += 20) {
        const t = { from: pi, to: q, give: { cash, props: give, cards: 0 }, get: { cash: 0, props: [want], cards: 0 } };
        if (tradeError(g, t)) break;
        if (tradeScore(g, pi, t, SHREWD[lv]) <= 30) break;                 // no longer worth it to us
        const theirs = tradeScore(g, q, t, k);
        if (g.players[q].bot ? botAccepts(g, q, t) : theirs > 0) return t;
      }
    }
  }
  return null;
}
function wantScore(g, pi, pos) {
  const s = sp(pos), lots = GROUP_OF[s.group];
  const mine = lots.filter(i => g.owner[i] === pi).length;
  const theirs = {}; lots.forEach(i => { const o = g.owner[i]; if (o != null && o !== pi) theirs[o] = (theirs[o] || 0) + 1; });
  let m = 1;
  if (mine === lots.length - 1) m = 2.2;                                   // completes our group
  else if (mine) m = 1.3;
  if (Object.values(theirs).some(n => n === lots.length - 1)) m = Math.max(m, 1.6);   // blocks someone else's
  if (s.type === 'rr') m = Math.max(m, 1 + 0.25 * rrCount(g, pi));
  if (s.group === 'orange' || s.group === 'red') m *= 1.1;
  return s.price * m;
}
function botBuy(g, pi, pos, rng) {
  const me = g.players[pi], s = sp(pos), lv = me.level;
  if (me.cash < s.price) return false;
  if (lv === 'easy') return me.cash - s.price >= 20 || rng() < 0.3;
  const w = wantScore(g, pi, pos);
  if (w >= s.price * 2) return true;
  if (lv === 'hard' && OWNABLE.filter(i => g.owner[i] == null).length > 10) return me.cash - s.price >= 50;   // early on, own everything
  return me.cash - s.price >= reserve(g, pi) * (w > s.price ? 0.6 : 1);
}
function botMaxBid(g, pi, pos, rng) {
  const me = g.players[pi], lv = me.level, s = sp(pos);
  const cap = me.cash - (lv === 'easy' ? 0 : reserve(g, pi) * 0.5);
  const base = lv === 'easy' ? s.price * (0.6 + rng() * 0.5) : wantScore(g, pi, pos) * (lv === 'hard' ? 1.05 : 0.95);
  return Math.max(0, Math.floor(Math.min(cap, base)));
}
// Pick something to sell or mortgage to raise cash: lone lots first, then houses, then monopolies.
function raiseStep(g, pi) {
  const mine = owned(g, pi);
  const mort = mine.filter(i => canMortgage(g, pi, i));
  const loners = mort.filter(i => !(sp(i).type === 'prop' && ownsGroup(g, pi, sp(i).group)));
  if (loners.length) return { a: 'mortgage', pos: loners.sort((a, b) => wantScore(g, pi, a) - wantScore(g, pi, b))[0] };
  const sells = mine.filter(i => canSell(g, pi, i));
  if (sells.length) return { a: 'sell', pos: sells.sort((a, b) => sp(a).house - sp(b).house || g.houses[b] - g.houses[a])[0] };
  if (mort.length) return { a: 'mortgage', pos: mort.sort((a, b) => sp(a).price - sp(b).price)[0] };
  return null;
}
function botBuild(g, pi) {
  const me = g.players[pi], lv = me.level, res = reserve(g, pi);
  const opts = owned(g, pi).filter(i => canBuild(g, pi, i) && me.cash - sp(i).house >= (lv === 'easy' ? 60 : res));
  if (!opts.length) return null;
  // build up the group where the next building adds the most rent per dollar; hard bots race to three houses
  const gainOf = i => { const s = sp(i), h = g.houses[i]; return (s.rent[h + 1] - (h ? s.rent[h] : s.rent[0] * 2)) / s.house * (lv === 'hard' && h < 3 ? 1.5 : 1); };
  opts.sort((a, b) => gainOf(b) - gainOf(a) || g.houses[a] - g.houses[b]);
  return { a: 'build', pos: opts[0] };
}
function botUnmortgage(g, pi) {
  const me = g.players[pi];
  const list = owned(g, pi).filter(i => g.mortgaged[i] && me.cash - unmortgageCost(i) >= reserve(g, pi) + 150);
  if (!list.length) return null;
  list.sort((a, b) => wantScore(g, pi, b) - wantScore(g, pi, a));
  return { a: 'unmortgage', pos: list[0] };
}
function botStaysInJail(g, pi) {
  const lv = g.players[pi].level;
  const unowned = OWNABLE.filter(i => g.owner[i] == null).length;
  if (lv === 'easy') return true;
  if (lv === 'hard') return unowned < 6 && danger(g, pi) >= 300;       // late game: jail is the safest square
  return unowned < 4 && danger(g, pi) >= 400;
}
// The next move for whichever bot has to decide (actor(g)). Always legal.
function botAction(g, rng) {
  rng = R(rng);
  const pi = actor(g), me = g.players[pi];
  if (g.offer) return { a: 'answer', pi, yes: botAccepts(g, pi, g.offer) };
  switch (g.phase) {
    case 'debt': {
      if (me.cash >= g.debts[0].amt) return { a: 'payDebt', pi };
      if (liquid(g, pi) < debtOf(g, pi)) return { a: 'bankrupt', pi };
      return Object.assign({ pi }, raiseStep(g, pi) || { a: 'bankrupt' });
    }
    case 'auction': {
      const A = g.auction, max = botMaxBid(g, pi, A.pos, rng);
      const step = A.high < 100 ? 10 : A.high < 300 ? 20 : 25;
      const bid = Math.min(max, A.high + step);
      return bid > A.high && bid >= 10 ? { a: 'bid', pi, amt: bid } : { a: 'pass', pi };
    }
    case 'buy': return { a: botBuy(g, pi, g.pending.pos, rng) ? 'buy' : 'decline', pi };
    case 'roll': case 'done': {
      const u = botUnmortgage(g, pi); if (u) return Object.assign({ pi }, u);
      const b = botBuild(g, pi); if (b) return Object.assign({ pi }, b);
      if (!g.offered && rng() < (me.level === 'hard' ? 0.7 : 0.4)) {
        g.offered = true;            // one look per turn
        const t = botFindTrade(g, pi, rng); if (t) return { a: 'offer', pi, trade: t };
      }
      if (g.phase === 'done') return { a: 'end', pi };
      if (me.jail && !g.dice && !botStaysInJail(g, pi)) {
        if (me.cards.length) return { a: 'jailCard', pi };
        if (me.cash >= JAIL_FINE + reserve(g, pi) * 0.5) return { a: 'payJail', pi };
      }
      return { a: 'roll', pi };
    }
  }
  return { a: 'end', pi };
}
// "Raise it for me": the bot's choice of what to sell or mortgage next (null when nothing is left)
const autoRaise = (g, pi) => raiseStep(g, pi);

const api = { SPACES, GROUPS, GROUP_OF, OWNABLE, CHANCE, CHEST, DEFAULTS, JAIL, JAIL_FINE, HOUSES, HOTELS, TOKENS, RR_RENT,
  newGame, act, actor, botAction, botAccepts, autoRaise, rent, rentNow, worth, liquid, debtOf, owned, ownsGroup, groupBuilt,
  canBuild, canSell, canMortgage, canUnmortgage, mortgageValue, unmortgageCost, tradeError, describe, alive, money, reserve };
if (typeof module !== 'undefined') module.exports = api; else root.MONO = api;
})(this);
