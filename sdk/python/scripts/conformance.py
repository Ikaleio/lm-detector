"""Checks the Python SDK against sdk/conformance. Usage: conformance.py <conformance dir> <data dir>"""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from pathlib import Path
from typing import Any

import lmfpd

failures = 0


def dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def compare(file: str, name: str, expected: Any, actual: Any, path: str = "$") -> None:
    """Reports every mismatch. Numbers match within a relative 1e-9; everything else must be identical."""
    global failures

    def fail() -> None:
        global failures
        failures += 1
        print(f"FAIL {file}:{name}: {path} expected {dump(expected)} got {dump(actual)}")

    if is_number(expected) and is_number(actual):
        if not abs(expected - actual) <= 1e-9 * max(1, abs(expected), abs(actual)):
            fail()
    elif isinstance(expected, list) and isinstance(actual, (list, tuple)):
        if len(expected) != len(actual):
            return fail()
        for i, (item, other) in enumerate(zip(expected, actual)):
            compare(file, name, item, other, f"{path}[{i}]")
    elif isinstance(expected, dict) and isinstance(actual, dict):
        if sorted(expected) != sorted(actual):
            return fail()
        for key in sorted(expected):
            compare(file, name, expected[key], actual[key], f"{path}.{key}")
    elif type(expected) is not type(actual) or expected != actual:
        fail()


def serve(cases: list[dict[str, Any]]) -> ThreadingHTTPServer:
    """Serves every POST under `/<case name>/` with that case's canned response."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            item = next((c for c in cases if self.path.startswith(f"/{c['name']}/")), None)
            if item is None:
                return self.reply(404, "text/plain", "not found")
            response = item["response"]
            self.reply(response["status"], response["content_type"], response["body"])

        def do_GET(self) -> None:
            self.reply(404, "text/plain", "not found")

        def reply(self, status: int, content_type: str, body: str) -> None:
            data = body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: conformance.py <conformance dir> <data dir>")
        return 2
    directory, data_dir = Path(sys.argv[1]), sys.argv[2]

    def fixture(name: str) -> Any:
        return json.loads((directory / name).read_text("utf-8"))

    templates = files("lmfpd").joinpath("templates.json").read_bytes()
    if templates != (directory / "templates.json").read_bytes():
        compare("templates.json", "copy", "byte-equal to conformance/templates.json", "different")

    parse = fixture("parse.json")
    for i, item in enumerate(parse):
        compare("parse.json", str(i), item["numbers"], lmfpd.parse_numbers(item["text"]))

    requests = fixture("requests.json")
    for item in requests:
        try:
            actual: Any = lmfpd.build_request(item["config"], item["prompt"])
        except lmfpd.LmfpdError as error:
            actual = {"error": str(error)}
        compare("requests.json", item["name"], item["expected"], actual)

    # The mock server is local; keep any proxy from the environment away from it.
    for variable in ("NO_PROXY", "no_proxy"):
        os.environ[variable] = ",".join(filter(None, ["127.0.0.1", os.environ.get(variable)]))
    streams = fixture("streams.json")["cases"]
    server = serve(streams)
    try:
        port = server.server_address[1]
        for item in streams:
            sample = dict(lmfpd.request_sample({
                "base_url": f"http://127.0.0.1:{port}/{item['name']}", "api_key": "test-key", "model": "test-model",
                "api": item["api"], "stream": item["stream"], "strict": item["strict"], "timeout": 10,
            }, {"id": "conformance", "prompt": "conformance", "expected_count": item["expected_count"]}))
            del sample["expected_count"]
            # Timings vary between runs; the fixture records only whether the first byte was reached.
            if sample["first_byte_ms"] is not None:
                sample["first_byte_ms"] = 0
            compare("streams.json", item["name"], item["expected"], sample)
    finally:
        server.shutdown()
        server.server_close()

    analyze = fixture("analyze.json")
    detector = lmfpd.load(data_dir)
    if detector.built_at != analyze["data"]["built_at"]:
        print("FAIL analyze.json: analyze.json was generated for another data build; run bun run sdk:generate")
        return 1
    for item in analyze["cases"]:
        compare("analyze.json", item["name"], item["expected"], detector.analyze(item["outputs"], item["strict"]))

    if failures:
        return 1
    print(f"ok analyze={len(analyze['cases'])} parse={len(parse)} requests={len(requests)} streams={len(streams)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
