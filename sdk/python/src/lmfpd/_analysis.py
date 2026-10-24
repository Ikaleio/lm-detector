"""Analysis in the canonical shape (port of `analyzeSharedOutputs`, `englishAnalysis`, and the SDK preprocessing)."""

from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np

from ._features import parse_numbers, raw_out_of_range_count
from ._ranker import Ranker
from ._types import Analysis, LmfpdError, Output

SCORING_FAILED = "Scoring failed. Check that the reference bank and detector files are valid."
INVALID_OUTPUTS = ("Each input round must contain one to three outputs with text and a positive integer "
                   "expected_count.")
_MAX_SAFE_INTEGER = 2 ** 53 - 1

# Reference replies tend to have negative lag-1 autocorrelation and few steps of 20 or less. The limits are the
# 99.5% quantiles over reference three-answer groups; a reply is rejected only when both signals exceed them.
_AUTOCORRELATION_LIMIT = -0.23
_SMALL_STEP_LIMIT = 0.05


class Scorer:
    """The ranker plus the bank metadata that names its models."""

    def __init__(self, bank: dict[str, Any], detector: dict[str, Any]):
        self.ranker = Ranker(detector)
        self.models = [(m.get("id"), m.get("display_name"), m.get("family"), m.get("family_name"))
                       for m in bank["models"]]
        self.base_sha256 = detector["base_sha256"]
        calibration = detector.get("calibration")
        self.calibration = None if self.ranker.tau is None else {
            "method": calibration["method"], "run": calibration["calibration_run"], "tau": calibration["tau"],
            "sha256": detector.get("calibration_sha256"),
        }

    def _results(self, ranking: list[float], probabilities: list[float] | None) -> tuple[list[dict], int]:
        # Stable: ties keep the bank order.
        order = sorted(range(len(ranking)), key=lambda i: -ranking[i])
        results = []
        for i in order:
            model, display_name, family, family_name = self.models[i]
            results.append({"model": model, "display_name": display_name, "family": family,
                            "family_name": family_name, "score": ranking[i],
                            "probability": None if probabilities is None else probabilities[i]})
        return results, order[0]

    def score(self, outputs: Sequence[Output], strict: bool) -> Analysis:
        """Scores outputs as given, like `analyzeSharedOutputs` followed by `englishAnalysis`."""
        parsed = [parse_numbers(o["text"]) for o in outputs]
        diagnostics = []
        for index, (output, numbers) in enumerate(zip(outputs, parsed)):
            minimum = max(80, math.ceil((output["expected_count"] or 0) * 0.55))
            diagnostics.append({"index": index, "parsed_numbers": len(numbers), "minimum_numbers": minimum,
                                "accepted": len(numbers) >= minimum,
                                "raw_out_of_range_count": raw_out_of_range_count(output["text"])})
        accepted = [numbers for numbers, d in zip(parsed, diagnostics) if d["accepted"]]
        used = len(accepted)
        sequence = _sequence_shape(accepted) if used else None
        analysis: dict[str, Any] = {
            "decision": "scored", "prediction": "", "prediction_name": "", "family_prediction": "",
            "family_prediction_name": "", "results": [], "ranking_score": None, "probability": None,
            "probability_status": "unavailable", "probability_scope": None, "calibration": None,
            "used_outputs": used, "diagnostics": diagnostics, "sequence": sequence, "method": "shared-detector-v2",
            "model_version": {"base_sha256": self.base_sha256},
        }
        not_model = {"decision": "not_model", "prediction_name": "Not a model reply", "evidence": _evidence(
            "Not like a language model reply",
            "Consecutive numbers change differently from the language-model replies in the reference bank. "
            "Program-generated, sorted or shuffled numbers often do this. No ranking was produced.",
            "sequence-shape")}
        if not strict and 0 < used < 3 and len(outputs) <= 3:
            if not sequence["model_like"]:
                return {**analysis, **not_model}
            ranking = self.ranker.rank(accepted).tolist()
            results, first = self._results(ranking, None)
            _, _, family, family_name = self.models[first]
            return {**analysis, "method": "shared-ranker-partial-v1", "decision": "partial",
                    "prediction": results[0]["model"], "prediction_name": results[0]["display_name"],
                    "family_prediction": family, "family_prediction_name": family_name, "results": results,
                    "ranking_score": ranking[first], "evidence": _evidence(
                        "Partial sample ranking",
                        f"Ranked {used} valid sample{'' if used == 1 else 's'}. "
                        "Confidence requires three valid samples.",
                        "partial-sample-ranking")}
        if len(outputs) != 3 or used != 3:
            return {**analysis, "decision": "unscorable", "prediction_name": "Not scored", "evidence": _evidence(
                "Not enough valid samples",
                f"Received {used}/3 valid samples. Three valid samples are required.",
                "complete-three-answers")}
        if not sequence["model_like"]:
            return {**analysis, **not_model}
        scores = self.ranker.rank(parsed)
        calibrated_scores = self.ranker.calibrate(scores)
        ranking = scores.tolist()
        probabilities = None if calibrated_scores is None else calibrated_scores.tolist()
        results, first = self._results(ranking, probabilities)
        _, _, family, family_name = self.models[first]
        calibrated = probabilities is not None
        return {**analysis, "prediction": results[0]["model"], "prediction_name": results[0]["display_name"],
                "family_prediction": family, "family_prediction_name": family_name, "results": results,
                "ranking_score": ranking[first], "probability": results[0]["probability"],
                "probability_status": "reference_calibrated" if calibrated else "unavailable",
                "probability_scope": "reference-closed-set" if calibrated else None,
                "calibration": dict(self.calibration) if calibrated else None,
                "evidence": _evidence(
                    "Calibrated ranking",
                    "Confidence is a closed-set probability within the reference bank.",
                    "reference-calibrated-ranking") if calibrated else _evidence(
                    "Uncalibrated ranking",
                    "The confidence calibration does not match this detector. Confidence is unavailable.",
                    "uncalibrated-ranking")}

    def analyze(self, outputs: Sequence[Output], strict: bool) -> Analysis:
        """Scores saved replies like `fpd --input`: extra numbers are cut in relaxed mode, short replies count as
        missing."""
        if (not isinstance(outputs, (list, tuple)) or not 1 <= len(outputs) <= 3
                or not all(_valid_output(item) for item in outputs)):
            raise LmfpdError(INVALID_OUTPUTS)
        prepared = []
        for item in outputs:
            text, expected = item["text"], item["expected_count"]
            numbers = parse_numbers(text)
            if not strict and len(numbers) > expected:
                text = ", ".join(map(str, numbers[:expected]))
            if len(numbers) < minimum_numbers(expected):
                text = ""
            prepared.append({"text": text, "expected_count": expected})
        try:
            return self.score(prepared, strict)
        except Exception:
            raise LmfpdError(SCORING_FAILED) from None


