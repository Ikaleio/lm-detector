import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateChallenges } from '@fingerpoint/shared/challenge-browser.js'
import { decodeDetector } from '@fingerpoint/shared/detector-codec'
import { directTransport } from '@fingerpoint/shared/detection'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import { analyzeSharedOutputs, type SharedDetector } from '@fingerpoint/shared/shared-detector'
import type { TokenizerBank } from '@fingerpoint/shared/tokenizer-bank'
import { tokenizerPosterior, tokenizerVerdict, type TokenizerObservation } from '@fingerpoint/shared/tokenizer-posterior'
import { probeTokenizer, tokenizerReport, type TokenizerRun } from '@fingerpoint/shared/tokenizer-probe'
import type { Analysis, Bank, Challenge, Output } from '@fingerpoint/shared/types'
import { requestEndpoint, type DetectOptions } from './detect-options'
import { acceptedSample, minimumNumbers, requestSample, type Sample } from './detect-request'

export interface Round {
  index: number
  challenges: Challenge[]
  samples: Sample[]
  outputs: Output[]
  startedAt: number
  finishedAt?: number
  analysis?: Analysis
  error?: string
}
export interface DetectionState {
  rounds: Round[]
  total: number
  startedAt: number
  finishedAt?: number
  /** When the last round settled. The run may still be waiting for the tokenizer probe until `finishedAt`. */
  roundsFinishedAt?: number
  /** Cancelled before every round settled; stopping only the trailing tokenizer probe keeps this false. */
  cancelled: boolean
  /**
   * The tokenizer probe of the run, shown as reference information beside the ranking. Present only with --tokenizer
   * or with an --input file that saved a probe. It never changes the ranking.
   */
  tokenizer?: TokenizerRun
  /** False while the probe is still running. */
  tokenizerSettled?: boolean
  /** The claimed model the verdict was checked against. */
  tokenizerModel?: string
  /** Why a saved probe was only partly used or not used against the current tokenizer bank. */
  tokenizerWarning?: string
}

export async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch {
    throw new Error(`Cannot read valid JSON from ${path}.`)
  }
}

/**
 * The detector stored beside the bank: the packaged one by default, or the one `fpd retrain --data-dir DIR` writes
 * next to a custom `DIR/unified_bank.json`. The website decodes the same file.
 */
export async function readDetector(bankPath?: string): Promise<SharedDetector> {
  const path = bankPath ? join(dirname(bankPath), 'shared_detector.bin') : fileURLToPath(new URL('../data/shared_detector.bin', import.meta.url))
  try { return decodeDetector(await readFile(path)) } catch {
    throw new Error(`Cannot read the detector from ${path}.${bankPath ? ' Run fpd retrain --data-dir for this bank first.' : ''}`)
  }
}

export async function loadChallenges(path?: string, count = 3): Promise<Challenge[] | undefined> {
  if (!path) return undefined
  const data = await readJson(path)
  if (!Array.isArray(data) || data.length !== count || !data.every(item => item &&
    typeof item.id === 'string' && typeof item.prompt === 'string' && item.prompt.trim() &&
    Number.isSafeInteger(item.expected_count) && item.expected_count > 0)) {
    throw new Error(`The challenge file must contain ${count} challenge object${count === 1 ? '' : 's'} matching --count, each with id, prompt, and a positive integer expected_count.`)
  }
  return data as Challenge[]
}

function englishAnalysis(analysis: Analysis): Analysis {
  let label: string, reason: string
  if (analysis.decision === 'unscorable') {
    label = 'Not enough valid samples'
    reason = `Received ${analysis.used_outputs}/3 valid samples. Three valid samples are required.`
  } else if (analysis.decision === 'partial') {
    label = 'Partial sample ranking'
    reason = `Ranked ${analysis.used_outputs} valid sample${analysis.used_outputs === 1 ? '' : 's'}. Confidence requires three valid samples.`
  } else if (analysis.probability_status === 'reference_calibrated') {
    label = 'Calibrated ranking'
    reason = 'Confidence is a closed-set probability within the reference bank.'
  } else {
    label = 'Uncalibrated ranking'
    reason = 'The confidence calibration does not match this detector. Confidence is unavailable.'
  }
  return {
    ...analysis, prediction_name: analysis.decision === 'unscorable' ? 'Not scored' : analysis.prediction_name,
    evidence: { ...analysis.evidence, label, reason },
  }
}

