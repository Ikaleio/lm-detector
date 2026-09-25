"""Reference rows and robust nuisance-aware bank fitting for the shared ranker."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from fingerprint import (
    DIMENSION, ORDERED_BLOCK_WEIGHT, count_numbers,
    hellinger_feature, ordered_block_feature, parse_numbers,
)
from reference_data import reference_records


def read_rows(path: Path) -> list[dict]:
    output = []
    for row in reference_records(path):
        numbers = parse_numbers(row["text"])
        output.append({**row, "numbers": numbers, "counts": count_numbers(numbers)})
    return output


def fit_robust_artifacts(rows: list[dict], model_ids: list[str]) -> dict:
    environments = sorted({row["condition_id"] for row in rows})
    complete = [
        environment
        for environment in environments
        if {row["source"] for row in rows if row["condition_id"] == environment}
        == set(model_ids)
    ]
    robust_ready = bool(complete)
    robust_rows = rows
    # Fit model centers on every accepted sample. Estimate nuisance directions
    # only from environments represented by every model.

    features = np.stack([hellinger_feature(row["counts"]) for row in robust_rows])
    feature_mean = features.mean(axis=0)
    feature_scale = features.std(axis=0)
    feature_scale[feature_scale < 1e-12] = 1.0
    standardized = (features - feature_mean) / feature_scale

    nuisance_environments = complete
    environment_means = []
    for environment in nuisance_environments:
        indices = np.asarray(
            [
                row["condition_id"] == environment
                for row in robust_rows
            ],
            dtype=bool,
        )
        environment_means.append(standardized[indices].mean(axis=0))
    offsets = np.stack(environment_means) if environment_means else np.empty((0, DIMENSION))
    if len(offsets):
        offsets -= offsets.mean(axis=0, keepdims=True)
    basis = np.empty((0, DIMENSION), dtype=np.float64)
    if len(offsets) > 1:
        _, singular, right = np.linalg.svd(offsets, full_matrices=False)
        rank = min(2, int(np.sum(singular > singular[0] * 1e-8))) if singular[0] else 0
        basis = right[:rank]
        standardized -= (standardized @ basis.T) @ basis

    labels = np.asarray([row["source"] for row in robust_rows])
    centroids = np.stack(
        [standardized[labels == model_id].mean(axis=0) for model_id in model_ids]
    )
    centroid_norms = np.linalg.norm(centroids, axis=1, keepdims=True)
    centroids /= np.maximum(centroid_norms, 1e-12)

    ordered_features = np.stack([ordered_block_feature(row["numbers"]) for row in robust_rows])
    ordered_mean = ordered_features.mean(axis=0)
    ordered_scale = ordered_features.std(axis=0)
    ordered_scale[ordered_scale < 1e-12] = 1.0
    ordered_standardized = (ordered_features - ordered_mean) / ordered_scale
    ordered_environment_means = []
    for environment in nuisance_environments:
        indices = np.asarray(
            [
                row["condition_id"] == environment
                for row in robust_rows
            ],
            dtype=bool,
        )
        ordered_environment_means.append(ordered_standardized[indices].mean(axis=0))
    ordered_offsets = np.stack(ordered_environment_means) if ordered_environment_means else np.empty((0, ordered_standardized.shape[1]))
    if len(ordered_offsets):
        ordered_offsets -= ordered_offsets.mean(axis=0, keepdims=True)
    ordered_basis = np.empty((0, ordered_standardized.shape[1]), dtype=np.float64)
    if len(ordered_offsets) > 1:
        _, singular, right = np.linalg.svd(ordered_offsets, full_matrices=False)
        rank = min(2, int(np.sum(singular > singular[0] * 1e-8))) if singular[0] else 0
        ordered_basis = right[:rank]
        ordered_standardized -= (ordered_standardized @ ordered_basis.T) @ ordered_basis
    ordered_centroids = np.stack(
        [ordered_standardized[labels == model_id].mean(axis=0) for model_id in model_ids]
    )
    ordered_centroids /= np.maximum(np.linalg.norm(ordered_centroids, axis=1, keepdims=True), 1e-12)
    ordered_environment_centroids = []
    unprojected_ordered = (ordered_features - ordered_mean) / ordered_scale
    template_environments = [None, *complete]
    for environment in template_environments:
        environment_centroids = []
        for model_id in model_ids:
            indices = np.asarray(
                [
                    (environment is None or row["condition_id"] == environment)
                    and row["source"] == model_id
                    for row in robust_rows
                ],
                dtype=bool,
            )
            centroid = unprojected_ordered[indices].mean(axis=0)
            centroid /= max(float(np.linalg.norm(centroid)), 1e-12)
            environment_centroids.append(centroid)
        ordered_environment_centroids.append(np.stack(environment_centroids))
    ordered_weight = ORDERED_BLOCK_WEIGHT

    return {
        "model_order": model_ids,
        "robust_ready": robust_ready,
        "training_rows": len(robust_rows),
        "complete_environments": complete,
        "hellinger": {
            "feature_mean": feature_mean.tolist(),
            "feature_scale": feature_scale.tolist(),
            "nuisance_rank": len(basis),
            "nuisance_environments": nuisance_environments,
            "nuisance_basis": basis.tolist(),
            "centroids": centroids.tolist(),
        },
        "ordered_blocks": {
            "weight": ordered_weight,
            "feature": "four position blocks x 16 value bins plus final-digit distribution",
            "feature_mean": ordered_mean.tolist(),
            "feature_scale": ordered_scale.tolist(),
            "nuisance_rank": len(ordered_basis),
            "nuisance_basis": ordered_basis.tolist(),
            "centroids": ordered_centroids.tolist(),
            "environment_centroids": [centroids.tolist() for centroids in ordered_environment_centroids],
        },
    }


