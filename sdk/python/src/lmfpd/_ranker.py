"""Ranking (port of shared/shared-detector.ts `rankSharedNumbers`, `baseline`, `nearest`, `calibrateRanking`)."""

from __future__ import annotations

import math
from typing import Any, Sequence

import numpy as np

from ._features import POSITIONAL_WEIGHTS, hellinger_feature, ordered_block_feature, positional_features

Vector = np.ndarray

_BLOCK_SCALES = (math.sqrt(0.75), math.sqrt(0.25))
_NEAREST = 7


def _norm(a: Vector) -> Vector:
    return a / max(math.sqrt(a @ a), 1e-12)


def _z(a: Vector, axis: int = -1) -> Vector:
    """Standardizes along `axis` with the population deviation."""
    m = a.mean(axis=axis, keepdims=True)
    s = np.maximum(np.sqrt(((a - m) ** 2).mean(axis=axis, keepdims=True)), 1e-12)
    return (a - m) / s


def _subtract(v: Vector, basis: np.ndarray) -> Vector:
    """Projects out every basis row, with all coefficients taken from the original `v`."""
    return v - (basis @ v) @ basis


def _matrix(rows: Sequence[Vector]) -> np.ndarray:
    return np.array(rows, dtype=np.float64).reshape(len(rows), -1)


def _params(params: Sequence[dict[str, Any]]) -> list[tuple[Vector, Vector]]:
    return [(np.asarray(p["mean"]), np.asarray(p["scale"])) for p in params]


def _calibration_tau(detector: dict[str, Any]) -> float | None:
    """The ranking temperature when the calibration is bound to this ranker, else None."""
    head = detector.get("calibration")
    binding = head.get("binding") if isinstance(head, dict) else None
    if not isinstance(binding, dict):
        return None
    tau = head.get("tau")
    model_ids = detector.get("model_ids")
    bound_ids = binding.get("model_ids")
    if (head.get("schema") != "shared-confidence-v2" or head.get("method") != "ranking-temperature"
            or not isinstance(tau, (int, float)) or isinstance(tau, bool) or not math.isfinite(tau)
            or tau < 0.001 or tau > 1000
            or binding.get("base_sha256") != detector.get("base_sha256")
            or binding.get("reference_sha256") != detector.get("source_reference_sha256")
            or not isinstance(bound_ids, list) or not isinstance(model_ids, list)
            or len(bound_ids) != len(model_ids) or bound_ids != model_ids):
        return None
    return tau


