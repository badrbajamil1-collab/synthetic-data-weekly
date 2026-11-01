"""URL normalisation, Google News resolution and link verification.

Phase 2 owns normalisation and dedupe; Phase 3 owns the "every link is checked"
rule. Both live here so there is one definition of "the same link" and one
definition of "a working link".
"""

import json
import re
import urllib.parse
from typing import Dict, Optional

import httpx

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

# Query parameters that never change which document you are looking at.
TRACKING_PREFIXES = ("utm_", "pk_", "mtm_", "hsa_")
TRACKING_PARAMS = {
    "ref",
    "referrer",
    "source",
    "src",
    "via",
    "fbclid",
    "gclid",
    "yclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "oc",
    "at_medium",
    "at_campaign",
    "spm",
    "trk",
    "trkCampaign",
    "cmpid",
    "campaign",
    "s",
}

GNEWS_ENDPOINT = "https://news.google.com/_/DotsSplashUi/data/batchexecute"
_GNEWS_PAYLOAD = (
    '["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,'
    'null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"{aid}",{ts},"{sg}"]'
)

_ARXIV_VERSION = re.compile(r"(arxiv\.org/abs/\d{4}\.\d{4,5})v\d+$")


def normalize_url(url: str) -> str:
    """Canonical form used for deduplication (not for display).

    Removes tracking parameters, fragments, default ports, ``www.`` and
    trailing slashes, and folds arXiv version suffixes so v1 and v2 of the
    same paper do not both get sent.
    """
    if not url:
        return ""

    parts = urllib.parse.urlsplit(url.strip())
    scheme = (parts.scheme or "https").lower()
    host = (parts.hostname or "").lower()

    if host.startswith("www."):
        host = host[4:]
    if parts.port and parts.port not in (80, 443):
        host = f"{host}:{parts.port}"

    query = [
        (key, value)
        for key, value in urllib.parse.parse_qsl(parts.query, keep_blank_values=False)
        if key.lower() not in TRACKING_PARAMS
        and not key.lower().startswith(TRACKING_PREFIXES)
    ]
    query.sort()

    path = parts.path.rstrip("/") or "/"

    normalized = urllib.parse.urlunsplit(
        (scheme, host, path, urllib.parse.urlencode(query), "")
    )
    match = _ARXIV_VERSION.search(normalized)
    if match:
        normalized = match.group(1)
    return normalized


def resolve_google_news(url: str, timeout: float = 30.0) -> str:
    """Turn a ``news.google.com/rss/articles/...`` redirect into the real URL.

    Google News RSS no longer puts the publisher URL in the feed and the
    article page is a JavaScript shell, so the URL is fetched through the same
    internal RPC the web client uses. Returns the input unchanged if anything
    goes wrong - a Google News link still works for a reader, it is just not
    checkable.
    """
    if "news.google.com" not in url:
        return url

    try:
        page = httpx.get(url, headers=UA, timeout=timeout, follow_redirects=True)
        timestamp = re.search(r'data-n-a-ts="(\d+)"', page.text)
        signature = re.search(r'data-n-a-sg="([^"]+)"', page.text)
        if not (timestamp and signature):
            return url

        article_id = url.split("/articles/")[1].split("?")[0]
        inner = _GNEWS_PAYLOAD.format(
            aid=article_id, ts=timestamp.group(1), sg=signature.group(1)
        )
        body = "f.req=" + urllib.parse.quote(json.dumps([[["Fbv4je", inner]]]))
        response = httpx.post(
            GNEWS_ENDPOINT,
            headers={
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                **UA,
            },
            content=body.encode(),
            timeout=timeout,
        )
        match = re.search(r'garturlres\\",\\"(https?://[^\\"]+)', response.text)
        return match.group(1) if match else url
    except Exception:  # noqa: BLE001 - never fail a run over link cosmetics
        return url


def _check_hacker_news(url: str, timeout: float) -> Dict[str, object]:
    """HN blocks non-browser clients with HTTP 419, so verify via its API."""
    match = re.search(r"[?&]id=(\d+)", url)
    if not match:
        return {"status": 419, "ok": False, "note": "HN page without item id"}
    item_id = match.group(1)
    try:
        response = httpx.get(
            f"https://hn.algolia.com/api/v1/items/{item_id}", timeout=timeout
        )
        payload = response.json() if response.status_code == 200 else {}
    except Exception as exc:  # noqa: BLE001
        return {"status": f"ERR {type(exc).__name__}", "ok": False, "note": "HN API"}
    if payload.get("id"):
        return {"status": "419->api 200", "ok": True, "note": "verified via HN API"}
    return {"status": 419, "ok": False, "note": "HN item not found"}


def check_link(url: str, timeout: float = 30.0) -> Dict[str, object]:
    """Open a link and report whether it really resolves (quality rule #1)."""
    if "news.ycombinator.com" in url:
        return _check_hacker_news(url, timeout)

    try:
        response = httpx.get(url, headers=UA, timeout=timeout, follow_redirects=True)
        return {
            "status": response.status_code,
            "ok": response.status_code == 200,
            "final_url": str(response.url),
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": f"ERR {type(exc).__name__}", "ok": False, "final_url": url}


def dedupe_key(item_url: str) -> str:
    return normalize_url(item_url)


if __name__ == "__main__":
    # Tiny manual check: python -m synthetic_data.links <url>
    import sys

    for argument in sys.argv[1:]:
        resolved = resolve_google_news(argument)
        print(resolved)
        print(normalize_url(resolved))
        print(check_link(resolved))
