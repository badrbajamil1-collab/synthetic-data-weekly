# Live LangGraph.js Research Workflow & Editorial Lab UI Redesign

**Date:** 2026-11-08
**Status:** draft for review
**Scope:** `web/` (Cloudflare Worker + D1 + LangGraph.js pipeline + React SPA)

## Goal

1. Replace the batch-only procedural Worker pipeline (`web/worker/pipeline/index.ts`) with a real **`@langchain/langgraph` `StateGraph`** (`collect → clean → rank → fetch → summarise → publish`) that powers **both** on-demand interactive topic research ("Check Now") and the scheduled/manual Weekly Brief.
2. Stream live node-by-node progress and intermediate results over **Server-Sent Events (`POST /api/research/stream`)** while checkpointing each stage in D1 (`research_sessions`).
3. Redesign the web interface into a high-craft **Editorial Research Lab** aesthetic with an obsidian command header, refined typography/card elevation, unified split-action topic pills (filter vs. star follow), and a live **Research Console** (`/studio`) where users watch each LangGraph node populate results in real time.

## Non-goals

- No Durable Objects or paid Cloudflare Workflows bindings; runs natively in the existing Worker + D1 architecture.
- No changes to the Python CLI pipeline (`src/synthetic_data/`).
- No change to authentication provider (Clerk remains the identity layer).

## Architecture: LangGraph.js `StateGraph` (`web/worker/pipeline/graph.ts`)

We add `@langchain/langgraph` to `web/package.json` and define `ResearchState` using `Annotation.Root`:

| Field | Type | Description |
|---|---|---|
| `sessionId` | `string` | UUID for the run (`research_sessions.id`). |
| `mode` | `'query' \| 'weekly'` | `'query'` for interactive topic checks; `'weekly'` for official weekly briefs. |
| `query` | `string` | Search query (e.g., `"tabular differential privacy"`, or default synthetic data terms when empty). |
| `days` | `number` | Lookback window in days (`1–30`, default `7`). |
| `sourceFamilies` | `string[]` | Active source groups (`arxiv`, `hn`, `github`, `news`, `reddit`, `blogs`). |
| `rawItems` | `RawItem[]` | Collected items before deduplication. |
| `sourceStats` | `SourceStat[]` | Per-source item counts, duration (`ms`), and error messages. |
| `cleanItems` | `RawItem[]` | Normalized, cross-source deduplicated, and (in `'weekly'` mode) history-filtered items. |
| `cleanStats` | `{ raw: number; fresh: number; duplicatesRemoved: number; alreadyPublished: number }` | Deduplication telemetry. |
| `scoredItems` | `Scored[]` | Items scored `1–10` on `score` (relevance) and `well7_fit` + 1-line `reason`. |
| `fetchedTexts` | `Record<string, { text: string; origin: 'full text' \| 'snippet only' }>` | Extracted article/abstract text keyed by normalized URL for top candidates. |
| `sections` | `Section[]` | Guarded summaries grouped into `'top'`, `'tool'`, and `'worth'`. |
| `trend` | `string` | Synthesis paragraph across top picks. |
| `warnings` | `string[]` | Non-fatal source or LLM fallback warnings. |
| `reportId` | `string \| null` | Populated in `'weekly'` mode (`week-YYYY-MM-DD`). |

### Graph Nodes & Transitions

`START → collect → clean → rank → fetch → summarise → publish → END`

1. **`collect`**:
   - Parameterizes `collectAll(since, env, { query, sourceFamilies })` in `web/worker/pipeline/sources.ts`.
   - When a custom `query` is provided, arXiv, Hacker News Algolia, GitHub search, Google News RSS, and blog/Reddit filters match the custom query terms alongside synthetic-data context.
2. **`clean`**:
   - Normalizes URLs via `normalizeUrl()`, removes cross-source duplicates, and—when `mode === 'weekly'`—filters against previously published URLs in `items`.
   - Caps candidates passed to `rank` at `24` in `'query'` mode (for ~15s interactive latency) and `60` in `'weekly'` mode.
3. **`rank`**:
   - Scores batches in parallel via LangChain.js `ChatOpenAI` (`web/worker/pipeline/rank.ts`), returning both `score` (`1–10`) and `well7_fit` (`1–10`) plus `reason`.
   - Sorts items by `well7_fit` descending, then `score` descending.
4. **`fetch`**:
   - Selects the top candidates (`top`, `tool`, `worth` shortlist: up to 8 items in `'query'` mode, 16 in `'weekly'` mode) and fetches full page/abstract text in parallel (`fetchArticleText`).
5. **`summarise`**:
   - Runs citation-guarded summarization (`unsupportedNumbers` check + 1 repair attempt + extractive fallback) using the pre-fetched text from `fetch`, then generates the `trend` synthesis paragraph.
6. **`publish`**:
   - Always writes the final state to `research_sessions` in D1.
   - When `mode === 'weekly'`, checks `rankingHealth()` and upserts `reports`, `items`, and `pipeline_runs` so the live archive updates atomically.

## Data Schema (`web/migrations/0005_research_sessions.sql`)

