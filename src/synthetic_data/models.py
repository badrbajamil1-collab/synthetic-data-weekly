from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field

class Item(BaseModel):
    title: str
    url: str
    source: str  # "arxiv", "news", "reddit", "hn", "github", "blog"
    published: datetime
    snippet: str = ""
    full_text: str = ""
    score: int = 0
    reason: str = ""
    summary: str = ""

class AgentState(BaseModel):
    raw_items: List[Item] = Field(default_factory=list)
    ranked_items: List[Item] = Field(default_factory=list)
    report_html: str = ""
    report_markdown: str = ""
    errors: List[str] = Field(default_factory=list)
