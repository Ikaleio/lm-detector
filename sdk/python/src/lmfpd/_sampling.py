"""Model requests (port of `buildDetectRequest`, `requestEndpoint`, `completionBody`, and `requestSample`)."""

from __future__ import annotations

import json
import math
import re
import socket
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping
from urllib.parse import quote, urlsplit

import httpx

from ._features import parse_numbers
from ._types import Challenge, LmfpdError, Sample

_FORMATS = {"responses": "responses", "chat_completions": "openai", "messages": "anthropic"}
_SERVICE_TIERS = ("flex", "default", "fast", "ultrafast")
_SPEED_BETA = "fast-mode-2026-02-01"
_FINISHED = ("stop", "end_turn", "completed")
_REFUSED = ("refusal", "content_filter")
_MAX_SAFE_INTEGER = 2 ** 53 - 1

_INVALID_URL = "Base URL must be a valid HTTP or HTTPS URL."
_URL_PARTS = "Base URL must use HTTP or HTTPS without credentials, a query, or a fragment."
_ENDPOINT = re.compile(r"/(responses|messages|chat/completions)\Z")
_TRAILING_SLASHES = re.compile(r"/+\Z")
_TRAILING_DIGITS = re.compile(r"[0-9]+\Z")
_SSE_DELIMITER = re.compile(rb"\r\n\r\n|\n\n|\r\r")
_LINE_BREAK = re.compile(r"\r\n|\r|\n")
_ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f]")
# Characters the WHATWG URL parser keeps unescaped in a path.
_PATH_SAFE = "/%!$&'()*+,-.:;=@[]^_|~"


@dataclass(frozen=True)
class Options:
    """A validated detection config."""
    base_url: str
    api_key: str
    model: str
    format: str
    service_tier: str
    stream: bool
    effort: str
    strict: bool
    count: int
    parallel: int
    timeout_ms: int
    url: str


def _int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and abs(value) <= _MAX_SAFE_INTEGER


def _option(config: Mapping[str, Any], key: str, default: Any) -> Any:
    value = config.get(key)
    return default if value is None else value


def detect_options(config: Mapping[str, Any]) -> Options:
    """Validates a config dict and fills the defaults. Raises LmfpdError on an invalid config."""
    base_url, api_key, model = (str(_option(config, key, "")).strip() for key in ("base_url", "api_key", "model"))
    if not base_url or not api_key or not model:
        raise LmfpdError("base_url, api_key, and model are required.")
    api = _option(config, "api", "responses")
    if not isinstance(api, str) or api not in _FORMATS:
        raise LmfpdError("api must be responses, chat_completions, or messages.")
    service_tier = _option(config, "service_tier", "default")
    if not isinstance(service_tier, str) or service_tier not in _SERVICE_TIERS:
        raise LmfpdError("service_tier must be flex, default, fast, or ultrafast.")
    count, parallel = _option(config, "count", 3), _option(config, "parallel", 3)
    timeout = _option(config, "timeout", 120)
    if not _int(count) or not 1 <= count <= 3:
        raise LmfpdError("count must be an integer from 1 to 3.")
    if not _int(parallel) or not 1 <= parallel <= 3:
        raise LmfpdError("parallel must be an integer from 1 to 3.")
    if (not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not math.isfinite(timeout)
            or (timeout != 0 and not 0.001 <= timeout <= 2_147_483.647)):
        raise LmfpdError("timeout must be 0 (no timeout) or between 0.001 and 2147483.647 seconds.")
    strict = bool(_option(config, "strict", False))
    if strict and count != 3:
        raise LmfpdError("strict requires count 3.")
    fmt = _FORMATS[api]
    return Options(base_url=base_url, api_key=api_key, model=model, format=fmt, service_tier=service_tier,
                   stream=bool(_option(config, "stream", True)), effort=str(_option(config, "effort", "")),
                   strict=strict, count=count, parallel=min(parallel, count),
                   timeout_ms=math.floor(timeout * 1000 + 0.5), url=_endpoint(base_url, fmt))


