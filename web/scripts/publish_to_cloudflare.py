"""Publish a rendered week into Cloudflare D1 + R2.

Usage (from repo root):
    uv run python web/scripts/publish_to_cloudflare.py progress/week-2026-11-01

Env:
    CF_WORKER_URL   e.g. https://synthetic-data-web.<account>.workers.dev
    CF_PUBLISH_TOKEN secret shared with the Worker
"""
import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: publish_to_cloudflare.py <week-dir>")
    week_dir = Path(sys.argv[1])
    if not week_dir.is_absolute():
        week_dir = ROOT / week_dir
    if not week_dir.is_dir():
        raise SystemExit(f"not a directory: {week_dir}")

    base = os.environ.get("CF_WORKER_URL", "").rstrip("/")
    token = os.environ.get("CF_PUBLISH_TOKEN", "")
    if not base or not token:
        raise SystemExit("set CF_WORKER_URL and CF_PUBLISH_TOKEN")

    # TODO: read source.yaml, report.md, report.html, PDF, run_log.json, ranked.json
    # TODO: upload PDF + HTML to R2 via Worker
    # TODO: POST report metadata + items + run to D1 via Worker
    print(f"would publish {week_dir} to {base}")
    print("not implemented yet")


if __name__ == "__main__":
    main()