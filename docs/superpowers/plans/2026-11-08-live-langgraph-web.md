# Live LangGraph.js Research Workflow & Editorial Lab UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the batch-only Worker pipeline with a live `@langchain/langgraph` `StateGraph` (`collect → clean → rank → fetch → summarise → publish`) streamed over SSE (`POST /api/research/stream`) with D1 session persistence, and redesign the SPA into a high-craft Editorial Research Lab with a live Research Studio (`/studio`) and unified split-action topic pills.

**Architecture:** A single `@langchain/langgraph` `StateGraph` in `web/worker/pipeline/graph.ts` orchestrates both interactive topic checks (`mode: 'query'`, cap 24 items) and weekly briefs (`mode: 'weekly'`, cap 60 items). Each node completion writes a checkpoint to D1 (`research_sessions`) and streams a typed SSE frame to the browser, where the `/studio` console and redesigned pages render progressive node telemetry, scores, and citation-guarded summaries.

**Tech Stack:** TypeScript 7, Cloudflare Workers + D1 + R2, `@langchain/langgraph` `^1.7.2`, `@langchain/core` `^1.3.4`, `@langchain/openai` `^1.8.0`, React 19, Vite 8, Tailwind CSS v4, Clerk (`@clerk/react` / `@clerk/backend`).

**Spec:** `docs/superpowers/specs/2026-11-08-live-langgraph-web-design.md`

## Global Constraints

- Runs natively in the existing Cloudflare Worker + D1 setup (`web/wrangler.jsonc`); no Durable Objects or paid Workflows bindings.
- Python CLI pipeline (`src/synthetic_data/`) is untouched.
- Node unit tests run via `npm test` (`node --experimental-strip-types --test tests/*.test.ts`); `npx tsc -b` and `npm run lint` (`oxlint`) must exit 0 with zero errors.
- Candidate caps after `clean`: `24` in `'query'` mode, `60` in `'weekly'` mode.
- Shortlist caps passed to `fetch` + `summarise`: up to `8` (`4` top, `2` tool, `2` worth) in `'query'` mode; up to `16` (`6` top, `5` tool, `5` worth) in `'weekly'` mode.
- In `'weekly'` mode, `rankingHealth()` guards D1 `reports`/`items` writes so a failed model run never overwrites a published brief.

## Review Focus

1. Empty or whitespace-only custom `query` in `mode: 'query'` falls back to the default synthetic-data search query rather than sending empty `q=` parameters to arXiv, HN, or GitHub.
2. Zero fresh items after `clean` (e.g. narrow query or 1-day window) completes the graph cleanly (`status: 'succeeded'`, `sections: []`, informative warning) without throwing an unhandled error or calling the LLM.
3. Invalid or out-of-range `days` parameter in `POST /api/research/stream` (e.g. `0`, `-5`, `999`, `"abc"`) is clamped to integer `1..30` (default `7`).
4. Unknown or misspelled `sourceFamilies` entries are ignored; an empty `sourceFamilies` array defaults to all 6 families (`['arxiv', 'hn', 'github', 'news', 'reddit', 'blogs']`).
5. Clicking the follow star inside a unified split topic pill triggers `onFollow` without triggering the parent/sibling `onToggle` filter action.

---

### Task 1: Parameterized Source Collection, Ranking Score Separation, and Pre-Fetched Summarisation

**Files:**
- Modify: `web/worker/pipeline/sources.ts`
- Modify: `web/worker/pipeline/rank.ts`
- Modify: `web/worker/pipeline/summarise.ts`
- Create: `web/tests/pipeline-units.test.ts`

**Interfaces:**
- Produces in `web/worker/pipeline/sources.ts`:
  - `export type SourceFamily = 'arxiv' | 'hn' | 'github' | 'news' | 'reddit' | 'blogs'`
  - `export const ALL_SOURCE_FAMILIES: readonly SourceFamily[]`
  - `export interface CollectOptions { query?: string; sourceFamilies?: SourceFamily[] }`
  - `export interface SourceStat { name: string; family: SourceFamily; count: number; durationMs: number; error: string | null }`
  - `export function sanitizeCollectOptions(input?: { query?: unknown; days?: unknown; sourceFamilies?: unknown }): { query: string; days: number; sourceFamilies: SourceFamily[] }`
  - `export async function collectAll(since: Date, env: { GITHUB_TOKEN?: string }, options?: CollectOptions): Promise<{ items: RawItem[]; sources: SourceResult[]; stats: SourceStat[] }>`
