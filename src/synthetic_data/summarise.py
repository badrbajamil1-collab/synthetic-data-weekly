"""Phase 3 — turn ranked full text into report prose.

Two rules shape this module:

* **The model writes prose, never structure.** `compose_sections` decides what
  is a top pick, a tool and a worth-a-look from the score and the source, so the
  report's 5-10 / 0-5 / 0-5 format cannot depend on the model counting right.
* **A number in a summary must exist in the text the model was shown.**
  `unsupported_numbers` enforces it; after one repair attempt the item falls
  back to sentences extracted from the source, which cannot invent anything.

No file I/O here. write_report.py owns reading candidates.json, the summary
cache and writing source.yaml.
"""

import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

# JSON extraction is shared with the ranker on purpose: models fail the same way
# for scores and for summaries, and one implementation means one place to fix.
from synthetic_data.rank import _first_json_value, _strip_fences, sort_ranked

SUMMARY_VERSION = "2026-11-06.1"

MIN_PICKS = 5
MAX_PICKS = 10
MAX_SUMMARY_CHARS = 900

# The brief asks for 2-3 line summaries; these are the word budgets the prompt
# states and the guard enforces. A long reply is repaired once, then falls back.
WORDS_LONG = 70
WORDS_SHORT = 35

# A number at the start of a token: 0.54, 1,000, 223, 79M (the suffix is not
# part of the token). Deliberately no trailing word boundary, or "79M" and
# "1.5x" would escape the check.
_NUMBER = re.compile(r"(?<!\d)(\d+(?:[.,]\d+)*)")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_SNIPPET_MARK = "(full text unavailable)"

# READMEs arrive as raw Markdown. Without this the extractive fallback can put
# "# CrossSynth **When sites train..." straight into the report.
_FENCE = re.compile(r"```.*?```", re.S)
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_HTML_TAG = re.compile(r"<[^>]+>")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s*.*$", re.M)
_BULLET = re.compile(r"^\s{0,3}(?:[-*+]|\d+[.)])\s+", re.M)
_BOLD = re.compile(r"\*\*(.+?)\*\*", re.S)
_UNDER_BOLD = re.compile(r"__(.+?)__", re.S)
_ITALIC = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
_CODE = re.compile(r"`([^`]+)`")


def clean_text(text: str) -> str:
    """Strip Markdown and HTML decoration so the prose is prose.

    Deliberately does not touch underscores inside words: library names such as
    `seege_` are content, not emphasis.
    """
    value = _FENCE.sub(" ", text or "")
    value = _MD_IMAGE.sub(" ", value)
    value = _MD_LINK.sub(r"\1", value)
    value = _HTML_TAG.sub(" ", value)
    value = _HEADING.sub("", value)
    value = _BULLET.sub("", value)
    value = _CODE.sub(r"\1", value)
    value = _BOLD.sub(r"\1", value)
    value = _UNDER_BOLD.sub(r"\1", value)
    value = _ITALIC.sub(r"\1", value)
    return re.sub(r"\s+", " ", value).strip()

SOURCE_LABELS = {
    "arxiv": "arXiv",
    "github": "GitHub",
    "hn": "Hacker News",
    "reddit": "Reddit",
    "blog": "Blog",
    "news": "Google News",
}


class CompositionError(Exception):
    """The shortlist cannot satisfy the report format's structure rules."""


# ---------------------------------------------------------------------------
# dates
# ---------------------------------------------------------------------------

def published_date(value) -> Optional[date]:
    """Parse the several shapes `published` arrives in: date, datetime, ISO."""
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return moment.date()
    if isinstance(value, date):
        return value
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.date()


def week_end_for(items: Iterable[dict]) -> date:
    """The report's last day: the newest publication date in the shortlist.

    Deriving it from the data rather than from `now` keeps a replayed week
    reproducible, and keeps every pick inside verify_report.py's own window.
    """
    dates = [day for day in (published_date(i.get("published")) for i in items) if day]
    if not dates:
        raise CompositionError("no candidate has a usable publication date")
    return max(dates)


# ---------------------------------------------------------------------------
# the fact guard
# ---------------------------------------------------------------------------

