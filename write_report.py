"""Phase 3 — write progress/week-<week_end>/source.yaml from candidates.json.

    uv run python write_report.py
    uv run python write_report.py --no-llm      # extractive summaries, no API
    uv run python write_report.py --dry-run     # print the YAML, write nothing

This is the last manual step made automatic. It reads the full text fetched by
fetch_candidates.py, splits the shortlist into the report's three sections by a
rule (not by asking a model to count), writes summaries whose numbers are
checked against the source text, and hands a valid source.yaml to report_build.py.

The report covers one fixed Sunday-Saturday week: the week the run date falls
in, or the week named by --week-end when a past week is replayed. Each section
has a score floor and is never padded, so a quiet week produces a short report
rather than a padded one.

A summary cache keyed by URL + model + prompt version + text hash makes a rerun
free and byte-identical, the same bargain score_cache.json makes in Phase 2.

Exit codes:
    0  wrote a report (or an explicitly offline one with --no-llm)
    1  no usable input
    2  wrote a report, but every summary is a fallback because the model was
       unreachable (quota, auth, outage). The file is valid; the prose is thin.
"""

import argparse
import hashlib
import json
import sys
import threading
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

from synthetic_data import llm, summarise
from synthetic_data.links import normalize_url


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Write source.yaml from the ranked shortlist.")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--candidates", default="candidates.json")
    parser.add_argument("--cache", default="summary_cache.json")
    parser.add_argument("--out", default="", help="override the output path")
    parser.add_argument("--week-end", default="", help="override the report's last day (YYYY-MM-DD)")
    parser.add_argument("--no-cache", action="store_true", help="ignore summary_cache.json")
    parser.add_argument("--no-llm", action="store_true", help="extractive summaries only, no API")
    parser.add_argument("--dry-run", action="store_true", help="print the YAML, write nothing")
    return parser.parse_args(argv)


# ---------------------------------------------------------------------------
# summary cache
# ---------------------------------------------------------------------------

