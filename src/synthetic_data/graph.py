"""Phase 4 - the weekly synthetic-data report as a LangGraph state machine.

One shared ``AgentState`` flows through six nodes:

    collect -> clean -> rank -> fetch -> report -> render -> END

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
from datetime import timedelta
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from langgraph.graph import END, START, StateGraph

import fetch_candidates
from synthetic_data import llm, rank, runner, summarise
from synthetic_data.models import AgentState, Item
from synthetic_data.rank import sort_ranked

from report_build import main as report_build_main
from write_report import pick_entry, summarise_section, tool_entry, worth_entry


MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
DEFAULT_SUMMARISE_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"


_SETTINGS: Dict[str, Any] = {}
_CHAT_FN: Optional[Callable[[List[dict]], str]] = None


def configure(
    *,
    settings: Optional[Dict[str, Any]] = None,
    chat_fn: Optional[Callable[[List[dict]], str]] = None,
) -> None:
    """Set the config + chat function a weekly run should use.

    ``chat_fn`` exists so offline tests can inject a fake model and the real
    run can bind the configured OpenRouter client.
    """
    global _SETTINGS, _CHAT_FN
    if settings is not None:
        _SETTINGS = settings
    if chat_fn is not None:
        _CHAT_FN = chat_fn


def _chat_for(section: str) -> Callable[[List[dict]], str]:
    if _CHAT_FN is not None:
        return _CHAT_FN

    block = _SETTINGS.get(section) or {}
    api_key = llm.require(llm.load_env(), "OPENROUTER_API_KEY")
    base_url = block.get("base_url") or llm.DEFAULT_BASE_URL
    model = block.get("model") or (
        (_SETTINGS.get("ranking") or {}).get("model") or DEFAULT_SUMMARISE_MODEL
    )

    def chat_fn(messages: List[dict]) -> str:
        content, _retries = llm.chat(
            messages,
            api_key=api_key,
            base_url=base_url,
            model=model,
            temperature=float(block.get("temperature") or 0.0),
            max_tokens=int(block.get("max_tokens") or 2000),
            reasoning_effort=block.get("reasoning_effort") or "low",
            timeout=float(block.get("timeout_seconds") or 180),
            attempts=int(block.get("max_attempts") or 4),
        )
        return content

    return chat_fn


def collect_node(state: AgentState, config) -> AgentState:
    """Node 1 - gather this week's raw items from every source."""
    errors = list(state.get("errors") or [])
    try:
        result = runner.collect_all(_SETTINGS, use_history=False)
        return {
            "raw_items": [item.model_dump(mode="json") for item in result.items],
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
    items = [
        item if isinstance(item, Item) else Item(**item)
        for item in state.get("raw_items") or []
    ]
    unique, dropped = runner.dedupe_items(items)
    return {
        "deduped_items": [item.model_dump(mode="json") for item in unique],
        "duplicates": dropped,
    }


def rank_node(state: AgentState, config) -> AgentState:
    """Node 3 - LLM scores each item 1-10 with a one-line reason."""
    errors = list(state.get("errors") or [])
    items = list(state.get("deduped_items") or [])
    if not items:
        return {**state, "ranked_items": [], "errors": [*errors, "rank: no items to score"]}
    try:
        ranking = _SETTINGS.get("ranking") or {}
        rows = rank.score_items(
            items,
            chat_fn=_chat_for("ranking"),
            batch_size=int(ranking.get("batch_size") or 15),
            concurrency=int(ranking.get("concurrency") or 3),
            scored_by="weekly-graph",
            fallback=True,
        )
        return {**state, "ranked_items": rows}
    except Exception as exc:  # noqa: BLE001
        return {**state, "ranked_items": [], "errors": [*errors, f"rank: {type(exc).__name__}: {exc}"]}


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
        cap = int(_SETTINGS.get("max_top_picks") or 10)
        eligible = [
            row
            for row in ranked
            if row.get("score_status") == "scored" and not row.get("duplicate_of")
        ]
        # Apply the report's seven-day window before the cap, so a stale
        # high-scorer cannot take a fetch slot from a current item.
        end = summarise.week_end_for(eligible)
        cutoff = end - timedelta(days=6)
        in_window = [
            row
            for row in eligible
            if (day := summarise.published_date(row.get("published")))
            and cutoff <= day <= end
        ]
        shortlist = sort_ranked(in_window)[:cap]
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
            records = list(pool.map(_fetch_one, shortlist))
        return {**state, "shortlist": records}
    except Exception as exc:  # noqa: BLE001
        return {
            **state,
            "shortlist": [],
            "errors": [*errors, f"fetch: {type(exc).__name__}: {exc}"],
        }


def report_node(state: AgentState, config) -> AgentState:
    """Node 5 - write the trend, top picks, tools and worth-a-look."""
    errors = list(state.get("errors") or [])
    # The fetch node replaces the shortlist with records that carry the real
    # page text. If it failed, fall back to the ranked rows (snippet-only).
    items = list(state.get("shortlist") or state.get("ranked_items") or [])
    if not items:
        return {**state, "report": {}, "errors": [*errors, "report: no ranked items to write"]}
    try:
        summarising = _SETTINGS.get("summarising") or {}
        sections = summarise.compose_sections(
            items,
            picks=int(summarising.get("picks") or 6),
            max_tools=int(summarising.get("max_tools") or 5),
            max_worth=int(summarising.get("max_worth_a_look") or 5),
        )
        chat_fn = _chat_for("summarising")
        cache_config = {
            "max_chars": int(summarising.get("max_text_chars") or 6000),
            "concurrency": int(summarising.get("concurrency") or 3),
        }
        pick_results = summarise_section(
            sections["top_picks"],
            chat_fn,
            {},
            model=str(summarising.get("model") or MODEL),
            one_line=False,
            cache_config=cache_config,
        )
        tool_results = summarise_section(
            sections["tools"],
            chat_fn,
            {},
            model=str(summarising.get("model") or MODEL),
            one_line=True,
            cache_config=cache_config,
        )
        worth_results = summarise_section(
            sections["worth_a_look"],
            chat_fn,
            {},
            model=str(summarising.get("model") or MODEL),
            one_line=True,
            cache_config=cache_config,
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

        # Write the trend from the finished summaries, not the raw rows.
        trend = summarise.summarise_trend(top_picks, chat_fn)

        report = {
            "week_start": sections["week_start"],
            "week_end": sections["week_end"],
            "top_picks": top_picks,
            "tools": tools,
            "worth_a_look": worth,
            "trend": trend["trend"],
        }
        return {**state, "report": report}
    except Exception as exc:  # noqa: BLE001
        return {**state, "report": {}, "errors": [*errors, f"report: {type(exc).__name__}: {exc}"]}


def render_node(state: AgentState, config) -> AgentState:
    """Node 5 - write source.yaml, render, verify, and record the sent URLs."""
    errors = list(state.get("errors") or [])
    report = state.get("report") or {}
    if not report:
        return {
            **state,
            "report_html": state.get("report_html") or "",
            "report_markdown": state.get("report_markdown") or "",
            "errors": [*errors, "render: no report to render"],
        }
    try:
        source_path = Path("progress") / f"week-{report.get('week_end')}" / "source.yaml"
        source_path.parent.mkdir(parents=True, exist_ok=True)
        source_path.write_text(summarise.dump_report(report, generated_at=""), encoding="utf-8")
        code = report_build_main([str(source_path)])
        if code != 0:
            errors.append(f"render: report_build exited {code}")

        # The rendered files are the email body: report_build has already
        # dropped dead links, so the state mirrors what is on disk.
        out_dir = source_path.parent
        markdown = ""
        html_body = ""
        if (out_dir / "report.md").exists():
            markdown = (out_dir / "report.md").read_text(encoding="utf-8")
        if (out_dir / "report.html").exists():
            html_body = (out_dir / "report.html").read_text(encoding="utf-8")
        return {
            **state,
            "report": report,
            "report_html": html_body,
            "report_markdown": markdown,
            "errors": errors,
        }
    except Exception as exc:  # noqa: BLE001
        return {**state, "errors": [*errors, f"render: {type(exc).__name__}: {exc}"]}


def build_weekly_graph():
    """collect -> clean -> rank -> fetch -> report -> render."""
    graph = StateGraph(AgentState)
    graph.add_node("collect", collect_node)
    graph.add_node("clean", clean_node)
    graph.add_node("rank", rank_node)
    graph.add_node("fetch", fetch_node)
    graph.add_node("report", report_node)
    graph.add_node("render", render_node)
    graph.add_edge(START, "collect")
    graph.add_edge("collect", "clean")
    graph.add_edge("clean", "rank")
    graph.add_edge("rank", "fetch")
    graph.add_edge("fetch", "report")
    graph.add_edge("report", "render")
    graph.add_edge("render", END)
    return graph.compile()


def weekly_run(config_path: str = "config.yaml") -> AgentState:
    """Run the whole weekly pipeline and return the final state."""
    global _SETTINGS
    _SETTINGS = runner.load_config(config_path)
    graph = build_weekly_graph()
    return graph.invoke(
        {"errors": []},
        config={"configurable": {"thread_id": "weekly-synthetic-data"}},
    )