class Ranker:
    """The decoded ranker as NumPy matrices, with the reference row norms precomputed."""

    def __init__(self, detector: dict[str, Any]):
        r = detector["ranker"]
        self.model_ids: list[str] = detector["model_ids"]
        self.head_params = _params(r["head_params"])
        self.full_params = _params(r["full_params"])
        self.lda_weights = _matrix(r["lda_weights"])
        self.lda_bias = np.asarray(r["lda_bias"])
        # All references in one matrix. `slots[m, j]` is the row of the model's j-th reference; models with fewer
        # references than the largest pad with row 0 and are masked out.
        references = [_matrix(rows) for rows in r["references"]]
        self.references = np.concatenate(references)
        self.reference_norms = np.einsum("ij,ij->i", self.references, self.references)
        sizes = np.array([len(rows) for rows in references])
        offsets = np.concatenate([[0], np.cumsum(sizes)[:-1]])
        columns = np.arange(sizes.max())
        self.valid = columns < sizes[:, None]
        self.slots = np.where(self.valid, offsets[:, None] + columns, 0)
        self.nearest_counts = np.minimum(_NEAREST, sizes)
        h, o = r["bank"]["hellinger"], r["bank"]["ordered_blocks"]
        self.h = (np.asarray(h["feature_mean"]), np.asarray(h["feature_scale"]), _matrix(h["nuisance_basis"]),
                  _matrix(h["centroids"]))
        self.o = (np.asarray(o["feature_mean"]), np.asarray(o["feature_scale"]), _matrix(o["nuisance_basis"]),
                  _matrix(o["centroids"]))
        self.environment_centroids = np.stack([_matrix(rows) for rows in o["environment_centroids"]])
        self.blend = (r["blend"]["frequency"], r["blend"]["positional"])
        positional = r["positional"]
        self.positional_params = _params(positional["params"])
        self.positional_scales = np.sqrt(POSITIONAL_WEIGHTS)
        self.positional_weights = _matrix(positional["weights"])
        self.positional_bias = np.asarray(positional["bias"])
        self.tau = _calibration_tau(detector)

    @staticmethod
    def _transform(numbers: np.ndarray, params) -> Vector:
        blocks = (hellinger_feature(numbers), ordered_block_feature(numbers))
        return np.concatenate([_norm((block - mean) / scale) * weight
                               for block, (mean, scale), weight in zip(blocks, params, _BLOCK_SCALES)])

    def _nearest(self, x: np.ndarray) -> np.ndarray:
        """For each row of `x` and each model, the mean of the 7 smallest squared distances to its references."""
        xx = np.einsum("ij,ij->i", x, x)
        distances = np.maximum(0, xx[:, None] + self.reference_norms - 2 * (x @ self.references.T))
        padded = np.where(self.valid, distances[:, self.slots], np.inf)
        if padded.shape[-1] > _NEAREST:
            padded = np.partition(padded, _NEAREST - 1, axis=-1)[..., :_NEAREST]
        return np.where(np.isfinite(padded), padded, 0).sum(axis=-1) / self.nearest_counts

    def _baseline(self, numbers: np.ndarray) -> Vector:
        h_mean, h_scale, h_basis, h_centroids = self.h
        o_mean, o_scale, o_basis, o_centroids = self.o
        h_unit = _norm(_subtract((hellinger_feature(numbers) - h_mean) / h_scale, h_basis))
        marginal = h_centroids @ h_unit
        o_centered = (ordered_block_feature(numbers) - o_mean) / o_scale
        templates = (self.environment_centroids @ _norm(o_centered)).max(axis=0)
        nuisance = o_centroids @ _norm(_subtract(o_centered, o_basis))
        ordered = _z(0.5 * _z(templates) + 0.5 * _z(nuisance))
        return 0.5 * _z(marginal) + 0.5 * ordered

    def _positional(self, numbers: np.ndarray) -> Vector:
        x = np.concatenate([_norm((block - mean) / scale) * weight for block, (mean, scale), weight in zip(
            positional_features(numbers), self.positional_params, self.positional_scales)])
        return self.positional_weights @ x + self.positional_bias

    def rank(self, replies: Sequence[Sequence[int]]) -> Vector:
        # The result is checked for non-finite values below. Some NumPy builds on macOS Accelerate also raise
        # spurious floating-point warnings in matmul.
        with np.errstate(all="ignore"):
            ranking = self._rank([np.asarray(reply, dtype=np.int64) for reply in replies])
        if not np.isfinite(ranking).all():
            raise ValueError("The ranking produced a non-finite value.")
        return ranking

    def _rank(self, numbers: Sequence[np.ndarray]) -> Vector:
        heads = np.stack([self._transform(n[:128], self.head_params) for n in numbers])
        lda = _z(heads @ self.lda_weights.T + self.lda_bias)
        l = _z(lda.mean(axis=0))
        full = np.stack([self._transform(n, self.full_params) for n in numbers])
        near = _z(np.median(-self._nearest(full), axis=0))
        base = _z(np.mean([self._baseline(n) for n in numbers], axis=0))
        frequency = _z(0.5 * l + 0.25 * near + 0.25 * base)
        positional = _z(_z(np.stack([self._positional(n) for n in numbers])).mean(axis=0))
        return self.blend[0] * frequency + self.blend[1] * positional

    def calibrate(self, ranking: Vector) -> Vector | None:
        """Closed-set probabilities from the calibration bound to this ranker; None when none matches."""
        if self.tau is None or len(ranking) != len(self.model_ids):
            return None
        logits = self.tau * ranking
        weights = np.exp(logits - logits.max())
        return weights / weights.sum()
