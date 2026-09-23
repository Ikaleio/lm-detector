# FPD detection CLI

FPD uses Ink to show live sample progress, candidate rankings, and repeated detection results. It runs with Bun and does not require the website. The title is `FPD / MODEL FINGERPOINT DETECTOR (lm.ikale.io)`. Compatible terminals display `lm.ikale.io` as a clickable link; other terminals display plain text.

## Run from npm

```sh
bunx lmfpd@latest --baseurl https://api.example.com/v1 --apikey sk-xxx --model gpt-6-astra
bunx lmfpd@latest -b https://api.example.com/v1 -k sk-xxx -m gpt-6-astra -p 3 -n 5
bunx lmfpd@latest --help
```

Bun downloads the package when needed. The package includes the detection algorithms, reference bank, and verifier. It requires no repository checkout. The installed executable is named `fpd`.

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

The input can be a saved report, a legacy report with `outputs`, or an array of one to three `{ "text": "...", "expected_count": 300 }` objects. Reports with several rounds are analyzed one round at a time. Strict replay rejects samples marked as truncated in saved reports. Offline analysis validates the saved text; it cannot verify the original network completion status of a plain output array.

The TUI shows the latest ranking and recent round summaries. JSON retains every round. The most frequent candidate counts round winners; it is not a combined probability. Confidence is relative to models in the reference bank and does not establish the upstream model's identity. An incompatible custom bank uses the existing legacy ranker without confidence scores.

Exit codes: `0` when all requested rounds produce a ranking, `1` for invalid input or any unscored round, `130` after cancellation, and `143` after SIGTERM. A partial ranking is a successful relaxed-mode result.

## Legacy detection, sampling, and enrollment

The previous detection command remains available as `bun run detect:legacy`. It retains its original options, including local Codex login and request traces:

```sh
bun run detect:legacy --codex --model gpt-6-astra --effort low \
  --trace-dir /tmp/codex-probe --output result.json
```

The existing `bun run sample` and `bun run enroll` commands are unchanged. Sampling retains every attempt and supports resumption. Enrollment validates metadata and provenance before updating the bank. See [WORKFLOW.md](WORKFLOW.md) for the existing workflow.

## Package builds and automatic publication

`bun run build:cli` creates `dist/fpd/`. It bundles local CLI and algorithm code, copies the public reference bank and verifier, and pins the installed runtime dependency versions. Only the executable, derived data, README, license, and package manifest enter the npm archive. The enrollment CLI and raw collection records remain in the repository.

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
