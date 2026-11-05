"""Phase 5 - send the rendered weekly report as an email.

The email body is the report itself, not a link to it and not only a PDF:

* ``text/plain`` - ``report.md`` (the same words as the Markdown deliverable)
* ``text/html``  - ``report.html`` (the formatted body recipients actually read)
* ``application/pdf`` - the PDF is attached as a convenience copy

Recipients come from ``config.yaml``. Credentials come from ``.env`` (see
``.env.example``) and never from a committed file. ``--dry-run`` composes the
message and writes ``email.eml`` instead of contacting SMTP, so the whole path
can be verified without credentials or a real send.

One deliberate rule: links are recorded in ``history.db`` only after a real
send. The render step in the graph therefore passes ``--no-record``; if SMTP
fails, the report is not marked as sent and next week can retry it.
"""

import json
import smtplib
import ssl
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

import yaml

from synthetic_data import llm, memory, render

DEFAULT_SENDER = "Synthetic Data Weekly <weekly@example.com>"
DEFAULT_TIMEOUT = 60.0


class EmailError(Exception):
    """The message could not be composed, configured or sent."""


def _load_yaml(path) -> dict:
    file = Path(path)
    if not file.exists():
        raise EmailError(f"{file} not found")
    with file.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def _require(env: dict, name: str) -> str:
    value = (env.get(name) or "").strip()
    if not value:
        raise EmailError(
            f"{name} is not set. Put it in .env (git-ignored) or export it. "
            ".env.example documents the shape."
        )
    return value


def resolve_recipients(
    config: dict,
    env: dict,
    *,
    test: bool = False,
    to: Optional[Sequence[str]] = None,
) -> List[str]:
    """Recipients for this send.

    Order of precedence: explicit ``--to`` addresses, then ``DRY_RUN_RECIPIENT``
    when ``--test`` is used, then the five recipients in ``config.yaml``. A test
    send can never go to the whole list by accident.
    """
    if to:
        recipients = [str(address).strip() for address in to if str(address).strip()]
    elif test:
        target = (env.get("DRY_RUN_RECIPIENT") or "").strip()
        if not target:
            raise EmailError(
                "--test needs DRY_RUN_RECIPIENT in .env or an explicit --to ADDRESS"
            )
        recipients = [target]
    else:
        recipients = [
            str(address).strip()
            for address in (config.get("recipients") or [])
            if str(address).strip()
        ]

    if not recipients:
        raise EmailError(
            "no recipient addresses: add them under `recipients:` in config.yaml "
            "or pass --to ADDRESS"
        )
    return recipients


def smtp_settings(env: dict) -> dict:
    """Read and validate the SMTP credential set."""
    host = _require(env, "SMTP_HOST")
    port_text = _require(env, "SMTP_PORT")
    try:
        port = int(port_text)
    except ValueError as exc:
        raise EmailError(f"SMTP_PORT must be a number, got {port_text!r}") from exc
    user = _require(env, "SMTP_USER")
    password = _require(env, "SMTP_PASSWORD")
    sender = (env.get("MAIL_FROM") or "").strip() or user
    return {
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "sender": sender,
        "timeout": float(env.get("SMTP_TIMEOUT") or DEFAULT_TIMEOUT),
    }


def compose(
    report: dict,
    out_dir,
    *,
    recipients: Sequence[str],
    sender: str,
) -> EmailMessage:
    """Build the multipart message from the rendered files in ``out_dir``."""
    folder = Path(out_dir)
    markdown_path = folder / "report.md"
    html_path = folder / "report.html"
    if not markdown_path.exists() or not html_path.exists():
        missing = [p.name for p in (markdown_path, html_path) if not p.exists()]
        raise EmailError(
            f"rendered report is incomplete in {folder}: missing {', '.join(missing)}. "
            "Run report_build.py first."
        )

    message = EmailMessage(policy=policy.SMTP)
    message["Subject"] = render.subject_line(report)
    message["From"] = sender or DEFAULT_SENDER
    message["To"] = ", ".join(recipients)
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid()
    message["Auto-Submitted"] = "auto-generated"

    message.set_content(markdown_path.read_text(encoding="utf-8"), subtype="plain", charset="utf-8")
    message.add_alternative(html_path.read_text(encoding="utf-8"), subtype="html", charset="utf-8")

    pdf_path = folder / f"Synthetic_Data_Weekly_{report['week_end']}.pdf"
    if pdf_path.exists():
        message.add_attachment(
            pdf_path.read_bytes(),
            maintype="application",
            subtype="pdf",
            filename=pdf_path.name,
        )
    return message


