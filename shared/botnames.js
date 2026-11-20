// Shared bot-name generator, inlined into every game page by scripts/build-site.js.
//   GNBotNames.pick(3, ['Austin'])  ->  e.g. ['Mabel', 'Captain Gus', 'Lefty']
// Names are random each game, never repeat within a game, never match a human's name,
// and skip the names used in the last couple of games so the table feels fresh.
(function (root) {
  'use strict';
  const FIRST = ['Rosie', 'Gus', 'Mabel', 'Otto', 'Juno', 'Pip', 'Hank', 'Lou', 'Bev', 'Dot', 'Ruth', 'Earl', 'Midge', 'Walt', 'Opal', 'Fern',
    'Sal', 'Vern', 'Iris', 'Moe', 'Nell', 'Cy', 'Tess', 'Abe', 'Lola', 'Ziggy', 'Bea', 'Murph', 'Ida', 'Rex', 'Gert', 'Flo', 'Ned', 'Wanda',
    'Chet', 'Peg', 'Dewey', 'Hazel', 'Barney', 'Trixie', 'Clem', 'Goldie', 'Roscoe', 'Winnie', 'Mort', 'Pearl', 'Lenny', 'Dottie', 'Boris',
    'Maude', 'Skip', 'Lulu', 'Harvey', 'Edna', 'Jinx', 'Marge', 'Stan', 'Nora', 'Biff', 'Olive', 'Elmo', 'Tilly', 'Duke', 'Penny', 'Floyd', 'Velma'];
  const NICK = ['Lucky', 'Ace', 'Lefty', 'Slim', 'Sparky', 'Boomer', 'Pickles', 'Noodle', 'Biscuit', 'Moose', 'Tater', 'Snickers', 'Scooter',
    'Big Mike', 'Granny', 'Doc', 'Coach', 'Sarge', 'Tiny', 'Cookie', 'Buttons', 'Waffles', 'Pepper', 'Ziggy', 'Dice Man', 'The Dealer'];
  const TITLE = ['Captain', 'Aunt', 'Uncle', 'Professor', 'Grandma', 'Grandpa', 'Cousin', 'Lady', 'Sir', 'Coach'];
  const KEY = 'gn.botnames.recent';
  function recent() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function remember(names) { try { localStorage.setItem(KEY, JSON.stringify(names.concat(recent()).slice(0, 10))); } catch (e) {} }
  function one(rng) {
    const r = rng();
    if (r < 0.62) return FIRST[Math.floor(rng() * FIRST.length)];
    if (r < 0.88) return NICK[Math.floor(rng() * NICK.length)];
    return TITLE[Math.floor(rng() * TITLE.length)] + ' ' + FIRST[Math.floor(rng() * FIRST.length)];
  }
  function pick(n, avoid, rng) {
    rng = rng || Math.random;
    const lower = s => String(s || '').trim().toLowerCase();
    const taken = new Set((avoid || []).map(lower));
    const old = new Set(recent().map(lower));
    const out = [];
    for (let tries = 0; out.length < n && tries < 500; tries++) {
      const nm = one(rng), k = lower(nm);
      if (nm.length > 12 || taken.has(k) || (tries < 300 && old.has(k))) continue;   // fits every game's name spots
      taken.add(k); out.push(nm);
    }
    while (out.length < n) out.push('Bot ' + (out.length + 1));
    remember(out);
    return out;
  }
  const api = { pick };
  if (typeof module !== 'undefined') module.exports = api;
  root.GNBotNames = api;
})(typeof window !== 'undefined' ? window : this);
