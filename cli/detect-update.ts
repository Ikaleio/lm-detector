import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectUpdateCommand, type UpdateCommand } from './update-command'

declare const FPD_BUILD_VERSION: string
const currentVersion = typeof FPD_BUILD_VERSION === 'string' ? FPD_BUILD_VERSION : undefined
const registries = [
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
  'https://mirrors.cloud.tencent.com/npm',
]
const hour = 60 * 60 * 1000
const maxBytes = 32 * 1024

export interface UpdateNotice extends UpdateCommand { current: string; latest: string }
interface Cache { checkedAt: number; checkedFor: string; latest?: string; success: boolean }

function stableVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length < 64 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    && value.split('.').every(part => Number.isSafeInteger(Number(part)))
}

function newer(candidate: string, current: string) {
  const a = candidate.split('.').map(Number), b = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

function cachePath() {
  const home = homedir()
  const root = process.env.XDG_CACHE_HOME || (process.platform === 'darwin' ? join(home, 'Library/Caches')
    : process.platform === 'win32' ? process.env.LOCALAPPDATA || join(home, 'AppData/Local') : join(home, '.cache'))
  return join(root, 'lmfpd', 'update.json')
}

async function registryVersion(registry: string, signal: AbortSignal): Promise<string | undefined> {
  const response = await fetch(`${registry}/lmfpd/latest`, { signal, redirect: 'error', headers: { accept: 'application/json' } })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    return
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = '', size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) return
      text += decoder.decode(value, { stream: true })
    }
    const data = JSON.parse(text + decoder.decode())
    if (data.name === 'lmfpd' && stableVersion(data.version)) return data.version
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

// The caller never awaits this work. stop() cancels it and returns only an already available notice.
export function startUpdateCheck(): () => UpdateNotice | undefined {
  if (!stableVersion(currentVersion)) return () => undefined
  const version = currentVersion
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  timer.unref()
  let stopped = false, latest: string | undefined, command: UpdateCommand | undefined

  void (async () => {
    const path = cachePath()
    command = await detectUpdateCommand(process.argv[1] || fileURLToPath(import.meta.url))
    let cache: Cache | undefined
    try {
      const text = await readFile(path, 'utf8')
      if (text.length <= maxBytes) cache = JSON.parse(text)
    } catch {}
    const age = Date.now() - (cache?.checkedAt ?? NaN)
    if (cache?.checkedFor === version && age >= 0) {
      if (stableVersion(cache.latest)) latest = cache.latest
      if (age < (cache.success === true ? 6 * hour : hour)) return
    }
    if (controller.signal.aborted) return
    let successes = 0
    await Promise.allSettled(registries.map(async registry => {
      const candidate = await registryVersion(registry, controller.signal)
      if (!candidate) return
      successes++
      if (!latest || newer(candidate, latest)) latest = candidate
    }))
    if (stopped && successes === 0) return
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify({ checkedAt: Date.now(), checkedFor: version, latest, success: successes > 0 }), { mode: 0o600 })
    await rename(temporary, path)
  })().catch(() => {}).finally(() => clearTimeout(timer))

  return () => {
    stopped = true
    clearTimeout(timer)
    controller.abort()
    if (!latest || !command || !newer(latest, version)) return
    // Pin runner invocations so their cached `latest` alias cannot launch the old version again.
    return { current: version, latest, ...command, command: command.temporary ? command.command.replace('@latest', `@${latest}`) : command.command }
  }
}
