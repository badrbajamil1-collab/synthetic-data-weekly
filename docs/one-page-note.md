# One-page note — Phase 0 and 1

Status as of 2026-11-04, for the week ending 2026-11-01. Evidence lives in `progress/`.

## What works

**Phase 0 — understand the topic and know signal from noise.** The manual report
exists in two versions (`progress/phase-0-manual/`), the keyword list is 12 terms
tuned to tabular, time-series and privacy work rather than generic AI news, and the
18-source list with a reason per source is in `docs/sources.md`.

**Phase 1 — collectors.** Six collectors over 18 sources (arXiv, Google News,
13 research/vendor blogs, 3 subreddits in one feed, Hacker News, GitHub) return one
`Item` shape and keep only the last 7 days. One full run pulled **223 raw items
(222 kept — 1 already sent) with zero source failures** — `progress/week-2026-11-01/run_log.json`.

Two things the brief schedules for Phase 2 are already in place, because leaving
them broken would have silently corrupted the output — plus one honesty fix it does
not ask for:

- **URL normalisation** — `?utm_source=` variants and arXiv `v1/v2` now collapse to
  one item instead of surviving as duplicates.
- **History** — `history.db` is read during collection (after dedupe, before anything
  is printed) and written after a render, so a link really cannot appear in two
  weeks. Tested end to end: the re-render recorded 0 new URLs.
- **Honest metrics** — `run_log.json` reports found, duplicates removed, already
  sent and kept as four different numbers, and `source_errors` is read from a file
  that is actually written.

**The report itself** renders to Markdown, HTML and a three-page PDF with the
glossary first, and passes all 21 structural checks: subject prefix, section order,
5–10 picks, tool counts, no duplicate links, top-pick dates inside the week.
For week 2026-11-01: 8 picks, 4 tools, 5 worth-a-look, 17 links verified, 0 dead.

## What does not work yet

- **No ranking.** Nothing scores relevance. The picks in `source.yaml` are human
  choices, which is why the number of items collected says nothing about quality.
- **No summaries.** Full text is fetched into `candidates.json`, but the prose is
  written by hand from it.
- **No email.** No SMTP credentials exist, so no report has ever been sent. The
  send path is unwritten, not merely untested.
- **No schedule.** `schedule: "Saturday 08:00"` in `config.yaml` is documentation;
  no cron, Windows task or workflow file reads it.
- **`fetch_candidates.py` hard-codes the week-one shortlist.** It is a Phase 3
  script pretending to be a pipeline step.

## Three next steps

1. **Rank the week (finishes Phase 2).** Add an LLM scorer that returns a 1–10
   relevance score plus a one-line reason per item, keeps the top 10, and writes
   `ranked.json`. Put it behind one small client interface with an offline stub, so
   the ranking logic is testable without a key and no provider is baked in. The
   `PICKS` list in `fetch_candidates.py` disappears at the same time.
2. **Summarise from evidence only (finishes Phase 3).** Generate the 2–3 line
   summaries and the trend-of-the-week from `candidates.json` full text with an
   explicit "summarise only from this text, never invent facts, numbers or authors"
   instruction, then hand the result to `report_build.py` instead of a human
   writing `source.yaml`. That is the point where one command produces a report.
3. **Send it, then schedule it (Phase 5).** SMTP send with `--dry-run` defaulting
   to a single address, recipients read from `config.yaml`, then a Saturday 08:00
   trigger. Only after a correct dry-run email exists does a workflow file make
   sense; a cron that cannot send is theatre.

Phase 4 (LangGraph) is deliberately not on this list. The pipeline is six
sequential functions with one shared result object; wrapping it in a graph adds a
dependency and no behaviour today. Revisit it when there is a branch or retry that
actually needs coordinating.

## Known blemishes in Phase 0

Both are recorded rather than quietly fixed, because the Phase 0 report is meant to
be a historical artefact and editing it after the fact would fake the process.

- **Six top picks, not seven.** The brief says "pick the top 7 items"; the manual
  report carries 6 picks, 2 tools and 2 worth-a-look. That is inside the report
  format's own 5–10 bound, so it does not fail the format check, but it is one short
  of the brief's example.
- **No record of the 3–5 introductory readings.** The brief starts Phase 0 with
  "read 3 to 5 introductions to synthetic data". Nothing in the repo records which
  five, or what each one contributed. Unlike the source list, this cannot be
  reconstructed honestly after the fact; it needs the reader to supply the list.
