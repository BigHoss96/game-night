# Turning on bug reports (one-time, works from a phone)

Reports go: **game → your Cloudflare Worker → a GitHub Issue in this repo.**
The worker holds a GitHub token so the public website never has to.

## 1. Make a GitHub token that can only file issues
1. github.com/settings/personal-access-tokens/new (Fine-grained token)
2. Name: `game-night bug reports`. Expiration: 1 year (or no expiration).
3. Repository access → **Only select repositories** → `game-night`.
4. Permissions → Repository permissions → **Issues: Read and write**. Nothing else.
5. Generate, then copy the token (starts with `github_pat_`). You only see it once.

## 2. Create the worker on Cloudflare (free)
1. dash.cloudflare.com → sign up / log in.
2. **Workers & Pages → Create → Create Worker** (start from "Hello World").
   Name it `game-night-bugs`, then **Deploy**.
3. **Edit code** → delete everything → paste all of `worker/bug-report-worker.js`
   (open it on GitHub → Raw → select all → copy) → **Deploy**.
4. Worker → **Settings → Variables and Secrets → Add**:
   - `GITHUB_TOKEN`: type **Secret**, value = the token from step 1
   - `REPO`: type Text, `BigHoss96/game-night`
   - `ALLOWED_ORIGINS`: type Text, `https://bighoss96.github.io`
   Then **Deploy** again.
5. Copy the worker's address, e.g. `https://game-night-bugs.<you>.workers.dev`.
   Opening it should show `"configured":true`.

## 3. Point the site at it
Put that address in `report.config.json` as `"endpoint"` and push.
The ⚑ Report a bug buttons appear once the site republishes.

## Updating the worker
The worker doesn't update itself when you push. After `worker/bug-report-worker.js` changes:
Cloudflare → your worker → **Edit code** → delete everything → paste the new file → **Deploy**.

## Spam protection
- **Built in, no setup:** at most 20 reports an hour site-wide (it counts what GitHub already has).
  To change it, add a Text variable `HOURLY_CAP`, e.g. `40`.
- **Optional bot check (recommended): Cloudflare Turnstile**, free.
  1. dash.cloudflare.com → **Turnstile → Add widget**. Hostname: `bighoss96.github.io`. Mode: Managed.
  2. Copy the **Site key** into `report.config.json` as `"turnstileSiteKey"` and push.
  3. Copy the **Secret key** into the worker as a **Secret** named `TURNSTILE_SECRET`, then **Deploy**.
  Do step 2 before (or together with) step 3. Once the secret is set, the worker refuses any report
  without a passing check, so a site without the site key couldn't send reports.

## If something goes wrong
- `"configured":false`: a variable is missing or misspelled; redeploy after adding.
- Reports fail with "GitHub refused (401/403)": the token expired or lacks Issues access.
- Reports fail with 403 "not allowed": `ALLOWED_ORIGINS` doesn't match the site address exactly.
- Reports fail with "robot check didn't go through": `TURNSTILE_SECRET` is set but the site key is
  missing from `report.config.json`, or the Turnstile widget's hostname doesn't match the site.
