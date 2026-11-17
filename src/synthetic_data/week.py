"""One fixed reporting week, shared by every stage of the pipeline.

The reporting week is Saturday through Friday (seven days, the end inclusive
through Friday 23:59:59 UTC). Deriving it from the run date (rather than from
the newest item in the shortlist) keeps consecutive weeks from overlapping or
drifting: two runs in the same calendar week always describe exactly the same
seven days.

A Saturday run reports the week that ended on the preceding Friday, so
Saturday items land in the following week instead of being reported before
they have had a full week to settle.

    >>> week_bounds(date(2026, 11, 11))   # a Wednesday
    (datetime.date(2026, 11, 7), datetime.date(2026, 11, 13))

``write_report.py --week-end`` remains an explicit override for replaying a
historical week, so this module never makes an old report unrenderable.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple

__all__ = ["week_bounds", "in_week"]

Bounds = Tuple[date, date]


def week_bounds(run_date: Optional[date] = None) -> Bounds:
    """Return ``(Saturday, Friday)`` of the reporting week for ``run_date``.

    ``run_date`` defaults to today. A ``datetime`` is accepted and reduced to
    its calendar day so callers can pass ``datetime.now(timezone.utc)`` without
    a separate conversion.

    A run on a Saturday reports the week that ended the preceding Friday, so
    Saturday itself is treated as the first day of the *next* week.
    """
    if run_date is None:
        run_date = date.today()
    if isinstance(run_date, datetime):
        run_date = run_date.date()

    # A Saturday run reports the week that just ended on Friday.
    if run_date.weekday() == 5:
        run_date = run_date - timedelta(days=1)

    # Days back to the Saturday that starts this week (Saturday = weekday 5).
    days_back = (run_date.weekday() - 5) % 7
    week_start = run_date - timedelta(days=days_back)
    week_end = week_start + timedelta(days=6)
    return week_start, week_end


def in_week(value, bounds: Bounds) -> bool:
    """True when ``value``'s calendar day is inside ``bounds`` inclusive.

    Accepts a ``date``, a ``datetime`` (naive or aware), or an ISO string --
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
