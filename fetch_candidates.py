"""Fetch and extract the full text of the ranked shortlist (Phase 3 input).

Reads ranked.json (written by rank_items.py), resolves Google News redirects and
stores the real page text so summaries can only be written from what the page
actually says.

This used to carry a hard-coded PICKS list of twenty titles from week one. That
list is gone: the shortlist now comes from the ranking step.
"""

import concurrent.futures
import json
import re
import sys
from pathlib import Path

import httpx
import trafilatura
import yaml

from synthetic_data.links import UA, normalize_url, resolve_google_news

RANKED = "ranked.json"
OUT = "candidates.json"


def load_shortlist(path=RANKED, config_path="config.yaml"):
    """Return the ranked, non-duplicate, scored rows, capped at max_top_picks."""
    file = Path(path)
    if not file.exists():
        raise SystemExit(f"FAIL  {path} not found - run `uv run python rank_items.py` first")

    rows = json.loads(file.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise SystemExit(f"FAIL  {path} is not a list of ranked items")

    scored = [
        row for row in rows
        if row.get("score_status") == "scored" and not row.get("duplicate_of")
    ]

    config = {}
    config_file = Path(config_path)
    if config_file.exists():
        config = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}

    minimum = int((config.get("ranking") or {}).get("min_scored_to_proceed", 5))
    if len(scored) < minimum:
        # A stale candidates.json would be read by report_build.py as if it were
        # this week's, so remove it rather than leave a trap behind.
        stale = Path(OUT)
        if stale.exists():
            stale.unlink()
            print(f"removed stale {OUT}")
        raise SystemExit(
            f"FAIL  only {len(scored)} scored items (need {minimum}). "
            "Re-run rank_items.py; nothing was fetched."
        )

    top_n = int(config.get("max_top_picks", 10))
    return scored[:top_n]


GITHUB_REPO = re.compile(r"^https?://github\.com/([^/\s]+)/([^/?#\s]+)/?$")


def fetch_github_readme(url):
    """README text for a repo root, or "" when this is not one / it fails.

    A repo page rendered as HTML is mostly navigation: trafilatura returns
    "GitHub - owner/repo: ... You signed in with another tab" for some repos,
    which is useless as summary evidence. The API serves the README itself.
    """
    match = GITHUB_REPO.match(url or "")
    if not match:
        return ""
    owner, repo = match.groups()
    headers = dict(UA)
    headers["Accept"] = "application/vnd.github.raw"
    try:
        response = httpx.get(
            f"https://api.github.com/repos/{owner}/{repo}/readme",
            headers=headers,
            timeout=35.0,
            follow_redirects=True,
        )
    except httpx.HTTPError:
        return ""
    if response.status_code != 200:
        return ""
    return response.text.strip()


def fetch(record):
    resolved = resolve_google_news(record["url"])
    out = {
        "title": record.get("title", ""),
        "source": record.get("source", ""),
        "published": record.get("published", ""),
        "score": record.get("score"),
        "well7_fit": record.get("well7_fit"),
        "reason": record.get("reason", ""),
        # Kept so write_report.py can still summarise an item whose page blocks
        # fetching (Hacker News answers 419 to non-browser clients).
        "snippet": record.get("snippet", ""),
        "feed_url": record.get("url", ""),
        "url": resolved,
        "normalized": normalize_url(resolved),
        "status": None,
        "fetched_from": "none",
        "chars": 0,
        "text": "",
    }

    readme = fetch_github_readme(resolved)
    if readme:
        out["status"] = 200
        out["fetched_from"] = "github readme"
        out["chars"] = len(readme)
        out["text"] = re.sub(r"\n{3,}", "\n\n", readme)[:8000]
        return out

    try:
        response = httpx.get(resolved, headers=UA, timeout=35.0, follow_redirects=True)
        out["status"] = response.status_code
        out["fetched_from"] = "html"
        text = trafilatura.extract(response.text, include_comments=False) or ""
        out["chars"] = len(text)
        out["text"] = re.sub(r"\n{3,}", "\n\n", text)[:8000]
    except Exception as exc:  # noqa: BLE001
        out["status"] = f"ERR {type(exc).__name__}"
    return out


def main():
    shortlist = load_shortlist()
    print(f"Fetching full text for {len(shortlist)} ranked items")

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        records = list(pool.map(fetch, shortlist))

    print("\n=== SHORTLIST ===")
    for position, record in enumerate(records, start=1):
        print(
            f"{position:>2}. [{record['score']}/10] {str(record['status']):>4} "
            f"chars={record['chars']:>5}  {record['title'][:66]}"
        )
        if record["url"] != record["feed_url"]:
            print(f"      -> {record['url'][:110]}")

    Path(OUT).write_text(
        json.dumps(
            {record["url"]: record for record in records},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
