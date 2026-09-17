import { useReducedMotion, type Transition, type Variants } from 'framer-motion'

/** design.md 4.7：全站只用三组弹簧。 */
export const spring = {
  snappy: { type: 'spring', stiffness: 500, damping: 40 } as Transition,
  smooth: { type: 'spring', stiffness: 260, damping: 30 } as Transition,
  gentle: { type: 'spring', stiffness: 120, damping: 20 } as Transition,
}

const reducedTransition: Transition = { duration: 0.15 }

export function useMotionPreset() {
  const reduced = useReducedMotion()
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
