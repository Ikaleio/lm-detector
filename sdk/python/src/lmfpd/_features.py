"""Number parsing and feature blocks (port of shared/fingerprint-core.js and shared/positional.ts)."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Sequence

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

VALUE_MIN = 1
VALUE_MAX = 355
DIMENSION = VALUE_MAX - VALUE_MIN + 1
ALPHA = 0.5

# ASCII digits only: `\d` is Unicode in Python `re`.
_DIGITS = re.compile(r"[0-9]+")
_SIGNED = re.compile(r"-?[0-9]+")


def _value(digits: str) -> int:
    """The numeric value of a digit run, or -1 when it has more than three significant digits."""
    if len(digits) > 3:
        digits = digits.lstrip("0")
        if len(digits) > 3:
            return -1
    return int(digits) if digits else 0


@lru_cache(maxsize=4096)
def _has_letter(separator: str) -> bool:
    # Replies reuse a few separators, so the per-character test is cached.
    return any(c.isalpha() for c in separator)


def parse_numbers(text: str) -> list[int]:
    """The numbers 1 to 355 of the longest run in a reply; letters between numbers split runs."""
    text = str(text)
    best: list[int] = []
    current: list[int] = []
    previous_end = 0
    for match in _DIGITS.finditer(text):
        start = match.start()
        if current and start > previous_end and _has_letter(text[previous_end:start]):
            if len(current) > len(best):
                best = current
            current = []
        value = _value(match.group())
        if VALUE_MIN <= value <= VALUE_MAX:
            current.append(value)
        previous_end = match.end()
    return current if len(current) > len(best) else best


def raw_out_of_range_count(text: str) -> int:
    count = 0
    for match in _SIGNED.finditer(text):
        digits = match.group()
        if digits[0] == "-":
            count += 1
        else:
            value = _value(digits)
            if value == 0 or value < 0 or value > VALUE_MAX:
                count += 1
    return count


Vector = np.ndarray


def hellinger_feature(numbers: np.ndarray) -> Vector:
    """Smoothed Hellinger embedding of the value counts of `numbers` (an int array of values 1 to 355)."""
    counts = np.bincount(numbers - VALUE_MIN, minlength=DIMENSION)
    return np.sqrt((counts + ALPHA) / (len(numbers) + ALPHA * DIMENSION))


def ordered_block_feature(numbers: np.ndarray) -> Vector:
    """Value histograms of the four consecutive quarters, then the last-digit histogram, each Hellinger-scaled."""
    base, remainder = divmod(len(numbers), 4)
    bins = np.minimum(15, np.floor((numbers - 1) / 355 * 16).astype(np.intp))
    pieces = []
    start = 0
    for index in range(4):
        size = base + (1 if index < remainder else 0)
        counts = np.bincount(bins[start:start + size], minlength=16) + 0.5
        pieces.append(np.sqrt(counts / counts.sum()))
        start += size
    digits = np.bincount(numbers % 10, minlength=10) + 0.5
    pieces.append(np.sqrt(digits / digits.sum()))
    return np.concatenate(pieces)


# Positional features. Block order is part of the detector format.
POSITIONAL_WEIGHTS = (0.6, 0.15, 0.125, 0.125)
_CENTRES = 1 + np.arange(24) * 354 / 23
_LAGS = (1, 2, 3, 5, 8, 13, 21, 34)


def _position_kernel(x: np.ndarray) -> Vector:
    """Per feature (24 value kernels, 10 last-digit indicators), its mean product with the first three Legendre
    polynomials of the position."""
    n = len(x)
    t = (np.arange(n) + 0.5) * 2 / n - 1
    basis = np.stack([t, 0.5 * (3 * t * t - 1), 0.5 * (5 * t ** 3 - 3 * t)], axis=1)
    kernels = np.exp(-0.5 * ((x[:, None] - _CENTRES) / 20) ** 2)
    digits = (x[:, None] % 10 == np.arange(10)).astype(np.float64)
    return (np.concatenate([kernels, digits], axis=1).T @ basis / n).reshape(-1)


def _centred_transitions(symbols: np.ndarray, bins: int) -> Vector:
    joint = np.bincount(symbols[:-1] * bins + symbols[1:], minlength=bins * bins) + 0.5
    joint = (joint / (len(symbols) - 1 + 0.5 * bins * bins)).reshape(bins, bins)
    return (joint - np.outer(joint.sum(axis=1), joint.sum(axis=0))).reshape(-1)


def _sequence_features(x: np.ndarray) -> Vector:
    n = len(x)
    m = x.mean()
    s = (x - m) / max(np.sqrt(((x - m) ** 2).mean()), 1)
    out = []
    for lag in _LAGS:
        d = x[lag:] - x[:-lag]
        magnitude = np.abs(d)
        out += (np.mean(s[lag:] * s[:-lag]), magnitude.mean() / 355, np.mean(d > 0), np.mean(d == 0),
                np.mean(magnitude <= 5), np.mean(magnitude <= 20))
    transitions = [_centred_transitions(np.minimum(7, (x - 1) * 8 // 355), 8), _centred_transitions(x % 10, 10)]
    difference = np.diff(x)
    z_step = np.abs(np.diff(s))
    out += (np.mean(np.sign(difference[1:]) == np.sign(difference[:-1])), np.mean(difference[1:] == difference[:-1]),
            np.mean(x[:-1] % 10 == x[1:] % 10), np.mean(z_step > 1), np.mean(z_step > 2))
    buckets = np.minimum(15, (x - 1) * 16 // 355)
    for width in (4, 8, 16):
        windows = np.sort(sliding_window_view(buckets, width), axis=1)
        distinct = 1 + np.count_nonzero(np.diff(windows, axis=1), axis=1)
        out.append(np.mean(distinct / width))
    return np.concatenate([np.array(out[:48]), *transitions, np.array(out[48:])])


def positional_features(numbers: np.ndarray) -> list[Vector]:
    return [hellinger_feature(numbers), ordered_block_feature(numbers), _position_kernel(numbers),
            _sequence_features(numbers)]
