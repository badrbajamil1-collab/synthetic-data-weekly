import sqlite3
from typing import List, Tuple
from synthetic_data.models import Item

DB_PATH = "history.db"

def init_db(db_path: str = DB_PATH) -> None:
    """Creates the URLs table if it does not already exist."""
    with sqlite3.connect(db_path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sent_urls (
                url TEXT PRIMARY KEY,
                title TEXT,
                source TEXT,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()

def filter_seen_urls(items: List[Item], db_path: str = DB_PATH) -> List[Item]:
    """Filters out any item whose URL is already recorded in the SQLite database."""
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT url FROM sent_urls")
        seen_urls = {row[0] for row in cursor.fetchall()}
        
    return [item for item in items if item.url not in seen_urls]

def save_sent_urls(items: List[Item], db_path: str = DB_PATH) -> None:
    """Marks items as sent so they will never appear in future weekly reports."""
    init_db(db_path)
    records: List[Tuple[str, str, str]] = [(item.url, item.title, item.source) for item in items]
    with sqlite3.connect(db_path) as conn:
        conn.executemany("""
            INSERT OR IGNORE INTO sent_urls (url, title, source)
            VALUES (?, ?, ?)
        """, records)
        conn.commit()
