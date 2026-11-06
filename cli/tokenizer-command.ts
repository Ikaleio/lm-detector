import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { directTransport } from '@fingerpoint/shared/detection'
import { errorMessage, requestEndpoint } from '@fingerpoint/shared/detect-request'
import { assertTokenizerBank } from '@fingerpoint/shared/tokenizer-bank'
import { probeTokenizer, tokenizerReport } from '@fingerpoint/shared/tokenizer-probe'
import { parseOptions } from './detect-options'
import { readJson, savedProbe } from './detect-run'
import { createTokenizerDisplay, type TokenizerState } from './tokenizer-ui'

const help = `FPD / TOKENIZER DETECTOR

Usage: fpd tokenizer -b URL -k KEY -m MODEL [options]
       fpd tokenizer --input FILE [--json]

Probe a tokenizer directly from input token counts. No number samples are sent.

CONNECTION
  -b, --baseurl URL       Base URL or complete endpoint. Env: BASE_URL.
  -k, --apikey KEY        API key. Env: API_KEY.
  -m, --model MODEL       Requested model and tokenizer claim. Env: MODEL.
  -a, --api TYPE          responses (default), chatcompletion, or message.
                         Prefixes and cc work. --base-url / --api-key work too.
  -e, --effort LEVEL      Optional reasoning effort; omitted for Messages.
  -t, --service-tier TIER flex, default, fast, or ultrafast; prefixes and aliases.
  -ns, --no-stream        Request JSON instead of SSE.

PROBE
  -p, --parallel N        Concurrent probe requests: 1–4. Default: 4.
  --max-probes N         Probe text limit: 4–60. Default: 20.
  --timeout SECONDS     Full request deadline, including SSE. Default: 90.
  --tokenizer-bank FILE  Use a custom tokenizer bank.

OUTPUT
  --input FILE          Recompute saved counts offline. No API calls needed.
  --output FILE         Save a tokenizer report without API credentials.
  --json                Write JSON to stdout instead of the terminal interface.
  -h, --help            Show this help.

Usually about 12 short requests; at most --max-probes + 2 (22 by default).
Two baseline requests check hidden-input stability. Per-request billing applies.
Messages limits output to 16 tokens; the other protocols set no output limit.
Many models share a tokenizer. A match identifies the counting method.
q / Ctrl+C stops the probe and keeps received counts in --output.

Examples (connection options may come from environment variables):
  fpd tokenizer -a cc --output tokenizer.json
  fpd tokenizer --input tokenizer.json --json
  fpd tokenizer --input detection.json -m gpt-5

Exit codes: 0 with a verdict; 1 on a failed request or missing verdict;
130 when cancelled; 143 on SIGTERM. A model-name mismatch is a result, not an error.
`

export async function runTokenizerCommand(args: string[]) {
  let key = process.env.API_KEY ?? ''
  let display: ReturnType<typeof createTokenizerDisplay> | undefined
  const abort = new AbortController()
  const cancel = () => abort.abort()
  const terminate = () => { process.exitCode = 143; abort.abort() }
  try {
    // Parsing errors can include explicit credential flags; redact those too.
    for (let index = 0; index < args.length; index++) {
      const argument = args[index]
      if (['--apikey', '--api-key', '-k'].includes(argument)) key = args[++index] ?? ''
      else if (/^--(apikey|api-key)=/.test(argument)) key = argument.slice(argument.indexOf('=') + 1)
      else if (argument.startsWith('-k') && argument.length > 2) key = argument.slice(2)
    }
    const options = parseOptions(args, process.env, 'tokenizer')
    if (!options) { process.stdout.write(help); return }
    key = options.config.apiKey
    const url = options.input ? undefined : requestEndpoint(options.config)
    const bank = await readJson(options.tokenizerBank ?? fileURLToPath(new URL('../data/tokenizer_bank.json', import.meta.url)))
    assertTokenizerBank(bank)
    let state: TokenizerState = { model: options.config.model, startedAt: Date.now() }
    process.on('SIGINT', cancel)
    process.on('SIGTERM', terminate)
    if (!options.json) display = createTokenizerDisplay(options, bank, state, cancel)
    if (options.input) {
      const data = await readJson(options.input)
      const source = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : undefined
      const saved = savedProbe(source, bank, options.config.model)
      if (!saved) throw new Error('The input file has no tokenizer report. Use a tokenizer report or a detection/web export containing tokenizer.observations.')
      state = { ...state, ...saved }
    } else {
      const run = await probeTokenizer(options.config, bank, {
        url: url!, transport: directTransport, signal: abort.signal,
        concurrency: options.parallel, maximumProbes: options.maxProbes, timeoutMs: options.timeoutMs,
        onUpdate: run => { state = { ...state, run }; display?.update(state) },
      })
      state = { ...state, run }
    }
    state.finishedAt = Date.now()
    display?.update(state)
    if (state.warning && options.json) process.stderr.write(`Warning: ${errorMessage(state.warning, key)}\n`)
    const run = state.run!
    const report = {
      ...tokenizerReport(run, bank, { model: state.model, createdAt: state.startedAt }),
      request: options.input ? undefined : {
        api: options.api, stream: options.config.stream,
        effort: options.config.format === 'anthropic' ? undefined : options.config.effort || undefined,
        service_tier: options.config.serviceTier, parallel: options.parallel,
        max_probes: options.maxProbes, timeout_seconds: options.timeoutMs / 1000,
      },
    }
    const serialized = JSON.stringify(report, (_name, value) => typeof value === 'string' && key ? value.replaceAll(key, '[REDACTED]') : value, 2) + '\n'
    if (options.output) await writeFile(options.output, serialized, { mode: 0o600 })
    if (options.json) process.stdout.write(serialized)
    await display?.finish(options.output)
    display = undefined
    if (abort.signal.aborted) process.exitCode = process.exitCode || 130
    else if (run.error || !run.verdict) process.exitCode = 1
  } catch (error) {
    const message = errorMessage(error, key)
    if (display) await display.finish(undefined, message)
    else process.stderr.write(`Error: ${message}\nUse fpd tokenizer --help for usage.\n`)
    process.exitCode = process.exitCode || 1
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', terminate)
  }
}
