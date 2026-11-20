"""The only module that knows an LLM provider exists.

OpenRouter exposes an OpenAI-compatible /chat/completions endpoint. Nothing
else in this project imports httpx for the model, so the provider can be
swapped (paid twin, local Ollama, vLLM) without touching rank.py.

`chat()` owns transport retries only. Semantic recovery — malformed JSON,
missing rows — belongs to rank.py, so the two layers never multiply.
"""

import json
import os
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence

import httpx

RETRY_STATUSES = {429, 500, 502, 503, 504}
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
APP_TITLE = "synthetic-data-weekly"


class LLMError(Exception):
    """The model could not be reached, or returned no usable content."""


class _ModelAttemptError(LLMError):
    """Failure from a single candidate model with retry and quota metadata."""

    def __init__(
        self,
        message: str,
        *,
        retries: int = 0,
        status_code: Optional[int] = None,
        free_quota_exhausted: bool = False,
    ) -> None:
        super().__init__(message)
        self.retries = retries
        self.status_code = status_code
        self.free_quota_exhausted = free_quota_exhausted


def _retry_delay(response, fallback: float, cap: float = 30.0) -> float:
    """Honour a numeric Retry-After header when present, capped at `cap` seconds."""
    headers = getattr(response, "headers", None)
    if headers is not None and hasattr(headers, "get"):
        raw = headers.get("Retry-After")
        if raw is None:
            raw = headers.get("retry-after")
        if raw is not None:
            try:
                seconds = float(str(raw).strip())
                if seconds > 0:
                    return min(seconds, cap)
            except (ValueError, TypeError):
                pass
    return fallback


def _is_free_daily_quota_error(text: str) -> bool:
    """True when OpenRouter reports the account-wide daily free-tier cap."""
    return "free-models-per-day" in (text or "").lower()


