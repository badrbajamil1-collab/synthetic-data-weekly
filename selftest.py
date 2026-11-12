"""Offline self-tests for the Phase 1 collectors' pure helpers.

No network access: these are the functions that decide what enters the
dataset, so they get unit coverage.
"""

import tempfile
from datetime import date as _date, datetime, timedelta, timezone
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
    _item("high well7, lower score", "https://w", score=5, well7=9),
    _item("high score, low well7", "https://s", score=9, well7=3),
    _item("same well7, higher score", "https://t", score=8, well7=9),
    _item("null well7", "https://n", score=10),
])
_order = [r["url"] for r in sorted_rows]
check("well7 primary: w9/s5 outranks w3/s9", _order.index("https://w") < _order.index("https://s"), str(_order))
check("score breaks well7 ties", _order[0] == "https://t" and _order[1] == "https://w", str(_order))
check("null well7 sorts last", _order[-1] == "https://n")
check("deterministic", _rank.sort_ranked(sorted_rows) == sorted_rows)

_w_group = _rank.group_duplicates([
    _item("Identical Headline", "https://lowfit", score=10, well7=2, published="2026-10-31T00:00:00Z"),
    _item("Identical Headline", "https://highfit", score=6, well7=10, published="2026-10-29T00:00:00Z"),
])
check("duplicate group keeps the highest well7 fit", next(r for r in _w_group if r["url"] == "https://highfit")["duplicate_of"] is None)

print("Well7 rubric")
check("rubric names differential privacy", "DP-SGD" in _rank._PROMPT_HEADER)
check("rubric names federated synthesis", "federated" in _rank._PROMPT_HEADER.lower())
check("rubric names the regulatory context", "PDPL" in _rank._PROMPT_HEADER)
check("rubric has well7 anchors", "8-10" in _rank._PROMPT_HEADER and "directly actionable" in _rank._PROMPT_HEADER)
check("rubric version bumped", _rank.RUBRIC_VERSION != "2026-11-06.1")

print("cap_github_share")
_rows_mix = [
    {"title": "a", "url": "https://1", "source": "github", "score": 10, "well7_fit": 5},
    {"title": "b", "url": "https://2", "source": "github", "score": 9, "well7_fit": 5},
    {"title": "c", "url": "https://3", "source": "arxiv", "score": 9, "well7_fit": 5},
    {"title": "d", "url": "https://4", "source": "github", "score": 9, "well7_fit": 5},
    {"title": "e", "url": "https://5", "source": "arxiv", "score": 8, "well7_fit": 5},
    {"title": "f", "url": "https://6", "source": "github", "score": 8, "well7_fit": 5},
]
_mixed = _rank.cap_github_share(_rows_mix, 2)
_check_head = [row["source"] for row in _mixed[:4]]
check("github beyond the cap moves to the tail", _check_head == ["github", "github", "arxiv", "arxiv"], str(_check_head))
check("relative order elsewhere is kept", _mixed[2]["title"] == "c" and _mixed[3]["title"] == "e")
check("capped but not lost", [r["title"] for r in _mixed if r["title"] == "d"] == ["d"])
check("cap 0 keeps everything in place", _rank.cap_github_share(_rows_mix, 0) == _rows_mix)

_gh_prompt = _rank.build_prompt([{
    "title": "owner/repo",
    "url": "https://github.com/owner/repo",
    "source": "github",
    "snippet": "GitHub metadata: stars: 447, project created: 2019-01-01. A privacy toolkit.",
}])
check("prompt carries repo substance metadata", "GitHub metadata: stars: 447" in _gh_prompt)
check("prompt demotes old low-star repos", "at least 10 stars" in _rank._PROMPT_HEADER)

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

# ---------------------------------------------------------------------------
# Phase 3 — summarising. All fake: no network, no API key, no files.
# ---------------------------------------------------------------------------

import yaml as _yaml

from synthetic_data import summarise as _sum


def _cand(index, source="arxiv", day=4, score=None):
    return {
        "title": f"Item {index}",
        "url": f"https://example.com/{index}",
        "source": source,
        "published": f"2026-11-{day:02d}T00:00:00Z",
        "score": 100 - index if score is None else score,
        "well7_fit": 5,
        "text": f"Item {index} reports 223 tables. It uses 12 models. It finds a 0.54 correlation.",
        "snippet": "",
    }


print("extract_numbers / unsupported_numbers")
check("decimal kept", _sum.extract_numbers("r = 0.54") == {"0.54"}, str(_sum.extract_numbers("r = 0.54")))
check("thousands separator normalised", _sum.extract_numbers("79,000 rows") == {"79000"}, str(_sum.extract_numbers("79,000 rows")))
check("percent sign is not part of the token", _sum.extract_numbers("above 90%") == {"90"})
check("suffix letter is not part of the token", _sum.extract_numbers("79M rows") == {"79"})
check("no digits is an empty set", _sum.extract_numbers("no numbers here") == set())
check("supported number passes", _sum.unsupported_numbers("uses 223 tables", "a dataset with 223 tables") == [])
check("invented number is caught", _sum.unsupported_numbers("uses 300 tables", "a dataset with 223 tables") == ["300"])
check("5 does not pass because 15 exists", _sum.unsupported_numbers("uses 5 tables", "uses 15 tables") == ["5"])
check("comma form matches plain form", _sum.unsupported_numbers("1,000 rows", "1000 rows") == [])
check("0.5 does not pass because 0.54 exists", _sum.unsupported_numbers("r = 0.5", "r = 0.54") == ["0.5"])
check("dotted identifiers stay whole", _sum.extract_numbers("GPT3.5") == {"3.5"}, str(_sum.extract_numbers("GPT3.5")))
check("a letter-prefixed quantity is still checked",
      _sum.unsupported_numbers("Released v9.5 today.", "We tested 5 models.") == ["9.5"],
      str(_sum.unsupported_numbers("Released v9.5 today.", "We tested 5 models.")))
check("the Well7 brand is not a quantity", _sum.extract_numbers("Well7") == set(), str(_sum.extract_numbers("Well7")))

print("extractive_summary")
_multi = "First sentence is long enough to count. Second sentence follows it here. Third sentence is also here. Fourth is dropped."
_extracted = _sum.extractive_summary(_multi)
check("three sentences at most", _extracted.count(". ") == 2, _extracted)
check("extractive text comes from the source", "Fourth" not in _extracted)
check("empty text gives empty summary", _sum.extractive_summary("") == "")
check("no punctuation still returns text", _sum.extractive_summary("a plain fragment with no full stop") == "a plain fragment with no full stop")

print("clean_text")
check("markdown heading removed", not _sum.clean_text("# CrossSynth").startswith("#"))
check("bold markers removed", "**" not in _sum.clean_text("**bold** text"))
check("link keeps its label", _sum.clean_text("[read this](https://x)") == "read this")
check("underscore in a name survives", "seege_" in _sum.clean_text("library called seege_ here"))
check("html tags removed", "<p>" not in _sum.clean_text("<p>hello</p>"))
check("code fences removed", "pip install" not in _sum.clean_text("Text.\n```\npip install x\n```\nMore."))
check("a heading line is dropped whole", "Installation" not in _sum.clean_text("# Installation\nRun this."))

print("build_prompt")
_prompt = _sum.build_prompt(_cand(0))
check("prompt tells the model to use only the text", "Use ONLY facts stated in the TEXT" in _prompt)
check("prompt bans hype words", "breakthrough" in _prompt and "dramatically" in _prompt)
check("prompt does not let the title set the data type", "Do not infer its data type" in _prompt)

print("parse_summary")
check("plain json object", _sum.parse_summary('{"summary": "hello"}') == "hello")
check("fenced json", _sum.parse_summary('```json\n{"summary": "hello"}\n```') == "hello")
check("prose preamble", _sum.parse_summary('Here:\n{"summary": "hello"}') == "hello")
check("trend key", _sum.parse_summary('{"trend": "paragraph"}', key="trend") == "paragraph")
check("single-object array", _sum.parse_summary('[{"summary": "hello"}]') == "hello")
check("blank summary rejected", _sum.parse_summary('{"summary": "   "}') is None)
check("non-json rejected", _sum.parse_summary("not json") is None)
check("empty rejected", _sum.parse_summary("") is None)
check("newlines collapse", _sum.parse_summary('{"summary": "a\\nb"}') == "a b")

