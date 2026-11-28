/**
 * Doomlings — phone UI.
 *
 * The engine never knows a DOM exists. It emits requests; this file renders
 * them. Every one of the 113 card effects reaches the player through the six
 * request kinds handled in `renderPrompt`, which is why no card needed its own
 * screen: get that bridge right and they all work at once.
 *
 * Pass-and-play privacy is enforced in one place — `gateFor(playerId)`. Any
 * time the engine wants an answer from somebody who isn't holding the phone,
 * the hand-off screen goes up first. That matters most for interrupts, which
 * ask an opponent mid-turn.
 */


/* ------------------------------------------------------------------ */

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const HUE = {
  blue: "var(--blue)", green: "var(--green)", red: "var(--red)",
  purple: "var(--purple)", colorless: "var(--colorless)",
};

function hueOf(card) {
  const cs = coloursOf(card).map(norm).filter((c) => HUE[c]);
  if (!cs.length) return "var(--unknown)";
  if (cs.length === 1) return HUE[cs[0]];
  return `linear-gradient(180deg,${cs.map((c) => HUE[c]).join(",")})`;
}

const backKind = (c) =>
  !c ? "trait" : isBirthOfLife(c) ? "birth" : norm(c.card_type) === "age" ? "age" : "trait";

function backNode(kind) {
  const n = el("span", `back ${kind}`);
  n.innerHTML = `<b>${kind === "birth" ? "Birth<br>of Life" : kind === "age" ? "Ages" : "Traits"}</b>`;
  return n;
}

/** Card art with a graceful fallback — the CDN is not always reachable. */
function artInto(node, card, fbClass) {
  if (card.image_url) {
    const img = el("img");
    img.src = card.image_url;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => img.replaceWith(el("div", fbClass, card.name)));
    node.appendChild(img);
  } else {
    node.appendChild(el("div", fbClass, card.name));
  }
}

/** Full-size card on top of whatever is open — read a card without choosing it. */
function peek(card) {
  const body = $("#peekBody");
  body.innerHTML = "";
  if (card.image_url) {
    const img = el("img");
    img.src = card.image_url; img.alt = "";
    img.addEventListener("error", () => img.remove());
    body.appendChild(img);
  }
  body.appendChild(el("div", "peek-name", card.name));
  if (card.effect) body.appendChild(el("div", "peek-eff", card.effect));
  $("#peek").hidden = false;
}

/** Small "i" on a pick tile: opens the card, never selects it. */
function infoDot(node, card) {
  if (!card || (!card.image_url && !card.effect)) return;
  const i = el("span", "pick-i", "i");
  i.setAttribute("role", "button");
  i.setAttribute("aria-label", `Read ${card.name}`);
  i.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); peek(card); });
  node.appendChild(i);
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

/* Card sets a game can be dealt from. Base is always in; expansions are
   optional chips on the setup screen, remembered between visits. */
const SETS = [
  { id: "base", name: "Base game", always: true },
  { id: "overlush", name: "Overlush", note: "Jungle expansion · 178 cards" },
];
const PREFS_KEY = "doomlings.prefs.v1";
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ sets: S.sets })); } catch { /* private mode */ }
}

const S = {
  cards: [],
  base: [],
  sets: ["base"],
  names: ["Player 1", "Player 2"],
  variant: "3x3",
  privateHands: true,
  // bots are the default; one difficulty for all of them
  mode: "bots", count: 3, level: "normal", myName: "",
  g: null,
  viewer: null,        // who the phone currently belongs to
  gateOpen: false,
};

// Exposed for the automated playtest harness; harmless in normal play.
if (typeof window !== "undefined") { window.__S = S; window.__redraw = () => draw(); }

/* ------------------------------------------------------------------ *
 * Card data
 * ------------------------------------------------------------------ */

