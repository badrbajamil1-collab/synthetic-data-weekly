# One-page note — Phase 0, 1 and 2

Status as of 2026-11-04. Evidence lives in `progress/`.

## What works

**Phase 0 — understand the topic and know signal from noise.** The manual report
exists in two versions (`progress/phase-0-manual/`), the keyword list is 22 terms
tuned to tabular, time-series and privacy work rather than generic AI news, and the
18-source list with a reason per source is in `docs/sources.md`.

**Phase 1 — collectors.** Six collectors over 18 sources (arXiv, Google News,
13 research/vendor blogs, 3 subreddits in one feed, Hacker News, GitHub) return one
`Item` shape and keep only the last 7 days. One full run pulled **223 raw items
(222 kept — 1 already sent) with zero source failures** — `progress/week-2026-11-01/run_log.json`.

**Phase 2 — clean, filter and rank.** `rank_items.py` scores every item 1–10 for
relevance and 1–10 for Well7 fit with a one-line reason, collapses same-story
coverage across the whole week, and writes `ranked.json`. The hard-coded `PICKS`
list in `fetch_candidates.py` is gone; the shortlist now comes from the ranking.

One live run over the real week (2026-11-04):

| Measure | Result |
|---|---|
| Items in / out | 222 / 222 — nothing vanishes |
| Scored | 222 (100%), 0 unscored |
| Model calls | 15 (batches of 15, 3 concurrent) |
| Retries | 0 |
| Duplicate stories collapsed | 4 |
| Cached rerun | 0 calls, byte-identical `ranked.json` |

Acceptance checks verified against the artefacts, not the console: no duplicate
URLs, no raw URL missing from the output, score order monotonic, every scored item
has a non-empty reason under 160 characters, no duplicate inside the top 10.

Two things the brief schedules for Phase 2 were already in place from Phase 1,
because leaving them broken would have silently corrupted the output:

- **URL normalisation** — `?utm_source=` variants and arXiv `v1/v2` collapse to one
  item instead of surviving as duplicates.
- **History** — `history.db` is read during collection and written after a render,
  so a link really cannot appear in two weeks. Tested end to end: the re-render
  recorded 0 new URLs.

**The report itself** renders to Markdown, HTML and a three-page PDF with the
glossary first, and passes every structural check in `verify_report.py`. For
week 2026-11-01: 8 picks,
4 tools, 5 worth-a-look, 17 links verified, 0 dead.

## Phase 2 vs the manual report — the comparison the brief asks for

The brief's Phase 2 deliverable is "a ranked list you can compare with your manual
report". The manual report covers 26 Oct – 1 Nov; this ranking ran on the 4 Nov
collection, so **0 of the 6 manual picks appear in it** — different publication
windows, not a disagreement.

What can be compared is the *character* of the output, and it differs:

| | Manual (Phase 0) | Ranker (Phase 2) |
|---|---|---|
| Top-source mix | 6 of 6 arXiv papers | 5 GitHub, 2 arXiv, 2 news, 1 HN |
| Star counts of picks | n/a | 0, 0, 0, 447, 0 |

**The finding:** the ranker is faithful to the rubric and blind to substance. It
scores a zero-star GitHub repo whose description reads "federated differentially
private tabular synthesis tool" at 10/10, ahead of real papers. The rubric says
"new tools" and the description matches every keyword, so the score is defensible
from the text alone — it simply cannot tell a serious project from a student
exercise.

The distribution confirms the model is not broken: 152 of 222 items scored 1–2, and
spot-checking them shows genuine noise (a Fashion-MNIST tutorial, LLM inference
benchmarks, 3D Gaussian splatting, Reddit threads about conference reviewing). The
model's reasons for rejecting them are accurate. Phase 1's documented looseness —
arXiv `all:` matching loosely, GitHub returning repos that merely mention the query
— is exactly what the tail consists of.

**Consequence for the pilot:** expect the top 10 to over-represent GitHub until the
prompt is tuned to discount repositories by stars or to require an arXiv/news item
in the mix. That is a Phase 6 tuning job, not a Phase 2 defect, and it should be
judged against a real week of feedback rather than guessed at now.

*Update 2026-11-06:* this tuning landed early, on user feedback about the first
reports. Repos now carry stars and creation date to the ranker, the rubric
discounts old low-star repos, and the shortlist caps GitHub's share at 3
(`ranking.github_share_cap`). The `(stars: N)` title suffix is gone. Whether the
output reads better is the next real week's test.

## What does not work yet

