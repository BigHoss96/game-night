// Flip 7 rules engine — pure logic, no DOM. Works in browser and Node.
const Flip7 = (() => {
  const NUM = 'num', MOD = 'mod', ACT = 'act';

  function buildDeck() {
    const d = []; let id = 0;
    d.push({ id: id++, t: NUM, v: 0 });
    for (let n = 1; n <= 12; n++) for (let k = 0; k < n; k++) d.push({ id: id++, t: NUM, v: n });
    [2, 4, 6, 8, 10].forEach(v => d.push({ id: id++, t: MOD, v: '+' + v, add: v }));
    d.push({ id: id++, t: MOD, v: 'x2', mult: true });
    ['freeze', 'flip3', 'second'].forEach(a => { for (let k = 0; k < 3; k++) d.push({ id: id++, t: ACT, v: a }); });
    return d;
  }

  function shuffle(a, rng = Math.random) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // Points a player would bank right now (busted = 0).
  function roundScore(p) {
    if (p.status === 'busted') return 0;
    let s = p.nums.reduce((a, c) => a + c.v, 0);
    if (p.mods.some(m => m.mult)) s *= 2;
    s += p.mods.reduce((a, m) => a + (m.add || 0), 0);
    if (p.nums.length >= 7) s += 15;
    return s;
  }

  function cardCount(p) { return p.nums.length + p.mods.length + p.acts.length; }

  // ---------- Bots ----------
  function bustOdds(g, p) {
    const pool = g.deck.length ? g.deck : g.discard;
    if (!pool.length) return 0;
    const held = new Set(p.nums.map(c => c.v));
    const bad = pool.filter(c => c.t === NUM && held.has(c.v)).length;
    return bad / pool.length;
  }

  const Bot = {
    decide(g, p) {
      const score = roundScore(p);
      const pb = bustOdds(g, p);
      const rng = g.rng;
      if (p.sc) return true; // a Second Chance makes the next hit safe
      const others = g.players.filter(q => q !== p);
      const bestOther = Math.max(...others.map(q => q.total + (q.status === 'busted' ? 0 : roundScore(q))));
      const mine = p.total + score;
      // Endgame: if banking now wins outright, stay. If someone has already locked a win, push.
      if (mine >= g.target && mine > bestOther) return false;
      const lockedWinner = others.some(q => (q.status === 'stayed' || q.status === 'frozen') && q.total + roundScore(q) >= g.target && q.total + roundScore(q) > mine);
      if (lockedWinner) return true;

      if (p.level === 'easy') {
        const limit = 14 + Math.floor(rng() * 14);
        return score < limit && p.nums.length < 5;
      }
      // normal & hard share the core curve; hard adapts to the scoreboard
      let adj = 0;
      if (p.level === 'hard') {
        const behind = Math.max(...others.map(q => q.total)) - p.total;
        if (behind > 50) adj += 0.04;
        if (p.nums.length === 6) adj += 0.06;
        if (behind < -40) adj -= 0.04;
      }
      // normal
      if (pb >= 0.35 + adj) return false;
      if (score >= 30 && pb >= 0.2 + adj) return false;
      if (score >= 22 && pb >= 0.27 + adj) return false;
      return true;
    },

    choose(g, p, type, cands) {
      const opps = cands.filter(q => q !== p);
      if (!opps.length) return cands[0];
      if (p.level === 'easy') return opps[Math.floor(g.rng() * opps.length)];
      if (type === 'second') {
        return opps.reduce((a, b) => (b.total + roundScore(b) < a.total + roundScore(a) ? b : a));
      }
      if (type === 'freeze') {
        const selfIn = cands.includes(p);
        const myScore = roundScore(p);
        if (selfIn && myScore >= 25 && bustOdds(g, p) >= 0.25) return p;
        // freeze the strongest opponent who has little this round
        let best = opps[0], bv = -Infinity;
        for (const q of opps) { const v = q.total * 0.15 + 25 - roundScore(q) * 1.5; if (v > bv) { bv = v; best = q; } }
        return best;
      }
      // flip3: hand to whoever stands to lose most
      let best = opps[0], bv = -Infinity;
      for (const q of opps) {
        const pb = bustOdds(g, q);
        const risk = 1 - Math.pow(1 - pb, 3);
        const v = risk * (roundScore(q) + 5) + q.total * 0.05;
        if (v > bv) { bv = v; best = q; }
      }
      return best;
    },
  };

  // ---------- Game ----------
  class Game {
    constructor(seats, opts = {}) {
      this.rng = opts.rng || Math.random;
      this.players = seats.map((s, i) => ({
        id: i, name: s.name, kind: s.kind || 'bot', level: s.level || 'normal',
        total: 0, nums: [], mods: [], acts: [], sc: false, status: 'active', lastScore: 0,
      }));
      this.deck = shuffle(buildDeck(), this.rng);
      this.discard = [];
      this.dealer = opts.dealer ?? Math.floor(this.rng() * seats.length);
      this.round = 0;
      this.target = opts.target || 200;
      this.modRedraw = opts.modRedraw ?? true; // house rule: your pull isn't over until you flip a number card
      this.over = false;
      this.winner = null;
      this.roundOver = false;
      this.turnIdx = null;
      this.inFlight = null;
      this.pending = []; // deferred actions during Flip Three (for display)
      this.emit = opts.emit || (async () => {});
      this.agents = opts.agents || { decide: async (g, p) => Bot.decide(g, p), choose: async (g, p, t, c) => Bot.choose(g, p, t, c) };
    }

    snapshot(phase) {
      const strip = p => ({ ...p, nums: [...p.nums], mods: [...p.mods], acts: [...p.acts] });
      return {
        v: 1, phase, players: this.players.map(strip), deck: [...this.deck], discard: [...this.discard],
        dealer: this.dealer, round: this.round, target: this.target, turnIdx: this.turnIdx, modRedraw: this.modRedraw,
        over: this.over, winnerId: this.winner ? this.winner.id : null,
      };
    }

    static restore(snap, opts = {}) {
      const g = new Game(snap.players.map(p => ({ name: p.name, kind: p.kind, level: p.level })), { ...opts, target: snap.target, modRedraw: snap.modRedraw ?? true });
      g.players = snap.players.map(p => ({ ...p }));
      Object.assign(g, { deck: snap.deck, discard: snap.discard, dealer: snap.dealer, round: snap.round, turnIdx: snap.turnIdx, over: snap.over });
      g.winner = snap.winnerId != null ? g.players[snap.winnerId] : null;
      return g;
    }

    active() { return this.players.filter(p => p.status === 'active'); }

    async draw() {
      if (!this.deck.length) {
        if (!this.discard.length) return null;
        this.deck = shuffle(this.discard, this.rng);
        this.discard = [];
        await this.emit('reshuffle', {});
      }
      return this.deck.pop();
    }

    checkEnd() { if (!this.active().length) this.roundOver = true; }

    async run(resume) {
      while (!this.over) {
        await this.playRound(resume);
        resume = null;
      }
      await this.emit('gameEnd', { winner: this.winner });
    }

    async playRound(resume) {
      const n = this.players.length;
      const first = (this.dealer + 1) % n;
      let idx = first;
      this.roundOver = false;
      if (resume && resume.phase === 'turn') {
        idx = resume.turnIdx;
        await this.emit('resume', {});
      } else {
        this.round++;
        for (const p of this.players) { p.nums = []; p.mods = []; p.acts = []; p.sc = false; p.status = 'active'; p.lastScore = 0; }
        await this.emit('roundStart', { round: this.round, dealer: this.players[this.dealer] });
        for (let k = 0; k < n; k++) {
          const p = this.players[(first + k) % n];
          if (this.roundOver) break;
          if (p.status !== 'active') continue;
          await this.emit('deal', { p });
          await this.pull(p);
        }
      }
      let guard = 0;
      while (!this.roundOver && this.active().length && guard++ < 10000) {
        const p = this.players[idx];
        if (p.status !== 'active') { idx = (idx + 1) % n; continue; }
        this.turnIdx = idx;
        await this.emit('turn', { p, canStay: cardCount(p) > 0 });
        const hit = cardCount(p) > 0 ? await this.agents.decide(this, p) : true;
        if (hit) {
          await this.emit('hit', { p });
          await this.pull(p);
        } else {
          p.status = 'stayed';
          await this.emit('stay', { p, score: roundScore(p) });
          this.checkEnd();
        }
        idx = (idx + 1) % n;
      }
      this.turnIdx = null;
      await this.endRound();
    }

    // One pull: under the house rule, keep flipping until this player flips a number
    // (or is no longer active / the round ends).
    async pull(p) {
      this.puller = p; this.pullNum = false;
      try {
        for (;;) {
          await this.giveCard(p, false, null);
          if (!this.modRedraw || this.pullNum || p.status !== 'active' || this.roundOver) break;
          await this.emit('redraw', { p });
        }
      } finally { this.puller = null; }
    }

    async giveCard(target, inF3, deferred) {
      const c = await this.draw();
      if (!c) { this.roundOver = true; return; }
      this.inFlight = c;
      await this.emit('draw', { p: target, card: c, inF3 });
      if (inF3 && c.t === ACT && c.v !== 'second') {
        this.inFlight = null;
        deferred.push(c);
        this.pending.push(c);
        await this.emit('deferred', { p: target, card: c });
      } else {
        await this.resolve(target, c);
      }
    }

    // Called at the start of resolve: the card has landed somewhere.
    land() { this.inFlight = null; }

    async resolve(p, c) {
      if (this.inFlight === c) this.inFlight = null;
      if (c.t === NUM && p === this.puller) this.pullNum = true;
      if (c.t === NUM) {
        if (p.nums.some(x => x.v === c.v)) {
          if (p.sc) {
            p.sc = false;
            const i = p.acts.findIndex(a => a.v === 'second');
            const scCard = p.acts.splice(i, 1)[0];
            this.discard.push(scCard, c);
            await this.emit('saved', { p, card: c });
          } else {
            p.nums.push(c);
            p.status = 'busted';
            await this.emit('bust', { p, card: c });
          }
        } else {
          p.nums.push(c);
          p.nums.sort((a, b) => a.v - b.v);
          await this.emit('placed', { p, card: c });
          if (p.nums.length === 7) {
            p.status = 'flip7';
            this.roundOver = true;
            await this.emit('flip7', { p });
          }
        }
      } else if (c.t === MOD) {
        p.mods.push(c);
        await this.emit('placed', { p, card: c });
      } else if (c.v === 'second') {
        if (!p.sc) {
          p.sc = true; p.acts.push(c);
          await this.emit('placed', { p, card: c });
        } else {
          const cands = this.active().filter(q => q !== p && !q.sc);
          if (!cands.length) {
            this.discard.push(c);
            await this.emit('discardSC', { p, card: c });
          } else {
            const q = cands.length === 1 ? cands[0] : await this.agents.choose(this, p, 'second', cands);
            q.sc = true; q.acts.push(c);
            await this.emit('passSC', { from: p, to: q, card: c });
          }
        }
      } else {
        const cands = this.active();
        const q = cands.length === 1 ? cands[0] : await this.agents.choose(this, p, c.v, cands);
        q.acts.push(c);
        await this.emit('action', { from: p, to: q, card: c });
        if (c.v === 'freeze') {
          q.status = 'frozen';
          await this.emit('frozen', { p: q, score: roundScore(q) });
        } else {
          await this.flipThree(q);
        }
      }
      this.checkEnd();
    }

    async flipThree(q) {
      const deferred = [];
      await this.emit('flip3Start', { p: q });
      for (let k = 0; k < 3; k++) {
        if (this.roundOver || q.status !== 'active') break;
        await this.emit('flip3Count', { p: q, k: k + 1 });
        await this.giveCard(q, true, deferred);
      }
      for (const c of deferred) {
        this.pending = this.pending.filter(x => x !== c);
        if (this.roundOver || q.status !== 'active') { this.discard.push(c); continue; }
        this.inFlight = c;
        await this.emit('deferredResolve', { p: q, card: c });
        await this.resolve(q, c);
      }
    }

    async endRound() {
      for (const p of this.players) { p.lastScore = roundScore(p); p.total += p.lastScore; }
      const max = Math.max(...this.players.map(p => p.total));
      const leaders = this.players.filter(p => p.total === max);
      if (max >= this.target && leaders.length === 1) { this.over = true; this.winner = leaders[0]; }
      this.dealer = (this.dealer + 1) % this.players.length;
      await this.emit('roundEnd', { over: this.over, tie: max >= this.target && leaders.length > 1 });
      for (const p of this.players) {
        this.discard.push(...p.nums, ...p.mods, ...p.acts);
        p.nums = []; p.mods = []; p.acts = []; p.sc = false;
      }
      if (this.pending.length) { this.discard.push(...this.pending); this.pending = []; }
      if (this.inFlight) { this.discard.push(this.inFlight); this.inFlight = null; }
      await this.emit('tableCleared', {});
    }
  }

  // Names for a new game from the setup seats. A blank name falls back to "You" for the
  // only human at the table, "Player N" for other humans and "Bot N" for bots.
  function seatNames(seats) {
    const humans = seats.filter(s => s.kind === 'human').length;
    const first = seats.findIndex(s => s.kind === 'human');
    return seats.map((s, i) => String(s.name || '').trim() ||
      (s.kind === 'bot' ? 'Bot ' + (i + 1) : i === first && humans === 1 ? 'You' : 'Player ' + (i + 1)));
  }

  return { Game, Bot, buildDeck, seatNames, roundScore, bustOdds, cardCount, NUM, MOD, ACT };
})();
if (typeof module !== 'undefined') module.exports = Flip7;
