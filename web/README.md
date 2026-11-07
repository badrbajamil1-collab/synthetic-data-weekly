# Synthetic Data Weekly — Cloudflare web archive

Vite + React + TypeScript SPA hosted on **Cloudflare Workers + Static Assets**,
backed by **D1** (metadata) and **R2** (PDFs). This is the *test* web view;
the Python pipeline remains the source of truth, and email is deferred.

## Stack
- Vite 8 + React 19 + TypeScript
- Tailwind CSS v4
- shadcn/ui primitives (buttons, badges, cards, tabs, separators, skeletons)
- Magic UI (`NumberTicker`, `BlurFade`) and Aceternity UI (`BackgroundBeams`),
  with reduced-motion support
- Clerk authentication (`@clerk/react` 6 SPA + `@clerk/backend` 3 token
  verification in the Worker)
- Cloudflare Vite plugin (`@cloudflare/vite-plugin`)
- Wrangler 4 (dev/deploy)
- D1 database `synthetic-data-db`
- R2 bucket `synthetic-data-reports`

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
| `/` | public | Landing: hero, this week's stats, CTAs. |
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
chips and source badges follow/unfollow (spec "Following topics and sources").

## The LangChain.js pipeline (new)

A second pipeline lives in `web/worker/pipeline/` and runs the same weekly
collect → rank → summarise → report job inside the Worker on the Cron Trigger:

- `sources.ts` — collectors: arXiv, Hacker News (Algolia), GitHub, Google News,
  Reddit r/MachineLearning + r/LocalLLaMA, Hugging Face blog, Microsoft/AWS/
  Google Research, BAIR, Together AI; URL normalisation + cross-source dedupe.
- `llm.ts` — the OpenRouter call profile copied from the verified Python setup
  (`src/synthetic_data/llm.py`): `reasoning: {effort: low, exclude: true}`,
  2000-token budget, 180s timeout, no SDK retries (an identical repeat call just
  burns the budget again).
- `rank.ts` — batches of 15 items scored 1–10 in one parallel wave; a batch
  whose JSON never parses keeps its items at score 1 and is counted.
- `summarise.ts` — full-text fetch per pick + guarded summaries: numbers in the
  output must exist in the source text, else one repair attempt, then extractive
  fallback. Fallbacks are counted, never silent.
- `index.ts` — orchestrator: history dedupe against previously published URLs,
  stable item IDs (SHA-256 of normalised URL, first 8 bytes) so a user's saved
  papers survive a rerun, `reports`/`items` upserts, and a `pipeline_runs` row
  per run (`running` → `succeeded`/`failed` with the fallback counts in
  `error`).

Cron schedule: `0 5 * * 6` (Saturday 05:00 UTC = 08:00 Saudi time).

Run it manually as an admin: **Run the pipeline now** on the site (admins only,
requires a Clerk sign-in whose email is in `ADMIN_EMAILS`), which POSTs
`/api/pipeline/run`.

## Sign-in and the personal library

Clerk replaced Cloudflare Access (Zero Trust was too confusing to operate for a
single-user side project). How it works now:

- The SPA signs in through Clerk (Sign in / Sign up buttons open Clerk's modal;
  the `UserButton` avatar signs out). DOM identity comes from Clerk, not the
  Worker.
- Every signed-in request carries the Clerk session JWT as
  `Authorization: Bearer <token>`. The Worker verifies it with `verifyToken`
  from `@clerk/backend` (`web/worker/auth.ts`), fail-closed: without
  `CLERK_SECRET_KEY` configured, or on any verification error, all `/api/me`,
  `/api/my/*` routes return 401 and `/api/pipeline/run` returns 403.
- Identity is the Clerk user id (`user_xxx`), stored as `users.id`; the email is
  refreshed from the Clerk Backend API on every signed-in request.
- Admin = email in `wrangler.jsonc` `vars.ADMIN_EMAILS`
  (`badrbajamil1@gmail.com`, from the root `ADMIN_EMAILS` var). Admins may
  trigger manual pipeline runs from the site.
- Keys: `VITE_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` live in
  `web/.env.local` (gitignored, pulled with `npx clerk env pull`); the
  production `CLERK_SECRET_KEY` is a Worker secret (`npx wrangler secret put
  CLERK_SECRET_KEY`). The Clerk app is "My Application"
  (`app_3LiTTIpe5G9aLzwaB2taa56eo44`), development instance for now — a
  production instance needs a custom domain (`npx clerk deploy`).
- Manual pipeline runs: `POST /api/pipeline/run` accepts either an admin Clerk
  token or `Authorization: Bearer <CRON_RUN_TOKEN>` (a Worker secret, stored in
  the root `.env` and `.dev.vars` locally; never committed). Without either
  credential it answers 403.
- Per-person state (`users`, `user_items` — migration `0003_user_library.sql`)
  stores read-later, important and note per item id; identity = the Clerk user
  id. `PUT /api/my/items/<id>` with `{read_later, important, note}`;
  `GET /api/my/library` joins items + week back in.
- Per-person follows and upcoming notes (migration
  `0004_user_topics_notes.sql`): `user_topics(user_id, kind ∈ {topic, source},
  value)` decides what the feed shows; `user_notes(id, user_id, body,
  created_at)` holds the Upcoming entries. Endpoints, all Clerk-gated:
  `GET /api/my/topics` → `{topics: [{kind, value}]}`; `PUT`/`DELETE
  /api/my/topics` with `{kind, value}` re-answer `{topics}`; `GET /api/my/notes`
  → `{notes: [{id, body, created_at}]}` newest first; `POST /api/my/notes` with
  `{body}` (trimmed, ≤2000 chars) → `{note}`; `DELETE /api/my/notes/<id>` →
  `{notes}`, 404 unless the row belongs to the caller; `GET /api/me` also
  returns `topics` so the feed can filter on first paint.
- The public archive (`/api/reports*`, PDFs, `/api/health`) needs no sign-in;
  the personal library, follows and notes do.

## OpenRouter quota (counts for this Worker too)

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
token. For now, insert test rows manually with `npx wrangler d1 execute`.

## Notes
- `cf` CLI is the recommended Cloudflare CLI for new projects, but this scaffold
  uses Wrangler because the Vite plugin and D1 migrations are Wrangler-native.
  Migrate to `cf` later with `cf migrate` if desired.
- Email sending is intentionally not implemented here (deferred).
- One wrangler gotcha: `wrangler dev` persists local state relative to the
  working directory (`web/.wrangler/state`), while `wrangler d1` commands default
  to the config's directory (`dist/worker/.wrangler`). Always pass
  `--persist-to ".wrangler/state"` to every wrangler command (dev, d1 execute,
  migrations) so they share one state.