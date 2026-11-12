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
from typing import Callable, Dict, List, Optional

import httpx

RETRY_STATUSES = {429, 500, 502, 503, 504}
DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
APP_TITLE = "synthetic-data-weekly"


class LLMError(Exception):
    """The model could not be reached, or returned no usable content."""


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


def chat(
    messages: List[dict],
    *,
    api_key: str,
    base_url: str = DEFAULT_BASE_URL,
    model: str,
    temperature: float = 0.0,
    max_tokens: int = 2000,
    reasoning_effort: str = "low",
    json_mode: bool = False,
    timeout: float = 180.0,
    attempts: int = 4,
    client: Optional[httpx.Client] = None,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[str, int]:
    """POST to {base_url}/chat/completions.

    Returns (content, retries_used). Retries 429/5xx and network errors with
    exponential backoff. Raises LLMError on a non-retryable status, on retry
    exhaustion, or when `content` is empty.

    Empty content is NOT retried here: the probe showed it means the model spent
    its whole budget on hidden reasoning, so another identical call just repeats
    the loss.

    If the provider rejects `response_format` or `reasoning` with a 400, the call
    is retried without the offending field, so switching to a provider that lacks
    the parameter needs no code change.
    """
    url = base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/badrfaez1/Testing",
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
    last_error = ""

    # Two extra iterations cover the two possible 400-field strips below
    # (response_format, then reasoning). Those retries are free: they must not
    # consume the caller's transport-retry budget.
    for attempt in range(attempts + 2):
        try:
            if client is not None:
                response = client.post(url, headers=headers, json=payload, timeout=timeout)
            else:
                response = httpx.post(url, headers=headers, json=payload, timeout=timeout)
        except httpx.HTTPError as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt >= attempts - 1:
                break
            retries += 1
            sleep(5.0 * (2 ** attempt))
            continue

        if response.status_code == 200:
            try:
                data = response.json()
                content = (data["choices"][0]["message"].get("content") or "").strip()
            except (KeyError, IndexError, ValueError, TypeError) as exc:
                raise LLMError(f"unexpected response shape: {type(exc).__name__}") from exc
            if not content:
                finish = (data.get("choices") or [{}])[0].get("finish_reason")
                raise LLMError(
                    f"{model} returned empty content (finish_reason={finish!r}). "
                    "Reasoning likely consumed the token budget."
                )
            return content, retries

        # A provider that does not accept `response_format` or `reasoning` answers 400.
        # Drop `response_format` first, then `reasoning`, and try once more.
        if response.status_code == 400:
            last_error = f"HTTP 400: {response.text[:160]}"
            if "response_format" in payload:
                payload.pop("response_format", None)
                retries += 1
                continue
            if "reasoning" in payload:
                payload.pop("reasoning", None)
                retries += 1
                continue

        if response.status_code in RETRY_STATUSES and attempt < attempts - 1:
            last_error = f"HTTP {response.status_code}: {response.text[:160]}"
            retries += 1
            sleep(5.0 * (2 ** attempt))
            continue

        raise LLMError(f"HTTP {response.status_code} from {model}: {response.text[:240]}")

    raise LLMError(f"{model} failed after {attempts} attempts: {last_error or 'unknown error'}")


def parse_json_response(text: str):
    """Best-effort JSON decode for test doubles and offline callers."""
    return json.loads(text)