print("summarise_item")


def _reply(text, why="It matters for synthetic data research."):
    return lambda messages: _json.dumps({"summary": text, "why_it_matters": why})


good = _sum.summarise_item(_cand(0), _reply("It reports 223 tables."))
check("honest summary passes the guard", good["guard"] == "passed", str(good))
check("origin records full text", good["origin"] == "full text")

invented = _sum.summarise_item(_cand(0), _reply("It reports 900 tables."))
check("invented number falls back to extractive", invented["guard"] == "extractive", str(invented))
check("extractive fallback quotes the source", "223 tables" in invented["summary"], invented["summary"])

_calls = []


def _flaky(messages):
    _calls.append(1)
    if len(_calls) == 1:
        return _json.dumps({"summary": "It reports 900 tables.",
                            "why_it_matters": "It matters for synthetic data research."})
    return _json.dumps({"summary": "It reports 223 tables.",
                        "why_it_matters": "It matters for synthetic data research."})


repaired = _sum.summarise_item(_cand(0), _flaky)
check("bad first reply is repaired once", repaired["guard"] == "repaired", str(repaired))
check("repair took exactly two calls", len(_calls) == 2, str(len(_calls)))

_snippet = _cand(1, source="hn")
_snippet["text"] = ""
_snippet["snippet"] = "A fictional company with 223 tables."
from_snippet = _sum.summarise_item(_snippet, _reply("It has 223 tables."))
check("snippet is used when there is no text", from_snippet["origin"] == "snippet only", str(from_snippet))
check("snippet summary says so", _sum._SNIPPET_MARK in from_snippet["summary"], from_snippet["summary"])

_title_only = _cand(2)
_title_only["text"] = ""
_title_only["snippet"] = ""
bare = _sum.summarise_item(_title_only, _reply("should never be called"))
check("no text is disclosed as such", bare["guard"] == "skipped" and "No text" in bare["summary"], str(bare))


def _always_down(messages):
    raise RuntimeError("model down")


down = _sum.summarise_item(_cand(3), _always_down)
check("unreachable model still yields a summary", down["guard"] == "extractive" and bool(down["summary"]))
check("failure reason is recorded", any("call failed" in item for item in down["detail"]), str(down["detail"]))

_long_reply = " ".join(["word"] * 90) + "."
_too_long = _sum.summarise_item(_cand(0), _reply(_long_reply))
check("over-long reply is not passed as is", _too_long["guard"] == "extractive", str(_too_long))
check("over-long reply is recorded with its length", any("words" in item for item in _too_long["detail"]), str(_too_long["detail"]))
check("extractive fallback stays inside the word budget", _sum.word_count(_too_long["summary"]) <= _sum.WORDS_LONG, _too_long["summary"])

_length_calls = []


def _long_then_short(messages):
    _length_calls.append(1)
    if len(_length_calls) == 1:
        return _json.dumps({"summary": _long_reply,
                            "why_it_matters": "It matters for synthetic data research."})
    return _json.dumps({"summary": "It reports 223 tables.",
                        "why_it_matters": "It matters for synthetic data research."})


_shortened = _sum.summarise_item(_cand(0), _long_then_short)
check("over-long first reply is repaired", _shortened["guard"] == "repaired", str(_shortened))

print("compose_sections")
_ten = [_cand(i, source="github" if i in (6, 7, 8) else "arxiv") for i in range(9)] + [
    _cand(9, source="news")
]
_split = _sum.compose_sections(_ten, picks=6, run_date=_date(2026, 11, 4))
check("six top picks", len(_split["top_picks"]) == 6, str(len(_split["top_picks"])))
check("github items after the picks become tools", len(_split["tools"]) == 3, str(len(_split["tools"])))
check("the news item becomes worth a look", len(_split["worth_a_look"]) == 1, str(len(_split["worth_a_look"])))
check("nothing is lost when caps do not bind", len(_split["dropped"]) == 0, str(len(_split["dropped"])))
check("week_end is the run week's Saturday", _split["week_end"] == _sum.published_date("2026-11-07"), str(_split["week_end"]))
check("week_start is the Sunday before it", _split["week_start"] == _sum.published_date("2026-11-01"), str(_split["week_start"]))

_many = [_cand(i, source="github" if i % 2 == 0 else "arxiv") for i in range(20)]
_capped = _sum.compose_sections(_many, picks=6, max_tools=5, max_worth=5, run_date=_date(2026, 11, 4))
check("tools capped at five", len(_capped["tools"]) == 5, str(len(_capped["tools"])))
check("worth a look capped at five", len(_capped["worth_a_look"]) == 5, str(len(_capped["worth_a_look"])))
check("items beyond the caps are reported as dropped", len(_capped["dropped"]) == 4, str(len(_capped["dropped"])))

_days = [_cand(i, day=i, source="github" if i == 1 else "arxiv") for i in range(1, 11)]
_dated = _sum.compose_sections(_days, picks=6, week_end=_sum.published_date("2026-11-10"))
_pick_urls = {item["url"] for item in _dated["top_picks"]}
check("an item older than the week is not a top pick", "https://example.com/1" not in _pick_urls)
check("an item older than the week is not a tool", all(t["url"] != "https://example.com/1" for t in _dated["tools"]))
check("an item older than the week is not in worth a look", all(i["url"] != "https://example.com/1" for i in _dated["worth_a_look"]))
check("every pick is inside the week", all(
    _dated["week_start"] <= _sum.published_date(item["published"]) <= _dated["week_end"]
    for item in _dated["top_picks"]
))
check("every tool and worth item is inside the week", all(
    _dated["week_start"] <= _sum.published_date(item["published"]) <= _dated["week_end"]
    for item in _dated["tools"] + _dated["worth_a_look"]
))

try:
    _sum.compose_sections([_cand(i, score=4) for i in range(3)], run_date=_date(2026, 11, 4))
    check("no item above the score floor raises CompositionError", False)
except _sum.CompositionError:
    check("no item above the score floor raises CompositionError", True)

print("source_label")
check("github label", _sum.source_label({"source": "github", "url": "https://github.com/a/b"}) == "GitHub")
check("arxiv label", _sum.source_label({"source": "arxiv", "url": "https://arxiv.org/abs/1"}) == "arXiv")
check("news uses the publisher host", _sum.source_label({"source": "news", "url": "https://www.remio.ai/post/x"}) == "remio.ai")
check("blog uses the publisher host", _sum.source_label({"source": "blog", "url": "https://openai.com/news/x"}) == "openai.com")

print("dump_report")
_report = {
    "week_start": _sum.published_date("2026-10-29"),
    "week_end": _sum.published_date("2026-11-04"),
    "trend": 'A trend with a colon: "quotes" and an em dash — and 223 tables.',
    "top_picks": [
        {
            "title": 'Title with "quotes": and a colon',
            "url": "https://example.com/a",
            "source": "arXiv",
            "published": _sum.published_date("2026-11-04"),
            "summary": "One sentence. Two sentences.",
            "score": 9,
            "well7_fit": 8,
            "summary_origin": "full text",
            "guard": "passed",
        }
    ],
    "tools": [
        {"name": "owner/repo", "url": "https://github.com/a/b", "note": "A note.", "score": 9}
    ],
    "worth_a_look": [],
}
_dumped = _sum.dump_report(_report, generated_at="2026-11-04T12:00:00+00:00")
_loaded = _yaml.safe_load(_dumped)
check("round-trips through YAML", _loaded["week_end"] == _sum.published_date("2026-11-04"), str(_loaded["week_end"]))
check("quoted title survives", _loaded["top_picks"][0]["title"] == _report["top_picks"][0]["title"], _loaded["top_picks"][0]["title"])
check("unicode survives", "—" in _loaded["trend"])
check("summary survives", _loaded["top_picks"][0]["summary"] == "One sentence. Two sentences.")
check("scores survive", _loaded["top_picks"][0]["score"] == 9 and _loaded["top_picks"][0]["well7_fit"] == 8)
check("tools use name and note", _loaded["tools"][0]["name"] == "owner/repo" and _loaded["tools"][0]["note"] == "A note.")
check("an empty section is omitted", "worth_a_look" not in _loaded)

