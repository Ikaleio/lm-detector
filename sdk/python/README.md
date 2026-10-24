# lmfpd (Python)

Language-model fingerprint detection: score saved replies against the lmfpd reference bank, generate challenge
prompts, and run one live detection round against an OpenAI- or Anthropic-compatible API.

Documentation: https://lm.ikale.io/docs/en/sdk

## Install and build

```sh
pip install "lmfpd @ git+https://github.com/Ikaleio/lm-detector#subdirectory=sdk/python"
uv build                   # from sdk/python; writes the sdist and wheel to dist/
```

Python 3.10 or newer. Dependencies: `httpx` (with SOCKS support), `zstandard`, and `numpy`.

## Loading reference data

`lmfpd.load(source=DEFAULT_DATA_URLS, cache=None, ttl=86400.0)` is the one entry point.

- **Local directory:** a single `source` that is not an `http://` or `https://` URL is a directory holding
  `unified_bank.json` and `shared_detector.bin` (for example `projects/data`). It is read as is, with no cache and no
  network.
- **URLs:** sources are tried in order: `https://lm.ikale.io/data/`, then the mainland-China mirror
  `https://cdn.jsdmirror.com/npm/lmfpd-data@latest/`. Only `bundle.json` and the detector are downloaded (about
  3.6 MB compressed, 4.5 MB uncompressed). Files are not checksum-verified.
- **Cache:** one file, `cache`, defaulting to `<OS cache dir>/lmfpd/data.bin` (`$XDG_CACHE_HOME`,
  `~/Library/Caches`, `%LOCALAPPDATA%`, or `~/.cache`). Its modification time is the last check against the sources.
  - With a cache, `load()` returns it at once. When the last check is `ttl` seconds old or more (0 checks on every
    load), a background thread
    fetches `bundle.json` and, only if the detector changed, the new detector for the next load. Failures there are
    ignored.
  - Without a cache, or with a damaged one, `load()` downloads before returning and raises
    `lmfpd: cannot download reference data from ...` when every source fails.

HTTP requests honor `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` (including `socks5h://`), and `NO_PROXY`.

## API

Results are plain dicts with the same keys in every lmfpd SDK; `lmfpd.Analysis`, `Sample`, and `DetectResult` are
their `TypedDict`s. Invalid input raises `lmfpd.LmfpdError`.

- `load(source, cache, ttl) -> Detector`: load reference data from URLs (cached) or a local directory.
- `Detector.built_at`: the data build identifier.
- `Detector.analyze(outputs, strict=False) -> Analysis`: score one to three `{"text", "expected_count"}` replies.
- `Detector.detect(base_url, api_key, model, *, api="responses", effort="", service_tier="default", stream=True,
  strict=False, count=3, parallel=3, timeout=120.0) -> DetectResult`: send `count` challenges and score the replies.
  `api` is `responses`, `chat_completions`, or `messages`.
- `generate_challenges(count=3) -> list[Challenge]`: random challenge prompts.
- `parse_numbers(text) -> list[int]`: the numbers 1 to 355 of the longest run in a reply.
- `build_request(config, prompt) -> dict`: the URL, headers, and body `detect` sends for one prompt.
- `request_sample(config, challenge) -> Sample`: send one challenge and check the reply.

`config` dicts use the `detect` keyword names (`base_url`, `api_key`, `model`, `api`, ...).

```python
import lmfpd

detector = lmfpd.load()
result = detector.detect("https://api.openai.com/v1", "sk-...", "gpt-5")
print(result["analysis"]["prediction"] if result["analysis"] else result["error"])
```
