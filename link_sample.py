"""Sample-check that collected URLs resolve. Not the full report-time gate
(that runs on the top 10 only), just proof the raw links are real."""

import concurrent.futures
import json
import random
from collections import Counter

import httpx

ITEMS = json.load(open("raw_items.json", encoding="utf-8"))
random.seed(7)

by_source = {}
for item in ITEMS:
    by_source.setdefault(item["source"], []).append(item["url"])

sample = []
for source, urls in by_source.items():
    sample.extend((source, u) for u in random.sample(urls, min(5, len(urls))))

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}


def check(pair):
    source, url = pair
    try:
        r = httpx.get(url, headers=UA, timeout=25.0, follow_redirects=True)
        return source, url, r.status_code
    except Exception as exc:
        return source, url, f"ERR {type(exc).__name__}"


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(check, sample))

for source, url, status in sorted(results):
    alive = status == 200 or (isinstance(status, int) and 300 <= status < 400) or status == 403
    print(f"  {'OK  ' if alive else 'FAIL'} {str(status):>4}  {source:<6} {url[:95]}")

counts = Counter(
    "alive" if (s == 200 or (isinstance(s, int) and 300 <= s < 400) or s == 403) else "dead"
    for _, _, s in results
)
print(f"\n{counts['alive']}/{len(results)} sampled links alive")
print("(403 = page exists but blocks bots; not a broken link)")