def cache_key(item: dict, model: str, one_line: bool) -> str:
    text = (item.get("text") or "").strip() or (item.get("snippet") or "").strip()
    body = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    mode = "one" if one_line else "multi"
    payload = "|".join(
        [
            normalize_url(item.get("url") or "") or (item.get("url") or ""),
            model,
            summarise.SUMMARY_VERSION,
            mode,
            body,
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_cache(path: str, model: str) -> dict:
    file = Path(path)
    if not file.exists():
        return {}
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}
    if data.get("model") != model or data.get("version") != summarise.SUMMARY_VERSION:
        return {}
    entries = data.get("entries")
    return entries if isinstance(entries, dict) else {}


def save_cache(path: str, model: str, entries: dict) -> None:
    payload = {
        "model": model,
        "version": summarise.SUMMARY_VERSION,
        "entries": entries,
    }
    Path(path).write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------

def display_url(item: dict) -> str:
    """The canonical form, so arXiv v1 and v2 never both reach the report."""
    return item.get("normalized") or item.get("url") or ""


def pick_entry(item: dict, result: dict) -> dict:
    return {
        "title": item.get("title") or "(untitled)",
        "url": display_url(item),
        "source": summarise.source_label(item),
        "published": summarise.published_date(item.get("published")),
        "summary": result["summary"],
        "why_it_matters": result.get("why_it_matters") or "",
        "score": item.get("score"),
        "well7_fit": item.get("well7_fit"),
        "summary_origin": result["origin"],
        "guard": result["guard"],
        "rejected": result.get("rejected") or [],
        "detail": result.get("detail") or [],
    }


def tool_entry(item: dict, result: dict) -> dict:
    return {
        "name": item.get("title") or "(unnamed)",
        "url": display_url(item),
        "source": summarise.source_label(item),
        "published": summarise.published_date(item.get("published")),
        "note": result["summary"],
        "why_it_matters": result.get("why_it_matters") or "",
        "score": item.get("score"),
        "well7_fit": item.get("well7_fit"),
        "summary_origin": result["origin"],
        "guard": result["guard"],
        "rejected": result.get("rejected") or [],
        "detail": result.get("detail") or [],
    }


def worth_entry(item: dict, result: dict) -> dict:
    return {
        "title": item.get("title") or "(untitled)",
        "url": display_url(item),
        "source": summarise.source_label(item),
        "published": summarise.published_date(item.get("published")),
        "note": result["summary"],
        "why_it_matters": result.get("why_it_matters") or "",
        "score": item.get("score"),
        "well7_fit": item.get("well7_fit"),
        "summary_origin": result["origin"],
        "guard": result["guard"],
        "rejected": result.get("rejected") or [],
        "detail": result.get("detail") or [],
    }


def summarise_section(items, chat_fn, cache, *, model, one_line, cache_config) -> list:
    """Cache hits first, then one model call per miss, merged back in order.

    The cached value is the whole result dict, so a cached entry still carries
    its `why_it_matters` line.
    """
    results = {}
    pending = []
    keys = [cache_key(item, model, one_line) for item in items]

    for index, key in enumerate(keys):
        if key in cache:
            results[index] = cache[key]
        else:
            pending.append(index)

    if pending:
        fresh = summarise.summarise_items(
            [items[index] for index in pending],
            chat_fn,
            one_line=one_line,
            max_chars=cache_config["max_chars"],
            concurrency=cache_config["concurrency"],
        )
        for offset, index in enumerate(pending):
            result = fresh[offset]
            results[index] = result
            # Never cache a fallback. A quota wall or a bad model day must not
            # freeze extractive prose into every later run.
            if result.get("guard") in {"passed", "repaired"}:
                cache[keys[index]] = result

    return [results[index] for index in range(len(items))]


def main(argv=None) -> int:
    args = parse_args(argv)

    config_path = Path(args.config)
    if not config_path.exists():
        print(f"FAIL  {config_path} not found", file=sys.stderr)
        return 1
    config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    settings = config.get("summarising") or {}
    ranking = config.get("ranking") or {}

    model = settings.get("model") or ranking.get("model")
    base_url = settings.get("base_url") or ranking.get("base_url", llm.DEFAULT_BASE_URL)

    candidates_path = Path(args.candidates)
    if not candidates_path.exists():
        print(
            f"FAIL  {candidates_path} not found - run `uv run python fetch_candidates.py` first",
            file=sys.stderr,
        )
        return 1
    candidates = json.loads(candidates_path.read_text(encoding="utf-8"))
    if not isinstance(candidates, dict) or not candidates:
        print(f"FAIL  {candidates_path} holds no candidate records", file=sys.stderr)
        return 1
    items = [record for record in candidates.values() if isinstance(record, dict)]

    week_end = None
    if args.week_end:
        try:
            week_end = datetime.strptime(args.week_end, "%Y-%m-%d").date()
        except ValueError:
            print("FAIL  --week-end must be YYYY-MM-DD", file=sys.stderr)
            return 1

    # One fixed week for the whole report: the Sunday-Saturday week the run
    # date falls in. --week-end replays a past week instead. Local date, matching
    # graph.py's week_bounds() so the CLI and pipeline never disagree by a day
    # around midnight (the scheduled task runs at 08:00 local).
    run_date = date.today()
    try:
        sections = summarise.compose_sections(
            items,
            picks=int(settings.get("picks", 6)),
            max_tools=int(settings.get("max_tools", 5)),
            max_worth=int(settings.get("max_worth_a_look", 5)),
            week_end=week_end,
            run_date=run_date,
            min_score_top=int(settings.get("min_score_top", 7)),
            min_score_tools=int(settings.get("min_score_tools", 6)),
            min_score_worth=int(settings.get("min_score_worth", 5)),
        )
    except summarise.CompositionError as exc:
        print(f"FAIL  {exc}", file=sys.stderr)
        return 1

    stats = {"calls": 0, "retries": 0}
    stats_lock = threading.Lock()
    offline = args.no_llm

    if offline:
        def chat_fn(_messages):
            raise llm.LLMError("--no-llm: summarising offline")
    else:
        env = llm.load_env()
        try:
            api_key = llm.require_api_key(env)
        except llm.LLMError as exc:
            print(f"FAIL  {exc}", file=sys.stderr)
            return 1

        def chat_fn(messages):
            # Count the attempt before the call: a quota rejection still cost a
            # request, and hiding it makes an outage look like a quiet success.
            with stats_lock:
                stats["calls"] += 1
            content, retries = llm.chat(
                messages,
                api_key=api_key,
                base_url=base_url,
                model=model,
                temperature=float(settings.get("temperature", 0.2)),
                max_tokens=int(settings.get("max_tokens", 2000)),
                reasoning_effort=settings.get("reasoning_effort", "low"),
                json_mode=True,
                timeout=float(settings.get("timeout_seconds", 180)),
                attempts=int(settings.get("max_attempts", 4)),
            )
            with stats_lock:
                stats["retries"] += retries
            return content

    cache_model = model or "offline"
    use_cache = not args.no_cache and not offline
    cache = load_cache(args.cache, cache_model) if use_cache else {}
    caching = {
        "max_chars": int(settings.get("max_text_chars", 6000)),
        "concurrency": int(settings.get("concurrency", 3)),
    }

    pick_results = summarise_section(
        sections["top_picks"], chat_fn, cache,
        model=cache_model, one_line=False, cache_config=caching,
    )
    tool_results = summarise_section(
        sections["tools"], chat_fn, cache,
        model=cache_model, one_line=True, cache_config=caching,
    )
    worth_results = summarise_section(
        sections["worth_a_look"], chat_fn, cache,
        model=cache_model, one_line=True, cache_config=caching,
    )

    if use_cache:
        save_cache(args.cache, cache_model, cache)

    report = {
        "week_start": sections["week_start"],
        "week_end": sections["week_end"],
        # "replay" when --week-end named the week, "run_date" otherwise.
        # report_build records it and verify_report only demands the
        # Sunday-Saturday shape of a run-date week.
        "week_mode": "replay" if week_end else "run_date",
        "dropped_below_floor": len(sections.get("dropped_below_floor") or []),
        "top_picks": [
            pick_entry(item, result)
            for item, result in zip(sections["top_picks"], pick_results)
        ],
        "tools": [
            tool_entry(item, result)
            for item, result in zip(sections["tools"], tool_results)
        ],
        "worth_a_look": [
            worth_entry(item, result)
            for item, result in zip(sections["worth_a_look"], worth_results)
        ],
    }

    # The trend comes from the model or it is left out. Offline, the raising
    # chat_fn makes summarise_trend omit it and flag the omission, so the
    # report never carries a paragraph nobody wrote.
    trend = summarise.summarise_trend(report["top_picks"], chat_fn)
    report["trend"] = trend["trend"]

    generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
    text = summarise.dump_report(report, generated_at=generated)

    print(f"Report week: {report['week_start']} .. {report['week_end']}")
    print(
        f"  picks: {len(report['top_picks'])}   tools: {len(report['tools'])}"
        f"   worth a look: {len(report['worth_a_look'])}"
        f"   dropped: {len(sections['dropped'])}"
        f"   below floor: {report['dropped_below_floor']}"
    )
    if sections["dropped"]:
        for item in sections["dropped"]:
            print(f"    dropped  {item.get('title', '')[:70]}")
    if sections.get("dropped_below_floor"):
        for item in sections["dropped_below_floor"]:
            print(
                f"    below floor  {item.get('title', '')[:60]}"
                f"  (score {item.get('score')})"
            )

    print()
    for label, entries in (
        ("TOP PICKS", report["top_picks"]),
        ("TOOLS", report["tools"]),
        ("WORTH A LOOK", report["worth_a_look"]),
    ):
        if not entries:
            continue
        print(f"=== {label} ===")
        for entry in entries:
            guard = entry["guard"]
            origin = entry["summary_origin"]
            detail = entry.get("detail") or []
            suffix = f"   {detail}" if detail else ""
            print(f"  [{guard:<10}] [{origin:<12}] {entry.get('title') or entry.get('name')}{suffix}")
        print()

    if trend["guard"] == "omitted" or not (report.get("trend") or "").strip():
        print("Trend guard: omitted — trend section left out")
    else:
        print(f"Trend guard: {trend['guard']}")
    guards = [e["guard"] for e in report["top_picks"] + report["tools"] + report["worth_a_look"]]
    counts = {name: guards.count(name) for name in sorted(set(guards))}
    print(f"Summary guards: {counts}")
    if not offline:
        print(f"Model calls: {stats['calls']}   transport retries: {stats['retries']}")
    else:
        print("Offline: no model calls, every summary is extractive.")
    if not use_cache:
        print("Cache: disabled")
    else:
        print(f"Cache: {args.cache}")

    if args.dry_run:
        print("\n--- source.yaml (dry run) ---\n")
        print(text)
        return 0

    out_path = Path(args.out) if args.out else (
        Path("progress") / f"week-{report['week_end']}" / "source.yaml"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(text, encoding="utf-8")
    print(f"\nWrote {out_path}")
    print(f"Next: uv run python report_build.py \"{out_path}\" --no-record")

    if not offline and all(
        entry["guard"] in {"extractive", "skipped"}
        for entry in report["top_picks"] + report["tools"] + report["worth_a_look"]
    ):
        print(
            "\nWARNING  every summary is a fallback: the model was unreachable. "
            "The report is valid but the prose is extracted, not written. "
            "Fix the provider, then rerun - fallbacks are never cached."
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