print("emailer")
from synthetic_data import emailer as _mail

_mail_report = {
    "week_start": _sum.published_date("2026-10-26"),
    "week_end": _sum.published_date("2026-11-01"),
    "trend": "A trend sentence. Another one.",
    "top_picks": [
        {
            "title": "A pick",
            "url": "https://example.com/pick",
            "source": "arXiv",
            "published": _sum.published_date("2026-10-30"),
            "summary": "One sentence. Two sentences.",
        }
    ],
    "tools": [],
    "worth_a_look": [],
}

print("Well7 report branding")
from synthetic_data import render as _render

_brand_md = _render.render_markdown(_mail_report)
_brand_html = _render.render_html(_mail_report)
_brand_pdf = Path("src/synthetic_data/render_pdf.py").read_text(encoding="utf-8")
check("markdown carries the Well7 byline", "Well7 Research Lab" in _brand_md)
check("html eyebrow names Well7", "Well7 Research Lab" in _brand_html)
check("PDF kicker names Well7", "WELL7 RESEARCH LAB" in _brand_pdf)
check("subject prefix is unchanged", _brand_md.startswith("**Subject:** Synthetic Data Weekly — Week of "))
check("contractual footer is unchanged", _brand_md.rstrip().endswith("Auto-generated by the Synthetic Data Research Agent. Reply with feedback."))

with tempfile.TemporaryDirectory() as _tmp:
    _out = Path(_tmp)
    (_out / "report.md").write_text(
        "plain body\n\n1. [A pick](https://example.com/pick)\n", encoding="utf-8"
    )
    (_out / "report.html").write_text("<html><body>html body</body></html>", encoding="utf-8")
    (_out / "Synthetic_Data_Weekly_2026-11-01.pdf").write_bytes(b"%PDF-1.4 fake pdf")

    _msg = _mail.compose(
        _mail_report,
        _out,
        recipients=["a@example.com", "b@example.com"],
        sender="Weekly <weekly@example.com>",
    )
    check(
        "subject comes from the report",
        _msg["Subject"] == "Synthetic Data Weekly — Week of 26 Oct – 1 Nov 2026",
        str(_msg["Subject"]),
    )
    check("recipients are the configured ones", _msg["To"] == "a@example.com, b@example.com", str(_msg["To"]))
    check("sender is the configured From", "weekly@example.com" in _msg["From"], str(_msg["From"]))
    check("message has a Message-ID", bool(_msg["Message-ID"]))
    check("message is multipart/mixed", _msg.get_content_type() == "multipart/mixed", _msg.get_content_type())
    _alternative = _msg.get_payload(0)
    check(
        "body is multipart/alternative",
        _alternative.get_content_type() == "multipart/alternative",
        _alternative.get_content_type(),
    )
    _types = [part.get_content_type() for part in _alternative.get_payload()]
    check("plain text then html", _types == ["text/plain", "text/html"], str(_types))
    check("plain text body is present", "plain body" in _msg.get_body(("plain",)).get_content())
    check("html body is present", "html body" in _msg.get_body(("html",)).get_content())
    _attachments = list(_msg.iter_attachments())
    check("pdf attached", len(_attachments) == 1, str(len(_attachments)))
    check(
        "attachment is the report pdf",
        _attachments[0].get_content_type() == "application/pdf"
        and _attachments[0].get_filename() == "Synthetic_Data_Weekly_2026-11-01.pdf",
        str(_attachments[0].get_filename()),
    )

    _eml = _mail.write_eml(_msg, _out / "email.eml")
    check("eml is written", _eml.exists() and _eml.stat().st_size > 0)

    check(
        "recipients default to config",
        _mail.resolve_recipients({"recipients": ["x@example.com"]}, {}, test=False, to=None)
        == ["x@example.com"],
    )
    check(
        "an explicit recipient overrides config",
        _mail.resolve_recipients({"recipients": ["x@example.com"]}, {}, test=False, to=["y@example.com"])
        == ["y@example.com"],
    )
    check(
        "a test send uses DRY_RUN_RECIPIENT",
        _mail.resolve_recipients(
            {"recipients": ["x@example.com"]}, {"DRY_RUN_RECIPIENT": "me@example.com"}, test=True, to=None
        )
        == ["me@example.com"],
    )
    try:
        _mail.resolve_recipients({"recipients": []}, {}, test=False, to=None)
    except _mail.EmailError as _exc:
        check("no recipients is a clear error", "recipient" in str(_exc).lower(), str(_exc))
    else:
        check("no recipients is a clear error", False, "no exception")

    try:
        _mail.smtp_settings({"SMTP_HOST": "smtp.example.com", "SMTP_PORT": "587"})
    except _mail.EmailError as _exc:
        check("missing credential is a clear error", "SMTP_USER" in str(_exc), str(_exc))
    else:
        check("missing credential is a clear error", False, "no exception")

    _settings = _mail.smtp_settings(
        {
            "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "587",
            "SMTP_USER": "me@example.com",
            "SMTP_PASSWORD": "secret",
            "MAIL_FROM": "Weekly <weekly@example.com>",
        }
    )
    check("smtp port is an integer", _settings["port"] == 587, str(_settings["port"]))
    check("smtp sender is mail-from", _settings["sender"] == "Weekly <weekly@example.com>", _settings["sender"])

    _sent = {}

    class _FakeSMTP:
        def __init__(self):
            self.logged = None
            self.sent = None

        def __enter__(self):
            return self

        def __exit__(self, *exc_info):
            return False

        def ehlo(self):
            pass

        def starttls(self, context=None):
            self.started_tls = True

        def login(self, user, password):
            self.logged = (user, password)

        def send_message(self, message):
            self.sent = message

    def _fake_factory(host, port, timeout, ssl=False):
        _sent["host"] = host
        _sent["port"] = port
        _sent["ssl"] = ssl
        _sent["smtp"] = _FakeSMTP()
        return _sent["smtp"]

    _mail.send_message(_msg, _settings, smtp_factory=_fake_factory)
    check("smtp host used", _sent["host"] == "smtp.example.com", str(_sent["host"]))
    check("starttls used on port 587", _sent["ssl"] is False)
    check("smtp login used", _sent["smtp"].logged == ("me@example.com", "secret"), str(_sent["smtp"].logged))
    check("smtp received the message", _sent["smtp"].sent is _msg)

    _smtp_cfg = _out / "config.yaml"
    _smtp_cfg.write_text("recipients:\n  - a@example.com\n", encoding="utf-8")
    _report_yaml = _out / "source.yaml"
    _report_yaml.write_text(_yaml.safe_dump(_mail_report), encoding="utf-8")
    _history = _out / "history.db"
    _sent.clear()

    _summary = _mail.deliver(
        str(_report_yaml),
        str(_smtp_cfg),
        dry_run=True,
        db_path=str(_history),
        env={"MAIL_FROM": "Weekly <weekly@example.com>"},
        smtp_factory=_fake_factory,
    )
    check("dry run writes an eml", _summary["dry_run"] and Path(_summary["path"]).exists(), str(_summary))
    check("dry run sends nothing", _sent.get("smtp") is None, str(_sent))
    check("dry run records no history", not _history.exists())

    # report_build.py drops dead links from what it renders but leaves
    # source.yaml untouched. The send path must record only what was published.
    _send_report = {
        **_mail_report,
        "worth_a_look": [
            {
                "title": "A dead link",
                "url": "https://example.com/dead",
                "source": "news",
                "published": _sum.published_date("2026-10-31"),
                "note": "Dropped by report_build; never published.",
            }
        ],
    }
    _report_yaml.write_text(_yaml.safe_dump(_send_report), encoding="utf-8")

    _mail.deliver(
        str(_report_yaml),
        str(_smtp_cfg),
        dry_run=False,
        db_path=str(_history),
        env={
            "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "587",
            "SMTP_USER": "me@example.com",
            "SMTP_PASSWORD": "secret",
            "MAIL_FROM": "Weekly <weekly@example.com>",
        },
        smtp_factory=_fake_factory,
    )
    import sqlite3 as _sqlite3

    _conn = _sqlite3.connect(_history)
    try:
        _recorded = {row[0] for row in _conn.execute("SELECT url FROM sent_urls")}
    finally:
        _conn.close()
    check("a real send records the links", "https://example.com/pick" in _recorded, str(_recorded))
    check(
        "a link report_build dropped is not recorded",
        "https://example.com/dead" not in _recorded,
        str(_recorded),
    )