def _endpoint(base_url: str, fmt: str) -> str:
    try:
        parts = urlsplit(base_url)
        scheme = parts.scheme.lower()
        host = parts.hostname
        port = parts.port
    except ValueError:
        raise LmfpdError(_INVALID_URL) from None
    if not scheme:
        raise LmfpdError(_INVALID_URL)
    if scheme not in ("http", "https") or parts.username or parts.password or parts.query or parts.fragment:
        raise LmfpdError(_URL_PARTS)
    if not host:
        raise LmfpdError(_INVALID_URL)
    suffix = "/responses" if fmt == "responses" else "/messages" if fmt == "anthropic" else "/chat/completions"
    path = _TRAILING_SLASHES.sub("", quote(parts.path, safe=_PATH_SAFE))
    if _ENDPOINT.search(path) and not path.endswith(suffix):
        raise LmfpdError("The endpoint in --baseurl does not match --api.")
    if not path.endswith(suffix):
        path = (path or "/v1") + suffix
    if ":" in host:
        host = f"[{host}]"
    if port is not None and port != (443 if scheme == "https" else 80):
        host = f"{host}:{port}"
    return f"{scheme}://{host}{path}"


def request_parts(options: Options, prompt: str) -> dict[str, Any]:
    """The URL, headers, and JSON body of one detection request."""
    headers = {"Content-Type": "application/json",
               "Accept": "text/event-stream" if options.stream else "application/json"}
    messages = [{"role": "user", "content": prompt}]
    effort = options.effort
    tier = options.service_tier
    if options.format == "anthropic":
        headers["x-api-key"] = options.api_key
        headers["anthropic-version"] = "2023-06-01"
        if tier != "default":
            headers["anthropic-beta"] = _SPEED_BETA
        body: dict[str, Any] = {"model": options.model, "messages": messages, "max_tokens": 8192,
                                "stream": options.stream}
        if effort == "none":
            body["thinking"] = {"type": "disabled"}
        elif effort and effort != "default":
            body["thinking"] = {"type": "adaptive"}
            body["output_config"] = {"effort": effort}
    else:
        headers["Authorization"] = f"Bearer {options.api_key}"
        if options.format == "responses":
            body = {"model": options.model, "input": messages, "stream": options.stream, "store": False}
            if effort and effort != "default":
                body["reasoning"] = {"effort": effort}
        else:
            body = {"model": options.model, "messages": messages, "stream": options.stream}
            if effort and effort != "default":
                body["reasoning_effort"] = effort
            # Chat Completions streams report usage only on request.
            if options.stream:
                body["stream_options"] = {"include_usage": True}
    if tier != "default":
        body["speed" if options.format == "anthropic" else "service_tier"] = tier
    return {"url": options.url, "headers": headers, "body": body}


def minimum_numbers(expected: int) -> int:
    return max(80, math.ceil(expected * 0.55))


def clean_error(message: str, key: str = "") -> str:
    if key:
        message = message.replace(key, "[REDACTED]")
    return _CONTROL.sub(" ", _ANSI.sub("", message))[:500]


def _seconds(value: float) -> str:
    return str(int(value)) if value == int(value) else repr(value)


def _truthy(value: Any) -> bool:
    """JavaScript truthiness: empty objects and arrays are truthy."""
    if value is None or value is False or isinstance(value, str):
        return bool(value)
    if isinstance(value, (int, float)):
        return value == value and value != 0
    return True


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _items(value: Any) -> list[dict[str, Any]]:
    return [_record(item) for item in value] if isinstance(value, list) else []


