"""Offline self-tests for the Phase 1 collectors' pure helpers.

No network access: these are the functions that decide what enters the
dataset, so they get unit coverage.
"""

from datetime import datetime, timedelta, timezone

from synthetic_data.collectors import (
    _dedupe,
    _in_window,
    clean_text,
    cutoff_for,
    entry_datetime,
    parse_iso_or_utc,
)
from synthetic_data.models import Item

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

print("Item shape")
required = {"title", "url", "source", "published", "snippet", "full_text", "score", "summary"}
check("all spec fields present", required <= set(Item.model_fields))

if failures:
    print(f"\n{len(failures)} FAILURE(S)")
    raise SystemExit(1)
print("\nAll self-tests passed.")