print("schedule_task")
import schedule_task as _sched

check("Saturday maps to SAT", _sched.parse_schedule("Saturday 08:00") == ("SAT", "08:00"))
check("lower case is accepted", _sched.parse_schedule("saturday 08:00") == ("SAT", "08:00"))
try:
    _sched.parse_schedule("Funday 08:00")
except ValueError as _exc:
    check("an unknown day is rejected", "Funday" in str(_exc), str(_exc))
else:
    check("an unknown day is rejected", False, "no exception")
try:
    _sched.parse_schedule("Saturday 25:00")
except ValueError as _exc:
    check("an invalid time is rejected", "25:00" in str(_exc), str(_exc))
else:
    check("an invalid time is rejected", False, "no exception")

_task_cmd = _sched.build_create_command(Path(r"C:\Users\badrf\Desktop\Work\synthetic data"), "Saturday 08:00")
check("task is weekly", _task_cmd[_task_cmd.index("/SC") + 1] == "WEEKLY", str(_task_cmd))
check("task runs on Saturday", _task_cmd[_task_cmd.index("/D") + 1] == "SAT", str(_task_cmd))
check("task runs at the configured time", _task_cmd[_task_cmd.index("/ST") + 1] == "08:00", str(_task_cmd))
check(
    "task calls the weekly runner",
    "run_weekly.ps1" in _task_cmd[_task_cmd.index("/TR") + 1],
    _task_cmd[_task_cmd.index("/TR") + 1],
)
check(
    "the default task never asks the wrapper to send",
    "-Send" not in _task_cmd[_task_cmd.index("/TR") + 1],
    _task_cmd[_task_cmd.index("/TR") + 1],
)
_send_cmd = _sched.build_create_command(
    Path(r"C:\Users\badrf\Desktop\Work\synthetic data"), "Saturday 08:00", send=True
)
check(
    "--send asks the wrapper to send for real",
    "-Send" in _send_cmd[_send_cmd.index("/TR") + 1],
    _send_cmd[_send_cmd.index("/TR") + 1],
)

_wrapper_src = Path("scripts/run_weekly.ps1").read_text(encoding="utf-8")
check("the wrapper knows the send switch", "[switch]$Send" in _wrapper_src)
check("the wrapper dry-runs unless -Send is passed", '"--dry-run"' in _wrapper_src)
check("the wrapper logs which mode it used", "mode" in _wrapper_src.lower())
check("the wrapper logs the exact command", '">>>' in _wrapper_src)

print("Phase 3 wiring")
_write = Path("write_report.py").read_text(encoding="utf-8")
_check = Path("report_build.py").read_text(encoding="utf-8")
_config = _yaml.safe_load(Path("config.yaml").read_text(encoding="utf-8"))
check("write_report reads candidates.json", "candidates.json" in _write)
check("write_report has an offline mode", "--no-llm" in _write)
check("report_build supports --no-record", "--no-record" in _check and "history_recorded" in _check)
check("config has a summarising block", isinstance(_config.get("summarising"), dict))
check("config picks stay inside the format bound", 5 <= int(_config["summarising"]["picks"]) <= 10)
check("summary version is recorded", isinstance(_sum.SUMMARY_VERSION, str) and _sum.SUMMARY_VERSION)

import report_build as _rb

check("a run log for the same week is not stale",
      _rb.run_log_stale_reason({"week_end": "2026-11-14"}, "2026-11-14") == "")
check("a run log for another week is stale",
      _rb.run_log_stale_reason({"week_end": "2026-11-07"}, "2026-11-14") != "")
check("a legacy run log collected inside the week is accepted",
      _rb.run_log_stale_reason(
          {"run_at": "2026-11-11T09:00:00+00:00"}, "2026-11-14") == "")
check("a legacy run log collected outside the week is stale",
      _rb.run_log_stale_reason(
          {"run_at": "2026-11-20T09:00:00+00:00"}, "2026-11-14") != "")

# The scheduled job installs requirements.txt, not the dev group. Regenerating
# it with the default `uv export` once pulled in torch and sdv.
_requirements = Path("requirements.txt").read_text(encoding="utf-8").lower()
check("requirements.txt excludes the dev group",
      "torch==" not in _requirements
      and "jupyterlab==" not in _requirements
      and "sdv==" not in _requirements)

print("Phase 4 report node")
from synthetic_data import graph as _graph

_cache_dir = Path(tempfile.mkdtemp())
_item_calls = []


def _fake_chat(messages):
    prompt = messages[0]["content"]
    if "opening paragraph" in prompt:
        return _json.dumps({"trend": "A plain trend sentence."})
    _item_calls.append(1)
    return _json.dumps({"summary": "A plain summary sentence.",
                        "why_it_matters": "It helps Well7 build private tables."})


def _down_chat(messages):
    raise RuntimeError("model down")


_graph_items = [
    _cand(i, source="github" if i in (6, 7, 8) else "arxiv") for i in range(10)
]
_graph._CACHE_PATH = str(_cache_dir / "summary_cache.json")
_graph.configure(
    settings={"summarising": {"picks": 5, "max_tools": 5, "max_worth_a_look": 5}},
    chat_fn=_fake_chat,
)
_first_run = _graph.report_node({"errors": [], "shortlist": _graph_items, "run_date": "2026-11-04"}, None)
check("report node builds picks, tools and worth-a-look", len(_first_run["report"]["top_picks"]) == 5 and len(_first_run["report"]["tools"]) == 3, str(_first_run.get("errors")))
check("report node saves the summary cache", len(_json.loads((_cache_dir / "summary_cache.json").read_text(encoding="utf-8"))["entries"]) == 10)

_calls_before = len(_item_calls)
_graph.report_node({"errors": [], "shortlist": _graph_items, "run_date": "2026-11-04"}, None)
check("a rerun on the same week makes no summary calls", len(_item_calls) == _calls_before, str(len(_item_calls) - _calls_before))

_graph._CACHE_PATH = str(_cache_dir / "down.json")
_graph.configure(chat_fn=_down_chat)
_down_run = _graph.report_node({"errors": [], "shortlist": _graph_items, "run_date": "2026-11-04"}, None)
check("an all-fallback run is flagged in the state", any("extractive fallback" in item for item in _down_run["errors"]), str(_down_run["errors"]))
check("fallbacks are never cached", _json.loads((_cache_dir / "down.json").read_text(encoding="utf-8"))["entries"] == {})

print("Phase 5 wiring")
_send_src = Path("send_report.py").read_text(encoding="utf-8")
_graph_src = Path("src/synthetic_data/graph.py").read_text(encoding="utf-8")
_cli_src = Path("src/synthetic_data/cli.py").read_text(encoding="utf-8")
check("send_report has a dry run", "--dry-run" in _send_src)
check("send_report has a test send", "--test" in _send_src)
check("graph has a send node", 'add_node("send"' in _graph_src)
check("graph sends after render", 'add_edge("render", "send")' in _graph_src)
check("graph renders without recording history", '"--no-record"' in _graph_src)
check("graph collects with history", "use_history=True" in _graph_src)
check("cli exposes --dry-run and --no-email", "--dry-run" in _cli_src and "--no-email" in _cli_src)
check(
    "config schedule parses",
    _sched.parse_schedule(_config.get("schedule", ""))[0] == "SAT",
    str(_config.get("schedule")),
)
check(
    "smtp credentials are documented, not hard-coded",
    "SMTP_PASSWORD" in Path(".env.example").read_text(encoding="utf-8")
    and "SMTP_PASSWORD=" not in Path("config.yaml").read_text(encoding="utf-8"),
)