- **No Saturday run has happened yet.** SMTP credentials are configured, a real
  `--test` send on 2026-11-18 reached the Primary Inbox (no PDF attached, direct
  publisher links; note that `progress/week-2026-11-20/run_log.json` currently lacks
  the `email` block because a subsequent `report_build.py` re-render overwrote it
  before `report_build.py` was fixed to preserve `email`), and `SyntheticDataWeekly`
  is now registered for Saturday 08:00 in real-send mode. Watch two Saturdays before
  tuning. The task is interactive-only: it runs as the current user when signed in,
  with no stored password, so it will not fire while the machine is signed out.
- **Reddit is currently blocked from this host.** Both the multi-subreddit RSS feed and
  the JSON API now return 404/403. The collector records the outage as a `[warn]` in
  `raw_run_log.json` and contributes 0 items; it no longer raises a fatal source error
  that failed `verify_report.py`. The other five sources are unaffected.
- **The ranker cannot judge substance**, per the comparison above. *(Updated
  2026-11-06: substance evidence — stars and project age — is now in the prompt, and
  the shortlist caps GitHub's share. Whether that fixes the judgement is the next
  real week's test.)*

## Next steps (Phase 6 pilot)

1. **Phase 5 is complete.** SMTP credentials are configured in `.env`, a real
   `send_report.py --test` email arrived in Primary Inbox, and
   `schedule_task.py --register --send` registered `SyntheticDataWeekly` for
   Saturday 08:00 in real-send mode (keep GitHub Actions `SMTP_*` secrets unset
   while the local task is live so only one scheduler sends).
2. **Watch two Saturdays (Phase 6).** Check `logs/weekly.log` (`mode: send`),
   `run_log.json` (`email` block) and the recipients' replies; do not tune anything
   from a single week.
3. **Tune the ranking on that feedback (Phase 6).** Decide whether GitHub repos should
   be discounted by stars, whether the top 7 shortlist must contain at least one paper,
   and whether the 1–2 band is too wide.

Phase 4 is no longer deferred: the pipeline is a LangGraph state machine
(`collect → clean → rank → fetch → report → render → send`) over one shared
`AgentState`. The graph is what makes "one source fails, the report still goes out"
structural rather than a pile of try/excepts.

## Known blemishes in Phase 0

Both are recorded rather than quietly fixed, because the Phase 0 report is meant to
be a historical artefact and editing it after the fact would fake the process.

- **Six top picks, not seven.** The brief says "pick the top 7 items"; the manual
  report carries 6 picks, 2 tools and 2 worth-a-look. That is inside the brief's
  5–10 range (the current `2026-11-11` report format bound is 1–10 picks), so it
  does not fail the format check, but it is one short of the brief's example.
- **No record of the 3–5 introductory readings.** The brief starts Phase 0 with
  "read 3 to 5 introductions to synthetic data". Nothing in the repo records which
  five, or what each one contributed. Unlike the source list, this cannot be
  reconstructed honestly after the fact; it needs the reader to supply the list.

## Update — 2026-11-07

- **`well7_fit` is now the primary sort key** (was `score`). The rubric expanded
  to Well7's vocabulary (CTGAN/TVAE/CopulaGAN, ε-DP/DP-SGD, MIA/Anonymeter,
  SDV/OpenDP, PDPL/EU AI Act, FITS/CrossSynth), `RUBRIC_VERSION` bumped to
  `2026-11-07.1`, so `score_cache.json` is invalidated — the next real run
  re-scores all items (~15 model calls). Over 218 scored rows, 123 carry a
  `well7_fit` of 1, so the reordering is real, not cosmetic.
- **The 2026-11-06 week was regenerated offline** (`--no-llm`) after OpenRouter's
  free tier hit `429 free-models-per-day`. The 7 picks are Well7-relevant
  (9s–10s), but their prose is **extractive**, not written summaries — the trend
  paragraph even contains a stray web sentence. Re-running `write_report.py`
  without `--no-llm` once quota exists replaces it.
- **A degraded ranking can no longer be published by the Worker.**
  `web/worker/pipeline/guard.ts` (on the `web` branch) blocks the report INSERT
  when all score batches fail or >10% of items are unscored — this was the
  failure mode that produced the all-score-1 week on 6 Nov.
- **Repo split for GitHub:** `main` is the Python agent; the `web` branch carries
  the Cloudflare Workers/D1/React view. The Worker's silent score-1 fallback is
  documented at `web/worker/pipeline/rank.ts:58` (guarded by `guard.ts` now).

## Update — 2026-11-12 (reviewer feedback applied to the Python pipeline)

All six groups of reviewer feedback landed, with tests first (~290 new lines in
`selftest.py`) and a whole-branch review. Nothing in `web/` changed.

- **One fixed week.** `src/synthetic_data/week.py` derives Saturday-Friday from
  the run date; collect, fetch, compose and verify all import it, so windows no
  longer overlap or drift. `write_report.py --week-end` still replays a past week.
