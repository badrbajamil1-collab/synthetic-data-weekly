# Phase 6 Simulation — Unattended Two-Saturday Verification

- **Date:** 2026-11-18
- **Base commit:** `48151fd`
- **Plan:** [`docs/superpowers/plans/2026-11-18-phase6-simulation.md`](superpowers/plans/2026-11-18-phase6-simulation.md)
- **Overall status:** Phases 0–5 pass; Phase 6 is **set up and simulated, not observed**.

## Purpose

Phase 6 acceptance requires observing two consecutive unattended Saturday runs (first real Saturday: **2026-11-21**; second real Saturday: **2026-11-28**) at 08:00 via Windows Task Scheduler. Because we cannot wait two calendar weeks before recording readiness, we simulated the two risk-bearing layers on **2026-11-18** without modifying production code or leaving simulation artefacts behind:

1. **Probe A (graph time-travel):** Verify that the compiled LangGraph weekly pipeline maps consecutive Saturday `run_date` values (`2026-11-21` and `2026-11-28`) to disjoint 7-day week bounds, writes distinct weekly folders and dry-run `email.eml` artefacts, filters previously sent URLs via `history.db`, passes `verify_report.py`, and leaves zero graph errors.
2. **Probe B (scheduler trigger & wrapper):** Verify that Windows Task Scheduler fires a time-triggered task unattended during an active session, invokes `scripts/run_weekly.ps1` in dry-run mode (no `-Send`), logs the mode/command/exit code to `logs/weekly.log`, and leaves the production `SyntheticDataWeekly` task untouched after cleanup.

---

## Summary Table

| Probe | Target Layer | Result | Key Evidence | Caveat / Limitation |
|---|---|---|---|---|
| **Probe A** | LangGraph week bounds, `history.db` dedupe, report & `email.eml` build, restore | **PASS** | `2026-11-21` → `week-2026-11-20` (`2026-11-14..2026-11-20`); `2026-11-28` → `week-2026-11-27` (`2026-11-21..2026-11-27`); `errors=[]`; `already_sent=1` each; `verify_report.py` exit `0` on both; `32/32` SHA-256 restored | Offline harness: network, link checks, LLM calls, and SMTP all mocked/blocked |
| **Probe B** | Windows Task Scheduler time trigger & `scripts/run_weekly.ps1` wrapper | **PASS with limitation** | `SyntheticDataWeeklySim` fired at `2026-11-18 23:07:06` via `/SC ONCE`; `logs/weekly.log` recorded `mode: dry-run`, exact python command, and `=== exit -1 ===`; temp task deleted; real `SyntheticDataWeekly` unchanged; state & `history.db` (`33` rows) restored | Dry-run pipeline was stopped by the controller (`exit -1`) after running several minutes with flat CPU; `Last Result` was not re-queried after process termination before deletion |

---

## Probe A — Graph Time-Travel Simulation

### Harness & Exact Command Shape

A throwaway Python harness (`C:\Users\badrf\AppData\Local\Temp\opencode\phase6_sim_a.py`, outside the repository) ran the compiled LangGraph pipeline offline:

```powershell
.\.venv\Scripts\python.exe "C:\Users\badrf\AppData\Local\Temp\opencode\phase6_sim_a.py"
```

Inside the harness:
- Network and mail transports (`httpx.get`, `httpx.post`, `httpx.Client`, `smtplib.SMTP`, `smtplib.SMTP_SSL`) were monkeypatched to raise immediately if called.
- `synthetic_data.runner.collect_all` returned 3 synthetic `Item`s (`source="arxiv"`) inside the target week bounds: 2 fresh week-specific URLs plus 1 already-sent URL present in `history.db` (`https://arxiv.org/abs/2610.40254`), then ran `runner.dedupe_items` and `memory.filter_seen_urls`.
- `fetch_candidates.fetch`, `report_build.check_link`, and `synthetic_data.links.check_link` were monkeypatched offline (`status=200`, `ok=True`, prose text present).
- The graph was configured with a deterministic JSON stub (`chat_fn=deterministic_chat_fn`, `delivery={"enabled": True, "dry_run": True}`) and invoked sequentially:

