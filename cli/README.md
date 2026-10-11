# FPD CLI

FPD uses Ink for live detection, reference collection, and enrollment. The published package runs with Node.js 22+ or Bun 1.4.2+ and does not require a repository checkout. Detection shows candidate rankings and repeated results; collection shows setup, request progress, saved evidence, and enrollment previews. Compatible terminals display `lm.ikale.io` as a clickable link in the detection header.

The full documentation, in English and Chinese, is at [lm.ikale.io/docs/en/cli](https://lm.ikale.io/docs/en/cli).

## Run from npm

```sh
npx lmfpd@latest --baseurl https://api.example.com/v1 --apikey sk-xxx --model gpt-6-astra
npx lmfpd@latest -b https://api.example.com/v1 -k sk-xxx -m gpt-6-astra -p 3 -n 5
npx lmfpd@latest -b https://api.example.com/v1 -k sk-xxx -m gpt-6-astra --count 1
npx lmfpd@latest --help
```

With Bun and no Node.js installation, use `bunx --bun lmfpd@latest --help`. The runner downloads the package when needed. The package includes the detection algorithms, reference bank, and detector parameters. It requires no repository checkout. The installed executable is named `fpd`.

## Run from source

From the `projects/` directory:

```sh
bun install --frozen-lockfile
bun run fpd --model gpt-5.6-sol --apikey sk-xxx \
  --baseurl https://openrouter.ai/api/v1 -p 3 -n 5
```

The workspace also exposes an `fpd` executable. The help page groups options and includes examples. It adapts to narrow terminals and plain-text output.

You can supply credentials and connection settings through environment variables:

```sh
export API_KEY=sk-xxx
export MODEL=gpt-5.6-sol
export BASE_URL=https://openrouter.ai/api/v1
bun run fpd -p 3 -n 5
```

Explicit flags override environment variables. Credentials do not appear in the interface or saved results.

## Options

| Option | Behavior |
| --- | --- |
| `-m`, `--model` | Requested model. Reads `MODEL` if omitted. |
| `-k`, `--apikey` | API key. Reads `API_KEY` if omitted. |
| `-b`, `--baseurl` | HTTP or HTTPS base URL, or the complete endpoint. Reads `BASE_URL` if omitted. |
| `-a`, `--api` | `responses` (default), `chatcompletion`, or `message`. Any prefix works (for example `resp` or `chat`); `cc` also selects `chatcompletion`. |
| `--count` | Samples requested per round. Integer from 1 to 3. Default: 3. One or two samples produce rankings without confidence scores. |
| `-p`, `--parallel` | Concurrent samples within a round. Integer from 1 to 3. Default: 3, capped at `--count`. Does not change the number of requests. |
| `-n`, `--repeat` | Number of detection rounds. Positive integer. Default: 1. |
| `-s`, `--strict` | Disable automatic truncation. Require `--count 3` and all three complete, valid responses. |
| `-ns`, `--no-stream` | Request JSON instead of SSE. |
| `--timeout` | Timeout in seconds. Default: 120. Fractional seconds are supported. |
| `-e`, `--effort` | Optional provider reasoning effort. Accepts any string, including `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. Omitted from API requests by default. |
| `-t`, `--service-tier` | Service tier: `flex`, `default`, `fast`, or `ultrafast`. Any prefix works. Aliases: `slow` (flex), `f` (fast), `uf` (ultrafast), `priority` (fast), `standard` (default). `default` omits the parameter. |
| `--challenges FILE` | Reuse a JSON array of challenges in every round. Its length must match `--count` (default: 3). |
| `--bank FILE` | Use a custom reference bank. The detector is read from `shared_detector.bin` in the same directory. |
| `--tokenizer` | Run the tokenizer probe. Off by default. Sends about 12 more requests, at most `--max-probes` + 2. The ranking is the same with or without it. |
| `--max-probes` | Probe text limit for the tokenizer probe, 4 to 60. Default: 20. The two baseline requests are extra. Use only with `--tokenizer`. |
| `--tokenizer-bank FILE` | Use a custom tokenizer bank. Use only with `--tokenizer` or `--input`. |
| `--input FILE` | Analyze saved outputs without API requests. |
| `--output FILE` | Save all rounds, request settings, challenges, received text, and results. |
| `--json` | Write machine-readable JSON to stdout. Disable the TUI. |
| `--no-update-check` | Disable background update checks. Also accepts `FPD_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER=1`. |
| `-h`, `--help` | Show help. |

`--base-url` and `--api-key` are accepted as aliases. An origin such as `https://api.example.com` uses `/v1`. A base URL with a path preserves that path and appends the selected endpoint. Messages requests use `x-api-key` and `anthropic-version` headers. Messages sends the service tier as `speed` with the `anthropic-beta: fast-mode-2026-02-01` header; Responses and Chat Completions send it as `service_tier`.

Detection requests omit the optional output token limit for Responses and Chat Completions. Messages requests keep `max_tokens: 8192`, which that API requires.

## Update notifications

Published releases check for updates in the background during interactive detection. The CLI queries npm, [npmmirror](https://github.com/cnpm/cnpm), and Tencent Cloud concurrently with a shared three-second deadline. It selects the highest valid version returned before detection ends or the deadline expires. Slow, unavailable, or outdated mirrors do not prevent another source from supplying an update. Requests contain no model credentials, prompts, or results.

The check never delays detection or waits at exit. If an update is already known when detection finishes, the TUI shows one notice below the results. Otherwise, it cancels the check silently. Network errors do not change the detection result or exit code. The CLI only suggests a command; it does not install updates automatically.

The command follows the detected installer: Bun, npm, pnpm, or Yarn. Global and project installations receive the corresponding update command. Project commands target the installation directory. Temporary runners receive a `bunx`, `npx`, `pnpm dlx`, or `yarn dlx` command pinned to the new version, avoiding a cached `latest` alias. Installation paths and package metadata take precedence over the runtime. If the installer is unknown, the notice offers `bunx` to run the new version.

Results are cached in the operating system's cache directory under `lmfpd/update.json`. If any source succeeds, the result lasts six hours. If all sources fail, the check retries after one hour. Installing another version resets the check. Source runs, prerelease builds, help, offline analysis, JSON output, redirected output, and CI skip update checks.

Use `--no-update-check` or set `FPD_NO_UPDATE_CHECK=1` to disable the feature.

## Sampling behavior

Each round generates `--count` random challenges from the existing shared challenge generator (default: three). Use `--count 1` for one API request per round or `--count 2` for two. `-p 1` only serializes the requests; `-n 1` runs one round. The challenge prompts remain unchanged to preserve the sampling method. The CLI interface, help, and local error messages use English.

For a fixed single challenge, use `--count 1 --challenges one-challenge.json`; the file must contain a one-element array with `id`, `prompt`, and `expected_count`. A mismatched array length is rejected before any model requests.

The default relaxed mode stops a streaming sample after it receives the requested number of complete integers. The interface marks it **Capped**. JSON responses with excess numbers are trimmed after receipt. The raw text received before cancellation remains in the saved sample record. Incomplete final integer tokens do not trigger truncation.

A naturally completed sample must contain at least `max(80, ceil(expected_count * 0.55))` valid numbers, matching the existing scorer. A refusal, provider error, or unfinished response is rejected unless relaxed mode already stopped it at the requested count.

Relaxed mode can rank one or two valid samples, including when that is the requested count. Partial rankings have no confidence scores; confidence calibration requires three valid samples. Strict mode requires `--count 3`, disables the client count limit, waits for complete responses, and skips scoring unless all three samples succeed. Combining `--strict` with `--count 1` or `--count 2` is rejected before any model requests. Provider token limits still apply. Failed samples remain visible and are preserved in saved results.

All requested samples must settle before the next round starts, including failed requests. Each round uses its own concurrency limit, capped at the sample count. The CLI does not retry requests automatically. A failed round does not prevent later rounds from running.

The timeout starts when each request is dispatched. For SSE, the first nonempty response-body chunk clears the timer, including a heartbeat or metadata event. Response headers alone do not clear it. No client deadline or Bun idle timeout remains after SSE starts. For JSON, the entire response must arrive before the deadline.

Use `q` or `Ctrl+C` to cancel active requests and prevent queued requests and later rounds from starting. With `--output`, received samples are saved on cancellation. If a tokenizer probe is still running after the last round, the same keys stop only the probe, and all results stay. Redirected output contains a static report; progress goes to stderr, including each round's leading candidate as soon as the round is scored. `--json` keeps stdout free of interface output.

## Results and offline use

```sh
bun run fpd --output result.json
bun run fpd --input result.json
bun run fpd --input result.json --strict --json
```

The input can be a saved report, a report with `outputs`, an array of one to three `{ "text": "...", "expected_count": 300 }` objects, or a collection `result.json`. Collection samples are grouped by condition into rounds of up to three answers. Reports with several rounds are analyzed one round at a time. Strict replay rejects recorded truncation and unknown collection completion. Offline analysis of a plain output array cannot verify its original network completion status.

`--count` applies only to online detection and cannot be combined with `--input`; offline rounds use the saved outputs. Online reports include the requested count as `request.count` and the effective concurrency as `request.parallel`.

The TUI shows the latest ranking and recent round summaries. After at least one scored round, a dimmed final line links the GitHub repository. JSON retains every round. The most frequent candidate counts round winners; it is not a combined probability. Confidence is relative to models in the reference bank and does not establish the upstream model's identity. If a custom bank does not match its detector, detection stops with an error; run `fpd retrain --data-dir DIR` for that bank.

Exit codes: `0` when all requested rounds produce a ranking, `1` for invalid input or any unscored round, `130` after cancellation (including a tokenizer probe stopped after the last round), and `143` after SIGTERM. A partial ranking is a successful relaxed-mode result.

## Tokenizer probe

```sh
# Detect and run the tokenizer probe
npx lmfpd@latest -b https://api.example.com/v1 -k sk-xxx -m deepseek-v4-pro -a cc --tokenizer
# Read a saved probe again offline; no requests and no --tokenizer
npx lmfpd@latest --input result.json --json
```

The tokenizer probe is off by default. With `--tokenizer`, the CLI sends short requests beside the first round and reads the input token count from the usage of each response. A probe usually sends about 12 requests and at most `--max-probes` + 2 (22 by default). APIs that bill per request bill these requests. If `--parallel` is above 1, four requests run at a time. Otherwise, one request runs at a time. Each request has a 90-second deadline. Messages requests limit the output to 16 tokens. The other protocols set no output limit, like sample requests.

Each request puts a short probe text between a fixed prefix and suffix (the wrapper). A baseline request sends only the wrapper. The difference between the two counts removes hidden input, such as a system prompt. The CLI selects probe texts in batches to separate the tokenizer classes that are still possible. A class groups open tokenizers that give almost the same counts. The probe stops when one class, or an unlisted tokenizer, gets 99% posterior probability. A second baseline request then checks that the hidden input did not change.

The tokenizer result is reference only. Each round is scored from the number fingerprint alone when its samples finish. The probe does not change the candidates, their order, or the confidence. The TUI shows the probe in a `TOKENIZER PROBE` block below the ranking: the tokenizer class, its lab, and the check against `--model`. A match shows only that the tokenizer is the same, because many models share one tokenizer. Relays that estimate usage with tiktoken give o200k_base or cl100k_base counts. If the probe is still running after the last round, the status line shows `Ranking final · tokenizer probe running`. The CLI waits for the probe before it exits, so the report contains it. `q` or `Ctrl+C` stops the probe and keeps the results.

With `--tokenizer`, `--output` and `--json` add a `tokenizer` object with each probe request and count, without credentials. Each round's `analysis` does not change. `--input` reads a saved probe without requests and recomputes it with the current tokenizer bank. `-m` or `MODEL` replaces the saved model name for the check. If the current bank does not contain a probe text, the CLI skips its count and shows a warning. If the probe stops partway, the verdict uses the counts received before the stop. If the API reports no usage, the baseline request fails, or no probe text gets an answer, there is no tokenizer result. Probe failures do not change the exit code.

## Reference collection and enrollment

```sh
fpd sample
fpd sample --resume ./my-run --max-attempts 5
fpd enroll ./my-run --data-dir ./reference-data --dry-run
fpd enroll ./my-run --data-dir ./reference-data
fpd retrain --data-dir ./reference-data
```

`fpd sample` opens a focused setup wizard when required fields are missing in an interactive terminal. It masks keys, previews requests before sending, and displays live progress. Fully specified flags work without a terminal; `--json` writes only the final report to stdout. Credentials can come from `API_KEY`, `MODEL`, and `BASE_URL`.

Collection uses the fixed 36-challenge suite, not detection's random one-to-three-challenge rounds. `--count` chooses a smaller fixed plan. `--parallel` defaults to 3; `--max-attempts` defaults to 3 cumulative attempts per challenge. `q` or Ctrl+C saves interrupted evidence. Resume skips selected challenges and never changes batch model, channel, or request settings.

Declare `--label`, `--family`, `--family-name`, `--channel`, and one or more `--response-model` values. Subscription channels must end with `-subscription`; use `codex-subscription` for local Codex login or `kimi-code-subscription` for Kimi Code. `--subscription` enforces the suffix for another subscription route. Billing/account details are not stored. OpenRouter fixed routes such as `openrouter/anthropic` pin `provider.only` and disable fallback. Reported provider metadata is retained separately from the requested channel.

Fixed OpenRouter routes check the reported provider against the route's provider component, ignoring case and punctuation. A mismatch is retained as a failed attempt and stops collection. Missing provider metadata stays unknown, not copied from the requested route.

Prompt refinement and explicit adoption retain the original attempts:

```sh
fpd sample --resume ./my-run --max-attempts 5 \
  --challenge query-07 --prompt-file ./prompt.txt --note 'Rephrased after a refusal'
fpd sample --resume ./my-run --adopt query-07:3 --take 300 \
  --note 'Retain the first 300 integers after repeated output'
```

Refinement is only allowed for a challenge without a selected answer. Use a new batch to resample an already accepted challenge. `--take` selects the first N valid integers from saved evidence without an API call. The selected text and note do not overwrite the raw attempt or change its recorded completion status. Enrollment still checks the number threshold and allowed response model.

In this repository, output defaults to `runs/`; elsewhere it defaults to `./fpd-runs/`. Repository discovery starts at the working directory, supports its child `projects/` layout, and never uses the installation directory. Interactive enrollment can select the repository's `data/`; outside the repository or without a terminal, specify `--data-dir`. The destination must be an existing directory; an empty one can start a separate bank. An explicit invalid destination fails without fallback. `--dry-run` validates without writing reference data. Confirmation defaults to no; `--yes` requires an explicit destination.

An interrupted enrollment is validated during preview without applying it. Confirmed enrollment completes the prepared transaction before importing new samples. Unexpected changes outside that transaction are never overwritten.

Reference JSONL contains one version-1 batch per line, with shared metadata and a `samples` array. Old row and collection-manifest formats are rejected. Enrollment rebuilds the chosen bank but does not silently retrain its detector; detection with that bank fails until the detector is retrained. Run `fpd retrain --data-dir DIR` after enrollment to fit and export a matching ranker and confidence calibration. The command requires `uv` and Python with the pinned numerical dependencies; it does not call a model API or use holdout data. It stores fit evidence and the previous detector under `DIR/.training/`, then replaces `DIR/shared_detector.bin` only after nested calibration validation passes. Failed fitting or validation leaves the previous detector intact. The package's bundled bank stays read-only. See [Sampling and resuming](https://lm.ikale.io/docs/en/cli/sampling) and [Enrollment and retraining](https://lm.ikale.io/docs/en/cli/enroll) for the full workflow.

## Package builds and automatic publication

`bun run build:cli` creates `dist/fpd/`. It bundles CLI commands, the fixed collection suite, shared algorithms, the bank worker, and product-local offline fitting modules. It copies the public reference bank and detector parameters and pins installed runtime dependency versions. Raw collection records are not packaged. Sampling and enrollment work under Node or Bun outside the checkout; offline retraining additionally requires `uv` and Python.

The `Publish FPD CLI` workflow runs on `main` when CLI, shared algorithms, reference data, dependencies, or release configuration change. It also supports manual dispatch. Each build uses `0.0.<Unix time in milliseconds>` as its version and publishes the `latest` tag. No manual version bump or Git tag is required. Release jobs run sequentially, verify a clean installation outside the checkout, and check the npm tag after publishing.

The workflow uses npm trusted publishing with GitHub OIDC. Initial setup requires an npm account with permission to publish `lmfpd`:

```sh
npm login
bun run build:cli
cd dist/fpd
npm publish --access public --tag latest
npm trust github lmfpd --repo Ikaleio/lm-detector \
  --file publish-cli.yml --allow-publish --yes
```

The trusted publisher must allow direct `npm publish`. After setup, GitHub Actions needs no stored npm token. Dispatch the workflow once to verify this authorization before relying on automatic releases.
