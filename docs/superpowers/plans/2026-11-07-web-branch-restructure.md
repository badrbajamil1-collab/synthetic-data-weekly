# Web branch restructure — pages, personal topics, notes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the never-built half of the 2026-11-06 pages-and-feed spec on the `web` branch: real routes, per-user followed topics/sources, Upcoming notes, library tabs, week-shape diagrams — with the existing Clerk auth, D1 and in-Worker cron untouched.

**Architecture:** A tiny zero-dependency history router (`lib/router.tsx`) splits the current 606-line single-page `App.tsx` into six page components behind a shared app shell that owns identity and library state. The Worker gains four endpoints on the existing fail-closed Clerk block (`/api/my/topics`, `/api/my/notes[/:id]`, `/api/me.topics`), backed by migration `0004`. Pure topic matching moves into `lib/topics.ts` so feed matching and the SVG week-shape diagrams share one rule.

**Tech stack:** Vite 8 + React 19 + TS, Tailwind 4, Clerk (unchanged), Cloudflare Workers + D1 (new migration only). No new npm dependencies (spec: "lib/router.tsx — tiny history router. No new dependency.").

**Spec:** `docs/superpowers/specs/2026-11-06-pages-and-feed-design.md` (routes, data SQL, API table, matching rule, library tabs, diagrams, error handling).

## Global Constraints

- No new npm dependency for routing (spec: tiny history router).
- No changes to the Python pipeline, the report format, or Clerk auth (spec non-goals).
- Branch: all work on `web`; `main` stays Python-only until `web` is verified.
- Migration SQL is exactly the spec's `0004_user_topics_notes.sql` (tables `user_topics`, `user_notes`, index `idx_user_notes_user`).
- API response shapes exactly per spec table: `{ topics: [{ kind, value }] }`, `{ notes: [{ id, body, created_at }] }`, POST note returns `{ note }`.
- `kind` constrained to `'topic' | 'source'` in D1 (CHECK) and re-validated in the Worker (400 otherwise).
- Navigation labels per spec: signed out → logo `/`, links Brief, Archive, buttons Sign in/Sign up; signed in → logo `/library`, links Feed, Brief, Library, Archive, avatar.
- Diagrams are static SVG computed from the week's items — no chart library, no tooltips, no animation.
- Motion: route change = 200–300 ms fade-and-rise on the incoming page, disabled under prefers-reduced-motion.
- Local D1 persistence gotcha: every wrangler command in `web/` must pass `--persist-to ".wrangler/state"`.

## Review Focus

1. Signed-out deep link to `/feed` or `/library` → sign-in prompt card, never a blank page or crash. (Pinned in Task 8 build step: render pages signed-out locally.)
2. Deep link to a `/brief/<week>` id that does not exist → "This brief does not exist" with a link to the archive. (Pinned: BriefPage not-found branch.)
3. Feed with zero follows → shows the whole current brief plus a pick-topics prompt, never an empty page. (Pinned: FeedPage prompt branch.)
4. Worker receives `kind` outside `topic|source` → 400, no insert. (Pinned in Task 2 curl check.)
5. `DELETE /api/my/notes/<id>` for another user's id → 404, row untouched. (Pinned: WHERE includes `user_id = ?`.)
6. Empty week (0 items) → donut/bars render an empty state instead of dividing by zero. (Pinned: WeekShape early return.)
7. Route change resets scroll to top (history.pushState does not). (Pinned: scroll effect in App shell.)

---

### Task 1: Migration `0004_user_topics_notes.sql` + apply locally

**Files:**
- Create: `web/migrations/0004_user_topics_notes.sql`

**Interfaces:**
- Produces: tables `user_topics(user_id, kind KEY in topic|source, value, created_at, PK(user_id,kind,value))`, `user_notes(id TEXT PK, user_id, body, created_at, idx_user_notes_user(user_id))` — consumed by Task 2's endpoints.

- [ ] **Step 1: Write the migration** — exactly the spec's SQL:

```sql
CREATE TABLE user_topics (
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('topic', 'source')),
  value      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, value)
);

CREATE TABLE user_notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_user_notes_user ON user_notes (user_id);
```

- [ ] **Step 2: Apply locally**

