"""Phase 3 — turn ranked full text into report prose.

Three rules shape this module:

* **The model writes prose, never structure.** `compose_sections` decides what
  is a top pick, a tool and a worth-a-look from the score and the source, so the
  report's 1-10 / 0-5 / 0-5 format cannot depend on the model counting right.
* **A number in a summary must exist in the text the model was shown.**
  `unsupported_numbers` enforces it; after one repair attempt the item falls
  back to sentences extracted from the source, which cannot invent anything.
  The "why it matters" line is held to the same guard.
* **Nothing is padded and nothing is faked.** A section shorter than its cap
  is a short week, not a reason to promote a below-floor item. A trend the
  model could not write is left out, not assembled from the picks' first
  sentences.

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
from synthetic_data.week import in_week, week_bounds

SUMMARY_VERSION = "2026-11-13.1"

MIN_PICKS = 1
MAX_PICKS = 10
MAX_SUMMARY_CHARS = 420
MAX_WHY_CHARS = 220
# The trend is its own paragraph (up to 110 words), not an item summary.
# Capping it at the item budget severed the paragraph mid-word.
MAX_TREND_CHARS = 900

# Tighter word budgets: 1-2 sentences (~50 words) for top picks, one sentence
# (~20 words) for tools, worth-a-look and snippet-only items. A long reply is
# repaired once, then falls back.
WORDS_LONG = 50
WORDS_SHORT = 20

# The "why it matters" line is its own budget: one short line under an entry.
WORDS_WHY = 18

# A number at the start of a token: 0.54, 1,000, 223, 79M (the suffix is not
# part of the token). Deliberately no trailing word boundary, or "79M" and
# "1.5x" would escape the check.
#
_NUMBER = re.compile(r"(?<!\d)(\d+(?:[.,]\d+)*)")
# Keep the original, strict numeric guard. Weakening the lookbehind to
# (?<![A-Za-z\d]) would split "GPT3.5" into a phantom "5" and let a
# hallucinated "v9.5" through. Only the report's own brand is a known
# non-quantity identifier, so strip that one token before extracting numbers.
_BRAND_TOKENS = re.compile(r"\bwell7\b", re.IGNORECASE)
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


def _as_date(value) -> Optional[date]:
    """A date from a date, a datetime or an ISO string. None if unusable.

    `run_date` and `week_end` arrive in all three shapes: the CLI parses a
    string, the graph carries a date, and a caller may pass a datetime.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return published_date(value)
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return published_date(text)


# ---------------------------------------------------------------------------
# the fact guard
# ---------------------------------------------------------------------------

def extract_numbers(text: str) -> set:
    """Every numeric token in `text`, with thousands separators removed."""
    found = set()
    cleaned = _BRAND_TOKENS.sub(" ", text or "")
    for match in _NUMBER.finditer(cleaned):
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

Summarise the item below in {length}, plus a "why_it_matters" line of at most 18 words.

Rules:
- Use ONLY facts stated in the TEXT. Do not use outside knowledge.
- Never invent a number, name, organisation or date. If it is not in the TEXT, leave it out.
- Describe the item as the TEXT presents it. Do not infer its data type, domain or venue
  from the title.
- Start with the substance, not "This article" or "This paper".
- "summary" states what the item is and what it does or finds.
- "why_it_matters" is one short line (at most 18 words) on why it matters to someone working on synthetic data, using only facts in the TEXT.
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

