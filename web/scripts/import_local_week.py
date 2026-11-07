"""Import a rendered Python week into the LOCAL D1 database used by `npm run dev`.

The Python pipeline remains the source of truth (see web/README.md). This script
is the local counterpart of publish_to_cloudflare.py, which targets the deployed
Worker and is still a stub. It writes only the miniflare D1 state on this machine;
it does not contact Cloudflare, R2, or the network.

Usage (from repo root):
    .venv\\Scripts\\python.exe web/scripts/import_local_week.py progress/week-2026-11-06
    .venv\\Scripts\\python.exe web/scripts/import_local_week.py progress/week-2026-11-06 --dry-run
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import re
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import yaml

ROOT = Path(__file__).resolve().parents[2]
D1_GLOB = str(
    ROOT / "web" / ".wrangler" / "state" / "v3" / "d1"
    / "miniflare-D1DatabaseObject" / "*.sqlite"
)
SECTIONS = (("top_picks", "top"), ("tools", "tool"), ("worth_a_look", "worth"))


def normalize_url(raw: str) -> str:
    """Mirror worker/pipeline/sources.ts:184 so item IDs match the Worker's."""
    try:
        parts = urlsplit(raw)
        query = [
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if not (key.startswith("utm_") or key in ("ref", "source"))
        ]
        hostname = (parts.hostname or "").lower()
        netloc = hostname + (f":{parts.port}" if parts.port else "")
        path = parts.path
        if hostname.endswith("arxiv.org"):
            path = re.sub(r"v\d+$", "", path)
        out = urlunsplit(("https", netloc, path, urlencode(query), ""))
        return re.sub(r"/$", "", out)
    except Exception:
        return raw


def item_id(url: str) -> str:
    """Mirror worker/pipeline/index.ts:19 — SHA-256 of the normalized URL, 8 bytes."""
    return hashlib.sha256(normalize_url(url).encode("utf-8")).digest()[:8].hex()


def find_databases() -> list[Path]:
    found: list[Path] = []
    for raw in glob.glob(D1_GLOB):
        path = Path(raw)
        if path.name == "metadata.sqlite":
            continue
        try:
            con = sqlite3.connect(path)
            tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            count = con.execute("SELECT COUNT(*) FROM reports").fetchone()[0] if "reports" in tables else 0
            con.close()
            if count > 0:
                found.append(path)
        except sqlite3.Error:
            continue
    return found


def load_reasons() -> dict[str, str]:
    """ranked.json carries the scorer's one-line reasons; key them by normalized URL."""
    path = ROOT / "ranked.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    rows = data if isinstance(data, list) else next(
        (value for value in data.values() if isinstance(value, list)), []
    )
    reasons: dict[str, str] = {}
    for row in rows:
        if isinstance(row, dict) and row.get("url"):
            reasons[normalize_url(str(row["url"]))] = str(row.get("reason") or "")
    return reasons


def as_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def load_week(week_dir: Path) -> dict:
    source = week_dir / "source.yaml"
    if not source.is_file():
        raise SystemExit(f"no source.yaml in {week_dir}")
    data = yaml.safe_load(source.read_text(encoding="utf-8")) or {}
    week_end = as_text(data.get("week_end"))
    week_start = as_text(data.get("week_start"))
    if not week_end:
        raise SystemExit("source.yaml has no week_end")

    run_log_path = week_dir / "run_log.json"
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if run_log_path.is_file():
        try:
            created_at = json.loads(run_log_path.read_text(encoding="utf-8")).get("run_at", created_at)
        except (OSError, json.JSONDecodeError):
            pass

    try:
        start = date.fromisoformat(week_start)
        end = date.fromisoformat(week_end)
        subject = f"Synthetic Data Weekly — Week of {start.day} {start:%b} – {end.day} {end:%b %Y}"
    except ValueError:
        subject = f"Synthetic Data Weekly — Week ending {week_end}"

    reasons = load_reasons()
    items: list[tuple] = []
    for key, section in SECTIONS:
        for position, entry in enumerate(data.get(key) or [], start=1):
            title = as_text(entry.get("title") or entry.get("name"))
            url = as_text(entry.get("url"))
            if not title or not url:
                continue
            published = as_text(entry.get("published"))
            if published and "T" not in published:
                published += "T00:00:00Z"
            items.append((
                item_id(url),
                title,
                normalize_url(url),
                as_text(entry.get("source")),
                published,
                int(entry.get("score") or 0),
                int(entry["well7_fit"]) if entry.get("well7_fit") is not None else None,
                reasons.get(normalize_url(url), ""),
                as_text(entry.get("summary") or entry.get("note")),
                section,
                position,
            ))

    if not items:
        raise SystemExit("source.yaml produced no items — refusing to write an empty week")
    ids = [row[0] for row in items]
    if len(set(ids)) != len(ids):
        raise SystemExit("duplicate item IDs after URL normalisation — refusing to write")

    return {
        "report_id": f"week-{week_end}",
        "week_end": week_end,
        "subject": subject,
        "trend": as_text(data.get("trend")),
        "created_at": created_at,
        "items": items,
    }


def apply(db_path: Path, week: dict, dry_run: bool) -> None:
    print(f"  {db_path.name}: {len(week['items'])} items, scores "
          f"{min(r[5] for r in week['items'])}–{max(r[5] for r in week['items'])}"
          f"{' (dry run)' if dry_run else ''}")
    if dry_run:
        return
    con = sqlite3.connect(db_path, timeout=30)
    try:
        with con:
            con.execute(
                """INSERT INTO reports (id, week_end, subject, trend, created_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET week_end = excluded.week_end,
                     subject = excluded.subject, trend = excluded.trend,
                     created_at = excluded.created_at""",
                (week["report_id"], week["week_end"], week["subject"],
                 week["trend"], week["created_at"]),
            )
            con.execute("DELETE FROM items WHERE report_id = ?", (week["report_id"],))
            con.executemany(
                """INSERT INTO items
                   (id, report_id, title, url, source, published, score,
                    well7_fit, reason, summary, section, position)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (row[0], week["report_id"], *row[1:])
                    for row in week["items"]
                ],
            )
    finally:
        con.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("week_dir", type=Path, help="e.g. progress/week-2026-11-06")
    parser.add_argument("--dry-run", action="store_true", help="print without writing")
    args = parser.parse_args()

    week_dir = args.week_dir if args.week_dir.is_absolute() else ROOT / args.week_dir
    week = load_week(week_dir)
    databases = find_databases()
    if not databases:
        raise SystemExit("no local D1 database with reports found — start `npm run dev` first")

    print(f"Importing {week_dir.name} -> {week['report_id']}")
    print(f"  subject: {week['subject']}")
    print(f"  trend:   {week['trend'][:80]}...")
    for db_path in databases:
        apply(db_path, week, args.dry_run)
    if not args.dry_run:
        print("Done. Reload the web app to see the change.")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as error:
        if error.code:
            print(f"error: {error}", file=sys.stderr)
        raise
