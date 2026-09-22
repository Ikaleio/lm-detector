import { useEffect, useRef } from 'react'
import confetti from 'canvas-confetti'
import type { Analysis } from '@fingerpoint/shared/types'
import { useMotionPreset } from '@/lib/motion'
import { confidenceOf, NORMAL_CONFIDENCE_THRESHOLD } from '@/lib/result-confidence'

const modelId = (model: string) => model.trim().replace(/^[^/]+\//, '')

export function useModelMatchCelebration(result: Analysis | null, selectedModel: string | null, enabled: boolean) {
  const { reduced } = useMotionPreset()
  const lastResult = useRef<Analysis | null>(null)

  useEffect(() => {
    if (lastResult.current === result) return
    lastResult.current = result
    if (!enabled || reduced || !result || !selectedModel || result.decision === 'unscorable') return

    const top = result.results[0]
    const confidence = top ? confidenceOf(top) : null
    if (!top || confidence === null || !Number.isFinite(confidence) || confidence < NORMAL_CONFIDENCE_THRESHOLD) return
    if (!modelId(selectedModel) || modelId(top.model) !== modelId(selectedModel)) return

    const width = document.documentElement.clientWidth
    const rise = document.documentElement.clientHeight * 0.6
    const angle = Math.atan2(rise, width) * 180 / Math.PI
    const fire = confetti.create(undefined, { resize: true, disableForReducedMotion: true })
    const options = {
      particleCount: 220,
      spread: 32,
      startVelocity: Math.hypot(width, rise) * 0.1,
      decay: 0.94,
      gravity: 0.9,
      ticks: 240,
    }
    void fire({ ...options, angle, origin: { x: 0, y: 1 } })
    void fire({ ...options, angle: 180 - angle, origin: { x: 1, y: 1 } })

    return () => fire.reset()
  }, [result, selectedModel, enabled, reduced])
}
