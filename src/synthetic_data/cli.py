"""Command-line entry point (Phase 1 collector run).

Writes two files side by side: the collected items and a run log. The run log
is what `report_build.py` reads to report found / filtered / sent honestly.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from synthetic_data.runner import (
    CollectResult,
    collect_all,
    load_config,
    print_items,
    print_summary,
    save_items,
)


def write_run_log(result: CollectResult, path: Path) -> None:
    payload = {
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "counts": result.counts,
        "found": result.found,
        "duplicates": result.duplicates,
        "already_sent": result.already_sent,
        "kept": len(result.items),
        "errors": result.errors,
        "warnings": result.warnings,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved run log -> {path}")


def pipeline_exit_code(state: dict, *, no_email: bool = False) -> int:
    """0 when the weekly run produced its deliverable, 1 when it did not.

    The graph records degradation flags in ``state["errors"]`` and keeps going
    by design: a failed source, a thin ranking or an omitted trend must not
    stop the report. Those flags stay visible in the printed summary and in
    run_log.json, but only a missing report or a missing email is a failure.
    """
    report_ok = bool(state.get("report"))
    email = state.get("email") or {}
    delivery_ok = no_email or bool(email.get("dry_run")) or bool(email.get("sent"))
    return 0 if report_ok and delivery_ok else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Collect this week's synthetic-data items."
    )
    parser.add_argument("--config", default="config.yaml", help="path to config.yaml")
    parser.add_argument(
        "--source",
        action="append",
        default=None,
        help="limit to a source: arxiv, news, blog, reddit, hn, github (repeatable)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="print at most N items (0 = every item, the default)",
    )
    parser.add_argument(
        "--all", action="store_true", help="print every item (same as --limit 0)"
    )
    parser.add_argument("--json", default="raw_items.json", help="output JSON path")
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="print only; do not write raw_items.json or the run log",
    )
    parser.add_argument(
        "--pipeline",
        action="store_true",
        help="run the full LangGraph weekly pipeline (collect -> clean -> rank -> "
             "fetch -> report -> render -> send) instead of the collect-only print",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="with --pipeline: write progress/week-<date>/email.eml instead of "
             "sending; history.db is left untouched",
    )
    parser.add_argument(
        "--no-email",
        action="store_true",
        help="with --pipeline: stop after rendering; do not compose or send email",
    )
    args = parser.parse_args(argv)

    if args.pipeline:
        from synthetic_data import graph

        state = graph.weekly_run(
            args.config, dry_run=args.dry_run, send=not args.no_email
        )
        errors = list(state.get("errors") or [])
        print("\n=== PIPELINE RESULT ===")
        print(f"  raw items : {len(state.get('raw_items') or [])}")
        print(f"  ranked    : {len(state.get('ranked_items') or [])}")
        print(f"  report    : {'yes' if state.get('report') else 'no'}")
        email = state.get("email") or {}
        if args.no_email:
            print("  email     : skipped (--no-email)")
        elif email.get("dry_run"):
            print(f"  email     : dry run -> {email.get('path')}")
        elif email.get("sent"):
            print(f"  email     : sent to {len(email.get('recipients') or [])} recipient(s)")
        else:
            print("  email     : not sent")
        print(f"  errors    : {len(errors)}")
        for error in errors:
            print(f"    ! {error}")
        code = pipeline_exit_code(state, no_email=args.no_email)
        if code == 0 and errors:
            print("  status    : delivered with warnings (flagged, not failed)")
        elif code:
            print("  status    : deliverable missing - run failed")
        return code

    config = load_config(args.config)
    only = None
    if args.source:
        only = [s.strip().lower() for chunk in args.source for s in chunk.split(",")]

    result = collect_all(config, only=only)

    print_summary(result)
    # The Phase 1 deliverable is "prints all raw items found this week", so the
    # default is everything; --limit N is the opt-in cap.
    limit = None if (args.all or args.limit <= 0) else args.limit
    print_items(result.items, limit=limit)

    if not args.no_save:
        save_items(result.items, args.json)
        write_run_log(result, Path(args.json).parent / "raw_run_log.json")

    if not result.items:
        print("\nNo items collected - every source failed.", file=sys.stderr)
        return 1
    return 0