- Produces in `web/worker/pipeline/rank.ts`:
  - `export interface Scored extends RawItem { score: number; well7_fit: number; reason: string }`
  - `export async function rankItems(items: RawItem[], env: LlmEnv, query?: string): Promise<RankStats>`
- Produces in `web/worker/pipeline/summarise.ts`:
  - `export interface FetchedText { text: string; origin: 'full text' | 'snippet only' }`
  - `export function selectShortlist(ranked: Scored[], mode: 'query' | 'weekly'): Array<{ section: Section['section']; item: Scored; oneLine: boolean }>`
  - `export async function fetchShortlistTexts(items: RawItem[]): Promise<Record<string, FetchedText>>`
  - `export async function buildSections(ranked: Scored[], env: LlmEnv, options?: { mode?: 'query' | 'weekly'; fetchedTexts?: Record<string, FetchedText> }): Promise<SummariseStats>`

- [ ] **Step 1: Write the failing unit tests in `web/tests/pipeline-units.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeCollectOptions, ALL_SOURCE_FAMILIES } from '../worker/pipeline/sources.ts'
import { selectShortlist } from '../worker/pipeline/summarise.ts'
import type { Scored } from '../worker/pipeline/rank.ts'

test('sanitizeCollectOptions: clamps days to 1..30 and defaults empty query and sourceFamilies', () => {
  assert.deepEqual(sanitizeCollectOptions({}), {
    query: '',
    days: 7,
    sourceFamilies: [...ALL_SOURCE_FAMILIES],
  })
  assert.equal(sanitizeCollectOptions({ days: 0 }).days, 1)
  assert.equal(sanitizeCollectOptions({ days: 99 }).days, 30)
  assert.equal(sanitizeCollectOptions({ days: 'invalid' }).days, 7)
  assert.equal(sanitizeCollectOptions({ query: '  healthcare privacy  ' }).query, 'healthcare privacy')
  assert.deepEqual(
    sanitizeCollectOptions({ sourceFamilies: ['arxiv', 'bogus', 'github'] }).sourceFamilies,
    ['arxiv', 'github'],
  )
  assert.deepEqual(
    sanitizeCollectOptions({ sourceFamilies: ['bogus'] }).sourceFamilies,
    [...ALL_SOURCE_FAMILIES],
  )
})

test('selectShortlist: caps query mode at 8 (4 top, 2 tool, 2 worth) and weekly mode at 16', () => {
  const items: Scored[] = Array.from({ length: 20 }, (_, i) => ({
    title: `Item ${i}`,
    url: `https://example.com/${i}`,
    source: i % 3 === 0 ? 'GitHub' : 'arXiv',
    published: '2026-11-08T00:00:00.000Z',
    snippet: 'Synthetic data snippet.',
    score: 8,
    well7_fit: 10 - (i % 5),
    reason: 'Good fit',
  }))
  const queryPlan = selectShortlist(items, 'query')
  assert.equal(queryPlan.filter((p) => p.section === 'top').length, 4)
  assert.equal(queryPlan.filter((p) => p.section === 'tool').length, 2)
  assert.equal(queryPlan.filter((p) => p.section === 'worth').length, 2)

  const weeklyPlan = selectShortlist(items, 'weekly')
  assert.equal(weeklyPlan.filter((p) => p.section === 'top').length, 6)
  assert.equal(weeklyPlan.length <= 16, true)
})
```

- [ ] **Step 2: Run `npm test` to verify the new test fails**

Run: `cd web; npm test`
Expected: FAIL with missing exports `sanitizeCollectOptions`, `ALL_SOURCE_FAMILIES`, `selectShortlist`.

- [ ] **Step 3: Implement parameterized collection in `web/worker/pipeline/sources.ts`, dual `score`/`well7_fit` in `web/worker/pipeline/rank.ts`, and split `selectShortlist`/`fetchShortlistTexts`/`buildSections` in `web/worker/pipeline/summarise.ts`**

In `sources.ts`:
- Add `SourceFamily`, `ALL_SOURCE_FAMILIES = ['arxiv', 'hn', 'github', 'news', 'reddit', 'blogs'] as const`, `CollectOptions`, `SourceStat`, and `sanitizeCollectOptions`.
- When `options?.query` is non-empty, build search queries combining `"synthetic data"` and `options.query` for `arxiv`, `hackerNews`, `github`, and Google News RSS, and require blog/Reddit entries to match both `KEYWORDS` and at least one token from `options.query`.
- Only run collectors whose `family` is in `options.sourceFamilies`, timing each collector (`durationMs`) into `stats: SourceStat[]`.

In `rank.ts`:
- Add `score: number` to `Scored` (parsed from LLM JSON `score` 1–10, defaulting to `well7_fit` if omitted by model, fallback `1`).
- If `query` is provided to `rankItems(items, env, query)`, append `Focus topic: "${query}". Boost items directly addressing this topic.` to the system prompt.

In `summarise.ts`:
- Extract `selectShortlist(ranked, mode)` (`'query'` → 4 top, 2 tool, 2 worth; `'weekly'` → 6 top, 5 tool, 5 worth).
- Add `fetchShortlistTexts(items)` which fetches `fetchArticleText(item.url)` in parallel and returns `Record<string, FetchedText>` keyed by `normalizeUrl(item.url)`.
- Update `summarise(item, env, oneLine, preFetched?: FetchedText)` and `buildSections(ranked, env, options)` to reuse `options?.fetchedTexts` when present instead of re-fetching.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd web; npm test; npx tsc -b`
Expected: PASS all tests, `tsc -b` exits 0.

