"""Command-line entry point (Phase 1 collector run)."""

import argparse
import sys

from synthetic_data.runner import (
    collect_all,
    load_config,
    print_items,
    print_summary,
    save_items,
)


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
    parser.add_argument("--no-save", action="store_true", help="do not write the JSON file")
    args = parser.parse_args(argv)

    config = load_config(args.config)
    only = None
    if args.source:
        only = [s.strip().lower() for chunk in args.source for s in chunk.split(",")]

    items, errors, counts, warnings = collect_all(config, only=only)

    print_summary(counts, items, errors, warnings)
    print_items(items, limit=None if args.all else args.limit)

    if not args.no_save:
        save_items(items, args.json)

    if not items:
        print("\nNo items collected - every source failed.", file=sys.stderr)
        return 1
    return 0
