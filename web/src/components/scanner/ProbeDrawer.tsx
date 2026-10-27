import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useTransform } from 'framer-motion'
import { Check, Copy, RotateCcw, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PixelShader } from '@/components/pixel-shader'
import { StateBadge, badgeFor, isBusyState, minimumNumbers, type Mode, type SampleUI } from '@/components/sample-card'
import { useI18n } from '@/i18n'
import { parseNumbers } from '@/lib/client'
import { describe } from '@/lib/errors'
import { useMotionPreset } from '@/lib/motion'
import type { Challenge } from '@fingerpoint/shared/types'

/** Height of the question header and of the answer handle that stays in view when the question is open. */
const HEADER = 44
const HANDLE = 40

/**
 * One question card: the question lies underneath and the answer sheet covers it.
 * Pull the sheet down by its handle (drag, click or ↑/↓) to read the whole question.
 */
export function ProbeDrawer({ index, challenge, sample, mode, canSample, locked, focused, anomalous, onChange, onFocus, onBlur, onResample, onStop, onShowError }: {
  index: number
  challenge: Challenge
  sample: SampleUI
  mode: Mode
  canSample: boolean
  locked: boolean
  focused: boolean
  anomalous?: boolean
  onChange: (text: string) => void
  onFocus: () => void
  onBlur: () => void
  onResample: () => void
  onStop: () => void
  onShowError: () => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  const { snappy, smooth, reduced } = useMotionPreset()
  const [questionOpen, setQuestionOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [travel, setTravel] = useState(208)
  const card = useRef<HTMLElement>(null)
  const reply = useRef<HTMLTextAreaElement>(null)
  const dragged = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const controls = useDragControls()
  const y = useMotionValue(0)
  const answerOpacity = useTransform(y, [0, travel], [1, .18])
  const questionOpacity = useTransform(y, [0, travel], [.18, 1])
  const busy = isBusyState(sample.state)
  const visibleText = sample.draftText ?? sample.text
  const count = parseNumbers(visibleText).length
  const min = minimumNumbers(challenge.expected_count)
  const filled = Boolean(sample.text.trim())
  const badge = badgeFor(sample, challenge.expected_count)
  const stateLabel = t(`detect.state.${badge.key}`)

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setTravel(entry.contentRect.height - HEADER - HANDLE + 4))
    if (card.current) observer.observe(card.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const playback = animate(y, questionOpen ? travel : 0, snappy)
    return () => playback.stop()
  }, [questionOpen, travel, y, snappy])
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  // A running sample shows its answer as it arrives, scrolled to the newest text.
  useEffect(() => { if (busy) setQuestionOpen(false) }, [busy])
  useLayoutEffect(() => {
    if (reply.current && mode === 'api' && (busy || sample.state === 'done' || sample.state === 'capped')) reply.current.scrollTop = reply.current.scrollHeight
  }, [visibleText, mode, busy, sample.state])

  function settle(open: boolean) {
    setQuestionOpen(open)
    // Also snap when the drag ends on the existing state.
    animate(y, open ? travel : 0, snappy)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(challenge.prompt)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1800)
      toast.success(t('detect.copied', { n: index + 1 }))
    } catch {
      toast.error(t('detect.copyFailed'))
      settle(true)
    }
  }

  const iconMotion = reduced ? { initial: false } : { initial: { opacity: 0, scale: .65 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0, scale: .65 } }

  return (
    <section
      ref={card}
      className="fp-custom-probe"
      data-filled={filled || undefined}
      data-focused={focused || undefined}
      data-warning={anomalous || undefined}
      data-drawer={questionOpen ? 'question' : 'answer'}
      aria-label={t('detect.sample', { n: index + 1 })}
    >
      <div className="fp-custom-probe-header">
        <button type="button" className="fp-custom-probe-title" onClick={() => settle(!questionOpen)} aria-expanded={questionOpen} aria-controls={`question-${index}`}>
          <motion.span style={{ opacity: questionOpacity }}>{t('detect.question', { n: index + 1 })}</motion.span>
        </button>
        <button type="button" className="fp-custom-probe-icon" aria-label={t('detect.copyQuestion', { n: index + 1 })} title={t('detect.copy')} onClick={() => void copy()}>
          <AnimatePresence initial={false} mode="wait">
            <motion.span key={copied ? 'copied' : 'copy'} className="grid place-items-center" {...iconMotion} transition={snappy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
      <motion.div id={`question-${index}`} className="fp-custom-probe-question" style={{ opacity: questionOpacity }} inert={!questionOpen} tabIndex={questionOpen ? 0 : -1}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.p
            key={challenge.id}
            initial={reduced ? false : { opacity: 0, y: 8, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
            exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
            transition={{ ...smooth, delay: reduced ? 0 : index * 0.06 }}
          >
            {challenge.prompt}
          </motion.p>
        </AnimatePresence>
        {t('detect.promptNote') && <small>{t('detect.promptNote')}</small>}
      </motion.div>
      <motion.div
        className="fp-custom-probe-answer"
        style={{ y }}
        drag="y"
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: travel }}
        dragElastic={0}
        dragMomentum={false}
        onDragStart={() => { dragged.current = true }}
        onDragEnd={(_, info) => settle(Math.abs(info.velocity.y) > 250 ? info.velocity.y > 0 : y.get() > travel / 2)}
      >
        <button
          type="button"
          className="fp-custom-probe-handle"
          onPointerDown={event => { dragged.current = false; controls.start(event) }}
          onClick={() => { if (!dragged.current) settle(!questionOpen) }}
          onKeyDown={event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            settle(event.key === 'ArrowDown')
          }}
          aria-label={t(questionOpen ? 'detect.showAnswer' : 'detect.showQuestion', { n: index + 1 })}
          aria-expanded={!questionOpen}
          aria-controls={`answer-body-${index}`}
        >
          <motion.span style={{ opacity: answerOpacity }}>{t('detect.answer', { n: index + 1 })}</motion.span>
          <span className="fp-custom-probe-grip" aria-hidden="true" />
        </button>
        <div id={`answer-body-${index}`} className="fp-custom-probe-answer-body" inert={questionOpen}>
          <motion.div className="relative flex min-h-0 flex-1" style={{ opacity: answerOpacity }}>
            {busy || visibleText || mode === 'manual' ? (
              <>
                <textarea
                  ref={reply}
                  value={visibleText}
                  readOnly={busy || locked}
                  aria-busy={busy}
                  aria-label={`${t('detect.sample', { n: index + 1 })} · ${t('detect.reply')}`}
                  onChange={event => onChange(event.target.value)}
                  onFocus={onFocus}
                  onBlur={onBlur}
                  placeholder={t('detect.answerPlaceholder')}
                  spellCheck={false}
                />
                {busy && !visibleText && <PixelShader effect="rain" className="pointer-events-none absolute inset-0 text-muted-foreground/30" />}
              </>
            ) : (
              <button type="button" className="fp-custom-probe-waiting" disabled={!canSample || locked} onClick={onResample}>
                <PixelShader effect="dither" className="absolute inset-0 -z-10 text-muted-foreground/20" />
                {t('detect.waitingSample')}
              </button>
            )}
          </motion.div>
          {sample.state === 'rejected' && (sample.errorText
            ? <button type="button" className="line-clamp-2 text-left text-meta text-destructive hover:underline" role="status" title={describe(i18n, sample.errorCode, sample.httpStatus)} onClick={onShowError}>{describe(i18n, sample.errorCode, sample.httpStatus)}</button>
            : <p className="line-clamp-2 text-meta text-destructive" role="status">{describe(i18n, sample.errorCode, sample.httpStatus)}</p>)}
          <div className="fp-custom-probe-meta">
            <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
              <span className="shrink-0" title={visibleText.trim() && count < min ? t('detect.numbersNeeded', { min }) : undefined}>
                {t('detect.numbers', { count })}
                {sample.elapsedMs !== undefined ? ` · ${t('detect.seconds', { s: (sample.elapsedMs / 1000).toFixed(1) })}` : ''}
              </span>
              <span className="fp-custom-probe-badge" title={stateLabel}><StateBadge sample={sample} expected={challenge.expected_count} /></span>
            </span>
            <span className="ms-auto flex shrink-0 items-center">
              {busy
                ? <Button variant="ghost" size="icon-xs" aria-label={t('detect.stop')} title={t('detect.stop')} onClick={onStop}><Square /></Button>
                : mode === 'api' && (sample.text || sample.state === 'rejected' || sample.state === 'stopped') && <Button variant="ghost" size="icon-xs" aria-label={t('detect.resample')} title={t('detect.resample')} disabled={!canSample || locked} onClick={onResample}><RotateCcw /></Button>}
              <Button variant="ghost" size="icon-xs" aria-label={t('detect.clearReply')} title={t('detect.clearReply')} disabled={busy || locked || !visibleText.trim()} onClick={() => onChange('')}><Trash2 /></Button>
            </span>
          </div>
        </div>
      </motion.div>
    </section>
  )
}
