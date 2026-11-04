"""Offline self-tests for the Phase 1 collectors' pure helpers.

No network access: these are the functions that decide what enters the
dataset, so they get unit coverage.
"""

import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from synthetic_data.collectors import (
    _dedupe,
    _in_window,
    clean_text,
    cutoff_for,
    entry_datetime,
    parse_iso_or_utc,
)
from synthetic_data.links import normalize_url
from synthetic_data.memory import filter_seen_urls, mark_sent
from synthetic_data.models import Item
from synthetic_data.runner import dedupe_items

NOW = datetime.now(timezone.utc)
failures = []


def check(name, condition, detail=""):
    if condition:
        print(f"  PASS  {name}")
    else:
        failures.append(f"{name} {detail}")
        print(f"  FAIL  {name} {detail}")


print("parse_iso_or_utc")
check("Z suffix", parse_iso_or_utc("2026-10-27T17:25:43Z") == datetime(2026, 10, 27, 17, 25, 43, tzinfo=timezone.utc))
check("offset", parse_iso_or_utc("2026-10-27T17:25:43+00:00").year == 2026)
check("naive gets UTC", parse_iso_or_utc("2026-10-27T17:25:43").tzinfo is not None)
check("garbage -> None", parse_iso_or_utc("not a date") is None)
check("empty -> None", parse_iso_or_utc("") is None)
check("none -> None", parse_iso_or_utc(None) is None)

print("clean_text")
check("strips tags", clean_text("<p>Hello <b>world</b></p>") == "Hello world")
check("unescapes entities", clean_text("A &amp; B") == "A & B")
check("collapses whitespace", clean_text("a\n\n   b") == "a b")
check("truncates", len(clean_text("x" * 900, 100)) == 100)
check("empty safe", clean_text("") == "")

print("_in_window")
cutoff = cutoff_for(7)
check("inside window", _in_window(NOW - timedelta(days=3), cutoff))
check("exactly at cutoff", _in_window(cutoff, cutoff))
check("too old", not _in_window(NOW - timedelta(days=8), cutoff))
check("future rejected", not _in_window(NOW + timedelta(days=5), cutoff))
check("none rejected", not _in_window(None, cutoff))

print("entry_datetime")
check("published struct_time", entry_datetime({"published_parsed": (2026, 10, 27, 1, 2, 3, 0, 0, 0)}) is not None)
check("missing -> None", entry_datetime({}) is None)
check("updated fallback", entry_datetime({"updated_parsed": (2026, 10, 27, 1, 2, 3, 0, 0, 0)}) is not None)

print("_dedupe")
a = Item(title="a", url="https://x/1", source="arxiv", published=NOW)
b = Item(title="b", url="https://x/1", source="hn", published=NOW)
c = Item(title="c", url="https://x/2", source="hn", published=NOW)
check("removes exact url dupes", len(_dedupe([a, b, c])) == 2)

print("dedupe_items (normalised)")
u1 = Item(title="a", url="https://example.com/post?utm_source=x", source="news", published=NOW)
u2 = Item(title="b", url="https://example.com/post", source="blog", published=NOW - timedelta(days=1))
u3 = Item(title="c", url="https://example.com/other", source="hn", published=NOW)
unique, dropped = dedupe_items([u1, u2, u3])
check("tracking params collapse", len(unique) == 2, f"got {len(unique)}")
check("dropped count is exact", dropped == 1, str(dropped))
check("keeps the newest copy", unique[0].title == "a", unique[0].title)

v1 = Item(title="v1", url="https://arxiv.org/abs/2610.35521v1", source="arxiv", published=NOW)
v2 = Item(title="v2", url="https://arxiv.org/abs/2610.35521v2", source="arxiv", published=NOW - timedelta(days=1))
check("arxiv versions collapse", len(dedupe_items([v1, v2])[0]) == 1)

print("normalize_url")
check(
    "http and https are the same document",
    normalize_url("http://example.com/a") == normalize_url("https://example.com/a"),
    normalize_url("http://example.com/a"),
)
check(
    "arxiv version folds and keeps the scheme",
    normalize_url("http://arxiv.org/abs/2610.35521v1") == "https://arxiv.org/abs/2610.35521",
    normalize_url("http://arxiv.org/abs/2610.35521v1"),
)

print("memory (SQLite history)")
db = str(Path(tempfile.mkdtemp()) / "history.db")
check("missing db leaves items alone", len(filter_seen_urls([u3], db_path=db)) == 1)
check("reading never creates the db", not Path(db).exists())
mark_sent([(u3.url, u3.title, u3.source)], db_path=db)
check("writing creates the db", Path(db).exists())
check("sent url is filtered", len(filter_seen_urls([u3], db_path=db)) == 0)
check("unsent url survives", len(filter_seen_urls([u1], db_path=db)) == 1)

# The report links to the canonical arxiv URL while the collector stores the
# versioned http form, so history has to match across forms or it never fires.
db2 = str(Path(tempfile.mkdtemp()) / "history.db")
mark_sent([("http://arxiv.org/abs/2610.99999v2", "t", "arxiv")], db_path=db2)
canonical = Item(
    title="t",
    url="https://arxiv.org/abs/2610.99999",
    source="arxiv",
    published=NOW,
)
check("history matches across url forms", len(filter_seen_urls([canonical], db_path=db2)) == 0)

print("Item shape")
required = {"title", "url", "source", "published", "snippet", "full_text", "score", "summary"}
check("all spec fields present", required <= set(Item.model_fields))

if failures:
    print(f"\n{len(failures)} FAILURE(S)")
    raise SystemExit(1)
print("\nAll self-tests passed.")