- [ ] **Step 5: Commit**

```powershell
git add web/worker/pipeline/sources.ts web/worker/pipeline/rank.ts web/worker/pipeline/summarise.ts web/tests/pipeline-units.test.ts
git commit -m "feat(pipeline): parameterize collectors, split fetch/summarise, and track score + well7_fit"
```

---

### Task 2: LangGraph.js `StateGraph` (`collect → clean → rank → fetch → summarise → publish`)

**Files:**
- Modify: `web/package.json`
- Create: `web/migrations/0005_research_sessions.sql`
- Create: `web/worker/pipeline/graph.ts`
- Modify: `web/worker/pipeline/index.ts`
- Create: `web/tests/graph.test.ts`

**Interfaces:**
- Consumes: `collectAll`, `sanitizeCollectOptions`, `normalizeUrl`, `rankItems`, `selectShortlist`, `fetchShortlistTexts`, `buildSections`, `trend`, `rankingHealth`.
- Produces in `web/worker/pipeline/graph.ts`:
  - `export type ResearchNodeName = 'collect' | 'clean' | 'rank' | 'fetch' | 'summarise' | 'publish'`
  - `export interface ResearchGraphInput { sessionId?: string; userId?: string | null; mode: 'query' | 'weekly'; query?: string; days?: number; sourceFamilies?: SourceFamily[]; trigger?: 'cron' | 'manual' }`
  - `export interface NodeProgressEvent { sessionId: string; node: ResearchNodeName; status: 'completed'; timestamp: string; summary: Record<string, unknown>; stateSnapshot: Partial<ResearchGraphState> }`
  - `export function buildResearchGraph(env: PipelineEnv, deps?: Partial<GraphDeps>, onNodeEvent?: (event: NodeProgressEvent) => Promise<void> | void)`
  - `export async function executeResearchGraph(env: PipelineEnv, input: ResearchGraphInput, onNodeEvent?: (event: NodeProgressEvent) => Promise<void> | void, deps?: Partial<GraphDeps>): Promise<ResearchGraphState>`

- [ ] **Step 1: Install `@langchain/langgraph` and create D1 migration `web/migrations/0005_research_sessions.sql`**

Run: `cd web; npm install @langchain/langgraph@^1.7.2`
Create `web/migrations/0005_research_sessions.sql` with the exact SQL from the spec (`research_sessions` table + two indexes).

