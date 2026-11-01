"""Build the weekly report: verify every link, then render Markdown + HTML.

Quality rule #1 is enforced here: a link that does not open never reaches the
report. Failures are dropped and logged, not silently kept.

Usage:
    python report_build.py progress/week-2026-11-01/source.yaml

Writes into progress/week-<week_end>/ so weeks never overwrite each other.
"""

import concurrent.futures
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

from synthetic_data.links import check_link
from synthetic_data.render import render_all_links, render_html, render_markdown, subject_line
from synthetic_data.render_pdf import render_pdf


def load_report(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def verify_links(report: dict) -> tuple:
    links = render_all_links(report)
    results = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(check_link, link["url"]): link for link in links}
        for future in concurrent.futures.as_completed(futures):
            link = futures[future]
            results[link["url"]] = future.result()

    dead = {url for url, result in results.items() if not result["ok"]}

    if dead:
        report = dict(report)
        report["top_picks"] = [p for p in report.get("top_picks", []) if p["url"] not in dead]
        report["tools"] = [t for t in report.get("tools", []) if t["url"] not in dead]
        report["worth_a_look"] = [
            i for i in report.get("worth_a_look", []) if i["url"] not in dead
        ]

    return report, results, dead


def source_errors() -> list:
    """Read the collector warnings recorded for this run, if any."""
    path = Path("raw_run_log.json")
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8")).get("errors", [])


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    path = argv[0] if argv else "reports/2026-11-01.yaml"
    report = load_report(path)

    print(f"Subject: {subject_line(report)}")
    print(f"Links to check: {len(render_all_links(report))}\n")

    report, results, dead = verify_links(report)

    for url, result in sorted(results.items(), key=lambda pair: str(pair[1]["status"])):
        mark = "ok  " if result["ok"] else "DEAD"
        note = result.get("note", "")
        print(f"  [{mark}] {str(result['status']):>12}  {url[:88]}{(' ' + note) if note else ''}")

    print()
    if dead:
        print(f"DROPPED {len(dead)} dead link(s) - they will not appear in the report.\n")

    markdown = render_markdown(report)
    html = render_html(report)

    # Everything a run produces lands in its own dated folder, so weeks never
    # overwrite each other and progress/ is the whole history.
    out_dir = Path("progress") / f"week-{report['week_end']}"
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "report.md").write_text(markdown, encoding="utf-8")
    (out_dir / "report.html").write_text(html, encoding="utf-8")

    pdf_path = out_dir / f"Synthetic_Data_Weekly_{report['week_end']}.pdf"
    render_pdf(report, str(pdf_path))
    print(f"Wrote {pdf_path}")

    raw = json.loads(Path("raw_items.json").read_text(encoding="utf-8"))
    candidates = Path("candidates.json")
    counts = {
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "items_found": len(raw),
        "items_after_dedupe": len(raw),
        "candidates_read": len(json.loads(candidates.read_text(encoding="utf-8")))
        if candidates.exists()
        else None,
        "top_picks": len(report.get("top_picks", [])),
        "tools": len(report.get("tools", [])),
        "worth_a_look": len(report.get("worth_a_look", [])),
        "links_checked": len(results),
        "links_dead": len(dead),
        "source_errors": source_errors(),
    }
    (out_dir / "run_log.json").write_text(json.dumps(counts, indent=2), encoding="utf-8")

    print(f"Wrote {out_dir}\\report.md, report.html, run_log.json")
    print(json.dumps(counts, indent=2))
    return 0 if not dead else 1


if __name__ == "__main__":
    raise SystemExit(main())
