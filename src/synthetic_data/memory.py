"""SQLite memory: the URLs already sent, so a link never goes out twice.

Read and write are deliberately asymmetric:

* ``filter_seen_urls`` never creates the database. A first-ever run has no
  history, and creating an empty file just to read it makes "has this run
  before?" impossible to answer.
* ``mark_sent`` creates it on first write.

The database path is a parameter everywhere so tests can use a temp file.
"""

import os
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Iterable, List, Sequence, Set, Tuple

from synthetic_data.links import normalize_url
from synthetic_data.models import Item

DB_PATH = "history.db"


def _key(url: str) -> str:
    """Same canonical form used for dedupe, so both halves agree on identity."""
    return normalize_url(url) or url


def _backup_path(db_path: str) -> Path:
    return Path(f"{db_path}.bak")


def _read_seen_from_file(path: Path) -> Set[str]:
    if not path.exists():
        return set()
    try:
        with closing(sqlite3.connect(str(path))) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT url FROM sent_urls")
            fetched = [row[0] for row in cursor.fetchall() if row and row[0]]
    except (sqlite3.Error, OSError):
        return set()
    seen: Set[str] = set()
    for url in fetched:
        seen.add(url)
        seen.add(_key(url))
    return seen


def init_db(db_path: str = DB_PATH) -> None:
    """Creates the URLs table if it does not already exist."""
    with closing(sqlite3.connect(db_path)) as conn:
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
    seen_urls = _read_seen_from_file(Path(db_path)) | _read_seen_from_file(
        _backup_path(db_path)
    )
    if not seen_urls:
        return list(items)

    return [item for item in items if _key(item.url) not in seen_urls]


_CREATE_TABLE = """
    CREATE TABLE IF NOT EXISTS sent_urls (
        url TEXT PRIMARY KEY,
        title TEXT,
        source TEXT,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """
_INSERT = """
    INSERT OR IGNORE INTO sent_urls (url, title, source) VALUES (?, ?, ?)
    """


def mark_sent(records: Iterable[Sequence[str]], db_path: str = DB_PATH) -> int:
    """Records ``(url, title, source)`` triples. Returns how many were new.

    The write is atomic: the complete new database is built in a temp file and
    moved into place with ``os.replace``, so an interrupted run cannot leave a
    half-written ``history.db``. Every readable copy (main DB and backup) is
    merged first, so a corrupt main DB is rebuilt from the backup instead of
    raising and losing the links it held.
    """
    rows = [(_key(url), title, source) for url, title, source in records]
    target = Path(db_path)
    bak = _backup_path(db_path)
    tmp = Path(f"{db_path}.tmp")

    previous: List[Tuple[str, str, str]] = []
    for candidate in (target, bak):
        if not candidate.exists():
            continue
        try:
            with closing(sqlite3.connect(str(candidate))) as conn:
                previous.extend(
                    (_key(u), t or "", s or "")
                    for u, t, s in conn.execute(
                        "SELECT url, title, source FROM sent_urls"
                    ).fetchall()
                    if u
                )
        except (sqlite3.Error, OSError):
            # A corrupt copy is unrecoverable on its own; the other copy (or
            # this run's new rows) still protects the history.
            continue

    known = {row[0] for row in previous}
    added = 0
    for row in rows:
        if row[0] not in known:
            known.add(row[0])
            added += 1

    if tmp.exists():
        tmp.unlink()
    with closing(sqlite3.connect(str(tmp))) as conn:
        conn.execute(_CREATE_TABLE)
        conn.commit()
        conn.executemany(_INSERT, previous + rows)
        conn.commit()

    os.replace(str(tmp), str(target))
    bak_tmp = Path(f"{db_path}.bak.tmp")
    try:
        shutil.copy2(target, bak_tmp)
        os.replace(str(bak_tmp), str(bak))
    except OSError:  # noqa: BLE001 - a backup failure must never fail a send
        try:
            bak_tmp.unlink()
        except OSError:
            pass
    return added


def save_sent_urls(items: List[Item], db_path: str = DB_PATH) -> int:
    """Marks whole ``Item`` objects as sent."""
    return mark_sent(((i.url, i.title, i.source) for i in items), db_path=db_path)
