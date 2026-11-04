"""Phase 2 — rank the week's raw items with an LLM.

    uv run python rank_items.py
    uv run python rank_items.py --limit 5      # smoke test: first 5 items only
    uv run python rank_items.py --no-cache     # ignore score_cache.json

Reads raw_items.json, writes ranked.json (git-ignored) and merges a `ranking`
block into raw_run_log.json.

Exit codes: 0 success or partial (some items unscored), 1 nothing usable.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import yaml

from synthetic_data import llm, rank
from synthetic_data.links import normalize_url

TOKENS_PER_ROW = 45
PROMPT_HEADROOM = 200


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Rank the week's raw items 1-10.")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--raw", default="raw_items.json")
    parser.add_argument("--out", default="ranked.json")
    parser.add_argument("--cache", default="score_cache.json")
    parser.add_argument("--no-cache", action="store_true", help="ignore the score cache")
    parser.add_argument("--limit", type=int, default=0, help="score only the first N items")
    return parser.parse_args(argv)


def cache_key(item, model):
    url = normalize_url(item.get("url") or "") or (item.get("url") or "")
    payload = f"{url}|{model}|{rank.RUBRIC_VERSION}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def load_cache(path, model):
    file = Path(path)
    if not file.exists():
        return {}
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}
    if data.get("model") != model or data.get("rubric") != rank.RUBRIC_VERSION:
        return {}
    scores = data.get("scores")
    return scores if isinstance(scores, dict) else {}


def save_cache(path, model, scores):
    payload = {"model": model, "rubric": rank.RUBRIC_VERSION, "scores": scores}
    Path(path).write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")


def merge_run_log(path, block):
    """Read-merge-write: main.py rewrites this file, so never clobber it."""
    file = Path(path)
    existing = {}
    if file.exists():
        try:
            existing = json.loads(file.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            existing = {}
    if not isinstance(existing, dict):
        existing = {}
    existing["ranking"] = block
    file.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")


def main(argv=None):
    args = parse_args(argv)

    config_path = Path(args.config)
    if not config_path.exists():
        print(f"FAIL  {config_path} not found", file=sys.stderr)
        return 1
    config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    ranking = config.get("ranking") or {}

    model = ranking.get("model")
    base_url = ranking.get("base_url", llm.DEFAULT_BASE_URL)
    batch_size = int(ranking.get("batch_size", 15))
    concurrency = int(ranking.get("concurrency", 3))
    max_tokens = int(ranking.get("max_tokens", 2000))

    if not model:
        print("FAIL  config.yaml has no ranking.model", file=sys.stderr)
        return 1

    # Guard the coupling between batch size and completion budget: a truncated
    # JSON array is invalid JSON, which costs one fallback call per item.
    required = batch_size * TOKENS_PER_ROW + PROMPT_HEADROOM
    if required > max_tokens:
        print(
            f"FAIL  batch_size {batch_size} needs ~{required} tokens but "
            f"max_tokens is {max_tokens}. Lower batch_size or raise max_tokens.",
            file=sys.stderr,
        )
        return 1

    raw_path = Path(args.raw)
    if not raw_path.exists():
        print(f"FAIL  {raw_path} not found - run `uv run python main.py` first", file=sys.stderr)
        return 1
    items = json.loads(raw_path.read_text(encoding="utf-8"))
    if not isinstance(items, list) or not items:
        print(f"FAIL  {raw_path} holds no items", file=sys.stderr)
        return 1

    if args.limit and args.limit > 0:
        items = items[: args.limit]

    env = llm.load_env()
    try:
        api_key = llm.require(env, "OPENROUTER_API_KEY")
    except llm.LLMError as exc:
        print(f"FAIL  {exc}", file=sys.stderr)
        return 1

    cache = {} if args.no_cache or not ranking.get("cache", True) else load_cache(args.cache, model)
    keys = [cache_key(item, model) for item in items]
    cached = {i: cache[key] for i, key in enumerate(keys) if key in cache}
    pending = [i for i in range(len(items)) if i not in cached]

    stats = {"calls": 0, "retries": 0}

    def chat_fn(messages):
        content, retries = llm.chat(
            messages,
            api_key=api_key,
            base_url=base_url,
            model=model,
            temperature=float(ranking.get("temperature", 0.0)),
            max_tokens=max_tokens,
            reasoning_effort=ranking.get("reasoning_effort", "low"),
            timeout=float(ranking.get("timeout_seconds", 180)),
            attempts=int(ranking.get("max_attempts", 4)),
        )
        stats["calls"] += 1
        stats["retries"] += retries
        return content

    print(f"Ranking {len(items)} items with {model}")
    print(f"  cached: {len(cached)}   to score: {len(pending)}   batch: {batch_size}   workers: {concurrency}")

    fresh_rows = []
    if pending:
        fresh_rows = rank.score_items(
            [items[i] for i in pending],
            chat_fn,
            batch_size=batch_size,
            concurrency=concurrency,
            scored_by=model,
        )

    fresh_by_index = {pending[i]: fresh_rows[i] for i in range(len(pending))}

    # Input order, one row per item. This is the invariant: nothing vanishes.
    raw_rows = []
    for index, item in enumerate(items):
        if index in cached:
            entry = cached[index]
            row = dict(item)
            row["score"] = int(entry.get("score") or 0)
            row["well7_fit"] = entry.get("well7_fit")
            row["reason"] = entry.get("reason") or ""
            row["score_status"] = entry.get("score_status") or "scored"
            row["duplicate_of"] = None
            row["scored_by"] = model
            raw_rows.append(row)
        else:
            raw_rows.append(fresh_by_index[index])

    # Cache BEFORE grouping: a demoted duplicate score must not be stored, or
    # every rerun would subtract the penalty again.
    new_cache = {}
    for index, key in enumerate(keys):
        row = raw_rows[index]
        new_cache[key] = {
            "score": row.get("score", 0),
            "well7_fit": row.get("well7_fit"),
            "reason": row.get("reason", ""),
            "score_status": row.get("score_status", "unscored"),
        }
    if ranking.get("cache", True) and not args.no_cache:
        save_cache(args.cache, model, new_cache)

    rows = rank.group_duplicates(raw_rows, threshold=float(ranking.get("duplicate_similarity", 0.80)))
    rows = rank.sort_ranked(rows)

    Path(args.out).write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")

    scored = sum(1 for row in rows if row.get("score_status") == "scored")
    unscored = len(rows) - scored
    duplicates = sum(1 for row in rows if row.get("duplicate_of"))

    block = {
        "model": model,
        "items_in": len(rows),
        "scored": scored,
        "unscored": unscored,
        "duplicates_collapsed": duplicates,
        "calls": stats["calls"],
        "retries": stats["retries"],
        "cached": len(cached),
    }
    merge_run_log("raw_run_log.json", block)

    top_n = int(config.get("max_top_picks", 10))
    picks = [row for row in rows if row.get("score_status") == "scored" and not row.get("duplicate_of")]

    print("\n=== TOP PICKS ===")
    for position, row in enumerate(picks[:top_n], start=1):
        well7 = row.get("well7_fit")
        well7_text = "-" if well7 is None else str(well7)
        print(f"\n{position:>2}. [{row.get('score')}/10  well7 {well7_text}]  {row.get('source')}  {row.get('title')}")
        print(f"    {row.get('reason')}")
        print(f"    {row.get('url')}")

    print(
        f"\nscored {scored}/{len(rows)}  unscored {unscored}  "
        f"duplicates collapsed {duplicates}  calls {stats['calls']}  retries {stats['retries']}"
    )
    print(f"wrote {args.out}")

    ratio = unscored / len(rows)
    if ratio > float(ranking.get("max_unscored_ratio", 0.10)):
        print(
            f"\nWARNING  {ratio:.0%} of items are unscored "
            f"(threshold {float(ranking.get('max_unscored_ratio', 0.10)):.0%}). "
            "The report will be thin this week."
        )

    if scored == 0:
        print("FAIL  no item could be scored; the model is unavailable or rejecting the prompt.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
