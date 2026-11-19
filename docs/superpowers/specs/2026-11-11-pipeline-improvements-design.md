# Pipeline Improvements — Design (2026-11-11)

## Intent

Apply the six groups of reviewer feedback to the **Python** pipeline of the
Synthetic Data Weekly agent. The `web/` frontend is out of scope. Preserve what
already works: verified accurate summaries with the numeric fact guard, no dead
links, no link repeats across weeks, config/secrets separation, the LangGraph
`collect -> clean -> rank -> fetch -> report -> render -> send` chain, and the
honest README.

Success = `selftest.py` and `verify_report.py` pass (or are updated to encode the
new rules), the pipeline still runs end to end, and each bullet below has a
testable change. The Phase 6 "useful / not useful" reader-feedback idea is
**deferred** — it was explicitly labelled an idea.

## Decisions (approved by the human partner)

1. `score` and `well7_fit` are **kept**. Sharpen the rubric so they measure
   different things, and add a deterministic keyword-based ceiling that stops
   them coming out identical.
2. The report week is the **current Sunday–Saturday week containing the run
   date**. `week_end` = that week's Saturday, `week_start` = the Sunday before.
   A Saturday 08:00 run reports the week ending that same day.
3. Score floors (top >= 7, tools >= 6, worth >= 5) may leave a short section;
   **fewer items is fine**. `verify_report.py` relaxes the 5–10 top-pick bound
   to 1–10 and checks the floor instead.
4. Reader-feedback links are **not** implemented.
5. The small `.github/workflows/weekly-report.yml` and `.env.example` edits are
   in scope because bullet 6 names the workflow.

## Shared foundation — `src/synthetic_data/week.py` (new)

- `week_bounds(run_date: date | None = None) -> tuple[date, date]` —
  `(Sunday, Saturday)` of the calendar week containing `run_date` (Mon=0 …
  Sat=5, Sun=6). Defaults to `date.today()`.
- `in_week(value, bounds) -> bool` — accepts `date`, `datetime`, or ISO string;
  True when the calendar day lies inside `bounds` inclusive.
- Both collection and reporting import this module, so the window cannot drift
  between stages. `write_report.py --week-end` remains an explicit override for
  replaying a historical week.

## 1 · Collect

- GitHub: search `created:>cutoff` instead of `pushed:>`; date an item by
  `created_at`. An older repo is included **only** when its releases API shows a
  release published inside the week. Keep stars/creation date in the snippet,
  never the title.
- arXiv: keep the API's `atom:summary` as the abstract (no 400-char truncation).
  `fetch_candidates.py` uses that abstract for arXiv URLs instead of scraping
  the `/abs` page — removes "View PDF HTML (experimental)" noise.
- Every collector retries 429/5xx with exponential backoff (Reddit already
  does; arXiv, Google News, HN, blogs and GitHub do not). Retries must not
  multiply: one layer only, in `get_with_retry`.
- Per-source counts already exist in `CollectResult.counts`; surface them in the
  report footer.

## 2 · Clean and deduplicate

- `dedupe_items` keeps the **primary-source** copy: `arxiv`/`github`/`blog`/
  `news` beat `hn`/`reddit`, regardless of which is newer. Still collapse URL
  variants through `normalize_url`.
- Add `Item.target_url: str = ""`; HN/Reddit record the external link they point
  at. `links.story_key(item)` derives a canonical key from the underlying
  arXiv id / GitHub `owner/repo` / DOI (preferring `target_url`).
  `rank.group_duplicates` merges by `story_key` **before** title Jaccard, so an
  HN post linking to paper X collapses onto paper X.

## 3 · Rank

- `rank.prefilter_indices(items, keywords) -> set[int]`: cheap keyword check
  over title + snippet using `config.yaml`'s `keywords`. Off-topic rows get
  `score=1`, `well7_fit=1`, `score_status="prefiltered"` and make **no** model
  call. Cuts free-tier usage.
- `rank.rerank_top(rows, chat_fn, *, top_n=20) -> list[dict]`: one comparative
  call re-scores the top ~20 together, so scores from different batches become
  comparable. Returns every row (same input order).
- Rubric: `score` = general relevance/newsworthiness; `well7_fit` = fit to
  Well7, computed independently, with explicit divergence examples.
  `rank.diversify_well7_fit(rows)` applies a deterministic ceiling: when a
  scored row has no privacy/tabular/time-series signal in title+snippet,
  `well7_fit` is capped at `score - 2` (floor 1). Bump `RUBRIC_VERSION`.
- Structured output: `llm.chat(..., json_mode=True)` adds
  `response_format: {"type":"json_object"}` and drops it on a 400, like the
  existing `reasoning` fallback. Rank prompts request `{"scores":[...]}`;
  `parse_scores` already accepts that wrapper.
- `llm.require_api_key(env)` accepts `OPENROUTER_API_KEY` **or** `LLM_API_KEY`.

## 4 · Summarise

- Top picks ~50 words / 1–2 sentences; tools and worth-a-look one line (~20
  words). Tighter char caps, and the over-long repair path still applies.
- `why_it_matters` becomes its own short field on each entry, rendered as its
  own line in Markdown/HTML/PDF and checked by `verify_report.py`. The numeric
  fact guard covers it too.
- A failed trend no longer pastes together first sentences:
  `summarise_trend` returns `{"trend": "", "guard": "omitted"}`, the Trend
  section is omitted, and the run is flagged in `run_log.json`.

## 5 · Build the report

- Score floors per section (top >= 7, tools >= 6, worth >= 5). Items below go
  to `dropped`; sections are never padded.
- Fixed Sunday–Saturday window from the run date, shared by collect, fetch,
  compose and verify. Backward-compatible: `verify_report.py` only enforces the
  Sunday/Saturday shape when `run_log.json` has `week_mode == "run_date"`.
- Per-source counts appear in the footer **above** the contractual final line,
  so `md.rstrip().endswith(...)` still passes and no extra anchors are added.

## 6 · Run and deliver

- `llm.require_api_key()` used by `graph.py`, `rank_items.py`, `write_report.py`.
- `history.db`: durable atomic write plus a backup merged on read, so a partly
  failed run cannot lose previously sent links. The workflow saves the cache
  with `if: always()`.
- `.env.example` documents both key names; the workflow passes
  `OPENROUTER_API_KEY` from `secrets.LLM_API_KEY` as well.

## Out of scope

`web/`, the Phase 6 feedback loop, restyling prose to taste, and any change to
the report's subject prefix, section order, footer text or PDF glossary-first
deviation.