- [ ] **Step 2: Write the failing LangGraph tests in `web/tests/graph.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { executeResearchGraph, type NodeProgressEvent } from '../worker/pipeline/graph.ts'

test('executeResearchGraph: runs collect -> clean -> rank -> fetch -> summarise -> publish in order and emits events', async () => {
  const events: NodeProgressEvent[] = []
  const state = await executeResearchGraph(
    { OPENROUTER_API_KEY: 'test', OPENROUTER_MODEL: 'test-model', DB: null as never },
    { mode: 'query', query: 'differential privacy', days: 7 },
    (ev) => { events.push(ev) },
    {
      collectAll: async () => ({
        items: [
          {
            title: 'DP Tabular Diffusion 2026',
            url: 'https://arxiv.org/abs/2611.00001v1',
            source: 'arXiv',
            published: new Date().toISOString(),
            snippet: 'Achieves 94.2% utility under epsilon 1.0 differential privacy.',
          },
          {
            title: 'Duplicate DP Tabular Diffusion',
            url: 'https://arxiv.org/abs/2611.00001v2?utm_source=rss',
            source: 'Hugging Face',
            published: new Date().toISOString(),
            snippet: 'Duplicate URL with version suffix.',
          },
        ],
        sources: [],
        stats: [{ name: 'arXiv', family: 'arxiv', count: 2, durationMs: 12, error: null }],
      }),
      rankItems: async (items) => ({
        scored: items.map((item) => ({ ...item, score: 9, well7_fit: 9, reason: 'Strong DP tabular result' })),
        failedBatches: 0,
        totalBatches: 1,
      }),
      fetchShortlistTexts: async () => ({
        'https://arxiv.org/abs/2611.00001': {
          text: 'Achieves 94.2% utility under epsilon 1.0 differential privacy across 5 clinical datasets.',
          origin: 'full text',
        },
      }),
      buildSections: async (scored) => ({
        sections: scored.map((item) => ({
          section: 'top',
          item,
          summary: {
            summary: 'Achieves 94.2% utility under epsilon 1.0 differential privacy across 5 clinical datasets.',
            origin: 'full text',
            guard: 'passed',
          },
        })),
        fallbacks: 0,
      }),
      trend: async () => 'Differential privacy utility reaches 94.2% on clinical benchmarks.',
    },
  )

  assert.deepEqual(
    events.map((e) => e.node),
    ['collect', 'clean', 'rank', 'fetch', 'summarise', 'publish'],
  )
  assert.equal(state.cleanStats.raw, 2)
  assert.equal(state.cleanStats.fresh, 1)
  assert.equal(state.cleanStats.duplicatesRemoved, 1)
  assert.equal(state.sections.length, 1)
  assert.equal(state.trend, 'Differential privacy utility reaches 94.2% on clinical benchmarks.')
})

test('executeResearchGraph: short-circuits cleanly when clean produces zero fresh items', async () => {
  const events: NodeProgressEvent[] = []
  let rankCalled = false
  const state = await executeResearchGraph(
    { OPENROUTER_API_KEY: 'test', OPENROUTER_MODEL: 'test-model', DB: null as never },
    { mode: 'query', query: 'nonexistent-topic-xyz', days: 1 },
    (ev) => { events.push(ev) },
    {
      collectAll: async () => ({ items: [], sources: [], stats: [] }),
      rankItems: async () => {
        rankCalled = true
        return { scored: [], failedBatches: 0, totalBatches: 0 }
      },
    },
  )

  assert.equal(rankCalled, false)
  assert.deepEqual(events.map((e) => e.node), ['collect', 'clean', 'publish'])
  assert.equal(state.cleanStats.fresh, 0)
  assert.equal(state.warnings.length > 0, true)
})
```

- [ ] **Step 3: Run `npm test` to verify `tests/graph.test.ts` fails**

Run: `cd web; npm test`
Expected: FAIL (`Cannot find module '../worker/pipeline/graph.ts'`).

- [ ] **Step 4: Implement `web/worker/pipeline/graph.ts` using `@langchain/langgraph` `StateGraph` and `Annotation.Root`, and wire `runWeeklyPipeline` in `web/worker/pipeline/index.ts` to call `executeResearchGraph`**

- In `web/worker/pipeline/graph.ts`:
  - Define `ResearchAnnotation = Annotation.Root({ ... })` with all fields from the spec.
  - Build `StateGraph(ResearchAnnotation)` with nodes `collect`, `clean`, `rank`, `fetch`, `summarise`, `publish`.
  - Add conditional edge after `clean`: if `state.cleanItems.length === 0`, route directly to `'publish'`; otherwise route to `'rank' → 'fetch' → 'summarise' → 'publish'`.
  - When `env.DB` is present, insert/update the `research_sessions` row at start, after each node, and in `publish` (plus write `reports` and `items` in `'weekly'` mode when `rankingHealth` passes).
  - Stream via `await graph.stream(initialState, { streamMode: 'updates' })`, invoking `onNodeEvent` after each node update.
