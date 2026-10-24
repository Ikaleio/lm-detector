"""Decoder for `shared_detector.bin` (port of shared/detector-codec.ts `decodeDetector`)."""

from __future__ import annotations

import json
import struct
from typing import Any

import numpy as np


def decode_detector(data: bytes) -> dict[str, Any]:
    """Layout: u32 LE header length, JSON header, padding to 4 bytes, then float32 values stored byte-plane by
    byte-plane (all first bytes, then all second bytes, ...). Header arrays are `{"$f32": offset, "n": length}` and
    decode to float64 NumPy views of one shared array."""
    (header_length,) = struct.unpack_from("<I", data, 0)
    start = (4 + header_length + 3) // 4 * 4
    size = len(data) - start
    if size < 0 or size % 4:
        raise ValueError("Truncated detector data.")
    planes = np.frombuffer(data, dtype=np.uint8, count=size, offset=start).reshape(4, size // 4)
    floats = np.ascontiguousarray(planes.T).view("<f4").reshape(-1).astype(np.float64)

    def expand(value: dict[str, Any]) -> Any:
        if "$f32" in value:
            offset = value["$f32"]
            return floats[offset:offset + value["n"]]
        return value

    return json.loads(bytes(data[4:4 + header_length]).decode("utf-8"), object_hook=expand)
