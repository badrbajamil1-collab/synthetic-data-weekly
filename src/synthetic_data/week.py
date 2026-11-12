"""One fixed reporting week, shared by every stage of the pipeline.

The brief's window is Sunday–Saturday. Deriving it from the run date (rather
than from the newest item in the shortlist) keeps consecutive weeks from
overlapping or drifting: two runs in the same calendar week always describe
exactly the same seven days.

    >>> week_bounds(date(2026, 11, 11))   # a Wednesday
    (datetime.date(2026, 11, 8), datetime.date(2026, 11, 14))

A Saturday run reports the week ending on that same Saturday; a Wednesday run
reports the week containing it. ``write_report.py --week-end`` remains an
explicit override for replaying a historical week, so this module never makes
an old report unrenderable.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple

__all__ = ["week_bounds", "in_week"]

Bounds = Tuple[date, date]


def week_bounds(run_date: Optional[date] = None) -> Bounds:
    """Return ``(Sunday, Saturday)`` of the week containing ``run_date``.

    ``run_date`` defaults to today. A ``datetime`` is accepted and reduced to
    its calendar day so callers can pass ``datetime.now(timezone.utc)`` without
    a separate conversion.
    """
    if run_date is None:
        run_date = date.today()
    if isinstance(run_date, datetime):
        run_date = run_date.date()

    # date.weekday(): Mon=0 .. Sun=6. The most recent Sunday is
    # (weekday + 1) % 7 days back, which is 0 on a Sunday and 6 on a Saturday.
    week_start = run_date - timedelta(days=(run_date.weekday() + 1) % 7)
    week_end = week_start + timedelta(days=6)
    return week_start, week_end


def in_week(value, bounds: Bounds) -> bool:
    """True when ``value``'s calendar day is inside ``bounds`` inclusive.

    Accepts a ``date``, a ``datetime`` (naive or aware), or an ISO string —
    the three shapes a ``published`` field takes across collectors, JSON
    artefacts and YAML. Anything unparseable is outside the week, never an
    exception.
    """
    start, end = bounds
    day: Optional[date] = None
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc)
        day = value.date()
    elif isinstance(value, date):
        day = value
    elif value:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return False
        day = moment.date()
    return day is not None and start <= day <= end
