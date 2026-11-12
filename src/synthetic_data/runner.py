"""Phase 1 runner: collect every source, report counts, print raw items.

No LLM, no ranking, no email yet - this is the deliverable
"a script that prints all raw items found this week".
"""

import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import yaml

from synthetic_data import collectors, memory
from synthetic_data.links import normalize_url
from synthetic_data.models import Item
from synthetic_data.week import week_bounds

SOURCE_ORDER = ["arxiv", "news", "blog", "reddit", "hn", "github"]

SOURCE_LABELS = {
    "arxiv": "arXiv (research papers)",
    "news": "Google News RSS",
    "blog": "Blog RSS feeds",
    "reddit": "Reddit RSS",
    "hn": "Hacker News",
    "github": "GitHub repositories",
}

# A primary source is where the thing was published; Hacker News and Reddit
# are discussions of it. For the same URL the primary copy is the better
# report candidate even when the discussion is newer.
PRIMARY_SOURCES = frozenset({"arxiv", "github", "blog", "news"})

CollectorJob = Callable[[List[str]], List[Item]]


@dataclass
class CollectResult:
    """Everything one collection run produced, including what it threw away.

    The counts exist so the run log can report found / duplicate / already-sent
    honestly instead of inferring them from the survivors.
    """

    items: List[Item] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    counts: Dict[str, int] = field(default_factory=dict)
    warnings: Dict[str, List[str]] = field(default_factory=dict)
    found: int = 0
    duplicates: int = 0
    already_sent: int = 0


def _source_priority(item: Item) -> int:
    """0 for a primary source, 1 for a secondary one (or an unknown one)."""
    return 0 if item.source in PRIMARY_SOURCES else 1


def dedupe_items(items: List[Item]) -> Tuple[List[Item], int]:
    """Collapse URL variants (tracking params, arXiv versions) into one item.

    Within one normalised URL the copy that survives is the primary source -
    arxiv / github / blog / news - because that is the place the thing was
    published; a Hacker News or Reddit thread about it is the same story with
    less information. Two primaries (or two secondaries) collapse to the
    newest, as before.

    Returns the survivors newest-first plus how many were dropped.
    """
    groups: Dict[str, List[Item]] = {}
    for item in items:
        key = normalize_url(item.url) or item.url
        groups.setdefault(key, []).append(item)

    unique: List[Item] = []
    dropped = 0

    for bucket in groups.values():
        if len(bucket) == 1:
            unique.append(bucket[0])
            continue
        dropped += len(bucket) - 1
        ordered = sorted(bucket, key=lambda i: i.published, reverse=True)
        primary = next((i for i in ordered if _source_priority(i) == 0), None)
        unique.append(primary if primary is not None else ordered[0])

    unique.sort(key=lambda i: i.published, reverse=True)

    return unique, dropped


