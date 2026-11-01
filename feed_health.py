"""Per-feed health check: proves every configured blog feed is alive and
returning in-window entries, and that the Reddit multi-feed works.
"""

import concurrent.futures
from datetime import datetime, timedelta, timezone

import feedparser
import httpx
import yaml

from synthetic_data.collectors import BROWSER_HEADERS, HEADERS, entry_datetime

CUTOFF = datetime.now(timezone.utc) - timedelta(days=7)
cfg = yaml.safe_load(open("config.yaml", encoding="utf-8"))


def check_feed(feed):
    url, name = feed["url"], feed["name"]
    try:
        r = httpx.get(url, headers=HEADERS, timeout=25.0, follow_redirects=True)
        parsed = feedparser.parse(r.content)
        in_window = sum(
            1 for e in parsed.entries
            if (d := entry_datetime(e)) and d >= CUTOFF
        )
        return name, r.status_code, len(parsed.entries), in_window, ""
    except Exception as exc:
        return name, "ERR", 0, 0, str(exc)[:60]


print("=== BLOG FEEDS ===")
feeds = cfg["sources"]["blogs"]["feeds"]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    rows = list(pool.map(check_feed, feeds))

ok = 0
for name, status, total, recent, err in rows:
    mark = "ok  " if status == 200 and total else "FAIL"
    if mark == "ok  ":
        ok += 1
    print(f"  [{mark}] {status!s:>4}  total={total:>4}  this-week={recent:>3}  {name} {err}")

print(f"\n{ok}/{len(feeds)} blog feeds healthy")

print("\n=== REDDIT (combined multi-subreddit feed) ===")
subs = cfg["sources"]["reddit"]["subreddits"]
url = f"https://www.reddit.com/r/{'+'.join(subs)}.rss"
r = httpx.get(url, headers=BROWSER_HEADERS, timeout=30.0, follow_redirects=True)
parsed = feedparser.parse(r.content)
recent = sum(1 for e in parsed.entries if (d := entry_datetime(e)) and d >= CUTOFF)
print(f"  HTTP {r.status_code}  entries={len(parsed.entries)}  this-week={recent}  ({'+'.join(subs)})")
