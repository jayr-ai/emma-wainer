# Emma Wainer — LinkedIn performance dashboard

A static, client-facing LinkedIn analytics dashboard for Emma Wainer, built to the
project brief. No framework, no build step — plain HTML/CSS/ES modules, deployed to
GitHub Pages and kept in sync with a Google Sheet.

## Running it locally

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. (Any static file server works — the app is
plain `fetch()` calls against files in `data/`.)

## Running the tests

```bash
npm test                       # 18 JS tests (node --test), no dependencies
python3 -m unittest discover tests -p "test_*.py" -v   # 15 Python sync tests
```

Both suites run against frozen fixtures (`tests/fixtures/`), not the live data
file, so they stay stable as the Sheet sync updates `data/linkedin_posts.json`
over time.

## Design

The dashboard currently ships with the **generic look from the layout
reference** (`reference/layout-reference.html`) — Fraunces + Manrope, the
teal/orange/cream palette, a solid banner, a plain "CLIENT LOGO" placeholder
in the header — rather than a specific client's brand system. All of it lives
in `css/tokens.css`; swapping in a real client's colors, fonts and logo later
is a matter of editing that one file plus the logo markup in `index.html`
(currently a styled placeholder `<div class="logo-placeholder">`, no `<img>`).

## What's still needed from you

1. **Google Sheet access** (see the one-time setup below) — needed before the
   automatic sync will work.
2. **DNS for the custom domain** (see below).

## Deploying to GitHub Pages

1. Create a new **empty** GitHub repository named `emma-wainer` (or push this
   folder's existing git history to whatever repo you create — it already has
   commits).
   ```bash
   git remote add origin https://github.com/<your-username>/emma-wainer.git
   git push -u origin main
   ```
2. In the repo, go to **Settings → Pages** and set **Source** to
   **"GitHub Actions"**.
3. Still in Settings → Pages, under **Custom domain**, enter
   `emmawainer.azdigitalph.com` and save.
4. At your domain registrar / DNS provider for `azdigitalph.com`, add a CNAME
   record:
   | Type  | Host         | Value                          |
   |-------|--------------|--------------------------------|
   | CNAME | `emmawainer` | `<your-username>.github.io`    |
   (If this were an apex domain instead of a subdomain, you'd add four A
   records — 185.199.108.153, .109.153, .110.153, .111.153 — instead of a
   CNAME. Not needed here since `emmawainer.azdigitalph.com` is a subdomain.)
5. DNS can take anywhere from a few minutes to a few hours to propagate. Once
   GitHub shows the domain as verified, tick **"Enforce HTTPS"**.
6. Every push to `main` deploys automatically via
   `.github/workflows/deploy.yml`. You can also trigger a deploy manually from
   the **Actions** tab → **Sync and deploy** → **Run workflow**.

**This site and its data are public.** GitHub Pages has no built-in access
control, so anyone with the URL (or who finds the repo) can view the dashboard
and the raw `data/linkedin_posts.json` file — nothing sensitive like account
credentials is in it, but the actual post performance numbers are visible to
anyone with the link. The `robots.txt` and `<meta name="robots">` tags stop it
from being indexed by search engines, but they don't restrict who can open the
link directly. If you need real access control later, two options that work
well with a static site like this:
- **Cloudflare Pages + Cloudflare Access** — free tier, email-based login gate.
- **Netlify** — built-in password protection on paid plans.

## One-time Google Sheet setup (service account — recommended)

This keeps the Sheet private; the dashboard only ever reads a service
account's access, never "anyone with the link."

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   new project (or pick an existing one) and enable the **Google Sheets API**
   for it (APIs & Services → Library → search "Google Sheets API" → Enable).
2. Go to **APIs & Services → Credentials → Create Credentials → Service
   account**. Give it any name (e.g. "linkedin-dashboard-sync"). You don't
   need to grant it any project-level role.
3. Open the new service account → **Keys → Add key → Create new key → JSON**.
   This downloads a `.json` file — keep it secret, don't commit it.
4. Open the Google Sheet itself, click **Share**, and share it with the
   service account's email address (it looks like
   `linkedin-dashboard-sync@your-project.iam.gserviceaccount.com`, visible on
   the service account's page) as **Viewer**.