Reply with JSON only: {{"summary": "your summary", "why_it_matters": "one short line"}}"""

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
    over_why_words: int = 0,
    missing_why: bool = False,
) -> str:
    text, origin = source_text(item, max_chars=max_chars)
    short = one_line or origin == "snippet only"
    limit = WORDS_SHORT if short else WORDS_LONG
    length = (
        f"one sentence, at most {WORDS_SHORT} words"
        if short
        else f"1 to 2 sentences, at most {WORDS_LONG} words"
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
    if over_why_words:
        extra.append(
            f"- Your previous why_it_matters line was {over_why_words} words long. "
            f"Keep it under {WORDS_WHY} words: one short line, no detail."
        )
    if missing_why:
        extra.append(
            "- Your previous reply omitted why_it_matters. You MUST return a "
            f"non-empty \"why_it_matters\" string of at most {WORDS_WHY} words."
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


def _clip(text: str, limit: int) -> str:
    """Trim to `limit` characters at a word boundary.

    Truncating before the fact guard turned "... by 99.9 percent" into a
    validated "9", and a plain character cut severed words ("generation"
    became "generat"). Cut at the last space instead, then drop any number
    token left hanging at the end.
    """
    if len(text) <= limit:
        return text
    cut = text[:limit]
    boundary = cut.rfind(" ")
    if boundary > 0:
        cut = cut[:boundary]
    severed = re.search(r"\d[\d.,]*$", cut)
    if severed:
        cut = cut[: severed.start()].rstrip(" ,.;:")
    return cut.rstrip()


def _clip_words(text: str, limit: int) -> str:
    """Trim to at most `limit` words, dropping a trailing separator."""
    words = text.split()
    if len(words) <= limit:
        return text
    return " ".join(words[:limit]).rstrip(" ,.;:")


def parse_summary(text: Optional[str], *, key: str = "summary", limit: int = MAX_SUMMARY_CHARS) -> Optional[str]:
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
    return _clip(re.sub(r"\s+", " ", value).strip(), limit)


def parse_item_summary(text: Optional[str]) -> Optional[Tuple[str, str]]:
    """Decode an item reply into (summary, why_it_matters).

    Tolerates a missing or empty `why_it_matters` so single-field test doubles
    still parse cleanly.
    """
    if not text or not str(text).strip():
        return None
    payload = _first_json_value(_strip_fences(str(text)))
    if isinstance(payload, list) and len(payload) == 1:
        payload = payload[0]
    if isinstance(payload, dict):
        summary_raw = payload.get("summary")
        why_raw = payload.get("why_it_matters")
    else:
        summary_raw = payload
        why_raw = ""
    if not isinstance(summary_raw, str) or not summary_raw.strip():
        return None
    summary = _clip(re.sub(r"\s+", " ", summary_raw).strip(), MAX_SUMMARY_CHARS)
    why = (
        _clip(re.sub(r"\s+", " ", why_raw).strip(), MAX_WHY_CHARS)
        if isinstance(why_raw, str) and why_raw.strip()
        else ""
    )
    return summary, why


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

    Returns {"summary", "why_it_matters", "origin", "guard"} where guard is:
      passed     - the first reply passed the number and length checks
      repaired   - the first reply failed one of them, the retry passed
      extractive - the model failed twice (or was unreachable); the summary is
                   taken verbatim from the source text and why_it_matters is ""
      skipped    - there was no text at all to summarise

    `why_it_matters` is held to the same rules as the summary: a number in it
    that is not in the source text fails the item exactly like a number in the
    summary, and a line longer than WORDS_WHY words is repaired once and then
    dropped.
    """
    text, origin = source_text(item, max_chars=max_chars)
    if origin == "title only":
        return {
            "summary": "No text could be retrieved for this item; see the link.",
            "why_it_matters": "",
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
        parsed = parse_item_summary(raw) if raw else None
        if parsed is None:
            if raw:
                failures.append("reply was not usable JSON")
            continue
        candidate, why = parsed
        missing = sorted(
            set(unsupported_numbers(candidate, guard_text))
            | set(unsupported_numbers(why, guard_text))
        )
        words = word_count(candidate)
        limit = WORDS_SHORT if short else WORDS_LONG
        over = words if words > limit else 0
        # An over-long why is a formatting miss, not a bad summary. Clipping
        # it keeps the reply; treating it as a failure discarded a good
        # summary and paid for a retry, the same data loss the missing-why
        # tolerance removed for absence.
        why = _clip_words(why, WORDS_WHY)
        why_over = 0
        # A missing why-line is tolerated, not a failed reply. The binding
        # brief says the parser must accept a single-field reply; rejecting it
        # discarded a good summary, doubled the model calls and turned a whole
        # week extractive whenever the provider dropped the optional field.
        why_missing = not why.strip()
        if not missing and not over:
            return {
                "summary": _finish(candidate, origin),
                "why_it_matters": why,
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
            over_why_words=why_over,
            missing_why=why_missing,
        )

    detail = list(failures)
    if rejected:
        detail.append("numbers not in text: " + ", ".join(rejected))
    if short:
        fallback = extractive_summary(text, max_chars=180, max_sentences=1)
    else:
        fallback = extractive_summary(text)
    return {
        "summary": _finish(fallback, origin),
        "why_it_matters": "",
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
    """No trend without the model.

    The old fallback pasted the picks' first sentences together, which read as
    a paragraph the model had not written. An empty string means "no trend";
    the report leaves the section out instead of faking one.
    """
    return ""


def summarise_trend(
    picks: Iterable[dict],
    chat_fn: Callable[[List[dict]], str],
    *,
    attempts: int = 2,
) -> dict:
    """The opening paragraph, guarded against invented numbers.

    Returns {"trend": ..., "guard": ...}. A model that fails twice, or cannot
    be reached, yields {"trend": "", "guard": "omitted"}: the report then has
    no trend section rather than a paragraph nobody wrote.
    """
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
        candidate = parse_summary(raw, key="trend", limit=MAX_TREND_CHARS) if raw else None
        if candidate:
            missing = unsupported_numbers(candidate, material)
            # The prompt forbids digits outright. Checking only against the
            # material let a trend ship "223 tables" whenever that number
            # happened to appear in the week's items, so the guard must also
            # reject any numeric token at all.
            digits = sorted(extract_numbers(candidate))
            if not missing and not digits:
                return {
                    "trend": candidate,
                    "guard": "passed" if attempt == 0 else "repaired",
                }
            notes = []
            if missing:
                notes.append(
                    "Your previous attempt used these numbers, which are NOT in the "
                    "ITEMS: " + ", ".join(missing) + ". Remove them or correct them."
                )
            if digits:
                notes.append(
                    "The TREND must contain no digits at all; your previous attempt "
                    "contained " + ", ".join(digits) + ". Write quantities in words "
                    "or leave them out."
                )
            prompt = _TREND_PROMPT.format(items=material) + "\n\n" + "\n\n".join(notes)

    return {"trend": "", "guard": "omitted"}


# ---------------------------------------------------------------------------
# deterministic structure
# ---------------------------------------------------------------------------

def _score_of(item: dict) -> Optional[float]:
    """The item's score, or None when it has none.

    A missing score is never above a floor: an unscored item does not get a
    section because nothing ranked it.
    """
    value = item.get("score")
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clears(item: dict, floor: float) -> bool:
    value = _score_of(item)
    return value is not None and value >= floor


def compose_sections(
    items: Iterable[dict],
    *,
    picks: int = 6,
    max_tools: int = 5,
    max_worth: int = 5,
    week_end=None,
    run_date=None,
    min_score_top: int = 7,
    min_score_tools: int = 6,
    min_score_worth: int = 5,
) -> dict:
    """Split the shortlist into the report's three sections.

    The split is a rule, not a judgement: the ranking already ordered the
    shortlist, so the first `picks` items inside the week become top picks,
    GitHub items after that become tools, and the rest become worth-a-look.

    The window is fixed for all three sections: `week_bounds(run_date)` by
    default, or `week_end` (a replay override) with the same seven days
    counted back from it.

    Each section has a score floor and is never padded: an item below the
    floor is reported in `dropped_below_floor` instead of being promoted. Only
    a run where nothing at all clears the top-pick floor is a failure.
    """
    source = [dict(item) for item in items]
    if not source:
        raise CompositionError("no candidate items")

    ordered = sort_ranked(source)

    if week_end is not None:
        end = _as_date(week_end)
        if end is None:
            raise CompositionError(f"week_end is not a usable date: {week_end!r}")
        start = end - timedelta(days=6)
    else:
        start, end = week_bounds(_as_date(run_date))

    def _eligible_for(bounds) -> List[int]:
        return [
            index
            for index, item in enumerate(ordered)
            if in_week(item.get("published"), bounds)
        ]

    # The window is deliberately fixed. Deriving it from the data when the
    # week looks empty is what made consecutive weeks overlap and drift, so a
    # genuinely empty week is reported as an error rather than re-dated.
    eligible = _eligible_for((start, end))
    if not eligible:
        raise CompositionError(
            f"none of {len(ordered)} items fall inside {start}..{end}"
        )

    target = max(MIN_PICKS, min(MAX_PICKS, int(picks)))

    pick_index = [
        index for index in eligible if _clears(ordered[index], min_score_top)
    ][:target]
    if not pick_index:
        raise CompositionError(
            f"no eligible item clears the top-pick score floor ({min_score_top}); "
            f"{len(eligible)} of {len(ordered)} items fall inside {start}..{end}"
        )
    chosen = set(pick_index)

    # Every section obeys the same seven-day window. Selecting tools and
    # worth-a-look entries from all items let an older release back into the
    # report even though it was correctly excluded from the top picks.
    rest = [index for index in eligible if index not in chosen]
    tool_index = [
        index
        for index in rest
        if (ordered[index].get("source") or "").lower() == "github"
        and _clears(ordered[index], min_score_tools)
    ][:max_tools]
    in_tools = set(tool_index)
    worth_index = [
        index
        for index in rest
        if index not in in_tools and _clears(ordered[index], min_score_worth)
    ][:max_worth]
    in_worth = set(worth_index)

    # An item that missed a section's floor is not a casualty of the caps, and
    # an item that cleared a floor but lost a cap is not a floor failure.
    # Both are reported, neither is silently dropped.
    selected = chosen | in_tools | in_worth
    below_floor: List[int] = []
    over_cap: List[int] = []
    for index in eligible:
        if index in selected:
            continue
        item = ordered[index]
        # Classify against every floor the item could have entered. A GitHub
        # item is eligible for worth-a-look too, so counting only the tools
        # floor labelled a score-5 cap loss as "below floor".
        floors = [min_score_top, min_score_worth]
        if (item.get("source") or "").lower() == "github":
            floors.append(min_score_tools)
        if any(_clears(item, floor) for floor in floors):
            over_cap.append(index)
        else:
            below_floor.append(index)

    return {
        "week_start": start,
        "week_end": end,
        "top_picks": [ordered[index] for index in pick_index],
        "tools": [ordered[index] for index in tool_index],
        "worth_a_look": [ordered[index] for index in worth_index],
        "dropped": [ordered[index] for index in over_cap],
        "dropped_below_floor": [ordered[index] for index in below_floor],
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
    if (entry.get("why_it_matters") or "").strip():
        out.append(f"    why_it_matters: {_q(entry['why_it_matters'])}")
    for key in ("summary_origin", "guard"):
        if entry.get(key):
            out.append(f"    {key}: {_q(entry[key])}")
    return out


def dump_report(report: dict, *, generated_at: str = "") -> str:
    """Emit source.yaml in the hand-written shape: quoted keys, folded prose.

    The trend block is omitted entirely when there is no trend, so a run whose
    model failed says so by leaving the section out rather than by writing an
    empty paragraph.
    """
    stamp = f" on {generated_at}" if generated_at else ""
    lines = [
        f"# Generated by write_report.py{stamp} - Phase 3.",
        "# Summaries use only the text stored in candidates.json. Every number is",
        "# checked against that text; guard: extractive means the model failed the",
        "# check twice and the prose was taken verbatim from the source.",
        "",
        f"week_start: {_iso(report['week_start'])}",
        f"week_end: {_iso(report['week_end'])}",
    ]
    if report.get("week_mode"):
        lines.append(f"week_mode: {_q(report['week_mode'])}")
    floor = report.get("dropped_below_floor")
    if isinstance(floor, bool):
        floor = None
    if isinstance(floor, int):
        lines.append(f"dropped_below_floor: {floor}")
    elif isinstance(floor, (list, tuple)):
        # A count, never the items: report_build casts this to int.
        lines.append(f"dropped_below_floor: {len(floor)}")
    trend = (report.get("trend") or "").strip()
    if trend:
        lines.extend(["", "trend: >-", _fold(trend)])
    lines.append("")

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