function parseCSV(text) {
  text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else f += ch;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

async function loadCards() {
  // Prefer an inlined payload (the standalone build); fall back to fetching.
  if (window.__DOOMLINGS_CARDS__) return window.__DOOMLINGS_CARDS__;
  for (const path of ["../all_cards.csv", "./all_cards.csv", "../doomlings_cards.csv"]) {
    try {
      const r = await fetch(path);
      if (r.ok) return parseCSV(await r.text());
    } catch { /* try the next */ }
  }
  throw new Error("No card data found. Keep all_cards.csv beside this folder.");
}

const baseGame = (rows) =>
  rows.filter((r) => (r.release || "").split("|").map((s) => s.trim()).includes("Base Game"));
/** The deal pool for the chosen sets. Cards without a set tag (an old CSV) are base. */
const poolFor = (rows, sets) => {
  if (!rows.some((r) => r.set)) return baseGame(rows);
  return rows.filter((r) => sets.includes(r.set || "base"));
};
const setName = (id) => (SETS.find((x) => x.id === id) || {}).name || id;

/* ------------------------------------------------------------------ *
 * Setup screen
 * ------------------------------------------------------------------ */

function renderSeats() {
  const host = $("#seats");
  host.innerHTML = "";
  S.names.forEach((name, i) => {
    const row = el("div", "seat");
    row.appendChild(el("span", "mono", String(i + 1)));
    const inp = el("input");
    inp.value = name;
    inp.placeholder = `Player ${i + 1}`;
    inp.setAttribute("aria-label", `Player ${i + 1} name`);
    inp.addEventListener("input", (e) => { S.names[i] = e.target.value; });
    row.appendChild(inp);
    if (S.names.length > 2) {
      const x = el("button", "seat-x", "×");
      x.setAttribute("aria-label", `Remove player ${i + 1}`);
      x.addEventListener("click", () => { S.names.splice(i, 1); renderSeats(); checkDeal(); });
      row.appendChild(x);
    }
    host.appendChild(row);
  });
  $("#addSeat").hidden = S.names.length >= 6;
}

function renderSets() {
  const host = $("#setsRow");
  if (!host) return;
  host.innerHTML = "";
  const have = new Set(S.cards.map((c) => c.set || "base"));
  for (const set of SETS) {
    if (!have.has(set.id)) continue;
    const on = S.sets.includes(set.id);
    const b = el("button", "opt" + (on ? " sel" : ""));
    b.setAttribute("aria-pressed", on ? "true" : "false");
    const wrap = el("span");
    wrap.appendChild(el("span", "opt-t", set.name));
    wrap.appendChild(el("span", "opt-d", set.always ? "Always included" : (on ? "Shuffled in · " : "Tap to add · ") + set.note));
    b.appendChild(wrap);
    if (set.always) b.disabled = true;
    else b.addEventListener("click", () => {
      S.sets = on ? S.sets.filter((x) => x !== set.id) : S.sets.concat(set.id);
      S.base = poolFor(S.cards, S.sets);
      savePrefs();
      renderSets(); checkDeal();
    });
    host.appendChild(b);
  }
}

function renderVariants() {
  const host = $("#variants");
  host.innerHTML = "";
  for (const [key, v] of Object.entries(VARIANTS)) {
    const b = el("button", "opt" + (S.variant === key ? " sel" : ""));
    const wrap = el("span");
    wrap.appendChild(el("span", "opt-t", key === "3x3" ? "Standard" : "Prosperous World"));
    wrap.appendChild(el("span", "opt-d", `${v.label}, plus 1 catastrophe each`));
    b.appendChild(wrap);
    b.addEventListener("click", () => { S.variant = key; renderVariants(); checkDeal(); });
    host.appendChild(b);
  }
}

function checkDeal() {
  const need = (S.mode === "bots" ? S.count : S.names.length) * RULES.startingHand;
  const traits = S.base.filter(isTrait).length;
  const notes = $("#setupNotes");
  notes.innerHTML = "";
  let ok = true;
  if (traits < need) {
    ok = false;
    notes.appendChild(el("div", "note bad",
      `Need ${need} traits to deal ${RULES.startingHand} each, found ${traits}.`));
  }
  $("#deal").disabled = !ok;
}

/* ------------------------------------------------------------------ *
 * Hand-off gate
 * ------------------------------------------------------------------ */

let gateResolve = null;

/**
 * Make sure the phone is in the right hands before showing anything private.
 * Returns a promise that settles once the named player has tapped through.
 */
function gateFor(playerId, why, card) {
  const g = S.g;
  if (isBotId(playerId)) return Promise.resolve();
  if (!S.privateHands) { S.viewer = playerId; return Promise.resolve(); }
  if (S.viewer === playerId) return Promise.resolve();
  const p = g.players.find((x) => x.id === playerId);
  if (!p) return Promise.resolve();

  $("#passName").textContent = p.name;
  $("#passWhy").textContent = why || "Your turn.";

  // Show the trait that triggered this, so the responder knows what they are
  // reacting to before they take the phone.
  const art = $("#passCard");
  art.innerHTML = "";
  if (card) {
    if (card.image_url) {
      const img = el("img");
      img.src = card.image_url; img.alt = "";
      img.addEventListener("error", () => img.replaceWith(el("div", "pass-fb", card.name)));
      art.appendChild(img);
    } else {
      art.appendChild(el("div", "pass-fb", card.name));
    }
    art.hidden = false;
  } else {
    art.hidden = true;
  }

  $("#pass").hidden = false;
  S.gateOpen = true;
  return new Promise((res) => { gateResolve = () => { S.viewer = playerId; res(); }; });
}

$("#peek").addEventListener("click", () => { $("#peek").hidden = true; });

$("#passGo").addEventListener("click", () => {
  $("#pass").hidden = true;
  S.gateOpen = false;
  const f = gateResolve; gateResolve = null;
  if (f) f();
});

/* ------------------------------------------------------------------ *
 * Reveal — a flipped age or catastrophe takes the whole screen.
 *
 * Both need everybody to read and apply them together before play moves on,
 * and the final catastrophe in particular used to flash past on its way to
 * World's End. Nothing continues until someone taps.
 * ------------------------------------------------------------------ */

let revealResolve = null;

function showReveal(card, { kind, instruction, button = "Continue", cat = false }) {
  const art = $("#rvCard");
  art.innerHTML = "";
  if (card.image_url) {
    const img = el("img");
    img.src = card.image_url; img.alt = "";
    img.addEventListener("error", () => img.replaceWith(el("div", "rv-fb", card.name)));
    art.appendChild(img);
  } else {
    art.appendChild(el("div", "rv-fb", card.name));
  }

  $("#rvKind").textContent = kind;
  $("#rvName").textContent = card.name;
  $("#rvText").textContent = card.effect || "";
  $("#rvDo").textContent = instruction || "";
  $("#rvGo").textContent = button;
  $("#reveal").className = "reveal" + (cat ? " cat" : "");
  $("#reveal").hidden = false;

  return new Promise((res) => { revealResolve = res; });
}

$("#rvGo").addEventListener("click", () => {
  $("#reveal").hidden = true;
  const f = revealResolve; revealResolve = null;
  if (f) f();
});

/** "You may" effects are optional — say so rather than implying an order. */
const optionalEffect = (card) => /\byou may\b/i.test(card.effect || "");

/* ------------------------------------------------------------------ *
 * The prompt bridge — this is the whole trick
 * ------------------------------------------------------------------ */

/**
 * Drain every pending engine request, rendering each one and feeding the
 * answer back. Any request aimed at somebody else raises the hand-off first.
 */
async function pump() {
  const g = S.g;
  let guard = 0;
  while (g.pending && guard++ < 500) {
    const req = g.pending.request;
    const who = req.playerId != null ? req.playerId : g.activeSeat;
    await gateFor(who, promptGateReason(req), triggerCard(req));
    const response = await renderPrompt(req, who);
    answer(g, response);
  }
  draw();
}

function promptGateReason(req) {
  if (req.kind === "reaction") {
    const ev = req.event || {};
    if (ev.cardName && ev.actorName) {
      return ev.isAction
        ? `${ev.actorName} played ${ev.cardName}. Its action hasn't resolved — you can stop it.`
        : `${ev.actorName} played ${ev.cardName}. You can respond.`;
    }
    return "Someone played a trait — you can respond.";
  }
  return "A card needs your decision.";
}

/** The card that caused a request, for the hand-off splash. */
function triggerCard(req) {
  const uid = req.event && req.event.cardUid;
  if (uid) { const hit = lookupCards([uid])[0]; if (hit) return hit; }
  const name = req.event && req.event.cardName;
  if (!name) return null;
  const all = [...S.g.players.flatMap((p) => [...p.hand, ...p.traitPile]),
    ...S.g.discard, ...S.g.traitDeck];
  return all.find((c) => norm(c.name) === norm(name)) || null;
}

let promptResolve = null;

// Card-viewer swipe: the listeners are attached to #sheetBody once and read the
// current card set from sheetNav. (Adding them on every card open made them pile up
// and each swipe re-render more of them until the page froze.)
let sheetNav = null;
let sheetSwipeBound = false;
function bindSheetSwipe(body) {
  if (sheetSwipeBound) return;
  sheetSwipeBound = true;
  let x0 = null, y0 = null;
  body.addEventListener("touchstart", (e) => {
    if (!sheetNav) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  body.addEventListener("touchend", (e) => {
    if (x0 == null || !sheetNav) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    const nav = sheetNav;
    nav.go(nav.index + (dx < 0 ? 1 : -1));
  }, { passive: true });
}

function openSheet(buildBody, buildFoot) {
  const body = $("#sheetBody"); body.innerHTML = "";
  sheetNav = null; body.classList.remove("cd-swipe");
  const foot = $("#sheetFoot"); foot.innerHTML = "";
  buildBody(body);
  if (buildFoot) { buildFoot(foot); foot.hidden = false; } else { foot.hidden = true; }
  $("#sheetBg").hidden = false;
}

function closeSheet() { $("#sheetBg").hidden = true; }

function finish(value) {
  closeSheet();
  const f = promptResolve; promptResolve = null;
  if (f) f(value);
}

/** Render one engine request. Resolves with the shape the engine expects. */
const isBotId = (id) => { const p = S.g && S.g.players.find((x) => x.id === id); return !!(p && p.isBot); };
const humanSeat = () => (S.g && S.g.players.find((p) => !p.isBot)) || null;
function renderPrompt(req, viewerId) {
  if (isBotId(viewerId)) return Promise.resolve(botAnswer(S.g, req, viewerId, S.level));
  return new Promise((resolve) => {
    promptResolve = resolve;
    switch (req.kind) {
      case "colour": return promptColour(req);
      case "player": return promptPlayer(req);
      case "confirm": return promptConfirm(req);
      case "cards": return promptCards(req);
      case "trait": return promptTrait(req);
      case "reaction": return promptReaction(req);
      case "blind": return promptBlind(req);
      case "choose": return promptChoose(req);
      default: return finish(null);
    }
  });
}

function header(body, title, sub) {
  body.appendChild(el("div", "sheet-title", title));
  if (sub) body.appendChild(el("div", "sheet-sub", sub));
}

/** Who a request is for — the person holding the phone when it shows. */
const askedId = (req) => (req.playerId != null ? req.playerId : S.g.activeSeat);

/**
 * The asked player's hand, under the question. Every decision ("discard 1 to
 * draw 2?") depends on what you're holding, so you should never have to answer
 * blind. Tap a card to read it.
 */
function handStrip(body, req) {
  const p = S.g.players.find((x) => x.id === askedId(req));
  if (!p) return;
  const wrap = el("div", "ph");
  wrap.appendChild(el("div", "ph-head mono", `${p.name}'s hand \u00b7 ${p.hand.length}`));
  if (!p.hand.length) {
    wrap.appendChild(el("div", "empty", "Empty."));
  } else {
    const row = el("div", "ph-row scroll-x");
    for (const c of p.hand) {
      const b = el("button", "ph-card");
      artInto(b, c, "ph-fb");
      b.addEventListener("click", () => peek(c));
      row.appendChild(b);
    }
    wrap.appendChild(row);
  }
  body.appendChild(wrap);
}

/** A cards prompt whose options ARE the whole hand doesn't need the strip. */
function optionsAreWholeHand(req) {
  const p = S.g.players.find((x) => x.id === askedId(req));
  const opts = req.options || [];
  return req.from === "hand" && p && opts.length === p.hand.length &&
    opts.every((o) => p.hand.some((c) => c.uid === o.uid));
}

function promptColour(req) {
  const options = (req.options && req.options.length ? req.options : COLOURS);
  openSheet((body) => {
    header(body, req.prompt || "Choose a colour");
    const grid = el("div", "swatches");
    for (const c of options) {
      const b = el("button", "sw");
      b.style.setProperty("--c", HUE[norm(c)] || "var(--unknown)");
      b.appendChild(el("i"));
      b.appendChild(el("span", null, c));
      b.addEventListener("click", () => finish(c));
      grid.appendChild(b);
    }
    body.appendChild(grid);
    handStrip(body, req);
  }, req.optional ? (foot) => {
    const skip = el("button", "b-flat", "Skip");
    skip.addEventListener("click", () => finish(null));
    foot.appendChild(skip);
  } : null);
}

function promptPlayer(req) {
  openSheet((body) => {
    header(body, req.prompt || "Choose a player");
    const list = el("div", "plist");
    for (const o of req.options || []) {
      const b = el("button", "prow");
      b.appendChild(el("b", null, o.name));
      if (o.handSize != null) b.appendChild(el("span", "mono", `${o.handSize} in hand`));
      b.addEventListener("click", () => finish(o));
      list.appendChild(b);
    }
    body.appendChild(list);
    handStrip(body, req);
  });
}

function promptConfirm(req) {
  openSheet((body) => {
    header(body, req.prompt || "Confirm");
    if (req.peek) {
      const box = el("div", "react-ev");
      box.appendChild(el("b", null, req.peek.name));
      if (req.peek.effect) box.appendChild(el("div", null, req.peek.effect));
      body.appendChild(box);
    }
    handStrip(body, req);
  }, (foot) => {
    if (!req.acknowledge) {
      const no = el("button", "b-flat", "No");
      no.addEventListener("click", () => finish(false));
      foot.appendChild(no);
    }
    const yes = el("button", "b-go", req.acknowledge ? "Got it" : "Yes");
    yes.addEventListener("click", () => finish(true));
    foot.appendChild(yes);
  });
}

/** "You may play one of these" — tap to do it, or decline explicitly. */
function promptOneOptional(req) {
  const opts = req.options || [];
  const byUid = new Map();
  for (const c of lookupCards(opts.map((o) => o.uid))) byUid.set(c.uid, c);

  openSheet((body) => {
    header(body, req.prompt || "Play one?", "Tap a card to play it now.");
    const grid = el("div", "pick-grid");
    for (const o of opts) {
      const card = byUid.get(o.uid) || { name: o.name, image_url: "" };
      const b = el("button", "pick");
      artInto(b, card, "pick-fb");
      infoDot(b, card);
      b.appendChild(el("div", "pick-cap", o.name));
      b.addEventListener("click", () => finish([{ uid: o.uid }]));
      grid.appendChild(b);
    }
    body.appendChild(grid);
    if (!optionsAreWholeHand(req)) handStrip(body, req);
  }, (foot) => {
    const skip = el("button", "b-flat", "Not now");
    skip.addEventListener("click", () => finish([]));
    foot.appendChild(skip);
  });
}

/** Card picker. Handles exact counts, optional picks and caps in one widget.
 *  A single optional pick ("play it now?") is really a yes/no, so the card
 *  itself becomes the button — no Confirm step to miss. */
function promptCards(req) {
  const opts = req.options || [];
  if (req.optional && (req.max ?? 1) === 1) return promptOneOptional(req);
  const want = req.optional ? 0 : (req.count ?? 1);
  const max = req.max ?? Math.max(want, 1);
  const chosen = new Set();

  const byUid = new Map();
  for (const c of lookupCards(opts.map((o) => o.uid))) byUid.set(c.uid, c);

  openSheet((body) => {
    header(body, req.prompt || "Choose",
      max > 1 ? `Pick up to ${max}.` : (req.optional ? "Optional." : null));
    const grid = el("div", "pick-grid");
    for (const o of opts) {
      const card = byUid.get(o.uid) || { name: o.name, image_url: "" };
      const b = el("button", "pick");
      b.dataset.uid = o.uid;
      artInto(b, card, "pick-fb");
      infoDot(b, card);
      b.appendChild(el("div", "pick-cap", o.name));
      b.addEventListener("click", () => {
        if (chosen.has(o.uid)) chosen.delete(o.uid);
        else {
          if (chosen.size >= max) {
            if (max === 1) chosen.clear();
            else return;
          }
          chosen.add(o.uid);
        }
        syncPicks(grid, chosen);
        updateGo();
      });
      grid.appendChild(b);
    }
    body.appendChild(grid);
    if (!optionsAreWholeHand(req)) handStrip(body, req);
  }, (foot) => {
    if (req.optional) {
      const skip = el("button", "b-flat", "None");
      skip.addEventListener("click", () => finish([]));
      foot.appendChild(skip);
    }
    const go = el("button", "b-go", "Confirm");
    go.id = "promptGo";
    go.addEventListener("click", () => finish([...chosen].map((uid) => ({ uid }))));
    foot.appendChild(go);
  });

  function updateGo() {
    const go = $("#promptGo");
    if (go) go.disabled = req.optional ? false : chosen.size !== Math.min(want, opts.length);
  }
  updateGo();
}

function syncPicks(grid, chosen) {
  for (const node of grid.querySelectorAll(".pick")) {
    const on = chosen.has(node.dataset.uid);
    node.classList.toggle("sel", on);
    const tick = node.querySelector(".pick-tick");
    if (on && !tick) node.appendChild(el("span", "pick-tick", "✓"));
    if (!on && tick) tick.remove();
  }
}

/** Trait picker — same idea, but options live in named players' piles. */
function promptTrait(req) {
  const opts = req.options || [];
  const cards = new Map();
  for (const c of lookupCards(opts.map((o) => o.uid))) cards.set(c.uid, c);

  openSheet((body) => {
    header(body, req.prompt || "Choose a trait");
    const grid = el("div", "pick-grid");
    let lockedReason = null;
    for (const o of opts) {
      const card = cards.get(o.uid) || { name: o.name, image_url: "" };
      const owner = S.g.players.find((p) => p.id === o.playerId);
      const b = el("button", "pick" + (o.disabled ? " locked" : ""));
      artInto(b, card, "pick-fb");
      infoDot(b, card);
      const cap = el("div", "pick-cap", o.name);
      if (owner) cap.appendChild(el("span", "pick-own", owner.name));
      b.appendChild(cap);
      if (o.disabled) {
        b.appendChild(el("span", "pick-lock", "\u2605"));
        b.setAttribute("aria-disabled", "true");
        b.title = o.reason || "";
        lockedReason = lockedReason || o.reason;
      } else {
        b.addEventListener("click", () => finish(o));
      }
      grid.appendChild(b);
    }
    body.appendChild(grid);
    if (lockedReason) body.appendChild(el("div", "pick-why", lockedReason));
    handStrip(body, req);
  }, req.optional ? (foot) => {
    const skip = el("button", "b-flat", "Skip");
    skip.addEventListener("click", () => finish(null));
    foot.appendChild(skip);
  } : null);
}

/** Reaction window — shows what triggered it, then your eligible cards. */
function promptReaction(req) {
  const cards = new Map();
  for (const c of lookupCards((req.options || []).map((o) => o.uid))) cards.set(c.uid, c);

  openSheet((body) => {
    header(body, req.prompt || "Respond?");
    const ev = req.event || {};
    if (ev.cardName) {
      const line = ev.isAction
        ? `${ev.actorName} played ${ev.cardName} — its action has not resolved yet.`
        : `${ev.actorName} played ${ev.cardName}.`;
      const played = ev.cardUid ? lookupCards([ev.cardUid])[0] : triggerCard(req);
      const box = el("div", "react-ev");
      if (played) {
        // Show the whole card you're reacting to: art, name and text (#40).
        box.classList.add("has-card");
        const tile = el("button", "pick react-card");
        tile.setAttribute("aria-label", `Read ${played.name}`);
        artInto(tile, played, "pick-fb");
        tile.addEventListener("click", (e) => { e.preventDefault(); peek(played); });
        box.appendChild(tile);
        const txt = el("div", "react-txt");
        txt.appendChild(el("b", null, played.name));
        txt.appendChild(el("div", null, line));
        if (played.effect) txt.appendChild(el("div", "react-eff", played.effect));
        txt.appendChild(el("div", "react-hint", "Tap the card to see it full size."));
        box.appendChild(txt);
      } else {
        box.textContent = line;
      }
      body.appendChild(box);
    }
    const grid = el("div", "pick-grid");
    for (const o of req.options || []) {
      const card = cards.get(o.uid) || { name: o.name, image_url: "" };
      const b = el("button", "pick");
      artInto(b, card, "pick-fb");
      infoDot(b, card);
      b.appendChild(el("div", "pick-cap", o.name));
      b.addEventListener("click", () => finish(o));
      grid.appendChild(b);
    }
    body.appendChild(grid);
    handStrip(body, req);
  }, (foot) => {
    const pass = el("button", "b-flat", "Pass");
    pass.addEventListener("click", () => finish(null));
    foot.appendChild(pass);
  });
}

/** "At random": the owner's hand face down, shuffled by the engine. Tap to pick. */
function promptBlind(req) {
  const chosen = new Set();
  openSheet((body) => {
    header(body, req.prompt || "Pick at random",
      `${req.ownerName}'s hand, face down and shuffled. Tap ${req.count === 1 ? "a card" : req.count + " cards"}.`);
    const grid = el("div", "pick-grid");
    for (let i = 0; i < req.total; i++) {
      const b = el("button", "pick");
      b.dataset.uid = String(i);
      const back = el("span", "blind-back");
      back.appendChild(backNode("trait"));
      b.appendChild(back);
      b.addEventListener("click", () => {
        const k = String(i);
        if (chosen.has(k)) chosen.delete(k);
        else {
          if (chosen.size >= req.count) {
            if (req.count === 1) chosen.clear(); else return;
          }
          chosen.add(k);
        }
        syncPicks(grid, chosen);
        go();
      });
      grid.appendChild(b);
    }
    body.appendChild(grid);
  }, (foot) => {
    const b = el("button", "b-go", "Confirm");
    b.id = "promptGo";
    b.addEventListener("click", () => finish([...chosen].map(Number)));
    foot.appendChild(b);
  });
  function go() { const b = $("#promptGo"); if (b) b.disabled = chosen.size !== req.count; }
  go();
}

/**
 * Read-then-confirm. Each option is a row with its art and full text, a tap
 * only selects, and Confirm commits — so the choice can be made deliberately.
 * With showPiles, every trait pile is laid out underneath to decide against.
 */
function promptChoose(req) {
  const cards = new Map();
  for (const c of lookupCards((req.options || []).map((o) => o.uid))) cards.set(c.uid, c);
  let picked = null;
  openSheet((body) => {
    header(body, req.prompt || "Choose", req.sub);
    const list = el("div", "ch-list");
    for (const o of req.options || []) {
      const card = cards.get(o.uid) || { name: o.name, image_url: "", effect: o.effect };
      const row = el("button", "ch-row");
      row.dataset.uid = o.uid;
      const art = el("div", "ch-art");
      artInto(art, card, "pick-fb");
      infoDot(art, card);
      row.appendChild(art);
      const txt = el("div");
      txt.appendChild(el("div", "ch-name", card.name));
      if (card.effect) txt.appendChild(el("div", "ch-eff", card.effect));
      row.appendChild(txt);
      row.addEventListener("click", () => {
        picked = o;
        for (const r of list.querySelectorAll(".ch-row")) r.classList.toggle("sel", r.dataset.uid === o.uid);
        const b = $("#promptGo"); if (b) b.disabled = false;
      });
      list.appendChild(row);
    }
    body.appendChild(list);
    if (req.showPiles) pilesOverview(body);
  }, (foot) => {
    const b = el("button", "b-go", "Confirm");
    b.id = "promptGo";
    b.disabled = true;
    b.addEventListener("click", () => { if (picked) finish(picked); });
    foot.appendChild(b);
  });
}

/** Every player's trait pile, compact, tap a card to read it. */
function pilesOverview(body) {
  const wrap = el("div", "piles");
  wrap.appendChild(el("div", "ph-head mono", "Trait piles"));
  for (const p of S.g.players) {
    const box = el("div", "piles-p");
    const head = el("div");
    head.appendChild(el("b", null, p.name));
    head.appendChild(el("span", "mono", `${p.traitPile.length} traits \u00b7 ${faceScore(p)} pts \u00b7 GP ${p.genePool}`));
    box.appendChild(head);
    const row = el("div", "ph-row scroll-x");
    row.style.marginTop = "6px";
    if (!p.traitPile.length) row.appendChild(el("div", "empty", "No traits."));
    for (const c of p.traitPile) {
      const b = el("button", "ph-card");
      b.style.setProperty("--c", hueOf(c));
      artInto(b, c, "ph-fb");
      b.addEventListener("click", () => peek(c));
      row.appendChild(b);
    }
    box.appendChild(row);
    wrap.appendChild(box);
  }
  body.appendChild(wrap);
}

/** Find real card objects anywhere in play, so prompts can show art. */
function lookupCards(uids) {
  const want = new Set(uids);
  const g = S.g;
  const pools = [g.traitDeck, g.discard, g.ageDeck, ...g.eras,
    ...g.players.flatMap((p) => [p.hand, p.traitPile])];
  const out = [];
  for (const pool of pools) for (const c of pool) if (want.has(c.uid)) out.push(c);
  return out;
}

/* ------------------------------------------------------------------ *
 * Card detail sheet
 * ------------------------------------------------------------------ */

/**
 * Card detail. When opened from a set (your hand, a trait pile), you can move
 * through that set without closing — arrows, dots, or a horizontal swipe.
 */
function openCard(card, opts = {}) {
  const { siblings = null } = opts;
  if (siblings && siblings.length > 1) {
    const i = siblings.findIndex((c) => c.uid === card.uid);
    if (i >= 0) return openCardAt(siblings, i, opts);
  }
  return openCardSolo(card, opts);
}

function openCardAt(list, index, opts) {
  const card = list[index];
  openCardSolo(card, {
    ...opts,
    ...(typeof opts.at === "function" ? opts.at(card) : {}),
    nav: {
      index, total: list.length,
      go: (next) => {
        if (next < 0 || next >= list.length) return;
        openCardAt(list, next, opts);
      },
    },
  });
}

function openCardSolo(card, { canPlay = false, canDiscard = false, why = null, nav = null } = {}) {
  openSheet((body) => {
    if (nav) {
      const bar = el("div", "cd-nav");
      const prev = el("button", null, "\u2039");
      prev.setAttribute("aria-label", "Previous card");
      prev.disabled = nav.index === 0;
      prev.addEventListener("click", () => nav.go(nav.index - 1));

      const dots = el("div", "cd-dots");
      for (let k = 0; k < nav.total; k++) {
        dots.appendChild(el("i", k === nav.index ? "on" : null));
      }

      const next = el("button", null, "\u203a");
      next.setAttribute("aria-label", "Next card");
      next.disabled = nav.index === nav.total - 1;
      next.addEventListener("click", () => nav.go(nav.index + 1));

      bar.append(prev, dots, next);
      body.appendChild(bar);

      // Horizontal drag moves between cards; vertical is left to the sheet.
      bindSheetSwipe(body);
      sheetNav = nav;
      body.classList.add("cd-swipe");
    }

    if (card.image_url) {
      const img = el("img", "cd-art");
      img.src = card.image_url; img.alt = "";
      img.addEventListener("error", () => img.remove());
      body.appendChild(img);
    }
    body.appendChild(el("div", "cd-name", card.name));
    if (card.flavor_text) body.appendChild(el("div", "cd-flavor", card.flavor_text));
    if (card.effect) body.appendChild(el("div", "cd-eff", card.effect));

    const meta = el("div", "cd-meta");
    for (const c of coloursOf(card)) {
      const t = el("span", "tag hued", c);
      t.style.setProperty("--c", HUE[norm(c)] || "var(--unknown)");
      meta.appendChild(t);
    }
    if (card.points !== "" && card.points != null) meta.appendChild(el("span", "tag", `${card.points} pts`));
    if (card.set && card.set !== "base") meta.appendChild(el("span", "tag set", setName(card.set)));
    if (card.copyOf) meta.appendChild(el("span", "tag", `Copy of ${card.copyOf}`));
    for (const s of (card.subtype || "").split("|").map((x) => x.trim()).filter(Boolean)) {
      meta.appendChild(el("span", "tag", s));
    }
    body.appendChild(meta);
    if (why) body.appendChild(el("div", "why", why));
  }, (canPlay || canDiscard || abilityFor(card)) ? (foot) => {
    const ab = abilityFor(card);
    if (ab) {
      const b = el("button", canPlay ? "b-flat" : "b-play", ab.label);
      b.addEventListener("click", async () => { closeSheet(); await doAbility(card); });
      foot.appendChild(b);
    }
    if (canPlay) {
      const b = el("button", "b-play", "Play this");
      b.addEventListener("click", async () => { closeSheet(); await doPlay(card); });
      foot.appendChild(b);
    }
    if (canDiscard) {
      const b = el("button", "b-flat", "Discard");
      b.addEventListener("click", () => {
        closeSheet();
        if (botTurnNow() || !canManualDiscard(S.g, seatOf(S.g))) return;
        discardFromHand(S.g, seatOf(S.g), card.uid);
        S.g.log.unshift({ text: `${seatOf(S.g).name} discarded ${card.name}.` });
        draw();
      });
      foot.appendChild(b);
    }
  } : null);
}

$("#sheetBg").addEventListener("click", (e) => {
  // Tapping the scrim cancels only sheets that are safe to cancel.
  if (e.target.id !== "sheetBg") return;
  if (promptResolve) return;         // a prompt must be answered
  closeSheet();
});

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

const botTurnNow = () => S.g && S.g.players[S.g.activeSeat] && S.g.players[S.g.activeSeat].isBot && !S.botActing;
/** An Overlush card ability the active (human) player can use right now. */
function abilityFor(card) {
  const g = S.g;
  if (!g || botTurnNow() || g.pending || typeof abilityOf !== "function") return null;
  return abilityOf(g, seatOf(g), card, EFFECTS);
}
async function doAbility(card) {
  const g = S.g;
  if (botTurnNow()) return;
  useAbility(g, card.uid, EFFECTS);
  await pump();
}
async function doPlay(card) {
  const g = S.g;
  if (botTurnNow()) return;
  playTrait(g, card.uid, EFFECTS);
  await pump();
}

/**
 * Drawing by hand is only for stabilizing: after you've played (or used your
 * play), and only up to your Gene Pool (+1 under Coastal Formations). Card
 * effects draw on their own, so there's no other legal manual draw.
 */
function canManualDraw(g, p) {
  if (g.phase !== "turn" || g.pending || g.playsLeft > 0 || g.stabilizeWaived) return false;
  if (noStabilize(g, p) || drawBlocked(g, p)) return false;
  if (!g.traitDeck.length && !g.discard.length) return false;
  const r = activeRestrict(topAge(g));
  return p.hand.length < targetHand(g, p) + (r.stabilizePlus || 0);
}
/** Discarding by hand is only for stabilizing down to your Gene Pool. */
function canManualDiscard(g, p) {
  if (g.phase !== "turn" || g.pending || g.playsLeft > 0 || g.stabilizeWaived) return false;
  if (noStabilize(g, p)) return false;
  return p.hand.length > targetHand(g, p);
}
/** "Can't play" is for when nothing in hand is legal (or the hand is empty). */
function canDeclareStuck(g, p) {
  if (g.phase !== "turn" || g.pending || g.playsLeft <= 0 || g.stabilizeWaived) return false;
  return !playableCards(g, p, EFFECTS).length;
}

async function doDraw() {
  const g = S.g;
  if (botTurnNow()) return;
  if (!canManualDraw(g, seatOf(g))) return;
  drawCard(g, seatOf(g));
  draw();
}

async function doFlip() {
  const g = S.g;
  if (botTurnNow()) return;
  const before = g.catastrophes;
  const flipped = g.ageDeck[0];
  flipAge(g, EFFECTS);

  const wasCat = g.catastrophes > before;
  const isFinal = g.phase === "worldsEnd";

  if (flipped) {
    draw();                                   // board behind the splash is current
    await showReveal(flipped, {
      cat: wasCat,
      kind: isFinal
        ? `Final catastrophe \u2014 ${g.catastrophes} of ${g.eras.length}`
        : wasCat
          ? `Catastrophe ${g.catastrophes} of ${g.eras.length}`
          : "New age",
      instruction: isFinal
        ? "Apply the Gene Pool and World's End effects, then score."
        : wasCat
          ? "Everyone applies this now, in turn order. The era ends \u2014 no turns this round."
          : optionalEffect(flipped)
            ? "Applies this round. \u201cYou may\u201d effects are optional."
            : "Applies for this round.",
      button: isFinal ? "Begin World's End" : "Continue",
    });
  }

  await pump();

  // The card's own effects: Awakening's preview, a catastrophe's gene-pool hit
  // and white text for every player. These run after the splash so the table
  // has read the card first.
  await driveGenerator(resolveAgeReveal(g, EFFECTS));
  draw();

  if (g.phase === "worldsEnd") { await runWorldsEnd(); return; }

  // A catastrophe ends the era outright — nobody takes a turn, and the first
  // player has just rotated, so the phone goes to whoever flips next.
  const wasCatastrophe = g.catastrophes > before;
  await gateFor(g.activeSeat,
    wasCatastrophe
      ? "Apply the catastrophe together, then flip the next age."
      : "Your turn.");
  draw();
}

async function doEndTurn() {
  const g = S.g;
  if (botTurnNow()) return;
  const p = seatOf(g);
  const target = targetHand(g, p);
  // Under Prosperity (or with Apricity) stabilizing is the player's choice:
  // never auto-draw. Scavenger, Whistler and The Living Library change how you
  // stabilize, so the engine does that drawing itself.
  const optional = mayskipStabilize(g, p) || noStabilize(g, p);
  const engineDraws = engineStabilizes(g, p);
  let spins = 0;
  while (!optional && !engineDraws && p.hand.length < target && spins++ < 20) if (!drawCard(g, p)) break;
  if (p.hand.length > target && !optional) { draw(); return; }

  beginEndTurn(g, EFFECTS);
  await pump();

  if (g.phase === "turn") {
    await gateFor(g.activeSeat, "Your turn.");
  }
  draw();
}

async function doCantPlay() {
  if (botTurnNow()) return;
  if (!canDeclareStuck(S.g, seatOf(S.g))) return;
  cantPlay(S.g);
  draw();
}

async function runWorldsEnd() {
  const g = S.g;
  await driveGenerator(resolveWorldsEnd(g, EFFECTS));
  await driveGenerator(scoreGame(g, EFFECTS));
  startWalkthrough();
}

/** Run a generator that isn't parked on game.pending (World's End, scoring). */
async function driveGenerator(gen) {
  let r = gen.next(), guard = 0;
  while (!r.done && guard++ < 500) {
    const req = r.value;
    const who = req.playerId != null ? req.playerId : S.g.activeSeat;
    await gateFor(who, promptGateReason(req), triggerCard(req));
    const response = await renderPrompt(req, who);
    r = gen.next(response);
  }
  return r.value;
}

/* ------------------------------------------------------------------ *
 * Scoring walkthrough
 *
 * A final number tells you who won but not why. This walks each player's pile
 * one line at a time — face values first, then every Drop of Life bonus —
 * lighting the card that is paying out as its points land.
 * ------------------------------------------------------------------ */

const W = { order: [], pi: 0, li: 0, lines: [], total: 0, timer: null, speed: 1 };

const BEAT = 1150;        // ms per scoring line at normal speed

function startWalkthrough() {
  const g = S.g;
  // Seat order, not score order — nobody gets spoiled by the standings.
  W.order = g.players.map((p) => (g.scores || []).find((s) => s.id === p.id)).filter(Boolean);
  W.pi = -1;
  W.speed = 1;
  show("scWalk");
  nextPlayerWalk();
}

function clearBeat() { if (W.timer) { clearTimeout(W.timer); W.timer = null; } }

function nextPlayerWalk() {
  clearBeat();
  W.pi++;
  if (W.pi >= W.order.length) { renderScores(); return; }

  const s = W.order[W.pi];
  W.lines = [...(s.faceLines || []), ...(s.bonusLines || [])];
  if (s.adjust) W.lines.push({ kind: "bonus", name: "Adjustments", amount: s.adjust });
  W.li = 0;
  W.total = 0;

  $("#swWho").textContent = s.name;
  $("#swStep").textContent = `Player ${W.pi + 1} of ${W.order.length}`;
  $("#swTotal").textContent = "0";
  $("#swLines").innerHTML = "";
  renderWalkCards(null, new Set());

  if (!W.lines.length) {
    appendLine({ head: true, text: `${s.name} played no scoring traits.` });
    W.timer = setTimeout(nextPlayerWalk, BEAT / W.speed);
    return;
  }
  appendLine({ head: true, text: faceHeading(s) });
  W.timer = setTimeout(beat, 520 / W.speed);
}

const faceHeading = (s) =>
  s.faceLines && s.faceLines.length ? "Face values" : "Drop of Life bonuses";

/** One scoring line lands, the card lights, the total ticks. */
function beat() {
  if (W.li >= W.lines.length) {
    const s = W.order[W.pi];
    appendLine({ head: true, text: `${s.name} finishes on ${s.total}.` });
    W.timer = setTimeout(nextPlayerWalk, BEAT * 1.4 / W.speed);
    return;
  }

  const line = W.lines[W.li];
  const prev = W.li > 0 ? W.lines[W.li - 1] : null;
  // A heading when we cross from face values into bonuses.
  if (prev && prev.kind === "face" && line.kind === "bonus") {
    appendLine({ head: true, text: "Drop of Life bonuses" });
  }

  W.li++;
  W.total += line.amount;

  const revealed = new Set(W.lines.slice(0, W.li).map((l) => l.uid).filter(Boolean));
  renderWalkCards(line, revealed);
  appendLine({ line });

  const t = $("#swTotal");
  t.textContent = String(W.total);
  t.classList.add("bump");
  setTimeout(() => t.classList.remove("bump"), 200);

  W.timer = setTimeout(beat, BEAT / W.speed);
}

function renderWalkCards(current, revealed) {
  const s = W.order[W.pi];
  const player = S.g.players.find((p) => p.id === s.id);
  const host = $("#swCards");
  host.innerHTML = "";
  for (const c of player.traitPile) {
    const n = el("div", "sw-card" + (revealed.has(c.uid) ? " lit" : "") +
      (current && current.uid === c.uid ? " now" : ""));
    artInto(n, c, "sw-fb");
    host.appendChild(n);
    if (current && current.uid === c.uid) {
      n.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
    }
  }
}

function appendLine({ line, head, text }) {
  const list = $("#swLines");
  if (head) {
    list.appendChild(el("div", "sw-line head mono", text));
  } else {
    const row = el("div", "sw-line" + (line.amount < 0 ? " neg" : ""));
    const nm = el("div", "nm", line.name);
    nm.appendChild(el("div", "why",
      line.kind === "bonus"
        ? (line.from ? `from ${line.from}'s card` : "drop of life")
        : "face value"));
    row.appendChild(nm);
    row.appendChild(el("div", "amt", `${line.amount > 0 ? "+" : ""}${line.amount}`));
    list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
}

$("#swFF").addEventListener("click", () => {
  // Three taps: normal, quick, instant-for-this-player.
  if (W.speed === 1) { W.speed = 3; $("#swFF").textContent = "Faster"; return; }
  if (W.speed === 3) { W.speed = 8; $("#swFF").textContent = "Finish player"; return; }
  clearBeat();
  while (W.li < W.lines.length) {
    const line = W.lines[W.li++];
    W.total += line.amount;
    appendLine({ line });
  }
  const revealed = new Set(W.lines.map((l) => l.uid).filter(Boolean));
  renderWalkCards(null, revealed);
  $("#swTotal").textContent = String(W.total);
  W.timer = setTimeout(beat, 240);
});

$("#swSkip").addEventListener("click", () => { clearBeat(); renderScores(); });

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

function draw() {
  const g = S.g;
  if (!g) return;
  if (g.phase === "over") { renderScores(); return; }

  const v = VARIANTS[g.variantKey];
  const actor = seatOf(g);
  const me = actor.isBot && humanSeat() ? humanSeat() : actor;

  // doom meter
  const doom = $("#doom");
  if (doom.children.length !== v.eras) {
    doom.innerHTML = "";
    for (let i = 0; i < v.eras; i++) doom.appendChild(el("i"));
  }
  [...doom.children].forEach((n, i) => {
    n.classList.toggle("lit", i < g.catastrophes);
    n.classList.toggle("live", i === g.catastrophes && g.phase === "turn");
  });

  $("#barEra").textContent = `Era ${g.currentEra + 1}/${v.eras}`;
  $("#barTurn").textContent = g.phase === "age" ? "Round complete" : actor.isBot ? `${actor.name} is playing…` : humanSeat() && g.players.filter((p) => !p.isBot).length === 1 ? "Your turn" : `${actor.name}'s turn`;

  renderOpps(g, me);
  renderAge(g);
  renderDecks(g);
  renderPile(g, me);
  renderHand(g, me);
  renderCta(g, me);
  if (actor.isBot || (g.phase === "age" && actor.isBot)) {
    const cta = $("#cta"); cta.disabled = true; cta.onclick = null; cta.className = "cta bot-thinking";
    cta.innerHTML = `${actor.name} is ${g.phase === "age" ? "flipping the next age" : "playing"}…<span class="cta-sub">${{ easy: "Easy", normal: "Normal", hard: "Hard" }[S.level]} bot</span>`;
    $("#btnCant").disabled = true; $("#btnDraw").disabled = true;
  }
  scheduleBot();
}

/* ---------- bot turns ---------- */
let botTimer = null;
function scheduleBot() {
  clearTimeout(botTimer);
  const g = S.g;
  if (!g || g.phase === "over" || !g.players[g.activeSeat].isBot) return;
  botTimer = setTimeout(botStep, 900);
}
async function botStep() {
  const g = S.g;
  if (!g || S.botRunning || g.pending || S.gateOpen || revealResolve || g.phase === "over" || g.phase === "worldsEnd") return;
  const p = seatOf(g);
  if (!p.isBot) return;
  S.botRunning = true; S.botActing = true;
  try {
    if (g.phase === "age") { await doFlip(); return; }
    if (g.phase !== "turn") return;
    if (g.playsLeft > 0 && !g.stabilizeWaived) {
      const uid = (S.botFails || 0) < 3 ? botChoosePlay(g, EFFECTS, S.level) : null;
      const card = uid && p.hand.find((c) => c.uid === uid);
      if (card) {
        const before = g.playsLeft;
        say(g, `${p.name} plays ${card.name}.`);
        await doPlay(card);
        S.botFails = g.playsLeft > 0 && g.playsLeft === before && p.hand.some((c) => c.uid === uid) ? (S.botFails || 0) + 1 : 0;
      } else { cantPlay(g); S.botFails = 0; }
      return;
    }
    S.botFails = 0;
    const t = targetHand(g, p);
    if (noStabilize(g, p)) { /* Cheek Pouches: leave the hand as it is */ }
    else if (mayskipStabilize(g, p)) { if (!engineStabilizes(g, p)) while (p.hand.length < t && drawCard(g, p)); }
    else for (const uid of botStabilizeDiscards(g, p, t)) discardFromHand(g, p, uid);
    await doEndTurn();
  } finally {
    S.botActing = false; S.botRunning = false;
    draw();
  }
}

function renderOpps(g, me) {
  const host = $("#opps");
  host.innerHTML = "";
  for (const p of g.players) {
    if (p.id === me.id && g.phase === "turn") continue;
    const b = el("button", "opp" + (p.id === g.firstSeat ? " first" : ""));
    b.appendChild(el("div", "opp-name", p.name));
    const row = el("div", "opp-row");
    row.appendChild(el("span", "mono", `GP ${p.genePool}`));
    row.appendChild(el("span", "mono", `${p.hand.length}✋`));
    row.appendChild(el("span", "mono", `${faceScore(p)}pt`));
    b.appendChild(row);
    const dots = el("div", "opp-dots");
    for (const c of p.traitPile.slice(-14)) {
      const d = el("i");
      d.style.setProperty("--c", hueOf(c));
      dots.appendChild(d);
    }
    b.appendChild(dots);
    b.addEventListener("click", () => openOpponent(p));
    host.appendChild(b);
  }
}

function openOpponent(p) {
  openSheet((body) => {
    header(body, p.name, `Gene pool ${p.genePool} · ${p.hand.length} in hand · ${faceScore(p)} face value`);
    if (!p.traitPile.length) { body.appendChild(el("div", "empty", "No traits played yet.")); return; }
    const grid = el("div", "pick-grid");
    for (const c of p.traitPile) {
      const b = el("button", "pick");
      artInto(b, c, "pick-fb");
      b.appendChild(el("div", "pick-cap", c.name));
      b.addEventListener("click", () => openCard(c));
      grid.appendChild(b);
    }
    body.appendChild(grid);
  });
}

function renderAge(g) {
  const host = $("#age");
  const card = topAge(g);
  if (!card) { host.hidden = true; return; }
  host.hidden = false;
  host.className = "age" + (isCatastrophe(card) ? " cat" : "");
  host.innerHTML = "";
  if (card.image_url) {
    const img = el("img");
    img.src = card.image_url; img.alt = "";
    img.addEventListener("error", () => img.remove());
    host.appendChild(img);
  }
  const txt = el("div");
  txt.appendChild(el("div", "age-kind mono",
    isCatastrophe(card) ? `Catastrophe ${g.catastrophes} of ${g.eras.length}` : "Current age"));
  txt.appendChild(el("div", "age-name", card.name));
  if (card.effect) txt.appendChild(el("div", "age-text", card.effect));
  const rule = ruleLabel(activeRestrict(card));
  if (rule) txt.appendChild(el("div", "age-rule", rule));
  host.appendChild(txt);
  host.onclick = () => openCard(card);
}

/** A one-line summary of the age's standing rule, for the board. */
function ruleLabel(r) {
  if (!r) return null;
  if (r.noColour) return `No ${r.noColour} traits this age`;
  if (r.noFaceAtLeast != null) return `No face value ${r.noFaceAtLeast}+ this age`;
  if (r.noFaceExactly != null) return `No face value ${r.noFaceExactly} this age`;
  if (r.ignoreActions) return "Actions are ignored this age";
  if (r.stabilizeTo != null) return `Stabilize to ${r.stabilizeTo} this age`;
  if (r.stabilizeOptional) return "Stabilizing is optional this age";
  if (r.stabilizePlus) return `May stabilize to ${r.stabilizePlus} over this age`;
  if (r.noRemoval) return "Traits can't be removed this age";
  if (r.maxPlays) return "One trait per turn this age";
  if (r.heroicFree) return "Heroic may be played freely";
  if (r.extraColourlessPlay) return "A colorless trait may let you play another";
  if (r.noNegative) return "No negative face values this age";
  if (r.noMulti) return "No multi-color traits this age";
  if (r.noDominant) return "No dominant traits this age";
  if (r.envy) return "Stabilize to the Gene Pool on your right";
  if (r.deckFlipped) return "The trait deck is upside down this age";
  if (r.discardPlayedActions) return "Actions you play are discarded after you stabilize";
  if (r.replayBeforeStabilize) return "You may replay an action before you stabilize";
  return null;
}

function renderDecks(g) {
  const host = $("#decks");
  host.innerHTML = "";

  const trait = el("button", "deck");
  const tm = el("div", "deck-mini");
  tm.appendChild(backNode("trait"));
  trait.appendChild(tm);
  const tl = el("div", "deck-label");
  tl.appendChild(el("div", "deck-name", "Traits"));
  tl.appendChild(el("div", "deck-n mono", `${g.traitDeck.length} left`));
  trait.appendChild(tl);
  trait.disabled = !canManualDraw(g, seatOf(g));
  trait.addEventListener("click", doDraw);
  host.appendChild(trait);

  // Discard pile: always browsable, newest first.
  const disc = el("button", "deck");
  const dm = el("div", "deck-top");
  if (g.discard[0]) artInto(dm, g.discard[0], "chip-fb");
  disc.appendChild(dm);
  const dl = el("div", "deck-label");
  dl.appendChild(el("div", "deck-name", "Discard"));
  dl.appendChild(el("div", "deck-n mono", `${g.discard.length} card${g.discard.length === 1 ? "" : "s"}`));
  disc.appendChild(dl);
  disc.disabled = !g.discard.length;
  disc.addEventListener("click", () => openDiscard(g));
  host.appendChild(disc);

  const age = el("button", "deck");
  const am = el("div", "deck-mini");
  am.appendChild(backNode(backKind(g.ageDeck[0])));
  age.appendChild(am);
  const al = el("div", "deck-label");
  al.appendChild(el("div", "deck-name", "Ages"));
  al.appendChild(el("div", "deck-n mono", `${g.ageDeck.length} left`));
  age.appendChild(al);
  age.disabled = g.phase !== "age" || !g.ageDeck.length;
  age.addEventListener("click", doFlip);
  host.appendChild(age);
}

function openDiscard(g) {
  openSheet((body) => {
    header(body, `Discard pile \u00b7 ${g.discard.length}`, "Newest first. Tap a card to read it and swipe through.");
    const grid = el("div", "pick-grid");
    for (const c of g.discard) {
      const b = el("button", "pick");
      artInto(b, c, "pick-fb");
      b.appendChild(el("div", "pick-cap", c.name));
      b.addEventListener("click", () => openCard(c, { siblings: g.discard }));
      grid.appendChild(b);
    }
    body.appendChild(grid);
  });
}

/** Gene Pool is adjusted by hand: ages and catastrophes instruct it directly
 *  ("-1 Gene Pool"), and nothing else in the base game moves it automatically. */
function renderGenePool(g, me) {
  const head = $(".pile-head");
  let box = head.querySelector(".gp");
  if (!box) {
    box = el("div", "gp");
    box.innerHTML = `<button data-gp="-1" aria-label="Lower gene pool">\u2212</button>
      <b></b><button data-gp="1" aria-label="Raise gene pool">+</button>`;
    head.appendChild(box);
    for (const btn of box.querySelectorAll("[data-gp]")) {
      btn.addEventListener("click", () => {
        const d = parseInt(btn.dataset.gp, 10);
        const p = seatOf(S.g);
        if (adjustGenePool(S.g, p, d)) {
          S.g.log.unshift({ text: `${p.name} gene pool ${d > 0 ? "+" : ""}${d} \u2192 ${p.genePool}.` });
          draw();
        }
      });
    }
  }
  box.querySelector("b").textContent = `GP ${me.genePool}`;
  const [minus, plus] = box.querySelectorAll("[data-gp]");
  minus.disabled = me.genePool <= RULES.genePoolMin || g.phase !== "turn";
  plus.disabled = me.genePool >= RULES.genePoolMax || g.phase !== "turn";
}

const COL_ORDER = ["Blue", "Green", "Colorless", "Purple", "Red"];

function renderPile(g, me) {
  $("#pileN").textContent = `${me.traitPile.length} · ${faceScore(me)} pts`;
  renderGenePool(g, me);
  const host = $("#pile");
  host.innerHTML = "";
  if (!me.traitPile.length) {
    const zone = el("div", "matzone");
    const inner = el("div");
    inner.appendChild(el("b", null, "Your trait pile"));
    inner.appendChild(el("span", null, "Traits you play stack here by colour."));
    zone.appendChild(inner);
    host.appendChild(zone);
    host.classList.add("is-empty");
    return;
  }
  host.classList.remove("is-empty");

  const cols = new Map(COL_ORDER.map((c) => [c, []]));
  const doms = [], other = [];
  for (const c of me.traitPile) {
    if (isDominant(c)) { doms.push(c); continue; }
    const hit = COL_ORDER.find((t) => hasColour(c, t));
    (hit ? cols.get(hit) : other).push(c);
  }

  const groups = [
    ...COL_ORDER.map((name) => ({ name, cards: cols.get(name) })),
    { name: "Other", cards: other },
    { name: "Dominant", cards: doms, dom: true },
  ].filter((gr) => gr.cards.length);

  for (const gr of groups) {
    const col = el("div", "col" + (gr.dom ? " dom" : ""));
    col.appendChild(el("div", "col-label mono", `${gr.name} ${gr.cards.length}`));
    const stack = el("div", "stack");
    for (const c of gr.cards) {
      const b = el("button", "chip" + (isDominant(c) ? " dom" : ""));
      b.style.setProperty("--c", hueOf(c));
      b.appendChild(el("span", "chip-sp"));
      b.appendChild(el("span", "chip-v", String(faceValue(c))));
      artInto(b, c, "chip-fb");
      b.addEventListener("click", () => openCard(c, { siblings: me.traitPile }));
      stack.appendChild(b);
    }
    col.appendChild(stack);
    host.appendChild(col);
  }
}

function renderHand(g, me) {
  const host = $("#hand");
  host.innerHTML = "";
  $("#handTitle").textContent = g.phase === "turn" ? `${me.name}'s hand` : "Round complete";

  const stab = $("#stab");
  if (g.phase === "turn") {
    const d = targetHand(g, me) - me.hand.length;
    if (g.stabilizeWaived || noStabilize(g, me)) { stab.textContent = "no stabilizing"; stab.className = "mono stab"; }
    else if (d === 0) { stab.textContent = "stabilized"; stab.className = "mono stab ok"; }
    else if (d > 0) { stab.textContent = `draw ${d}`; stab.className = "mono stab"; }
    else { stab.textContent = `discard ${-d}`; stab.className = "mono stab"; }
  } else stab.textContent = "";

  if (g.phase !== "turn") {
    host.appendChild(el("div", "hand-empty", "Everyone has played. Flip the next age."));
    return;
  }
  if (!me.hand.length) {
    host.appendChild(el("div", "hand-empty", "Your hand is empty — use Can't play to draw 5."));
    return;
  }

  const legal = new Set(playableCards(g, me, EFFECTS).map((c) => c.uid));
  for (const c of me.hand) {
    const ok = legal.has(c.uid) && g.playsLeft > 0;
    const b = el("button", "hc" + (ok ? "" : " no"));
    b.style.setProperty("--c", hueOf(c));
    b.appendChild(el("span", "hc-sp"));
    artInto(b, c, "hc-fb");
    b.addEventListener("click", () => openCard(c, {
      siblings: me.hand,
      // Recomputed per card as you swipe, so Play stays correct for each one.
      at: (cc) => ({
        canPlay: legal.has(cc.uid) && g.playsLeft > 0,
        canDiscard: canManualDiscard(g, me),
        why: !legal.has(cc.uid) ? requirementReason(g, me, cc) : null,
      }),
      canPlay: ok,
      canDiscard: canManualDiscard(g, me),
      why: !legal.has(c.uid) ? requirementReason(g, me, c) : null,
    }));
    host.appendChild(b);
  }
}

function requirementReason(g, me, card) {
  return playBlockReason(g, me, card, EFFECTS);
}

function renderCta(g, me) {
  const cta = $("#cta");
  cta.className = "cta";
  $("#btnCant").disabled = !canDeclareStuck(g, me);
  $("#btnDraw").disabled = !canManualDraw(g, me);

  if (g.phase === "age") {
    cta.classList.add("flip");
    cta.innerHTML = `Flip the next age<span class="cta-sub">${g.ageDeck.length} left in the deck</span>`;
    cta.disabled = !g.ageDeck.length;
    cta.onclick = doFlip;
    return;
  }

  const short = targetHand(g, me) - me.hand.length;
  if (g.playsLeft > 0 && !g.stabilizeWaived) {
    const any = playableCards(g, me, EFFECTS).length;
    cta.disabled = true;
    cta.innerHTML = any
      ? `Play a trait<span class="cta-sub">Tap a card in your hand</span>`
      : `Nothing playable<span class="cta-sub">Use Can't play below</span>`;
    cta.onclick = null;
    return;
  }
  // Cheek Pouches: "Do not stabilize this turn."
  if (noStabilize(g, me)) {
    cta.disabled = false;
    cta.innerHTML = `End turn<span class="cta-sub">Cheek Pouches: no stabilizing this turn</span>`;
    cta.onclick = doEndTurn;
    return;
  }
  // Star Tails: no more drawing this turn, so a short hand stays short.
  if (short > 0 && drawBlocked(g, me)) {
    cta.disabled = false;
    cta.innerHTML = `End turn<span class="cta-sub">Star Tails: no more drawing this turn</span>`;
    cta.onclick = doEndTurn;
    return;
  }
  // Prosperity / Apricity: "you may choose not to stabilize."
  // Ending the turn keeps the hand as it is; Draw / Discard still stabilize.
  if (short !== 0 && mayskipStabilize(g, me)) {
    cta.disabled = false;
    const n = me.hand.length;
    const why = activeRestrict(topAge(g)).stabilizeOptional ? "Prosperity" : "Apricity";
    cta.innerHTML = `End turn without stabilizing<span class="cta-sub">${why}: keep ${n} card${n === 1 ? "" : "s"} \u00b7 or ${short > 0 ? "Draw" : "Discard"} to ${targetHand(g, me)} first</span>`;
    cta.onclick = doEndTurn;
    return;
  }
  if (short < 0) {
    cta.classList.add("warn");
    cta.disabled = true;
    cta.innerHTML = `Discard ${-short} to end turn<span class="cta-sub">Tap a card, then Discard</span>`;
    cta.onclick = null;
    return;
  }
  cta.disabled = false;
  const tgt = targetHand(g, me);
  cta.innerHTML = short > 0
    ? `Stabilize and end turn<span class="cta-sub">Draws ${short} to reach ${tgt}</span>`
    : `End turn<span class="cta-sub">Stabilized at ${tgt}</span>`;
  cta.onclick = doEndTurn;
}

function renderScores() {
  const g = S.g;
  show("scScore");
  const final = topAge(g);
  const winners = scoreWinners(g.scores);
  const lede = final ? `${final.name} ended the world.` : "The world ended.";
  $("#scoreLede").textContent = winners.length > 1
    ? `${lede} Tie at ${g.scores[0].total}! Tap a player to check their score.`
    : `${lede} Tap a player to check their score.`;
  const host = $("#scoreRows");
  host.innerHTML = "";
  (g.scores || []).forEach((s, i) => {
    const row = el("button", "sc-row" + (winners.includes(s.id) ? " win" : ""));
    row.type = "button";
    row.setAttribute("aria-expanded", "false");
    row.appendChild(el("span", "sc-rank mono", String(i + 1)));
    const mid = el("div", null);
    mid.className = "sc-name";
    mid.textContent = s.name;
    row.appendChild(mid);
    row.appendChild(el("span", "sc-parts", `${s.face}${s.bonus >= 0 ? "+" : ""}${s.bonus}${s.adjust ? `${s.adjust > 0 ? "+" : ""}${s.adjust}` : ""}`));
    row.appendChild(el("span", "sc-total", String(s.total)));
    row.appendChild(el("span", "sc-chev", "\u25B8"));
    host.appendChild(row);
    let detail = null;
    row.addEventListener("click", () => {
      if (detail) { detail.remove(); detail = null; row.setAttribute("aria-expanded", "false"); return; }
      detail = scoreDetail(g, s);
      row.after(detail);
      row.setAttribute("aria-expanded", "true");
    });
  });
}

/** The expanded part of a Final scores row: cards, line items and a sum check. */
function scoreDetail(g, s) {
  const b = scoreBreakdown(g, s);
  const box = el("div", "sc-detail");
  if (b.cards.length) {
    const strip = el("div", "sw-cards");
    for (const c of b.cards) {
      const n = el("div", "sw-card lit");
      artInto(n, c, "sw-fb");
      n.addEventListener("click", () => peek(c));
      strip.appendChild(n);
    }
    box.appendChild(strip);
  }
  if (!b.sections.length) box.appendChild(el("div", "sw-line head mono", `${s.name} played no scoring traits.`));
  for (const sec of b.sections) {
    box.appendChild(el("div", "sw-line head mono", sec.title));
    for (const line of sec.lines) {
      const r = el("div", "sw-line" + (line.amount < 0 ? " neg" : ""));
      const nm = el("div", "nm", line.name);
      nm.appendChild(el("div", "why",
        line.kind === "adjust" ? "added by ages and catastrophes"
          : line.kind === "bonus" ? (line.from ? (line.from === "World's End" ? "World's End" : `from ${line.from}'s card`) : "drop of life")
          : "face value"));
      r.appendChild(nm);
      r.appendChild(el("div", "amt", `${line.amount > 0 ? "+" : ""}${line.amount}`));
      box.appendChild(r);
    }
  }
  const sign = (n) => (n < 0 ? `\u2212 ${-n}` : `+ ${n}`);
  box.appendChild(el("div", "sc-check", `Face ${b.face} ${sign(b.bonus)} bonus ${sign(b.adjust)} adj = ${s.total}`));
  return box;
}

/* ------------------------------------------------------------------ *
 * Menus
 * ------------------------------------------------------------------ */

$("#btnDraw").addEventListener("click", doDraw);
$("#btnCant").addEventListener("click", doCantPlay);

$("#btnLog").addEventListener("click", () => {
  openSheet((body) => {
    header(body, "Game log");
    const ul = el("ul", "log-list");
    for (const e of (S.g.log || []).slice(0, 60)) {
      const li = el("li", e.big ? "big" : null, e.text);
      ul.appendChild(li);
    }
    body.appendChild(ul);
  });
});

$("#btnMenu").addEventListener("click", () => {
  openSheet((body) => {
    header(body, "Menu");
    const list = el("div", "plist");
    const nw = el("button", "prow");
    nw.appendChild(el("b", null, "New game"));
    nw.addEventListener("click", () => { closeSheet(); show("scSetup"); });
    list.appendChild(nw);
    // Game Night site hooks — only present when served from the website build.
    if (window.GNReport) {
      const bug = el("button", "prow");
      bug.appendChild(el("b", null, "⚑ Report a bug"));
      bug.addEventListener("click", () => { closeSheet(); window.GNReport.open(); });
      list.appendChild(bug);
    }
    if (location.protocol.startsWith("http")) {
      const home = el("a", "prow");
      home.href = "../testing.html";
      home.style.cssText = "text-decoration:none;color:inherit";
      home.appendChild(el("b", null, "Back to Game Night"));
      list.appendChild(home);
    }
    body.appendChild(list);
  });
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function show(id) {
  for (const s of document.querySelectorAll(".screen")) s.classList.toggle("on", s.id === id);
}

$("#addSeat").addEventListener("click", () => {
  if (S.names.length >= 6) return;
  S.names.push(`Player ${S.names.length + 1}`);
  renderSeats(); checkDeal();
});

function renderMode() {
  for (const b of document.querySelectorAll("#modeRow button")) b.classList.toggle("sel", b.dataset.v === S.mode);
  for (const b of document.querySelectorAll("#levelRow button")) b.classList.toggle("sel", b.dataset.v === S.level);
  $("#countRow").innerHTML = [2, 3, 4, 5, 6].map((n) => `<button data-v="${n}" class="${n === S.count ? "sel" : ""}">${n}</button>`).join("");
  $("#botSetup").hidden = S.mode !== "bots";
  $("#pnpSetup").hidden = S.mode === "bots";
  $("#botNote").textContent = `You and ${S.count - 1} bot${S.count > 2 ? "s" : ""}, named fresh each game.`;
}
$("#modeRow").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.mode = b.dataset.v; renderMode(); checkDeal(); });
$("#levelRow").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.level = b.dataset.v; renderMode(); });
$("#countRow").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.count = +b.dataset.v; renderMode(); checkDeal(); });
$("#myName").addEventListener("input", (e) => { S.myName = e.target.value; });
$("#optPrivate").addEventListener("click", () => {
  S.privateHands = true;
  $("#optPrivate").classList.add("sel"); $("#optOpen").classList.remove("sel");
});
$("#optOpen").addEventListener("click", () => {
  S.privateHands = false;
  $("#optOpen").classList.add("sel"); $("#optPrivate").classList.remove("sel");
});

