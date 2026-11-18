# Plan — audit fixes (2026-11-18)

Source: council audit of 2026-11-18, three reviewers, all high-impact claims
verified by offline probes. This plan implements the two agreed batches.

## Global constraints

- Repository: `C:\Users\badrf\Desktop\Work\synthetic data\.worktrees\main` (already a
  linked worktree). Python via `.venv\Scripts\python.exe`; no `python` on PATH.
- No test framework beyond `selftest.py` and `verify_report.py`. Both must exit 0.
  Current baseline: 375 selftests, 30 report checks.
- `report.md` / `report.html` / PDF format is contractual; do not restyle prose.
- Secrets stay in `.env` (git-ignored). Never add keys, recipients' addresses or
  passwords to tracked files beyond what is already there.
- Preserve all existing behaviour not named in a task; no opportunistic refactors.
- Every changed branch must be covered by a regression test in `selftest.py`.
- Commit each task separately with a Conventional Commits message. Do not push.

## Task 1 — Batch 1: publishability, evidence, ops, docs

Prevent a degraded report from being emailed, preserve send evidence, harden the
scheduler wrapper, and align stale documentation.

Files: `src/synthetic_data/graph.py`, `src/synthetic_data/cli.py`, `report_build.py`,
`scripts/run_weekly.ps1`, `.github/workflows/weekly-report.yml`, `README.md`,
`AGENTS.md`, `docs/one-page-note.md`, `progress/README.md`, `selftest.py`.

Requirements:

1. `render_node` must refuse to publish when `report` has no `top_picks` or no usable
   `week_end`. Treat `report_build` exit 1 as success only when some picks survive;
   if every link was dropped, clear `report` and record a render error so `send_node`
   and `pipeline_exit_code` cannot report success.
2. `rank_node` must short-circuit when `scored_count < min_scored_to_proceed`:
   return `ranked_items=[]` with the existing error, instead of continuing with
   unscored rows.
3. `report_node`'s `shortlist is None` fallback must apply the same
   `cap_github_share(...)[:cap]` and model-name fallback that the normal path uses.
4. `report_build.main` must preserve an existing `email` block in the week's
   `run_log.json` (it currently clobbers it), must copy collector `warnings` into
   `source_warnings`, and must use `collected.get("errors")` instead of re-reading a
   possibly stale `raw_run_log.json` through `source_errors()`.
5. `cli.pipeline_exit_code` must require at least one top pick, not just a non-empty
   report dict.
6. `scripts/run_weekly.ps1`: remove the `$ErrorActionPreference = "Stop"` hazard
   around the native `*>>` invocation (verified terminating on stderr in PS 5.1) and
   fix the stale comment claiming the task is registered in dry-run mode.
7. `.github/workflows/weekly-report.yml`: Python 3.13; run `selftest.py` before the
   pipeline and `verify_report.py` after; fix the `email.eml` artifact path; replace
   the wrong "05:00 UTC = 08:00 UTC+3" comment with the UTC+8 reality; document that
   only one scheduler may have live SMTP enabled.
8. Correct stale doc numbers and false claims: 30 report checks (not 22), 375
   selftests, 22 keywords, 7-pick cap, 1–10 pick bound, SMTP configured and real
   test send verified, task registered in real-send mode.
9. Add regression tests for 1–5 in `selftest.py`.

## Task 2 — Batch 2: correctness bugs proven by probes

Files: `src/synthetic_data/llm.py`, `src/synthetic_data/collectors.py`,
`src/synthetic_data/rank.py`, `src/synthetic_data/summarise.py`,
`src/synthetic_data/emailer.py`, `write_report.py`, `report_build.py`, `selftest.py`.

Requirements:

1. `llm.chat`: separate the transport-retry counter from the two free 400-field
   strips so `max_attempts: 2` still allows two transport retries after strips.
2. `collectors.get_with_retry`: catch `httpx.HTTPError` (timeouts, connection errors)
   and retry with the same backoff; re-raise on exhaustion.
3. `rank.group_duplicates`: put ineligible (`unscored`/`prefiltered`) rows last in
   `_grouping_order`, reset `duplicate_of` before grouping, and keep a deterministic
   title/url tie-break. A scored secondary must never be shadowed by an unscored primary.
4. `summarise.unsupported_numbers`: reject a token that is only a substring of a
   decimal (summary "5" vs source "10.5" currently passes).
5. `emailer.published_links`: return `[]` when `report.md` is missing, so history is
   never over-recorded.
6. `write_report.display_url`: prefer the display URL over the normalized dedupe key.
7. `collectors.fetch_github_repos` pass 2: do not skip an older repo whose `pushed_at`
   is after `week_end` if its release was inside the week; let
   `_github_release_in_window` decide.
8. `report_build.verify_links`: de-duplicate URLs after Google News unwrapping, and
   write the filtered/unwrapped report back to `source.yaml` so `emailer.deliver`
   records the link that actually appeared in the email.
9. Add regression tests for 1–8 in `selftest.py`.

Parked (ruled out of scope for this plan): moving recipients out of `config.yaml`
into `.env` (designated config location, privacy decision for the user); removing
`Auto-Submitted` (standard RFC 3834 header, no evidence of harm); cross-week dedupe
of opaque Google News URLs at collection time (needs a network-bearing design
decision). These are recorded in the ledger with rulings.
