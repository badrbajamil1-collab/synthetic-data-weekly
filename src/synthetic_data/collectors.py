"""Phase 1 collectors.

Every collector returns the same shape (List[Item]) and enforces the window
client-side. The runner is responsible for catching exceptions so that one
broken source never blocks the report.

Two windows exist and they are not interchangeable:

* ``week`` - the fixed Sunday-Saturday reporting week from
  ``synthetic_data.week``. Every source is filtered against the same seven
  days, so a run cannot re-publish last week's story.
* ``lookback_days`` - the rolling fallback used when no week is supplied.
  ``cutoff_for`` and the future bound live there.

Every HTTP GET goes through ``get_with_retry``, so all six sources retry
429/5xx with the same backoff. There is exactly one retry layer: a collector
never retries on top of ``get_with_retry``.
"""

import html
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, List, Optional, Tuple

import feedparser
import httpx

from synthetic_data.models import Item
from synthetic_data.week import in_week

HEADERS = {"User-Agent": "SyntheticDataResearchAgent/1.0 (weekly research digest)"}
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
}

_TAG_RE = re.compile(r"<[^>]+>")

# Statuses worth waiting out: 429 is rate limiting, the 5xx set is the usual
# transient-server list.
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})

# The releases API is a "core" GitHub endpoint: 60 requests an hour without a
# token. The release pass is capped - per query and per run - so one run
# cannot spend the whole hourly budget (and so every query gets a fair
# share of it).
MAX_RELEASE_CHECKS = 20
MAX_RELEASE_CHECKS_PER_QUERY = 5

# A reporting week is (Sunday, Saturday).
WeekBounds = Tuple[date, date]

# Hosts Reddit owns. A link to one of these is not an external article.
_REDDIT_HOSTS = ("reddit.com", "redd.it", "redditstatic.com", "redditmedia.com")


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def cutoff_for(lookback_days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=lookback_days)


def _in_window(
    published: Optional[datetime],
    cutoff: datetime,
    week: Optional[WeekBounds] = None,
) -> bool:
    """True if the date is inside the reporting window.

    With a ``week`` the test is the fixed Sunday-Saturday range, so every
    source describes the same seven days. Without one it is the rolling
    lookback window: the cutoff plus an upper bound that rejects items dated
    in the future (scheduled posts and feeds with broken clocks), which would
    otherwise always pass the cutoff.
    """
    if published is None:
        return False
    if week is not None:
        return in_week(published, week)
    return cutoff <= published <= datetime.now(timezone.utc) + timedelta(days=1)


def _window_start(week: Optional[WeekBounds], cutoff: datetime) -> date:
    """First day the window accepts - the date a server-side query starts at."""
    if week is not None:
        return week[0]
    return cutoff.date()


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
    statuses: Optional[Iterable[int]] = None,
) -> httpx.Response:
    """GET with exponential backoff for rate-limited and flaky endpoints.

    ``statuses`` decides which HTTP codes are worth waiting out; the default
    is 429 plus the transient 5xx set. The wait happens between attempts
    only, so the final attempt never sleeps.
    """
    retry_statuses = frozenset(statuses) if statuses is not None else RETRY_STATUSES
    last_status: Optional[int] = None
    for attempt in range(attempts):
        response = httpx.get(url, headers=headers, timeout=timeout, follow_redirects=True)
        if response.status_code == 200:
            return response
        last_status = response.status_code
        if response.status_code in retry_statuses and attempt < attempts - 1:
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


def _is_external(url: str) -> bool:
    """True for an http(s) link that is not hosted by Reddit."""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    if parts.scheme not in ("http", "https"):
        return False
    host = (parts.hostname or "").lower()
    if not host:
        return False
    return not any(host == owned or host.endswith("." + owned) for owned in _REDDIT_HOSTS)


def _entry_text(entry, field: str) -> List[str]:
    """The raw text of a feedparser field, whatever shape it comes in.

    ``content`` is a list of ``{"value": ...}`` dicts in feedparser, while
    ``summary`` and ``description`` are plain strings.
    """
    raw = entry.get(field)
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, (list, tuple)):
        parts: List[str] = []
        for part in raw:
            if isinstance(part, dict):
                value = part.get("value")
                if isinstance(value, str):
                    parts.append(value)
            elif isinstance(part, str):
                parts.append(part)
        return parts
    return []


