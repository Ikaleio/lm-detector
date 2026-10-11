import { useSyncExternalStore } from 'react'
import { decodeDetector } from '@fingerpoint/shared/detector-codec'
import type { SharedDetector } from '@fingerpoint/shared/shared-detector'
import { readStaticBytes } from './static-data'

/** `loaded` and `total` are compressed bytes; `total` is 0 until the data manifest arrives. */
export type DetectorDownload =
  | { status: 'idle' }
  | { status: 'loading'; loaded: number; total: number }
  | { status: 'ready' }
  | { status: 'failed' }

let download: DetectorDownload = { status: 'idle' }
let loading: Promise<SharedDetector> | undefined
const listeners = new Set<() => void>()

function publish(next: DetectorDownload) {
  download = next
  for (const listener of listeners) listener()
}

/**
 * One download per page, started when the page opens and shared by every detection.
 * A failure clears it, so the next caller downloads again.
 */
export function loadDetector(): Promise<SharedDetector> {
  if (loading) return loading
  publish({ status: 'loading', loaded: 0, total: 0 })
  let percent = -1
  loading = readStaticBytes('shared_detector.bin', (loaded, total) => {
    // Streams arrive in small pieces; whole percents are enough for the progress bar.
    const next = Math.floor(loaded * 100 / total)
    if (next === percent) return
    percent = next
    publish({ status: 'loading', loaded, total })
  }).then(bytes => {
    const detector = decodeDetector(bytes)
    publish({ status: 'ready' })
    return detector
  }).catch(error => {
    loading = undefined
    publish({ status: 'failed' })
    throw error
  })
  return loading
}

export function useDetectorDownload(): DetectorDownload {
  return useSyncExternalStore(listener => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => download)
}
