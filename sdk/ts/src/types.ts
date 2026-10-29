/** One model reply and the number count its challenge asked for. */
export interface Output { text: string; expected_count: number }

export interface Challenge { id: string; expected_count: number; prompt: string }

export type Api = 'responses' | 'chat_completions' | 'messages' | 'gemini'
export type ServiceTier = 'flex' | 'default' | 'fast' | 'ultrafast'

export interface DetectConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Default `responses`. */
  api?: Api
  /** Reasoning effort sent to the model. Empty sends none; `none` disables thinking on Messages. Gemini accepts only empty or `default` and uses provider-default thinking. */
  effort?: string
  /** Default `default`, which sends no tier field. Gemini accepts only `default`. */
  serviceTier?: ServiceTier
  /** Default true. */
  stream?: boolean
  /** Require three complete replies and no truncation. Needs `count` 3. Default false. */
  strict?: boolean
  /** Challenges per round, 1 to 3. Default 3. */
  count?: number
  /** Concurrent requests, 1 to 3, capped at `count`. Default 3. */
  parallel?: number
  /** Seconds to wait for the first SSE byte or the whole JSON response; 0 disables the timer. Default 120. */
  timeout?: number
}

export interface AnalysisResult {
  model: string
  display_name: string
  family: string
  family_name: string
  score: number
  probability: number | null
}

export interface Diagnostic {
  index: number
  parsed_numbers: number
  minimum_numbers: number
  accepted: boolean
  raw_out_of_range_count: number
}

/** Every key is always present, so the shape matches the Rust, Go, and Python SDKs. */
export interface Analysis {
  decision: 'scored' | 'partial' | 'unscorable' | 'not_model'
  prediction: string
  prediction_name: string
  family_prediction: string
  family_prediction_name: string
  /** Candidates by ranking score, best first. Empty unless the decision is `scored` or `partial`. */
  results: AnalysisResult[]
  ranking_score: number | null
  /** Closed-set probability of the top candidate within the reference bank. Null without calibration or three replies. */
  probability: number | null
  probability_status: 'unavailable' | 'reference_calibrated'
  probability_scope: string | null
  calibration: { method: string; run: string; tau: number; sha256: string | null } | null
  used_outputs: number
  diagnostics: Diagnostic[]
  sequence: { autocorrelation: number; small_step_share: number; model_like: boolean } | null
  method: string
  model_version: { base_sha256: string }
  evidence: { insufficient: boolean; label: string; reason: string; threshold: null; method: string }
}

export interface Sample {
  state: 'complete' | 'truncated' | 'failed' | 'cancelled' | 'queued' | 'waiting' | 'streaming'
  /** The numbers used for scoring; capped at `expected_count` when the reply had more. */
  text: string
  raw_text: string
  count: number
  expected_count: number
  /**
   * Milliseconds from sending the request to the first SSE body byte, or to the whole JSON response. Null until then,
   * and when the request failed before it.
   */
  first_byte_ms: number | null
  response_model: string | null
  response_id: string | null
  error: string | null
}

export interface DetectOptions {
  /** Cancels the round; samples that have not started become `cancelled` and the round is not scored. */
  signal?: AbortSignal
  /**
   * Called with a copy of a sample each time it changes. Calls never overlap. A thrown error is reported as an uncaught
   * exception and does not affect the detection.
   */
  onSample?: (index: number, sample: Sample) => void
}

export interface DetectResult {
  challenges: Challenge[]
  samples: Sample[]
  analysis: Analysis | null
  /** Why the round has no ranking, or null when it has one. */
  error: string | null
}

export interface LoadOptions {
  /**
   * Base URLs of the published data, each ending in `/`, tried in order. A single source that is not an http(s) URL is
   * a local directory holding `unified_bank.json` and `shared_detector.bin`, read as is. Default `DEFAULT_DATA_URLS`.
   */
  source?: string | readonly string[]
  /** Cache file for downloaded data. Default `<OS cache directory>/lmfpd/data.bin`. */
  cache?: string
  /** Seconds after a check before the cache is refreshed in the background; 0 checks on every load. Default 86400. */
  ttl?: number
}

/**
 * Data sources, tried in order. The mirror is JSDMirror, a jsDelivr mirror in mainland China, serving the `lmfpd-data`
 * npm package, which has the same layout as the site's `/data/`.
 */
export const DEFAULT_DATA_URLS: readonly string[] = [
  'https://lm.ikale.io/data/',
  'https://cdn.jsdmirror.com/npm/lmfpd-data@latest/',
]