/** Scores the number fingerprint alone; the tokenizer probe is reference information and never enters the ranking. */
function scoreRound(round: Round, options: DetectOptions, bank: Bank, detector: SharedDetector) {
  round.outputs = round.samples.map(sample => ({
    text: acceptedSample(sample) ? sample.text : '', expected_count: sample.expectedCount,
  }))
  const accepted = round.samples.filter(acceptedSample).length
  if (!accepted || (options.strict && accepted !== 3)) {
    round.error = options.strict ? `Strict mode requires 3/3 successful samples; received ${accepted}/3.`
      : 'No valid samples. This round cannot be scored.'
    return
  }
  try {
    round.analysis = englishAnalysis(analyzeSharedOutputs(round.outputs, bank, detector, { allowPartial: !options.strict }))
    if (!round.analysis.results.length) round.error = round.analysis.evidence.reason
  } catch {
    round.error = 'Scoring failed. Check that the reference bank and detector files are valid.'
  }
}

export async function runDetection(
  options: DetectOptions, bank: Bank, detector: SharedDetector,
  onUpdate: (state: DetectionState) => void, signal: AbortSignal, fixedChallenges?: Challenge[], tokenizerBank?: TokenizerBank,
): Promise<DetectionState> {
  const state: DetectionState = { rounds: [], total: options.repeat, startedAt: Date.now(), cancelled: false }
  const report = () => onUpdate({ ...state, rounds: state.rounds.map(round => ({ ...round, samples: [...round.samples] })) })
  // One probe measures the upstream for the whole run. It starts beside the first round, with four probes in flight
  // when samples run in parallel and one otherwise. Rounds never wait for it.
  const probing = options.tokenizer && tokenizerBank && probeTokenizer(options.config, tokenizerBank, {
    url: requestEndpoint(options.config), transport: directTransport, signal, maximumProbes: options.maxProbes,
    concurrency: options.parallel > 1 ? 4 : 1,
    onUpdate: run => { state.tokenizer = run; report() },
  }).then(run => {
    state.tokenizer = run
    state.tokenizerSettled = true
    report()
  })
  if (probing) {
    state.tokenizerSettled = false
    state.tokenizerModel = options.config.model
  }
  report()
  for (let index = 0; index < options.repeat; index++) {
    if (signal.aborted) break
    const challenges: Challenge[] = fixedChallenges ?? generateChallenges(options.count)
    const round: Round = {
      index: index + 1, challenges, outputs: [], startedAt: Date.now(),
      samples: challenges.map(challenge => ({
        state: 'queued', text: '', rawText: '', count: 0, expectedCount: challenge.expected_count,
      })),
    }
    state.rounds.push(round)
    report()
    let next = 0
    const worker = async () => {
      while (!signal.aborted && next < challenges.length) {
        const sampleIndex = next++
        round.samples[sampleIndex] = await requestSample(options, challenges[sampleIndex], signal, sample => {
          round.samples[sampleIndex] = sample
          report()
        })
      }
    }
    // The barrier includes failed requests and cancelled streams before any next round.
    await Promise.all(Array.from({ length: options.parallel }, worker))
    if (signal.aborted) {
      for (const sample of round.samples) {
        if (sample.state === 'queued') { sample.state = 'cancelled'; sample.error = 'Cancelled before dispatch.' }
      }
      round.outputs = round.samples.map(sample => ({ text: acceptedSample(sample) ? sample.text : '', expected_count: sample.expectedCount }))
      round.error = 'Cancelled. This round was not scored.'
    } else scoreRound(round, options, bank, detector)
    round.finishedAt = Date.now()
    report()
  }
  state.cancelled = signal.aborted
  state.roundsFinishedAt = Date.now()
  report()
  // The results are final here. The exit still waits for a running probe so that the report saves it complete;
  // cancelling stops it and keeps the results. A cancelled run also waits, so the partial requests are saved.
  if (probing) await probing
  state.finishedAt = Date.now()
  report()
  return state
}