- In `web/worker/pipeline/index.ts`:
  - Delegate `produceReport(env)` / `runWeeklyPipeline(env, trigger, scheduledFor)` to `executeResearchGraph(env, { mode: 'weekly', trigger })` and re-export the graph helpers.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd web; npm test; npx tsc -b`
Expected: PASS all tests including `graph.test.ts`; `tsc -b` exits 0.

- [ ] **Step 6: Commit**

```powershell
git add web/package.json web/package-lock.json web/migrations/0005_research_sessions.sql web/worker/pipeline/graph.ts web/worker/pipeline/index.ts web/tests/graph.test.ts
git commit -m "feat(pipeline): implement LangGraph.js StateGraph with D1 session checkpoints"
```

---

### Task 3: Streaming SSE Endpoint (`/api/research/stream`) and Session History Routes

**Files:**
- Modify: `web/worker/index.ts`
- Modify: `web/src/lib/api.ts`

**Interfaces:**
- Consumes: `executeResearchGraph`, `NodeProgressEvent`, `ResearchNodeName`, `SourceFamily`, `SourceStat`.
- Produces in `web/worker/index.ts`:
  - `POST /api/research/stream` → `text/event-stream` emitting `event: node\ndata: <NodeProgressEvent JSON>\n\n` and final `event: done\ndata: <ResearchSessionDetail JSON>\n\n` (or `event: error`).
  - `GET /api/research/sessions` → `{ sessions: ResearchSessionSummary[] }`
  - `GET /api/research/sessions/:id` → `{ session: ResearchSessionDetail }`
- Produces in `web/src/lib/api.ts`:
  - `export interface ResearchSessionSummary { id: string; mode: 'query' | 'weekly'; query: string; days: number; status: 'running' | 'succeeded' | 'failed'; current_node: string; stats: Record<string, any>; created_at: string; finished_at: string | null; error: string | null }`
  - `export interface ResearchSessionDetail extends ResearchSessionSummary { result: { sections?: any[]; scoredItems?: any[]; cleanItems?: any[]; trend?: string; sourceStats?: any[]; warnings?: string[]; reportId?: string | null } }`
  - `export async function fetchResearchSessions(): Promise<ResearchSessionSummary[]>`
  - `export async function fetchResearchSession(id: string): Promise<ResearchSessionDetail | null>`
  - `export async function streamResearchRun(params: { mode?: 'query' | 'weekly'; query: string; days: number; sourceFamilies?: string[] }, handlers: { onNode: (event: any) => void; onDone: (session: ResearchSessionDetail) => void; onError: (message: string) => void }, signal?: AbortSignal): Promise<void>`

- [ ] **Step 1: Add `/api/research/stream`, `/api/research/sessions`, and `/api/research/sessions/:id` to `web/worker/index.ts` and client helpers to `web/src/lib/api.ts`**

- In `web/worker/index.ts`:
  - `GET /api/research/sessions`: query latest 15 rows from `research_sessions`, parsing `stats_json`.
  - `GET /api/research/sessions/:id`: query single row by `id`, parsing both `stats_json` and `result_json`.
  - `POST /api/research/stream`:
    - Parse body `{ mode, query, days, sourceFamilies }`.
    - For `mode === 'weekly'`, require `await pipelineAuth(request, env)`; for `mode === 'query'` (default), require either signed-in Clerk viewer (`await currentViewer(request, env)`) or `pipelineAuth`. Return 401/403 JSON if unauthorized.
    - Create a `TransformStream`, run `executeResearchGraph` inside an async IIFE writing `event: node\ndata: ${JSON.stringify(ev)}\n\n` on each node and `event: done\ndata: ${JSON.stringify(detail)}\n\n` on completion, and return `new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })`.
- In `web/src/lib/api.ts`:
  - Implement `fetchResearchSessions`, `fetchResearchSession`, and `streamResearchRun` (reading the `ReadableStream` line-by-line to dispatch `onNode`, `onDone`, and `onError`).

- [ ] **Step 2: Apply migration locally and verify build & tests**

Run: `cd web; npx wrangler d1 migrations apply synthetic-data-db --local; npm test; npx tsc -b`
Expected: Migration `0005_research_sessions.sql` applied locally, all tests pass, `tsc -b` exits 0.

- [ ] **Step 3: Commit**

```powershell
git add web/worker/index.ts web/src/lib/api.ts
git commit -m "feat(api): add SSE /api/research/stream and session history endpoints"
```

---

### Task 4: Unified Split Topic Pill, Editorial Lab Theme, and Redesigned Header/Cards

**Files:**
- Modify: `web/src/index.css`
- Modify: `web/src/components/filter-chip.tsx`
- Modify: `web/src/components/follow-toggle.tsx`
- Modify: `web/src/components/feed-panel.tsx`
- Modify: `web/src/components/report-item.tsx`
- Modify: `web/src/components/news-list.tsx`
- Create: `web/tests/ui-logic.test.ts`

**Interfaces:**
- Produces in `web/src/components/filter-chip.tsx`:
  - `export interface FilterChipProps { label: string; count?: number; active: boolean; onToggle: () => void; followed?: boolean; onFollowToggle?: (next: boolean) => void }`
  - When `onFollowToggle` is passed, renders a single unified capsule (`inline-flex items-center rounded-full border`) where the left `<button>` toggles the filter (`active` state with indigo accent + `×` indicator when active) and the right `<button>` toggles the star (`★` amber/gold fill when `followed`), separated by a subtle hairline divider.

- [ ] **Step 1: Write unit test in `web/tests/ui-logic.test.ts` for topic pill state helper**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { describeChipState } from '../src/components/filter-chip.tsx'

test('describeChipState: distinguishes active filter from followed topic state', () => {
  assert.deepEqual(describeChipState({ active: true, followed: false }), {
    filterAriaPressed: true,
    followAriaPressed: false,
    tone: 'active',
  })
  assert.deepEqual(describeChipState({ active: false, followed: true }), {
    filterAriaPressed: false,
    followAriaPressed: true,
    tone: 'followed',
  })
  assert.deepEqual(describeChipState({ active: true, followed: true }), {
    filterAriaPressed: true,
    followAriaPressed: true,
    tone: 'both',
  })
})
```

