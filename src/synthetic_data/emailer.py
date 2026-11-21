"""Phase 5 - send the rendered weekly report as an email.

The email body is the report itself, not a link to it:

* ``text/plain`` - ``report.md`` (the same words as the Markdown deliverable)
* ``text/html``  - ``report.html`` (the formatted body recipients actually read)
* ``application/pdf`` - omitted by default for deliverability (pass
  ``attach_pdf=True`` / ``--attach-pdf`` to include it)

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
import time
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence

import yaml

from synthetic_data import llm, memory, render

DEFAULT_SENDER = "Synthetic Data Weekly <weekly@example.com>"
DEFAULT_TIMEOUT = 60.0
_CONSUMER_MAIL_DOMAINS = frozenset({
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
})
_CONSUMER_SMTP_HOSTS = (
    "smtp.gmail.com",
    "smtp.office365.com",
    "smtp-mail.outlook.com",
)


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


def resolve_sender(raw_sender: str, user: str, host: str = "") -> str:
    """Keep MAIL_FROM aligned with SMTP_USER on Gmail and Outlook.

    Sending with a MAIL_FROM address/domain that differs from SMTP_USER looks
    like spoofing to Gmail and Outlook and sends mail to spam. On consumer
    webmail logins/hosts, force the email address to match SMTP_USER while
    preserving any display name.
    """
    sender = (raw_sender or "").strip()
    login = (user or "").strip()
    if not sender:
        return login or DEFAULT_SENDER
    if "@" not in login:
        return sender
    login_domain = login.rsplit("@", 1)[1].lower()
    host_lower = (host or "").strip().lower()
    enforce_match = (
        login_domain in _CONSUMER_MAIL_DOMAINS
        or any(h in host_lower for h in _CONSUMER_SMTP_HOSTS)
    )
    if not enforce_match:
        return sender
    display_name, from_addr = parseaddr(sender)
    if from_addr.lower() == login.lower():
        return sender
    return formataddr((display_name, login)) if display_name else login


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
    sender = resolve_sender(env.get("MAIL_FROM") or "", user, host)
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
    reply_to: str = "",
    attach_pdf: bool = False,
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

    effective_sender = sender or DEFAULT_SENDER
    _, sender_addr = parseaddr(effective_sender)
    msgid_domain = sender_addr.rsplit("@", 1)[1].strip() if "@" in sender_addr else ""

    message = EmailMessage(policy=policy.SMTP)
    message["Subject"] = render.subject_line(report)
    message["From"] = effective_sender
    message["To"] = ", ".join(recipients)
    clean_reply_to = (reply_to or "").strip()
    if clean_reply_to:
        message["Reply-To"] = clean_reply_to
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=msgid_domain or None)
    message["Auto-Submitted"] = "auto-generated"

    message.set_content(markdown_path.read_text(encoding="utf-8"), subtype="plain", charset="utf-8")
    message.add_alternative(html_path.read_text(encoding="utf-8"), subtype="html", charset="utf-8")

    if attach_pdf:
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


def send_message(
    message: EmailMessage,
    settings: dict,
    *,
    smtp_factory=None,
    attempts: int = 3,
    base_delay: float = 5.0,
    sleep=time.sleep,
) -> None:
    """Send one message: STARTTLS on 587 (and most ports), implicit TLS on 465.

    Retries only when it is provably safe against sending duplicates:
    pre-DATA connection/TLS/login failures and explicit temporary 4xx SMTP
    rejections (e.g., 421/450/451). Auth failures (535), permanent 5xx
    rejections, and mid-DATA network drops fail immediately without retrying.
    """
    factory = smtp_factory or _default_smtp_factory
    use_ssl = int(settings["port"]) == 465
    total_attempts = max(1, int(attempts))

    for attempt in range(total_attempts):
        sending_started = False
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
                sending_started = True
                smtp.send_message(message)
                return
        except EmailError:
            raise
        except smtplib.SMTPAuthenticationError as exc:
            raise EmailError(f"SMTP send failed: {type(exc).__name__}: {exc}") from exc
        except smtplib.SMTPResponseException as exc:
            code = int(getattr(exc, "smtp_code", 0) or 0)
            if 400 <= code < 500 and attempt < total_attempts - 1:
                sleep(base_delay * (attempt + 1))
                continue
            raise EmailError(f"SMTP send failed: {type(exc).__name__}: {exc}") from exc
        except (smtplib.SMTPException, OSError) as exc:
            if not sending_started and attempt < total_attempts - 1:
                sleep(base_delay * (attempt + 1))
                continue
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


def published_links(report: dict, out_dir) -> List[Dict[str, str]]:
    """Links that actually appear in the published artefacts.

    ``report_build.py`` drops dead links from the report it renders but leaves
    the curated ``source.yaml`` alone, so recording every link from the YAML
    would mark a link as sent that was never emailed. The rendered markdown is
    the published document, and the verifier guarantees every surviving link
    is in it.
    """
    links = render.render_all_links(report)
    markdown = Path(out_dir) / "report.md"
    if not markdown.exists():
        return []
    text = markdown.read_text(encoding="utf-8")
    return [link for link in links if link["url"] in text]


def deliver(
    report_path,
    config_path: str = "config.yaml",
    *,
    dry_run: bool = False,
    test: bool = False,
    to: Optional[Iterable[str]] = None,
    record: bool = True,
    attach_pdf: bool = False,
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
    sender = resolve_sender(
        env.get("MAIL_FROM") or "",
        env.get("SMTP_USER") or "",
        env.get("SMTP_HOST") or "",
    )
    reply_to = (env.get("REPLY_TO") or "").strip()

    message = compose(
        report,
        out_dir,
        recipients=recipients,
        sender=sender,
        reply_to=reply_to,
        attach_pdf=attach_pdf,
    )
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
                [(link["url"], link["label"], "") for link in published_links(report, out_dir)],
                db_path=db_path or memory.DB_PATH,
            )

    _update_run_log(out_dir, summary)
    return summary
