# lmfpd-sdk

TypeScript SDK for [lmfpd](https://lm.ikale.io), the language-model fingerprint detector. It scores saved replies to
the number challenge, generates challenges, and runs one live detection round against an OpenAI Responses, Chat
Completions, or Anthropic Messages API. Rust, Go, and Python SDKs with the same results live beside this package.

The results are a closed-set ranking within the reference bank. They are not identity confirmation.

Documentation: https://lm.ikale.io/docs/en/sdk

```sh
npm install lmfpd-sdk   # Node 22+ or Bun 1.4.2+
```

```ts
import { loadDetector } from 'lmfpd-sdk'

const detector = await loadDetector()
const analysis = detector.analyze([
  { text: '17, 203, 88, …', expected_count: 300 },
  { text: '…', expected_count: 311 },
  { text: '…', expected_count: 296 },
])
console.log(analysis.decision, analysis.prediction, analysis.probability)

const result = await detector.detect({ baseUrl: 'https://api.openai.com/v1', apiKey: process.env.API_KEY!, model: 'gpt-5' })
console.log(result.analysis?.prediction ?? result.error)
```

## Reference data

The package contains no reference data. `loadDetector()` downloads the detector (about 3.6 MB compressed) from the
first working source in `DEFAULT_DATA_URLS`:

1. `https://lm.ikale.io/data/`
2. `https://cdn.jsdmirror.com/npm/lmfpd-data@latest/`, a mirror in mainland China

The data is cached in one file, `<OS cache directory>/lmfpd/data.bin` by default (`cache` sets another). A load with
a cache returns at once; when the cache was last checked `ttl` seconds ago or earlier (default 86400; 0 checks on every
load), it also refreshes the cache in the
background for the next load. Without a cache the data is downloaded before `loadDetector` returns. A single `source`
that is not an http(s) URL is a local directory: `loadDetector({ source: './data' })` reads `unified_bank.json` and
`shared_detector.bin` from it without network access.

Bun reads `HTTPS_PROXY` for every request. Node reads it only with `NODE_USE_ENV_PROXY=1`.

## API

| Export | Description |
|---|---|
| `loadDetector({ source?, cache?, ttl? })` | Loads the reference data from URLs through the cache file, or from a local directory. |
| `detector.builtAt` | Build time of the reference bank. |
| `detector.analyze(outputs, { strict? })` | Scores one to three replies. Three valid replies give a calibrated ranking; fewer give a partial ranking unless `strict`. |
| `detector.detect(config, signal?)` | Generates `config.count` challenges, sends them to the model API, and scores the replies. |
| `generateChallenges(count = 3)` | One to three random challenges, each asking for a distinct count from 292 to 332. |
| `parseNumbers(text)` | The numbers 1 to 355 of the longest run in a reply. |
| `buildRequest(config, prompt)` | The URL, headers, and body `detect` sends, or `{ error }`. |
| `requestSample(config, challenge)` | Sends one challenge and returns the checked reply. |
| `DEFAULT_DATA_URLS` | The default data sources. |

`DetectConfig` takes `baseUrl`, `apiKey`, and `model`, plus `api` (`responses`, `chat_completions`, or `messages`),
`effort`, `serviceTier`, `stream` (default true), `strict`, `count` (default 3), `parallel` (default 3), and `timeout`
in seconds (default 120).

`Analysis.decision` is `scored`, `partial`, `unscorable`, or `not_model`. `results` lists the candidates by ranking
score; `probability` is the closed-set probability of the top candidate and is null without three valid replies.