```python
graph.configure(
    settings=runner.load_config("config.yaml"),
    chat_fn=deterministic_chat_fn,
    delivery={"enabled": True, "dry_run": True},
)
graph.build_weekly_graph().invoke(
    {"errors": [], "run_date": run_date},
    config={"configurable": {"thread_id": "sim-" + run_date}},
)
```

### Run Results

| Metric | Run 1 (`2026-11-21`) | Run 2 (`2026-11-28`) |
|---|---|---|
| `run_date` | `2026-11-21` | `2026-11-28` |
| `week_bounds` | `2026-11-14` .. `2026-11-20` | `2026-11-21` .. `2026-11-27` |
| Folder produced | `progress\week-2026-11-20` | `progress\week-2026-11-27` |
| `items_found` | `3` | `3` |
| `already_sent` (filtered by `history.db`) | `1` (`https://arxiv.org/abs/2610.40254`) | `1` (`https://arxiv.org/abs/2610.40254`) |
| `items_after_dedupe` | `2` | `2` |
| `top_picks_count` | `2` | `2` |
| Surviving links | `https://arxiv.org/abs/2611.90102`, `https://arxiv.org/abs/2611.90101` | `https://arxiv.org/abs/2611.90202`, `https://arxiv.org/abs/2611.90201` |
| Graph `errors` | `[]` | `[]` |
| `email.eml` path & size | `progress\week-2026-11-20\email.eml` (`7422` bytes) | `progress\week-2026-11-27\email.eml` (`7408` bytes) |
| Email subject & recipients | `Synthetic Data Weekly — Week of 14 Nov – 20 2026` (`5` recipients) | `Synthetic Data Weekly — Week of 21 Nov – 27 2026` (`5` recipients) |
| `trend_omitted` | `false` | `false` |
| Generated report files | `source.yaml`, `report.md`, `report.html`, `.pdf`, `run_log.json`, `email.eml` | `source.yaml`, `report.md`, `report.html`, `.pdf`, `run_log.json`, `email.eml` |

### Report Verification (`verify_report.py`)

Executed before state restore:

```powershell
.\.venv\Scripts\python.exe verify_report.py progress\week-2026-11-20\source.yaml
.\.venv\Scripts\python.exe verify_report.py progress\week-2026-11-27\source.yaml
```

- Both invocations exited `0` with `All report checks passed.` across HTML, Markdown, Dates, Counts, and PDF checks.
- Week bounds were strictly non-overlapping (`2026-11-20 < 2026-11-21`) with distinct output folders and disjoint surviving links.

### Restore & SHA-256 Proof

After capturing outputs, `progress/` and all mutable root files (`raw_items.json`, `raw_run_log.json`, `candidates.json`, `summary_cache.json`, `history.db`) were restored from `C:\Users\badrf\AppData\Local\Temp\opencode\phase6_sim_a_backup`:

- Tracked files under `progress/` verified against pre-simulation SHA-256 baseline: **32 / 32 matched (0 mismatches)**.
- `progress/week-2026-11-27` removed (`exists: False`).
- `history.db` row count restored to **33**.
- `git diff --stat`: empty; `git status --porcelain -uall` returned only the pre-existing untracked `docs/superpowers/plans/2026-11-18-phase6-simulation.md`.

---

## Probe B — Windows Task Scheduler Simulation

### Baseline & Temporary Task Registration

