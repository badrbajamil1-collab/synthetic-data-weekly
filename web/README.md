# Synthetic Data Weekly — Cloudflare web archive

Vite + React + TypeScript SPA hosted on **Cloudflare Workers + Static Assets**,
backed by **D1** (metadata) and **R2** (PDFs). This is the web platform and live archive;
the Python pipeline remains the source of truth, and the web app provides both edge automation
and an interactive subscriber experience.

Deployed live at: **[synthetic-data-web.coolbadrtv1.workers.dev](https://synthetic-data-web.coolbadrtv1.workers.dev)**

## Current Stack
- **Frontend SPA**: Vite 8 + React 19 + TypeScript.
- **Styling & Design System**: Tailwind CSS v4 with an editorial light theme (`#f3f6fa` canvas, `#102a43` deep slate ink, `#d6e0ea` hairline borders, and `#0b6f6b` mint accents).
- **Typography**: IBM Plex Serif (headlines & statistics), IBM Plex Sans (interface body), IBM Plex Mono (technical labels, scores & metadata).
- **UI & Motion**: shadcn/ui accessible primitives (buttons, badges, cards, tabs, separators, skeletons), Magic UI (`NumberTicker`, `BlurFade`), and static editorial pipeline schematics following strict information-density standards (`diagram-design`).
- **Edge Runtime**: Cloudflare Workers + Static Assets (single-page application with edge API routes under `/api/*`).
- **Database (Metadata & Library)**: Cloudflare D1 SQL database (`synthetic-data-db`) storing weekly reports, scored findings, user collections, notes, and topic follows.
- **Object Storage (PDF Archive)**: Cloudflare R2 bucket (`synthetic-data-reports`) storing and serving publication-ready PDF downloads.
- **Authentication & User State**: Clerk (`@clerk/react` 6 in the browser + `@clerk/backend` 3 token verification in the Worker) powering personal feeds, custom topic follows, and admin controls.
- **Edge Intelligence Pipeline**: LangChain.js inside the Worker with OpenRouter models, scoring items on both synthetic data relevance (`score` 1–10) and Well7 domain fit (`well7_fit` 1–10), guarded by extractive citation checks.
- **Tooling & Linter**: Cloudflare Vite plugin (`@cloudflare/vite-plugin`), Wrangler 4, Oxlint.

## Local development
```powershell
cd web
npm install
npm run dev        # http://localhost:5173
```

## Build & preview
```powershell
npm run build      # tsc -b && vite build
npm run preview    # runs the built Worker locally
npm run lint       # oxlint
```

## Deploy
1. Create the D1 database and R2 bucket:
   ```powershell
   npx wrangler d1 create synthetic-data-db
   npx wrangler r2 bucket create synthetic-data-reports
   ```
2. Update `wrangler.jsonc` with the real `database_id`.
3. Apply migrations:
   ```powershell
   npx wrangler d1 migrations apply synthetic-data-db --local
   npx wrangler d1 migrations apply synthetic-data-db --remote
   ```
4. Deploy:
   ```powershell
   npx wrangler deploy
   ```

## Pages & routes

Routing is a tiny zero-dependency history router (`web/src/lib/router.tsx`:
`useRoute`, `navigate`, `<Link>` — intercepts plain left-clicks only), no
client-side routing dependency.

| Route | Who | What |
|---|---|---|
| `/` | public | Landing: hero with static editorial intake schematic, this week's stats, CTAs. |
| `/brief` | public | Redirects to the latest brief. |
| `/brief/<week>` | public | The week's brief: importance donut + source/topic bars (static SVG under the title), the editorial read, ranked items, headlines. A deep link to an unknown week says so and links back to the archive. |
| `/feed` | signed in | The current brief filtered to the topics and sources I follow, with the **My topics** manager; with zero follows it shows the whole brief plus a pick-topics prompt, never an empty page. |
| `/library` | signed in | Read later, Important, **Notes** (saved entries carrying a note), **Upcoming** (free-text notes about things not in a brief yet). |
| `/archive` | public | Every week, oldest to newest; admins trigger pipeline runs from here. |
| anything else | — | Not-found page. |

Navigation follows the signed-in state: signed out the logo goes to `/` with
**Brief**/**Archive** links plus Sign in / Sign up buttons; signed in the logo
goes to `/library` with **Feed**/**Brief**/**Library**/**Archive** links plus
the avatar. A route change fades the incoming page in (220 ms, disabled under
`prefers-reduced-motion`) and resets the scroll to the top. Stars on topic
chips and source badges follow/unfollow.

## The LangChain.js pipeline

A second pipeline lives in `web/worker/pipeline/` and runs the weekly
collect → rank → summarise → report job inside the Worker on the Cron Trigger:

- `sources.ts` — collectors: arXiv, Hacker News (Algolia), GitHub, Google News,
  Reddit r/MachineLearning + r/LocalLLaMA, Hugging Face blog, Microsoft/AWS/
  Google Research, BAIR, Together AI; URL normalisation + cross-source dedupe.
- `llm.ts` — the OpenRouter call profile copied from the verified Python setup
  (`src/synthetic_data/llm.py`): `reasoning: {effort: low, exclude: true}`,
  2000-token budget, 180s timeout, no SDK retries.
- `rank.ts` — batches of 15 items scored 1–10 on synthetic data relevance and
  1–10 on Well7 fit in parallel waves; sorted by `well7_fit` then `score`.
- `summarise.ts` — full-text fetch per pick + guarded summaries: numbers in the
  output must exist in the source text, else one repair attempt, then extractive
  fallback. Fallbacks are counted, never silent.
- `index.ts` — orchestrator: history dedupe against previously published URLs,
  stable item IDs (SHA-256 of normalised URL, first 8 bytes), `reports`/`items`
  upserts, and `pipeline_runs` row tracking.

### Cron & Automation
- **Cloudflare Worker Cron**: `0 5 * * 6` (Saturday 05:00 UTC = 08:00 Saudi time).
- **GitHub Actions Workflow (`.github/workflows/weekly-report.yml`)**:
  - Triggers weekly at `0 5 * * 6` (Saturday 05:00 UTC).
  - Runs safe dry-run pipeline (`python main.py --pipeline --dry-run`).
  - Persists LLM score and dedupe caches via `actions/cache@v4`.
  - Saves report artifacts and PDF downloads.
- **Web CI (`.github/workflows/web-ci.yml`)**:
  - Automatically tests frontend builds, TypeScript compliance (`tsc -b`), and `oxlint` on push/PR touching `web/**`.

Run it manually as an admin: **Run the pipeline now** on the site (admins only,
requires a Clerk sign-in whose email is in `ADMIN_EMAILS`), which POSTs
`/api/pipeline/run`.

## Future Plans: Cloudflare Email Service (Free)

- **Worker Native Dispatch**: Move away from external SMTP providers by utilizing **Cloudflare Workers Email Routing / `send_email` binding** available on Cloudflare's free tier.
- **Automated Delivery**: As soon as the Worker cron job completes the research brief and mints the R2 PDF, the Worker can compose the HTML newsletter and dispatch it directly to Well7 subscribers.
- **Audience Management in D1**: Subscriber profiles, frequency settings, and custom topic filters will be stored in D1 (`users`, `user_topics`).

## Sign-in and the personal library

- The SPA signs in through Clerk (Sign in / Sign up buttons open Clerk's modal;
  the `UserButton` avatar signs out).
- Every signed-in request carries the Clerk session JWT as
  `Authorization: Bearer <token>`. The Worker verifies it with `verifyToken`
  from `@clerk/backend` (`web/worker/auth.ts`), fail-closed: without
  `CLERK_SECRET_KEY` configured, or on any verification error, all `/api/me`,
  `/api/my/*` routes return 401 and `/api/pipeline/run` returns 403.
- Identity is the Clerk user id (`user_xxx`), stored as `users.id`; the email is
  refreshed from the Clerk Backend API on every signed-in request.
- Admin = email in `wrangler.jsonc` `vars.ADMIN_EMAILS` (`badrbajamil1@gmail.com`).
  Admins may trigger manual pipeline runs from the site.
- Per-person state (`users`, `user_items`): stores read-later, important, and notes per item.
- Per-person follows and upcoming notes (`user_topics`, `user_notes`): custom feeds and note capture.
- The public archive (`/api/reports*`, PDFs, `/api/health`) needs no sign-in.

## OpenRouter quota

The account key is on OpenRouter's free tier: **50 free-model requests per day**
(across all `:free` models), reset ~00:00 UTC. The cron run needs ~20+ calls, so
a Saturday 05:00 UTC cron is fine on its own, but the Python pipeline burning
the same day's quota first will starve this one (rank degrades to score-1
fallbacks, disclosed in `pipeline_runs.error`). Adding credits raises the cap
to 1000/day.

## Publishing from the Python pipeline
A `publish_to_cloudflare.py` script (to be added at the repo root) will read
`progress/week-*/source.yaml`, `report.md`, `report.html`, the PDF, `run_log.json`
and `ranked.json`, then push them into D1/R2 via the Worker API with a secret
token. For now, week data can be inserted directly with `npx wrangler d1 execute`.
