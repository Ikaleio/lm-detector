# lmfpd (Go)

Go SDK for lmfpd, which identifies the language model behind a reply from the numbers it picks. It scores saved replies the same way as `fpd --input --json`, generates challenges, and runs one live detection round against an OpenAI- or Anthropic-compatible API.

Documentation: https://lm.ikale.io/docs/en/sdk

```sh
go get github.com/Ikaleio/lm-detector/sdk/go@latest
```

The module needs Go 1.23 or later. Its only dependency is `github.com/klauspost/compress` (zstd).

## Loading data

```go
d, err := lmfpd.Load(ctx, lmfpd.LoadOptions{})                                  // published data, cached
d, err := lmfpd.Load(ctx, lmfpd.LoadOptions{Sources: []string{"projects/data"}}) // offline, from a directory
```

- No data ships inside the module, so new or retrained models do not need an SDK release.
- `LoadOptions.Sources` lists base URLs, tried in order. The default is `DefaultDataURLs`: `https://lm.ikale.io/data/`, then `https://cdn.jsdmirror.com/npm/lmfpd-data@latest/`.
  - Each source serves `bundle.json`, which carries the model list, and the zstd chunks of `shared_detector.bin`.
  - Only the detector is downloaded: about 3.6 MB compressed, 4.5 MB uncompressed. There is no sha256 check.
- A single source that is not an `http(s)://` URL is a local directory, such as `projects/data` or a `fpd retrain --data-dir` output. `Load` reads its `unified_bank.json` and `shared_detector.bin` as they are, with no cache and no network.
- `LoadOptions.Cache` is the cache file. The default is `<OS cache dir>/lmfpd/data.bin`, where the OS cache dir is `$XDG_CACHE_HOME`, `~/Library/Caches`, `%LOCALAPPDATA%`, or `~/.cache`.
- `Load` serves from the cache (stale-while-revalidate):
  - When a cache file exists, `Load` returns it immediately.
  - If the cache was last checked longer ago than `LoadOptions.TTL` (zero means 24 hours; a negative value checks on every load), a background goroutine fetches `bundle.json` for the next load. It downloads the detector only when it changed. Errors there are ignored.
  - Without a usable cache, `Load` downloads synchronously and fails only when every source fails.

Every HTTP request uses `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY`. Loopback addresses are never proxied.

## API

- `Load(ctx, LoadOptions) (*Detector, error)`: load reference data from the sources or a local directory, using the cache file.
- `(*Detector).BuiltAt() string`: the bank's `built_at`, which identifies the data build.
- `(*Detector).Analyze(outputs []Output, strict bool) (*Analysis, error)`: score 1–3 saved replies. Three valid replies give a calibrated ranking. Fewer give a partial ranking unless `strict` is set.
- `(*Detector).Detect(ctx, DetectConfig) (*DetectResult, error)`: send one round of challenges and score the replies. It returns an error only for an invalid config.
- `GenerateChallenges(count int) ([]Challenge, error)`: generate 1–3 random challenges.
- `ParseNumbers(text string) []int`: return the numbers 1–355 from the longest run in a reply.
- `BuildRequest(DetectConfig, prompt string) (*Request, error)`: return the URL, headers, and body that `Detect` sends.
- `RequestSample(ctx, DetectConfig, Challenge) Sample`: send one challenge and check the reply. Failures are reported in `Sample.Error`.

Zero values in `DetectConfig` select the defaults:

| Field | Default |
|---|---|
| `API` | `APIResponses` |
| `ServiceTier` | `default` |
| `Count` | 3 |
| `Parallel` | 3 |
| `Timeout` | 120 s |

`NoStream` switches from SSE to JSON responses. All result types marshal to the canonical snake_case JSON shared by the TypeScript, Rust, and Python SDKs. Nullable fields are pointers.

```go
res, err := d.Detect(ctx, lmfpd.DetectConfig{BaseURL: "https://api.openai.com/v1", APIKey: key, Model: "gpt-5"})
```

## Conformance

From `sdk/go`:

```sh
go run ./cmd/conformance "$PWD/../conformance" "$PWD/../../data"
```
