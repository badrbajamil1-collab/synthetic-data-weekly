# Progress — Weekly Synthetic Data Research Agent

Everything produced so far, in one place. The rest of the project folder is code;
this folder is the evidence.

---

## What's here

| Folder | What it holds | Phase |
|---|---|---|
| `spec/` | The brief this is being built against | — |
| `phase-0-manual/` | The hand-written report that proved the format works, plus the executive version | 0 |
| `phase-2-ranking/` | The ranked list: all 222 items scored, frozen with its score cache | 2 |
| `week-2026-11-01/` | First real week, end to end: source YAML → Markdown, HTML, PDF, run log | 1 + 3 |
| `review/` | Build review page (progress + flow diagram + code verdict) and PDF page renders. The page is a 1 Nov snapshot; a banner on it lists what changed on 4 Nov. | — |

### `week-2026-11-01/`

| File | What it is |
|---|---|
| `source.yaml` | The curated content for the week — trend, 8 picks, 4 tools, 5 worth-a-look |
| `report.md` | The email body, spec format |
| `report.html` | Same content, rendered |
| `Synthetic_Data_Weekly_2026-11-01.pdf` | Three-page PDF, glossary first |
| `run_log.json` | 223 found → 222 kept (1 already sent) → 20 read → 17 links → 0 dead |
---

## Status

| Phase | Name | State |
|---|---|---|
| 0 | Manual report + sources | **done**, with two blemishes — 6 picks instead of 7, no record of the intro readings (see `docs/one-page-note.md`) |
| 1 | One collector per source | **done** — 6 collectors / 18 sources / 27 requests, 223 items, 0 errors |
| 2 | Normalise, dedupe, score | **done** — 222/222 scored, 15 calls, 4 duplicate stories collapsed; evidence in `phase-2-ranking/` |
| 3 | Fetch, summarise, render | half — templates work and full text is fetched; summarising is still manual |
| 4 | LangGraph pipeline | skipped on purpose — see `docs/one-page-note.md` |
| 5 | Dry-run, schedule, email | not started — no SMTP credentials |
| 6 | Two unattended Saturdays | blocked on 3 and 5 |

The honest summary: **collection and ranking are real, the writing is still me.**
`main.py` collects and `rank_items.py` ranks, but nothing summarises the shortlist —
`source.yaml` is still written by hand from `candidates.json`.

The close-out work that made Phase 0–1 defensible is in git history: the baseline
commit, then `fix: make dedupe, history and run-log counts real`, then the docs
rewrite. Phase 2's design is `docs/superpowers/specs/2026-11-04-phase-2-ranking-design.md`.
`docs/one-page-note.md` is the one-page status the brief asks for.

---

## View the review page

Double-click `review/review.html` — it is self-contained, no internet needed.

Or run `view.bat` in this folder to serve it at
<http://127.0.0.1:8899/review/review.html>.

---

## Regenerate this week's artefacts

From the project root:

```
uv run python main.py                      # collect → raw_items.json + raw_run_log.json
uv run python rank_items.py                # rank → ranked.json (cached reruns are free)
uv run python fetch_candidates.py          # top 10 → candidates.json
uv run python report_build.py progress/week-2026-11-01/source.yaml
uv run python verify_report.py             # 21 checks against the files on disk
```

`report_build.py` writes into `progress/week-<week_end>/`, so weekly reports never
overwrite each other. `main.py` and `fetch_candidates.py` write their intermediates
(`raw_items.json`, `raw_run_log.json`, `candidates.json`) to the repo root, where
each run replaces the previous one.