Run (from `web/`): `npx wrangler d1 migrations apply synthetic-data-db --local --persist-to ".wrangler/state"`
Expected: `0004_user_topics_notes` applied; lists 4 migrations total.

### Task 2: Worker endpoints — topics, notes, `/api/me` topics

**Files:**
- Modify: `web/worker/index.ts` (inside the existing fail-closed `/api/me`/`/api/my/` Clerk block)

**Interfaces:**
- Consumes: `users` row upsert (existing `upsertUser`), Task 1 tables.
- Produces (spec shapes, all require viewer, 401 without):
  - `GET /api/my/topics` → `{ topics: [{ kind, value }] }` (ORDER BY kind, value)
  - `PUT /api/my/topics` body `{ kind, value }` → `{ topics }` (INSERT OR IGNORE)
  - `DELETE /api/my/topics` body `{ kind, value }` → `{ topics }`
  - `GET /api/my/notes` → `{ notes: [{ id, body, created_at }] }` (ORDER BY created_at DESC)
  - `POST /api/my/notes` body `{ body }` → `{ note: { id, body, created_at } }`, id = `crypto.randomUUID()`, body trimmed, ≤2000 chars
  - `DELETE /api/my/notes/:id` → `{ notes }` (404 unless `id = ? AND user_id = ?`)
  - `GET /api/me` gains `topics`

- [ ] **Step 1: Implement** the six handlers; validate `kind` ∈ {`topic`,`source`} and non-empty `value` (400 otherwise) before any SQL; parse bodies with the existing `request.json().catch(() => null)` pattern.
- [ ] **Step 2: Verify locally** — with `npm run dev` running:
  - unauthenticated `GET /api/my/topics` → 401
  - authenticated PUT with `kind: "publisher"` → 400
  - then PUT/GET/DELETE a real follow and a note → shapes match the spec table (06:00 smoke pass at end of Task 9 if no dev server now).

### Task 3: `lib/topics.ts` — pure follow matching + week-shape grouping

**Files:**
- Create: `web/src/lib/topics.ts`

**Interfaces:**
- Consumes: `topicsFor` from `@/lib/feed`.
- Produces (used by Tasks 4, 6, 7, 8):

```ts
export type TopicKind = 'topic' | 'source'
export interface TopicFollow { kind: TopicKind; value: string }
export function sortFollows(follows: TopicFollow[]): TopicFollow[]
export function matchesFollows(item: Pick<ReportItem, 'source'> & Taggable, follows: TopicFollow[]): boolean
// an item is in my feed iff any topicsFor(item) label is followed as a topic, or item.source is followed as a source (spec matching rule)
export interface ScoreBand { label: '8–10' | '5–7' | '1–4'; count: number }
export function scoreBands(scores: Array<number | null>): ScoreBand[]
export function sourceCounts(items: ReportItem[]): Array<{ label: string; count: number }>
export function topicCounts(items: Taggable[]): Array<{ label: string; count: number }>
```

- [ ] **Step 1: Implement.** No react imports; pure functions; `scoreBands` buckets scores into the spec bands (8–10, 5–7, 1–4); a null `well7_fit` uses the generic `score` for banding, and an item with both null still lands in one band so the donut always shows the three spec labels.
- [ ] **Step 2: Verify** via `npm run build` after Task 6 consumes it.

### Task 4: `lib/router.tsx` — tiny history router (no deps)

**Files:**
- Create: `web/src/lib/router.tsx`

**Interfaces:**
- Produces (used by Task 5, 9 — whole App):

```tsx
export function useRoute(): string                                   // window.location.pathname, reactively updated on popstate + navigate()
export function navigate(to: string, opts?: { replace?: boolean }): void  // history.{pushState,replaceState}(null, '', to) + notify; no-op if same path
export function Link(props: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }): JSX.Element
// Link intercepts only plain left-clicks without modifier keys; lets modified/new-tab clicks through; keeps onClick composition
```

- [ ] **Step 1: Implement** with a module-level listener `Set` + `useSyncExternalStore` (or `useState` + subscribe in effect).
- [ ] **Step 2: Verify** — `npm run build` after Task 5 wires pages.

### Task 5: `lib/api.ts` types + endpoint functions; shared report hooks

**Files:**
- Modify: `web/src/lib/api.ts`
- Create: `web/src/lib/use-report.ts`

