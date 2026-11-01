# AGENTS.md — Weekly Synthetic Data Research Agent

Python 3.13 / uv, Windows + PowerShell 5.1. Collects 7 days of synthetic-data
content and renders a weekly report. **Only the collection half is automated** —
ranking, summarising and sending are still done by hand. Deliverables live in
`progress/`; `progress/README.md` is the index of what has been produced.

The repo root also holds unrelated video/showcase scripts (`build_showcase_video.py`,
`generate_pdf.py`, `chat_crops/`, `*.mp4`). They are not part of this project — ignore
them unless asked.

## Commands

Run from the repo root. The venv has the package installed editable
(`synthetic_data.pth`), so `synthetic_data` imports without `PYTHONPATH`.

| Task | Command |
|---|---|
| Collect every source → `raw_items.json` | `python main.py` |
| One source, fast (verified: ~3 s) | `python main.py --source arxiv --limit 5 --no-save` |
| Offline helper tests | `python selftest.py` |
| Validate window / dedupe in `raw_items.json` | `python validate_phase1.py` |
| Check all 13 blog feeds are alive | `python feed_health.py` |
| Full text of shortlist → `candidates.json` | `python fetch_candidates.py` |
| Render report from curated content | `python report_build.py progress/week-<date>/source.yaml` |
| Verify rendered artefacts (20 checks) | `python verify_report.py` |

`python` is not on PATH on this machine — use `.venv\Scripts\python.exe` or `uv run python`.
There is no pytest, linter, formatter, typecheck or CI. `selftest.py` + `verify_report.py`
are the test suite; both exit non-zero on failure.

## Pipeline

`main.py` → `cli.main` → `runner.collect_all` → the 6 collectors in `collectors.py`.
**That is all `main.py` does** — no ranking, no summaries, no rendering, no email.

The rest is separate scripts run by hand, in this order:

```
python main.py
python fetch_candidates.py          # resolves redirects, extracts full text
  → a human writes progress/week-<date>/source.yaml   ← the manual step
python report_build.py progress/week-<date>/source.yaml
python verify_report.py
```

`report_build.py` verifies every link, drops dead ones, then writes
`report.md`, `report.html`, the PDF and `run_log.json` into `progress/week-<week_end>/`.
`verify_report.py` defaults to the newest `progress/week-*/source.yaml`. The old
top-level `reports/` directory no longer exists.

## Gotchas that will bite

- **Hacker News returns HTTP 419** to non-browser clients. That is not a dead link;
  `links._check_hacker_news` verifies through the Algolia API deliberately. Do not
  "fix" it into a plain status check.
- **Google News RSS links are opaque redirects** (`news.google.com/rss/articles/...`)
  that return 200 for anyone. A 200 proves nothing until `links.resolve_google_news`
  unwraps them via Google's `batchexecute` RPC.
- **Reddit:** use `.rss` with no trailing slash — `/.rss` returns 429. Roughly 1 request
  per minute per IP, so the collector backs off 15/30/45 s. A second full run inside a
  minute stalls ~90 s; that is rate limiting, not a hang.
- **arXiv announces nothing Friday or Saturday**, so most weeks end with a date gap.
  Expected. Its `all:` search also matches loosely — expect off-topic papers in the raw list.
- **GitHub search filters on `pushed_at`**, not publication date, and returns repos that
  merely mention the query. Treat the ranking as noise.
- **PowerShell 5.1**: no `head`, `wc`, `sed`, or `&&`. Use `Select-Object -First`,
  `Measure-Object`, `;`.

## Known dead code — do not trust until fixed

Deliberately left for Phase 2; each one silently produces wrong output today.

- `config.yaml` → `sources.arxiv.categories` is read by nobody. The collector searches
  `all:"synthetic data"`, so a paper that never uses that phrase is invisible.
- `links.normalize_url` is written but never called. Collect-time dedupe compares raw URL
  strings, so `?utm_source=` variants survive as separate items.
- `memory.py` (`filter_seen_urls` / `save_sent_urls`) is never called and `history.db` is
  never created — the "no link twice in two weeks" rule is currently unenforced.
- `run_log.json`: `items_found` and `items_after_dedupe` both read `len(raw)`;
  `source_errors` reads `raw_run_log.json`, which nothing writes, so it is always `[]`.
- `models.AgentState` is a Pydantic model imported nowhere, and `langgraph` is not installed.
- `report_build.py` exits **1 when it dropped dead links** — that is a successful render of
  a filtered report, not a crash.

## The report format is contractual

`report.md`, `report.html` and the PDF are checked by `verify_report.py` against the brief:
exact subject line, section order, footer text, 5–10 picks, tool counts, no duplicate links,
dates inside the week, PDF over 40 KB. Do not restyle prose to taste — edit the YAML in
`progress/week-<date>/source.yaml` and re-render.

The PDF is the single intentional deviation: glossary first, then the report. Email and
Markdown follow the spec order exactly.

## Environment

- Recipients, keywords, sources and feeds live in `config.yaml` — never hard-code them.
- `.env` is git-ignored and **does not exist**. There are no SMTP credentials, so no email
  has ever been sent and Phase 5 is blocked on that.
- **Zero commits** exist; every file is untracked, so `git diff` / `git stash` show nothing.
  Don't `git init` either: `C:\Users\badrf` is already a git worktree and this folder is its
  own nested repo.
