"""Phase 5 - register the weekly run with Windows Task Scheduler.

    uv run python schedule_task.py                 # print the command (dry run)
    uv run python schedule_task.py --register      # create/update the task
    uv run python schedule_task.py --query         # show the registered task
    uv run python schedule_task.py --delete        # remove it

The day and time come from ``schedule:`` in ``config.yaml`` ("Saturday 08:00"),
so there is one source of truth. The task calls ``scripts/run_weekly.ps1``,
which runs ``.venv\\Scripts\\python.exe main.py --pipeline`` from the repo root
and appends stdout/stderr to ``logs/weekly.log``.

The task runs as the current user in the interactive session (no password is
stored). That is enough for a desktop that is switched on, but it will not run
while the user is signed out.
"""

import argparse
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import yaml

TASK_NAME = "SyntheticDataWeekly"
DAY_CODES = {
    "monday": "MON",
    "tuesday": "TUE",
    "wednesday": "WED",
    "thursday": "THU",
    "friday": "FRI",
    "saturday": "SAT",
    "sunday": "SUN",
}


def parse_schedule(text: str):
    """'Saturday 08:00' -> ('SAT', '08:00'). Raises ValueError on bad input."""
    parts = str(text).split()
    if len(parts) != 2:
        raise ValueError(f"schedule must look like 'Saturday 08:00', got {text!r}")
    day, time = parts
    code = DAY_CODES.get(day.lower())
    if not code:
        raise ValueError(f"unknown weekday {day!r}; use Monday..Sunday")
    try:
        datetime.strptime(time, "%H:%M")
    except ValueError as exc:
        raise ValueError(f"invalid time {time!r}; use 24-hour HH:MM") from exc
    return code, time


def runner_script(repo: Path) -> Path:
    return Path(repo) / "scripts" / "run_weekly.ps1"


def task_command(repo: Path) -> str:
    return (
        "powershell.exe -NoProfile -ExecutionPolicy Bypass "
        f'-File "{runner_script(repo)}"'
    )


def build_create_command(repo: Path, schedule: str) -> list:
    code, time = parse_schedule(schedule)
    return [
        "schtasks",
        "/Create",
        "/TN",
        TASK_NAME,
        "/TR",
        task_command(repo),
        "/SC",
        "WEEKLY",
        "/D",
        code,
        "/ST",
        time,
        "/F",
    ]


def build_query_command() -> list:
    return ["schtasks", "/Query", "/TN", TASK_NAME, "/V", "/FO", "LIST"]


def build_delete_command() -> list:
    return ["schtasks", "/Delete", "/TN", TASK_NAME, "/F"]


def _run(command: list) -> int:
    print(" ".join(f'"{part}"' if " " in part else part for part in command))
    result = subprocess.run(command, capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.returncode != 0 and result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    return result.returncode


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Register the weekly report task.")
    parser.add_argument("--config", default="config.yaml", help="path to config.yaml")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--register", action="store_true", help="create or update the task")
    action.add_argument("--query", action="store_true", help="show the registered task")
    action.add_argument("--delete", action="store_true", help="remove the task")
    action.add_argument("--dry-run", action="store_true", help="print the command only")
    args = parser.parse_args(argv)

    repo = Path(__file__).resolve().parent
    if args.query:
        return _run(build_query_command())
    if args.delete:
        return _run(build_delete_command())

    config_path = Path(args.config)
    if not config_path.exists():
        print(f"FAIL  {config_path} not found", file=sys.stderr)
        return 1
    config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    schedule = config.get("schedule") or "Saturday 08:00"
    try:
        command = build_create_command(repo, schedule)
    except ValueError as exc:
        print(f"FAIL  {exc}", file=sys.stderr)
        return 1

    if not Path(runner_script(repo)).exists():
        print(f"FAIL  {runner_script(repo)} not found", file=sys.stderr)
        return 1

    if args.register:
        return _run(command)

    print("Dry run - no task was changed. Command:")
    print(" ".join(f'"{part}"' if " " in part else part for part in command))
    print(f"Schedule from config.yaml: {schedule}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