5. In the GitHub repo, go to **Settings → Secrets and variables → Actions**:
   - Under **Variables**, add `GOOGLE_SHEET_ID` = the long ID from the
     Sheet's URL (between `/d/` and `/edit`).
   - Under **Secrets**, add `GOOGLE_SERVICE_ACCOUNT_JSON` = paste the entire
     contents of the JSON key file you downloaded in step 3.
6. Go to the **Actions** tab → **Sync and deploy** → **Run workflow** to
   confirm the first sync works. Check the run's summary for a tab/row count.

### Alternative: API key (only if the Sheet is link-viewable)

If the Sheet is shared as "Anyone with the link can view" (less private —
only do this if that's acceptable), you can skip the service account:

1. In Google Cloud Console, **Credentials → Create Credentials → API key**.
   Restrict it to the Google Sheets API if you want to be tidy.
2. Add it as the GitHub secret `GOOGLE_API_KEY` instead of
   `GOOGLE_SERVICE_ACCOUNT_JSON`. Still add `GOOGLE_SHEET_ID` as a variable.

The sync script checks for `GOOGLE_SERVICE_ACCOUNT_JSON` first; it only falls
back to `GOOGLE_API_KEY` if that's unset.

## How the auto-refresh works

- **Every 6 hours** (and on every push to `main`, and on-demand from the
  Actions tab), `.github/workflows/deploy.yml` runs `scripts/sync_sheet.py`,
  which re-reads every tab whose title contains "Analytics" from the Sheet,
  normalizes it to `data/linkedin_posts.json`, and commits the change if the
  data actually changed.
  - To change the sync frequency, edit the `cron:` line in
    `.github/workflows/deploy.yml`. GitHub's minimum interval is 5 minutes,
    and scheduled runs can be delayed by several minutes at busy times —
    don't rely on it for second-precision timing.
  - If the sync fails for any reason (bad credentials, a renamed header
    column, the Sheet API being down), the workflow fails loudly, emails you
    (as the repo owner), and does **not** deploy — the live site keeps
    showing the last good data.
- **In the browser**, the open dashboard checks `data/meta.json` every 10
  minutes (and immediately when you return to the tab after being away more
  than 5 minutes) and silently loads new data if it changed, without a page
  reload. The small refresh icon next to the date filter lets you force an
  immediate check.

## Project structure

```
index.html
css/tokens.css        brand tokens only — re-skinning for another client means editing this file
css/app.css           layout, components, responsive, print
js/main.js            bootstrap, state, render orchestration
js/data.js            load, validate, filter by date range
js/metrics.js         pure metric functions (unit tested)
js/refresh.js         live-refresh fetching/polling (unit tested, no DOM)
js/charts/*.js        one module per chart (hand-rolled inline SVG, no chart library)
js/components/*.js    date filter, KPI card, banner, panels, table, tooltip
tests/metrics.test.js node --test; asserts the brief's exact acceptance numbers against a frozen fixture
tests/refresh.test.js node --test; mocked-fetch coverage of the refresh module
tests/test_sync.py    python unittest; covers the sync script's parsing and safety rules
scripts/sync_sheet.py Google Sheet → data/linkedin_posts.json + data/meta.json
.github/workflows/deploy.yml   sync (scheduled/manual) + GitHub Pages deploy (every push)
```

## Notes and assumptions

- **No chart library.** The brief suggested d3 as an option; the charts here
  (daily bars, the monthly trend line, sparklines, the posting-rhythm heat
  grid) are hand-rolled inline SVG instead, matching the reference mockup's
  own approach. This kept the page lighter and avoided vendoring a dependency
  for what turned out to be a handful of simple shapes.
- **Fonts** are self-hosted as variable WOFF2 files in `assets/fonts/`
  (Fraunces and Manrope, matching the layout reference, downloaded from
  Google Fonts and committed directly — no runtime Google Fonts request).
- Every number on the page is computed client-side from `data/linkedin_posts.json`
  for whatever date range is selected — nothing is pre-aggregated.