- [ ] **Step 2: Run `npm test` to verify it fails**

Run: `cd web; npm test`
Expected: FAIL (`describeChipState` not exported).

- [ ] **Step 3: Implement the unified split `FilterChip`, updated `FollowToggle`, Editorial Lab CSS tokens (`web/src/index.css`), and elevated `ReportItemRow` card styling**

- In `web/src/components/filter-chip.tsx`:
  - Export `describeChipState({ active, followed })`.
  - Render a unified split pill when `onFollowToggle` is provided so the filter action and follow star live inside one cohesive capsule with distinct hover/active states and independent `<button>` elements.
- In `web/src/components/feed-panel.tsx` and `web/src/components/news-list.tsx`:
  - Pass `followed` and `onFollowToggle` directly into `<FilterChip>` instead of rendering a detached `<FollowToggle>` next to it.
- In `web/src/components/report-item.tsx`:
  - Upgrade item rows into crisp elevated cards with rank index badge, dual score pill (`Well7 Fit` + `Relevance`), source badge with integrated follow star, and clear typography hierarchy.
- In `web/src/index.css`:
  - Refine the color tokens (`#f8fafc` warm alabaster canvas, `#0f172a` deep ink, `#4f46e5` primary indigo, `#0d9488` teal accent, `#e2e8f0` crisp borders) and add `.obsidian-surface` utility for the dark command header/hero.

- [ ] **Step 4: Run tests, lint, and typecheck**

Run: `cd web; npm test; npm run lint; npx tsc -b`
Expected: PASS all tests, 0 lint errors, `tsc -b` exits 0.

- [ ] **Step 5: Commit**

```powershell
git add web/src/index.css web/src/components/filter-chip.tsx web/src/components/follow-toggle.tsx web/src/components/feed-panel.tsx web/src/components/report-item.tsx web/src/components/news-list.tsx web/tests/ui-logic.test.ts
git commit -m "feat(ui): add unified split topic pills, elevated item cards, and Editorial Lab theme"
```

---