def _string(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _get(value: Any, key: str) -> Any:
    return value.get(key) if isinstance(value, dict) else None


def _is_zero(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == 0


def _response_text(data: dict[str, Any]) -> str:
    return "".join(_string(part.get("text")) for item in _items(data.get("output")) if item.get("type") == "message"
                   for part in _items(item.get("content")) if part.get("type") == "output_text")


class _Deadline:
    """Cancels a request when its deadline passes, like the CLI's abort timer. httpx has no whole-request timeout,
    so the timer shuts down the connection's socket, which makes the blocked read fail; `timed_out` tells the
    caller why."""

    def __init__(self, seconds: float):
        self.timed_out = False
        self._stopped = False
        self._socket: socket.socket | None = None
        self._lock = threading.Lock()
        if seconds > 0:
            self._timer: threading.Timer | None = threading.Timer(seconds, self._fire)
            self._timer.daemon = True
            self._timer.start()
        else:
            self._timer = None

    def trace(self, event: str, info: dict[str, Any]) -> None:
        """httpcore trace hook: records the socket of the new connection."""
        if self._timer is None or not event.endswith("connect_tcp.complete"):
            return
        sock = info["return_value"].get_extra_info("socket")
        with self._lock:
            self._socket = sock
            fired = self.timed_out
        if fired:
            _shutdown(sock)

    def _fire(self) -> None:
        with self._lock:
            if self._stopped:
                return
            self.timed_out = True
            sock = self._socket
        if sock is not None:
            _shutdown(sock)

    def stop(self) -> None:
        with self._lock:
            self._stopped = True
        if self._timer is not None:
            self._timer.cancel()


def _shutdown(sock: socket.socket) -> None:
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass


class _Sampler:
    """The state of one request; mirrors the closures of the CLI `requestSample`. `on_update` receives a fresh
    snapshot at the same points as the CLI `report()`."""

    def __init__(self, options: Options, expected: int, on_update: Callable[[Sample], None] | None = None):
        self.options = options
        self.expected = expected
        self.on_update = on_update
        self.state = "waiting"
        self.started = time.monotonic()
        self.first_byte_ms: int | None = None
        self.text = self.raw_text = self.raw = self.finish = ""
        self.count = 0
        self.response_model: str | None = None
        self.response_id: str | None = None
        self.terminal = self.truncated = False
        # Set when `on_update` raised, so `sample` re-raises instead of reporting a failed sample.
        self.update_failed = False

    def report(self) -> None:
        if self.on_update is None:
            return
        try:
            self.on_update({"state": self.state, "text": self.text, "raw_text": self.raw_text,
                            "count": self.count, "expected_count": self.expected, "first_byte_ms": self.first_byte_ms,
                            "response_model": self.response_model, "response_id": self.response_id, "error": None})
        except Exception:
            self.update_failed = True
            raise

    def mark_first_byte(self) -> None:
        self.first_byte_ms = int((time.monotonic() - self.started) * 1000)

    def metadata(self, data: dict[str, Any]) -> None:
        if isinstance(data.get("model"), str):
            self.response_model = data["model"]
        if isinstance(data.get("id"), str):
            self.response_id = data["id"]

    def accept_text(self, text: str, final: bool = False) -> None:
        self.raw_text = text
        # A trailing digit can belong to an unfinished SSE token (for example, 3 -> 355).
        numbers = parse_numbers(text if final else _TRAILING_DIGITS.sub("", text))
        self.count = len(numbers)
        self.text = text
        if not self.options.strict and len(numbers) >= self.expected:
            self.text = ", ".join(map(str, numbers[:self.expected]))
            self.count = self.expected
            self.truncated = not final or len(numbers) > self.expected
        self.report()

    def append_text(self, part: str) -> None:
        self.raw += part
        if not self.truncated:
            self.accept_text(self.raw)

    @staticmethod
    def upstream_error(data: dict[str, Any]) -> None:
        error = data.get("error")
        if _truthy(error) or data.get("type") == "error":
            detail = _string(_get(error, "message")) or _string(data.get("message")) or _string(error)
            raise ValueError(f"Upstream error: {detail or 'Request failed.'}")

    def event(self, frame: str) -> None:
        payload = "\n".join(line[6:] if line.startswith("data: ") else line[5:]
                            for line in _LINE_BREAK.split(frame) if line.startswith("data:"))
        if not payload:
            return
        if payload.strip() == "[DONE]":
            self.terminal = True
            return
        try:
            data = _record(json.loads(payload))
        except ValueError:
            raise ValueError("The SSE response contains invalid JSON.") from None
        self.upstream_error(data)
        self.metadata(data)
        kind = data.get("type")
        if self.options.format == "openai":
            choices = _items(data.get("choices"))
            choice = next((c for c in choices if _is_zero(c.get("index"))), choices[0] if choices else None)
            if choice is not None:
                delta = choice.get("delta")
                if _truthy(_get(delta, "refusal")):
                    raise ValueError("The model refused the request.")
                if _truthy(choice.get("finish_reason")):
                    self.finish = _string(choice["finish_reason"])
                content = _get(delta, "content")
                if isinstance(content, str):
                    self.append_text(content)
        elif self.options.format == "anthropic":
            if kind == "message_start":
                self.metadata(_record(data.get("message")))
            if kind == "content_block_start" and _get(data.get("content_block"), "type") == "text":
                self.append_text(_string(data["content_block"].get("text")))
            if kind == "content_block_delta" and _get(data.get("delta"), "type") == "text_delta":
                self.append_text(_string(data["delta"].get("text")))
            if kind == "message_delta":
                self.finish = _string(_get(data.get("delta"), "stop_reason")) or self.finish
            if kind == "message_stop":
                self.terminal = True
        else:
            if kind in ("response.created", "response.in_progress"):
                self.metadata(_record(data.get("response")))
            if kind == "response.output_text.delta":
                self.append_text(_string(data.get("delta")))
            if kind == "response.output_text.done" and not self.raw_text:
                self.accept_text(_string(data.get("text")), True)
            if kind == "response.output_item.done" and not self.raw_text:
                self.accept_text(_response_text({"output": [data.get("item")]}), True)
            if kind == "response.refusal.delta":
                raise ValueError("The model refused the request.")
            if kind == "response.completed":
                response = _record(data.get("response"))
                self.metadata(response)
                self.terminal = True
                self.finish = _string(response.get("status")) or "completed"
                full = _response_text(response)
                if full and not self.truncated:
                    self.accept_text(full, True)
            if kind in ("response.failed", "response.incomplete"):
                response = data.get("response")
                detail = (_string(_get(_get(response, "error"), "message"))
                          or _string(_get(_get(response, "incomplete_details"), "reason")) or kind)
                raise ValueError(f"Responses request did not complete: {detail}.")
        if self.finish in _REFUSED:
            raise ValueError("The model refused the request.")

    def read_sse(self, response: httpx.Response, deadline: _Deadline) -> None:
        buffer = bytearray()
        for chunk in response.iter_bytes():
            if chunk and self.first_byte_ms is None:
                deadline.stop()
                self.mark_first_byte()
                self.state = "streaming"
                self.report()
            buffer += chunk
            while not (self.terminal or self.truncated):
                boundary = _SSE_DELIMITER.search(buffer)
                if boundary is None:
                    break
                self.event(buffer[:boundary.start()].decode("utf-8", "replace"))
                del buffer[:boundary.end()]
            # After the cap the CLI only drains for usage, which never changes the sample.
            if self.terminal or self.truncated:
                return
        rest = buffer.decode("utf-8", "replace")
        if rest.strip():
            self.event(rest)

    def read_json(self, response: httpx.Response, deadline: _Deadline) -> None:
        try:
            body = response.read()
            deadline.stop()
            data = _record(json.loads(body.decode("utf-8", "replace")))
        except Exception:
            raise ValueError("The server did not return valid JSON or SSE.") from None
        self.mark_first_byte()
        self.upstream_error(data)
        self.metadata(data)
        fmt = self.options.format
        if fmt == "responses":
            text = _response_text(data)
            self.finish = _string(data.get("status"))
            self.terminal = self.finish == "completed"
        elif fmt == "anthropic":
            text = "".join(_string(part.get("text")) for part in _items(data.get("content"))
                           if part.get("type") == "text")
            self.finish = _string(data.get("stop_reason"))
            self.terminal = True
        else:
            choices = _items(data.get("choices"))
            message = choices[0].get("message") if choices else None
            if _truthy(_get(message, "refusal")):
                raise ValueError("The model refused the request.")
            text = _string(_get(message, "content"))
            self.finish = _string(choices[0].get("finish_reason")) if choices else ""
            self.terminal = True
        if self.finish in _REFUSED:
            raise ValueError("The model refused the request.")
        if not self.terminal or self.finish not in _FINISHED:
            raise ValueError(f"The response did not complete ({self.finish or 'missing finish status'}).")
        self.accept_text(text, True)

    def run(self, client: httpx.Client, prompt: str, deadline: _Deadline) -> None:
        request = request_parts(self.options, prompt)
        # Only the deadline limits reads: SSE replies may pause for any time after their first byte.
        connect_timeout = self.options.timeout_ms / 1000 if self.options.timeout_ms > 0 else None
        extensions = {"trace": deadline.trace} if self.options.timeout_ms > 0 else {}
        with client.stream("POST", request["url"], headers=request["headers"],
                           content=json.dumps(request["body"], ensure_ascii=False).encode("utf-8"),
                           timeout=httpx.Timeout(None, connect=connect_timeout),
                           extensions=extensions) as response:
            if not 200 <= response.status_code < 300:
                body = response.read().decode("utf-8", "replace")
                try:
                    data = _record(json.loads(body))
                    detail = _string(_get(data.get("error"), "message")) or _string(data.get("message")) or body
                except ValueError:
                    detail = body
                raise ValueError(f"HTTP {response.status_code}: {detail or response.reason_phrase}")
            if "text/event-stream" in response.headers.get("content-type", "").lower():
                self.read_sse(response, deadline)
            else:
                self.read_json(response, deadline)
        if deadline.timed_out:
            raise TimeoutError()
        if not self.truncated and (not self.terminal or self.finish not in _FINISHED):
            raise ValueError(f"The response did not complete ({self.finish or 'missing finish status'}).")
        if not self.truncated:
            self.accept_text(self.raw_text, True)
        minimum = minimum_numbers(self.expected)
        if self.count < minimum:
            raise ValueError(f"Too few valid numbers: {self.count}; need at least {minimum}.")


def sample(options: Options, challenge: Challenge, client: httpx.Client,
           on_update: Callable[[Sample], None] | None = None) -> Sample:
    """Sends one challenge and returns the checked reply. Request failures are reported in `error`; exceptions from
    `on_update` propagate."""
    sampler = _Sampler(options, challenge["expected_count"], on_update)
    sampler.report()
    deadline = _Deadline(options.timeout_ms / 1000)
    state, error = "complete", None
    try:
        sampler.run(client, challenge["prompt"], deadline)
        if sampler.truncated:
            state = "truncated"
    except Exception as exc:
        if sampler.update_failed:
            raise
        state = "failed"
        if deadline.timed_out or isinstance(exc, httpx.ConnectTimeout):
            waiting = "the first SSE byte" if options.stream else "the JSON response"
            error = f"Timed out after {_seconds(options.timeout_ms / 1000)}s waiting for {waiting}."
        else:
            error = clean_error(str(exc) or type(exc).__name__, options.api_key)
    finally:
        deadline.stop()
    result: Sample = {"state": state, "text": sampler.text, "raw_text": sampler.raw_text,
                      "count": sampler.count, "expected_count": sampler.expected,
                      "first_byte_ms": sampler.first_byte_ms, "response_model": sampler.response_model,
                      "response_id": sampler.response_id, "error": error}
    if on_update is not None:
        on_update(result.copy())
    return result


def client() -> httpx.Client:
    """An HTTP client that honors the proxy environment variables and never follows redirects. Every request opens
    its own connection so its deadline can shut that connection down."""
    return httpx.Client(follow_redirects=False, trust_env=True, limits=httpx.Limits(max_keepalive_connections=0))
