"""Build the weekly report: verify every link, then render Markdown + HTML.

Quality rule #1 is enforced here: a link that does not open never reaches the
report. Failures are dropped and logged, not silently kept.

Usage:
    python report_build.py progress/week-2026-11-01/source.yaml
    python report_build.py            # newest progress/week-*/source.yaml
    python report_build.py ... --no-record   # test render, leave history.db alone

Writes into progress/week-<week_end>/ so weeks never overwrite each other.
"""

import concurrent.futures
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yaml

from synthetic_data import memory
from synthetic_data.links import (
    check_link,
    is_google_news_redirect,
    normalize_url,
    resolve_google_news,
)
from synthetic_data.render import render_all_links, render_html, render_markdown, subject_line
from synthetic_data.render_pdf import render_pdf


def load_report(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def _unwrap_google_news_links(report: dict) -> dict:
    """Resolve any remaining Google News redirect URLs to original articles."""
    updated = dict(report)
    for section in ("top_picks", "tools", "worth_a_look"):
        entries = []
        for entry in report.get(section, []):
            item = dict(entry)
            url = item.get("url") or ""
            if is_google_news_redirect(url):
                resolved = resolve_google_news(url)
                if not is_google_news_redirect(resolved):
                    item["url"] = resolved
            entries.append(item)
        updated[section] = entries
    return updated


def _dedupe_report_urls(report: dict) -> dict:
    """Drop later entries whose URL duplicates an earlier entry across sections."""
    updated = dict(report)
    seen = set()
    for section in ("top_picks", "tools", "worth_a_look"):
        kept = []
        for entry in updated.get(section, []) or []:
            url = entry.get("url") or ""
            key = normalize_url(url) or url
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            kept.append(entry)
        updated[section] = kept
    return updated


def verify_links(report: dict) -> tuple:
    report = _dedupe_report_urls(_unwrap_google_news_links(report))
    links = render_all_links(report)
    results = {}

    to_check = []
    for link in links:
        if is_google_news_redirect(link["url"]):
            results[link["url"]] = {
                "status": "redirect",
                "ok": False,
                "note": "unresolved Google News redirect",
            }
        else:
            to_check.append(link)

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(check_link, link["url"]): link for link in to_check}
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


def load_run_log() -> dict:
    """The collector's own run log, if this report was built after a collect."""
    path = Path("raw_run_log.json")
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_score_floors(config_path: str = "config.yaml") -> dict:
    """Read section score floors from config.yaml, or fall back to defaults."""
    floors = {"top": 7, "tools": 6, "worth": 5}
    path = Path(config_path)
    if not path.exists():
        return floors
    try:
        cfg = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001
        return floors
    summ = cfg.get("summarising") or {}
    return {
        "top": int(summ.get("min_score_top", floors["top"])),
        "tools": int(summ.get("min_score_tools", floors["tools"])),
        "worth": int(summ.get("min_score_worth", floors["worth"])),
    }


def _has_why_it_matters(report: dict) -> bool:
    """True when the renderers had at least one why-line to emit.

    This is a capability flag, not a per-item claim: a partial model outage can
    leave some picks on the extractive fallback with no why-line. The verifier
    checks the rendered output and that at least one top pick carries the line,
    so one degraded item does not fail the whole report.
    """
    for section in ("top_picks", "tools", "worth_a_look"):
        for entry in report.get(section) or []:
            if isinstance(entry, dict) and (entry.get("why_it_matters") or "").strip():
                return True
    return False


def newest_report() -> str:
    """Default input: the newest week under progress/, same rule as verify_report."""
    found = sorted(Path("progress").glob("week-*/source.yaml"))
    if not found:
        raise SystemExit("no report found under progress/week-*/source.yaml")
    return str(found[-1])


def _week_mode(report: dict) -> str:
    """Label the week without mislabelling a historical replay.

    YAML written by the current pipeline says `run_date` explicitly. Older
    weeks have no key, so infer `replay` when the week start is not a Saturday:
    claiming `run_date` made the verifier fail a legitimate historical render.
    """
    declared = str(report.get("week_mode") or "").strip()
    if declared:
        return declared
    try:
        day = date.fromisoformat(str(report.get("week_start") or "")[:10])
    except ValueError:
        return "unknown"
    return "replay" if day.weekday() != 5 else "run_date"


def run_log_stale_reason(collected: dict, week_end: str) -> str:
    """Why `raw_run_log.json` does not describe `week_end`, or "" if it does.

    Rendering an older week from the current CWD used to inherit this run's
    collector counts. Newer logs carry `week_end`; older ones (and the
    collect-only CLI) do not, so their collection date is compared with the
    week being rendered instead.
    """
    if not isinstance(collected, dict):
        return "is not an object"
    logged_week = str(collected.get("week_end") or "")
    if logged_week:
        if logged_week == week_end:
            return ""
        return f"describes week ending {logged_week}, not {week_end}"
    run_at = str(collected.get("run_at") or "")
    if not run_at:
        return ""
    try:
        run_day = date.fromisoformat(run_at[:10])
        end_day = date.fromisoformat(week_end[:10])
    except ValueError:
        return "has no usable date"
    if end_day - timedelta(days=6) <= run_day <= end_day:
        return ""
    return f"was collected on {run_day}, outside {week_end}"


