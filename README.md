# Weekly Synthetic Data Research Agent

Collects seven days of synthetic-data content from 18 sources across 6 collectors —
arXiv, Google News, research blogs, Reddit, Hacker News and GitHub (27 HTTP requests
per run) — then renders a weekly report for the Well7 team.

**The collection half is automated. Ranking, summarising and sending are not.**
`main.py` collects, dedupes, filters against history and prints/saves raw items.
Everything after that is a script you run by hand, with a human writing
`source.yaml`. This README is honest about where that line is.

- Design notes and gotchas for coding agents: [`AGENTS.md`](AGENTS.md)
- Why each source is on the list: [`docs/sources.md`](docs/sources.md)
- What works, what does not, what is next: [`docs/one-page-note.md`](docs/one-page-note.md)
- Everything produced so far: [`progress/README.md`](progress/README.md)

## Requirements

- Python 3.13
- [uv](https://docs.astral.sh/uv/) (recommended) or plain pip
- Windows PowerShell 5.1 is what this was built on; nothing is Windows-specific
  except the notes below about `python` not being on `PATH`.

## Setup

```powershell
uv sync                          # runtime + dev dependencies into .venv
```

Or, for a machine that only runs the job:

```powershell
pip install -r requirements.txt  # runtime only, no notebooks or SDV
```

`requirements.txt` is generated from `uv.lock`. Nothing enforces that, so regenerate
it after any dependency change:

```powershell
uv export --no-hashes --no-dev -o requirements.txt
```

## Run it

Every command below assumes the venv is active. On the original machine `python` is
not on `PATH`, so the working forms are `uv run python …` or
`.venv\Scripts\python.exe …`.

```powershell
uv run python main.py                    # every source → raw_items.json + raw_run_log.json
uv run python main.py --source arxiv --limit 5 --no-save    # one source, nothing written
```

`--source` takes *collector* names — `arxiv`, `news`, `blog`, `reddit`, `hn`,
`github` — not the `config.yaml` keys (`google_news`, `blogs`, `hacker_news` would
match nothing and exit 1).

The weekly pipeline, in order:

```powershell
uv run python main.py
uv run python fetch_candidates.py        # full text of the shortlist → candidates.json
#   → a human writes progress/week-<week_end>/source.yaml  ← the manual step
uv run python report_build.py progress/week-2026-11-01/source.yaml
uv run python verify_report.py
```

| Script | What it does | Writes |
|---|---|---|
| `main.py` | Collects, normalises, dedupes, drops already-published URLs | `raw_items.json`, `raw_run_log.json` |
| `fetch_candidates.py` | Resolves redirects, extracts full article text | `candidates.json` |
| `report_build.py` | Verifies every link, drops dead ones, renders, records published URLs | `report.md`, `report.html`, PDF, `run_log.json`, appends to `history.db` |
| `verify_report.py` | Checks the rendered report against the brief | exit code only |
| `selftest.py` | Offline unit tests for parsing, dates, dedupe, history | exit code only |
| `feed_health.py` | Checks all 13 blog feeds are alive | stdout |
| `validate_phase1.py` | Validates window and dedupe in an existing `raw_items.json` | stdout |

## Configuration

Everything tunable lives in `config.yaml`, never in the collectors.

| Key | Meaning |
|---|---|
| `schedule` | Intended cadence. Documentation only — nothing reads it yet. |
| `lookback_days` | How far back an item may be published. Default 7. Read by every collector. |
| `max_top_picks` | Intended cap on picks. Documentation only — the 5–10 bound is hard-coded in `verify_report.py`. |
| `recipients` | Who the report goes to once email exists. Nothing reads it yet. |
| `keywords` | The Phase 0 vocabulary, for reference. Collectors search each source's own `queries` / `tags` / `subreddits`. |
| `sources.*` | Per-source queries, subreddits, feeds and result caps. |

The honest reading of that table: only `lookback_days` and `sources.*` change
behaviour today. The other four keys are intent recorded in config.

Secrets do not live in `config.yaml`. Copy `.env.example` to `.env` and fill it in;
`.env` is git-ignored and does not currently exist, which is why nothing has ever
been emailed.

## Outputs

```
raw_items.json                     every surviving item this run
raw_run_log.json                   found / duplicates / already_sent / kept / errors
candidates.json                    full text of the shortlist
history.db                         URLs already published, so no link repeats
progress/week-<week_end>/
  source.yaml                      curated content — written by a human
  report.md                        email body, spec format
  report.html                      same content, rendered
  Synthetic_Data_Weekly_<date>.pdf glossary first, then the report
  run_log.json                     counts for the run that produced the report
```

`history.db` is how "no link in two different weeks" is enforced: `collect_all`
filters against it, `report_build.py` records the published URLs after a successful
render. Delete it to replay a week from scratch.

## What it does not do yet

- **No scoring or ranking.** No LLM client is wired; the picks in `source.yaml` are
  chosen by hand.
- **No automatic summaries.** Full text is fetched, but the prose is written by a
  human from `candidates.json`.
- **No email.** There are no SMTP credentials, so nothing has been sent.
- **No schedule.** The Saturday 08:00 cadence is a config string, not a running job.
- **`fetch_candidates.py` has a hard-coded shortlist** (`PICKS`) from the first week.
  That is the next thing to replace with a ranked input.

## Gotchas

- **Hacker News returns HTTP 419** to non-browser clients. That is not a dead link —
  `links._check_hacker_news` verifies through the Algolia API on purpose.
- **Google News RSS links are opaque redirects.** They return 200 for anyone, so a
  status check proves nothing; `links.resolve_google_news` unwraps them through
  Google's `batchexecute` RPC.
- **Reddit rate-limits to about one request per minute per IP.** The collector backs
  off 15/30/45 s. A second full run inside a minute stalls ~90 s — that is backoff,
  not a hang.
- **arXiv announces nothing Friday or Saturday.** Most weeks end with a date gap.
- **`report_build.py` exits 1 when it dropped dead links.** That is a successful
  render of a filtered report, not a crash.

## Tests

There is no pytest, linter or CI. The suite is two scripts that exit non-zero on
failure:

```powershell
uv run python selftest.py       # offline: parsing, dates, URL normalisation, dedupe, history
uv run python verify_report.py  # structural: subject, section order, counts, dates, PDF
```
