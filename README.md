# Game Night

Free card and tile games that run entirely in the browser. No accounts, no server, no ads.

| Folder | What it is |
|---|---|
| `games/flip7/` | Flip 7: rules engine (`engine.js`), UI (`src.html`), simulation tests (`test.js`) |
| `games/tap4/` | Tap 4: rules engine, UI (`app.js`, `src.html`), simulation tests |
| `games/mahj/` | Mahj: American-style mahjong vs 3 bots (single file) |
| `games/tally/` | Tally: scorekeeper for real-life games (single file) |
| `site/` | Home page and offline support (`sw.js`) |
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
The relay lives in `worker/`; setup steps are in `worker/SETUP.md`. The buttons
stay hidden until `report.config.json` has the relay's address.

## Local preview
```
npm test && npm run build
python3 -m http.server -d _site 8000
```

## Adding a game
Put it in `games/<id>/`, add an entry to `GAMES` in `scripts/build-site.js`, add
`icons/<id>-{180,192,512}.png`, and add a card to `site/index.html`.

Fan-made versions for friends and family; not affiliated with the original publishers.
