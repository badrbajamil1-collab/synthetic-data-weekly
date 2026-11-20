"""Phase 4 - the weekly synthetic-data report as a LangGraph state machine.

One shared ``AgentState`` flows through seven nodes:

    collect -> clean -> rank -> fetch -> report -> render -> send -> END

Nodes never raise out of the graph. A failing node records the error in the
state and returns, so the chain keeps going - that is the brief's resilience
rule ("if one source fails, log it and continue; the report must still go
out") expressed as graph behaviour instead of scattered try/excepts.

Run the whole pipeline from the CLI:

    python main.py --pipeline

``python main.py`` without ``--pipeline`` keeps its Phase 1 behaviour (collect
and print every raw item) so historical weeks stay reproducible.
"""

import concurrent.futures
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from langgraph.graph import END, START, StateGraph

import fetch_candidates
import rank_items
from synthetic_data import emailer, llm, rank, runner, summarise
from synthetic_data.models import AgentState, Item
from synthetic_data.rank import sort_ranked
from synthetic_data.week import in_week, week_bounds

from report_build import main as report_build_main
from write_report import (
    load_cache,
    pick_entry,
    save_cache,
    summarise_section,
    tool_entry,
    worth_entry,
)


MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
DEFAULT_SUMMARISE_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"


_SETTINGS: Dict[str, Any] = {}
_CHAT_FN: Optional[Callable[[List[dict]], str]] = None
_CONFIG_PATH = "config.yaml"
_CACHE_PATH = "summary_cache.json"
_SCORE_CACHE_PATH = "score_cache.json"
_UNSET = object()
_RANKED_PATH: Optional[str] = None
_DELIVERY: Dict[str, bool] = {"enabled": True, "dry_run": False}


def _as_int(value, default: int) -> int:
    """Config integer where 0 is a real value, not "unset".

    `int(block.get(key) or default)` silently replaced a deliberate 0 (e.g.
    "disable the editor pass") with the default.
    """
    return default if value is None else int(value)


def configure(
    *,
    settings: Optional[Dict[str, Any]] = None,
    chat_fn: Optional[Callable[[List[dict]], str]] = None,
    config_path: Optional[str] = None,
    delivery: Optional[Dict[str, bool]] = None,
    score_cache_path: Optional[str] = None,
    ranked_path: Any = _UNSET,
) -> None:
    """Set the config + chat function a weekly run should use.

    ``chat_fn`` exists so offline tests can inject a fake model and the real
    run can bind the configured OpenRouter client. ``delivery`` controls the
    send node: disabled for ``--no-email``, dry-run for ``--dry-run``.
    ``score_cache_path`` overrides the ranking score cache file for test isolation.
    ``ranked_path`` optionally writes the sorted ranked list (e.g. ``ranked.json``).
    """
    global _SETTINGS, _CHAT_FN, _CONFIG_PATH, _DELIVERY, _SCORE_CACHE_PATH, _RANKED_PATH
    if settings is not None:
        _SETTINGS = settings
    if chat_fn is not None:
        _CHAT_FN = chat_fn
    if config_path is not None:
        _CONFIG_PATH = config_path
    if delivery is not None:
        _DELIVERY = {**_DELIVERY, **delivery}
    if score_cache_path is not None:
        _SCORE_CACHE_PATH = str(score_cache_path)
    if ranked_path is not _UNSET:
        _RANKED_PATH = None if ranked_path is None else str(ranked_path)


