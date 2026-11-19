# Plan — cleanup and provable cleanliness (2026-11-18)

Goal: clean the repo and scratch state, then prove cleanliness with command output
that can be independently checked. Council reviews the result.

## Global constraints

- Repo: `C:\Users\badrf\Desktop\Work\synthetic data\.worktrees\main` (linked worktree on `main`).
- Python: `.venv\Scripts\python.exe`; Windows PowerShell 5.1.
- Do NOT delete `.env`, `.venv/`, `history.db`, caches or generated report artefacts —
  they are git-ignored runtime state, not dirt.
- Do NOT edit historical artefacts (`progress/phase-0-manual/`, the ranking design
  spec, `progress/phase-2-ranking/`) — those describe past states accurately.
- Both suites must exit 0: `selftest.py` (414) and `verify_report.py` (30).
- Conventional Commits; no push until the cleanup is reviewed.

## Task 1 — remove factual drift and dead code

1. `README.md`: badge and command comment say 394 selftests → 414. "27 HTTP requests"
   → replace with the measured breakdown (3 arXiv + 2 Google News + 13 blog feeds +
   1 combined Reddit feed + 4 HN tags + 6 GitHub queries, plus bounded release checks).
   Fetch descriptions saying "top 10" → "top 7" (config `max_top_picks: 7`).
2. `docs/sources.md`: "12 keywords" → 22; "27 HTTP requests" → the same measured breakdown.
3. `docs/one-page-note.md`: "passes 394 checks" → 414.
4. `report_build.py`: delete the unused `source_errors()` helper; keep the
   `"source_errors": list(collected.get("errors") or [])` line in `main`.
5. Remove the empty `.superpowers/sdd/` directory left by the previous SDD run.
6. Add no new dependencies, files or behaviour. Commit once.

## Task 2 — proof (controller, no code changes)

Run and record: `git status --porcelain -uall`, `git diff --exit-code`, `git fsck --no-progress`,
`git clean -nd -x` (dry run), both test suites with exit codes and PASS counts,
SHA-256 of the contractual deliverables, and a final `git log`. Show all output.

## Parked

Moving recipients out of `config.yaml` and collection-time Google News resolution stay
out of scope (prior rulings). Live-network behaviour remains covered by test doubles.