def load_config(path: str = "config.yaml") -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def build_collectors(
    config: dict,
    week: Optional[Tuple[date, date]] = None,
) -> List[Tuple[str, CollectorJob]]:
    """Map each configured source to a callable that accepts a warnings list.

    ``week`` is the fixed Sunday-Saturday reporting window; every job gets
    it so all six sources describe the same seven days. With no week the
    collectors fall back to ``lookback_days``.
    """
    sources = config.get("sources", {})
    lookback = int(config.get("lookback_days", 7))
    jobs: List[Tuple[str, CollectorJob]] = []

    arxiv_cfg = sources.get("arxiv")
    if arxiv_cfg:
        jobs.append((
            "arxiv",
            lambda warn, cfg=arxiv_cfg, week=week: collectors.fetch_arxiv(
                queries=cfg.get("queries") or ['"synthetic data"'],
                max_results=int(cfg.get("max_results", 25)),
                lookback_days=lookback,
                retry_attempts=int(cfg.get("retry_attempts", 3)),
                week=week,
                warnings=warn,
            ),
        ))

    news_cfg = sources.get("google_news")
    if news_cfg:
        jobs.append((
            "news",
            lambda warn, cfg=news_cfg, week=week: collectors.fetch_google_news(
                queries=cfg.get("queries") or ['"synthetic data" when:7d'],
                hl=cfg.get("hl", "en-US"),
                gl=cfg.get("gl", "US"),
                ceid=cfg.get("ceid", "US:en"),
                max_results=int(cfg.get("max_results", 20)),
                lookback_days=lookback,
                retry_attempts=int(cfg.get("retry_attempts", 3)),
                week=week,
                warnings=warn,
            ),
        ))

    blog_cfg = sources.get("blogs")
    if blog_cfg:
        jobs.append((
            "blog",
            lambda warn, cfg=blog_cfg, week=week: collectors.fetch_blogs(
                feeds=cfg.get("feeds") or [],
                max_per_feed=int(cfg.get("max_per_feed", 15)),
                lookback_days=lookback,
                retry_attempts=int(cfg.get("retry_attempts", 2)),
                week=week,
                warnings=warn,
            ),
        ))

    reddit_cfg = sources.get("reddit")
    if reddit_cfg:
        jobs.append((
            "reddit",
            lambda warn, cfg=reddit_cfg, week=week: collectors.fetch_reddit(
                subreddits=cfg.get("subreddits") or ["MachineLearning"],
                max_per_sub=int(cfg.get("max_per_sub", 25)),
                lookback_days=lookback,
                retry_attempts=int(cfg.get("retry_attempts", 4)),
                week=week,
                warnings=warn,
            ),
        ))

    hn_cfg = sources.get("hacker_news")
    if hn_cfg:
        jobs.append((
            "hn",
            lambda warn, cfg=hn_cfg, week=week: collectors.fetch_hacker_news(
                tags=cfg.get("tags") or ["synthetic data"],
                max_results=int(cfg.get("max_results", 15)),
                lookback_days=lookback,
                retry_attempts=int(cfg.get("retry_attempts", 3)),
                week=week,
                warnings=warn,
            ),
        ))

    github_cfg = sources.get("github")
    if github_cfg:
        jobs.append((
            "github",
            lambda warn, cfg=github_cfg, week=week: collectors.fetch_github_repos(
                queries=cfg.get("queries") or ["synthetic-data"],
                max_results=int(cfg.get("max_results", 15)),
                lookback_days=lookback,
                retry_attempts=int(cfg.get("retry_attempts", 3)),
                include_releases=bool(cfg.get("include_releases", False)),
                week=week,
                warnings=warn,
            ),
        ))

    return jobs


def collect_all(
    config: dict,
    only: Optional[List[str]] = None,
    use_history: bool = True,
    week: Optional[Tuple[date, date]] = None,
) -> CollectResult:
    """Collect every configured source for one fixed week.

    ``week`` defaults to the current Sunday-Saturday reporting week, so a
    run in the middle of the week and a run on the Saturday describe exactly
    the same seven days.
    """
    items: List[Item] = []
    errors: List[str] = []          # fatal: the whole source returned nothing
    warnings: Dict[str, List[str]] = {}  # partial: some feeds/queries failed
    counts: Dict[str, int] = {}

    if week is None:
        week = week_bounds()

    for name, job in build_collectors(config, week):
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

    found_count = len(items)
    unique, duplicates = dedupe_items(items)

    already_sent = 0
    if use_history:
        kept = memory.filter_seen_urls(unique)
        already_sent = len(unique) - len(kept)
        unique = kept

    return CollectResult(
        items=unique,
        errors=errors,
        counts=counts,
        warnings=warnings,
        found=found_count,
        duplicates=duplicates,
        already_sent=already_sent,
    )


def print_summary(result: CollectResult) -> None:
    counts, errors, warnings = result.counts, result.errors, result.warnings
    items = result.items

    failed = {err.split(":", 1)[0] for err in errors}
    print("\n=== RAW ITEM COUNT PER SOURCE ===")
    for name in SOURCE_ORDER:
        if name not in counts:
            continue
        status = "FAIL" if name in failed else ("warn" if name in warnings else "ok")
        print(f"  {SOURCE_LABELS.get(name, name):<26} {counts[name]:>4}  [{status}]")
    print(f"  {'TOTAL (raw)':<26} {result.found:>4}")
    print(f"  {'duplicates removed':<26} {result.duplicates:>4}")
    if result.already_sent:
        print(f"  {'already sent (history)':<26} {result.already_sent:>4}")
    print(f"  {'KEPT':<26} {len(items):>4}")

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
        print(f"\n... {len(items) - limit} more items not shown (use --limit 0 for every item)")


def save_items(items: List[Item], path: str = "raw_items.json") -> None:
    payload = [item.model_dump(mode="json") for item in items]
    Path(path).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nSaved {len(payload)} raw items -> {path}")
