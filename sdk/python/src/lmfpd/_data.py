"""Reference data: a local directory, or the published data behind a stale-while-revalidate cache file."""

from __future__ import annotations

import json
import os
import re
import secrets
import struct
import sys
import threading
import time
from pathlib import Path
from typing import Any, Sequence, cast

import httpx
import numpy as np
import zstandard

from ._analysis import Scorer
from ._codec import decode_detector
from ._types import LmfpdError

#: Data sources, tried in order. The mirror is JSDMirror, a jsDelivr mirror in mainland China, serving the
#: `lmfpd-data` npm package with the same layout as the site's `/data/`.
DEFAULT_DATA_URLS: tuple[str, ...] = (
    "https://lm.ikale.io/data/",
    "https://cdn.jsdmirror.com/npm/lmfpd-data@latest/",
)
# Bump when the bundle layout changes; older SDKs then refuse the data instead of misreading it.
_DATA_SCHEMA = "lmfpd-data-v1"
_DETECTOR_SCHEMA = "shared-detector-v2"
_DETECTOR = "shared_detector.bin"
_URL = re.compile(r"https?://", re.IGNORECASE)

Data = tuple[str, Scorer]


def default_cache() -> Path:
    home = Path.home()
    if os.environ.get("XDG_CACHE_HOME"):
        root = Path(os.environ["XDG_CACHE_HOME"])
    elif sys.platform == "darwin":
        root = home / "Library" / "Caches"
    elif sys.platform == "win32":
        root = Path(os.environ.get("LOCALAPPDATA") or home / "AppData" / "Local")
    else:
        root = home / ".cache"
    return root / "lmfpd" / "data.bin"


def _supports(bank: Any, detector: Any) -> bool:
    models = bank.get("models") if isinstance(bank, dict) else None
    if not isinstance(models, list) or not isinstance(detector, dict):
        return False
    ids, counts = detector.get("model_ids"), detector.get("response_counts")
    if (detector.get("schema") != _DETECTOR_SCHEMA or bank.get("built_at") != detector.get("bank_built_at")
            or not isinstance(ids, list) or not isinstance(counts, (list, np.ndarray))
            or len(models) != len(ids) or len(counts) < len(ids)):
        return False
    for model, model_id, count in zip(models, ids, counts):
        response_count = model.get("response_count") if isinstance(model, dict) else None
        if (not isinstance(model, dict) or model.get("id") != model_id or isinstance(response_count, bool)
                or response_count != count):
            return False
    return True


def _reference_data(bank: Any, detector: Any) -> Data:
    """Scoring reads only `built_at` and the model names and counts from the bank. `bundle.json` repeats them at its
    top level, so it can stand in for `unified_bank.json`."""
    if not _supports(bank, detector):
        raise LmfpdError("The reference bank does not match its detector.")
    return bank["built_at"], Scorer(bank, detector)


def _read_dir(directory: str) -> Data:
    """Reads `unified_bank.json` and `shared_detector.bin` from a directory such as `projects/data`."""
    parsed = []
    for name, parse in (("unified_bank.json", json.loads), (_DETECTOR, decode_detector)):
        path = os.path.join(directory, name)
        try:
            parsed.append(parse(Path(path).read_bytes()))
        except Exception:
            raise LmfpdError(f"Cannot read {path}.") from None
    return _reference_data(*parsed)


def _read_cache(path: Path) -> tuple[Data, str, float] | None:
    """The cache file holds the u32 little-endian length of `bundle.json`, `bundle.json`, then `shared_detector.bin`.
    Returns the data, its version, and the last check time; None when the cache is missing or damaged."""
    try:
        checked_at = path.stat().st_mtime
        content = path.read_bytes()
        (length,) = struct.unpack_from("<I", content, 0)
        bundle = json.loads(content[4:4 + length])
        data = _reference_data(bundle, decode_detector(content[4 + length:]))
        return data, bundle["files"][_DETECTOR]["sha256"], checked_at
    except Exception:
        return None


def _write_cache(path: Path, bundle: bytes, detector: bytes) -> None:
    """Best effort: a failed write only means the next load downloads again."""
    staging = path.with_name(f"{path.name}.tmp-{secrets.token_hex(8)}")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        staging.write_bytes(struct.pack("<I", len(bundle)) + bundle + detector)
        os.replace(staging, path)
    except OSError:
        try:
            staging.unlink()
        except OSError:
            pass


def _download(client: httpx.Client, url: str, seconds: float) -> bytes:
    deadline = time.monotonic() + seconds
    with client.stream("GET", url, timeout=seconds) as response:
        if not 200 <= response.status_code < 300:
            raise LmfpdError(f"HTTP {response.status_code}")
        body = bytearray()
        for chunk in response.iter_bytes():
            body += chunk
            if time.monotonic() > deadline:
                raise LmfpdError(f"Timed out after {seconds:g}s.")
        return bytes(body)


def _refresh(sources: Sequence[str], cache: Path, cached_version: str | None = None) -> Data | None:
    """Downloads the data from the first working source and caches it. Returns None when the source still serves
    `cached_version`, after marking the cache as checked."""
    failures = []
    with httpx.Client(follow_redirects=True, trust_env=True) as client:
        for source in sources:
            try:
                bundle_bytes = _download(client, f"{source}bundle.json", 10)
                bundle = json.loads(bundle_bytes)
                if bundle["schema"] != _DATA_SCHEMA or bundle["detector_schema"] != _DETECTOR_SCHEMA:
                    raise LmfpdError(f"data schema {bundle['schema']}/{bundle['detector_schema']} is not supported "
                                     "by this SDK version. Upgrade lmfpd.")
                # The detector's SHA-256 names its version.
                file = bundle["files"][_DETECTOR]
                if file["sha256"] == cached_version:
                    try:
                        os.utime(cache)
                    except OSError:
                        pass
                    return None
                compressed = b"".join(_download(client, f"{source}chunks/{part}", 120) for part in file["parts"])
                detector_bytes = zstandard.ZstdDecompressor().stream_reader(compressed,
                                                                            read_across_frames=True).read()
                data = _reference_data(bundle, decode_detector(detector_bytes))
                _write_cache(cache, bundle_bytes, detector_bytes)
                return data
            except Exception as error:
                failures.append(f"{source} ({str(error) or type(error).__name__})")
    raise LmfpdError(f"lmfpd: cannot download reference data from {', '.join(failures)}")


def load_data(source: str | Sequence[str], cache: str | os.PathLike[str] | None, ttl: float) -> Data:
    """A single source that is not an http(s) URL is a local directory, read as is. For URLs, answers from the cache
    file when there is one (stale-while-revalidate): a cache last checked `ttl` seconds ago or earlier is refreshed
    in the background for the next load. Without a cache it downloads."""
    sources = [source] if isinstance(source, str) else list(source)
    if len(sources) == 1 and not _URL.match(sources[0]):
        return _read_dir(sources[0])
    path = Path(cache) if cache is not None else default_cache()
    cached = _read_cache(path)
    if cached is None:
        # Without a cached version a successful refresh always returns data.
        return cast(Data, _refresh(sources, path))
    data, version, checked_at = cached
    if time.time() - checked_at >= ttl:
        threading.Thread(target=_refresh_quietly, args=(sources, path, version), daemon=True).start()
    return data


def _refresh_quietly(sources: Sequence[str], cache: Path, version: str) -> None:
    try:
        _refresh(sources, cache, version)
    except Exception:
        pass