# ---------------------------------------------------------------------------
# 2026-11-11 pipeline improvements. Written before the implementation so the
# suite is red until every task lands.
# ---------------------------------------------------------------------------

print("week window")
from synthetic_data import week as _week

_wed = _week.week_bounds(_date(2026, 11, 11))
check("a Wednesday run covers Sunday..Saturday", _wed == (_date(2026, 11, 8), _date(2026, 11, 14)), str(_wed))
check("Saturday run ends on that Saturday", _week.week_bounds(_date(2026, 11, 14)) == _wed)
check("Sunday run starts on that Sunday", _week.week_bounds(_date(2026, 11, 8))[0] == _date(2026, 11, 8))
check("consecutive weeks do not overlap", _week.week_bounds(_date(2026, 11, 18))[0] == _wed[1] + timedelta(days=1))
check("in_week accepts an ISO datetime", _week.in_week("2026-11-11T10:00:00Z", _wed))
check("in_week accepts a date", _week.in_week(_date(2026, 11, 8), _wed))
check("in_week rejects a day outside the week", not _week.in_week("2026-11-07", _wed))
check("in_week rejects unparseable input", not _week.in_week("not a date", _wed))
check("_in_window with week accepts a day inside",
      _in_window(datetime(2026, 11, 10, tzinfo=timezone.utc), cutoff, week=_wed))
check("_in_window with week rejects a day outside",
      not _in_window(datetime(2026, 11, 7, tzinfo=timezone.utc), cutoff, week=_wed))
check("_in_window with week rejects a future day",
      not _in_window(datetime(2026, 11, 20, tzinfo=timezone.utc), cutoff, week=_wed))

print("primary-source dedupe")
_older_primary = Item(title="paper", url="https://x/p?utm_source=a", source="arxiv", published=NOW - timedelta(days=3))
_newer_secondary = Item(title="discussion", url="https://x/p", source="hn", published=NOW)
_kept, _ = dedupe_items([_older_primary, _newer_secondary])
check("dedupe keeps the primary source even when older", _kept[0].source == "arxiv", _kept[0].source)

print("canonical story key")
from synthetic_data.links import canonical_target, story_key

check("arxiv versions share one canonical target",
      canonical_target("https://arxiv.org/abs/2610.35521v2") == canonical_target("http://arxiv.org/abs/2610.35521v1"))
check("arxiv canonical target carries the id", "2610.35521" in canonical_target("https://arxiv.org/abs/2610.35521v2"))
check("github repo is canonicalised", canonical_target("https://github.com/Owner/Repo/tree/main") == "github:owner/repo")
check("an unrelated url has no canonical target", canonical_target("https://example.com/post") == "")
check("story_key prefers target_url",
      story_key({"url": "https://news.ycombinator.com/item?id=9", "target_url": "https://arxiv.org/abs/2610.35521"})
      == canonical_target("https://arxiv.org/abs/2610.35521"))
check("story_key normalises a plain (non-canonical) target_url",
      story_key({"url": "https://news.ycombinator.com/item?id=42",
                 "target_url": "https://example.com/blog/p?utm_source=x"})
      == "https://example.com/blog/p")

_paper = _item("A tabular synthesis method", "https://arxiv.org/abs/2610.35521", score=9, well7=8)
_hn_post = _item("Show HN: tables from nowhere", "https://news.ycombinator.com/item?id=42", score=8, well7=7)
_hn_post["target_url"] = "https://arxiv.org/abs/2610.35521v2"
_merged = _rank.group_duplicates([_paper, _hn_post])
check("HN post linking to the paper is merged into it",
      next(r for r in _merged if "ycombinator" in r["url"])["duplicate_of"] == _paper["url"])
check("the paper stays the representative", next(r for r in _merged if r["url"] == _paper["url"])["duplicate_of"] is None)

_hn_high = _item("Show HN: tables", "https://news.ycombinator.com/item?id=7",
                 score=10, well7=10, source="hn")
_hn_high["target_url"] = "https://arxiv.org/abs/2610.77777"
_paper_low = _item("A tabular method", "https://arxiv.org/abs/2610.77777",
                   score=6, well7=5, source="arxiv")
_primary_group = _rank.group_duplicates([_hn_high, _paper_low])
check("primary source wins the duplicate group over a higher-scored post",
      next(r for r in _primary_group if r["url"] == _paper_low["url"])["duplicate_of"] is None)

print("keyword prefilter")
_kw = ["synthetic data", "tabular synthesis", "differential privacy"]
_pf = [
    _item("A synthetic data method for tabular generation", "https://pf/1"),
    _item("3D Gaussian splatting for novel view synthesis", "https://pf/2"),
]
_skip = _rank.prefilter_indices(_pf, _kw)
check("obvious noise is prefiltered", 1 in _skip, str(_skip))
check("a relevant item is not prefiltered", 0 not in _skip, str(_skip))
check("an empty keyword list filters nothing", _rank.prefilter_indices(_pf, []) == set())

print("final editor re-rank")
_editor_calls = []


def _editor(messages):
    _editor_calls.append(messages[0]["content"])
    return _json.dumps({"scores": [
        {"id": 0, "score": 9, "well7_fit": 8, "reason": "best"},
        {"id": 1, "score": 4, "well7_fit": 3, "reason": "weak"},
    ]})


_editor_rows = [
    _item("First candidate", "https://ed/1", score=6, well7=6),
    _item("Second candidate", "https://ed/2", score=5, well7=5),
]
_editor_out = _rank.rerank_top(_editor_rows, _editor, top_n=2)
check("editor pass is a single call", len(_editor_calls) == 1, str(len(_editor_calls)))
check("editor pass keeps every row", len(_editor_out) == 2)
check("editor pass updates candidate 0 to 9", _editor_out[0]["score"] == 9, str(_editor_out[0]["score"]))
check("editor pass updates candidate 1 to 4", _editor_out[1]["score"] == 4, str(_editor_out[1]["score"]))
check("editor pass keeps each row's own well7_fit",
      (_editor_out[0]["well7_fit"], _editor_out[1]["well7_fit"]) == (8, 3),
      str([r["well7_fit"] for r in _editor_out]))
check("editor pass marks the edited rows", all(r.get("editor_pass") for r in _editor_out))
check("editor prompt shows all candidates", "https://ed/1" in _editor_calls[0] and "https://ed/2" in _editor_calls[0])

# A reply that omits well7_fit must not erase the batch-stage value.
_editor_no_well7 = _rank.rerank_top(
    [_item("Third candidate", "https://ed/3", score=6, well7=5)],
    lambda _messages: _json.dumps({"scores": [{"id": 0, "score": 9, "reason": "best"}]}),
    top_n=1,
)
check("editor pass preserves well7_fit when the reply omits it",
      _editor_no_well7[0]["well7_fit"] == 5, str(_editor_no_well7[0]["well7_fit"]))

# The CLI latches editor_applied only when every row the editor was meant to
# re-score carries the marker. A partial reply must therefore stay visible.
_editor_targets = _rank.editor_target_indices(
    [
        _item("kept", "https://et/1", score=9),
        _item("prefiltered", "https://et/2", score=1),
        {**_item("unscored", "https://et/3", score=0), "score_status": "unscored"},
        _item("low", "https://et/4", score=2),
    ],
    2,
)
check("editor targets skip prefiltered and unscored rows",
      _editor_targets == [0, 3], str(_editor_targets))
_partial_editor = _rank.rerank_top(
    [_item("a", "https://pe/1", score=9), _item("b", "https://pe/2", score=8),
     _item("c", "https://pe/3", score=7)],
    lambda _messages: _json.dumps({"scores": [{"id": 0, "score": 9, "reason": "only one"}]}),
    top_n=3,
)
check("a partial editor reply marks only the rows it returned",
      sum(1 for row in _partial_editor if row.get("editor_pass")) == 1,
      str([row.get("editor_pass") for row in _partial_editor]))