/**
 * Recomputes a saved probe against the current bank. `-m` or `MODEL` overrides the saved model for the claim check.
 * Observations of probes the bank no longer has are skipped; the run keeps them so that `--output` saves them again.
 */
function savedProbe(source: Record<string, unknown> | undefined, tokenizerBank: TokenizerBank, model: string): { run: TokenizerRun; model: string; warning?: string } | undefined {
  const saved = source?.tokenizer as { observations?: TokenizerObservation[]; model?: unknown } | undefined
  if (!saved) return undefined
  const observations = saved.observations
  if (!Array.isArray(observations) || !observations.every(item =>
    item && (item.probe === null || typeof item.probe === 'string') && Number.isSafeInteger(item.tokens))) {
    throw new Error('The tokenizer object in the input file needs an observations array. Each item needs probe (a string or null) and tokens (an integer).')
  }
  const known = new Set(tokenizerBank.probes.map(probe => probe.id))
  const usable = observations.filter(item => item.probe === null || known.has(item.probe))
  const skipped = observations.length - usable.length
  const missing = new Set(observations.flatMap(item => item.probe === null || known.has(item.probe) ? [] : [item.probe]))
  const posterior = tokenizerPosterior(tokenizerBank, usable)
  const baselines = observations.filter(item => item.probe === null).map(item => item.tokens)
  const request = source?.request as { model?: unknown } | undefined
  const claimed = model || (typeof saved.model === 'string' ? saved.model : typeof request?.model === 'string' ? request.model : '')
  const warning = skipped ? `The tokenizer bank has no probe text with the ID${missing.size === 1 ? '' : 's'} ${[...missing].join(', ')}. FPD skipped ${skipped} saved count${skipped === 1 ? '' : 's'}.`
    + (posterior?.answered ? '' : ' No probe text count remains, so there is no tokenizer result.') : undefined
  return {
    model: claimed, warning,
    run: {
      steps: observations.map(item => ({ probe: item.probe, state: 'done', tokens: item.tokens, responseModel: item.responseModel })),
      observations, posterior, baselineDrift: new Set(baselines).size > 1,
      // Like a live run, a verdict needs at least one answered probe.
      verdict: posterior && posterior.answered > 0 ? tokenizerVerdict(tokenizerBank, posterior, claimed) : null,
    },
  }
}