def extract_numbers(text: str) -> set:
    """Every numeric token in `text`, with thousands separators removed."""
    found = set()
    for match in _NUMBER.finditer(text or ""):
        token = match.group(1).replace(",", "").rstrip(".")
        if token:
            found.add(token)
    return found


def unsupported_numbers(summary: str, source: str) -> List[str]:
    """Numbers in `summary` that do not appear as numbers in `source`.

    The boundary check matters: a summary saying "5" must not pass because the
    source happens to contain "15" or "1979".
    """
    cleaned = (source or "").replace(",", "")
    missing = []
    for token in sorted(extract_numbers(summary)):
        if not re.search(r"(?<!\d)" + re.escape(token) + r"(?!\d)", cleaned):
            missing.append(token)
    return missing


# ---------------------------------------------------------------------------
# extractive fallback
# ---------------------------------------------------------------------------

def _sentences(text: str) -> List[str]:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if not cleaned:
        return []
    return [part.strip() for part in _SENTENCE.split(cleaned) if len(part.strip()) > 20]


def word_count(text: str) -> int:
    return len((text or "").replace(_SNIPPET_MARK, "").split())


def extractive_summary(text: str, max_chars: int = 420, max_sentences: int = 3) -> str:
    """The first useful sentences of the source. Cannot invent a fact."""
    picked: List[str] = []
    total = 0
    for sentence in _sentences(text):
        if picked and total + len(sentence) > max_chars:
            break
        picked.append(sentence)
        total += len(sentence)
        if len(picked) >= max_sentences:
            break
    if not picked:
        return re.sub(r"\s+", " ", (text or "")).strip()[:max_chars]
    return " ".join(picked)[:max_chars]


# ---------------------------------------------------------------------------
# prompts and parsing
# ---------------------------------------------------------------------------

_ITEM_PROMPT = """You write one entry in a weekly synthetic-data research report.

Summarise the item below in {length}.

Rules:
- Use ONLY facts stated in the TEXT. Do not use outside knowledge.
- Never invent a number, name, organisation or date. If it is not in the TEXT, leave it out.
- Describe the item as the TEXT presents it. Do not infer its data type, domain or venue
  from the title.
- Start with the substance, not "This article" or "This paper".
- Say what it is, what it does or finds, and why it matters to someone working on synthetic data.
- Plain prose. No bullets, no marketing adjectives, no hype words. Never use
  "breakthrough", "dramatically", "revolutionary", "game-changing", "unprecedented"
  or "groundbreaking".
{extra}
ITEM
Title: {title}
Source: {source}
Published: {published}

TEXT
{text}

Reply with JSON only: {{"summary": "your summary"}}"""

_TREND_PROMPT = """You write the opening paragraph of a weekly synthetic-data research report.

Below are the headlines and summaries of this week's selected items.

Write 3 to 5 sentences (at most 110 words) about what this week's selection says
about the field.

Rules:
- Use ONLY the material below. No outside knowledge, no predictions.
- Do not use any digits in the paragraph; write a quantity in words only if it is essential.
- Never invent a number, name, organisation or date.
- Name at most three organisations or projects.
- Do not list the items one by one; find the common thread.
- Avoid hype words such as "breakthrough", "dramatically", "revolutionary" or "game-changing".
- If there is no clear thread, describe the range of topics instead of forcing one.

ITEMS
{items}

Reply with JSON only: {{"trend": "your paragraph"}}"""


def source_text(item: dict, *, max_chars: int = 6000) -> Tuple[str, str]:
    """The best text available, and what kind it is.

    "snippet only" is the documented Hacker News case: the page returns 419 to
    non-browser clients, so the report must say the summary came from a snippet.
    """
    text = clean_text(item.get("text") or "")
    if text:
        return text[:max_chars], "full text"
    snippet = clean_text(item.get("snippet") or "")
    if snippet:
        return snippet[:max_chars], "snippet only"
    return "", "title only"