check("a partial editor reply leaves the rest unmarked, so the latch stays false",
      not all(_partial_editor[index].get("editor_pass")
              for index in _rank.editor_target_indices(_partial_editor, 3)),
      str([row.get("editor_pass") for row in _partial_editor]))

print("well7 divergence guard")
_diverged = _rank.diversify_well7_fit([
    _item("A generic LLM inference benchmark", "https://dv/generic", score=9, well7=9),
    _item("Differentially private tabular synthesis with DP-SGD", "https://dv/relevant", score=9, well7=9),
    _item("Top 7 Python Libraries for Time Series Analysis", "https://dv/ts", score=9, well7=9),
    _item("A great new LLM dataset", "https://dv/great", score=9, well7=9),
    _item("A tour of Amsterdam", "https://dv/mst", score=9, well7=9),
])
check("a generic item cannot have well7_fit equal to score",
      next(r for r in _diverged if r["url"] == "https://dv/generic")["well7_fit"] == 7)
check("a Well7-relevant item keeps its fit",
      next(r for r in _diverged if r["url"] == "https://dv/relevant")["well7_fit"] == 9)
check("'time series' written with a space is a signal",
      next(r for r in _diverged if r["url"] == "https://dv/ts")["well7_fit"] == 9)
check("an ordinary 'great' does not defeat the ceiling",
      next(r for r in _diverged if r["url"] == "https://dv/great")["well7_fit"] == 7)
check("'mst' only matches a whole token",
      next(r for r in _diverged if r["url"] == "https://dv/mst")["well7_fit"] == 7)
check("the ceiling never drops below 1",
      _rank.diversify_well7_fit([_item("A generic note", "https://dv/low", score=2, well7=2)])[0]["well7_fit"] == 1)

print("structured output and API key names")
check("LLM_API_KEY is accepted", _llm.require_api_key({"LLM_API_KEY": "from-workflow"}) == "from-workflow")
check("OPENROUTER_API_KEY wins when both are set",
      _llm.require_api_key({"OPENROUTER_API_KEY": "primary", "LLM_API_KEY": "fallback"}) == "primary")
try:
    _llm.require_api_key({})
    check("missing both API keys raises", False)
except _llm.LLMError:
    check("missing both API keys raises", True)


class _FakeResponse:
    def __init__(self, code, text):
        self.status_code = code
        self.text = text

    def json(self):
        return {"choices": [{"message": {"content": '{"scores": []}'}}]}


class _FakeClient:
    def __init__(self):
        self.payloads = []

    def post(self, url, headers=None, json=None, timeout=None):
        self.payloads.append(dict(json or {}))
        if len(self.payloads) == 1 and "response_format" in self.payloads[0]:
            return _FakeResponse(400, "response_format is not supported")
        return _FakeResponse(200, "")


_json_client = _FakeClient()
_json_text, _ = _llm.chat(
    [{"role": "user", "content": "score these"}],
    api_key="k", model="m", json_mode=True,
    client=_json_client, attempts=2, sleep=lambda _s: None,
)
check("json_mode asks for a JSON object",
      _json_client.payloads[0].get("response_format") == {"type": "json_object"},
      str(_json_client.payloads[0].get("response_format")))
check("json_mode falls back when the provider rejects it",
      _json_text == '{"scores": []}' and "response_format" not in _json_client.payloads[1],
      str(_json_client.payloads))

print("why it matters and trend omission")
_wim = _sum.summarise_item(
    _cand(0),
    lambda _m: _json.dumps({"summary": "It reports 223 tables.", "why_it_matters": "Well7 can use the 223 tables."}),
)
check("summarise_item returns why_it_matters", bool(_wim.get("why_it_matters")), str(_wim))
check("why_it_matters is guarded against invented numbers",
      _sum.summarise_item(_cand(0), lambda _m: _json.dumps({
          "summary": "It reports 223 tables.", "why_it_matters": "It reports 900 tables."}))["guard"] == "extractive")
_missing_why_calls = []


def _no_why(_messages):
    _missing_why_calls.append(_messages)
    return _json.dumps({"summary": "It reports 223 tables."})


_missing_why = _sum.summarise_item(_cand(0), _no_why)
check("a reply without why_it_matters still keeps its summary",
      _missing_why["guard"] == "passed" and "223" in _missing_why["summary"],
      str(_missing_why))
check("a missing why does not cost a second model call",
      len(_missing_why_calls) == 1, str(len(_missing_why_calls)))
_why_long = _sum.summarise_item(
    _cand(0),
    lambda _m: _json.dumps({
        "summary": "It reports 223 tables.",
        "why_it_matters": " ".join(["word"] * 100),
    }),
)
check("an over-long why is clipped, not fatal",
      _why_long["guard"] == "passed"
      and _sum.word_count(_why_long["why_it_matters"]) <= _sum.WORDS_WHY,
      f"guard={_why_long['guard']} words={_sum.word_count(_why_long['why_it_matters'])}")
try:
    _sum.compose_sections([])
    check("compose_sections rejects an empty week instead of re-dating it", False)
except _sum.CompositionError:
    check("compose_sections rejects an empty week instead of re-dating it", True)
_wim_report = {
    "week_start": _date(2026, 11, 1), "week_end": _date(2026, 11, 7),
    "trend": "A trend.",
    "top_picks": [{"title": "t", "url": "https://x", "source": "arXiv",
                   "published": _date(2026, 11, 4), "summary": "s",
                   "why_it_matters": "It helps Well7 build private tables."}],
    "tools": [], "worth_a_look": [],
}
check("dump_report emits why_it_matters", "why_it_matters" in _sum.dump_report(_wim_report))
check("dump_report omits an empty trend", "trend:" not in _sum.dump_report({**_wim_report, "trend": ""}))

_omitted = _sum.summarise_trend([_cand(0)], _always_down)
check("a failed trend is omitted and flagged",
      _omitted["trend"] == "" and _omitted["guard"] == "omitted", str(_omitted))
check("fallback_trend no longer pastes sentences", _sum.fallback_trend([_cand(0)]) == "")

print("score floors and no padding")
_floor_items = [_cand(i, score=9 if i < 3 else 4) for i in range(8)]
_sections = _sum.compose_sections(_floor_items, picks=6, run_date=_date(2026, 11, 4))
check("sections are not padded with below-floor items", len(_sections["top_picks"]) == 3,
      str(len(_sections["top_picks"])))
check("below-floor items are reported", len(_sections["dropped_below_floor"]) == 5,
      str(len(_sections["dropped_below_floor"])))

print("render: optional trend, why-it-matters line, footer counts")
_no_trend = {**_mail_report}
_no_trend.pop("trend", None)
_no_trend["source_counts"] = {"arxiv": 12, "news": 3}
_no_trend_md = _render.render_markdown(_no_trend)
_no_trend_html = _render.render_html(_no_trend)
check("markdown omits the trend section when there is no trend", "## Trend of the week" not in _no_trend_md)
check("html omits the trend section too", "Trend of the week" not in _no_trend_html)
check("markdown footer shows per-source counts", "arxiv" in _no_trend_md and "12" in _no_trend_md)
check("html footer shows per-source counts", "arxiv" in _no_trend_html and "12" in _no_trend_html)
check("contractual footer is still the last line",
      _no_trend_md.rstrip().endswith("Auto-generated by the Synthetic Data Research Agent. Reply with feedback."))
_wim_md = _render.render_markdown({**_mail_report, "top_picks": [
    {**_mail_report["top_picks"][0], "why_it_matters": "It helps Well7 build private tables."}]})
check("why it matters is its own line", "Why it matters for Well7" in _wim_md)

print("history durability")
_hist_dir = Path(tempfile.mkdtemp())
_hist_db = _hist_dir / "history.db"
mark_sent([("https://seen.example/x", "already sent", "arxiv")], db_path=str(_hist_db))
check("mark_sent writes a backup", (_hist_dir / "history.db.bak").exists())
_hist_db.unlink()
_seen_item = Item(title="t", url="https://seen.example/x", source="arxiv", published=NOW)
check("a lost main db still remembers sent links via the backup",
      len(filter_seen_urls([_seen_item], db_path=str(_hist_db))) == 0)