def _chat_for(section: str) -> Callable[[List[dict]], str]:
    if _CHAT_FN is not None:
        return _CHAT_FN

    block = _SETTINGS.get(section) or {}
    # The GitHub Actions workflow exports LLM_API_KEY; local .env uses
    # OPENROUTER_API_KEY. Both names are accepted so a scheduled run cannot
    # fail on a key-name mismatch (the 2026-11-07 failure).
    api_key = llm.require_api_key(llm.load_env())
    base_url = block.get("base_url") or llm.DEFAULT_BASE_URL
    model = block.get("model") or (
        (_SETTINGS.get("ranking") or {}).get("model") or DEFAULT_SUMMARISE_MODEL
    )
    raw_fallbacks = block.get("fallback_models")
    if raw_fallbacks is None and section != "ranking":
        raw_fallbacks = (_SETTINGS.get("ranking") or {}).get("fallback_models")
    fallback_models = tuple(raw_fallbacks or ())

    def chat_fn(messages: List[dict]) -> str:
        content, _retries = llm.chat(
            messages,
            api_key=api_key,
            base_url=base_url,
            model=model,
            fallback_models=fallback_models,
            temperature=float(block.get("temperature") or 0.0),
            max_tokens=int(block.get("max_tokens") or 2000),
            reasoning_effort=block.get("reasoning_effort") or "low",
            timeout=float(block.get("timeout_seconds") or 180),
            attempts=int(block.get("max_attempts") or 4),
            json_mode=True,
        )
        return content

    return chat_fn


def _run_date(state: AgentState) -> date:
    """The run date carried in state (a replay hook), or today.

    Every stage reads this one value, so collect, fetch and compose describe
    the same Saturday-Friday week instead of drifting apart.
    """
    raw = state.get("run_date")
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    if raw:
        try:
            return date.fromisoformat(str(raw)[:10])
        except ValueError:
            pass
    return date.today()


def collect_node(state: AgentState, config) -> AgentState:
    """Node 1 - gather this week's raw items from every source.

    History is applied here, before ranking, so a URL that already went out in
    an earlier week never competes for a slot. The collector artefacts are
    written to the same filenames as the Phase 1 CLI, which is what
    ``report_build.py`` reads for its counts.
    """
    errors = list(state.get("errors") or [])
    run_date = _run_date(state)
    week = week_bounds(run_date)
    try:
        # Collection and reporting share one fixed Saturday-Friday window, so
        # a rolling 7-day lookback cannot smuggle a previous week's item into
        # the shortlist.
        result = runner.collect_all(_SETTINGS, use_history=True, week=week)
        runner.save_items(result.items)
        payload = {
            "run_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "run_date": run_date.isoformat(),
            "week_start": week[0].isoformat(),
            "week_end": week[1].isoformat(),
            "counts": result.counts,
            "found": result.found,
            "duplicates": result.duplicates,
            "already_sent": result.already_sent,
            "kept": len(result.items),
            "errors": result.errors,
            "warnings": result.warnings,
        }
        Path("raw_run_log.json").write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return {
            "raw_items": [item.model_dump(mode="json") for item in result.items],
            "collect_counts": result.counts,
            # collect_all already deduplicated; carry its count into state so
            # clean_node can add to it instead of overwriting it with zero.
            "duplicates": result.duplicates,
            "already_sent": result.already_sent,
            "run_date": run_date.isoformat(),
            "errors": [*errors, *result.errors],
        }
    except Exception as exc:  # noqa: BLE001 - a node failure is data, not a crash
        return {
            **state,
            "errors": [*errors, f"collect: {type(exc).__name__}: {exc}"],
        }


def clean_node(state: AgentState, config) -> AgentState:
    """Node 2 - collapse URL variants (tracking params, arXiv versions).

    The graph state carries plain dicts (what JSON looks like), so the items
    are wrapped into Item before dedupe and unwrapped back to dicts after.
    """
    errors = list(state.get("errors") or [])
    try:
        items = [
            item if isinstance(item, Item) else Item(**item)
            for item in state.get("raw_items") or []
        ]
        unique, dropped = runner.dedupe_items(items)
    except Exception as exc:  # noqa: BLE001 - a node must never escape the graph
        # `**state` already carries the collected duplicate count. Setting 0
        # here would erase it on the error path, re-introducing the very bug
        # the success path was fixed for.
        return {
            **state,
            "deduped_items": [],
            "errors": [*errors, f"clean: {type(exc).__name__}: {exc}"],
        }
    # collect_all() already deduplicated and put the true count in state.
    # Running dedupe_items again here normally drops 0, so writing `dropped`
    # alone would overwrite that count with 0. Keep the collected count and
    # add anything this second pass actually removed.
    return {
        "deduped_items": [item.model_dump(mode="json") for item in unique],
        "duplicates": int(state.get("duplicates") or 0) + dropped,
    }


