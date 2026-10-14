import { canonicalModel } from '@/lib/use-model-match-celebration'

declare global {
  interface Window {
    /** Koitoyu (Umami) tracker, injected only by the production build. */
    umami?: { track(event: string, data?: Record<string, string | number | boolean>): void }
  }
}

/**
 * Counts one API-mode detection under the requested model in reference-bank form.
 * A detection that would show the celebration also counts as `detect-genuine`,
 * so the genuine rate per model is `detect-genuine / detect` on the `model` property.
 */
export function trackDetection(model: string, genuine: boolean) {
  const data = { model: canonicalModel(model) }
  window.umami?.track('detect', data)
  if (genuine) window.umami?.track('detect-genuine', data)
}
