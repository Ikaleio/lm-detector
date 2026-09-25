# FPD CLI

FPD uses Ink for live detection, reference collection, and enrollment. The published package runs with Node.js 22+ or Bun 1.4.2+ and does not require a repository checkout. Detection shows candidate rankings and repeated results; collection shows setup, request progress, saved evidence, and enrollment previews. Compatible terminals display `lm.ikale.io` as a clickable link in the detection header.

## Run from npm

```sh
npx lmfpd@latest --baseurl https://api.example.com/v1 --apikey sk-xxx --model gpt-6-astra
npx lmfpd@latest -b https://api.example.com/v1 -k sk-xxx -m gpt-6-astra -p 3 -n 5
npx lmfpd@latest --help
```

With Bun and no Node.js installation, use `bunx --bun lmfpd@latest --help`. The runner downloads the package when needed. The package includes the detection algorithms, reference bank, and verifier. It requires no repository checkout. The installed executable is named `fpd`.

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
| `-p`, `--parallel` | Concurrent samples within a round. Integer from 1 to 3. Default: 3. |
| `-n`, `--repeat` | Number of detection rounds. Positive integer. Default: 1. |
| `-s`, `--strict` | Disable automatic truncation. Require all three complete, valid responses. |
| `-ns`, `--no-stream` | Request JSON instead of SSE. |
| `--timeout` | Timeout in seconds. Default: 120. Fractional seconds are supported. |
| `-e`, `--effort` | Optional provider reasoning effort. Accepts any string, including `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. Omitted from API requests by default. |
| `--challenges FILE` | Reuse a JSON array of three challenges in every round. |
| `--bank FILE` | Use a custom reference bank. |
| `--input FILE` | Analyze saved outputs without API requests. |
| `--output FILE` | Save all rounds, request settings, challenges, received text, and results. |
| `--json` | Write machine-readable JSON to stdout. Disable the TUI. |
| `--no-update-check` | Disable background update checks. Also accepts `FPD_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER=1`. |
| `-h`, `--help` | Show help. |

`--base-url` and `--api-key` are accepted as aliases. An origin such as `https://api.example.com` uses `/v1`. A base URL with a path preserves that path and appends the selected endpoint. Messages requests use `x-api-key` and `anthropic-version` headers.

Detection requests omit the optional output token limit for Responses and Chat Completions. Messages requests keep `max_tokens: 8192`, which that API requires.

## Update notifications

