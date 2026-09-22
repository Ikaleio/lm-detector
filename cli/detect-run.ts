import { readFile } from 'node:fs/promises'
import { generateChallenges } from '@fingerpoint/shared/challenge-browser.js'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import { analyzeSharedOutputs, type SharedDetector } from '@fingerpoint/shared/shared-detector'
import type { Analysis, Bank, Challenge, Output } from '@fingerpoint/shared/types'
import type { DetectOptions } from './detect-options'
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
  cancelled: boolean
}

export async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch {
    throw new Error(`Cannot read valid JSON from ${path}.`)
  }
}

export async function loadChallenges(path?: string): Promise<Challenge[] | undefined> {
  if (!path) return undefined
  const data = await readJson(path)
  if (!Array.isArray(data) || data.length !== 3 || !data.every(item => item &&
    typeof item.id === 'string' && typeof item.prompt === 'string' && item.prompt.trim() &&
    Number.isSafeInteger(item.expected_count) && item.expected_count > 0)) {
    throw new Error('The challenge file must contain three objects with id, prompt, and a positive integer expected_count.')
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
    reason = `Ranked ${analysis.used_outputs}/3 valid samples. Confidence requires three valid samples.`
  } else if (analysis.method === 'custom-bank-legacy-ranking') {
    label = 'Custom bank ranking'
    reason = 'The verifier does not match this bank. Confidence is unavailable.'
  } else {
    const agrees = analysis.verification_top === analysis.prediction
    label = agrees ? 'Ranker and verifier agree' : 'Ranker and verifier disagree'
    reason = agrees ? 'Both methods selected the same leading candidate.'
      : `The verifier preferred ${analysis.results.find(row => row.model === analysis.verification_top)?.display_name ?? analysis.verification_top}. Candidate order follows the ranker.`
  }
  return {
    ...analysis, prediction_name: analysis.decision === 'unscorable' ? 'Not scored' : analysis.prediction_name,
    evidence: { ...analysis.evidence, label, reason },
  }
}

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
  onUpdate: (state: DetectionState) => void, signal: AbortSignal, fixedChallenges?: Challenge[],
): Promise<DetectionState> {
  const state: DetectionState = { rounds: [], total: options.repeat, startedAt: Date.now(), cancelled: false }
  const report = () => onUpdate({ ...state, rounds: state.rounds.map(round => ({ ...round, samples: [...round.samples] })) })
  report()
  for (let index = 0; index < options.repeat; index++) {
    if (signal.aborted) break
    const challenges: Challenge[] = fixedChallenges ?? generateChallenges()
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
  state.finishedAt = Date.now()
  report()
  return state
}

export async function analyzeInput(options: DetectOptions, bank: Bank, detector: SharedDetector): Promise<DetectionState> {
  const data = await readJson(options.input!)
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : undefined
  const entries = Array.isArray(source?.rounds) ? source.rounds : [data]
  if (!entries.length) throw new Error('The input file contains no rounds.')
  const state: DetectionState = { rounds: [], total: entries.length, startedAt: Date.now(), cancelled: false }
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
        const wasTruncated = savedSample?.state === 'truncated'
        const strictRejection = options.strict && wasTruncated
        const truncated = !options.strict && numbers.length > output.expected_count
        return {
          state: strictRejection || numbers.length < minimumNumbers(output.expected_count) ? 'failed'
            : truncated || wasTruncated ? 'truncated' : 'complete',
          text: truncated ? numbers.slice(0, output.expected_count).join(', ') : output.text,
          rawText: typeof savedSample?.rawText === 'string' ? savedSample.rawText : output.text,
          count: truncated ? output.expected_count : numbers.length, expectedCount: output.expected_count,
          error: strictRejection ? 'This saved sample was truncated. Strict mode requires a complete response.'
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

export function serializeResult(state: DetectionState, options: DetectOptions, bank: Bank) {
  const { apiKey, ...config } = options.config
  const only = state.rounds.length === 1 ? state.rounds[0] : undefined
  const result = {
    schema: 'fpd-detection-v1', created_at: new Date(state.startedAt).toISOString(),
    request: options.input ? undefined : { ...config, api: options.api, parallel: options.parallel, repeat: options.repeat,
      strict: options.strict, timeout_seconds: options.timeoutMs / 1000 },
    bank: { reference_sha256: bank.reference_sha256, models: bank.models.length },
    cancelled: state.cancelled, requested_rounds: state.total,
    completed_rounds: state.rounds.filter(round => round.finishedAt).length,
    scored_rounds: state.rounds.filter(round => round.analysis?.results.length).length,
    rounds: state.rounds,
    // Preserve the single-round shape consumed by existing offline research commands.
    challenges: only?.challenges, outputs: only?.outputs, analysis: only?.analysis,
  }
  return JSON.stringify(result, (_name, value) => typeof value === 'string' && apiKey
    ? value.replaceAll(apiKey, '[REDACTED]') : value, 2) + '\n'
}