def build_prompt(
    item: dict,
    *,
    one_line: bool = False,
    max_chars: int = 6000,
    rejected_numbers: Sequence[str] = (),
    over_words: int = 0,
) -> str:
    text, origin = source_text(item, max_chars=max_chars)
    short = one_line or origin == "snippet only"
    limit = WORDS_SHORT if short else WORDS_LONG
    length = (
        f"one sentence, at most {WORDS_SHORT} words"
        if short
        else f"2 to 3 sentences, at most {WORDS_LONG} words"
    )

    extra = []
    if origin == "snippet only":
        extra.append(
            "- Full text was unavailable; the TEXT below is the snippet only. "
            f'End the sentence with the exact words "{_SNIPPET_MARK}".'
        )
    if rejected_numbers:
        extra.append(
            "- Your previous attempt used these numbers, which are NOT in the TEXT: "
            + ", ".join(rejected_numbers)
            + ". Remove them or correct them."
        )
    if over_words:
        extra.append(
            f"- Your previous attempt was {over_words} words long. "
            f"Keep it under {limit} words and drop detail rather than sentences."
        )
    extra_text = ("\n".join(extra) + "\n") if extra else ""

    day = published_date(item.get("published"))
    return _ITEM_PROMPT.format(
        length=length,
        extra=extra_text,
        title=item.get("title") or "",
        source=source_label(item),
        published=day.isoformat() if day else "unknown",
        text=text,
    )


def parse_summary(text: Optional[str], *, key: str = "summary") -> Optional[str]:
    """Decode a model reply into one paragraph. Never raises, never empty."""
    if not text or not str(text).strip():
        return None
    payload = _first_json_value(_strip_fences(str(text)))
    if isinstance(payload, list) and len(payload) == 1:
        payload = payload[0]
    if isinstance(payload, dict):
        value = payload.get(key) or payload.get("summary") or payload.get("trend")
    else:
        value = payload
    if not isinstance(value, str) or not value.strip():
        return None
    return re.sub(r"\s+", " ", value).strip()[:MAX_SUMMARY_CHARS]


def _finish(summary: str, origin: str) -> str:
    """Collapse whitespace and guarantee the snippet disclosure survives."""
    text = re.sub(r"\s+", " ", summary or "").strip()
    if origin == "snippet only":
        limit = MAX_SUMMARY_CHARS - len(_SNIPPET_MARK) - 1
        text = text[:limit].rstrip()
        if _SNIPPET_MARK not in text:
            text = f"{text} {_SNIPPET_MARK}".strip()
    return text[:MAX_SUMMARY_CHARS]


# ---------------------------------------------------------------------------
# per-item summarising
# ---------------------------------------------------------------------------

def summarise_item(
    item: dict,
    chat_fn: Callable[[List[dict]], str],
    *,
    one_line: bool = False,
    max_chars: int = 6000,
    attempts: int = 2,
) -> dict:
    """Summarise one item with a numeric fact guard and an extractive fallback.

    Returns {"summary", "origin", "guard"} where guard is:
      passed     - the first reply passed the number check
      repaired   - the first reply invented numbers, the retry passed
      extractive - the model failed twice (or was unreachable); summary is
                   taken verbatim from the source text
      skipped    - there was no text at all to summarise
    """
    text, origin = source_text(item, max_chars=max_chars)
    if origin == "title only":
        return {
            "summary": "No text could be retrieved for this item; see the link.",
            "origin": origin,
            "guard": "skipped",
        }

    # The title is shown to the model, so a number quoted from it is legitimate.
    guard_text = f"{item.get('title') or ''}\n{text}"
    short = one_line or origin == "snippet only"
    prompt = build_prompt(item, one_line=one_line, max_chars=max_chars)
    rejected: List[str] = []
    failures: List[str] = []

    for attempt in range(attempts):
        try:
            raw = chat_fn([{"role": "user", "content": prompt}])
        except Exception as exc:  # noqa: BLE001 - one failing item must not stop the report
            raw = None
            failures.append(
                f"call failed: {type(exc).__name__}: {str(exc)[:160]}"
            )
        candidate = parse_summary(raw) if raw else None
        if candidate is None:
            if raw:
                failures.append("reply was not usable JSON")
            continue
        missing = unsupported_numbers(candidate, guard_text)
        words = word_count(candidate)
        limit = WORDS_SHORT if short else WORDS_LONG
        over = words if words > limit else 0
        if not missing and not over:
            return {
                "summary": _finish(candidate, origin),
                "origin": origin,
                "guard": "passed" if attempt == 0 else "repaired",
            }
        if over:
            failures.append(f"reply was {words} words, limit {limit}")
        rejected = missing
        prompt = build_prompt(
            item,
            one_line=one_line,
            max_chars=max_chars,
            rejected_numbers=missing,
            over_words=over,
        )

    detail = list(failures)
    if rejected:
        detail.append("numbers not in text: " + ", ".join(rejected))
    if short:
        fallback = extractive_summary(text, max_chars=240, max_sentences=1)
    else:
        fallback = extractive_summary(text)
    return {
        "summary": _finish(fallback, origin),
        "origin": origin,
        "guard": "extractive",
        "rejected": rejected,
        "detail": detail,
    }


