from datetime import datetime
from typing import List, TypedDict
from pydantic import BaseModel, Field

class Item(BaseModel):
    title: str
    url: str
    source: str  # "arxiv", "news", "blog", "reddit", "hn", "github"
    published: datetime
    snippet: str = ""
    full_text: str = ""
    score: int = 0
    reason: str = ""
    summary: str = ""
    target_url: str = ""

class AgentState(TypedDict, total=False):
    """The one shared state every Phase 4 node reads and writes.

    LangGraph requires a TypedDict, not a Pydantic model - a Pydantic class
    silently overwrote fields instead of merging channel updates.
    """
    raw_items: List[dict]
    deduped_items: List[dict]
    duplicates: int
    collect_counts: dict
    already_sent: int
    ranked_items: List[dict]
    shortlist: List[dict]
    report: dict
    report_html: str
    report_markdown: str
    email: dict
    errors: List[str]
    run_date: str  # ISO date; the one window every stage shares (replay hook)
