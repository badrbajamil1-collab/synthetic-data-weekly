# Progress — Weekly Synthetic Data Research Agent

Everything produced so far, in one place. The rest of the project folder is code;
this folder is the evidence.

---

## What's here

| Folder | What it holds | Phase |
|---|---|---|
| `spec/` | The brief this is being built against | — |
| `phase-0-manual/` | The hand-written report that proved the format works, plus the executive version | 0 |
| `week-2026-11-01/` | First real week, end to end: source YAML → Markdown, HTML, PDF, run log | 1 + 3 |
| `review/` | Build review page (progress + flow diagram + code verdict) and PDF page renders | — |

### `week-2026-11-01/`

| File | What it is |
|---|---|
| `source.yaml` | The curated content for the week — trend, 8 picks, 4 tools, 5 worth-a-look |
| `report.md` | The email body, spec format |
| `report.html` | Same content, rendered |
| `Synthetic_Data_Weekly_2026-11-01.pdf` | Three-page PDF, glossary first |
| `run_log.json` | 219 found → 219 unique → 20 read → 17 links → 0 dead |

---

## Status

| Phase | Name | State |
|---|---|---|
| 0 | Manual report + sources | ~90% — missing the explicit 15–20 source list |
| 1 | One collector per source | **done** — 6 sources, 219 items, 0 errors |
| 2 | Normalise, dedupe, score | not started — no LLM client, `memory.py` unwired |
| 3 | Fetch, summarise, render | templates work; summarising is still manual |
| 4 | LangGraph pipeline | not started |
| 5 | Dry-run, schedule, email | not started — no SMTP credentials |
| 6 | Two unattended Saturdays | blocked on 4 + 5 |

The honest summary: **the collection half is real, the reasoning half is me.**
`python main.py` collects and prints. It does not rank, summarise, render or send.

---

## View the review page

Double-click `review/review.html` — it is self-contained, no internet needed.

Or run `view.bat` in this folder to serve it at
<http://127.0.0.1:8899/review/review.html>.

---

## Regenerate this week's artefacts

From the project root:

```
python main.py                      # collect → raw_items.json
python fetch_candidates.py          # shortlist → candidates.json
python report_build.py progress/week-2026-11-01/source.yaml
python verify_report.py             # 20 checks against the files on disk
```

Each run writes to `progress/week-<week_end>/`, so weeks never overwrite each other.
