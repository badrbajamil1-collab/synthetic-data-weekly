"""Phase 1 runner: collect every source, report counts, print raw items.

No LLM, no ranking, no email yet - this is the deliverable
"a script that prints all raw items found this week".
"""

import json
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import yaml

from synthetic_data import collectors
from synthetic_data.models import Item

SOURCE_ORDER = ["arxiv", "news", "blog", "reddit", "hn", "github"]

SOURCE_LABELS = {
    "arxiv": "arXiv (research papers)",
    "news": "Google News RSS",
    "blog": "Blog RSS feeds",
    "reddit": "Reddit RSS",
    "hn": "Hacker News",
    "github": "GitHub repositories",
}

CollectorJob = Callable[[List[str]], List[Item]]


def load_config(path: str = "config.yaml") -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def build_collectors(config: dict) -> List[Tuple[str, CollectorJob]]:
    """Map each configured source to a callable that accepts a warnings list."""
    sources = config.get("sources", {})
    lookback = int(config.get("lookback_days", 7))
    jobs: List[Tuple[str, CollectorJob]] = []

    arxiv_cfg = sources.get("arxiv")
    if arxiv_cfg:
        jobs.append((
            "arxiv",
            lambda warn, cfg=arxiv_cfg: collectors.fetch_arxiv(
                queries=cfg.get("queries") or ['"synthetic data"'],
                max_results=int(cfg.get("max_results", 25)),
                lookback_days=lookback,
                warnings=warn,
            ),
        ))

    news_cfg = sources.get("google_news")
    if news_cfg:
        jobs.append((
            "news",
            lambda warn, cfg=news_cfg: collectors.fetch_google_news(
                queries=cfg.get("queries") or ['"synthetic data" when:7d'],
                hl=cfg.get("hl", "en-US"),
                gl=cfg.get("gl", "US"),
                ceid=cfg.get("ceid", "US:en"),
                max_results=int(cfg.get("max_results", 20)),
                lookback_days=lookback,
                warnings=warn,
            ),
        ))

    blog_cfg = sources.get("blogs")
    if blog_cfg:
        jobs.append((
            "blog",
            lambda warn, cfg=blog_cfg: collectors.fetch_blogs(
                feeds=cfg.get("feeds") or [],
                max_per_feed=int(cfg.get("max_per_feed", 15)),
                lookback_days=lookback,
                warnings=warn,
            ),
        ))

    reddit_cfg = sources.get("reddit")
    if reddit_cfg:
        jobs.append((
            "reddit",
            lambda warn, cfg=reddit_cfg: collectors.fetch_reddit(
                subreddits=cfg.get("subreddits") or ["MachineLearning"],
                max_per_sub=int(cfg.get("max_per_sub", 25)),
                lookback_days=lookback,
                retry_attempts=int(cfg.get("retry_attempts", 4)),
                warnings=warn,
            ),
        ))

    hn_cfg = sources.get("hacker_news")
    if hn_cfg:
        jobs.append((
            "hn",
            lambda warn, cfg=hn_cfg: collectors.fetch_hacker_news(
                tags=cfg.get("tags") or ["synthetic data"],
                max_results=int(cfg.get("max_results", 15)),
                lookback_days=lookback,
                warnings=warn,
            ),
        ))

    github_cfg = sources.get("github")
    if github_cfg:
        jobs.append((
            "github",
            lambda warn, cfg=github_cfg: collectors.fetch_github_repos(
                queries=cfg.get("queries") or ["synthetic-data"],
                max_results=int(cfg.get("max_results", 15)),
                lookback_days=lookback,
                warnings=warn,
            ),
        ))

    return jobs


def collect_all(
    config: dict,
    only: Optional[List[str]] = None,
) -> Tuple[List[Item], List[str], Dict[str, int], Dict[str, List[str]]]:
    items: List[Item] = []
    errors: List[str] = []          # fatal: the whole source returned nothing
    warnings: Dict[str, List[str]] = {}  # partial: some feeds/queries failed
    counts: Dict[str, int] = {}

    for name, job in build_collectors(config):
        if only and name not in only:
            continue
        source_warnings: List[str] = []
        try:
            found = job(source_warnings)
            counts[name] = len(found)
            items.extend(found)
        except Exception as exc:  # noqa: BLE001 - one source must not stop the run
            counts[name] = 0
            errors.append(f"{name}: {exc}")
        if source_warnings:
            warnings[name] = source_warnings

    # Exact-URL dedupe across sources (tracking-param normalisation is Phase 2).
    seen = set()
    unique: List[Item] = []
    for item in sorted(items, key=lambda i: i.published, reverse=True):
        if item.url in seen:
            continue
        seen.add(item.url)
        unique.append(item)

    return unique, errors, counts, warnings


def print_summary(
    counts: Dict[str, int],
    items: List[Item],
    errors: List[str],
    warnings: Dict[str, List[str]],
) -> None:
    failed = {err.split(":", 1)[0] for err in errors}
    print("\n=== RAW ITEM COUNT PER SOURCE ===")
    for name in SOURCE_ORDER:
        if name not in counts:
            continue
        status = "FAIL" if name in failed else ("warn" if name in warnings else "ok")
        print(f"  {SOURCE_LABELS.get(name, name):<26} {counts[name]:>4}  [{status}]")
    print(f"  {'TOTAL (after dedupe)':<26} {len(items):>4}")

    if errors:
        print("\n=== SOURCE FAILURES (run continues) ===")
        for err in errors:
            print(f"  ! {err}")

    if warnings:
        print("\n=== PARTIAL SOURCE WARNINGS ===")
        for name, notes in warnings.items():
            for note in notes:
                print(f"  ~ {name}: {note}")


def print_items(items: List[Item], limit: Optional[int] = None) -> None:
    print("\n=== RAW ITEMS (last 7 days) ===")
    shown = items if limit is None else items[:limit]
    for index, item in enumerate(shown, start=1):
        date = item.published.strftime("%Y-%m-%d")
        print(f"\n[{index:03d}] {date}  {item.source:<7} {item.title}")
        print(f"      {item.url}")
        if item.snippet:
            print(f"      {item.snippet[:160]}...")
    if limit is not None and len(items) > limit:
        print(f"\n... {len(items) - limit} more items not shown (use --all)")


def save_items(items: List[Item], path: str = "raw_items.json") -> None:
    payload = [item.model_dump(mode="json") for item in items]
    Path(path).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nSaved {len(payload)} raw items -> {path}")
