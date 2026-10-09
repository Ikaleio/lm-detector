<div align="center">

# LM Fingerpoint Detector

**Identify the large language model behind an API from a few hundred first-instinct integers**

[简体中文](./README.md) · English

[![npm](https://img.shields.io/npm/v/lmfpd?logo=npm&label=lmfpd&color=cb3837)](https://www.npmjs.com/package/lmfpd)
[![Web](https://img.shields.io/badge/Web-lm.ikale.io-0ea5e9)](https://lm.ikale.io)
[![Docs](https://img.shields.io/badge/Docs-lm.ikale.io%2Fdocs-6366f1)](https://lm.ikale.io/docs/en)
[![Bun](https://img.shields.io/badge/Bun-1.4.2-000?logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-MIT-22c55e)](./LICENSE)

[Web detector](https://lm.ikale.io) · [Docs](https://lm.ikale.io/docs/en) · [Quick start](#quick-start) · [Command line](https://lm.ikale.io/docs/en/cli) · [How it works](https://lm.ikale.io/docs/en/principles)

</div>

---

## Introduction

An API relay or a third-party provider can claim to serve one model and actually serve another. LM Fingerpoint Detector checks this claim with a task that has no semantic content: the model writes about 300 integers from 1 to 355, each chosen by first instinct. The "random" numbers that a language model writes are not uniform. Each model has relatively stable preferences for values, ranges, and final digits. The detector compares this distribution with a reference bank and ranks the closest candidate models.

- **Two entry points**: the [website](https://lm.ikale.io) accepts pasted answers or calls an API directly. The `fpd` command line tool shows a live terminal interface and supports multiple rounds and JSON output.
- **Three protocols**: OpenAI Responses, Chat Completions, and Anthropic Messages. SSE streaming is the default.
- **Reference bank**: covers common model families such as GPT, Claude, Gemini, Grok, Qwen, and DeepSeek. The library page on the website shows the bank in read-only mode and can export it.
- **Tokenizer probe (optional, off by default)**: turn on “Tokenizer probe” in the API configuration on the website, or add `--tokenizer` on the command line. Detection then sends about 12 more short requests and identifies the upstream tokenizer (the rule a model uses to cut text into tokens) from the token counts in the API `usage`. It checks the tokenizer against the model you entered. The result is reference only: the ranking and the confidence come from the number fingerprint alone and do not wait for the probe. Many models share one tokenizer, so a matching tokenizer does not prove the model identity.
- **Choose the connection**: the default is Auto, which lets the browser call an API directly when it allows web pages to and uses this site's proxy when the browser's cross-origin restriction (CORS) blocks that. You can also always use Direct, this site's proxy, or a Cloudflare Worker you [deploy in one click](https://lm.ikale.io/docs/en/deployment/worker).
- **Traceable data maintenance**: `fpd sample`, `fpd enroll`, and `fpd retrain` collect, enroll, and refit offline. All failures and earlier attempts stay on record.

> [!IMPORTANT]
> A result is a **closed-set ranking within the reference bank**. A model that is not in the bank still gets a "closest" candidate. Ranking scores and confidence values are not proof of identity. To judge whether a channel is trustworthy, fix the request parameters, repeat several rounds, and use other evidence too.

## Quick start

**Website**: open [lm.ikale.io](https://lm.ikale.io) and select the Manual or API mode. Each answer must contain at least 80 valid integers; if all three answers are valid, the page shows the ranking and a confidence value for each candidate. If the tokenizer probe is on in API mode, the page also shows the probe result separately.

**Command line**: no installation is necessary. Run the CLI with either runtime:

```sh
# Node.js 22 or later
npx lmfpd@latest -b https://api.example.com/v1 -k sk-xxx -m gpt-6-astra

# Bun 1.4.2 or later
bunx --bun lmfpd@latest -b https://api.example.com/v1 -k sk-xxx -m gpt-6-astra
```

**Local development**:

```sh
bun install
bun run dev          # Sync data and start the web dev server (includes /api/proxy)
bun run dev:docs     # Start the docs dev server
bun run typecheck    # Type-check the website, CLI, and docs
bun run build        # Build the website and the docs into web/dist
bun run build:cli    # Pack the npm CLI into dist/fpd
bun run fpd --help   # Run the CLI from the repository
```

## Documentation

The full documentation is at [lm.ikale.io/docs/en](https://lm.ikale.io/docs/en), with its sources in [`docs/content/docs/`](./docs/content/docs/):

| Section | Contents |
| --- | --- |
| [Website](https://lm.ikale.io/docs/en/web) | Sampling modes, API configuration, reading results, tokenizer probe, connection modes |
| [Command line](https://lm.ikale.io/docs/en/cli) | Detection, the optional tokenizer probe, sampling and resuming, enrollment and retraining |
| [How it works](https://lm.ikale.io/docs/en/principles) | Challenges and features, ranking, confidence calibration, the tokenizer probe |
| [Deployment](https://lm.ikale.io/docs/en/deployment) | Cloudflare Pages, GitHub Pages, Vercel, a self-deployed Worker proxy |
| [Reference](https://lm.ikale.io/docs/en/reference/data) | Data files and change log, proxy API |
| [Development](https://lm.ikale.io/docs/en/development) | Project structure, design spec, packaging and release |

## Acknowledgements

Thanks to [xqy2006/ModelTrace](https://github.com/xqy2006/ModelTrace) for the algorithmic ideas and part of the original data.

## License

[MIT](./LICENSE)