def rank_node(state: AgentState, config) -> AgentState:
    """Node 3 - keyword gate, batch scoring, then one comparative editor pass.

    Cheap obvious noise never reaches the model (free-tier budget), and the
    final top ~20 are re-scored in a single call so scores from different
    batches are directly comparable.
    """
    errors = list(state.get("errors") or [])
    items = list(state.get("deduped_items") or [])
    if not items:
        return {**state, "ranked_items": [], "errors": [*errors, "rank: no items to score"]}
    try:
        ranking = _SETTINGS.get("ranking") or {}
        model_name = str(ranking.get("model") or MODEL)
        # Default False when omitted so minimal unit-test configs never read or
        # write the repo's score_cache.json; config.yaml sets `cache: true`.
        use_cache = bool(ranking.get("cache", False))
        editor_size = _as_int(ranking.get("editor_pass_size"), 20)

        skip = set()
        if ranking.get("prefilter", False):
            skip = rank.prefilter_indices(items, _SETTINGS.get("keywords") or [])

        if use_cache:
            scores_cache, editor_applied, cached_editor_size = rank_items.load_cache(
                _SCORE_CACHE_PATH, model_name
            )
        else:
            scores_cache, editor_applied, cached_editor_size = {}, False, 0

        keys = [rank_items.cache_key(item, model_name) for item in items]
        key_counts: Dict[str, int] = {}
        for key in keys:
            key_counts[key] = key_counts.get(key, 0) + 1
        shared = {key for key, count in key_counts.items() if count > 1}

        cached: Dict[int, dict] = {}
        for index, key in enumerate(keys):
            if index in skip or key in shared:
                continue
            if key in scores_cache:
                cached[index] = scores_cache[key]
        pending = [i for i in range(len(items)) if i not in cached and i not in skip]

        run_editor = (
            (not use_cache)
            or bool(pending)
            or (not editor_applied)
            or (cached_editor_size != editor_size)
        )
        chat_fn = None
        if pending or (editor_size > 0 and run_editor and len(skip) < len(items)):
            chat_fn = _chat_for("ranking")

        fresh_rows: List[dict] = []
        if pending:
            fresh_rows = rank.score_items(
                [items[i] for i in pending],
                chat_fn=chat_fn,
                batch_size=_as_int(ranking.get("batch_size"), 15),
                concurrency=_as_int(ranking.get("concurrency"), 3),
                scored_by="weekly-graph",
                fallback=True,
            )
        fresh_by_index = {pending[i]: fresh_rows[i] for i in range(len(pending))}

        raw_rows: List[dict] = []
        for index, item in enumerate(items):
            if index in skip:
                row = dict(item)
                row.update({
                    "score": 1,
                    "well7_fit": 1,
                    "reason": "prefiltered: no keyword match",
                    "score_status": "prefiltered",
                    "duplicate_of": None,
                    "scored_by": "weekly-graph",
                })
                raw_rows.append(row)
            elif index in cached:
                entry = cached[index]
                row = dict(item)
                row.update({
                    "score": int(entry.get("score") or 0),
                    "well7_fit": entry.get("well7_fit"),
                    "reason": entry.get("reason") or "",
                    "score_status": entry.get("score_status") or "scored",
                    "duplicate_of": None,
                    "scored_by": "weekly-graph",
                })
                if entry.get("editor_pass"):
                    row["editor_pass"] = True
                raw_rows.append(row)
            else:
                raw_rows.append(fresh_by_index[index])

        editable = [row for index, row in enumerate(raw_rows) if index not in skip]
        if editor_size <= 0:
            editor_done = True
        elif run_editor and editable:
            targets = rank.editor_target_indices(editable, editor_size)
            if targets:
                edited = rank.rerank_top(editable, chat_fn, top_n=editor_size)
                editor_done = all(
                    edited[index].get("editor_pass") for index in targets
                )
                editable = edited
            else:
                editor_done = False
        else:
            editor_done = editor_applied and cached_editor_size == editor_size

        editable = rank.diversify_well7_fit(editable)

        final_rows: List[dict] = []
        editable_iter = iter(editable)
        for index, row in enumerate(raw_rows):
            final_rows.append(row if index in skip else next(editable_iter))

        # Cache AFTER editor pass and BEFORE duplicate grouping so a demoted
        # duplicate score, an unscored failure, or a prefiltered item is never
        # frozen into score_cache.json.
        if use_cache:
            new_cache = dict(scores_cache)
            for index, key in enumerate(keys):
                if index in skip or key in shared:
                    continue
                row = final_rows[index]
                if (row.get("score_status") or "unscored") != "scored":
                    continue
                new_cache[key] = {
                    "score": row.get("score", 0),
                    "well7_fit": row.get("well7_fit"),
                    "reason": row.get("reason", ""),
                    "score_status": row.get("score_status", "unscored"),
                    "editor_pass": bool(row.get("editor_pass")),
                }
            rank_items.save_cache(
                _SCORE_CACHE_PATH, model_name, new_cache, editor_done, editor_size
            )

        # Same story, different titles: collapse HN/Reddit posts onto the
        # paper/repo they link to, then impose the one total order the CLI
        # path also uses. Without this, `fetch_node`'s `not duplicate_of`
        # filter is a no-op and duplicates reach the report.
        rows = rank.group_duplicates(
            final_rows, threshold=float(ranking.get("duplicate_similarity", 0.80))
        )
        rows = rank.sort_ranked(rows)

        # The same score guard the CLI applies. `max_unscored_ratio` and
        # `min_scored_to_proceed` are documented in config.yaml, and the
        # scheduled path is where a mostly-failed ranking matters most.
        attempted = [
            row for row in rows if row.get("score_status") != "prefiltered"
        ]
        scored_count = sum(
            1 for row in attempted if row.get("score_status") == "scored"
        )
        if scored_count == 0:
            errors.append("rank: no item could be scored; the report will be thin")
        elif attempted:
            ratio = (len(attempted) - scored_count) / len(attempted)
            max_ratio = float(ranking.get("max_unscored_ratio", 0.10))
            if ratio > max_ratio:
                errors.append(
                    f"rank: {ratio:.0%} of attempted items are unscored "
                    f"(threshold {max_ratio:.0%}); the report will be thin"
                )
        min_scored = _as_int(ranking.get("min_scored_to_proceed"), 1)
        if scored_count < min_scored:
            errors.append(
                f"rank: only {scored_count} scored items (need {min_scored})"
            )
            return {**state, "ranked_items": [], "errors": errors}
        if _RANKED_PATH and rows:
            ranked_file = Path(_RANKED_PATH)
            ranked_file.parent.mkdir(parents=True, exist_ok=True)
            ranked_file.write_text(
                json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        return {**state, "ranked_items": rows, "errors": errors}
    except Exception as exc:  # noqa: BLE001
        return {**state, "ranked_items": [], "errors": [*errors, f"rank: {type(exc).__name__}: {exc}"]}


def _eligible_rows(rows, bounds) -> List[dict]:
    """Rows allowed into the report: scored, not a demoted duplicate, in week."""
    return [
        row
        for row in rows
        if row.get("score_status") == "scored"
        and not row.get("duplicate_of")
        and in_week(row.get("published"), bounds)
    ]


def _fetch_one(record: dict) -> dict:
    """One record with its real page/abstract text, or its snippet on failure."""
    try:
        return fetch_candidates.fetch(record)
    except Exception as exc:  # noqa: BLE001 - one bad page must not stop the batch
        fallback = dict(record)
        fallback.update(
            {
                "text": "",
                "status": f"ERR {type(exc).__name__}",
                "fetched_from": "none",
                "chars": 0,
            }
        )
        return fallback


def fetch_node(state: AgentState, config) -> AgentState:
    """Node 4 - fetch the real abstract or page text for the shortlist.

    Ranking only sees titles and feed snippets; a summary written from those
    can describe the wrong thing. This node hands the summariser the real text
    (GitHub README, article body or abstract). Anything that cannot be fetched
    keeps its snippet, and the report says so.
    """
    errors = list(state.get("errors") or [])
    ranked = list(state.get("ranked_items") or [])
    if not ranked:
        return {**state, "shortlist": [], "errors": [*errors, "fetch: no ranked items"]}
    try:
        cap = _as_int(_SETTINGS.get("max_top_picks"), 10)
        # The same fixed Saturday-Friday window the collector and the report
        # use. Deriving it from the newest item let the window drift.
        bounds = week_bounds(_run_date(state))
        shortlist = sort_ranked(_eligible_rows(ranked, bounds))
        # Same mix rule as fetch_candidates.load_shortlist: the rubric rewards
        # "new tools", so without a cap GitHub repos can take the whole
        # shortlist away from papers and news.
        share_cap = _as_int(
            (_SETTINGS.get("ranking") or {}).get("github_share_cap"), 3
        )
        shortlist = rank.cap_github_share(shortlist, share_cap)[:cap]
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            records = list(pool.map(_fetch_one, shortlist))
        # Keep the Phase 3 artefact current: report_build.py reports how many
        # candidates it read, and a stale file made that count lie.
        Path("candidates.json").write_text(
            json.dumps(
                {record.get("url") or record.get("feed_url"): record for record in records},
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return {**state, "shortlist": records}
    except Exception as exc:  # noqa: BLE001
        # Leave `shortlist` unset: report_node then falls back to the ranked
        # rows with the eligibility filters applied. Setting it to [] here
        # used to make `shortlist or ranked_items` resurrect unfiltered rows.
        return {**state, "errors": [*errors, f"fetch: {type(exc).__name__}: {exc}"]}


def report_node(state: AgentState, config) -> AgentState:
    """Node 5 - write the trend, top picks, tools and worth-a-look."""
    errors = list(state.get("errors") or [])
    # The fetch node replaces the shortlist with records that carry the real
    # page text. If it failed, fall back to the ranked rows (snippet-only) but
    # keep the same eligibility rules, so a demoted duplicate or an
    # out-of-week item cannot slip into the report through the fallback.
    shortlist = state.get("shortlist")
    if shortlist is None:
        from synthetic_data.links import is_google_news_redirect, resolve_google_news

        bounds = week_bounds(_run_date(state))
        cap = _as_int(_SETTINGS.get("max_top_picks"), 10)
        share_cap = _as_int(
            (_SETTINGS.get("ranking") or {}).get("github_share_cap"), 3
        )
        eligible = sort_ranked(_eligible_rows(state.get("ranked_items") or [], bounds))
        capped = rank.cap_github_share(eligible, share_cap)[:cap]
        items = []
        for row in capped:
            entry = dict(row)
            if is_google_news_redirect(entry.get("url") or ""):
                entry["url"] = resolve_google_news(entry["url"])
            items.append(entry)
    else:
        items = list(shortlist)
    if not items:
        return {**state, "report": {}, "errors": [*errors, "report: no ranked items to write"]}
    try:
        summarising = _SETTINGS.get("summarising") or {}
        ranking = _SETTINGS.get("ranking") or {}
        sections = summarise.compose_sections(
            items,
            picks=_as_int(summarising.get("picks"), 6),
            max_tools=_as_int(summarising.get("max_tools"), 5),
            max_worth=_as_int(summarising.get("max_worth_a_look"), 5),
            run_date=_run_date(state),
            min_score_top=_as_int(summarising.get("min_score_top"), 7),
            min_score_tools=_as_int(summarising.get("min_score_tools"), 6),
            min_score_worth=_as_int(summarising.get("min_score_worth"), 5),
        )
        chat_fn = _chat_for("summarising")
        model_name = str(summarising.get("model") or ranking.get("model") or MODEL)
        # Same cache as write_report.py: a rerun on an unchanged week makes no
        # model calls, and a fallback is never stored, so an outage cannot freeze.
        cache = load_cache(_CACHE_PATH, model_name)
        cache_config = {
            "max_chars": _as_int(summarising.get("max_text_chars"), 6000),
            "concurrency": _as_int(summarising.get("concurrency"), 3),
        }
        pick_results = summarise_section(
            sections["top_picks"],
            chat_fn,
            cache,
            model=model_name,
            one_line=False,
            cache_config=cache_config,
        )
        tool_results = summarise_section(
            sections["tools"],
            chat_fn,
            cache,
            model=model_name,
            one_line=True,
            cache_config=cache_config,
        )
        worth_results = summarise_section(
            sections["worth_a_look"],
            chat_fn,
            cache,
            model=model_name,
            one_line=True,
            cache_config=cache_config,
        )
        save_cache(_CACHE_PATH, model_name, cache)

        all_results = pick_results + tool_results + worth_results
        if all_results and all(
            result.get("guard") in {"extractive", "skipped"} for result in all_results
        ):
            errors.append(
                "report: every summary is an extractive fallback; the model was unreachable"
            )
        top_picks = [
            pick_entry(item, result)
            for item, result in zip(sections["top_picks"], pick_results)
        ]
        tools = [
            tool_entry(item, result)
            for item, result in zip(sections["tools"], tool_results)
        ]
        worth = [
            worth_entry(item, result)
            for item, result in zip(sections["worth_a_look"], worth_results)
        ]

        # Write the trend from the finished summaries, not the raw rows. A
        # failed trend is left out and the run is flagged, never faked.
        trend = summarise.summarise_trend(top_picks, chat_fn)
        if trend.get("guard") == "omitted":
            errors.append(
                "report: trend omitted (model failed or the reply broke the "
                "no-digits rule); the run is flagged"
            )

        report = {
            "week_start": sections["week_start"],
            "week_end": sections["week_end"],
            "week_mode": "run_date",
            "dropped_below_floor": len(sections.get("dropped_below_floor") or []),
            "top_picks": top_picks,
            "tools": tools,
            "worth_a_look": worth,
            "trend": trend["trend"],
        }
        return {**state, "report": report, "errors": errors}
    except Exception as exc:  # noqa: BLE001
        return {**state, "report": {}, "errors": [*errors, f"report: {type(exc).__name__}: {exc}"]}


def _usable_week_end(value) -> Optional[str]:
    """Return an ISO date string when `value` is a usable week_end, else None."""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def _surviving_top_picks(out_dir: Path, markdown: str, html_body: str) -> bool:
    """True when rendered artefacts contain at least one surviving top pick."""
    if not markdown and not html_body:
        return False
    run_log_path = out_dir / "run_log.json"
    if run_log_path.exists():
        try:
            log_data = json.loads(run_log_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            log_data = None
        if isinstance(log_data, dict) and "top_picks" in log_data:
            return int(log_data.get("top_picks") or 0) > 0
    if markdown and "## Top picks" in markdown:
        top_section = markdown.split("## Top picks", 1)[1]
        if "## New tools and datasets" in top_section:
            top_section = top_section.split("## New tools and datasets", 1)[0]
        if re.search(r"(?m)^\s*1\.\s+\[", top_section):
            return True
    if html_body and "Top picks" in html_body:
        top_section = html_body.split("Top picks", 1)[1]
        if "New tools and datasets" in top_section:
            top_section = top_section.split("New tools and datasets", 1)[0]
        if re.search(r"\b1\.\s*<a\s+href=", top_section):
            return True
    return False


def render_node(state: AgentState, config) -> AgentState:
    """Node 6 - write source.yaml, render, verify, and load the email body."""
    errors = list(state.get("errors") or [])
    report = state.get("report") or {}
    if not isinstance(report, dict) or not report:
        return {
            **state,
            "report": {},
            "report_html": "",
            "report_markdown": "",
            "errors": [*errors, "render: no report to render"],
        }
    if not report.get("top_picks"):
        return {
            **state,
            "report": {},
            "report_html": "",
            "report_markdown": "",
            "errors": [*errors, "render: report has no top_picks"],
        }
    week_end = _usable_week_end(report.get("week_end"))
    if week_end is None:
        return {
            **state,
            "report": {},
            "report_html": "",
            "report_markdown": "",
            "errors": [*errors, "render: report has no usable week_end"],
        }
    try:
        source_path = Path("progress") / f"week-{week_end}" / "source.yaml"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text(summarise.dump_report(report, generated_at=""), encoding="utf-8")
        # --no-record: the send node records URLs only after a successful email.
        # A render, a dry run or a failed SMTP attempt must not suppress next
        # week's copy of the same link.
        code = report_build_main([str(source_path), "--no-record"])
        # Exit 1 means "rendered, but dropped dead links" — accept it only if
        # at least one top pick survives in the rendered artefacts.
        if code not in (0, 1):
            return {
                **state,
                "report": {},
                "report_html": "",
                "report_markdown": "",
                "errors": [*errors, f"render: report_build exited {code}"],
            }

        # The rendered files are the email body: report_build has already
        # dropped dead links, so the state mirrors what is on disk.
        out_dir = source_path.parent
        markdown = ""
        html_body = ""
        if (out_dir / "report.md").exists():
            markdown = (out_dir / "report.md").read_text(encoding="utf-8")
        if (out_dir / "report.html").exists():
            html_body = (out_dir / "report.html").read_text(encoding="utf-8")

        if not _surviving_top_picks(out_dir, markdown, html_body):
            return {
                **state,
                "report": {},
                "report_html": "",
                "report_markdown": "",
                "errors": [*errors, "render: no top picks survived link verification"],
            }

        return {
            **state,
            "report": report,
            "report_html": html_body,
            "report_markdown": markdown,
            "errors": errors,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            **state,
            "report": {},
            "report_html": "",
            "report_markdown": "",
            "errors": [*errors, f"render: {type(exc).__name__}: {exc}"],
        }


def send_node(state: AgentState, config) -> AgentState:
    """Node 7 - email the rendered report, or write ``email.eml`` in dry-run.

    This is the only place that records URLs in ``history.db``. If SMTP fails,
    the links stay unrecorded so the next run can still offer them.
    """
    errors = list(state.get("errors") or [])
    if not _DELIVERY.get("enabled", True):
        return state

    report = state.get("report") or {}
    if not report:
        return {**state, "errors": [*errors, "send: no report to email"]}

    source_path = Path("progress") / f"week-{report.get('week_end')}" / "source.yaml"
    try:
        summary = emailer.deliver(
            str(source_path),
            _CONFIG_PATH,
            dry_run=bool(_DELIVERY.get("dry_run")),
            record=True,
        )
        return {**state, "email": summary}
    except Exception as exc:  # noqa: BLE001 - the report exists even if email fails
        return {**state, "errors": [*errors, f"send: {type(exc).__name__}: {exc}"]}


def build_weekly_graph():
    """collect -> clean -> rank -> fetch -> report -> render -> send."""
    graph = StateGraph(AgentState)
    graph.add_node("collect", collect_node)
    graph.add_node("clean", clean_node)
    graph.add_node("rank", rank_node)
    graph.add_node("fetch", fetch_node)
    graph.add_node("report", report_node)
    graph.add_node("render", render_node)
    graph.add_node("send", send_node)
    graph.add_edge(START, "collect")
    graph.add_edge("collect", "clean")
    graph.add_edge("clean", "rank")
    graph.add_edge("rank", "fetch")
    graph.add_edge("fetch", "report")
    graph.add_edge("report", "render")
    graph.add_edge("render", "send")
    graph.add_edge("send", END)
    return graph.compile()


def weekly_run(
    config_path: str = "config.yaml",
    *,
    dry_run: bool = False,
    send: bool = True,
) -> AgentState:
    """Run the whole weekly pipeline and return the final state.

    ``dry_run`` writes the email as ``email.eml`` instead of sending it;
    ``send=False`` stops after rendering. Neither records history.
    """
    global _SETTINGS
    _SETTINGS = runner.load_config(config_path)
    configure(
        settings=_SETTINGS,
        config_path=config_path,
        delivery={"enabled": bool(send), "dry_run": bool(dry_run)},
        ranked_path="ranked.json",
    )
    graph = build_weekly_graph()
    return graph.invoke(
        {"errors": [], "run_date": date.today().isoformat()},
        config={"configurable": {"thread_id": "weekly-synthetic-data"}},
    )
