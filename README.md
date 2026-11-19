# Game Night

Free card and tile games that run entirely in the browser. No accounts, no server, no ads.

| Folder | What it is |
|---|---|
| `games/flip7/` | Flip 7: rules engine (`engine.js`), UI (`src.html`), simulation tests (`test.js`) |
| `games/tap4/` | Tap 4: rules engine, UI (`app.js`, `src.html`), simulation tests |
| `games/mahj/` | Mahj: American-style mahjong vs 3 bots (single file) |
| `games/tally/` | Tally: scorekeeper for real-life games (single file) |
| `games/doomlings/` | Doomlings (testing): bundled phone build + smoke test |
| `games/paydirt/` | Paydirt (testing): rules engine (`engine.js`), team charts (`teams.js`, built by `tools/make_charts.py` from nflverse play-by-play), UI (`src.html`), simulation tests (`test.js`) |
| `site/` | Home page, testing area (`testing.html`) and offline support (`sw.js`) |
| `icons/` | App icons for each game |
| `scripts/build-site.js` | Assembles everything into `_site/` |
| `worker/` | Bug-report relay (Cloudflare Worker) + tests + setup steps |
| `report.config.json` | Address of the bug-report relay |

## How publishing works
Every push to `main` runs the tests, builds `_site/`, and publishes it with GitHub Pages
(`.github/workflows/pages.yml`). Each game installs as its own app from the browser
("Add to Home Screen"), works offline, and saves games in that browser only.

One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

## Bug reports
Every app has a **⚑ Report a bug** button. Reports become GitHub Issues labeled
`bug-report` and `game:<id>`, with the device, recent on-screen events, errors, and
(if the player allows) their saved game attached so the bug can be replayed.
Players can see what's already reported on **Known issues** (`site/issues.html`), and the
report sheet lists this game's open reports (and flags a lookalike as they type) so duplicates
don't get filed. Both read open `bug-report` issues straight from GitHub's public API
(`site/known-issues.js`). Labels shown to players: `fix-planned`, `fix-in-review`, `needs-info`.

## Update notice and "what's fixed"
Every build writes `version.json` (build time + recent entries from `changelog.json`).
`site/update.js` checks it when an app opens, when you return to it, and when you start a
new game. If you're on an old cached copy it shows a splash listing what's been fixed and a
**Refresh now** button; after updating it shows "Fixed since your last visit" once.
**When you fix a player-visible bug, add an entry to `changelog.json`:**
`{ "date": "<ISO UTC now>", "game": "tap4", "issue": 19, "text": "One short, player-friendly sentence." }`
(`npm test` checks the file.)

The relay lives in `worker/`; setup steps are in `worker/SETUP.md`. The buttons
stay hidden until `report.config.json` has the relay's address.

## Local preview
```
npm test && npm run build
python3 -m http.server -d _site 8000
```

## Adding a game
Put it in `games/<id>/` (optionally with a `desktop.css`), add an entry to `GAMES` in `scripts/build-site.js`, add
`icons/<id>-{180,192,512}.png`, and add a card to `site/index.html`.

## Desktop vs. phone layout
`shared/layout.js` is inlined into every game at build time. On a computer (mouse or trackpad, and
a window at least 900×560) it adds `gn-desktop` to `<html>`; phones and tablets get `gn-mobile`.
Each game's desktop styles live in `games/<id>/desktop.css`. Flip 7, Tap 4 and Mahj lay their table
out on a virtual landscape screen (`fit` in `GAMES`) and scale it up to fill the window.
To test either layout on any device, add `?layout=desktop` or `?layout=mobile` to the URL; the choice is
remembered until you use `?layout=auto`.

## Testing area
Games still in development go on `testing.html` (linked from the home page footer)
instead of the main grid. Mark the `GAMES` entry `testing: true` — that adds a
`noindex` tag so search engines skip it — and put its card in `site/testing.html`.
To graduate a game, drop the flag and move its card to `site/index.html`.

Doomlings is built in its own project; copy the regenerated `doomlings_phone.html`
over `games/doomlings/index.html` to update it (keep the menu hooks near
"Game Night site hooks").

Fan-made versions for friends and family; not affiliated with the original publishers.
