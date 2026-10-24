import { generateChallenges as generate } from '@fingerpoint/shared/challenge-browser.js'
import { buildDetectRequest, requestSample as request, type Sample as CoreSample } from '@fingerpoint/shared/detect-request'
import { runDetection } from '@fingerpoint/shared/detect-run'
import { parseNumbers as parse } from '@fingerpoint/shared/fingerprint-core.js'
import { analyzeOutputs, canonicalAnalysis } from './analysis.js'
import { detectOptions } from './config.js'
import { loadData, type ReferenceData } from './data.js'
import type { Analysis, Challenge, DetectConfig, DetectResult, LoadOptions, Output, Sample } from './types.js'

export type * from './types.js'
export { DEFAULT_DATA_URLS } from './types.js'

const canonicalSample = (sample: CoreSample): Sample => ({
  state: sample.state, text: sample.text, raw_text: sample.rawText, count: sample.count, expected_count: sample.expectedCount,
  response_model: sample.responseModel ?? null, response_id: sample.responseId ?? null, error: sample.error ?? null,
})

let createDetector: (data: ReferenceData) => Detector

/** A loaded reference bank and detector. Create one with `loadDetector()`. */
export class Detector {
  static { createDetector = data => new Detector(data) }
  readonly #data: ReferenceData
  /** `built_at` of the reference bank, which identifies the data build. */
  readonly builtAt: string

  private constructor(data: ReferenceData) {
    this.#data = data
    this.builtAt = data.bank.built_at
  }

  /**
   * Scores one to three saved replies. Three valid replies give a calibrated ranking; fewer give a partial ranking
   * unless `strict` is set.
   */
  analyze(outputs: Output[], options: { strict?: boolean } = {}): Analysis {
    return analyzeOutputs(outputs, this.#data.bank, this.#data.detector, options.strict ?? false)
  }

  /** Sends one round of challenges to the model API and scores the replies. Throws only on an invalid config. */
  async detect(config: DetectConfig, signal?: AbortSignal): Promise<DetectResult> {
    const options = detectOptions(config)
    const state = await runDetection(options, this.#data.bank, this.#data.detector, () => {}, signal ?? new AbortController().signal)
    const round = state.rounds[0]
    if (!round) return { challenges: [], samples: [], analysis: null, error: 'Cancelled. This round was not scored.' }
    return {
      challenges: round.challenges, samples: round.samples.map(canonicalSample),
      analysis: round.analysis ? canonicalAnalysis(round.analysis) : null, error: round.error ?? null,
    }
  }
}

/**
 * Loads the reference data from a local directory, or from URLs through a cache file: an existing cache answers at once
 * and is refreshed in the background once it is `ttl` seconds old; without one the data is downloaded.
 */
export async function loadDetector(options: LoadOptions = {}): Promise<Detector> {
  return createDetector(await loadData(options.source, options.cache, options.ttl))
}

/** Random challenges in one of five languages, each asking for a distinct count from 292 to 332. */
export function generateChallenges(count = 3): Challenge[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 3) throw new Error('count must be an integer from 1 to 3.')
  return generate(count)
}

/** The numbers 1 to 355 of the longest run in a reply; letters between numbers split runs. */
export function parseNumbers(text: string): number[] {
  return parse(text)
}

/** The HTTP request `detect` sends for one prompt, or the config error. */
export function buildRequest(config: DetectConfig, prompt: string):
  { url: string; headers: Record<string, string>; body: Record<string, unknown> } | { error: string } {
  try { return buildDetectRequest(detectOptions(config).config, prompt) } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Sends one challenge and returns the checked reply. Request failures are reported in `error`. */
export async function requestSample(config: DetectConfig, challenge: Challenge): Promise<Sample> {
  return canonicalSample(await request(detectOptions(config), challenge, new AbortController().signal, () => {}))
}