print("config wiring (2026-11-11)")
check("config has the score floors", all(
    k in _config["summarising"] for k in ("min_score_top", "min_score_tools", "min_score_worth")))
check("config has the editor pass size", "editor_pass_size" in _config["ranking"])
check("config enables the keyword prefilter", bool(_config["ranking"].get("prefilter")))

print("Phase 4 rank node")
_rank_fake_calls = []


def _rank_node_fake(messages):
    prompt = messages[0]["content"]
    _rank_fake_calls.append(prompt)
    editor = "final editor calibrating" in prompt
    body = prompt.split("BEGIN ITEMS\n", 1)[-1].split("\nEND ITEMS", 1)[0]
    lines = [line for line in body.splitlines() if line.strip()]
    rows = [
        {"id": i, "score": 9 if editor else 8,
         "well7_fit": 9 if editor else 7, "reason": "relevant"}
        for i in range(len(lines))
    ]
    return _json.dumps({"scores": rows})


_graph.configure(
    settings={
        "ranking": {"prefilter": True, "editor_pass_size": 20, "batch_size": 15, "concurrency": 3},
        "keywords": ["synthetic data", "tabular data"],
    },
    chat_fn=_rank_node_fake,
)
_rank_node_items = [
    _item("A synthetic data method for tabular generation", "https://rn/1",
          published="2026-11-11T00:00:00Z"),
    _item("3D Gaussian splatting for novel views", "https://rn/2",
          published="2026-11-11T00:00:00Z"),
]
_rank_node_out = _graph.rank_node(
    {"errors": [], "deduped_items": _rank_node_items, "run_date": "2026-11-11"}, None
)
_rn_rows = _rank_node_out["ranked_items"]
check("rank node keeps every item", len(_rn_rows) == 2, str(len(_rn_rows)))
check("rank node prefilters obvious noise",
      next(r for r in _rn_rows if r["url"] == "https://rn/2")["score_status"] == "prefiltered")
check("rank node scores the relevant item",
      next(r for r in _rn_rows if r["url"] == "https://rn/1")["score_status"] == "scored")
check("rank node runs the editor pass", any("final editor calibrating" in p for p in _rank_fake_calls))

# The guard the CLI applies must exist on the graph path too: a scheduled run
# with a dead model must say so, not quietly render a thin report.
_graph.configure(chat_fn=_always_down)
_guard_out = _graph.rank_node(
    {
        "errors": [],
        "deduped_items": [
            _item("A synthetic data method", "https://rn/guard",
                  published="2026-11-11T00:00:00Z")
        ],
        "run_date": "2026-11-11",
    },
    None,
)
check("rank node records a score guard error when nothing could be scored",
      any(str(error).startswith("rank:") for error in _guard_out["errors"]),
      str(_guard_out["errors"]))
check("rank node leaves an unscored row visible instead of inventing a score",
      _guard_out["ranked_items"][0]["score_status"] == "unscored",
      str(_guard_out["ranked_items"]))
_graph.configure(chat_fn=_rank_node_fake)

print("score_items failure policy")
_transport_calls = []


def _provider_down(messages):
    _transport_calls.append(messages)
    raise RuntimeError("provider down")


_down_rows = _rank.score_items(
    [_item("A", "https://sc/1"), _item("B", "https://sc/2")], _provider_down
)
check("a failed batch is not retried per item",
      len(_transport_calls) == 1, str(len(_transport_calls)))
check("a failed batch leaves every row unscored",
      all(r.get("score_status") == "unscored" for r in _down_rows),
      str([r.get("score_status") for r in _down_rows]))

_garbage_calls = []


def _garbage(messages):
    _garbage_calls.append(messages)
    return "this is not the JSON you are looking for"


_garbage_rows = _rank.score_items(
    [_item(f"g{i}", f"https://gr/{i}") for i in range(6)], _garbage, batch_size=6
)
check("unparseable per-item replies stop after three",
      len(_garbage_calls) == 4, str(len(_garbage_calls)))
check("unparseable replies leave every row unscored",
      all(r.get("score_status") == "unscored" for r in _garbage_rows),
      str([r.get("score_status") for r in _garbage_rows]))

print("score cache never freezes a failure")
import rank_items as _rank_items

_cache_file = Path(tempfile.mkdtemp()) / "score_cache.json"
_cache_file.write_text(_json.dumps({
    "model": "m",
    "rubric": _rank.RUBRIC_VERSION,
    "scores": {
        "unscored": {"score": 0, "score_status": "unscored"},
        "scored": {"score": 8, "score_status": "scored", "reason": "ok"},
    },
    "editor": {"applied": True, "size": 20},
}), encoding="utf-8")
_cached, _applied, _size = _rank_items.load_cache(str(_cache_file), "m")
check("an unscored cache entry is not served", "unscored" not in _cached, str(_cached))
check("a scored cache entry is still served",
      _cached.get("scored", {}).get("score") == 8, str(_cached))

print("html escaping")
_escaped = _render.render_html({**_mail_report, "top_picks": [
    {**_mail_report["top_picks"][0],
     "title": "<script>alert(1)</script>",
     "summary": "A & B"}
]})
check("model/feed text is html-escaped",
      "<script>" not in _escaped
      and "&lt;script&gt;" in _escaped
      and "A &amp; B" in _escaped,
      _escaped[:200])

print("graph fetch failure and report fallback")
_fb_rows = [
    _item("keep", "https://g/keep", score=9, published="2026-11-11T00:00:00Z"),
    {**_item("dup", "https://g/dup", score=9, published="2026-11-11T00:00:00Z"),
     "duplicate_of": "https://g/keep"},
    _item("old", "https://g/old", score=9, published="2026-11-01T00:00:00Z"),
    {**_item("unscored", "https://g/u", score=0, published="2026-11-11T00:00:00Z"),
     "score_status": "unscored"},
]
_fb = _graph._eligible_rows(_fb_rows, (_date(2026, 11, 8), _date(2026, 11, 14)))
check("report fallback drops duplicates, unscored and out-of-week rows",
      [r["url"] for r in _fb] == ["https://g/keep"], str([r["url"] for r in _fb]))

_original_fetch_one = _graph._fetch_one
_graph._fetch_one = lambda _record: (_ for _ in ()).throw(RuntimeError("boom"))
try:
    _graph.configure(
        settings={"max_top_picks": 10, "ranking": {"github_share_cap": 3}},
        chat_fn=lambda _messages: "{}",
    )
    _fetch_out = _graph.fetch_node(
        {"errors": [], "ranked_items": [_fb_rows[0]], "run_date": "2026-11-11"}, None
    )
finally:
    _graph._fetch_one = _original_fetch_one
check("a failed fetch leaves shortlist unset so the filtered fallback runs",
      "shortlist" not in _fetch_out, str(sorted(_fetch_out.keys())))

_clean_bad = _graph.clean_node(
    {"errors": [], "raw_items": [{"title": "no url or source"}]}, None
)
check("clean node records a bad item instead of raising",
      _clean_bad["deduped_items"] == []
      and any(str(e).startswith("clean:") for e in _clean_bad["errors"]),
      str(_clean_bad))

print("corrupt history recovers from its backup")
_corrupt_dir = Path(tempfile.mkdtemp())
_corrupt_db = _corrupt_dir / "history.db"
mark_sent([("https://seen.example/y", "seen", "arxiv")], db_path=str(_corrupt_db))
_corrupt_db.write_bytes(b"not a sqlite database")
_added = mark_sent([("https://seen.example/z", "new", "arxiv")], db_path=str(_corrupt_db))
check("mark_sent rebuilds a corrupt main db instead of raising", _added == 1, str(_added))
check("the backup row survives the rebuild",
      filter_seen_urls(
          [Item(title="y", url="https://seen.example/y", source="arxiv", published=NOW)],
          db_path=str(_corrupt_db),
      ) == [])
