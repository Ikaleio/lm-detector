"""The public API."""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Any, Callable, Mapping, Sequence

from . import _sampling
from ._analysis import SCORING_FAILED, Scorer
from ._challenge import generate_challenges
from ._data import DEFAULT_DATA_URLS, load_data
from ._features import parse_numbers
from ._types import Analysis, Challenge, DetectResult, LmfpdError, Output, Sample


class Detector:
    """A loaded reference bank and detector. Create one with `load()`."""

    __slots__ = ("_built_at", "_scorer")

    def __init__(self, built_at: str, scorer: Scorer):
        self._built_at = built_at
        self._scorer = scorer

    @property
    def built_at(self) -> str:
        """`built_at` of the reference bank, which identifies the data build."""
        return self._built_at

    def analyze(self, outputs: Sequence[Output], strict: bool = False) -> Analysis:
        """Scores one to three saved replies. Three valid replies give a calibrated ranking; fewer give a partial
        ranking unless `strict` is set."""
        return self._scorer.analyze(outputs, strict)

    def detect(self, base_url: str, api_key: str, model: str, *, api: str = "responses", effort: str = "",
               service_tier: str = "default", stream: bool = True, strict: bool = False, count: int = 3,
               parallel: int = 3, timeout: float = 120.0,
               on_sample: Callable[[int, Sample], None] | None = None) -> DetectResult:
        """Sends one round of challenges to the model API and scores the replies. Raises on an invalid config or when
        `on_sample` raises; request failures are reported in the samples and `error`.

        `timeout` limits the wait for the first SSE byte or the whole JSON reply; 0 disables the timer. This SDK cannot
        cancel requests, so with 0 a server that connects but never sends its first byte (or never finishes a JSON
        reply) blocks `detect` forever.

        `on_sample(index, sample)` reports progress: first `queued` for every challenge in order, then each sample's
        `waiting`, `streaming`, and text updates, and last its final state, equal to `result["samples"][index]`. Calls
        come from worker threads, one at a time, each with a fresh dict; a slow callback slows sampling."""
        options = _sampling.detect_options({
            "base_url": base_url, "api_key": api_key, "model": model, "api": api, "effort": effort,
            "service_tier": service_tier, "stream": stream, "strict": strict, "count": count, "parallel": parallel,
            "timeout": timeout,
        })
        challenges = generate_challenges(options.count)
        updates: list[Callable[[Sample], None] | None] = [None] * len(challenges)
        if on_sample is not None:
            lock = threading.Lock()

            def emit(index: int, sample: Sample) -> None:
                with lock:
                    on_sample(index, sample)

            updates = [partial(emit, i) for i in range(len(challenges))]
            for i, challenge in enumerate(challenges):
                on_sample(i, {"state": "queued", "text": "", "raw_text": "", "count": 0,
                              "expected_count": challenge["expected_count"], "first_byte_ms": None,
                              "response_model": None, "response_id": None, "error": None})
        with _sampling.client() as http, ThreadPoolExecutor(options.parallel) as pool:
            samples = list(pool.map(lambda challenge, on_update: _sampling.sample(options, challenge, http, on_update),
                                    challenges, updates))
        accepted = sum(1 for s in samples if s["state"] in ("complete", "truncated"))
        result: DetectResult = {"challenges": challenges, "samples": samples, "analysis": None, "error": None}
        if not accepted or (options.strict and accepted != 3):
            result["error"] = (f"Strict mode requires 3/3 successful samples; received {accepted}/3."
                               if options.strict else "No valid samples. This round cannot be scored.")
            return result
        outputs: list[Output] = [{"text": s["text"] if s["state"] in ("complete", "truncated") else "",
                                  "expected_count": s["expected_count"]} for s in samples]
        try:
            analysis = self._scorer.score(outputs, options.strict)
        except Exception:
            result["error"] = SCORING_FAILED
            return result
        result["analysis"] = analysis
        if not analysis["results"]:
            result["error"] = analysis["evidence"]["reason"]
        return result


def load(source: str | Sequence[str] = DEFAULT_DATA_URLS, cache: str | os.PathLike[str] | None = None,
         ttl: float = 86400.0) -> Detector:
    """Loads the reference data. A single source that is not an http(s) URL is a local directory with
    `unified_bank.json` and `shared_detector.bin`, read as is. URL sources are tried in order behind the cache file
    `cache` (default `<OS cache dir>/lmfpd/data.bin`): a cached copy is returned at once and, when last checked `ttl`
    seconds ago or earlier (0 checks on every load), refreshed in the background for the next load. Without a cache it
    downloads."""
    return Detector(*load_data(source, cache, ttl))


def build_request(config: Mapping[str, Any], prompt: str) -> dict[str, Any]:
    """The HTTP request `detect` sends for one prompt: `{"url", "headers", "body"}`. Raises LmfpdError on an invalid
    config."""
    return _sampling.request_parts(_sampling.detect_options(config), prompt)


def request_sample(config: Mapping[str, Any], challenge: Challenge) -> Sample:
    """Sends one challenge and returns the checked reply. Request failures are reported in `error`. With `timeout` 0
    a server that connects but never sends its first byte (or never finishes a JSON reply) blocks forever."""
    options = _sampling.detect_options(config)
    with _sampling.client() as http:
        return _sampling.sample(options, challenge, http)


__all__ = [
    "DEFAULT_DATA_URLS", "Analysis", "Challenge", "DetectResult", "Detector", "LmfpdError", "Output", "Sample",
    "build_request", "generate_challenges", "load", "parse_numbers", "request_sample",
]