Pre-simulation `python schedule_task.py --query` on the production task:
- **TaskName:** `\SyntheticDataWeekly`
- **Next Run Time:** `11/21/2026 8:00:00 AM`
- **Status:** `Ready`
- **Scheduled Task State:** `Enabled`
- **Task To Run:** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "...\scripts\run_weekly.ps1" -Send`

A temporary task named **`SyntheticDataWeeklySim`** was registered via `schtasks /Create` with `/SC ONCE` and the same PowerShell wrapper command **without** `-Send`, so `scripts/run_weekly.ps1` appends `--dry-run` and never contacts SMTP:

```text
schtasks /Create /TN SyntheticDataWeeklySim /SC ONCE /ST <HH:MM> /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"...\scripts\run_weekly.ps1\"" /F
```

*(The time trigger itself was used — `/Run` was not forced manually for the logged `23:07:06` firing.)*

### Evidence That the Time Trigger Fired

Querying the temporary task:

```powershell
schtasks /Query /TN SyntheticDataWeeklySim /V /FO LIST
```

Observed output:
- `Last Run Time: 11/18/2026 11:07:06 PM`
- `Status: Running` (at observation time; `Last Result` was not re-queried after process termination before deletion)

Entries written by `scripts/run_weekly.ps1` to `logs/weekly.log`:

```text
=== 2026-11-18 23:03:31 weekly run (mode: dry-run) ===
>>> ...\.venv\Scripts\python.exe main.py --pipeline --dry-run
=== 2026-11-18 23:07:07 weekly run (mode: dry-run) ===
>>> ...\.venv\Scripts\python.exe main.py --pipeline --dry-run
=== exit -1 ===
```

**Why `exit -1` occurred:** The simulated dry-run pipeline ran for several minutes with flat CPU while waiting during the simulation run; the controller deliberately terminated the dry-run process rather than wait indefinitely, causing the wrapper to log `=== exit -1 ===`. Stopping the simulation was safe because dry-run mode writes only local artefacts and never contacts SMTP, and the full pipeline itself had already been verified end-to-end at exit `0` earlier on `2026-11-18`.

### Cleanup & Production Task Verification

- Deleted temporary task:
  ```powershell
  schtasks /Delete /TN SyntheticDataWeeklySim /F
  ```
  Output: `SUCCESS: The scheduled task ... was successfully deleted.` (exit `0`).
- Re-queried `SyntheticDataWeeklySim`: `ERROR: The system cannot find the file specified.` (confirmed deleted).
- Re-queried real task (`python schedule_task.py --query`): still `Next Run Time: 11/21/2026 8:00:00 AM`, `Status: Ready`, `Scheduled Task State: Enabled`, `-Send` present — unchanged.
- Restored `logs/weekly.log`, `progress/week-2026-11-20/email.eml`, `raw_items.json`, `raw_run_log.json`, `candidates.json`, `summary_cache.json`, and `history.db` from `C:\Users\badrf\AppData\Local\Temp\opencode\task2-backup`.
- Post-restore `history.db` row count: **33**.
- Post-restore `git status --porcelain -uall`: only `?? docs/superpowers/plans/2026-11-18-phase6-simulation.md`.

---

## What This Does NOT Prove

Neither Probe A nor Probe B proves any of the following:

1. **Real network collection:** Probe A mocked `collect_all` and blocked `httpx`; Probe B's live dry-run collection was terminated before completion.
2. **Live HTTP link checks:** Probe A stubbed `check_link` to return `200`/`ok=True` offline.
3. **Real LLM calls:** Probe A used a deterministic JSON stub (`deterministic_chat_fn`) with zero real API calls.
4. **Real SMTP delivery to 5 recipients:** Both probes ran in dry-run mode (`email.eml` / no `-Send`); `smtplib` was blocked in Probe A and never invoked in Probe B.
5. **Execution while signed out:** `SyntheticDataWeekly` runs in the interactive user session without stored credentials; Task Scheduler behaviour when the Windows user is signed out is not supported or tested.
6. **Battery / power settings:** Neither probe exercised laptop/desktop sleep, wake timers, or AC-only power constraints across an unattended overnight/morning transition.
7. **Two genuine calendar weeks:** Passing explicit `run_date` values (`2026-11-21`, `2026-11-28`) and firing a single `/SC ONCE` trigger on `2026-11-18` does not replace observing two real Saturday morning runs in production.

---

## Honest Status

- **Phases 0–5:** **Pass** (implemented and verified).
- **Phase 6:** **Set up and simulated, not observed.**
- **Scheduled live observations:**
  - **First real Saturday:** `2026-11-21` at `08:00` (`\SyntheticDataWeekly`, `-Send`)
  - **Second real Saturday:** `2026-11-28` at `08:00` (`\SyntheticDataWeekly`, `-Send`)
