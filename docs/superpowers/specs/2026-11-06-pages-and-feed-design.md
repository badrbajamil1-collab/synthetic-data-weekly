# Weekly digest — pages, personal feed, library

**Date:** 2026-11-06
**Status:** draft for review
**Scope:** the `web/` app (Vite + React + Cloudflare Worker)

## Goal

Turn the single scrolling page into four real pages with clear navigation, add a
personal feed filtered by the topics and sources a reader follows, make the
library the logged-in home (read later, important, notes, and notes on upcoming
things), put static week-shape diagrams on the brief, and rework the landing page
and motion.

## Non-goals

- No recommendation algorithm, no infinite scroll, no engagement optimisation.
- No new auth system. Clerk stays.
- No email. Still deferred.
- No changes to the Python pipeline or the report format.

## Pages

| Route | Access | Purpose |
|---|---|---|
| `/` | public | One screen: hero, a compact "inside this week" card, CTA. No info sections. |
| `/brief/[week]` | public | The brief. Week-shape diagrams, then ranked items, then headlines. `/brief` redirects to the latest week. |
| `/feed` | signed in | The current brief filtered to the topics and sources I follow. |
| `/library` | signed in | Home. Read later, Important, Notes, Upcoming. |
| `/archive` | public | Every week, oldest to newest. |

Navigation:

- Signed out: logo → `/`; links **Brief**, **Archive**; buttons **Sign in**, **Sign up**.
- Signed in: logo → `/library`; links **Feed**, **Brief**, **Library**, **Archive**; avatar.
- The header shows page links, not anchor links. No more scrolling between sections.
- A signed-in reader who opens `/` still sees the landing; the logo and the
  **Library** link are the way home. (Alternative: redirect `/` → `/library` when
  signed in. Open question, see below.)

## Data

Migration `0004_user_topics_notes.sql`:

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

`user_items` (read later / important / per-paper note) is unchanged.

## API

All require the existing Clerk JWT (`viewer.userId`).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/my/topics` | — | `{ topics: [{ kind, value }] }` |
| PUT | `/api/my/topics` | `{ kind, value }` | `{ topics: [...] }` |
| DELETE | `/api/my/topics` | `{ kind, value }` | `{ topics: [...] }` |
| GET | `/api/my/notes` | — | `{ notes: [{ id, body, created_at }] }` |
| POST | `/api/my/notes` | `{ body }` | `{ note }` |
| DELETE | `/api/my/notes/:id` | — | `{ notes: [...] }` |

`GET /api/me` also returns `topics`, so the feed can filter on first paint.

## Following topics and sources

- Every topic chip and source badge is followable: a small star toggles it.
  Followed items are filled; not followed are outline.
- The Feed page has a **My topics** panel listing every topic and source seen in
  the archive, with counts, and a toggle for each.
- If nothing is followed, the feed shows the whole brief with a prompt to pick
  topics — never an empty page.
- Matching rule: an item is in my feed if any of its topic labels is followed as
  a topic, **or** its source is followed as a source.

## Library

Tabs: **Read later**, **Important**, **Notes**, **Upcoming**.

- Read later / Important: the existing per-item state, across all weeks.
- Notes: the existing per-paper note on saved items.
- Upcoming: free-text entries from `user_notes`, with add and delete. This is for
  things the reader wants to track that are not in a brief yet.

## Brief page diagrams

All static SVG, computed from the week's items, no chart library, no tooltips.

- **Importance donut** — items grouped by score band: 8–10, 5–7, 1–4.
- **Sources** — horizontal bars with counts.
- **Topics** — horizontal bars with counts.

They sit directly under the brief title, above the editorial read.

## Motion

- Route change: 200–300 ms fade-and-rise on the incoming page.
- Landing hero: keep `BlurFade`, tightened to ~0.4 s.
- Brief: sections reveal on scroll, subtly; the page is short enough that this
  never feels like a scroll journey.
- Landing stats keep `NumberTicker`.
- No scroll-jacking, no parallax, no animation on the diagrams.

## Components

- `App.tsx` — router outlet + header/footer layout.
- `lib/router.tsx` — tiny history router (`useRoute`, `navigate`, `<Link>`).
  No new dependency.
- `pages/LandingPage.tsx`
- `pages/BriefPage.tsx`
- `pages/FeedPage.tsx`
- `pages/LibraryPage.tsx`
- `pages/ArchivePage.tsx`
- `pages/NotFoundPage.tsx`
- `components/week-shape.tsx` — the three diagrams.
- `components/follow-toggle.tsx` — the star on chips and badges.
- `components/topic-panel.tsx` — the Feed page's topic/source manager.
- `components/notes-panel.tsx` — Upcoming notes.
- `lib/topics.ts` — follow matching and week-shape grouping (pure, testable).

## Error handling

- Unknown route → `NotFoundPage`.
- Failed API call → page-level error with a retry button (existing pattern).
- Feed with no follows → prompt, not an empty state.
- Library with no saves → the existing empty state.
- Deep link to a week that does not exist → "This brief does not exist" with a
  link to the archive.

## Testing

- Node logic tests (existing harness, outside the repo): follow matching,
  week-shape grouping, topic/source extraction.
- `npm run build`, `npm run lint`.
- Local screenshots of every page, signed out and signed in (mock API, no Clerk).
- After deploy: smoke-test every route, a deep link, and the SPA fallback.

## Migration and deploy

1. Add `0004_user_topics_notes.sql`.
2. Apply locally, then remotely (`wrangler d1 migrations apply`).
3. Confirm the Worker serves `index.html` for unknown paths.
4. Deploy, then smoke-test.

## Open questions

1. Should `/` redirect to `/library` for signed-in readers, or stay on the landing?
2. Should the per-paper **Notes** tab stay, given Upcoming notes are separate?
3. Do followed topics/sources need a "mute" (hide) as well as a "follow"?