$("#deal").addEventListener("click", async () => {
  resetUids();
  const bots = S.mode === "bots";
  const botNames = bots ? (window.GNBotNames ? GNBotNames.pick(S.count - 1, [S.myName]) : Array.from({ length: S.count - 1 }, (_, i) => `Bot ${i + 1}`)) : [];
  S.g = dealGame(S.base, {
    names: bots ? [S.myName.trim() || "You", ...botNames] : S.names.map((n, i) => n.trim() || `Player ${i + 1}`),
    bots: bots ? [false, ...botNames.map(() => true)] : [],
    variantKey: S.variant,
    seed: (Date.now() ^ (Math.random() * 1e9)) >>> 0,
  });
  S.g.sets = S.sets.slice();
  if (S.sets.length > 1) S.g.log.unshift({ text: `Playing with ${S.sets.map(setName).join(" + ")}.` });
  S.botFails = 0;
  // just you at the table: no hand-off screens. Pass & play uses the Hands choice.
  S.privateHands = bots ? false : $("#optPrivate").classList.contains("sel");
  S.viewer = null;
  show("scTable");
  draw();
  await gateFor(S.g.activeSeat, "You start. Flip the first age.");
  draw();
});

$("#again").addEventListener("click", () => { clearBeat(); show("scSetup"); });
$("#replayScore").addEventListener("click", () => { clearBeat(); $("#swFF").textContent = "Fast forward"; startWalkthrough(); });

(async function boot() {
  try {
    S.cards = await loadCards();
    const saved = loadPrefs().sets;
    if (Array.isArray(saved)) S.sets = ["base", ...saved.filter((x) => x !== "base" && SETS.some((s) => s.id === x))];
    S.base = poolFor(S.cards, S.sets);
    if (!S.base.length) throw new Error("No Base Game cards in that file.");
    $("#setupLoading").hidden = true;
    $("#setupBody").hidden = false;
    $("#setupAct").hidden = false;
    renderSeats();
    renderSets();
    renderVariants();
    renderMode();
    checkDeal();
  } catch (e) {
    $("#setupLoading").textContent = e.message;
  }
})();