```sql
CREATE TABLE IF NOT EXISTS research_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  mode         TEXT NOT NULL CHECK (mode IN ('query', 'weekly')),
  query        TEXT NOT NULL,
  days         INTEGER NOT NULL DEFAULT 7,
  status       TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  current_node TEXT NOT NULL,
  stats_json   TEXT NOT NULL DEFAULT '{}',
  result_json  TEXT NOT NULL DEFAULT '{}',
  error        TEXT,
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_research_sessions_created ON research_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_sessions_user ON research_sessions (user_id, created_at DESC);
```

## API Endpoints (`web/worker/index.ts`)

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `POST` | `/api/research/stream` | Clerk user (`mode: 'query'`) or Admin / `CRON_RUN_TOKEN` (`mode: 'weekly'`) | Runs the LangGraph `StateGraph` with `streamMode: 'updates'` and streams SSE events (`node:start`, `node:complete`, `done`, `error`) as `text/event-stream`. Updates `research_sessions` after each node. |
| `GET` | `/api/research/sessions` | Public (recent 15) / Clerk user | Lists recent `research_sessions` metadata (`id`, `mode`, `query`, `days`, `status`, `current_node`, `stats_json`, `created_at`, `finished_at`). |
| `GET` | `/api/research/sessions/:id` | Public | Returns the full `research_sessions` record including parsed `stats` and `result` (`sections`, `scoredItems`, `trend`, `sourceStats`, `warnings`). |
| `POST` | `/api/pipeline/run` | Admin / `CRON_RUN_TOKEN` | Calls the same LangGraph `StateGraph` in `mode: 'weekly'` and returns JSON on completion (preserving backward compatibility with the cron and CLI). |

## Pages & UI Redesign (`web/src/`)

### 1. Visual System (`web/src/index.css`)
- **Header & Live Command Surface**: Deep obsidian navy (`#0b1220`) with subtle radial dot-matrix texture, crisp white/slate typography, and indigo (`#4f46e5` / `#6366f1`) + emerald (`#10b981`) live telemetry indicators.
- **Reading Canvas**: Warm alabaster (`#f8fafc`) with elevated white cards (`#ffffff`), refined hairline borders (`#e2e8f0`), tabular mono numerals for scores/ranks, and clear visual hierarchy between Top Picks, Tools, and Worth a Look.
- **Unified Split Topic Pill (`components/filter-chip.tsx` & `components/follow-toggle.tsx`)**:
  - When a topic chip is followable, the filter button and star toggle are joined into a single unified capsule (`inline-flex items-center rounded-full border`) with a vertical divider:
    - Left segment filters the list (indigo active tint + count badge).
    - Right segment toggles the follow star (`★` warm gold fill + tooltip), eliminating the floating detached star icon and dark-navy confusion.

### 2. Live Research Studio (`/studio` + Command Bar on `/` and `/brief`)
- New route `/studio` (**Explore / Live Check** in main navigation, available to everyone to view sessions and to signed-in users to launch live queries; admins can also toggle `Weekly Brief Run`).
- **Interactive Controls**:
  - Topic query input + preset quick-chips (*Differential Privacy*, *Tabular Synthesis*, *Clinical & Healthcare*, *Time-Series*, *LLM Synthetic Data*, *Benchmarks & Eval*).
  - Lookback window selector (`24h`, `3d`, `7d`, `14d`) and source-family toggles.
- **Live LangGraph Node Stepper (`components/pipeline-stepper.tsx`)**:
  - Visual 6-node horizontal pipeline (`Collect` → `Clean` → `Rank` → `Fetch` → `Summarise` → `Publish`) showing active pulse, per-node item counts, elapsed ms, and source badges.
- **Progressive Result Stream**:
  - After `clean`: displays discovered items immediately with source + timestamp.
  - After `rank`: animates `Well7 Fit` and `Relevance` scores onto cards and sorts by rank.
  - After `summarise`: reveals the synthesis `The Editorial Read` card and replaces snippets with citation-guarded summaries.
- **Recent Sessions Drawer/List**: Click any previous live check to inspect its graph telemetry and results instantly from D1.

## Error Handling

- **Source timeouts / HTTP 429s**: Caught per source inside `collect`; recorded in `sourceStats` and `warnings` without aborting the graph.
- **Zero items found**: `clean` transitions cleanly to `END` with a clear message (`"No items matched '<query>' in the last N days"`) rather than throwing an unhandled 500.
- **LLM quota / batch failure**: `rank` falls back to score 1 with a warning; in `'weekly'` mode `rankingHealth()` prevents overwriting a published brief if all batches failed, while in `'query'` mode the user still sees the collected & cleaned items with a clear warning banner.
- **SSE disconnect**: Each node persists its state to `research_sessions`, so reloading `/studio?session=<id>` recovers the run.

## Testing & Verification

1. Unit tests (`npm test` via `node:test`):
   - `tests/claims.test.ts`, `tests/feed.test.ts`, `tests/token.test.ts`, `tests/topics.test.ts`.
   - New `tests/graph.test.ts`: verifies the LangGraph `StateGraph` node transitions, query parameterization, deduplication stats, and graceful empty-result / degraded-LLM handling using a mock model/collector.
2. Static checks: `npx tsc -b`, `npm run lint` (`oxlint`), `npm run build`.
3. D1 migration: apply `0005_research_sessions.sql` to `--local` and `--remote`, deploy with `npx wrangler deploy`, and verify the live site.
