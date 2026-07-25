# NYC Cabaret Scene

A calendar site aggregating NYC cabaret/supper-club listings ([cabaretscene.com](https://cabaretscene.com)) from several venues into one place.

Two parts:

- **This Next.js app** — the public site (calendar UI, venue filters, etc.)
- **`nyc-cabaret-worker/`** — a standalone Node script, deployed as a [Render](https://dashboard.render.com) cron job (`nyc-cabaret-worker-cron`), that scrapes each venue and upserts events into Supabase. Runs `node index.mjs`, currently scheduled Tuesday/Friday at 06:00 UTC. The site reads from the same Supabase `events`/`venues` tables.

## Venues & connectors

Each venue has its own file under `nyc-cabaret-worker/connectors/`, called from `index.mjs`. Every venue import is wrapped in its own try/catch — one venue failing never blocks the others.

| Venue | Slug | Connector | Source |
|---|---|---|---|
| 54 Below | `54-below` | `54below.mjs` | HTML scrape, monthly calendar pages |
| Don't Tell Mama | `dont-tell-mama` | `donttellmama.mjs` | HTML scrape, month grid |
| Joe's Pub | `joes-pub` | `joespub_official.mjs` + `joespub.mjs` | See note below |
| Chelsea Table + Stage | `chelsea-table-stage` | `ics.mjs` | ICS feed |
| Laurie Beechman Theatre | `beechman` | `beechman2.mjs` | S3 JSON behind the venue's booking widget, ICS/HTML fallback |
| Pangea | `pangea` | `ics.mjs` | ICS feed (WordPress Events Calendar) |
| The Green Room 42 | `green-room-42` | `greenroom42.mjs` | Headless browser (Playwright), see below |

**Joe's Pub**: `fetchJoesPubOfficial()` (publictheater.org) currently always returns 0 — their calendar is rendered client-side by an Angular app, so a plain HTTP fetch only sees template placeholders (`{{ item.title }}`), never real data. The worker silently falls back to `fetchJoesPubFromDoNYC()`, a third-party listing site, which is what's actually powering Joe's Pub on the calendar right now. DoNYC only turns up ~25 shows over a 6-month window (vs. 324 for 54 Below in the same window), so it's likely missing a real chunk of Joe's Pub's actual schedule. **Follow-up**: build a headless-browser connector for Joe's Pub's real calendar, same approach as Green Room 42 below, now that Playwright is already a dependency.

**Green Room 42**: no fetchable JSON/ICS feed — their booking platform (VenueTix) streams data out of Firestore over a real-time connection with no plain HTTP endpoint to hit. `greenroom42.mjs` instead loads the public page in a headless Chromium browser (Playwright), clicks "Show more" a few times, and reads the rendered event cards off the DOM directly (selectors are Vuetify component classes, confirmed against the live site).

This is the only connector that needs a real browser, which matters for where it runs:

- **Runs first** in `index.mjs`, before the other six venues, so it gets first crack at this cron job's memory budget before the other connectors' data piles up in the same process.
- **Chromium launches with low-memory flags** (`--disable-dev-shm-usage`, `--disable-gpu`, `--single-process`, `--no-zygote`) and a small 800×900 viewport — this cron job is capped at 512Mi on Render's Starter plan, and a default Chromium launch alongside everything else blows past that.
- **Requires `PLAYWRIGHT_BROWSERS_PATH=0` set as an actual Render environment variable** (Dashboard → this cron job → Environment), not just inline in `package.json`. Render's build and run phases don't share Playwright's default browser cache directory (`/opt/render/.cache/ms-playwright`), so without this, Chromium downloads fine at build time and then can't be found at runtime. Setting `PLAYWRIGHT_BROWSERS_PATH=0` makes Playwright install the browser inside `node_modules/playwright-core` instead, which does carry over.
- `package.json`'s `postinstall` runs `playwright install chromium` (no `--with-deps` — Render's build environment doesn't allow the sudo/su access that flag needs to install OS-level packages, and the standard build image normally has what Chromium needs already).
- If this still runs out of memory on a given deploy, the honest fix is bumping Render's plan for this job — there's a real floor to how small a headless browser process can get.

## Known open issues

- **Don't Tell Mama** has been importing 0 events on recent runs — not yet investigated.
- **Joe's Pub** is running on an incomplete third-party fallback (see above) — a real fix means a headless connector for their official calendar.

## Data model notes

- `events.uid_hash` = `sha1(venue_slug|title|start_iso)` — this is the sole identity key used to decide insert vs. update vs. "this is the same show, just retitled." Connectors generally hash the *raw* scraped title text (not the cleaned-up display title), so improving title-cleanup logic later doesn't orphan already-imported rows as duplicates.
- `upsert()` in `index.mjs` pairs up an orphaned existing row with an orphaned incoming event when they share the exact same `start_at` and the pairing is unambiguous (exactly one on each side) — this is what prevents a venue's minor title edit (typo fix, added performer) from showing up as a duplicate listing instead of updating the existing one. Genuinely ambiguous cases (concurrent-room venues, two different shows colliding on time) are left alone by design.
- Supabase/PostgREST caps a single `select` at 1000 rows — `fetchAllExisting()` paginates explicitly so a venue crossing that threshold (54 Below already has) doesn't silently truncate and cause duplicate-insert crashes.

## Getting Started (site)

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
