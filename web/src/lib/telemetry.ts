import type { Analysis } from '@fingerpoint/shared/types'
import { NORMAL_CONFIDENCE_THRESHOLD } from '@/lib/result-confidence'
import { canonicalModel, isModelMatch } from '@/lib/use-model-match-celebration'

declare global {
  interface Window {
    /** Koitoyu (Umami) tracker, injected only by the production build. */
    umami?: { track(event: string, data?: Record<string, string | number | boolean>): void }
  }
}

/**
 * Counts one API-mode detection under the requested model in reference-bank form.
 * `top` is the first-ranked model (`unscorable` when nothing was ranked); `outcome` is
 * `match` (confident top equals the requested model), `mismatch` (confident top is another model),
 * `low` (top below normal confidence) or `unscorable`. Crossing `model` with `top` gives the A→B spread.
 * A `match` also counts as `detect-genuine`, so the genuine rate per model is `detect-genuine / detect`.
 */
export function trackDetection(requested: string, analysis: Analysis) {
  const model = canonicalModel(requested)
  const first = analysis.decision === 'unscorable' ? undefined : analysis.results[0]
  const confidence = first?.probability ?? null
  const genuine = isModelMatch(analysis, requested)
  const outcome = !first ? 'unscorable'
    : genuine ? 'match'
      : confidence === null || !Number.isFinite(confidence) || confidence < NORMAL_CONFIDENCE_THRESHOLD ? 'low'
        : 'mismatch'
  window.umami?.track('detect', { model, top: first ? canonicalModel(first.model) : 'unscorable', outcome })
  if (genuine) window.umami?.track('detect-genuine', { model })
}
