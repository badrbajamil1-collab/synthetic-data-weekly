"""Fetch and extract the full text of report candidates (Phase 3 input).

Resolves Google News redirects, normalises URLs, and stores the real text so
summaries can only be written from what the page actually says.
"""

import concurrent.futures
import json
import re

import httpx
import trafilatura

from synthetic_data.links import UA, normalize_url, resolve_google_news

PICKS = [
    "Statistical Analysis of Synthetic Data with Verification: A Linear Regression Framework",
    "Sequential versus fully conditional specification for tree-based synthesis of health data",
    "A goodness of fit approach to select the optimal visit sequence for nonparametric data synthesis",
    "Synthetic Child-Adult Interactions Are Not Developmentally Plausible",
    "Rivian Buys Synthetic Data Startup To Boost Its Autonomy Ambitions - InsideEVs",
    "Drift metrics predict how synthetic clinical text fails on real patient notes - Bioengineer.org",
    "From synthetic enterprise data evaluations to real Microsoft Copilot AI confidence - Microsoft",
    "Real Enough? Synthetic Users, Synthetic Data, and the Limits of Simulation - https://microsoft.design/",
    "Synthetic Brain Scans Bridged Between Sites Sharpen Brain Age Prediction - Bioengineer.org",
    "microsoft/DPSDA (stars: 120)",
    "opendp/tumult-analytics (stars: 17)",
    "oeg-upm/TINTOlib (stars: 19)",
    "Synthetic survey respondents from real census data, with a calibration score",
    "AI deception detectors stumble when synthetic training meets real-world stress - Bioengineer.org",
    "AI-Generated Control Arms in Hematology Trials: Promise, Challenges, and Clinical Validity - Oncodaily",
    "AI Generates Physically Consistent Synthetic Rock Strength Data for Engineers - Bioengineer.org",
    "Synthetic Data Generation Market to Reach US$5.27 Billion by 2033 at 31.1% CAGR - openPR.com",
    "Tonic.ai and Carahsoft Partner to Bring AI-Native Synthetic Data to the Public Sector - The Manila Times",
    "What Training Dataset Transparency Mandates Hide - Tech Policy Press",
    "Genie 4: A new generation of world simulation",
]


def find_item(title, data):
    if title in data:
        return data[title]
    key = title.split(" - ")[0].strip().lower()
    for name, item in data.items():
        if name.lower().startswith(key[:60]):
            return item
    return None


def fetch(title, item):
    resolved = resolve_google_news(item["url"])
    record = {
        "title": item["title"],
        "source": item["source"],
        "published": item["published"],
        "feed_url": item["url"],
        "url": resolved,
        "normalized": normalize_url(resolved),
        "status": None,
        "chars": 0,
        "text": "",
    }
    try:
        response = httpx.get(resolved, headers=UA, timeout=35.0, follow_redirects=True)
        record["status"] = response.status_code
        text = trafilatura.extract(response.text, include_comments=False) or ""
        record["chars"] = len(text)
        record["text"] = re.sub(r"\n{3,}", "\n\n", text)[:8000]
    except Exception as exc:  # noqa: BLE001
        record["status"] = f"ERR {type(exc).__name__}"
    return title, record


def main():
    raw = []
    for item in json.load(open("raw_items.json", encoding="utf-8")):
        raw.append(item)
    data = {item["title"]: item for item in raw}

    targets = []
    for title in PICKS:
        item = find_item(title, data)
        if item is None:
            print(f"MISS  {title}")
            continue
        targets.append((title, item))

    out = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        for title, record in pool.map(lambda pair: fetch(*pair), targets):
            out[title] = record

    for title, record in out.items():
        print(f"{str(record['status']):>4} chars={record['chars']:>5}  {title[:70]}")
        if record["url"] != record["feed_url"]:
            print(f"      -> {record['url'][:110]}")

    json.dump(out, open("candidates.json", "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print("\nwrote candidates.json")


if __name__ == "__main__":
    main()
