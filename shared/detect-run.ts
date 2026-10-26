import { generateChallenges } from './challenge-browser.js'
import { acceptedSample, requestEndpoint, requestSample, type DetectionOptions, type Sample } from './detect-request'
import { directTransport } from './detection'
import { analyzeSharedOutputs, type SharedDetector } from './shared-detector'
import type { TokenizerBank } from './tokenizer-bank'
import { probeTokenizer, type TokenizerRun } from './tokenizer-probe'
import type { Analysis, Bank, Challenge, Output } from './types'

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

export function englishAnalysis(analysis: Analysis): Analysis {
  let label: string, reason: string
  if (analysis.decision === 'unscorable') {
    label = 'Not enough valid samples'
    reason = `Received ${analysis.used_outputs}/3 valid samples. Three valid samples are required.`
  } else if (analysis.decision === 'not_model') {
    label = 'Not like a language model reply'
    reason = 'Consecutive numbers change differently from the language-model replies in the reference bank. Program-generated, sorted or shuffled numbers often do this. No ranking was produced.'
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
    ...analysis, prediction_name: analysis.decision === 'unscorable' ? 'Not scored'
      : analysis.decision === 'not_model' ? 'Not a model reply' : analysis.prediction_name,
    evidence: { ...analysis.evidence, label, reason },
  }
}

/** Scores the number fingerprint alone; the tokenizer probe is reference information and never enters the ranking. */
export function scoreRound(round: Round, options: Pick<DetectionOptions, 'strict'>, bank: Bank, detector: SharedDetector) {
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

export function newRound(index: number, challenges: Challenge[]): Round {
  return {
    index, challenges, outputs: [], startedAt: Date.now(),
    samples: challenges.map(challenge => ({ state: 'queued', text: '', rawText: '', count: 0, expectedCount: challenge.expected_count })),
  }
}

/**
 * Samples every challenge of the round with `options.parallel` workers, then scores it unless cancelled. Calls
 * `onSample` each time `round.samples[index]` changes. The barrier includes failed requests and cancelled streams.
 */
export async function runRound(
  round: Round, options: DetectionOptions, bank: Bank, detector: SharedDetector, signal: AbortSignal,
  onSample: (index: number) => void,
) {
  let next = 0
  const worker = async () => {
    while (!signal.aborted && next < round.challenges.length) {
      const index = next++
      round.samples[index] = await requestSample(options, round.challenges[index], signal, sample => {
        round.samples[index] = sample
        onSample(index)
      })
    }
  }
  await Promise.all(Array.from({ length: options.parallel }, worker))
  if (signal.aborted) {
    round.samples.forEach((sample, index) => {
      if (sample.state !== 'queued') return
      round.samples[index] = { ...sample, state: 'cancelled', error: 'Cancelled before dispatch.' }
      onSample(index)
    })
    round.outputs = round.samples.map(sample => ({ text: acceptedSample(sample) ? sample.text : '', expected_count: sample.expectedCount }))
    round.error = 'Cancelled. This round was not scored.'
  } else scoreRound(round, options, bank, detector)
  round.finishedAt = Date.now()
}

export async function runDetection(
  options: DetectionOptions, bank: Bank, detector: SharedDetector,
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
    const round = newRound(index + 1, fixedChallenges ?? generateChallenges(options.count))
    state.rounds.push(round)
    report()
    await runRound(round, options, bank, detector, signal, report)
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