def main(argv=None) -> int:
    argv = list(argv if argv is not None else sys.argv[1:])
    record = "--no-record" not in argv
    argv = [argument for argument in argv if argument != "--no-record"]
    path = argv[0] if argv else newest_report()
    report = load_report(path)
    original_links = render_all_links(report)

    print(f"Subject: {subject_line(report)}")
    print(f"Links to check: {len(original_links)}\n")

    report, results, dead = verify_links(report)

    for url, result in sorted(results.items(), key=lambda pair: str(pair[1]["status"])):
        mark = "ok  " if result["ok"] else "DEAD"
        note = result.get("note", "")
        print(f"  [{mark}] {str(result['status']):>12}  {url[:88]}{(' ' + note) if note else ''}")

    print()
    if dead:
        print(f"DROPPED {len(dead)} dead link(s) - they will not appear in the report.\n")

    collected = load_run_log()
    week_end = str(report.get("week_end") or "")
    stale_reason = run_log_stale_reason(collected, week_end)
    if stale_reason:
        print(
            f"WARNING  raw_run_log.json {stale_reason}; "
            "its counts are ignored."
        )
        collected = {}

    out_dir = Path("progress") / f"week-{report['week_end']}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Persist the unwrapped, deduplicated, dead-link-filtered report to this
    # week's source.yaml before attaching runtime-only `source_counts`, so
    # emailer.deliver() reads and records the exact URLs published in the email.
    out_source = out_dir / "source.yaml"
    try:
        same_file = Path(path).resolve() == out_source.resolve()
    except OSError:
        same_file = False
    if not out_source.exists() or not same_file or render_all_links(report) != original_links:
        clean_report = {k: v for k, v in report.items() if k != "source_counts"}
        out_source.write_text(
            yaml.safe_dump(clean_report, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )

    report = dict(report)
    source_counts = dict(collected.get("counts") or {})
    report["source_counts"] = source_counts

    markdown = render_markdown(report)
    html = render_html(report)

    (out_dir / "report.md").write_text(markdown, encoding="utf-8")
    (out_dir / "report.html").write_text(html, encoding="utf-8")

    pdf_path = out_dir / f"Synthetic_Data_Weekly_{report['week_end']}.pdf"
    render_pdf(report, str(pdf_path))
    print(f"Wrote {pdf_path}")

    # These URLs are now published. Record them so next week's run drops them
    # before ranking ever sees them (spec rule: no link in two different weeks).
    # A test render passes --no-record so it cannot suppress items it never sent.
    published = render_all_links(report)
    if record:
        newly_recorded = memory.mark_sent(
            [(link["url"], link["label"], "") for link in published]
        )
        print(f"Recorded {newly_recorded} new URL(s) in history.db")
    else:
        newly_recorded = 0
        print("--no-record: history.db untouched (test render)")

    raw_path = Path("raw_items.json")
    raw = json.loads(raw_path.read_text(encoding="utf-8")) if raw_path.exists() else []
    candidates = Path("candidates.json")
    candidates_read = None
    if candidates.exists():
        try:
            parsed_candidates = json.loads(candidates.read_text(encoding="utf-8"))
        except ValueError:
            parsed_candidates = None
        if isinstance(parsed_candidates, dict):
            candidates_read = len(parsed_candidates)
    raw_warnings = collected.get("warnings")
    source_warnings = (
        dict(raw_warnings) if isinstance(raw_warnings, dict) else (raw_warnings or {})
    )
    run_log_path = out_dir / "run_log.json"
    existing_email = None
    if run_log_path.exists():
        try:
            existing_log = json.loads(run_log_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            existing_log = None
        if isinstance(existing_log, dict) and existing_log.get("email") is not None:
            existing_email = existing_log["email"]
    counts = {
        "schema": "2026-11-11",
        "week_mode": _week_mode(report),
        "week_start": str(report.get("week_start") or ""),
        "week_end": str(report.get("week_end") or ""),
        "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "items_found": collected.get("found", len(raw)),
        "items_after_dedupe": collected.get("kept", len(raw)),
        "duplicates_removed": collected.get("duplicates"),
        "already_sent": collected.get("already_sent"),
        "candidates_read": candidates_read,
        "top_picks": len(report.get("top_picks", [])),
        "tools": len(report.get("tools", [])),
        "worth_a_look": len(report.get("worth_a_look", [])),
        "dropped_below_floor": int(report.get("dropped_below_floor") or 0),
        "trend_omitted": not (report.get("trend") or "").strip(),
        "score_floors": load_score_floors(),
        "source_counts": source_counts,
        "why_it_matters": _has_why_it_matters(report),
        "links_checked": len(results),
        "links_dead": len(dead),
        "history_recorded": record,
        "urls_recorded": newly_recorded,
        "source_errors": list(collected.get("errors") or []),
        "source_warnings": source_warnings,
    }
    if existing_email is not None:
        counts["email"] = existing_email
    run_log_path.write_text(json.dumps(counts, indent=2), encoding="utf-8")

    print(f"Wrote {out_dir}\\report.md, report.html, run_log.json")
    print(json.dumps(counts, indent=2))
    return 0 if not dead else 1


if __name__ == "__main__":
    raise SystemExit(main())
