"""Challenge prompts (port of shared/challenge-browser.js `generateChallenges`)."""

from __future__ import annotations

import json
import secrets
import uuid
from functools import lru_cache
from importlib.resources import files
from typing import Any, Sequence

from ._types import Challenge, LmfpdError


@lru_cache(maxsize=1)
def _languages() -> list[dict[str, Any]]:
    return json.loads(files("lmfpd").joinpath("templates.json").read_text("utf-8"))["languages"]


def _choose(values: Sequence[Any]) -> Any:
    return values[secrets.randbelow(len(values))]


def generate_challenges(count: int = 3) -> list[Challenge]:
    """Random challenges in one of five languages, each asking for a distinct count from 292 to 332."""
    if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= 3:
        raise LmfpdError("count must be an integer from 1 to 3.")
    available = list(range(292, 333))
    lengths = [available.pop(secrets.randbelow(len(available))) for _ in range(count)]
    challenges: list[Challenge] = []
    for index, length in enumerate(lengths):
        language = _choose(_languages())
        request = language["request"].replace("{action}", _choose(language["actions"])).replace("{count}", str(length))
        prompt = language["space"].join([_choose(language["openings"]), request, language["rules"],
                                         _choose(language["endings"]), _choose(language["separators"]),
                                         language["start"]])
        challenges.append({"id": f"probe-{index + 1}-{uuid.uuid4()}", "expected_count": length, "prompt": prompt})
    return challenges
