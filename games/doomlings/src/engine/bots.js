/**
 * Bots. A bot answers exactly the requests a player would get, through the same
 * `answer()` call, and only reads what that player could see. Normal and Hard
 * also think a play through: they try each playable trait on a copy of the game,
 * let the real effects resolve, and compare where the scores land.
 *   easy   — mostly random, prefers big cards
 *   normal — plays for its own score
 *   hard   — plays for its lead over the best opponent
 */
function botFindCard(g, uid) {
  for (const p of g.players) { const c = p.hand.find((x) => x.uid === uid) || p.traitPile.find((x) => x.uid === uid); if (c) return { c, owner: p }; }
  const d = (g.discard || []).find((x) => x.uid === uid); return d ? { c: d, owner: null } : null;
}
const botVal = (c) => (c ? faceValue(c) + (isDominant(c) ? 3 : 0) : 0);
const botHarm = (prompt) => /discard|lose|give|remove|return|swap|steal|pass|move it to whose/i.test(prompt || "");

function botAnswer(g, req, who, level, rnd) {
  rnd = rnd || Math.random;
  const me = g.players.find((p) => p.id === who) || seatOf(g);
  const pr = req.prompt || "";
  const opts = req.options || [];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  switch (req.kind) {
    case "colour": {
      const cs = opts.length ? opts : COLOURS;
      if (level === "easy") return pick(cs);
      const count = (col) => me.traitPile.filter((c) => hasColour(c, col)).length;
      const sorted = cs.slice().sort((a, b) => count(b) - count(a));
      return /discard|lose/i.test(pr) ? sorted[sorted.length - 1] : sorted[0];
    }
    case "player": {
      if (!opts.length) return null;
      if (level === "easy") return pick(opts);
      // aim at whoever is doing best (never yourself if there's a choice)
      const others = opts.filter((o) => o.id !== me.id);
      const pool = others.length ? others : opts;
      const score = (o) => { const p = g.players.find((x) => x.id === o.id); return p ? faceScore(p) + (o.handSize || p.hand.length) * 0.3 : 0; };
      return pool.slice().sort((a, b) => score(b) - score(a))[0];
    }
    case "confirm": {
      if (req.acknowledge) return true;
      if (level === "easy") return rnd() < 0.6;
      if (/discard your hand/i.test(pr)) return me.hand.reduce((s, c) => s + botVal(c), 0) / Math.max(1, me.hand.length) < 2.5;
      return true;
    }
    case "cards": {
      const want = req.optional ? 0 : Math.min(req.count ?? 1, opts.length);
      const max = Math.min(req.max ?? Math.max(want, 1), opts.length);
      const byVal = opts.slice().sort((a, b) => botVal((botFindCard(g, a.uid) || {}).c) - botVal((botFindCard(g, b.uid) || {}).c));
      const keepGood = /keep|play|choose .* to (play|keep)|play one/i.test(pr) && !/discard/i.test(pr);
      if (level === "easy") return opts.slice().sort(() => rnd() - 0.5).slice(0, req.optional ? Math.floor(rnd() * (max + 1)) : want);
      const n = req.optional ? (keepGood ? Math.min(1, max) : 0) : want;
      return (keepGood ? byVal.reverse() : byVal).slice(0, n);
    }
    case "trait": {
      const ok = opts.filter((o) => !o.disabled);
      if (!ok.length) return null;
      if (level === "easy") return req.optional && rnd() < 0.3 ? null : pick(ok);
      const mine = (o) => me.traitPile.some((c) => c.uid === o.uid);
      const v = (o) => botVal((botFindCard(g, o.uid) || {}).c);
      // your own trait going away: give up the cheapest. Someone else's: take the best.
      const scored = ok.map((o) => ({ o, s: mine(o) ? (botHarm(pr) ? -v(o) : v(o)) : (botHarm(pr) ? v(o) : -v(o)) }));
      scored.sort((a, b) => b.s - a.s);
      if (req.optional && scored.every((x) => mine(x.o)) && botHarm(pr)) return null;
      return scored[0].o;
    }
    case "reaction": {
      if (!opts.length) return null;
      const p = { easy: 0.3, normal: 0.7, hard: 0.9 }[level] ?? 0.7;
      if (rnd() >= p) return null;
      return opts.slice().sort((a, b) => botVal((botFindCard(g, b.uid) || {}).c) - botVal((botFindCard(g, a.uid) || {}).c))[0];
    }
    case "blind": return Array.from({ length: req.total }, (_, i) => i).sort(() => rnd() - 0.5).slice(0, req.count);
    case "choose": return level === "easy" ? pick(opts) : opts[0];
    default: return null;
  }
}

function botClone(g) {
  const c = JSON.parse(JSON.stringify(Object.assign({}, g, { rng: null, pending: null })));
  c.rng = makeRng((Math.random() * 1e9) >>> 0);
  return c;
}
/** Run a game copy's pending requests to the end with quick answers. */
function botSettle(c, registry) {
  let k = 0;
  while (c.pending && k++ < 200) { const req = c.pending.request; answer(c, botAnswer(c, req, req.playerId != null ? req.playerId : c.activeSeat, "easy")); }
}
/** Scores if the world ended right now. */
function botEstimate(g, registry) {
  const c = botClone(g);
  const gen = scoreGame(c, registry);
  let r = gen.next(), k = 0;
  while (!r.done && k++ < 200) r = gen.next(botAnswer(c, r.value, r.value.playerId != null ? r.value.playerId : c.activeSeat, "easy"));
  return c.scores || [];
}
/** Which trait to play (uid), or null to declare "can't play". */
function botChoosePlay(g, registry, level, rnd) {
  rnd = rnd || Math.random;
  const p = seatOf(g);
  const legal = playableCards(g, p, registry);
  if (!legal.length) return null;
  if (level === "easy") return (rnd() < 0.5 ? legal.slice().sort((a, b) => botVal(b) - botVal(a))[0] : legal[Math.floor(rnd() * legal.length)]).uid;
  let best = null;
  for (const card of legal) {
    let v;
    try {
      const c = botClone(g);
      playTrait(c, card.uid, registry); botSettle(c, registry);
      const sc = botEstimate(c, registry);
      const mine = (sc.find((r) => r.id === p.id) || { total: 0 }).total;
      const rival = Math.max(-99, ...sc.filter((r) => r.id !== p.id).map((r) => r.total));
      v = level === "hard" ? mine - rival * 0.8 : mine;
    } catch (e) { v = botVal(card); }
    v += botVal(card) * 0.15 + rnd() * (level === "hard" ? 0.2 : 0.8);
    if (!best || v > best.v) best = { v, uid: card.uid };
  }
  return best.uid;
}
/** Cards to discard when stabilizing down to the Gene Pool: the weakest first. */
function botStabilizeDiscards(g, p, target) {
  const extra = p.hand.length - target;
  if (extra <= 0) return [];
  return p.hand.slice().sort((a, b) => botVal(a) - botVal(b)).slice(0, extra).map((c) => c.uid);
}