def summarise_items(
    items: Iterable[dict],
    chat_fn: Callable[[List[dict]], str],
    *,
    one_line: bool = False,
    max_chars: int = 6000,
    concurrency: int = 3,
) -> List[dict]:
    """One result per item, in input order. Independent calls, so they can race."""
    source = list(items)
    if not source:
        return []

    def run(item: dict) -> dict:
        return summarise_item(item, chat_fn, one_line=one_line, max_chars=max_chars)

    if concurrency and concurrency > 1:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            return list(pool.map(run, source))
    return [run(item) for item in source]


# ---------------------------------------------------------------------------
# the trend paragraph
# ---------------------------------------------------------------------------

def fallback_trend(picks: Iterable[dict]) -> str:
    """Deterministic opening made from the picks' own first sentences."""
    sentences = []
    for pick in list(picks)[:3]:
        parts = _sentences(pick.get("summary") or "")
        if parts:
            sentences.append(parts[0])
    if not sentences:
        return "This week's shortlist is listed below."
    return " ".join(sentences)


def summarise_trend(
    picks: Iterable[dict],
    chat_fn: Callable[[List[dict]], str],
    *,
    attempts: int = 2,
) -> dict:
    """The opening paragraph, guarded against invented numbers."""
    picks = list(picks)
    material = "\n".join(
        f"- {pick.get('title') or ''} ({pick.get('source') or ''}): {pick.get('summary') or ''}"
        for pick in picks
    )
    prompt = _TREND_PROMPT.format(items=material)

    for attempt in range(attempts):
        try:
            raw = chat_fn([{"role": "user", "content": prompt}])
        except Exception:  # noqa: BLE001
            raw = None
        candidate = parse_summary(raw, key="trend") if raw else None
        if candidate:
            missing = unsupported_numbers(candidate, material)
            if not missing:
                return {
                    "trend": candidate,
                    "guard": "passed" if attempt == 0 else "repaired",
                }
            prompt = _TREND_PROMPT.format(items=material) + (
                "\n\nYour previous attempt used these numbers, which are NOT in the "
                "ITEMS: " + ", ".join(missing) + ". Remove them or correct them."
            )

    return {"trend": fallback_trend(picks), "guard": "extractive"}


# ---------------------------------------------------------------------------
# deterministic structure
# ---------------------------------------------------------------------------

