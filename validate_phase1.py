"""Validate the Phase 1 contract against raw_items.json."""

import json
from collections import Counter
from datetime import datetime, timedelta, timezone

DATA = json.load(open("raw_items.json", encoding="utf-8"))
NOW = datetime.now(timezone.utc)
CUTOFF = NOW - timedelta(days=7)

ALLOWED = {"arxiv", "news", "blog", "reddit", "hn", "github"}

print(f"Items: {len(DATA)}")
print(f"Window: {CUTOFF:%Y-%m-%d %H:%M} -> {NOW:%Y-%m-%d %H:%M} UTC\n")

problems = []

for i, item in enumerate(DATA):
    published = datetime.fromisoformat(item["published"])
    if published.tzinfo is None:
        problems.append(f"[{i}] naive datetime: {item['title'][:50]}")
    if published < CUTOFF - timedelta(minutes=1):
        problems.append(f"[{i}] OUT OF WINDOW {published:%Y-%m-%d} {item['title'][:50]}")
    if published > NOW + timedelta(hours=1):
        problems.append(f"[{i}] FUTURE DATE {published:%Y-%m-%d} {item['title'][:50]}")
    url = item.get("url", "")
    if not url.startswith(("http://", "https://")):
        problems.append(f"[{i}] BAD URL {url!r}")
    if item.get("source") not in ALLOWED:
        problems.append(f"[{i}] UNKNOWN SOURCE {item.get('source')!r}")
    if not item.get("title"):
        problems.append(f"[{i}] EMPTY TITLE")

urls = [item["url"] for item in DATA]
dupes = [u for u, n in Counter(urls).items() if n > 1]
if dupes:
    problems.append(f"{len(dupes)} duplicate URLs, e.g. {dupes[:3]}")

print("Per-source breakdown:")
for source, count in sorted(Counter(item["source"] for item in DATA).items()):
    dates = [datetime.fromisoformat(i["published"]) for i in DATA if i["source"] == source]
    print(f"  {source:<8} {count:>3} items   "
          f"{min(dates):%Y-%m-%d} .. {max(dates):%Y-%m-%d}   "
          f"{len(set(i['url'] for i in DATA if i['source'] == source))} unique urls")

print(f"\nUnique URLs: {len(set(urls))} / {len(urls)}")
print(f"Oldest item: {min(datetime.fromisoformat(i['published']) for i in DATA):%Y-%m-%d %H:%M}")
print(f"Newest item: {max(datetime.fromisoformat(i['published']) for i in DATA):%Y-%m-%d %H:%M}")

if problems:
    print(f"\nFAIL - {len(problems)} problem(s):")
    for p in problems[:25]:
        print("  -", p)
else:
    print("\nPASS - all items inside the 7-day window, URLs well-formed, no duplicates.")
