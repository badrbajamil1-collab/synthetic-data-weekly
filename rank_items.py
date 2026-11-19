"""Phase 2 — rank the week's raw items with an LLM.

    uv run python rank_items.py
    uv run python rank_items.py --limit 5      # smoke test: first 5 items only
    uv run python rank_items.py --no-cache     # ignore score_cache.json

Reads raw_items.json, writes ranked.json (git-ignored) and merges a `ranking`
block into raw_run_log.json.

Exit codes: 0 success or partial (some items unscored), 1 nothing usable.

The order of the steps is the contract:

    keyword gate -> batch scoring -> editor pass -> well7 diversification
    -> duplicate grouping -> sort -> ranked.json

* The keyword gate spends no model request on an item that matches none of
  the configured phrases. Those rows carry score 1 and `score_status`
  "prefiltered" so they can never take a shortlist slot.
* The editor pass re-scores the top N on one scale, because batch scores are
  not comparable across calls.
* The cache is written AFTER the editor pass and BEFORE duplicate grouping, so
  a rerun over the same week reproduces the previous output byte for byte and
  a demoted duplicate score is never stored.
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
PREFILTER_REASON = "prefiltered: no keyword match"
DEFAULT_EDITOR_SIZE = 20


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
    """Return (scores, editor_applied, editor_size).

    `editor_applied` says whether the cached scores already went through the
    comparative editor pass. Without it a failed editor call would be frozen
    into the cache and never retried.
    """
    file = Path(path)
    if not file.exists():
        return {}, False, 0
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}, False, 0
    if not isinstance(data, dict):
        return {}, False, 0
    if data.get("model") != model or data.get("rubric") != rank.RUBRIC_VERSION:
        return {}, False, 0
    scores = data.get("scores")
    if not isinstance(scores, dict):
        scores = {}
    # A failed model call is not a score. Serving "unscored" entries back from
    # the cache would exclude those items from `pending` forever, so one bad
    # run could brick the week until the cache file was deleted.
    scores = {
        key: entry
        for key, entry in scores.items()
        if isinstance(entry, dict)
        and (entry.get("score_status") or "scored") != "unscored"
    }
    editor = data.get("editor")
    if not isinstance(editor, dict):
        editor = {}
    try:
        editor_size = int(editor.get("size") or 0)
    except (TypeError, ValueError):
        editor_size = 0
    return scores, bool(editor.get("applied")), editor_size


def save_cache(path, model, scores, editor_applied, editor_size):
    payload = {
        "model": model,
        "rubric": rank.RUBRIC_VERSION,
        "scores": scores,
        "editor": {"applied": bool(editor_applied), "size": int(editor_size)},
    }
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
    # 0 is a real value here ("disable the editor pass"), not "unset"; the
    # `or` form silently restored the default.
    _editor_size = ranking.get("editor_pass_size")
    editor_size = DEFAULT_EDITOR_SIZE if _editor_size is None else int(_editor_size)

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

    try:
        api_key = llm.require_api_key(llm.load_env())
    except llm.LLMError as exc:
        print(f"FAIL  {exc}", file=sys.stderr)
        return 1

    # The keyword gate. An item that matches none of the configured phrases is
    # noise for this report; it is scored 1 without spending a model request.
    skip = set()
    if ranking.get("prefilter"):
        skip = rank.prefilter_indices(items, config.get("keywords") or [])

    use_cache = bool(ranking.get("cache", True)) and not args.no_cache
    if use_cache:
        scores_cache, editor_applied, cached_editor_size = load_cache(args.cache, model)
    else:
        scores_cache, editor_applied, cached_editor_size = {}, False, 0

    keys = [cache_key(item, model) for item in items]
    # One cache slot per key. Two items can normalise to the same URL (arXiv
    # v1 and v2 of one paper), and one slot cannot hold two scores, so those
    # items are scored fresh on every run instead of sharing a score. The
    # collector's dedupe normally removes such a pair before it gets here.
    key_counts = {}
    for key in keys:
        key_counts[key] = key_counts.get(key, 0) + 1
    shared = {key for key, count in key_counts.items() if count > 1}

    cached = {}
    for index, key in enumerate(keys):
        if index in skip:
            continue  # the gate decides; a stale cache entry must not revive it
        if key in shared:
            continue
        if key in scores_cache:
            cached[index] = scores_cache[key]
    pending = [i for i in range(len(items)) if i not in cached and i not in skip]

    stats = {"calls": 0, "retries": 0, "failed_calls": 0}

    def chat_fn(messages):
        stats["calls"] += 1
        try:
            content, retries = llm.chat(
                messages,
                api_key=api_key,
                base_url=base_url,
                model=model,
                temperature=float(ranking.get("temperature", 0.0)),
                max_tokens=max_tokens,
                reasoning_effort=ranking.get("reasoning_effort", "low"),
                json_mode=True,
                timeout=float(ranking.get("timeout_seconds", 180)),
                attempts=int(ranking.get("max_attempts", 4)),
            )
        except Exception:
            # Counted before the call, so a fully failed run still records
            # that the model was contacted instead of claiming calls: 0.
            stats["failed_calls"] += 1
            raise
        stats["retries"] += retries
        return content

    print(f"Ranking {len(items)} items with {model}")
    print(
        f"  cached: {len(cached)}   to score: {len(pending)}   prefiltered: {len(skip)}   "
        f"batch: {batch_size}   workers: {concurrency}"
    )

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
        if index in skip:
            row = dict(item)
            row["score"] = 1
            row["well7_fit"] = 1
            row["reason"] = PREFILTER_REASON
            row["score_status"] = "prefiltered"
            row["duplicate_of"] = None
            row["scored_by"] = model
            raw_rows.append(row)
        elif index in cached:
            entry = cached[index]
            row = dict(item)
            row["score"] = int(entry.get("score") or 0)
            row["well7_fit"] = entry.get("well7_fit")
            row["reason"] = entry.get("reason") or ""
            row["score_status"] = entry.get("score_status") or "scored"
            row["duplicate_of"] = None
            row["scored_by"] = model
            if entry.get("editor_pass"):
                # The editor marker has to come back with the score, or the
                # rerun writes a different ranked.json than the first run.
                row["editor_pass"] = True
            raw_rows.append(row)
        else:
            raw_rows.append(fresh_by_index[index])

    # The editor pass re-scores the top N on one scale, because batch scores
    # are not comparable between calls. It runs when something was scored, or
    # when the previous run never completed one - a failed editor call must
    # not be frozen into the cache. A rerun over a fully cached week therefore
    # costs no call and reproduces the last run byte for byte.
    #
    # Prefiltered rows are not candidates: they never went to the model, so
    # they are kept out of the editor prompt as well.
    run_editor = bool(pending) or not editor_applied or cached_editor_size != editor_size
    editable = [row for index, row in enumerate(raw_rows) if index not in skip]
    if editor_size <= 0:
        # The editor pass is switched off: there is nothing to wait for and
        # nothing to retry next run.
        editor_done = True
    elif run_editor and editable:
        targets = rank.editor_target_indices(editable, editor_size)
        edited = rank.rerank_top(editable, chat_fn, top_n=editor_size)
        # Latch only when every row the editor was meant to re-score carries
        # the marker. `any(...)` let a partial reply look like success and
        # froze the rest at batch scores; requiring the whole target set also
        # stops a fully cached top-N from latching False forever, because the
        # markers were already there before the call.
        editor_done = bool(targets) and all(
            edited[index].get("editor_pass") for index in targets
        )
        editable = edited
    else:
        editor_done = editor_applied and cached_editor_size == editor_size

    editable = rank.diversify_well7_fit(editable)

    # Back to input order. rerank_top and diversify_well7_fit both keep the
    # order of the rows they were handed, so the two lists line up.
    final_rows = []
    editable_iter = iter(editable)
    for index, row in enumerate(raw_rows):
        final_rows.append(row if index in skip else next(editable_iter))

    # Cache BEFORE grouping: a demoted duplicate score must not be stored, or
    # every rerun would subtract the penalty again. The cache holds the
    # post-editor scores, so a rerun reproduces them without another call.
    new_cache = {}
    for index, key in enumerate(keys):
        if index in skip:
            continue  # the gate is recomputed every run; never freeze its verdict
        if key in shared:
            continue  # one slot, two rows: never let them overwrite each other
        row = final_rows[index]
        if (row.get("score_status") or "unscored") != "scored":
            # Never freeze a failure: the next run must retry this item.
            continue
        new_cache[key] = {
            "score": row.get("score", 0),
            "well7_fit": row.get("well7_fit"),
            "reason": row.get("reason", ""),
            "score_status": row.get("score_status", "unscored"),
            "editor_pass": bool(row.get("editor_pass")),
        }
    if use_cache and not args.limit:
        # A --limit smoke test must not evict the other entries.
        save_cache(args.cache, model, new_cache, editor_done, editor_size)

    rows = rank.group_duplicates(
        final_rows, threshold=float(ranking.get("duplicate_similarity", 0.80))
    )
    rows = rank.sort_ranked(rows)

    Path(args.out).write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")

    scored = sum(1 for row in rows if row.get("score_status") == "scored")
    prefiltered = sum(1 for row in rows if row.get("score_status") == "prefiltered")
    unscored = len(rows) - scored - prefiltered
    duplicates = sum(1 for row in rows if row.get("duplicate_of"))

    block = {
        "model": model,
        "items_in": len(rows),
        "scored": scored,
        "prefiltered": prefiltered,
        "unscored": unscored,
        "duplicates_collapsed": duplicates,
        "calls": stats["calls"],
        "retries": stats["retries"],
        "failed_calls": stats["failed_calls"],
        "cached": len(cached),
        "editor_pass": bool(editor_done),
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
        f"\nscored {scored}/{len(rows)}  unscored {unscored}  prefiltered {prefiltered}  "
        f"duplicates collapsed {duplicates}  calls {stats['calls']}  "
        f"failed {stats['failed_calls']}  retries {stats['retries']}"
    )
    print(f"wrote {args.out}")

    # The failure rate is over the items that were actually sent to the model:
    # a deliberately prefiltered item is not a failure.
    attempted = scored + unscored
    ratio = (unscored / attempted) if attempted else 0.0
    if ratio > float(ranking.get("max_unscored_ratio", 0.10)):
        print(
            f"\nWARNING  {ratio:.0%} of the scored items are unscored "
            f"(threshold {float(ranking.get('max_unscored_ratio', 0.10)):.0%}). "
            "The report will be thin this week."
        )

    if scored == 0:
        if prefiltered:
            print(
                f"FAIL  every item was prefiltered ({prefiltered}); nothing was left to rank.",
                file=sys.stderr,
            )
        else:
            print(
                "FAIL  no item could be scored; the model is unavailable or rejecting the prompt.",
                file=sys.stderr,
            )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