def write_eml(message: EmailMessage, path) -> Path:
    """Write the message as an ``.eml`` file and return its path."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(message.as_bytes())
    return target


def _default_smtp_factory(host, port, timeout, ssl=False):
    if ssl:
        return smtplib.SMTP_SSL(host, port, timeout=timeout)
    return smtplib.SMTP(host, port, timeout=timeout)


def send_message(message: EmailMessage, settings: dict, *, smtp_factory=None) -> None:
    """Send one message: STARTTLS on 587 (and most ports), implicit TLS on 465."""
    factory = smtp_factory or _default_smtp_factory
    use_ssl = int(settings["port"]) == 465
    try:
        with factory(
            settings["host"],
            int(settings["port"]),
            float(settings.get("timeout") or DEFAULT_TIMEOUT),
            ssl=use_ssl,
        ) as smtp:
            if not use_ssl:
                smtp.ehlo()
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            smtp.login(settings["user"], settings["password"])
            smtp.send_message(message)
    except EmailError:
        raise
    except (smtplib.SMTPException, OSError) as exc:
        raise EmailError(f"SMTP send failed: {type(exc).__name__}: {exc}") from exc


def _update_run_log(out_dir: Path, summary: dict) -> None:
    """Merge the email result into the week's run_log.json."""
    path = out_dir / "run_log.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (OSError, ValueError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    payload["email"] = summary
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def deliver(
    report_path,
    config_path: str = "config.yaml",
    *,
    dry_run: bool = False,
    test: bool = False,
    to: Optional[Iterable[str]] = None,
    record: bool = True,
    env: Optional[dict] = None,
    smtp_factory=None,
    db_path: Optional[str] = None,
) -> dict:
    """Compose the email for one week, then either write it or send it.

    ``dry_run`` writes ``email.eml`` and never touches the network or
    ``history.db``. A ``test`` send goes to one address and never records
    history either, so the real weekly send is unaffected.
    """
    report_file = Path(report_path)
    report = _load_yaml(report_file)
    config = _load_yaml(config_path)
    out_dir = report_file.parent

    env = llm.load_env() if env is None else env
    recipients = resolve_recipients(config, env, test=test, to=to)
    sender = (env.get("MAIL_FROM") or "").strip() or (env.get("SMTP_USER") or "").strip() or DEFAULT_SENDER

    message = compose(report, out_dir, recipients=recipients, sender=sender)
    summary = {
        "subject": str(message["Subject"]),
        "recipients": recipients,
        "message_id": str(message["Message-ID"]),
        "dry_run": bool(dry_run),
        "test": bool(test),
        "sent": False,
        "sent_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pdf_attached": any(part.get_content_type() == "application/pdf" for part in message.iter_attachments()),
        "urls_recorded": 0,
        "path": "",
    }

    if dry_run:
        summary["path"] = str(write_eml(message, out_dir / "email.eml"))
    else:
        settings = smtp_settings(env)
        send_message(message, settings, smtp_factory=smtp_factory)
        summary["sent"] = True
        if record and not test:
            summary["urls_recorded"] = memory.mark_sent(
                [(link["url"], link["label"], "") for link in render.render_all_links(report)],
                db_path=db_path or memory.DB_PATH,
            )

    _update_run_log(out_dir, summary)
    return summary