- **Collect.** GitHub searches `created:` (plus releases for older repos) instead
  of `pushed:`; arXiv uses the API abstract rather than scraping `/abs`; every
  source retries 429/5xx with backoff; per-source counts appear in the footer.
- **Clean.** Dedupe and duplicate grouping both prefer the primary source, and
  `links.story_key` collapses an HN/Reddit post onto the paper or repo it links to.
- **Rank.** A cheap `config.keywords` gate skips obvious noise before any model
  call; one comparative editor pass re-scores the top 20 together; the rubric and
  a deterministic ceiling keep `well7_fit` distinct from `score`; the LLM is asked
  for JSON via `response_format` (with a 400 fallback).
- **Summarise.** Top picks ~50 words, tools/worth one line; `why_it_matters` is
  its own guarded line; a failed trend is omitted and the run flagged instead of
  pasting together first sentences.
- **Build.** Per-section score floors (top 7 / tools 6 / worth 5): sections are
  never padded, and `verify_report.py` checks the floor, the why-line in the
  rendered Markdown/HTML and the Saturday-Friday shape. Old weeks still verify.
- **Deliver.** `llm.require_api_key` accepts `OPENROUTER_API_KEY` **or**
  `LLM_API_KEY` (the 7 Nov failure); `history.db` is written atomically with a
  backup merged on read; the workflow saves its cache with `if: always()`.

Spec: `docs/superpowers/specs/2026-11-11-pipeline-improvements-design.md`.
Plan: `docs/superpowers/plans/2026-11-11-pipeline-improvements.md`.
Reader-feedback links remain the deferred Phase 6 idea.

## Update — 2026-11-18 (phase audit)

Verified against artefacts, not the older prose above:

- **Phases 0–5 are complete.** `selftest.py` passes 414 checks (375 baseline, 19
  Batch 1, and 20 Batch 2 audit-fix regressions); `verify_report.py` passes 30/30 against
  `progress/week-2026-11-20/source.yaml` (exit 0). SMTP is configured and a real
  `--test` send landed in the Primary Inbox with no PDF attachment and direct
  publisher links (note: `progress/week-2026-11-20/run_log.json` does not retain
  that `email` block because a pre-fix `report_build.py` re-render overwrote it
  prior to commit `dd6eadd`; `report_build.py` now preserves `email` across future
  re-renders).
- **Phase 6 is the only open phase.** `SyntheticDataWeekly` was registered with
  `python schedule_task.py --register --send`; `--query` confirms Saturday 08:00,
  `Status: Ready`, next run 2026-11-21. Watch two Saturdays before tuning.
- **Deliverability changes from this pass:** `From == SMTP_USER`, PDF attachment off by
  default (`--attach-pdf` opts in), headline caps tightened, Google News redirects
  unwrapped to original publishers (or dropped).
- **Reddit outage is now non-fatal:** the feed is blocked from this host, so
  `fetch_reddit` records a warning instead of raising. The report discloses 0 Reddit
  items and still verifies cleanly.

## Update — 2026-11-20

- **GitHub Actions is now the sole live Saturday scheduler.** `.github/workflows/weekly-report.yml`
  runs every Saturday at `05:17 UTC` (`13:17 UTC+8` / `08:17 UTC+3`) with `LLM_API_KEY` and
  `SMTP_*` secrets configured; the local Windows `SyntheticDataWeekly` task was deleted via
  `schedule_task.py --delete` so only one scheduler ever sends.
- **Resilience hardening added before the first live Saturday run (`2026-11-21`):**
  - `llm.chat` now walks a configured `fallback_models` chain (`config.yaml` →
    `ranking.fallback_models` / `summarising.fallback_models`) on 429/5xx/404 or empty
    reasoning-capped responses, honours numeric `Retry-After` headers, fails fast on 401/403,
    and skips remaining `:free` models on `free-models-per-day` (while still trying any paid
    fallback).
  - `graph.weekly_run` writes `ranked.json` alongside `candidates.json` so
    `publish_to_cloudflare.py` enriches item scores, `well7_fit`, and reasons during CI runs.
  - `emailer.send_message` retries pre-DATA connection/TLS/login errors and explicit temporary
    4xx rejections (421/450/451) while never retrying mid-DATA drops or 5xx/auth rejections;
    `publish_to_cloudflare.publish` retries transient HTTP 429/5xx and transport errors.
- **2026-11-21 delivery & schedule hardening:** `emailer.compose` now aligns `Message-ID`
  with the sender's address domain (`make_msgid(domain=...)`) so GitHub Actions runners do
  not stamp an internal runner hostname, and the Saturday cron moved off-peak from
  `0 5 * * 6` to `17 5 * * 6` (`05:17 UTC`) after `:00` top-of-hour queue delays and a missed
  trigger on 2026-11-21.