def minimum_numbers(expected: int) -> int:
    return max(80, math.ceil(expected * 0.55))


def _valid_output(item: Any) -> bool:
    if not isinstance(item, dict) or not isinstance(item.get("text"), str):
        return False
    expected = item.get("expected_count")
    return isinstance(expected, int) and not isinstance(expected, bool) and 0 < expected <= _MAX_SAFE_INTEGER


def _evidence(label: str, reason: str, method: str) -> dict[str, Any]:
    return {"insufficient": True, "label": label, "reason": reason, "threshold": None, "method": method}


def _sequence_shape(replies: Sequence[Sequence[int]]) -> dict[str, Any]:
    autocorrelations, small_steps = [], []
    for reply in replies:
        n = np.asarray(reply, dtype=np.float64)
        centered = n - n.mean()
        variance = (centered * centered).mean()
        autocorrelations.append((centered[1:] * centered[:-1]).mean() / variance if variance else 1.0)
        small_steps.append(np.mean(np.abs(np.diff(n)) <= 20))
    autocorrelation, small_step_share = float(np.median(autocorrelations)), float(np.median(small_steps))
    return {"autocorrelation": autocorrelation, "small_step_share": small_step_share,
            "model_like": autocorrelation <= _AUTOCORRELATION_LIMIT or small_step_share <= _SMALL_STEP_LIMIT}
