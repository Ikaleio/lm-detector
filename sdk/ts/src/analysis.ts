import { minimumNumbers } from '@fingerpoint/shared/detect-request'
import { englishAnalysis } from '@fingerpoint/shared/detect-run'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import { analyzeSharedOutputs, type SharedDetector } from '@fingerpoint/shared/shared-detector'
import type { Analysis as CoreAnalysis, Bank } from '@fingerpoint/shared/types'
import type { Analysis, Output } from './types'

export const SCORING_FAILED = 'Scoring failed. Check that the reference bank and detector files are valid.'

/** Fills the keys the core omits, so every SDK returns the same key set. */
export function canonicalAnalysis(a: CoreAnalysis): Analysis {
  const extra = a as CoreAnalysis & Partial<Analysis>
  return {
    decision: (a.decision ?? 'scored') as Analysis['decision'],
    prediction: a.prediction,
    prediction_name: a.prediction_name,
    family_prediction: extra.family_prediction ?? '',
    family_prediction_name: a.family_prediction_name,
    results: a.results,
    ranking_score: a.ranking_score ?? null,
    probability: a.probability,
    probability_status: extra.probability_status!,
    probability_scope: extra.probability_scope ?? null,
    calibration: extra.calibration ?? null,
    used_outputs: a.used_outputs,
    diagnostics: a.diagnostics as Analysis['diagnostics'],
    sequence: a.sequence ?? null,
    method: extra.method!,
    model_version: extra.model_version!,
    evidence: a.evidence as Analysis['evidence'],
  }
}

export function score(outputs: Output[], bank: Bank, detector: SharedDetector, strict: boolean): Analysis {
  return canonicalAnalysis(englishAnalysis(analyzeSharedOutputs(outputs, bank, detector, { allowPartial: !strict })))
}

/** Scores saved replies like `fpd --input`: extra numbers are cut in relaxed mode, short replies count as missing. */
export function analyzeOutputs(outputs: Output[], bank: Bank, detector: SharedDetector, strict: boolean): Analysis {
  if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > 3 || !outputs.every(item => item &&
    typeof item.text === 'string' && Number.isSafeInteger(item.expected_count) && item.expected_count > 0)) {
    throw new Error('Each input round must contain one to three outputs with text and a positive integer expected_count.')
  }
  const prepared = outputs.map(({ text, expected_count }) => {
    const numbers = parseNumbers(text) as number[]
    if (!strict && numbers.length > expected_count) text = numbers.slice(0, expected_count).join(', ')
    if (numbers.length < minimumNumbers(expected_count)) text = ''
    return { text, expected_count }
  })
  try { return score(prepared, bank, detector, strict) } catch { throw new Error(SCORING_FAILED) }
}
