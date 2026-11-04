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
    parser.add_argument("--limit", type=int, default=25, help="how many items to print")
    parser.add_argument("--all", action="store_true", help="print every item")
    parser.add_argument("--json", default="raw_items.json", help="output JSON path")
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="print only; do not write raw_items.json or the run log",
    )
    args = parser.parse_args(argv)

    config = load_config(args.config)
    only = None
    if args.source:
        only = [s.strip().lower() for chunk in args.source for s in chunk.split(",")]

    result = collect_all(config, only=only)

    print_summary(result)
    print_items(result.items, limit=None if args.all else args.limit)

    if not args.no_save:
        save_items(result.items, args.json)
        write_run_log(result, Path(args.json).parent / "raw_run_log.json")

    if not result.items:
        print("\nNo items collected - every source failed.", file=sys.stderr)
        return 1
    return 0
