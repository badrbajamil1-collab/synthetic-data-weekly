# Synthetic Data Weekly — Cloudflare web archive

Vite + React + TypeScript SPA hosted on **Cloudflare Workers + Static Assets**,
backed by **D1** (metadata) and **R2** (PDFs). This is the web platform and live archive;
the Python pipeline remains the source of truth, and the web app provides both edge automation
and an interactive subscriber experience.

Deployed live at: **[synthetic-data-web.coolbadrtv1.workers.dev](https://synthetic-data-web.coolbadrtv1.workers.dev)**

## Current Stack
- **Frontend SPA**: Vite 8 + React 19 + TypeScript.
- **Styling & Design System**: Tailwind CSS v4 with the Horizon warm editorial light theme (`#faf4ec` warm paper canvas, `#162627` deep slate ink, `#e3d6c4` hairline borders, `#0e3e40` deep teal primary, and `#b46319` warm amber accent).
- **Typography**: Playfair Display (display & headlines), Plus Jakarta Sans (UI body), IBM Plex Mono (technical metadata, scores & timestamps).
- **UI & Motion**: shadcn/ui accessible primitives (badge, button, separator, skeleton, tabs), `HorizonRibbon` sunrise canvas, `ritual.ts` calm reading-progress tracker, collapsible `EditorialTakeaway` cards, and `PipelineStepper` live SSE rail.
- **Edge Runtime**: Cloudflare Workers + Static Assets (single-page application with edge API routes under `/api/*`).
- **Database (Metadata & Library)**: Cloudflare D1 SQL database (`synthetic-data-db`) storing weekly reports, scored findings, user accounts & email subscriptions (`users`), user collections, notes, topic follows, and `research_sessions`.
- **Object Storage (PDF Archive)**: Cloudflare R2 bucket (`synthetic-data-reports`) storing and serving publication-ready PDF downloads (`GET` and `HEAD` on `/api/reports/:id/pdf`).
- **Authentication & User State**: Clerk (`@clerk/react` 6 in the browser + `@clerk/backend` 3 token verification in the Worker) powering personal feeds, auto-subscribed weekly email delivery, custom topic follows, and admin controls.
- **Edge Intelligence Pipeline**: LangChain.js + `@langchain/langgraph` inside the Worker with OpenRouter models and a 4-model fallback chain (`OPENROUTER_MODEL` + `OPENROUTER_FALLBACK_MODELS`), scoring items on synthetic data relevance (`score` 1–10) and Well7 domain fit (`well7_fit` 1–10), guarded by extractive citation checks.
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
npm test           # node:test unit suite
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

Routing is a tiny zero-dependency history router (`web/src/lib/router.ts`:
`normalizePath`, `navigate`, `useRoute`, `useLocationSearch`) and `<Link>` in
`web/src/components/link.tsx` (intercepts plain left-clicks only).

| Route | Who | What |
|---|---|---|
| `/` | public | Horizon hero banner with live topic search bar, frosted reading-ritual edition card, and top preview items. |
| `/studio` | public / signed in | **Live Search**: run an on-demand `@langchain/langgraph` `StateGraph` (`collect → clean → rank → fetch → summarise → publish`) for any topic & time window streamed over SSE, or inspect recent D1-checkpointed sessions. |
| `/brief` | public | Redirects to the latest brief. |
| `/brief/<week>` | public | The week's brief: compact Horizon masthead, calm reading check-in, collapsible `EditorialTakeaway`, topic keyword strip, filter/sort bar, and ranked items. Unknown weeks link back to `/archive`. |
| `/feed` | signed in | The current brief filtered to followed topics and sources, the **Weekly email list** subscription toggle, and the **Topics & sources** manager; with zero follows it shows the whole brief plus a pick-topics prompt. |
| `/library` | signed in | Read later, Important, **Notes** (saved entries carrying a note), **Upcoming** (free-text notes about things not in a brief yet). |
| `/archive` | public | Every week, newest to oldest; admins can trigger manual pipeline runs and view signed-in **Weekly email list** subscribers here. |
| anything else | — | Not-found page. |

Navigation follows the signed-in state: the brand logo always links to `/`; signed out shows
**Live Search**, **Weekly Brief**, **Archive (N)** plus Sign up / Sign in buttons; signed in
shows **Live Search**, **Your Feed**, **Weekly Brief**, **Library**, **Archive (N)** plus the
Clerk `UserButton` avatar. Route changes fade in over 200 ms (disabled under
`prefers-reduced-motion`) and reset scroll to the top. Stars on topic chips and source badges
follow/unfollow.

## The LangGraph.js & LangChain.js pipeline

The edge intelligence pipeline lives in `web/worker/pipeline/` and runs as a `@langchain/langgraph` `StateGraph` (`graph.ts`) powering both interactive Live Search runs (`POST /api/research/stream` with SSE node updates) and manual/weekly pipeline runs:

- `graph.ts` — `@langchain/langgraph` `StateGraph` (`collect → clean → rank → fetch → summarise → publish`) with D1 session checkpoints (`research_sessions` table) and live SSE node telemetry.
- `sources.ts` — parameterized collectors: arXiv, Hacker News (Algolia), GitHub, Google News, Reddit r/MachineLearning + r/LocalLLaMA + r/datascience (non-fatal upstream-blocked handling on 403/404), Hugging Face blog, Microsoft/AWS/Google Research, BAIR, Together AI; URL normalisation + cross-source dedupe.
- `llm.ts` — OpenRouter call profile (`reasoning: {effort: low, exclude: true}`, 2000-token default / 8000-token ranking budget, 180s timeout, no SDK retries) plus `candidateModels` and `askWithFallback` across the 4-model chain (`OPENROUTER_MODEL` + `OPENROUTER_FALLBACK_MODELS`, with `free-models-per-day` fast-skip for `:free` fallbacks and fast-fail on 401/403).
- `rank.ts` — batches of 15 items scored 1–10 on synthetic data relevance (`score`) and 1–10 on Well7 fit (`well7_fit`) in parallel waves via `askWithFallback`; sorted by `well7_fit` then `score`.
- `summarise.ts` — full-text fetch per pick + guarded summaries via `askWithFallback`: numbers in the output must exist in the source text, else one repair attempt, then extractive fallback. Fallbacks are counted, never silent.
- `index.ts` — weekly wrapper around `executeResearchGraph` recording `pipeline_runs` rows.

### Cron & Automation (Unified Single-Producer Architecture)
- **GitHub Actions Workflow (`.github/workflows/weekly-report.yml`)** — the **single** weekly producer (Saturday `05:17 UTC` = `08:17 UTC+3` / `13:17 UTC+8`, paired with `.github/workflows/cache-keepalive.yml` on Wednesday `05:17 UTC`). It collects, ranks, verifies links, renders HTML/Markdown/PDF, merges `config.yaml` recipients with signed-in web subscribers from `GET /api/subscribers`, emails the recipients, and publishes the verified report + PDF straight into Cloudflare D1 + R2 via `POST /api/reports/publish` (`publish_to_cloudflare.py`).
- **Cloudflare Worker Cron** — disabled (`"crons": []` in `wrangler.jsonc`) so the Worker never burns duplicate OpenRouter free-tier quota or creates a mismatched report alongside the emailed brief. Live Search (`/studio`) and admin manual runs (`POST /api/pipeline/run`) remain available on demand.
- **Web CI (`.github/workflows/web-ci.yml`)** — automatically runs `npm test`, `npm run build` (`tsc -b && vite build`), and `npm run lint` (`oxlint`) on push/PR touching `web/**`.

Run it manually as an admin: **Run the pipeline now** on `/archive` (admins only,
requires a Clerk sign-in whose email is in `ADMIN_EMAILS`), which POSTs `/api/pipeline/run`.

## Security, Caching & Endpoints

- All authenticated/admin/private endpoints (`/api/me`, `/api/my/*`, `/api/subscribers`, `/api/pipeline/runs`, `/api/pipeline/run`, `/api/pipeline/auth`, `DELETE /api/reports/:id`, `POST /api/reports/publish`) return `Cache-Control: private, no-store`.
- `GET /api/pipeline/runs` and `GET /api/subscribers` are fail-closed behind `pipelineAuth` (`Authorization: Bearer <CRON_RUN_TOKEN>` or signed-in Clerk admin).
- `/api/reports/:id/pdf` supports both `GET` and `HEAD`, sanitizes `Content-Disposition` filenames, and sets `Content-Length` when known.

## Sign-in, Weekly Email List & Personal Library

- The SPA signs in through Clerk (Sign in / Sign up buttons open Clerk's modal;
  the `UserButton` avatar signs out).
- Every signed-in request carries the Clerk session JWT as
  `Authorization: Bearer <token>`. The Worker verifies it with `verifyToken`
  from `@clerk/backend` (`web/worker/auth.ts`), fail-closed: without
  `CLERK_SECRET_KEY` configured, or on any verification error, all `/api/me`,
  `/api/my/*` routes return 401 and admin routes return 403.
- Identity is the Clerk user id (`user_xxx`), stored as `users.id`; email and
  `username` (resolved from Clerk `username`, full/first+last name, or email local-part)
  are refreshed on every signed-in request.
- **Automatic weekly email subscription:** On first sign-in (`upsertUser`), `users.email_subscribed` defaults to `1` so the account's `username` and `email` appear in `GET /api/subscribers` and are merged into Saturday email sends by Python's `emailer.py`. Signed-in users can pause or resume anytime via `PUT /api/my/subscription` on `/feed` without subsequent sign-ins overwriting their preference.
- Admin = email in `wrangler.jsonc` `vars.ADMIN_EMAILS` (`badrbajamil1@gmail.com,coolbadrtv1@gmail.com`).
  Admins may trigger manual pipeline runs and inspect the signed-in weekly email list from `/archive`.
- Per-person state (`users`, `user_items`): stores email subscription state, read-later, important, and notes per item.
- Per-person follows and upcoming notes (`user_topics`, `user_notes`): custom feeds and note capture.
- The public archive (`GET /api/reports*`, `GET`/`HEAD` PDFs, `/api/health`, `/api/research/sessions*`, `/api/archive/counts`) needs no sign-in.

## OpenRouter quota

The account key is on OpenRouter's free tier: **50 free-model requests per day**
(across all `:free` models), reset ~00:00 UTC. `askWithFallback` automatically walks
`OPENROUTER_MODEL` and `OPENROUTER_FALLBACK_MODELS` and fast-skips remaining `:free`
models if `free-models-per-day` is hit (while still attempting any configured non-`:free`
model). Adding credits raises the cap to 1000/day.

## Publishing from the Python pipeline
`publish_to_cloudflare.py` (on `main`) reads `progress/week-*/source.yaml`, `run_log.json`, and the rendered PDF, then POSTs the verified report + PDF to `POST /api/reports/publish` (authenticated via `Authorization: Bearer <CRON_RUN_TOKEN>`). The Worker uploads the PDF to R2 (`reports/week-<date>.pdf`) and upserts the report and items into D1 so the web archive and email brief match 1:1.
