"""Compatibility wrapper forwarding to the repo-root ``publish_to_cloudflare.py``.

Usage (from repo root):
    uv run python publish_to_cloudflare.py [progress/week-YYYY-MM-DD]
    uv run python web/scripts/publish_to_cloudflare.py [progress/week-YYYY-MM-DD]
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from publish_to_cloudflare import main

if __name__ == "__main__":
    raise SystemExit(main())