### Task 5: Live Research Studio (`/studio`), Pipeline Stepper, and Updated Navigation

**Files:**
- Create: `web/src/components/pipeline-stepper.tsx`
- Create: `web/src/pages/StudioPage.tsx`
- Modify: `web/src/pages/LandingPage.tsx`
- Modify: `web/src/pages/BriefPage.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `streamResearchRun`, `fetchResearchSessions`, `fetchResearchSession`, `FilterChip`, `ReportItemRow`, `PaperActions`.
- Produces:
  - `web/src/components/pipeline-stepper.tsx`: `export function PipelineStepper({ activeNode, completedNodes, stats, status, durationMs }: PipelineStepperProps)` — visual 6-node LangGraph stepper (`collect → clean → rank → fetch → summarise → publish`) with live counters, source health badges, and pulse indicator.
  - `web/src/pages/StudioPage.tsx`: `export function StudioPage({ signedIn, isAdmin, onSignIn, library, follows, onFollow }: StudioPageProps)` — interactive research workspace with query bar, preset topic chips, lookback window selector (`1d`, `3d`, `7d`, `14d`), source-family toggles, live `PipelineStepper`, progressive results stream (raw items after `clean`, scored cards after `rank`, synthesis + guarded summaries after `summarise`), and recent sessions sidebar.
  - Updated `web/src/App.tsx` routing `/studio` and featuring the obsidian command header with **Live Check (`/studio`)** in navigation.

- [ ] **Step 1: Create `web/src/components/pipeline-stepper.tsx` and `web/src/pages/StudioPage.tsx`**

- `PipelineStepper` displays the 6 LangGraph nodes (`Collect`, `Clean & Dedupe`, `Rank (LLM)`, `Fetch Full Text`, `Summarise & Guard`, `Save Checkpoint`) with live status (`idle` | `running` | `completed` | `skipped` | `failed`), per-node metrics (e.g., `42 raw`, `24 fresh`, `24 scored`, `8 full-text`, `8 guarded`), and per-source pills (`arXiv`, `HN`, `GitHub`, `News`, `Reddit`, `Blogs`).
- `StudioPage` lets users type a query or click presets (*Differential Privacy*, *Tabular Clinical*, *Time-Series*, *LLM Synthetic Data*, *Evaluation & Benchmarks*, *Federated Synthesis*), choose lookback days (`1`, `3`, `7`, `14`) and source families, and run `streamResearchRun`. If not signed in, clicking **Run Live Check** prompts Clerk sign-in while still allowing anyone to browse and inspect saved sessions from the sidebar. Admins also have a toggle to run the full **Weekly Brief (`mode: 'weekly'`)** with live streaming.

- [ ] **Step 2: Wire `/studio` into `web/src/App.tsx`, `web/src/pages/LandingPage.tsx`, and `web/src/pages/BriefPage.tsx`**

- In `web/src/App.tsx`:
  - Add `{ to: '/studio', label: 'Live Check' }` to `navLinks` (both signed-in and signed-out) and `[/^\/studio/, 'Live Research Studio']` to `ROUTE_TITLES`.
  - Upgrade the header to the obsidian command bar aesthetic with a quick **"Check topic live"** CTA button.
- In `web/src/pages/LandingPage.tsx` and `web/src/pages/BriefPage.tsx`:
  - Add a quick-launch research bar / CTA linking into `/studio` so visitors can immediately check a topic or inspect the latest brief.

- [ ] **Step 3: Run tests, lint, and full production build**

Run: `cd web; npm test; npm run lint; npm run build`
Expected: All tests pass, 0 lint errors, client and worker bundles build cleanly.

- [ ] **Step 4: Apply remote D1 migration and deploy to Cloudflare**

Run: `cd web; npx wrangler d1 migrations apply synthetic-data-db --remote; npx wrangler deploy`
Expected: Migration `0005_research_sessions.sql` applied to remote D1 and Worker deployed to `https://synthetic-data-web.coolbadrtv1.workers.dev`.

- [ ] **Step 5: Commit**

```powershell
git add web/src/components/pipeline-stepper.tsx web/src/pages/StudioPage.tsx web/src/pages/LandingPage.tsx web/src/pages/BriefPage.tsx web/src/App.tsx
git commit -m "feat(web): add Live Research Studio (/studio), LangGraph stepper, and redesigned header"
```
