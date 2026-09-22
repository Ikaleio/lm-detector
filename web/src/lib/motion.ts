import { useSyncExternalStore } from 'react'
import { type Transition, type Variants } from 'framer-motion'

/** design.md 4.7：全站只用三组弹簧。 */
export const spring = {
  snappy: { type: 'spring', stiffness: 500, damping: 45 },
  smooth: { type: 'spring', stiffness: 260, damping: 34 },
  gentle: { type: 'spring', stiffness: 120, damping: 24 },
} satisfies Record<string, Transition>

const reducedTransition: Transition = { duration: 0 }
const motionQuery = '(prefers-reduced-motion: reduce)'
const reducedSnapshot = () => window.matchMedia(motionQuery).matches
const serverSnapshot = () => false
function subscribeReducedMotion(notify: () => void) {
  const media = window.matchMedia(motionQuery)
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}

export function useMotionPreset() {
  const reduced = useSyncExternalStore(subscribeReducedMotion, reducedSnapshot, serverSnapshot)
  return {
    reduced: Boolean(reduced),
    snappy: reduced ? reducedTransition : spring.snappy,
    smooth: reduced ? reducedTransition : spring.smooth,
    gentle: reduced ? reducedTransition : spring.gentle,
  }
}

export const listStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}

export const listItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: spring.gentle },
}