def compose_sections(
    items: Iterable[dict],
    *,
    picks: int = 6,
    max_tools: int = 5,
    max_worth: int = 5,
    week_end=None,
) -> dict:
    """Split the shortlist into the report's three sections.

    The split is a rule, not a judgement: the ranking already ordered the
    shortlist, so the first `picks` items inside the week become top picks,
    GitHub items after that become tools, and the rest become worth-a-look.
    """
    source = [dict(item) for item in items]
    if not source:
        raise CompositionError("no candidate items")

    ordered = sort_ranked(source)
    end = week_end or week_end_for(ordered)
    if isinstance(end, str):
        end = date.fromisoformat(end)
    cutoff = end - timedelta(days=6)

    eligible = [
        index
        for index, item in enumerate(ordered)
        if (day := published_date(item.get("published"))) and cutoff <= day <= end
    ]
    if len(eligible) < MIN_PICKS:
        raise CompositionError(
            f"only {len(eligible)} of {len(ordered)} items fall inside "
            f"{cutoff}..{end}; the report format needs at least {MIN_PICKS} top picks"
        )

    target = max(MIN_PICKS, min(MAX_PICKS, int(picks)))
    pick_index = eligible[:target]
    chosen = set(pick_index)

    # Every section obeys the same seven-day window. Selecting tools and
    # worth-a-look entries from all items let an older release back into the
    # report even though it was correctly excluded from the top picks.
    rest = [index for index in eligible if index not in chosen]
    tool_index = [
        index for index in rest if (ordered[index].get("source") or "").lower() == "github"
    ][:max_tools]
    in_tools = set(tool_index)
    worth_index = [
        index for index in rest if index not in in_tools
    ][:max_worth]
    in_worth = set(worth_index)

    return {
        "week_start": cutoff,
        "week_end": end,
        "top_picks": [ordered[index] for index in pick_index],
        "tools": [ordered[index] for index in tool_index],
        "worth_a_look": [ordered[index] for index in worth_index],
        "dropped": [
            ordered[index]
            for index in rest
            if index not in in_tools and index not in in_worth
        ],
    }


def source_label(item: dict) -> str:
    """A human label: arXiv/GitHub/Hacker News, or the publisher's hostname."""
    kind = (item.get("source") or "").lower()
    if kind in {"news", "blog"}:
        host = urlparse(item.get("url") or "").netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        if host:
            return host
    return SOURCE_LABELS.get(kind, item.get("source") or "unknown")


# ---------------------------------------------------------------------------
# YAML output
# ---------------------------------------------------------------------------

def _iso(value) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value or "")


def _q(value) -> str:
    """A JSON string is a valid YAML double-quoted scalar."""
    return json.dumps(str(value), ensure_ascii=False)


def _fold(text: str, *, width: int = 100, indent: str = "    ") -> str:
    words = str(text or "").split()
    if not words:
        return indent
    lines: List[str] = []
    current = ""
    for word in words:
        if current and len(current) + len(word) + 1 > width:
            lines.append(current)
            current = word
        else:
            current = word if not current else f"{current} {word}"
    if current:
        lines.append(current)
    return "\n".join(indent + line for line in lines)


def _entry(entry: dict, name_key: str, note_key: str) -> List[str]:
    out = [
        f"  - {name_key}: {_q(entry.get(name_key) or '')}",
        f"    url: {_q(entry.get('url') or '')}",
    ]
    if entry.get("source"):
        out.append(f"    source: {_q(entry['source'])}")
    if entry.get("published"):
        out.append(f"    published: {_iso(entry['published'])}")
    out.append(f"    {note_key}: >-")
    out.append(_fold(entry.get(note_key) or "", indent="      "))
    for key in ("score", "well7_fit"):
        if entry.get(key) is not None:
            out.append(f"    {key}: {int(entry[key])}")
    for key in ("summary_origin", "guard"):
        if entry.get(key):
            out.append(f"    {key}: {_q(entry[key])}")
    return out


def dump_report(report: dict, *, generated_at: str = "") -> str:
    """Emit source.yaml in the hand-written shape: quoted keys, folded prose."""
    stamp = f" on {generated_at}" if generated_at else ""
    lines = [
        f"# Generated by write_report.py{stamp} - Phase 3.",
        "# Summaries use only the text stored in candidates.json. Every number is",
        "# checked against that text; guard: extractive means the model failed the",
        "# check twice and the prose was taken verbatim from the source.",
        "",
        f"week_start: {_iso(report['week_start'])}",
        f"week_end: {_iso(report['week_end'])}",
        "",
        "trend: >-",
        _fold(report.get("trend") or ""),
        "",
    ]

    sections = (
        ("top_picks", "title", "summary"),
        ("tools", "name", "note"),
        ("worth_a_look", "title", "note"),
    )
    for key, name_key, note_key in sections:
        entries = report.get(key) or []
        if not entries:
            continue
        lines.append(f"{key}:")
        for entry in entries:
            lines.extend(_entry(entry, name_key, note_key))
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
