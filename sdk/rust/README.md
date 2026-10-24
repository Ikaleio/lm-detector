# lmfpd (Rust)

Language-model fingerprint detection: offline scoring of saved replies, challenge generation, and one-round live
detection. Native port of the TypeScript SDK; results match it within 1e-9 (see `sdk/conformance`).

Documentation: https://lm.ikale.io/docs/en/sdk

## Build

```sh
cargo add lmfpd --git https://github.com/Ikaleio/lm-detector   # in your project
cargo build --release                                         # in sdk/rust
# conformance check, from projects/
cargo run --release --manifest-path sdk/rust/Cargo.toml --example conformance -- "$PWD/sdk/conformance" "$PWD/data"
```

Every call is blocking.

## Loading data

`Detector::load(&LoadOptions)` is the only entry point. `LoadOptions` has three fields:

- `sources: Vec<String>`, default `DEFAULT_DATA_URLS`. The defaults are `https://lm.ikale.io/data/`, then the
  mainland-China mirror `https://cdn.jsdmirror.com/npm/lmfpd-data@latest/`, tried in order. A single source that is
  not an `http(s)://` URL is a local directory holding `unified_bank.json` and `shared_detector.bin`, such as
  `projects/data` or a `fpd retrain --data-dir` output. A local directory is read as is, with no cache and no network.
- `cache: PathBuf`, default `<OS cache dir>/lmfpd/data.bin`. The OS cache dir is `$XDG_CACHE_HOME`,
  `~/Library/Caches`, `%LOCALAPPDATA%`, or `~/.cache`. The cache is one file holding `bundle.json` and the detector.
  Its modification time records the last check.
- `ttl: f64`, default 86400. Seconds after a check before the cache is refreshed in the background; 0 checks on every
  load.

For URL sources, loading is stale-while-revalidate:

- **No cache file (or an unreadable one):** the SDK downloads `bundle.json` (10 s timeout) and the detector from the
  first working source, writes the cache, and returns. `bundle.json` carries the bank metadata, so the only large
  download is the detector: about 3.6 MB compressed, 4.5 MB uncompressed, 120 s timeout per chunk. Downloads are not
  sha256-checked.
- **A cache file exists:** it is returned at once. If it was last checked `ttl` seconds ago or earlier, a background
  thread fetches `bundle.json` for the next load. If the detector is unchanged, the thread only marks the cache as checked.
  Otherwise it downloads the new detector into the cache. Background errors are ignored.

HTTP requests, both data downloads and model calls, use the proxy from `ALL_PROXY`, `HTTPS_PROXY`, or `HTTP_PROXY`
and honor `NO_PROXY`.

## API

- `Detector::load(&LoadOptions) -> Result<Detector, Error>`: loads from URLs (cached) or a local directory, as
  described above.
- `Detector::built_at(&self) -> &str`: the data build identifier.
- `Detector::analyze(&self, &[Output], strict) -> Result<Analysis, Error>`: scores one to three saved replies.
- `Detector::detect(&self, &DetectConfig) -> Result<DetectResult, Error>`: sends one round of challenges and scores
  the replies. It errors only on an invalid config.
- `generate_challenges(count) -> Result<Vec<Challenge>, Error>`: returns 1 to 3 random prompts asking for 292 to 332
  numbers.
- `parse_numbers(&str) -> Vec<u32>`: returns the numbers 1 to 355 in the longest run of a reply.
- `build_request(&DetectConfig, prompt) -> Result<Request, Error>`: returns the URL, headers, and JSON body that
  `detect` sends.
- `request_sample(&DetectConfig, &Challenge) -> Sample`: sends one challenge. Failures are reported in
  `Sample::error`.
- `DetectConfig::new(base_url, api_key, model)`: defaults are the Responses API, streaming, relaxed mode, count 3,
  parallel 3, and a 120 s timeout.

Every output type implements `Serialize` with the same snake_case JSON shape as the TS, Go, and Python SDKs.
