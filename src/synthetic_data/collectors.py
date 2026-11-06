"""Phase 1 collectors.

Every collector returns the same shape (List[Item]) and enforces the 7-day
window client-side. The runner is responsible for catching exceptions so that
one broken source never blocks the report.
"""

import html
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional

import feedparser
import httpx

from synthetic_data.models import Item

HEADERS = {"User-Agent": "SyntheticDataResearchAgent/1.0 (weekly research digest)"}
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
}

_TAG_RE = re.compile(r"<[^>]+>")


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def cutoff_for(lookback_days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=lookback_days)


def _in_window(published: Optional[datetime], cutoff: datetime) -> bool:
    """True if the date is inside the lookback window.

    The upper bound rejects items dated in the future (scheduled posts and
    feeds with broken clocks), which would otherwise always pass the cutoff.
    """
    if published is None:
        return False
    return cutoff <= published <= datetime.now(timezone.utc) + timedelta(days=1)


def clean_text(raw: str, limit: int = 400) -> str:
    """Strip HTML tags and entities from feed snippets."""
    if not raw:
        return ""
    text = _TAG_RE.sub(" ", raw)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def parse_iso_or_utc(date_str: Optional[str]) -> Optional[datetime]:
    """Parse the ISO variants used by arXiv, HN and GitHub into aware UTC."""
    if not date_str:
        return None
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def entry_datetime(entry) -> Optional[datetime]:
    """Read a feedparser entry date (feedparser normalises these to UTC)."""
    for key in ("published_parsed", "updated_parsed"):
        parsed = entry.get(key)
        if parsed:
            try:
                return datetime(*parsed[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                continue
    return None


def get_with_retry(
    url: str,
    headers: dict,
    attempts: int = 3,
    base_delay: float = 6.0,
    timeout: float = 25.0,
) -> httpx.Response:
    """GET with exponential backoff for rate-limited endpoints (Reddit)."""
    last_status: Optional[int] = None
    for attempt in range(attempts):
        response = httpx.get(url, headers=headers, timeout=timeout, follow_redirects=True)
        if response.status_code == 200:
            return response
        last_status = response.status_code
        if response.status_code in (429, 500, 502, 503, 504) and attempt < attempts - 1:
            time.sleep(base_delay * (attempt + 1))
            continue
        response.raise_for_status()
    raise RuntimeError(f"HTTP {last_status} after {attempts} attempts: {url}")


def _dedupe(items: Iterable[Item]) -> List[Item]:
    seen = set()
    out = []
    for item in items:
        if item.url in seen:
            continue
        seen.add(item.url)
        out.append(item)
    return out


def _finish(items: List[Item], failures: List[str], warnings: Optional[List[str]]) -> List[Item]:
    """Record partial failures, then fail loudly only if nothing came back."""
    if warnings is not None:
        warnings.extend(failures)
    if failures and not items:
        raise RuntimeError("; ".join(failures))
    return _dedupe(sorted(items, key=lambda i: i.published, reverse=True))


# --------------------------------------------------------------------------
# 1. arXiv
# --------------------------------------------------------------------------

def fetch_arxiv(
    queries: Iterable[str] = ('"synthetic data"',),
    max_results: int = 25,
    lookback_days: int = 7,
    warnings: Optional[List[str]] = None,
) -> List[Item]:
    """Recent preprints from the arXiv Atom API, newest first."""
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    cutoff = cutoff_for(lookback_days)
    items: List[Item] = []
    failures = []

    for query in queries:
        encoded = urllib.parse.quote(f"all:{query}")
        url = (
            "https://export.arxiv.org/api/query"
            f"?search_query={encoded}&start=0&max_results={max_results}"
            "&sortBy=submittedDate&sortOrder=descending"
        )
        try:
            response = httpx.get(url, headers=HEADERS, timeout=25.0)
            response.raise_for_status()
            root = ET.fromstring(response.text)
        except Exception as exc:  # noqa: BLE001 - reported by the runner
            failures.append(f"arxiv query {query!r}: {exc}")
            continue

        for entry in root.findall("atom:entry", ns):
            published = parse_iso_or_utc(entry.findtext("atom:published", default="", namespaces=ns))
            if not _in_window(published, cutoff):
                continue
            link = entry.findtext("atom:id", default="", namespaces=ns).strip()
            if not link:
                continue
            items.append(
                Item(
                    title=clean_text(entry.findtext("atom:title", default="", namespaces=ns), 300),
                    url=link,
                    source="arxiv",
                    published=published,
                    snippet=clean_text(entry.findtext("atom:summary", default="", namespaces=ns), 400),
                )
            )

    return _finish(items, failures, warnings)


# --------------------------------------------------------------------------
# 2. Google News RSS
# --------------------------------------------------------------------------

def fetch_google_news(
    queries: Iterable[str] = ('"synthetic data" when:7d',),
    hl: str = "en-US",
    gl: str = "US",
    ceid: str = "US:en",
    max_results: int = 20,
    lookback_days: int = 7,
    warnings: Optional[List[str]] = None,
) -> List[Item]:
    """Google News RSS search. The `when:7d` operator is a hint only, so the
    date is enforced again client-side."""
    cutoff = cutoff_for(lookback_days)
    items: List[Item] = []
    failures = []

    for query in queries:
        encoded = urllib.parse.quote(query)
        url = (
            f"https://news.google.com/rss/search?q={encoded}"
            f"&hl={hl}&gl={gl}&ceid={ceid}"
        )
        try:
            feed = feedparser.parse(url, agent=HEADERS["User-Agent"])
        except Exception as exc:  # noqa: BLE001
            failures.append(f"google news {query!r}: {exc}")
            continue

        if getattr(feed, "bozo", False) and not feed.entries:
            failures.append(f"google news {query!r}: unparseable feed")
            continue

        for entry in feed.entries[:max_results]:
            published = entry_datetime(entry)
            if not _in_window(published, cutoff):
                continue
            link = entry.get("link", "").strip()
            if not link:
                continue
            items.append(
                Item(
                    title=clean_text(entry.get("title", ""), 300),
                    url=link,
                    source="news",
                    published=published,
                    snippet=clean_text(entry.get("summary", ""), 400),
                )
            )

    return _finish(items, failures, warnings)


# --------------------------------------------------------------------------
# 3. Reddit RSS
# --------------------------------------------------------------------------

def fetch_reddit(
    subreddits: Iterable[str] = ("MachineLearning",),
    max_per_sub: int = 25,
    lookback_days: int = 7,
    retry_attempts: int = 4,
    warnings: Optional[List[str]] = None,
) -> List[Item]:
    """Subreddit RSS.

    Reddit rate-limits per IP to roughly one request per minute, so all
    subreddits are fetched through a single multi-subreddit feed
    (r/A+B+C.rss) instead of one request each.
    """
    subs = [s.strip() for s in subreddits if s and s.strip()]
    if not subs:
        return []

    cutoff = cutoff_for(lookback_days)
    url = f"https://www.reddit.com/r/{'+'.join(subs)}.rss"
    failures: List[str] = []
    items: List[Item] = []

    try:
        response = get_with_retry(
            url, BROWSER_HEADERS, attempts=retry_attempts, base_delay=15.0
        )
        feed = feedparser.parse(response.content)
    except Exception as exc:  # noqa: BLE001
        failures.append(f"reddit r/{'+'.join(subs)}: {exc}")
        return _finish(items, failures, warnings)

    if not feed.entries:
        failures.append(f"reddit r/{'+'.join(subs)}: feed returned 0 entries")
        return _finish(items, failures, warnings)

    per_sub: dict = {}
    for entry in feed.entries:
        link = (entry.get("link") or "").strip()
        sub = link.split("/r/")[1].split("/")[0] if "/r/" in link else "unknown"
        if per_sub.get(sub, 0) >= max_per_sub:
            continue
        published = entry_datetime(entry)
        if not _in_window(published, cutoff):
            continue
        per_sub[sub] = per_sub.get(sub, 0) + 1
        items.append(
            Item(
                title=clean_text(entry.get("title", ""), 300),
                url=link,
                source="reddit",
                published=published,
                snippet=clean_text(entry.get("summary", ""), 400),
            )
        )

    return _finish(items, failures, warnings)


# --------------------------------------------------------------------------
# 4. Hacker News (Algolia)
# --------------------------------------------------------------------------

def fetch_hacker_news(
    tags: Iterable[str] = ("synthetic data",),
    max_results: int = 15,
    lookback_days: int = 7,
    warnings: Optional[List[str]] = None,
) -> List[Item]:
    """Community discussions via the HN Algolia API."""
    cutoff = cutoff_for(lookback_days)
    cutoff_ts = int(cutoff.timestamp())
    items: List[Item] = []
    failures = []

    for tag in tags:
        url = (
            "https://hn.algolia.com/api/v1/search_by_date"
            f"?query={urllib.parse.quote(tag)}&tags=(story,comment)"
            f"&numericFilters=created_at_i>{cutoff_ts}"
        )
        try:
            response = httpx.get(url, headers=HEADERS, timeout=25.0)
            response.raise_for_status()
            hits = response.json().get("hits", [])
        except Exception as exc:  # noqa: BLE001
            failures.append(f"hn {tag!r}: {exc}")
            continue

        for hit in hits[:max_results]:
            published = parse_iso_or_utc(hit.get("created_at"))
            if not _in_window(published, cutoff):
                continue
            object_id = hit.get("objectID", "")
            link = hit.get("url") or f"https://news.ycombinator.com/item?id={object_id}"
            if not link:
                continue
            items.append(
                Item(
                    title=clean_text(
                        hit.get("title") or hit.get("story_title") or "Hacker News discussion",
                        300,
                    ),
                    url=link,
                    source="hn",
                    published=published,
                    snippet=clean_text(
                        hit.get("comment_text") or hit.get("story_text") or "", 400
                    ),
                )
            )

    return _finish(items, failures, warnings)


# --------------------------------------------------------------------------
# 5. GitHub search
# --------------------------------------------------------------------------

def fetch_github_repos(
    queries: Iterable[str] = ("synthetic-data",),
    max_results: int = 15,
    lookback_days: int = 7,
    warnings: Optional[List[str]] = None,
) -> List[Item]:
    """Newly pushed repositories that look like tools or datasets."""
    cutoff = cutoff_for(lookback_days)
    cutoff_date = cutoff.strftime("%Y-%m-%d")
    items: List[Item] = []
    failures = []

    headers = dict(HEADERS)
    headers["Accept"] = "application/vnd.github+json"

    for query in queries:
        url = (
            f"https://api.github.com/search/repositories?q={urllib.parse.quote_plus(query)}"
            f"+pushed:>{cutoff_date}&sort=updated&order=desc&per_page={max_results}"
        )
        try:
            response = httpx.get(url, headers=headers, timeout=25.0)
            response.raise_for_status()
            repos = response.json().get("items", [])
        except Exception as exc:  # noqa: BLE001
            failures.append(f"github {query!r}: {exc}")
            continue

        for repo in repos:
            published = parse_iso_or_utc(repo.get("pushed_at") or repo.get("updated_at"))
            if not _in_window(published, cutoff):
                continue
            link = (repo.get("html_url") or "").strip()
            if not link:
                continue
            # Substance evidence lives in the snippet, never the title. The
            # ranker needs stars and project age to judge substance; the report
            # should show a clean name; and the duplicate grouper treats common
            # title tokens as story identity, so "(stars: 0)" in every GitHub
            # title inflated repo-vs-repo similarity and could merge distinct
            # projects.
            stars = repo.get("stargazers_count", 0)
            created = parse_iso_or_utc(repo.get("created_at"))
            meta = (
                "GitHub metadata: "
                f"stars: {stars}, "
                "project created: "
                f"{created.date().isoformat() if created else 'unknown'}."
            )
            items.append(
                Item(
                    title=(repo.get("full_name", "") or "").strip() or link,
                    url=link,
                    source="github",
                    published=published,
                    snippet=(
                        f"{meta} "
                        + clean_text(repo.get("description") or "No description provided.", 400)
                    ),
                )
            )

    return _finish(items, failures, warnings)


# --------------------------------------------------------------------------
# 6. Blog RSS feeds
# --------------------------------------------------------------------------

def fetch_blogs(
    feeds: Iterable[dict],
    max_per_feed: int = 15,
    lookback_days: int = 7,
    warnings: Optional[List[str]] = None,
) -> List[Item]:
    """Research / vendor / industry blogs from a feed list in config.yaml.

    A single dead feed is logged and skipped; the source only fails if every
    feed fails.
    """
    cutoff = cutoff_for(lookback_days)
    items: List[Item] = []
    failures = []

    for feed_cfg in feeds:
        name = feed_cfg.get("name") or feed_cfg.get("url", "blog")
        url = feed_cfg.get("url", "")
        try:
            response = httpx.get(url, headers=HEADERS, timeout=25.0, follow_redirects=True)
            response.raise_for_status()
            feed = feedparser.parse(response.content)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"blog {name}: {exc}")
            continue

        for entry in feed.entries[:max_per_feed]:
            published = entry_datetime(entry)
            if not _in_window(published, cutoff):
                continue
            link = entry.get("link", "").strip()
            if not link:
                continue
            items.append(
                Item(
                    title=clean_text(entry.get("title", ""), 300),
                    url=link,
                    source="blog",
                    published=published,
                    snippet=clean_text(entry.get("summary", ""), 400),
                )
            )
        if not feed.entries:
            failures.append(f"blog {name}: feed returned 0 entries")

    return _finish(items, failures, warnings)
