# Plan — simulate Phase 6 without waiting two Saturdays (2026-11-18)

Approved by the user after a Spike review. Goal: exercise the two unattended-Saturday
acceptance path today, and document exactly what is and is not proven.

## Global constraints

- Repo: `C:\Users\badrf\Desktop\Work\synthetic data\.worktrees\main` (linked worktree on `main`).
- Python: `.venv\Scripts\python.exe`. Windows PowerShell 5.1.
- Nothing in this plan changes production code. Throwaway harnesses live in Temp or in
  the git-ignored SDD workspace.
- All mutable repo state must be restored after simulation: `progress/`, `raw_items.json`,
  `raw_run_log.json`, `candidates.json`, `summary_cache.json`, `score_cache.json`, `history.db`.
- The temporary scheduler task must be dry-run (no `-Send`), must be deleted at the end,
  and the real `SyntheticDataWeekly` task must be verified untouched.
- Simulated weeks: run_date 2026-11-21 → week 2026-11-14..20; run_date 2026-11-28 →
  week 2026-11-21..27.
- No real email to the 5 recipients. No push. No changes to tracked files except the
  final documentation deliverable in Task 3.

## Task 1 — Graph time-travel simulation (A)

Run the compiled LangGraph twice with explicit `run_date` values and a stubbed model so
no LLM calls are made. Before running, back up all mutable repo state listed above.
Capture for each run: week bounds, folder created, items/ranked/report counts, errors,
email dry-run path, and surviving links. Verify the two weeks do not overlap and that
`history.db` dedupe behaves across them. Restore all mutable state afterwards. Write the
evidence to the workspace report file.

## Task 2 — Scheduler simulation (B)

Register a throwaway `SyntheticDataWeeklySim` task in dry-run mode, scheduled ~2 minutes
ahead or triggered with `schtasks /Run`, confirm it fires by a new `mode: dry-run` entry
in `logs/weekly.log` with exit 0 and a generated `email.eml`, then delete the temp task.
Re-query the real task and confirm it is still `Ready`, Saturday 08:00, `-Send`.
Back up and restore `logs/weekly.log` and any artefacts the sim writes.

## Task 3 — Document everything

Write `docs/phase-6-simulation.md` (tracked) with: the two probes, exact commands and
outputs, a pass/fail table, what each probe proves and what it cannot prove, and the
honest Phase 6 status. Commit it with a Conventional Commit. No other tracked changes.
