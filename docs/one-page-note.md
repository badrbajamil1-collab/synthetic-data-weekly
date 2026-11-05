# One-page note — Phase 0, 1 and 2

Status as of 2026-11-04. Evidence lives in `progress/`.

## What works

**Phase 0 — understand the topic and know signal from noise.** The manual report
exists in two versions (`progress/phase-0-manual/`), the keyword list is 12 terms
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
glossary first, and passes all 21 structural checks. For week 2026-11-01: 8 picks,
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

## What does not work yet

- **No real email has been sent.** The send path exists and `--dry-run` writes the exact
  message (HTML body, plain-text alternative, PDF attachment), but `.env` still has no
  SMTP credentials, so a real send is untested.
- **The scheduled task is interactive-only.** It runs as the current user when signed
  in, with no stored password; it will not fire while the machine is signed out.
- **The ranker cannot judge substance**, per the comparison above.

## Three next steps

1. **Fill the SMTP set and prove receipt (finishes Phase 5).** Add `SMTP_HOST`,
   `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` to `.env`, then run
   `python send_report.py --test`. The test send goes only to `DRY_RUN_RECIPIENT` and
   records no history. Check the HTML body renders in the mail client and the PDF
   attachment opens.
2. **Run two real Saturdays unattended (Phase 6).** The `SyntheticDataWeekly` task is
   registered for Saturday 08:00. Watch `logs/weekly.log`, `run_log.json` and the
   recipients' replies; do not tune anything from a single week.
3. **Tune the ranking on that feedback (Phase 6).** Decide whether GitHub repos should
   be discounted by stars, whether the top 10 must contain at least one paper, and
   whether the 1–2 band is too wide.

Phase 4 is no longer deferred: the pipeline is a LangGraph state machine
(`collect → clean → rank → fetch → report → render → send`) over one shared
`AgentState`. The graph is what makes "one source fails, the report still goes out"
structural rather than a pile of try/excepts.

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
