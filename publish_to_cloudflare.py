"""Publish a rendered weekly report (+ PDF) to the Cloudflare Workers web archive.

Usage:
    uv run python publish_to_cloudflare.py                              # newest week
    uv run python publish_to_cloudflare.py progress/week-2026-11-20     # specific folder or source.yaml
    uv run python publish_to_cloudflare.py --dry-run                    # validate payload only
    uv run python publish_to_cloudflare.py --optional                   # exit 0 if token is unset

Environment (process env first, .env fallback):
    CF_PUBLISH_TOKEN / CRON_RUN_TOKEN   Bearer token accepted by POST /api/reports/publish
    CF_WORKER_URL                       Worker origin (default: https://synthetic-data-web.coolbadrtv1.workers.dev)
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import yaml

from synthetic_data import llm, render
from synthetic_data.links import normalize_url

DEFAULT_WORKER_URL = "https://synthetic-data-web.coolbadrtv1.workers.dev"
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
SECTIONS = (
    ("top_picks", "top", "title", "summary"),
    ("tools", "tool", "name", "note"),
    ("worth_a_look", "worth", "title", "note"),
)


def newest_source() -> Path:
    found = sorted(Path("progress").glob("week-*/source.yaml"))
    if not found:
        raise SystemExit("no report found under progress/week-*/source.yaml")
    return found[-1]


def resolve_source_path(target: Optional[str]) -> Path:
    if not target:
        return newest_source()
    path = Path(target)
    if path.is_dir():
        path = path / "source.yaml"
    if not path.is_file():
        raise SystemExit(f"source.yaml not found at {path}")
    return path


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value).strip()


def _load_ranked_meta(ranked_path: Path = Path("ranked.json")) -> Dict[str, Dict[str, Any]]:
    if not ranked_path.is_file():
        return {}
    try:
        rows = json.loads(ranked_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(rows, list):
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if isinstance(row, dict) and row.get("url"):
            key = normalize_url(str(row["url"])) or str(row["url"])
            out[key] = row
    return out


def build_payload(
    source_path: Path,
    *,
    ranked_path: Path = Path("ranked.json"),
    include_pdf: bool = True,
) -> Dict[str, Any]:
    report = yaml.safe_load(source_path.read_text(encoding="utf-8")) or {}
    week_end = _as_text(report.get("week_end"))
    if not week_end:
        raise ValueError(f"{source_path} has no week_end")

    week_dir = source_path.parent
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run_log_path = week_dir / "run_log.json"
    if run_log_path.is_file():
        try:
            log = json.loads(run_log_path.read_text(encoding="utf-8"))
            if isinstance(log, dict) and log.get("run_at"):
                created_at = str(log["run_at"])
        except (OSError, ValueError):
            pass

    ranked_meta = _load_ranked_meta(ranked_path)
    items: List[Dict[str, Any]] = []
    seen_urls: set[str] = set()
    for yaml_key, section, title_key, body_key in SECTIONS:
        pos = 0
        for entry in report.get(yaml_key) or []:
            if not isinstance(entry, dict):
                continue
            title = _as_text(entry.get(title_key) or entry.get("title") or entry.get("name"))
            url = _as_text(entry.get("url"))
            if not title or not url:
                continue
            norm = normalize_url(url) or url
            if norm in seen_urls:
                continue
            seen_urls.add(norm)
            pos += 1
            published = _as_text(entry.get("published")) or week_end
            if "T" not in published:
                published = f"{published}T00:00:00Z"
            meta = ranked_meta.get(norm, {})
            reason = _as_text(entry.get("why_it_matters")) or _as_text(meta.get("reason"))
            raw_score = entry.get("score") if entry.get("score") is not None else meta.get("score")
            raw_fit = entry.get("well7_fit") if entry.get("well7_fit") is not None else meta.get("well7_fit")
            items.append(
                {
                    "title": title,
                    "url": url,
                    "source": _as_text(entry.get("source")) or "web",
                    "published": published,
                    "score": int(raw_score or 0),
                    "well7_fit": int(raw_fit) if raw_fit is not None else None,
                    "reason": reason,
                    "summary": _as_text(entry.get(body_key) or entry.get("summary") or entry.get("note")),
                    "section": section,
                    "position": pos,
                }
            )

    if not items:
        raise ValueError(f"{source_path} produced 0 items; refusing to publish an empty week")

    payload: Dict[str, Any] = {
        "id": f"week-{week_end}",
        "week_end": week_end,
        "subject": render.subject_line(report),
        "trend": _as_text(report.get("trend")),
        "created_at": created_at,
        "items": items,
    }

    if include_pdf:
        pdf_path = week_dir / f"Synthetic_Data_Weekly_{week_end}.pdf"
        if pdf_path.is_file():
            raw_pdf = pdf_path.read_bytes()
            if raw_pdf[:5] == b"%PDF-":
                payload["pdf_base64"] = base64.b64encode(raw_pdf).decode("ascii")

    return payload


def _retry_delay(response, fallback: float, cap: float = 30.0) -> float:
    """Honour a numeric Retry-After header when present, capped at `cap` seconds."""
    headers = getattr(response, "headers", None)
    if headers is not None and hasattr(headers, "get"):
        raw = headers.get("Retry-After")
        if raw is None:
            raw = headers.get("retry-after")
        if raw is not None:
            try:
                seconds = float(str(raw).strip())
                if seconds > 0:
                    return min(seconds, cap)
            except (ValueError, TypeError):
                pass
    return fallback


def publish(
    payload: Dict[str, Any],
    *,
    base_url: str,
    token: str,
    timeout: float = 45.0,
    attempts: int = 3,
    base_delay: float = 3.0,
    post_fn=None,
    sleep=time.sleep,
) -> Dict[str, Any]:
    endpoint = base_url.rstrip("/") + "/api/reports/publish"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    sender = post_fn or httpx.post
    total_attempts = max(1, int(attempts))
    for attempt in range(total_attempts):
        try:
            response = sender(endpoint, headers=headers, json=payload, timeout=timeout)
        except httpx.HTTPError:
            if attempt < total_attempts - 1:
                sleep(base_delay * (attempt + 1))
                continue
            raise
        if response.status_code == 200:
            return response.json()
        if response.status_code in RETRY_STATUSES and attempt < total_attempts - 1:
            sleep(_retry_delay(response, base_delay * (attempt + 1)))
            continue
        raise RuntimeError(f"publish failed (HTTP {response.status_code}): {response.text[:240]}")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Publish a weekly report to Cloudflare Workers.")
    parser.add_argument("target", nargs="?", help="week directory or source.yaml (default: newest)")
    parser.add_argument("--url", default="", help="override Cloudflare Worker base URL")
    parser.add_argument("--dry-run", action="store_true", help="build and print summary without POSTing")
    parser.add_argument("--no-pdf", action="store_true", help="skip uploading the PDF to R2")
    parser.add_argument(
        "--optional",
        action="store_true",
        help="exit 0 instead of 1 when CF_PUBLISH_TOKEN / CRON_RUN_TOKEN is unset",
    )
    args = parser.parse_args(argv)

    env = llm.load_env()
    base_url = (args.url or env.get("CF_WORKER_URL") or DEFAULT_WORKER_URL).strip()
    token = (env.get("CF_PUBLISH_TOKEN") or env.get("CRON_RUN_TOKEN") or "").strip()

    source_path = resolve_source_path(args.target)
    payload = build_payload(source_path, include_pdf=not args.no_pdf)
    pdf_bytes = len(base64.b64decode(payload["pdf_base64"])) if payload.get("pdf_base64") else 0

    print(f"Report : {payload['id']} ({len(payload['items'])} items, pdf={pdf_bytes} bytes)")
    print(f"Subject: {payload['subject']}")
    print(f"Target : {base_url.rstrip('/')}/api/reports/publish")

    if args.dry_run:
        print("DRY RUN - payload validated; nothing uploaded.")
        return 0

    if not token:
        msg = "CF_PUBLISH_TOKEN / CRON_RUN_TOKEN is not set; skipping Cloudflare publish."
        if args.optional:
            print(msg)
            return 0
        print(f"FAIL  {msg}", file=sys.stderr)
        return 1

    try:
        result = publish(payload, base_url=base_url, token=token)
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL  {exc}", file=sys.stderr)
        return 1

    print(f"Published -> {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