**Interfaces:**
- Consumes: Task 2 endpoints; existing `getJson`, `authHeaders` instances.
- Produces:

```ts
export interface Me { user_id: string; email: string; isAdmin: boolean; topics?: TopicFollow[] }
export interface UserNote { id: string; body: string; created_at: string }
export async function putTopic(follow: TopicFollow): Promise<TopicFollow[]>    // PUT, throws on !ok (Error with text)
export async function deleteTopic(follow: TopicFollow): Promise<TopicFollow[]>
export async function fetchMyNotes(): Promise<UserNote[]>                      // null/401 → []
export async function addMyNote(body: string): Promise<UserNote>
export async function deleteMyNote(id: string): Promise<UserNote[]>
// use-report.ts — logic extracted verbatim from the current App.tsx loadArchive/loadReport effects:
export function useReports(): { reports: Report[]; loading: boolean; error: string | null; retry: () => void }
export function useReport(id: string | null): { report: Report | null; items: ReportItem[]; loading: boolean; error: string | null; retry: () => void }
```

- [ ] **Step 1: Add types + functions to `api.ts`** (each endpoint function follows the existing `saveState` fetch pattern).
- [ ] **Step 2: Create `lib/use-report.ts`** moving the two fetch effects out of `App.tsx` unchanged in behavior (AbortController + retry counter).
- [ ] **Step 3: `npm run build`** — passes with App still compiling (old effects still in place until Task 9).

### Task 6: `components/week-shape.tsx` — three static SVG diagrams

**Files:**
- Create: `web/src/components/week-shape.tsx`

**Interfaces:**
- Consumes: Task 3 `scoreBands`, `sourceCounts`, `topicCounts`.
- Produces: `WeekShape({ items }: { items: ReportItem[] })` — a 3-part row: importance donut (score bands 8–10 / 5–7 / 1–4), Sources horizontal bars, Topics horizontal bars; Tailwind classes only (`fill-primary`, `fill-secondary`, `fill-muted-foreground`), 0 items → "Nothing published this week yet." empty state (Review Focus 6).
- [ ] **Step 1: Implement** pure-SVG (`viewBox`, no library, `aria-hidden` on decorative parts + a visually-hidden summary line).
- [ ] **Step 2: `npm run build`.**

### Task 7: `components/follow-toggle.tsx` + `components/topic-panel.tsx`

**Files:**
- Create: `web/src/components/follow-toggle.tsx`
- Create: `web/src/components/topic-panel.tsx`

**Interfaces:**
- Consumes: Task 5 `putTopic`/`deleteTopic`; Task 3 types.
- Produces:
  - `FollowToggle({ kind, value, followed, onToggle }: { kind: TopicKind; value: string; followed: boolean; onToggle: (kind: TopicKind, value: string, next: boolean) => void | Promise<void> })` — small star button, filled when following (spec outline/filled), `aria-pressed`.
  - `TopicPanel({ follows, counts, onToggle }: { follows: TopicFollow[]; counts: Array<{ kind: TopicKind; label: string; count: number }>; ... })` — Feed page's **My topics** manager: every topic and source seen in the archive with counts and a toggle each.
- [ ] **Step 1: Implement** both. `followed = follows.some(...)`.
- [ ] **Step 2: `npm run build`.**

### Task 8: `components/notes-panel.tsx` — Upcoming notes

**Files:**
- Create: `web/src/components/notes-panel.tsx`

**Interfaces:**
- Consumes: Task 5 `fetchMyNotes`, `addMyNote`, `deleteMyNote`.
- Produces: `NotesPanel()` — self-fetching list + add form (textarea, Enter/Ctrl-Enter or button) + delete button per note; loading/error/retry states follow the existing page-level error pattern (retry button).
- [ ] **Step 1: Implement.**
- [ ] **Step 2: `npm run build`.**

### Task 9: Pages + router shell (`App.tsx` split)

**Files:**
- Create: `web/src/pages/LandingPage.tsx`, `BriefPage.tsx`, `FeedPage.tsx`, `LibraryPage.tsx`, `ArchivePage.tsx`, `NotFoundPage.tsx`
- Modify: `web/src/App.tsx` (shell), `web/src/components/library.tsx` (Notes + Upcoming tabs), `web/src/components/feed-panel.tsx` (star chips — FollowToggle on KeywordStrip topics and FeedList source badges)

