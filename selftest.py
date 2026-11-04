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

# ---------------------------------------------------------------------------
# Phase 2 — ranking. All fake: no network, no API key, no files.
# ---------------------------------------------------------------------------

import json as _json

from synthetic_data import llm as _llm
from synthetic_data import rank as _rank


def _item(title, url, score=0, well7=None, published="2026-11-01T00:00:00Z", source="arxiv"):
    return {
        "title": title, "url": url, "source": source, "published": published,
        "snippet": "snippet text", "score": score, "well7_fit": well7,
        "score_status": "scored" if score else "unscored",
    }


def _fake_model(count_holder, partial=None, broken_marker=None, raise_always=False):
    """A chat_fn that scores every id it is given, optionally badly."""
    def fake(messages):
        prompt = messages[0]["content"]
        body = prompt.split("BEGIN ITEMS\n", 1)[1].split("\nEND ITEMS", 1)[0]
        lines = [line for line in body.splitlines() if line.strip()]
        count_holder.append(len(lines))
        if raise_always:
            raise RuntimeError("model down")
        if broken_marker and broken_marker in prompt:
            return "this is not json at all"
        if partial is not None and len(lines) > 1:
            lines = lines[:partial]
        return _json.dumps(
            [{"id": i, "score": 5, "well7_fit": 4, "reason": "fine"} for i in range(len(lines))]
        )
    return fake


print("build_prompt")
batch = [_item(f"Title {i}", f"https://ex/{i}") for i in range(15)]
prompt = _rank.build_prompt(batch)
check("ids are local 0..n-1", "\n14 |" in prompt)
check("never emits id 15", "\n15 |" not in prompt)
check("BEGIN marker present", "BEGIN ITEMS" in prompt)
check("END marker present", "END ITEMS" in prompt)
check(
    "untrusted instruction is complete",
    "never instructions" in prompt and "instruction-like" in prompt,
)
check("empty snippet does not leave a dangling pipe", "|  " not in _rank.build_prompt([_item("t", "u")]).split("BEGIN ITEMS")[1])

print("parse_scores")
good = _json.dumps([{"id": 0, "score": 7, "well7_fit": 8, "reason": "r"}, {"id": 1, "score": 3, "well7_fit": 2, "reason": "s"}])
check("plain array", len(_rank.parse_scores(good, [0, 1])) == 2)
check("fenced json", len(_rank.parse_scores("```json\n" + good + "\n```", [0, 1])) == 2)
check("prose preamble", len(_rank.parse_scores("Here you go:\n" + good, [0, 1])) == 2)
check("scores wrapper", len(_rank.parse_scores(_json.dumps({"scores": _json.loads(good)}), [0, 1])) == 2)
check("non-json -> None", _rank.parse_scores("not json", [0]) is None)
check("empty -> None", _rank.parse_scores("", [0]) is None)
check("missing id dropped", len(_rank.parse_scores(good, [0])) == 1)
check("out-of-range id dropped", _rank.parse_scores(good, [5]) == {})
check("score 0 rejected", _rank.parse_scores(_json.dumps([{"id": 0, "score": 0, "reason": "r"}]), [0]) == {})
check("score 11 rejected", _rank.parse_scores(_json.dumps([{"id": 0, "score": 11, "reason": "r"}]), [0]) == {})
check("score '7' string rejected", _rank.parse_scores(_json.dumps([{"id": 0, "score": "7", "reason": "r"}]), [0]) == {})
check("empty reason rejected", _rank.parse_scores(_json.dumps([{"id": 0, "score": 5, "reason": "  "}]), [0]) == {})
dup = _json.dumps([{"id": 0, "score": 9, "reason": "first"}, {"id": 0, "score": 1, "reason": "second"}])
check("duplicate id keeps first", _rank.parse_scores(dup, [0])[0]["score"] == 9)
long_reason = _rank.parse_scores(_json.dumps([{"id": 0, "score": 5, "reason": "x" * 500}]), [0])
check("reason truncated to 160", len(long_reason[0]["reason"]) == 160)
check("missing well7_fit -> None", _rank.parse_scores(_json.dumps([{"id": 0, "score": 5, "reason": "r"}]), [0])[0]["well7_fit"] is None)

