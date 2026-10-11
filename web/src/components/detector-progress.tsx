import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n, type I18n } from '@/i18n'
import { loadDetector, useDetectorDownload, type DetectorDownload } from '@/lib/detector'
import { useMotionPreset } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** Cell width and gap in CSS pixels; `fp-progress-cells` draws the same sizes. */
const CELL = 6, GAP = 2
/** A cached detector arrives within this delay, so a page that loads from cache shows nothing. */
const SHOW_DELAY_MS = 300
const READY_HOLD_MS = 1600
const MIB = 1024 * 1024

/** Received share of the download; null until the size is known. */
export function downloadFraction(download: DetectorDownload): number | null {
  if (download.status === 'ready') return 1
  return download.status === 'loading' && download.total ? download.loaded / download.total : null
}

/** "1.2 / 3.4 MB", or null until the size is known. */
export function downloadBytes(download: DetectorDownload, t: I18n['t']): string | null {
  if (download.status !== 'loading' || !download.total) return null
  const megabytes = (bytes: number) => Math.round(bytes / MIB * 10) / 10
  return t('app.detectorBytes', { loaded: megabytes(download.loaded), total: megabytes(download.total) })
}

/**
 * A row of square pixel cells as wide as its box: filled cells show the received share, and while bytes arrive the
 * next cell blinks. The parent sets the width; the cell count follows it.
 */
export function ProgressCells({ value, active, label, className }: { value: number | null; active: boolean; label: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [count, setCount] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current!
    const measure = () => setCount(Math.max(1, Math.floor((element.clientWidth + GAP) / (CELL + GAP))))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const filled = value === null ? 0 : Math.floor(value * count)
  return (
    <span ref={ref} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)} className={cn('fp-progress-cells', className)}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} data-state={i < filled ? 'filled' : active && i === filled ? 'active' : undefined} />
      ))}
    </span>
  )
}

/** Whether the top-bar indicator is on screen: after a short delay while loading, briefly once ready, and on failure. */
function useShown(status: DetectorDownload['status']) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (status === 'failed') setShown(true)
    if (status !== 'loading' && status !== 'ready') return
    const timer = setTimeout(() => setShown(status === 'loading'), status === 'loading' ? SHOW_DELAY_MS : READY_HOLD_MS)
    return () => clearTimeout(timer)
  }, [status])
  return shown
}

/**
 * Download state of the detector beside the brand. From 1280px it is a cell bar with a label; below that it is a
 * 2px line along the top edge of the top bar.
 */
export function DetectorProgress() {
  const { t } = useI18n()
  const { snappy, reduced } = useMotionPreset()
  const download = useDetectorDownload()
  const shown = useShown(download.status)
  const fraction = downloadFraction(download)
  const bytes = downloadBytes(download, t)
  return (
    <AnimatePresence>
      {shown && (
        <motion.div key="detector" className="fp-detector-progress" data-status={download.status}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={reduced ? { duration: 0 } : snappy}>
          {download.status !== 'failed' && <ProgressCells value={fraction} active={download.status === 'loading'} label={t('app.detector')} className="w-[94px]" />}
          {download.status === 'loading' && (
            <span className="fp-detector-progress-label text-meta">{t('app.detector')}{bytes && <span className="tabular-nums"> {bytes}</span>}</span>
          )}
          {download.status === 'ready' && (
            <span role="status" className="fp-detector-progress-label text-meta"><CircleCheck aria-hidden="true" />{t('app.detectorReady')}</span>
          )}
          {download.status === 'failed' && <>
            <span role="status" className="fp-detector-progress-label text-meta"><CircleAlert aria-hidden="true" />{t('app.detectorFailed')}</span>
            <Button variant="ghost" size="xs" onClick={() => loadDetector().catch(() => {})}>{t('app.retry')}</Button>
          </>}
          <span aria-hidden="true" className="fp-detector-progress-line" style={{ transform: `scaleX(${fraction ?? 0})` }} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
