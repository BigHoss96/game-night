// Tap 4 rules engine — pure logic, no DOM. Works in browser and Node.
const Tap4 = (() => {
  const NUM = 'num', IN = 'in', OUT = 'out';
  const POINTS = c => c.t === NUM ? c.v : c.t === IN ? 20 : 30;

  function buildDeck() {
    const d = []; let id = 0;
    for (let v = 1; v <= 12; v++) for (let k = 0; k < 8; k++) d.push({ id: id++, t: NUM, v });
    for (let k = 0; k < 11; k++) d.push({ id: id++, t: IN });
    for (let k = 0; k < 7; k++) d.push({ id: id++, t: OUT });
    return d;
  }
  function shuffle(a, rng = Math.random) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ---- helpers on a player ----
  const pileTop = pile => pile.length ? pile[pile.length - 1] : null;
  function cardsLeft(p) { return p.hand.length + p.piles.reduce((a, pl) => a + pl.length, 0); }
  // Every card still counting against a player: hand plus all pile cards, face-down included.
  function leftovers(p) {
    return [...p.hand.map(c => ({ c, down: false })), ...p.piles.flatMap(pl => pl.map(s => ({ c: s.c, down: !s.up })))];
  }
  function scoreOf(p) { return p.hand.reduce((a, c) => a + POINTS(c), 0) + p.piles.reduce((a, pl) => a + pl.reduce((b, s) => b + POINTS(s.c), 0), 0); }
  // Cards the player can play like hand cards: hand + face-up pile tops
  function available(p) {
    const out = p.hand.map(c => ({ c, from: 'hand' }));
    p.piles.forEach((pl, i) => { const t = pileTop(pl); if (t && t.up) out.push({ c: t.c, from: 'pile', pile: i }); });
    return out;
  }

  // ---------- Game ----------
  class Game {
    constructor(seats, opts = {}) {
      this.rng = opts.rng || Math.random;
      this.players = seats.map((s, i) => ({
        id: i, name: s.name, kind: s.kind || 'bot', level: s.level || 'normal',
        total: 0, hand: [], piles: [], outs: [], lastScore: 0,
      }));
      this.target = opts.target || 150;
      this.stack = []; this.discard = []; this.aside = [];
      this.starter = opts.starter ?? Math.floor(this.rng() * seats.length);
      this.round = 0; this.over = false; this.winners = []; this.roundOver = false; this.outPlayer = null;
      this.turnIdx = null;
      this.emit = opts.emit || (async () => {});
      this.agents = opts.agents || BotAgents;
    }
    get twoP() { return this.players.length === 2; }
    top() { return this.stack.length ? this.stack[this.stack.length - 1] : null; }
    topRun() { // how many of the same number sit on top of the stack
      const t = this.top(); if (!t) return 0;
      let n = 0; for (let i = this.stack.length - 1; i >= 0 && this.stack[i].v === t.v; i--) n++;
      return n;
    }
    next(i) { return (i + 1) % this.players.length; }

    snapshot(phase) {
      const cp = x => JSON.parse(JSON.stringify(x));
      return { v: 1, phase, players: cp(this.players), stack: cp(this.stack), discard: cp(this.discard), aside: cp(this.aside),
        starter: this.starter, round: this.round, target: this.target, turnIdx: this.turnIdx, over: this.over };
    }
    static restore(snap, opts = {}) {
      const g = new Game(snap.players.map(p => ({ name: p.name, kind: p.kind, level: p.level })), { ...opts, target: snap.target });
      g.players = snap.players;
      Object.assign(g, { stack: snap.stack, discard: snap.discard, aside: snap.aside, starter: snap.starter, round: snap.round, turnIdx: snap.turnIdx, over: snap.over });
      return g;
    }

    async run(resume) {
      while (!this.over) { await this.playRound(resume); resume = null; }
      await this.emit('gameEnd', { winners: this.winners });
    }

    deal() {
      const deck = shuffle(buildDeck(), this.rng);
      const n = this.players.length, per = this.twoP ? 27 : 19;
      this.stack = []; this.discard = []; this.aside = [];
      for (const p of this.players) {
        const cards = deck.splice(0, per);
        p.outs = []; p.lastScore = 0;
        p.piles = [[], [], [], []];
        const layers = this.twoP ? 2 : 1;
        for (let L = 0; L < layers; L++) {
          for (let i = 0; i < 4; i++) p.piles[i].push({ c: cards.shift(), up: false });
          for (let i = 0; i < 4; i++) p.piles[i].push({ c: cards.shift(), up: true });
        }
        p.hand = cards; // 11 cards
      }
      this.aside = deck;
    }

    async playRound(resume) {
      this.roundOver = false; this.outPlayer = null;
      let idx;
      if (resume && resume.phase === 'turn') {
        idx = resume.turnIdx;
        await this.emit('resume', {});
      } else {
        this.round++;
        this.deal();
        idx = this.starter;
        await this.emit('roundStart', { round: this.round, starter: this.players[idx] });
      }
      let guard = 0;
      while (!this.roundOver && guard++ < 3000) {
        this.turnIdx = idx;
        await this.takeTurn(this.players[idx]);
        idx = this.next(idx);
      }
      this.turnIdx = null;
      if (!this.roundOver) { this.stalled = true; await this.emit('stalled', {}); }
      await this.endRound();
    }

    // ----- moving cards -----
    removeFromPlayer(p, id) {
      let i = p.hand.findIndex(c => c.id === id);
      if (i >= 0) return p.hand.splice(i, 1)[0];
      for (const pl of p.piles) { const t = pileTop(pl); if (t && t.up && t.c.id === id) return pl.pop().c; }
      throw new Error('card not available: ' + id);
    }
    isAvailable(p, id) { return available(p).some(a => a.c.id === id); }
    checkOut(p) { if (cardsLeft(p) === 0) { this.roundOver = true; this.outPlayer = p; return true; } return false; }

    legal(p, ctx) {
      const top = this.top();
      const avail = available(p);
      const nums = avail.filter(a => a.c.t === NUM && (!top || a.c.v <= top.v));
      const values = [...new Set(nums.map(a => a.c.v))].sort((a, b) => b - a);
      return {
        values,                                     // number values you may play now
        flips: p.piles.map((pl, i) => { const t = pileTop(pl); return t && !t.up ? i : -1; }).filter(i => i >= 0),
        tapIns: avail.filter(a => a.c.t === IN).map(a => a.c.id),
        tapOuts: avail.filter(a => a.c.t === OUT).map(a => a.c.id),
        canPickup: this.stack.length > 0,
        outTargets: this.twoP ? [] : this.players.filter(q => q !== p && cardsLeft(q) > 0).map(q => q.id),
        ctx,
      };
    }

    async takeTurn(p) {
      await this.emit('turn', { p });
      if (p.outs.length) {
        const L = this.legal(p, {});
        const tin = L.tapIns.length ? await this.agents.cancelSkip(this, p, L.tapIns) : null;
        const out = p.outs.shift();
        if (tin != null) {
          const c = this.removeFromPlayer(p, tin);
          this.discard.push(c, out);
          await this.emit('cancelSkip', { p, card: c });
          if (this.checkOut(p)) return;
        } else {
          this.discard.push(out);
          await this.emit('skipped', { p });
          return;
        }
      }
      let ctx = { fresh: this.stack.length === 0 };
      for (let step = 0; step < 200; step++) {
        if (this.roundOver) return;
        const L = this.legal(p, ctx);
        const act = await this.agents.action(this, p, L);
        const cont = await this.doAction(p, act, L);
        if (this.roundOver || !cont) return;
        ctx = cont;
      }
    }

    // Returns a new ctx if the turn continues, or null if it ends.
    async doAction(p, act, L) {
      switch (act.type) {
        case 'play': {
          const ids = act.ids;
          if (!ids || !ids.length) throw new Error('empty play');
          const cards = ids.map(id => { if (!this.isAvailable(p, id)) throw new Error('unavailable ' + id); return null; });
          const v = (p.hand.find(c => c.id === ids[0]) || available(p).find(a => a.c.id === ids[0]).c).v;
          const top = this.top();
          if (top && v > top.v) throw new Error('too high');
          const moved = ids.map(id => this.removeFromPlayer(p, id));
          if (moved.some(c => c.t !== NUM || c.v !== v)) throw new Error('mixed play');
          this.stack.push(...moved);
          await this.emit('play', { p, cards: moved });
          return this.afterNumbers(p);
        }
        case 'flip': {
          const pl = p.piles[act.pile];
          const t = pileTop(pl);
          if (!t || t.up) throw new Error('not face down');
          const c = t.c;
          await this.emit('flip', { p, card: c, pile: act.pile });
          pl.pop();
          if (c.t === NUM) {
            const top = this.top();
            if (!top || c.v <= top.v) {
              this.stack.push(c);
              await this.emit('play', { p, cards: [c], flipped: true });
              // may add matching cards from hand / face-up piles
              const match = available(p).filter(a => a.c.t === NUM && a.c.v === c.v).map(a => a.c.id);
              if (match.length && !this.isOutNow(p)) {
                const extra = await this.agents.addMatching(this, p, c.v, match);
                if (extra && extra.length) {
                  const moved = extra.map(id => this.removeFromPlayer(p, id));
                  if (moved.some(x => x.t !== NUM || x.v !== c.v)) throw new Error('bad match');
                  this.stack.push(...moved);
                  await this.emit('play', { p, cards: moved });
                }
              }
              return this.afterNumbers(p);
            }
            // too high: it joins the stack and you pick it all up
            this.stack.push(c);
            await this.emit('flipFail', { p, card: c });
            await this.pickup(p);
            return null;
          }
          if (c.t === IN) return this.tapIn(p, c);
          // flipped Tap Out: use it now
          const L2 = this.legal(p, L.ctx);
          const target = await this.agents.chooseOut(this, p, L2.outTargets, true);
          return this.tapOut(p, c, target);
        }
        case 'tapin': {
          if (!L.tapIns.includes(act.id)) throw new Error('no tap in');
          return this.tapIn(p, this.removeFromPlayer(p, act.id));
        }
        case 'tapout': {
          if (!L.tapOuts.includes(act.id)) throw new Error('no tap out');
          if (act.target != null && !L.outTargets.includes(act.target)) throw new Error('bad target');
          if (act.target == null && L.ctx.afterOut && !this.twoP) throw new Error('must play to the stack after a Tap Out');
          return this.tapOut(p, this.removeFromPlayer(p, act.id), act.target);
        }
        case 'pickup': {
          if (!this.stack.length) throw new Error('nothing to pick up');
          await this.pickup(p);
          return null;
        }
      }
      throw new Error('unknown action ' + act.type);
    }

    isOutNow(p) { return cardsLeft(p) === 0; }

    async afterNumbers(p) {
      if (this.checkOut(p)) { await this.emit('wentOut', { p }); return null; }
      if (this.topRun() >= 4) {
        const n = this.topRun(), v = this.top().v;
        await this.emit('tapped', { p, v, n, by: 'four' });
        this.discard.push(...this.stack); this.stack = [];
        await this.emit('stackCleared', { p });
        return { fresh: true };
      }
      return null; // turn ends
    }

    async tapIn(p, c) {
      this.discard.push(c);
      await this.emit('tapped', { p, by: 'tapin', card: c });
      this.discard.push(...this.stack); this.stack = [];
      await this.emit('stackCleared', { p });
      if (this.checkOut(p)) { await this.emit('wentOut', { p }); return null; }
      return { fresh: true };
    }

    async tapOut(p, c, targetId) {
      if (targetId == null || this.twoP) {
        this.discard.push(c);
        await this.emit('tapOutSelf', { p, card: c });
        if (this.checkOut(p)) await this.emit('wentOut', { p });
        return null;
      }
      const q = this.players[targetId];
      q.outs.push(c);
      await this.emit('tapOutOther', { p, to: q, card: c });
      if (this.checkOut(p)) { await this.emit('wentOut', { p }); return null; }
      return { afterOut: true, fresh: this.stack.length === 0 };
    }

    async pickup(p) {
      const n = this.stack.length;
      p.hand.push(...this.stack); this.stack = [];
      await this.emit('pickup', { p, n });
    }

    async endRound() {
      for (const q of this.players) { this.discard.push(...q.outs); q.outs = []; }
      for (const p of this.players) { p.lastScore = scoreOf(p); p.total += p.lastScore; }
      const max = Math.max(...this.players.map(p => p.total));
      if (max >= this.target) {
        this.over = true;
        const min = Math.min(...this.players.map(p => p.total));
        this.winners = this.players.filter(p => p.total === min);
      }
      this.starter = this.next(this.starter);
      await this.emit('roundEnd', { out: this.outPlayer, over: this.over });
    }
  }

  // ---------- Bots ----------
  // Unknown cards from p's point of view (for estimating face-down flips)
  function unknownPool(g, p) {
    const counts = { num: Array(13).fill(0), in: 11, out: 7 };
    for (let v = 1; v <= 12; v++) counts.num[v] = 8;
    const seen = c => { if (c.t === NUM) counts.num[c.v]--; else if (c.t === IN) counts.in--; else counts.out--; };
    p.hand.forEach(seen);
    g.stack.forEach(seen); g.discard.forEach(seen);
    for (const q of g.players) { q.piles.forEach(pl => pl.forEach(s => { if (s.up) seen(s.c); })); q.outs.forEach(seen); }
    return counts;
  }
  function flipOdds(g, p) {
    const u = unknownPool(g, p), top = g.top();
    let good = u.in + u.out, total = u.in + u.out;
    for (let v = 1; v <= 12; v++) { total += u.num[v]; if (!top || v <= top.v) good += u.num[v]; }
    return total ? good / total : 0;
  }
  function idsOfValue(p, v) {
    // prefer pile cards first (unlocks face-downs), then hand
    const av = available(p).filter(a => a.c.t === NUM && a.c.v === v);
    av.sort((a, b) => (a.from === 'pile' ? -1 : 1) - (b.from === 'pile' ? -1 : 1));
    return av.map(a => a.c.id);
  }
  function countOf(p, v) { return idsOfValue(p, v).length; }

  const Bot = {
    action(g, p, L) {
      const rng = g.rng;
      const top = g.top();
      const lvl = p.level;
      const left = cardsLeft(p);
      const minOpp = Math.min(...g.players.filter(q => q !== p).map(cardsLeft));

      if (lvl === 'easy') {
        const opts = [];
        L.values.forEach(v => opts.push({ type: 'play', ids: idsOfValue(p, v) }));
        if (L.ctx.fresh || !top) L.flips.forEach(i => opts.push({ type: 'flip', pile: i }));
        if (opts.length) return opts[Math.floor(rng() * opts.length)];
        if (L.tapIns.length && g.stack.length) return { type: 'tapin', id: L.tapIns[0] };
        if (L.tapOuts.length && !L.ctx.afterOut) return { type: 'tapout', id: L.tapOuts[0], target: null };
        if (L.flips.length && rng() < 0.4) return { type: 'flip', pile: L.flips[0] };
        if (L.canPickup) return { type: 'pickup' };
        if (L.tapIns.length) return { type: 'tapin', id: L.tapIns[0] };
        if (L.flips.length) return { type: 'flip', pile: L.flips[0] };
        return { type: 'tapout', id: L.tapOuts[0], target: L.outTargets[0] ?? null };
      }

      // A little unpredictability keeps bots from looping in lock-step endgames
      if (L.values.length > 1 && rng() < (lvl === 'hard' ? 0.08 : 0.15)) {
        const v = L.values[Math.floor(rng() * L.values.length)];
        return { type: 'play', ids: idsOfValue(p, v) };
      }

      // Tap Out a player who is close to going out (then keep playing)
      if (L.tapOuts.length && L.outTargets.length && !L.ctx.afterOut) {
        const threshold = lvl === 'hard' ? 6 : 4;
        const victims = L.outTargets.map(id => g.players[id]).filter(q => cardsLeft(q) <= threshold && !q.outs.length);
        const canFollow = L.values.length || L.flips.length || !top;
        if (victims.length && canFollow) {
          victims.sort((a, b) => cardsLeft(a) - cardsLeft(b));
          return { type: 'tapout', id: L.tapOuts[0], target: victims[0].id };
        }
      }

      // 1) Tap the stack with four of a kind if we can
      if (top) {
        const run = g.topRun();
        const mine = countOf(p, top.v);
        if (mine && run + mine >= 4) return { type: 'play', ids: idsOfValue(p, top.v) };
      }

      // 2) Starting a fresh stack: flip a face-down first (it can't miss)
      if (!top) {
        if (L.flips.length) return { type: 'flip', pile: L.flips[0] };
        if (L.values.length) {
          // most copies, then highest value (high cards are hardest to shed later)
          let best = L.values[0], bs = -1;
          for (const v of L.values) {
            const s = countOf(p, v) * 20 + v + (lvl === 'hard' && countOf(p, v) >= 4 ? 100 : 0);
            if (s > bs) { bs = s; best = v; }
          }
          return { type: 'play', ids: idsOfValue(p, best) };
        }
        if (L.tapIns.length) return { type: 'tapin', id: L.tapIns[0] };
        if (L.tapOuts.length) return { type: 'tapout', id: L.tapOuts[0], target: L.ctx.afterOut && !g.twoP ? L.outTargets[0] : null };
        throw new Error('bot has no move');
      }

      // 3) Big stack and a Tap In in hand: clear it rather than feed it
      if (L.tapIns.length && (g.stack.length >= (lvl === 'hard' ? 5 : 7) || (!L.values.length && g.stack.length >= 2))) {
        return { type: 'tapin', id: L.tapIns[0] };
      }

      // 4) Play a number: highest playable, all copies (hard keeps a low card when it has few)
      if (L.values.length) {
        let v = L.values[0];
        if (lvl === 'hard' && L.values.length > 1 && left > 3) {
          // prefer a value we hold several of, among the higher half
          const scored = L.values.map(x => ({ x, s: x + countOf(p, x) * 3 }));
          scored.sort((a, b) => b.s - a.s); v = scored[0].x;
        }
        return { type: 'play', ids: idsOfValue(p, v) };
      }

      // 5) Nothing playable: dodge the pickup if we can
      if (L.tapIns.length) return { type: 'tapin', id: L.tapIns[0] };
      if (L.tapOuts.length && !L.ctx.afterOut) return { type: 'tapout', id: L.tapOuts[0], target: null };
      if (L.flips.length) {
        const odds = flipOdds(g, p);
        const risk = lvl === 'hard' ? 0.3 : 0.4;
        if (odds >= risk || g.stack.length <= 2 || left <= 4) return { type: 'flip', pile: L.flips[0] };
      }
      if (L.canPickup) return { type: 'pickup' };
      if (L.flips.length) return { type: 'flip', pile: L.flips[0] };
      if (L.tapOuts.length) return { type: 'tapout', id: L.tapOuts[0], target: L.outTargets[0] ?? null };
      throw new Error('bot has no move');
    },
    cancelSkip(g, p, tapIns) {
      if (p.level === 'easy') return g.rng() < 0.5 ? tapIns[0] : null;
      return tapIns[0];
    },
    addMatching(g, p, v, ids) { return p.level === 'easy' && g.rng() < 0.3 ? [] : ids; },
    chooseOut(g, p, targets, flipped) {
      if (!targets.length) return null;
      if (p.level === 'easy') return g.rng() < 0.5 ? null : targets[Math.floor(g.rng() * targets.length)];
      const L = g.legal(p, {});
      const canFollow = L.values.length || L.flips.length || !g.top();
      if (!canFollow) return null; // skip ourselves instead of being forced to pick up
      const ts = targets.map(id => g.players[id]).sort((a, b) => cardsLeft(a) - cardsLeft(b));
      return ts[0].id;
    },
  };
  const BotAgents = {
    action: async (g, p, L) => Bot.action(g, p, L),
    cancelSkip: async (g, p, t) => Bot.cancelSkip(g, p, t),
    addMatching: async (g, p, v, ids) => Bot.addMatching(g, p, v, ids),
    chooseOut: async (g, p, t, f) => Bot.chooseOut(g, p, t, f),
  };

  // ---- wording: a seat named "You" is talked to in the second person ----
  // ("You win!", "You pick up 3 cards", "Gus taps you out"); everyone else by name.
  const isYou = p => !!p && /^you$/i.test(String(p.name || '').trim());
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
  const Say = {
    isYou,
    cap,
    who: (p, lower) => isYou(p) ? (lower ? 'you' : 'You') : p.name,          // You / Rosie
    verb: (p, s, base) => isYou(p) ? base : s,                               // plays / play
    whose: p => isYou(p) ? 'your' : p.name + "'s",                           // your / Rosie's
    their: p => isYou(p) ? 'your' : 'their',                                 // your / their
    is: p => isYou(p) ? 'are' : 'is',
    // "You win!", "Rosie wins!", "You & Gus win!" (you first)
    winners(ws) {
      const list = [...ws].sort((a, b) => (isYou(b) ? 1 : 0) - (isYou(a) ? 1 : 0));
      const names = list.map(w => isYou(w) ? 'You' : w.name).join(' & ');
      return `${names} ${list.length > 1 || isYou(list[0]) ? 'win' : 'wins'}!`;
    },
  };

  // Names for a new game from the setup seats. A blank name falls back to "You" for the
  // only human at the table, "Player N" for other humans and "Bot N" for bots.
  function seatNames(seats) {
    const humans = seats.filter(s => s.kind === 'human').length;
    const first = seats.findIndex(s => s.kind === 'human');
    return seats.map((s, i) => String(s.name || '').trim() ||
      (s.kind === 'bot' ? 'Bot ' + (i + 1) : i === first && humans === 1 ? 'You' : 'Player ' + (i + 1)));
  }

  // Seats for a Rematch: the same table plays again, so every player keeps their name, kind and bot level.
  // (Bots only get fresh names for a brand-new game from the setup screen.)
  function rematchSeats(players) {
    return players.map(p => ({ name: p.name, kind: p.kind, level: p.level }));
  }

  return { Game, Bot, BotAgents, Say, buildDeck, leftovers, seatNames, rematchSeats, available, cardsLeft, scoreOf, pileTop, flipOdds, idsOfValue, POINTS, NUM, IN, OUT };
})();
if (typeof module !== 'undefined') module.exports = Tap4;
