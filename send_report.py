"""Phase 5 - email the rendered weekly report.

    uv run python send_report.py                         # newest report, real send
    uv run python send_report.py --dry-run               # write email.eml, send nothing
    uv run python send_report.py --test                  # one real send to DRY_RUN_RECIPIENT
    uv run python send_report.py progress/week-2026-11-05/source.yaml

Recipients come from ``config.yaml``. SMTP credentials come from ``.env``.
``--dry-run`` needs no credentials: it writes ``email.eml`` beside the report so
the HTML body, plain-text alternative and PDF attachment can be inspected.

A real send records the report's URLs in ``history.db`` (``--no-record`` opts
out). A dry run and a ``--test`` send never record, so neither can suppress the
real weekly email.
"""

import argparse
import sys
from pathlib import Path

from synthetic_data import emailer


def newest_report() -> str:
    found = sorted(Path("progress").glob("week-*/source.yaml"))
    if not found:
        raise SystemExit("no report found under progress/week-*/source.yaml")
    return str(found[-1])


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Email the weekly synthetic-data report.")
    parser.add_argument(
        "report",
        nargs="?",
        help="path to source.yaml (default: newest progress/week-*/source.yaml)",
    )
    parser.add_argument(
        "--config", default="config.yaml", help="path to config.yaml (recipients)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="write progress/week-<date>/email.eml instead of sending",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="send one real email to DRY_RUN_RECIPIENT (from .env) and record no history",
    )
    parser.add_argument(
        "--to",
        action="append",
        default=None,
        help="override recipients (repeatable); implied by --test",
    )
    parser.add_argument(
        "--no-record",
        action="store_true",
        help="do not mark the report's URLs as sent in history.db",
    )
    args = parser.parse_args(argv)

    report = args.report or newest_report()
    try:
        summary = emailer.deliver(
            report,
            args.config,
            dry_run=args.dry_run,
            test=args.test,
            to=args.to,
            record=not args.no_record,
        )
    except emailer.EmailError as exc:
        print(f"FAIL  email: {exc}", file=sys.stderr)
        return 1

    print(f"Subject: {summary['subject']}")
    print(f"Recipients ({len(summary['recipients'])}): {', '.join(summary['recipients'])}")
    print(f"PDF attached: {'yes' if summary['pdf_attached'] else 'no'}")
    if summary["dry_run"]:
        print(f"DRY RUN - wrote {summary['path']}; nothing was sent, history.db untouched")
    else:
        print(
            f"Sent via SMTP; {summary['urls_recorded']} new URL(s) recorded in history.db"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