print("group_duplicates")
same = [
    _item("Same Story Here - Outlet A", "https://a", score=9, published="2026-10-30T00:00:00Z"),
    _item("Same Story Here - Outlet B", "https://b", score=8, published="2026-10-31T00:00:00Z"),
    _item("Totally unrelated paper on diffusion", "https://c", score=7),
]
grouped = _rank.group_duplicates(same)
winner = next(row for row in grouped if row["url"] == "https://a")
loser = next(row for row in grouped if row["url"] == "https://b")
other = next(row for row in grouped if row["url"] == "https://c")
check("publisher suffix treated as same story", loser["duplicate_of"] == "https://a")
check("highest score is the keeper", winner["duplicate_of"] is None)
check("loser demoted by 3", loser["score"] == 5, str(loser["score"]))
check("unrelated title not grouped", other["duplicate_of"] is None)
check("unscored duplicate not given a score", _rank.group_duplicates([
    _item("Same Story Here", "https://x", score=0),
    _item("Same Story Here", "https://y", score=0),
])[-1]["score"] == 0)

early = _rank.group_duplicates([
    _item("Identical Headline", "https://late", score=8, published="2026-10-31T00:00:00Z"),
    _item("Identical Headline", "https://early", score=8, published="2026-10-29T00:00:00Z"),
])
check("tie on score keeps the earliest", next(r for r in early if r["url"] == "https://early")["duplicate_of"] is None)

print("sort_ranked")
sorted_rows = _rank.sort_ranked([
    _item("b", "https://2", score=5, well7=9),
    _item("a", "https://1", score=5, well7=9),
    _item("c", "https://3", score=9, well7=1),
    _item("d", "https://4", score=0),
])
check("score first", sorted_rows[0]["url"] == "https://3")
check("well7 breaks ties", sorted_rows[1]["url"] == "https://1")
check("null well7 sorts last among scored", [r["url"] for r in sorted_rows][-1] == "https://4")
check("deterministic", _rank.sort_ranked(sorted_rows) == sorted_rows)

print("score_items orchestration")
calls = []
rows = _rank.score_items([_item(f"T{i}", f"https://e/{i}") for i in range(30)], _fake_model(calls), batch_size=15, concurrency=1)
check("30 items -> 2 batch calls", calls == [15, 15], str(calls))
check("every item scored", all(row["score_status"] == "scored" for row in rows))
check("every item survives", len(rows) == 30)

calls = []
rows = _rank.score_items([_item(f"T{i}", f"https://e/{i}") for i in range(15)], _fake_model(calls, partial=12), batch_size=15, concurrency=1)
check("partial batch recovers the 3 missing", calls == [15, 1, 1, 1], str(calls))
check("partial batch ends fully scored", all(row["score_status"] == "scored" for row in rows))

calls = []
rows = _rank.score_items([_item(f"T{i}", f"https://e/{i}") for i in range(15)], _fake_model(calls, raise_always=True), batch_size=15, concurrency=1)
check("total failure leaves items unscored", all(row["score_status"] == "unscored" for row in rows))
check("total failure keeps every item", len(rows) == 15)
check("total failure writes score 0", all(row["score"] == 0 for row in rows))

calls = []
mixed = [_item("good one", "https://g"), _item("bad one", "https://b")]
rows = _rank.score_items(mixed, _fake_model(calls, broken_marker="bad one"), batch_size=15, concurrency=1)
check("one broken item does not sink its sibling", sum(r["score_status"] == "scored" for r in rows) == 1)
check("broken item is the one marked", next(r for r in rows if r["url"] == "https://b")["score_status"] == "unscored")

print("llm.load_env precedence")
_env_dir = Path(tempfile.mkdtemp())
_env_file = _env_dir / ".env"
_env_file.write_text("OPENROUTER_API_KEY=from_file\nOTHER=file_value\n", encoding="utf-8")
check(".env fills a gap", _llm.load_env(str(_env_file), environ={}).get("OPENROUTER_API_KEY") == "from_file")
check("os.environ wins", _llm.load_env(str(_env_file), environ={"OPENROUTER_API_KEY": "from_env"})["OPENROUTER_API_KEY"] == "from_env")
check("missing .env is not an error", _llm.load_env(str(_env_dir / "nope"), environ={}) == {})
try:
    _llm.require({}, "OPENROUTER_API_KEY")
    check("require raises on a missing key", False)
except _llm.LLMError:
    check("require raises on a missing key", True)

print("Phase 2 wiring")
_source = Path("fetch_candidates.py").read_text(encoding="utf-8")
check("fetch_candidates has no PICKS list", "PICKS =" not in _source and "PICKS: " not in _source)
check("fetch_candidates reads ranked.json", "ranked.json" in _source)
check("fetch_candidates filters scored rows", 'score_status' in _source)
check("rubric version is recorded", isinstance(_rank.RUBRIC_VERSION, str) and _rank.RUBRIC_VERSION)

if failures:
    print(f"\n{len(failures)} FAILURE(S)")
    raise SystemExit(1)
print("\nAll self-tests passed.")
