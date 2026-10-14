import { useEffect, useRef } from 'react'
import confetti from 'canvas-confetti'
import type { Analysis } from '@fingerpoint/shared/types'
import { useMotionPreset } from '@/lib/motion'
import { NORMAL_CONFIDENCE_THRESHOLD } from '@/lib/result-confidence'

/**
 * The model name in reference-bank form: no provider prefix, and a dash between two single digits becomes a dot,
 * so `anthropic/claude-opus-5-5` reads `claude-opus-5.5` while dates such as `2024-08-06` stay as they are.
 */
export const canonicalModel = (model: string) => model.trim().replace(/^[^/]+\//, '').replace(/(?<!\d)(\d)-(\d)(?!\d)/g, '$1.$2')

/** Whether the top candidate is the requested model with normal confidence; this is what the celebration marks. */
export function isModelMatch(result: Analysis, selectedModel: string) {
  if (result.decision === 'unscorable') return false
  const top = result.results[0]
  const confidence = top?.probability ?? null
  if (!top || confidence === null || !Number.isFinite(confidence) || confidence < NORMAL_CONFIDENCE_THRESHOLD) return false
  return !!canonicalModel(selectedModel) && canonicalModel(top.model) === canonicalModel(selectedModel)
}

export function useModelMatchCelebration(result: Analysis | null, selectedModel: string | null, enabled: boolean) {
  const { reduced } = useMotionPreset()
  const lastResult = useRef<Analysis | null>(null)

  useEffect(() => {
    if (lastResult.current === result) return
    lastResult.current = result
    if (!enabled || reduced || !result || !selectedModel || !isModelMatch(result, selectedModel)) return

    const reach = document.documentElement.clientWidth * 0.75
    const rise = document.documentElement.clientHeight * 0.6
    const decay = 0.94
    const angle = Math.atan2(rise, reach) * 180 / Math.PI
    const fire = confetti.create(undefined, { resize: true, disableForReducedMotion: true })
    const options = {
      particleCount: 220,
      spread: 32,
      startVelocity: Math.hypot(reach, rise) * (1 - decay),
      decay,
      gravity: 0.9,
      ticks: 240,
    }
    void fire({ ...options, angle, origin: { x: 0, y: 1 } })
    void fire({ ...options, angle: 180 - angle, origin: { x: 1, y: 1 } })

    return () => fire.reset()
  }, [result, selectedModel, enabled, reduced])
}