def _external_link(entry) -> str:
    """First external link carried by a Reddit entry, if there is one.

    Reddit's RSS content is HTML: the first href is the thumbnail image on
    preview.redd.it, which is not the article, and the post body links to
    whatever the post is about. Reddit-owned hosts are skipped, so the first
    surviving href is the external article.
    """
    for field in ("content", "summary", "description"):
        for raw in _entry_text(entry, field):
            if not raw:
                continue
            text = html.unescape(raw)
            for href in re.findall(r"""href\s*=\s*["']([^"']+)["']""", text):
                candidate = html.unescape(href).strip()
                if candidate and _is_external(candidate):
                    return candidate
    return ""


# --------------------------------------------------------------------------
# 1. arXiv
# --------------------------------------------------------------------------

def fetch_arxiv(
    queries: Iterable[str] = ('"synthetic data"',),
    max_results: int = 25,
    lookback_days: int = 7,
    retry_attempts: int = 3,
    week: Optional[WeekBounds] = None,
    warnings: Optional[List[str]] = None,
) -> List[Item]:
    """Recent preprints from the arXiv Atom API, newest first.

    The snippet is the paper's own abstract, kept whole (up to 2000 chars):
    it is the text the report is written from, and truncating it here loses
    the contribution sentence.
    """
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
            response = get_with_retry(url, HEADERS, attempts=retry_attempts)
            root = ET.fromstring(response.text)
        except Exception as exc:  # noqa: BLE001 - reported by the runner
            failures.append(f"arxiv query {query!r}: {exc}")
            continue

        for entry in root.findall("atom:entry", ns):
            published = parse_iso_or_utc(entry.findtext("atom:published", default="", namespaces=ns))
            if not _in_window(published, cutoff, week):
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
                    snippet=clean_text(entry.findtext("atom:summary", default="", namespaces=ns), 2000),
                    target_url="",
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
    retry_attempts: int = 3,
    week: Optional[WeekBounds] = None,
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
            response = get_with_retry(url, HEADERS, attempts=retry_attempts)
            feed = feedparser.parse(response.content)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"google news {query!r}: {exc}")
            continue

        if getattr(feed, "bozo", False) and not feed.entries:
            failures.append(f"google news {query!r}: unparseable feed")
            continue

        for entry in feed.entries[:max_results]:
            published = entry_datetime(entry)
            if not _in_window(published, cutoff, week):
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
    week: Optional[WeekBounds] = None,
    warnings: Optional[List[str]] = None,
) -> List[Item]:
    """Subreddit RSS.

    Reddit rate-limits per IP to roughly one request per minute, so all the
    subreddits are fetched through a single multi-subreddit feed
    (r/A+B+C.rss) instead of one request each. The backoff is 15/30/45 s
    because a minute is the real limit.
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
        if not link:
            continue
        sub = link.split("/r/")[1].split("/")[0] if "/r/" in link else "unknown"
        if per_sub.get(sub, 0) >= max_per_sub:
            continue
        published = entry_datetime(entry)
        if not _in_window(published, cutoff, week):
            continue
        per_sub[sub] = per_sub.get(sub, 0) + 1
        items.append(
            Item(
                title=clean_text(entry.get("title", ""), 300),
                url=link,
                source="reddit",
                published=published,
                snippet=clean_text(entry.get("summary", ""), 400),
                target_url=_external_link(entry),
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
    retry_attempts: int = 3,
    week: Optional[WeekBounds] = None,
    warnings: Optional[List[str]] = None,
) -> List[Item]:
    """Community discussions via the HN Algolia API.

    ``Item.url`` is the HN post itself; ``target_url`` is the link the post
    points at, so a thread about a paper collapses onto the paper.
    """
    cutoff = cutoff_for(lookback_days)
    # The server-side filter must describe the SAME fixed week as the client
    # check. Using a rolling `now() - 7 days` here would silently omit a
    # historical week when the run is replayed with an explicit run_date.
    start_day = _window_start(week, cutoff)
    start_ts = int(
        datetime(start_day.year, start_day.month, start_day.day, tzinfo=timezone.utc).timestamp()
    )
    items: List[Item] = []
    failures = []

    for tag in tags:
        url = (
            "https://hn.algolia.com/api/v1/search_by_date"
            f"?query={urllib.parse.quote(tag)}&tags=(story,comment)"
            f"&numericFilters=created_at_i>={start_ts}"
        )
        try:
            response = get_with_retry(url, HEADERS, attempts=retry_attempts)
            hits = response.json().get("hits", [])
        except Exception as exc:  # noqa: BLE001
            failures.append(f"hn {tag!r}: {exc}")
            continue

        for hit in hits[:max_results]:
            published = parse_iso_or_utc(hit.get("created_at"))
            if not _in_window(published, cutoff, week):
                continue
            object_id = hit.get("objectID", "")
            external = (hit.get("url") or "").strip()
            link = f"https://news.ycombinator.com/item?id={object_id}" if object_id else external
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
                    target_url=external,
                )
            )

    return _finish(items, failures, warnings)


# --------------------------------------------------------------------------
# 5. GitHub search
# --------------------------------------------------------------------------

def _github_search(
    query: str,
    qualifier: str,
    headers: dict,
    attempts: int,
    sort: str,
    per_page: int,
) -> List[dict]:
    """Search GitHub repositories and return the item list."""
    # GitHub reads "+" as the separator between qualifiers; encode it
    # explicitly rather than relying on the client to escape a space.
    encoded_qualifier = qualifier.replace(" ", "+")
    url = (
        "https://api.github.com/search/repositories"
        f"?q={urllib.parse.quote_plus(query)}+{encoded_qualifier}"
        f"&sort={sort}&order=desc&per_page={per_page}"
    )
    response = get_with_retry(url, headers, attempts=attempts)
    payload = response.json()
    items = payload.get("items", [])
    return items if isinstance(items, list) else []


def _github_release_in_window(
    full_name: str,
    headers: dict,
    attempts: int,
    cutoff: datetime,
    week: Optional[WeekBounds],
) -> Optional[Tuple[datetime, dict]]:
    """The newest release of ``full_name`` published inside the window.

    Returns ``(published_at, release)`` or None when the repository has no
    release inside the window.
    """
    url = f"https://api.github.com/repos/{full_name}/releases?per_page=10"
    response = get_with_retry(url, headers, attempts=attempts)
    releases = response.json()
    if not isinstance(releases, list):
        return None

    best: Optional[Tuple[datetime, dict]] = None
    for release in releases:
        if not isinstance(release, dict):
            continue
        published = parse_iso_or_utc(release.get("published_at"))
        if published is None or not _in_window(published, cutoff, week):
            continue
        if best is None or published > best[0]:
            best = (published, release)
    return best


def _github_item(
    repo: dict,
    published: datetime,
    release: Optional[dict] = None,
) -> Optional[Item]:
    """Build a GitHub item.

    Substance evidence lives in the snippet, never the title. The ranker
    needs stars and project age to judge substance; the report should show a
    clean name; and the duplicate grouper treats common title tokens as
    story identity, so "(stars: 0)" in every GitHub title inflated
    repo-vs-repo similarity and could merge distinct projects.
    """
    link = (repo.get("html_url") or "").strip()
    if not link:
        return None

    stars = repo.get("stargazers_count", 0)
    created = parse_iso_or_utc(repo.get("created_at"))
    meta = (
        "GitHub metadata: "
        f"stars: {stars}, "
        "project created: "
        f"{created.date().isoformat() if created else 'unknown'}."
    )
    parts = [
        meta,
        clean_text(repo.get("description") or "No description provided.", 400),
    ]
    if release is not None:
        name = release.get("name") or release.get("tag_name") or "release"
        stamp = release.get("published_at") or ""
        parts.append(f"GitHub release {name} published {stamp}.")

    return Item(
        title=(repo.get("full_name", "") or "").strip() or link,
        url=link,
        source="github",
        published=published,
        snippet=" ".join(part for part in parts if part),
    )


def fetch_github_repos(
    queries: Iterable[str] = ("synthetic-data",),
    max_results: int = 15,
    lookback_days: int = 7,
    retry_attempts: int = 3,
    include_releases: bool = False,
    week: Optional[WeekBounds] = None,
    warnings: Optional[List[str]] = None,
) -> List[Item]:
    """Newly created repositories, plus older ones that shipped a release.

    Two passes over the GitHub search API:

    1. ``created:>`` the start of the window. A repository created this week
       is news on its own and is dated by ``created_at``.
    2. ``created:<`` and ``pushed:>`` the start of the window. An older
       repository is news only when its releases API shows a release
       published inside the week; the item is dated by that release and the
       release is named in the snippet. Only repositories that were pushed
       to during the week can have such a release, so the second qualifier
       keeps the number of releases calls (and the GitHub API budget they
       spend) small.
    """
    cutoff = cutoff_for(lookback_days)
    start_day = _window_start(week, cutoff)
    items: List[Item] = []
    failures: List[str] = []
    notes: List[str] = []
    seen_repos: set = set()
    release_checks = 0

    headers = dict(HEADERS)
    headers["Accept"] = "application/vnd.github+json"

    for query in queries:
        # Pass 1 - created inside the window.
        try:
            repos = _github_search(
                query,
                f"created:>={start_day.isoformat()}",
                headers,
                retry_attempts,
                "created",
                max_results,
            )
        except Exception as exc:  # noqa: BLE001
            failures.append(f"github {query!r}: {exc}")
            continue

        for repo in repos:
            if not isinstance(repo, dict):
                continue
            full_name = (repo.get("full_name") or "").strip().lower()
            if full_name:
                seen_repos.add(full_name)
            created = parse_iso_or_utc(repo.get("created_at"))
            published = created or parse_iso_or_utc(repo.get("pushed_at"))
            if published is None or not _in_window(published, cutoff, week):
                continue
            item = _github_item(repo, published)
            if item is not None:
                items.append(item)

        if not include_releases:
            continue

        # Pass 2 - created before the window, news only via a release.
        query_checks = 0
        skipped = 0
        try:
            older = _github_search(
                query,
                f"created:<{start_day.isoformat()} pushed:>={start_day.isoformat()}",
                headers,
                retry_attempts,
                "updated",
                max_results,
            )
        except Exception as exc:  # noqa: BLE001
            failures.append(f"github {query!r} (older repos): {exc}")
            continue

        for repo in older:
            if not isinstance(repo, dict):
                continue
            full_name = (repo.get("full_name") or "").strip()
            if not full_name or full_name.lower() in seen_repos:
                continue
            # A release published inside the week means the repository was
            # pushed to inside the week, so this cheap check keeps the number
            # of releases calls down.
            touched = parse_iso_or_utc(repo.get("pushed_at")) or parse_iso_or_utc(repo.get("updated_at"))
            if touched is None or not _in_window(touched, cutoff, week):
                continue
            if query_checks >= MAX_RELEASE_CHECKS_PER_QUERY or release_checks >= MAX_RELEASE_CHECKS:
                skipped += 1
                continue
            query_checks += 1
            release_checks += 1
            try:
                found = _github_release_in_window(full_name, headers, retry_attempts, cutoff, week)
            except Exception as exc:  # noqa: BLE001
                notes.append(f"github {full_name} releases: {exc}")
                continue
            if found is None:
                continue
            released_at, release = found
            seen_repos.add(full_name.lower())
            item = _github_item(repo, released_at, release)
            if item is not None:
                items.append(item)

        if skipped:
            notes.append(
                f"github {query!r}: {skipped} older repositories were not checked "
                "for a release (GitHub API rate limit)"
            )

    if warnings is not None:
        warnings.extend(notes)
    return _finish(items, failures, warnings)


# --------------------------------------------------------------------------
# 6. Blog RSS feeds
# --------------------------------------------------------------------------

def fetch_blogs(
    feeds: Iterable[dict],
    max_per_feed: int = 15,
    lookback_days: int = 7,
    retry_attempts: int = 2,
    week: Optional[WeekBounds] = None,
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
            response = get_with_retry(url, HEADERS, attempts=retry_attempts)
            feed = feedparser.parse(response.content)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"blog {name}: {exc}")
            continue

        for entry in feed.entries[:max_per_feed]:
            published = entry_datetime(entry)
            if not _in_window(published, cutoff, week):
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
