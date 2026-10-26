"""Public result shapes. Every SDK language returns the same keys."""

from __future__ import annotations

from typing import List, Literal, Optional, TypedDict


class LmfpdError(Exception):
    """Invalid input, invalid configuration, unreadable reference data, or a failed scoring run."""


class Output(TypedDict):
    """One model reply and the number count its challenge asked for."""
    text: str
    expected_count: int


class Challenge(TypedDict):
    id: str
    expected_count: int
    prompt: str


class AnalysisResult(TypedDict):
    model: str
    display_name: str
    family: str
    family_name: str
    score: float
    probability: Optional[float]


class Diagnostic(TypedDict):
    index: int
    parsed_numbers: int
    minimum_numbers: int
    accepted: bool
    raw_out_of_range_count: int


class Calibration(TypedDict):
    method: str
    run: str
    tau: float
    sha256: Optional[str]


class Sequence(TypedDict):
    autocorrelation: float
    small_step_share: float
    model_like: bool


class ModelVersion(TypedDict):
    base_sha256: str


class Evidence(TypedDict):
    insufficient: bool
    label: str
    reason: str
    threshold: None
    method: str


class Analysis(TypedDict):
    """Every key is always present."""
    decision: Literal["scored", "partial", "unscorable", "not_model"]
    prediction: str
    prediction_name: str
    family_prediction: str
    family_prediction_name: str
    #: Candidates by ranking score, best first. Empty unless the decision is `scored` or `partial`.
    results: List[AnalysisResult]
    ranking_score: Optional[float]
    #: Closed-set probability of the top candidate within the reference bank.
    probability: Optional[float]
    probability_status: Literal["unavailable", "reference_calibrated"]
    probability_scope: Optional[str]
    calibration: Optional[Calibration]
    used_outputs: int
    diagnostics: List[Diagnostic]
    sequence: Optional[Sequence]
    method: str
    model_version: ModelVersion
    evidence: Evidence


class Sample(TypedDict):
    #: `queued`, `waiting`, and `streaming` appear only in `on_sample` progress events.
    state: Literal["queued", "waiting", "streaming", "complete", "truncated", "failed"]
    #: The numbers used for scoring; capped at `expected_count` when the reply had more.
    text: str
    raw_text: str
    count: int
    expected_count: int
    #: Milliseconds from the request start to the first SSE body byte, or to the parsed JSON body; None if not reached.
    first_byte_ms: Optional[int]
    response_model: Optional[str]
    response_id: Optional[str]
    error: Optional[str]


class DetectResult(TypedDict):
    challenges: List[Challenge]
    samples: List[Sample]
    analysis: Optional[Analysis]
    #: Why the round has no ranking, or None when it has one.
    error: Optional[str]