check("the newly sent row is recorded too",
      filter_seen_urls(
          [Item(title="z", url="https://seen.example/z", source="arxiv", published=NOW)],
          db_path=str(_corrupt_db),
      ) == [])

print("pdf without a trend")
from synthetic_data.render_pdf import render_pdf as _render_pdf

_pdf_dir = Path(tempfile.mkdtemp())
_pdf_path = _pdf_dir / "no-trend.pdf"
_render_pdf({**_mail_report, "trend": ""}, str(_pdf_path))
check("PDF renders with no trend section",
      _pdf_path.exists() and _pdf_path.stat().st_size > 1000,
      f"{_pdf_path.stat().st_size if _pdf_path.exists() else 0} bytes")

print("verify_report new-schema path")
import subprocess as _subprocess
import sys as _sys

_fixture_report = {
    "week_start": _date(2026, 11, 8),
    "week_end": _date(2026, 11, 14),
    "week_mode": "run_date",
    "trend": "",
    "top_picks": [{
        "title": "A private tabular method",
        "url": "https://example.com/a",
        "source": "arXiv",
        "published": _date(2026, 11, 10),
        "summary": "It reports 223 tables.",
        "why_it_matters": "It helps Well7 build private tables.",
        "score": 9,
    }],
    "tools": [],
    "worth_a_look": [],
    "source_counts": {"arxiv": 12, "news": 3},
}
_fixture_log = {
    "schema": "2026-11-11",
    "week_mode": "run_date",
    "week_start": "2026-11-08",
    "week_end": "2026-11-14",
    "items_found": 10,
    "items_after_dedupe": 9,
    "links_dead": 0,
    "source_errors": [],
    "trend_omitted": True,
    "score_floors": {"top": 7, "tools": 6, "worth": 5},
    "source_counts": {"arxiv": 12, "news": 3},
    "why_it_matters": True,
}


def _write_verify_fixture(report, log):
    directory = Path(tempfile.mkdtemp()) / f"week-{report['week_end']}"
    directory.mkdir(parents=True)
    (directory / "report.md").write_text(_render.render_markdown(report), encoding="utf-8")
    (directory / "report.html").write_text(_render.render_html(report), encoding="utf-8")
    (directory / "source.yaml").write_text(_yaml.safe_dump(report), encoding="utf-8")
    (directory / "run_log.json").write_text(_json.dumps(log), encoding="utf-8")
    (directory / f"Synthetic_Data_Weekly_{report['week_end']}.pdf").write_bytes(
        b"%PDF-1.4\n" + b"0" * 50_000
    )
    return directory / "source.yaml"


_good_path = _write_verify_fixture(_fixture_report, _fixture_log)
_good = _subprocess.run(
    [_sys.executable, "verify_report.py", str(_good_path)],
    capture_output=True,
    text=True,
)
check("verify_report accepts a valid new-schema report",
      _good.returncode == 0, (_good.stdout + _good.stderr)[-500:])

_broken_report = {
    **_fixture_report,
    "top_picks": [
        {**_fixture_report["top_picks"][0], "why_it_matters": ""}
    ],
}
_broken_path = _write_verify_fixture(_broken_report, _fixture_log)
_broken = _subprocess.run(
    [_sys.executable, "verify_report.py", str(_broken_path)],
    capture_output=True,
    text=True,
)
check("verify_report rejects a new-schema report missing why_it_matters",
      _broken.returncode == 1, (_broken.stdout + _broken.stderr)[-500:])
check("the rejection names the why check",
      "why" in (_broken.stdout or "").lower(), (_broken.stdout or "")[-300:])

_corrupt_path = _write_verify_fixture(_fixture_report, _fixture_log)
(_corrupt_path.parent / "run_log.json").write_text("not json", encoding="utf-8")
_corrupt = _subprocess.run(
    [_sys.executable, "verify_report.py", str(_corrupt_path)],
    capture_output=True,
    text=True,
)
check("a corrupt run_log fails cleanly instead of tracing back",
      _corrupt.returncode == 1 and "Traceback" not in _corrupt.stderr,
      (_corrupt.stdout + _corrupt.stderr)[-500:])

# A partial model outage leaves one pick on the extractive fallback. The
# producer's flag is a capability flag, so one degraded item must not fail the
# week; an offline (--no-llm) report has no why-lines at all and is valid too.
_partial_report = {
    **_fixture_report,
    "top_picks": [
        _fixture_report["top_picks"][0],
        {
            **_fixture_report["top_picks"][0],
            "title": "A second method",
            "url": "https://example.com/b",
            "why_it_matters": "",
        },
    ],
}
_partial_path = _write_verify_fixture(_partial_report, _fixture_log)
_partial = _subprocess.run(
    [_sys.executable, "verify_report.py", str(_partial_path)],
    capture_output=True,
    text=True,
)
check("one degraded top pick does not fail the week",
      _partial.returncode == 0, (_partial.stdout + _partial.stderr)[-500:])

_offline_report = {
    **_fixture_report,
    "top_picks": [{**_fixture_report["top_picks"][0], "why_it_matters": ""}],
}
_offline_path = _write_verify_fixture(
    _offline_report, {**_fixture_log, "why_it_matters": False}
)
_offline = _subprocess.run(
    [_sys.executable, "verify_report.py", str(_offline_path)],
    capture_output=True,
    text=True,
)
check("an offline report with no why-lines is accepted",
      _offline.returncode == 0, (_offline.stdout + _offline.stderr)[-500:])

_no_week_end_path = _write_verify_fixture(_fixture_report, _fixture_log)
_no_week_end = _yaml.safe_load(_no_week_end_path.read_text(encoding="utf-8"))
_no_week_end.pop("week_end", None)
_no_week_end_path.write_text(_yaml.safe_dump(_no_week_end), encoding="utf-8")
_missing_date = _subprocess.run(
    [_sys.executable, "verify_report.py", str(_no_week_end_path)],
    capture_output=True,
    text=True,
)
check("a missing week_end fails cleanly instead of tracing back",
      _missing_date.returncode == 1 and "Traceback" not in _missing_date.stderr,
      (_missing_date.stdout + _missing_date.stderr)[-500:])

print("report_build writes run_log counts")
import contextlib as _contextlib
import io as _io
import os as _os
import report_build as _report_build

_rb_dir = Path(tempfile.mkdtemp())
(_rb_dir / "raw_run_log.json").write_text(_json.dumps({
    "run_at": "2026-11-12T09:00:00+00:00",
    "week_end": "2026-11-14",
    "counts": {"arxiv": 12, "news": 3},
    "found": 15,
    "kept": 15,
    "duplicates": 0,
    "already_sent": 0,
    "errors": [],
}), encoding="utf-8")
_rb_source = _rb_dir / "source.yaml"
_rb_source.write_text(_yaml.safe_dump(_fixture_report), encoding="utf-8")

_orig_check = _report_build.check_link
_orig_pdf = _report_build.render_pdf
_orig_cwd = _os.getcwd()
try:
    _report_build.check_link = lambda url, timeout=30.0: {"status": 200, "ok": True}
    _report_build.render_pdf = lambda report, path: Path(path).write_bytes(
        b"%PDF-1.4\n" + b"0" * 50_000
    )
    _os.chdir(_rb_dir)
    with _contextlib.redirect_stdout(_io.StringIO()):
        _rb_code = _report_build.main([str(_rb_source), "--no-record"])
finally:
    _os.chdir(_orig_cwd)
    _report_build.check_link = _orig_check
    _report_build.render_pdf = _orig_pdf

_rb_out = _rb_dir / "progress" / "week-2026-11-14"
_rb_log = _json.loads((_rb_out / "run_log.json").read_text(encoding="utf-8"))
check("report_build writes run_log.json with source_counts",
      _rb_log.get("source_counts") == {"arxiv": 12, "news": 3},
      str(_rb_log.get("source_counts")))
check("report_build run_log keeps collector counts",
      _rb_log.get("items_found") == 15 and _rb_log.get("source_errors") == [],
      str(_rb_log))

if failures:
    print(f"\n{len(failures)} FAILURE(S)")
    raise SystemExit(1)
print("\nAll self-tests passed.")