export async function analyzeInput(options: DetectOptions, bank: Bank, detector: SharedDetector, tokenizerBank?: TokenizerBank): Promise<DetectionState> {
  const data = await readJson(options.input!)
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : undefined
  const probe = tokenizerBank ? savedProbe(source, tokenizerBank, options.config.model) : undefined
  let entries = Array.isArray(source?.rounds) ? source.rounds : [data]
  if (source?.schema_version === 1 && source.purpose === 'reference' && Array.isArray(source.samples)) {
    const groups = new Map<string, typeof source.samples>()
    for (const sample of source.samples) {
      if (!sample || typeof sample.condition !== 'string' || !['complete', 'truncated', 'unknown'].includes(sample.completion)) {
        throw new Error('Collection samples must record their condition and completion status.')
      }
      const group = groups.get(sample.condition) ?? []
      group.push(sample)
      groups.set(sample.condition, group)
    }
    entries = []
    for (const group of groups.values()) {
      for (let index = 0; index < group.length; index += 3) {
        const samples = group.slice(index, index + 3)
        entries.push({ outputs: samples, samples })
      }
    }
  }
  if (!entries.length) throw new Error('The input file contains no rounds.')
  const state: DetectionState = {
    rounds: [], total: entries.length, startedAt: Date.now(), cancelled: false,
    tokenizer: probe?.run, tokenizerSettled: probe ? true : undefined, tokenizerModel: probe?.model, tokenizerWarning: probe?.warning,
  }
  for (const entry of entries) {
    const outputs = Array.isArray(entry) ? entry : entry?.outputs
    if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > 3 || !outputs.every(item => item &&
      typeof item.text === 'string' && Number.isSafeInteger(item.expected_count) && item.expected_count > 0)) {
      throw new Error('Each input round must contain one to three outputs with text and a positive integer expected_count.')
    }
    const round: Round = {
      index: state.rounds.length + 1, challenges: [], outputs: [], startedAt: Date.now(),
      samples: outputs.map((output: Output, index: number) => {
        const numbers = parseNumbers(output.text) as number[]
        const savedSample = Array.isArray(entry?.samples) ? entry.samples[index] : undefined
        const wasTruncated = savedSample?.state === 'truncated' || savedSample?.completion === 'truncated'
        const strictRejection = options.strict && (wasTruncated || (savedSample?.completion !== undefined && savedSample.completion !== 'complete'))
        const truncated = !options.strict && numbers.length > output.expected_count
        return {
          state: strictRejection || numbers.length < minimumNumbers(output.expected_count) ? 'failed'
            : truncated || wasTruncated ? 'truncated' : 'complete',
          text: truncated ? numbers.slice(0, output.expected_count).join(', ') : output.text,
          rawText: typeof savedSample?.rawText === 'string' ? savedSample.rawText : output.text,
          count: truncated ? output.expected_count : numbers.length, expectedCount: output.expected_count,
          error: strictRejection ? 'This saved sample has no confirmed complete response. Strict mode requires completion evidence.'
            : numbers.length < minimumNumbers(output.expected_count) ? 'Too few valid numbers.' : undefined,
        }
      }),
    }
    scoreRound(round, options, bank, detector)
    round.finishedAt = Date.now()
    state.rounds.push(round)
  }
  state.finishedAt = Date.now()
  return state
}

export function serializeResult(state: DetectionState, options: DetectOptions, bank: Bank, tokenizerBank?: TokenizerBank) {
  const { apiKey, ...config } = options.config
  const only = state.rounds.length === 1 ? state.rounds[0] : undefined
  const result = {
    schema: 'fpd-detection-v1', created_at: new Date(state.startedAt).toISOString(),
    request: options.input ? undefined : { ...config, api: options.api, count: options.count, parallel: options.parallel, repeat: options.repeat,
      strict: options.strict, timeout_seconds: options.timeoutMs / 1000, tokenizer: options.tokenizer,
      max_probes: options.tokenizer ? options.maxProbes : undefined },
    bank: { reference_sha256: bank.reference_sha256, models: bank.models.length },
    cancelled: state.cancelled, requested_rounds: state.total,
    completed_rounds: state.rounds.filter(round => round.finishedAt).length,
    scored_rounds: state.rounds.filter(round => round.analysis?.results.length).length,
    // `observations` alone lets --input recompute the probe against a newer tokenizer bank.
    tokenizer: state.tokenizer && tokenizerBank ? tokenizerReport(state.tokenizer, tokenizerBank, { createdAt: state.startedAt, model: state.tokenizerModel ?? '' }) : undefined,
    rounds: state.rounds,
    // Preserve the single-round shape consumed by existing offline research commands.
    challenges: only?.challenges, outputs: only?.outputs, analysis: only?.analysis,
  }
  return JSON.stringify(result, (_name, value) => typeof value === 'string' && apiKey
    ? value.replaceAll(apiKey, '[REDACTED]') : value, 2) + '\n'
}
