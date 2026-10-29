import { completionBody } from './completion-request'
import type { CompletionTransport } from './detection'
import { wrapProbe, type TokenizerBank } from './tokenizer-bank'
import {
  nextProbes, probingDone, tokenizerPosterior, tokenizerVerdict, TOKENIZER_MODEL,
  type TokenizerObservation, type TokenizerPosterior, type TokenizerVerdict,
} from './tokenizer-posterior'
import { readUsage } from './tokenizer-usage'
import type { ApiConfig, CodedError, ErrorCode } from './types'

/** Messages requires an output limit; the other protocols omit it like the detection requests do. */
export const PROBE_OUTPUT_TOKENS = 16
export const PROBE_TIMEOUT_MS = 90_000

export interface ProbeStep {
  /** Probe id, or null for the baseline. */
  probe: string | null
  state: 'requesting' | 'done' | 'failed'
  tokens?: number
  responseModel?: string
  error?: string
  errorCode?: ErrorCode
  httpStatus?: number
}
export interface TokenizerRun {
  steps: ProbeStep[]
  observations: TokenizerObservation[]
  posterior: TokenizerPosterior | null
  verdict: TokenizerVerdict | null
  /** The two baselines disagree, so the upstream adds a varying amount of hidden input. */
  baselineDrift: boolean
  error?: CodedError
}
export interface ProbeOptions {
  /** Complete endpoint URL. The web app allows HTTPS only; the CLI also accepts HTTP. */
  url: string
  transport: CompletionTransport
  signal?: AbortSignal
  /** Requests in flight at once. */
  concurrency?: number
  maximumProbes?: number
  timeoutMs?: number
  onUpdate?: (run: TokenizerRun) => void
}

const coded = (message: string, code: ErrorCode, extra?: Partial<CodedError>): CodedError => Object.assign(new Error(message), { code }, extra)

/**
 * The saved probe of a detection, shared by the CLI (`--output`, `--input`) and the web export. `observations` alone
 * is enough to recompute the posterior against a newer bank; `model` is the claim the verdict was checked against.
 * The API key never enters the report.
 */
export function tokenizerReport(run: TokenizerRun, bank: TokenizerBank, meta: { createdAt: number; model: string }) {
  return {
    schema: 'fpd-tokenizer-v1', created_at: new Date(meta.createdAt).toISOString(), model: meta.model || undefined,
    bank: { generated_at: bank.generated_at, classes: bank.classes.length, probes: bank.probes.length, archive_manifest_sha256: bank.source.archive_manifest_sha256 },
    cancelled: run.error?.code === 'aborted',
    error: run.error ? { code: run.error.code, message: run.error.message, http_status: run.error.httpStatus } : undefined,
    baseline_drift: run.baselineDrift, steps: run.steps, observations: run.observations, verdict: run.verdict,
    unknown: run.posterior?.unknown, labs: run.posterior?.labs.slice(0, 5), classes: run.posterior?.classes.slice(0, 10),
  }
}

export function probeBody(config: ApiConfig, bank: TokenizerBank, text: string) {
  const body = completionBody({ ...config, effort: config.format === 'anthropic' ? '' : config.effort }, wrapProbe(bank, text))
  if (config.format === 'anthropic') body.max_tokens = PROBE_OUTPUT_TOKENS
  else delete body[config.format === 'responses' ? 'max_output_tokens' : 'max_tokens']
  if (config.format === 'openai' && body.stream) body.stream_options = { include_usage: true }
  return body
}

function failure(error: unknown, signal: AbortSignal | undefined, timeout: AbortSignal, timeoutMs: number, key: string): CodedError {
  if (signal?.aborted) return coded('The probe request was stopped.', 'aborted')
  if (timeout.aborted) return coded(`The API did not answer within ${timeoutMs / 1000} seconds.`, 'timeout')
  if (error instanceof TypeError) return coded('Cannot connect to the API. Check the base URL and the network.', 'network')
  const known = error instanceof Error ? error as CodedError : coded(String(error), 'network')
  if (key) known.message = known.message.replaceAll(key, '[REDACTED]')
  return known
}

/**
 * Sends the baseline and adaptively chosen probes until the posterior settles, then repeats the baseline
 * once to check that the hidden input is stable. Stops at the first failed request and returns the
 * partial run with `error` set.
 */
export async function probeTokenizer(config: ApiConfig, bank: TokenizerBank, options: ProbeOptions): Promise<TokenizerRun> {
  if (config.format === 'gemini') throw new Error('The tokenizer probe does not support Gemini.')
  const concurrency = Math.max(1, options.concurrency ?? 4)
  const maximum = options.maximumProbes ?? TOKENIZER_MODEL.maximumProbes
  const run: TokenizerRun = { steps: [], observations: [], posterior: null, verdict: null, baselineDrift: false }
  const texts = new Map(bank.probes.map(probe => [probe.id, probe.text]))
  const asked = new Set<string>()
  const emit = () => options.onUpdate?.({ ...run, steps: run.steps.map(step => ({ ...step })), observations: [...run.observations] })

  async function ask(probe: string | null) {
    const text = probe === null ? '' : texts.get(probe)
    if (text === undefined) throw new Error(`Probe text ${probe} is not in the tokenizer bank.`)
    const step: ProbeStep = { probe, state: 'requesting' }
    run.steps.push(step)
    if (probe !== null) asked.add(probe)
    emit()
    const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    try {
      const body = probeBody(config, bank, text)
      const usage = await readUsage(await options.transport(options.url, config, body, signal), config.format)
      Object.assign(step, { state: 'done', tokens: usage.inputTokens, responseModel: usage.responseModel })
      run.observations.push({ probe, tokens: usage.inputTokens, responseModel: usage.responseModel })
      run.posterior = tokenizerPosterior(bank, run.observations)
    } catch (error) {
      const reason = failure(error, options.signal, timeout, timeoutMs, config.apiKey)
      Object.assign(step, { state: 'failed', error: reason.message, errorCode: reason.code, httpStatus: reason.httpStatus })
      run.error ??= reason
    }
    emit()
  }
  const batch = async (probes: (string | null)[]) => { await Promise.all(probes.map(ask)); return !run.error }

  if (await batch([null, ...nextProbes(bank, null, asked, Math.min(concurrency - 1, maximum))])) {
    while (run.posterior && !probingDone(run.posterior, maximum)) {
      const next = nextProbes(bank, run.posterior, asked, Math.min(concurrency, maximum - run.posterior.answered))
      if (!next.length || !await batch(next)) break
    }
    if (!run.error && await batch([null])) {
      const baselines = run.observations.filter(observation => observation.probe === null).map(observation => observation.tokens)
      run.baselineDrift = new Set(baselines).size > 1
    }
  }
  if (run.posterior && run.posterior.answered > 0) run.verdict = tokenizerVerdict(bank, run.posterior, config.model)
  emit()
  return run
}