def _read_dotenv(path: str) -> Dict[str, str]:
    """Parse KEY=value lines. Missing file, comments and blanks are skipped."""
    file = Path(path)
    if not file.exists():
        return {}
    values: Dict[str, str] = {}
    for line in file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def load_env(path: str = ".env", environ: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Environment first, .env second.

    os.environ wins so a GitHub Actions secret overrides a stale local file and
    CI needs no .env at all. A missing .env is not an error; a missing required
    key is, and `require` raises.

    `environ` is injectable so the precedence rule can be tested without
    mutating the real process environment.
    """
    merged = dict(os.environ if environ is None else environ)
    for key, value in _read_dotenv(path).items():
        merged.setdefault(key, value)
    return merged


def require(env: Dict[str, str], name: str) -> str:
    value = (env.get(name) or "").strip()
    if not value:
        raise LLMError(
            f"{name} is not set. Put it in .env (git-ignored) or export it. "
            "See .env.example for the shape."
        )
    return value


def require_api_key(
    env: Dict[str, str],
    names: tuple = ("OPENROUTER_API_KEY", "LLM_API_KEY"),
) -> str:
    """Return the first non-empty API key from `names`, or raise LLMError."""
    for name in names:
        value = (env.get(name) or "").strip()
        if value:
            return value
    accepted = ", ".join(names)
    raise LLMError(
        f"None of {accepted} is set. Put it in .env (git-ignored) or export it. "
        "See .env.example for the shape."
    )


def _chat_single(
    messages: List[dict],
    *,
    api_key: str,
    base_url: str,
    model: str,
    temperature: float,
    max_tokens: int,
    reasoning_effort: str,
    json_mode: bool,
    timeout: float,
    attempts: int,
    client: Optional[httpx.Client],
    sleep: Callable[[float], None],
) -> tuple[str, int]:
    """Execute one model call (with fresh payload, 400 field strips, and 429/5xx retries)."""
    attempts = max(1, int(attempts))
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/badrbajamil1-collab/synthetic-data-weekly",
        "X-Title": APP_TITLE,
    }
    payload: Dict[str, object] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if reasoning_effort:
        payload["reasoning"] = {"effort": reasoning_effort, "exclude": True}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    retries = 0
    transport_attempt = 0
    last_error = ""

    # Up to two free HTTP-400 field strips (response_format, then reasoning)
    # do not consume the caller's transport-retry budget.
    for _ in range(attempts + 2):
        try:
            if client is not None:
                response = client.post(url, headers=headers, json=payload, timeout=timeout)
            else:
                response = httpx.post(url, headers=headers, json=payload, timeout=timeout)
        except httpx.HTTPError as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            if transport_attempt >= attempts - 1:
                break
            retries += 1
            sleep(5.0 * (2 ** transport_attempt))
            transport_attempt += 1
            continue

        if response.status_code == 200:
            try:
                data = response.json()
                content = (data["choices"][0]["message"].get("content") or "").strip()
            except (KeyError, IndexError, ValueError, TypeError) as exc:
                raise _ModelAttemptError(
                    f"unexpected response shape: {type(exc).__name__}",
                    retries=retries,
                    status_code=200,
                ) from exc
            if not content:
                finish = (data.get("choices") or [{}])[0].get("finish_reason")
                raise _ModelAttemptError(
                    f"{model} returned empty content (finish_reason={finish!r}). "
                    "Reasoning likely consumed the token budget.",
                    retries=retries,
                    status_code=200,
                )
            return content, retries

        body = getattr(response, "text", "") or ""
        # A provider that does not accept `response_format` or `reasoning` answers 400.
        # Drop `response_format` first, then `reasoning`, and try once more.
        if response.status_code == 400:
            last_error = f"HTTP 400: {body[:160]}"
            if "response_format" in payload:
                payload.pop("response_format", None)
                retries += 1
                continue
            if "reasoning" in payload:
                payload.pop("reasoning", None)
                retries += 1
                continue

        if response.status_code in RETRY_STATUSES and transport_attempt < attempts - 1:
            last_error = f"HTTP {response.status_code}: {body[:160]}"
            retries += 1
            sleep(_retry_delay(response, 5.0 * (2 ** transport_attempt)))
            transport_attempt += 1
            continue

        raise _ModelAttemptError(
            f"HTTP {response.status_code} from {model}: {body[:240]}",
            retries=retries,
            status_code=response.status_code,
            free_quota_exhausted=_is_free_daily_quota_error(body),
        )

    raise _ModelAttemptError(
        f"{model} failed after {attempts} attempts: {last_error or 'unknown error'}",
        retries=retries,
    )


def chat(
    messages: List[dict],
    *,
    api_key: str,
    base_url: str = DEFAULT_BASE_URL,
    model: str,
    fallback_models: Sequence[str] = (),
    temperature: float = 0.0,
    max_tokens: int = 2000,
    reasoning_effort: str = "low",
    json_mode: bool = False,
    timeout: float = 180.0,
    attempts: int = 4,
    client: Optional[httpx.Client] = None,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[str, int]:
    """POST to {base_url}/chat/completions with optional fallback models.

    Returns (content, retries_used). Retries 429/5xx and network errors with
    exponential backoff. Falls back across `fallback_models` when a model
    exhausts retries, returns 404/429/5xx, or produces empty reasoning-capped
    content. Auth failures (401/403) fail fast; an OpenRouter daily free-tier
    quota error skips remaining `:free` models while still trying any paid
    fallback configured in the list.
    """
    candidates: List[str] = []
    seen: set[str] = set()
    for raw_name in (model, *(fallback_models or ())):
        name = str(raw_name or "").strip()
        if name and name not in seen:
            seen.add(name)
            candidates.append(name)
    if not candidates:
        raise LLMError("no model specified")

    total_retries = 0
    errors: List[str] = []
    skip_free = False

    for idx, candidate in enumerate(candidates):
        if skip_free and candidate.endswith(":free"):
            continue
        per_model_attempts = attempts if idx == 0 else min(attempts, 2)
        try:
            content, used = _chat_single(
                messages,
                api_key=api_key,
                base_url=base_url,
                model=candidate,
                temperature=temperature,
                max_tokens=max_tokens,
                reasoning_effort=reasoning_effort,
                json_mode=json_mode,
                timeout=timeout,
                attempts=per_model_attempts,
                client=client,
                sleep=sleep,
            )
            return content, total_retries + used
        except _ModelAttemptError as exc:
            total_retries += exc.retries
            errors.append(str(exc))
            if exc.status_code in (401, 403):
                raise LLMError(str(exc)) from exc
            if exc.free_quota_exhausted:
                skip_free = True

    if len(errors) == 1:
        raise LLMError(errors[0])
    raise LLMError(f"all {len(candidates)} model(s) failed: " + " | ".join(errors))


def parse_json_response(text: str):
    """Best-effort JSON decode for test doubles and offline callers."""
    return json.loads(text)
