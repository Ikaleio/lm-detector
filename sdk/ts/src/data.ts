import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { decompress } from 'fzstd'
import { cacheRoot } from '@fingerpoint/shared/cache-dir'
import { decodeDetector } from '@fingerpoint/shared/detector-codec'
import { supportsSharedDetector, type SharedDetector } from '@fingerpoint/shared/shared-detector'
import type { Bank } from '@fingerpoint/shared/types'
import { DEFAULT_DATA_URLS } from './types.js'

/** Bump when the bundle layout changes; older SDKs then refuse the data instead of misreading it. */
const DATA_SCHEMA = 'lmfpd-data-v1'
const DETECTOR_SCHEMA = 'shared-detector-v2'
const DETECTOR = 'shared_detector.bin'

export interface ReferenceData { bank: Bank; detector: SharedDetector }

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/**
 * Scoring reads only `built_at` and the model names and counts from the bank. `bundle.json` repeats them at its top
 * level, so it can stand in for `unified_bank.json`.
 */
function referenceData(bank: Bank, detector: SharedDetector): ReferenceData {
  if (!Array.isArray(bank?.models) || !supportsSharedDetector(bank, detector)) {
    throw new Error('The reference bank does not match its detector.')
  }
  return { bank, detector }
}

/** Reads `unified_bank.json` and `shared_detector.bin` from a directory such as `projects/data`. */
async function readDir(dir: string): Promise<ReferenceData> {
  const read = async <T>(name: string, parse: (bytes: Uint8Array) => T) => {
    const path = join(dir, name)
    try { return parse(await readFile(path)) } catch { throw new Error(`Cannot read ${path}.`) }
  }
  return referenceData(await read('unified_bank.json', bytes => JSON.parse(text(bytes))), await read(DETECTOR, decodeDetector))
}

/** The cache file holds the u32 little-endian length of `bundle.json`, `bundle.json`, then `shared_detector.bin`. */
async function readCache(path: string) {
  try {
    const [bytes, info] = await Promise.all([readFile(path), stat(path)])
    const length = bytes.readUInt32LE(0)
    const bundle = JSON.parse(text(bytes.subarray(4, 4 + length)))
    const data = referenceData(bundle, decodeDetector(bytes.subarray(4 + length)))
    return { data, version: bundle.files[DETECTOR].sha256 as string, checkedAt: info.mtimeMs }
  } catch {
    return undefined // A missing or damaged cache is downloaded again.
  }
}

/** Best effort: a failed write only means the next load downloads again. */
async function writeCache(path: string, bundle: Uint8Array, detector: Uint8Array) {
  const length = Buffer.alloc(4)
  length.writeUInt32LE(bundle.length)
  const staging = `${path}.tmp-${randomBytes(8).toString('hex')}`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(staging, Buffer.concat([length, bundle, detector]))
    await rename(staging, path)
  } catch {
    await rm(staging, { force: true }).catch(() => {})
  }
}

async function download(url: string, timeoutMs: number): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Downloads the data from the first working source and caches it. Returns undefined when the source still serves
 * `cachedVersion`, after marking the cache as checked.
 */
async function refresh(sources: readonly string[], cachePath: string, cachedVersion?: string): Promise<ReferenceData | undefined> {
  const failures: string[] = []
  for (const source of sources) {
    try {
      const bundleBytes = await download(`${source}bundle.json`, 10_000)
      const bundle = JSON.parse(text(bundleBytes))
      if (bundle.schema !== DATA_SCHEMA || bundle.detector_schema !== DETECTOR_SCHEMA) {
        throw new Error(`data schema ${bundle.schema}/${bundle.detector_schema} is not supported by this SDK version. Upgrade lmfpd.`)
      }
      // The detector's SHA-256 names its version.
      const file: { parts: string[]; sha256: string } = bundle.files[DETECTOR]
      if (file.sha256 === cachedVersion) {
        const now = new Date()
        await utimes(cachePath, now, now).catch(() => {})
        return undefined
      }
      const parts: Uint8Array[] = []
      for (const part of file.parts) parts.push(await download(`${source}chunks/${part}`, 120_000))
      const detectorBytes = decompress(Buffer.concat(parts))
      const data = referenceData(bundle, decodeDetector(detectorBytes))
      await writeCache(cachePath, bundleBytes, detectorBytes)
      return data
    } catch (error) {
      failures.push(`${source} (${message(error)})`)
    }
  }
  throw new Error(`lmfpd: cannot download reference data from ${failures.join(', ')}`)
}

/**
 * A single source that is not an http(s) URL is a local directory, read as is. For URLs, answers from the cache file
 * when there is one (stale-while-revalidate): a cache last checked `ttl` seconds ago or earlier is refreshed in the
 * background for the next load. Without a cache it downloads.
 */
export async function loadData(
  source: string | readonly string[] = DEFAULT_DATA_URLS, cachePath = join(cacheRoot(), 'data.bin'), ttl = 86_400,
): Promise<ReferenceData> {
  const sources = typeof source === 'string' ? [source] : source
  if (sources.length === 1 && !/^https?:\/\//i.test(sources[0])) return readDir(sources[0])
  const cached = await readCache(cachePath)
  if (!cached) return (await refresh(sources, cachePath))! // Without a cached version a successful refresh returns data.
  if (Date.now() - cached.checkedAt >= ttl * 1000) refresh(sources, cachePath, cached.version).catch(() => {})
  return cached.data
}