**Interfaces:**
- Consumes: all previous tasks; existing `FeedSidebar`, `FeedFilterBar`, `FeedList`, `KeywordStrip`, `SignalVisual`, `SignInTeaser`, `LandingInfo`, `Library`, `NewsList`, UI primitives.
- Produces (spec Pages + Navigation tables):
  - `/` public — hero + compact "inside this week" card (latest report stats) + CTA; no info sections (SignInTeaser/LandingInfo usage leaves the landing).
  - `/brief/<reportId>` public — WeekShape diagrams under the title, editorial read, KeywordStrip, FeedFilterBar, FeedList + NewsList; `/brief` (no param) redirects to the latest report once loaded; unknown id → "This brief does not exist." + archive link (Review Focus 2).
  - `/feed` signed-in — FeedSidebar (week + saved views) + current brief **filtered to follows** with a pick-topics prompt when nothing is followed (Review Focus 3) + TopicPanel; source badges and topic chips carry FollowToggle stars.
  - `/library` signed-in — extended Library tabs: All saved / Read later / Important / **Notes** (saved entries with a non-empty note) / **Upcoming** (NotesPanel).
  - `/archive` public — every week oldest→newest, each row Links to `/brief/<id>`; admin "Run the pipeline now" button stays here.
  - Unknown route → NotFoundPage.
  - App shell: identity (me/topics), library state + actions, pipeline run; header nav per spec; `afterSignOutUrl="/"` already set in main.tsx.

- [ ] **Step 1: Move landing hero into LandingPage;** sign-in gated views (`/feed`, `/library`) render a sign-in prompt card when signed out (Review Focus 1).
- [ ] **Step 2: Implement BriefPage, FeedPage, LibraryPage (+ tabs), ArchivePage, NotFoundPage.**
- [ ] **Step 3: Rewrite App.tsx as the shell** (router switch, header, footer, scroll-to-top on path change (Review Focus 7), `key={route}` + 220 ms fade-and-rise route animation class in `index.css` under an existing `prefers-reduced-motion` override).
- [ ] **Step 4: Verify** — `npm run build` and `npm run lint` clean; dev-server smoke:
  - `GET /` 200; `GET /brief/<id>` renders; `GET /brief/nonexistent` shows the missing message; `GET /feed` signed-out shows the sign-in card; unknown path shows NotFound.
  - Signed in: follow a topic via star, un-follow, feed filters; add/delete an upcoming note; library Upcoming tab lists it.
- [ ] **Step 5: Commit** — `feat(web): ...` per Task (or grouped: schema+API, then pages) following Conventional Commits (git-commit skill).

### Task 10: README + push

**Files:**
- Modify: `web/README.md` — add the pages/routes table (spec), the new endpoints, the extra Clerk-gated data (`user_topics`, `user_notes`), note that routes are a zero-dep history router; refresh the "single scrolling page" description.

- [ ] **Step 1: Update README** (stack, auth, cron, pipeline sections stay; add "Pages" + "Personal topics & notes" sections).
- [ ] **Step 2: Push `web`.**
- [ ] **Step 3:** `main` untouched — merged up only if the user asks.

---

## Self-review notes

- Spec coverage: pages table ✓ (Task 9), data SQL ✓ (Task 1), API table + `/api/me` topics ✓ (Task 2), following rules ✓ (Tasks 3, 7, 9), library tabs ✓ (Task 9), diagrams ✓ (Task 6), error handling ✓ (Tasks 9 + Review Focus), motion ✓ (Task 9 step 3), testing = build + lint + smoke (repo has no node test harness — the spec's "Node logic tests outside the repo" cannot run here; the pure functions stay testable by construction), migration/deploy ✓ (Task 1 local; remote apply stays in README deploy steps, no production D1 configured yet).
- Open questions from the spec, decided: `/` stays landing for signed-in users (no redirect — spec listed it as an open question and this is the conservative default); per-paper Notes tab remains and the library's Notes tab covers saved-with-note entries; no mute — follow only (spec: "No recommendation algorithm… no engagement optimisation").
- Type consistency: `TopicFollow`/`TopicKind`/`UserNote`/`Taggable` live in `lib/topics.ts` and `api.ts` imports from there (no import cycle); the Worker uses its own local row types — separate from the DOM types.
