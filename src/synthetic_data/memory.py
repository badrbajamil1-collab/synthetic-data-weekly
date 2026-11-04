"""SQLite memory: the URLs already sent, so a link never goes out twice.

Read and write are deliberately asymmetric:

* ``filter_seen_urls`` never creates the database. A first-ever run has no
  history, and creating an empty file just to read it makes "has this run
  before?" impossible to answer.
* ``mark_sent`` creates it on first write.

The database path is a parameter everywhere so tests can use a temp file.
"""

import sqlite3
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

from synthetic_data.links import normalize_url
from synthetic_data.models import Item

DB_PATH = "history.db"


def _key(url: str) -> str:
    """Same canonical form used for dedupe, so both halves agree on identity."""
    return normalize_url(url) or url


def init_db(db_path: str = DB_PATH) -> None:
    """Creates the URLs table if it does not already exist."""
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sent_urls (
                url TEXT PRIMARY KEY,
                title TEXT,
                source TEXT,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()


def filter_seen_urls(items: List[Item], db_path: str = DB_PATH) -> List[Item]:
    """Drops items whose URL is already recorded. Read-only: no DB is created."""
    if not Path(db_path).exists():
        return list(items)

    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT url FROM sent_urls")
        seen_urls = {row[0] for row in cursor.fetchall()}

    return [item for item in items if _key(item.url) not in seen_urls]


def mark_sent(records: Iterable[Sequence[str]], db_path: str = DB_PATH) -> int:
    """Records ``(url, title, source)`` triples. Returns how many were new."""
    init_db(db_path)
    rows = [(_key(url), title, source) for url, title, source in records]
    if not rows:
        return 0
    with sqlite3.connect(db_path) as conn:
        before = conn.total_changes
        conn.executemany(
            """
            INSERT OR IGNORE INTO sent_urls (url, title, source)
            VALUES (?, ?, ?)
            """,
            rows,
        )
        conn.commit()
        return conn.total_changes - before


def save_sent_urls(items: List[Item], db_path: str = DB_PATH) -> int:
    """Marks whole ``Item`` objects as sent."""
    return mark_sent(((i.url, i.title, i.source) for i in items), db_path=db_path)