Published releases check for updates in the background during interactive detection. The CLI queries npm, [npmmirror](https://github.com/cnpm/cnpm), and Tencent Cloud concurrently with a shared three-second deadline. It selects the highest valid version returned before detection ends or the deadline expires. Slow, unavailable, or outdated mirrors do not prevent another source from supplying an update. Requests contain no model credentials, prompts, or results.

The check never delays detection or waits at exit. If an update is already known when detection finishes, the TUI shows one notice below the results. Otherwise, it cancels the check silently. Network errors do not change the detection result or exit code. The CLI only suggests a command; it does not install updates automatically.

The command follows the detected installer: Bun, npm, pnpm, or Yarn. Global and project installations receive the corresponding update command. Project commands target the installation directory. Temporary runners receive a `bunx`, `npx`, `pnpm dlx`, or `yarn dlx` command pinned to the new version, avoiding a cached `latest` alias. Installation paths and package metadata take precedence over the runtime. If the installer is unknown, the notice offers `bunx` to run the new version.

Results are cached in the operating system's cache directory under `lmfpd/update.json`. If any source succeeds, the result lasts six hours. If all sources fail, the check retries after one hour. Installing another version resets the check. Source runs, prerelease builds, help, offline analysis, JSON output, redirected output, and CI skip update checks.

Use `--no-update-check` or set `FPD_NO_UPDATE_CHECK=1` to disable the feature.

## Sampling behavior

Each round generates three random challenges from the existing shared challenge generator. The challenge prompts remain unchanged to preserve the sampling method. The CLI interface, help, and local error messages use English.

The default relaxed mode stops a streaming sample after it receives the requested number of complete integers. The interface marks it **Capped**. JSON responses with excess numbers are trimmed after receipt. The raw text received before cancellation remains in the saved sample record. Incomplete final integer tokens do not trigger truncation.

A naturally completed sample must contain at least `max(80, ceil(expected_count * 0.55))` valid numbers, matching the existing scorer. A refusal, provider error, or unfinished response is rejected unless relaxed mode already stopped it at the requested count.

Relaxed mode can rank one or two valid samples. Partial rankings have no confidence scores. Strict mode disables the client count limit, waits for complete responses, and skips scoring unless all three samples succeed. Provider token limits still apply. Failed samples remain visible and are preserved in saved results.

All three requests must settle before the next round starts, including failed requests. Each round uses its own concurrency limit. The CLI does not retry requests automatically. A failed round does not prevent later rounds from running.

The timeout starts when each request is dispatched. For SSE, the first nonempty response-body chunk clears the timer, including a heartbeat or metadata event. Response headers alone do not clear it. No client deadline or Bun idle timeout remains after SSE starts. For JSON, the entire response must arrive before the deadline.

Use `q` or `Ctrl+C` to cancel active requests and prevent queued requests and later rounds from starting. With `--output`, received samples are saved on cancellation. Redirected output contains a static report; progress goes to stderr. `--json` keeps stdout free of interface output.

## Results and offline use

```sh
bun run fpd --output result.json
bun run fpd --input result.json
bun run fpd --input result.json --strict --json
```

The input can be a saved report, a report with `outputs`, an array of one to three `{ "text": "...", "expected_count": 300 }` objects, or a collection `result.json`. Collection samples are grouped by condition into rounds of up to three answers. Reports with several rounds are analyzed one round at a time. Strict replay rejects recorded truncation and unknown collection completion. Offline analysis of a plain output array cannot verify its original network completion status.

The TUI shows the latest ranking and recent round summaries. JSON retains every round. The most frequent candidate counts round winners; it is not a combined probability. Confidence is relative to models in the reference bank and does not establish the upstream model's identity. An incompatible custom bank uses the existing legacy ranker without confidence scores.

Exit codes: `0` when all requested rounds produce a ranking, `1` for invalid input or any unscored round, `130` after cancellation, and `143` after SIGTERM. A partial ranking is a successful relaxed-mode result.

## Reference collection and enrollment

```sh
fpd sample
fpd sample --resume ./my-run --max-attempts 5
fpd enroll ./my-run --data-dir ./reference-data --dry-run
fpd enroll ./my-run --data-dir ./reference-data
fpd retrain --data-dir ./reference-data
```

`fpd sample` opens a focused setup wizard when required fields are missing in an interactive terminal. It masks keys, previews requests before sending, and displays live progress. Fully specified flags work without a terminal; `--json` writes only the final report to stdout. Credentials can come from `API_KEY`, `MODEL`, and `BASE_URL`.

Collection uses the fixed 36-challenge suite, not detection's random three-challenge rounds. `--count` chooses a smaller fixed plan. `--parallel` defaults to 3; `--max-attempts` defaults to 3 cumulative attempts per challenge. `q` or Ctrl+C saves interrupted evidence. Resume skips selected challenges and never changes batch model, channel, or request settings.

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

Reference JSONL contains one version-1 batch per line, with shared metadata and a `samples` array. Old row and collection-manifest formats are rejected. Enrollment rebuilds the chosen bank but does not silently retrain its verifier. Run `fpd retrain --data-dir DIR` after enrollment to fit and export a matching verifier and confidence calibration. The command requires `uv` and Python with the pinned numerical dependencies; it does not call a model API or use holdout data. It stores fit evidence and the previous detector under `DIR/.training/`, then replaces `DIR/shared_detector.json` only after nested calibration validation passes. Failed fitting or validation leaves the previous detector intact. The package's bundled bank stays read-only. See [WORKFLOW.md](WORKFLOW.md) for the full workflow.

The previous detection interface remains available in the repository as `bun run detect:legacy`.

## Package builds and automatic publication

`bun run build:cli` creates `dist/fpd/`. It bundles CLI commands, the fixed collection suite, shared algorithms, the bank worker, and product-local offline fitting modules. It copies the public reference bank and verifier and pins installed runtime dependency versions. Raw collection records are not packaged. Sampling and enrollment work under Node or Bun outside the checkout; offline retraining additionally requires `uv` and Python.

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
