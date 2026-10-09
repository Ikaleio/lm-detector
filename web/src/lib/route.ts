import { sendsSpeed, SPEED_BETA } from '@fingerpoint/shared/completion-request'
import type { ApiConfig } from '@fingerpoint/shared/types'

const CHECK_TIMEOUT_MS = 8000
const SETTING_KEY = 'fingerpoint-proxy-v1'
const PROXY_SERVICE = 'fingerpoint-api-proxy'
/** A dummy credential with the real header names: preflights carry names only, and a 401 without a model run is the expected answer. */
const CHECK_KEY = 'sk-cors-check'

type HeaderConfig = Pick<ApiConfig, 'format' | 'serviceTier'>

/** Headers of a direct request. The auto check and the real call share this function, so their header names always match. */
export function directHeaders(config: HeaderConfig, apiKey: string, stream: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json' }
  if (config.format === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    // Anthropic answers browser requests only when the client opts in with this header.
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
    if (sendsSpeed(config)) headers['anthropic-beta'] = SPEED_BETA
  } else headers.Authorization = `Bearer ${apiKey}`
  return headers
}

/** Fetch options shared by the auto check and direct calls. `redirect: 'error'` keeps x-api-key from following a redirect. */
export const directInit: RequestInit = { mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' }

/**
 * Sends the real request shape (same URL, method and header names) with a dummy key and an empty JSON body, so the
 * server rejects it before running a model. Any readable HTTP response means the browser may call the API directly.
 */
export async function allowsDirect(url: string, config: HeaderConfig): Promise<boolean> {
  try {
    await fetch(url, { ...directInit, method: 'POST', headers: directHeaders(config, CHECK_KEY, false), body: '{}', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    return true
  } catch { return false }
}

/** This site's own relay. Static hosts such as GitHub Pages do not have it; a self-deployed Worker replaces it. */
export const SITE_PROXY = '/api/proxy'

/**
 * Normalizes a proxy address typed by the user: HTTPS, or plain HTTP on this machine for `wrangler dev`, without
 * credentials, query or fragment. Returns null for anything else.
 */
export function parseProxyEndpoint(value: string): string | null {
  let url: URL
  try { url = new URL(value.trim()) } catch { return null }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local))) return null
  if (url.username || url.password || url.search || url.hash) return null
  return url.href
}

/**
 * How runs reach the API, shared by every profile: `auto` (the default) checks once per run whether the API allows
 * direct browser calls and otherwise uses this site's proxy; `direct`, `site` and `worker` always take that route.
 * `endpoint` is the Worker address, null while the typed address is empty or invalid.
 */
export type ConnectionMode = 'auto' | 'direct' | 'site' | 'worker'
export interface ConnectionSetting { mode: ConnectionMode; endpoint: string | null }
const modes: ConnectionMode[] = ['auto', 'direct', 'site', 'worker']
let setting: ConnectionSetting | undefined

function loadSetting(): ConnectionSetting {
  let stored: Partial<ConnectionSetting> | null = null
  try { stored = JSON.parse(localStorage.getItem(SETTING_KEY) ?? 'null') } catch { /* unreadable: use the default */ }
  const mode = modes.find(mode => mode === stored?.mode) ?? 'auto'
  const endpoint = typeof stored?.endpoint === 'string' ? parseProxyEndpoint(stored.endpoint) : null
  return { mode, endpoint }
}
export const connectionSetting = () => setting ??= loadSetting()
export function setConnectionSetting(next: ConnectionSetting) {
  setting = next
  try { localStorage.setItem(SETTING_KEY, JSON.stringify(next)) } catch { /* storage unavailable: the setting lasts for this page */ }
}

export type ProxyHealth = 'ok' | 'forbidden' | 'invalid' | 'unreachable'

/**
 * Checks a relay with the GET health answer of `worker/main.js`. A response the browser may not read comes from a
 * Worker whose ALLOWED_ORIGINS leaves out this site, or from a host that is no proxy at all; the no-cors GET tells
 * both apart from an unreachable host.
 */
export async function checkProxy(endpoint: string): Promise<ProxyHealth> {
  const init: RequestInit = { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) }
  let response: Response
  try { response = await fetch(endpoint, init) } catch {
    try {
      const opaque = await fetch(endpoint, { ...init, mode: 'no-cors', redirect: 'follow', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
      return opaque.type === 'opaque' ? 'forbidden' : 'unreachable'
    } catch { return 'unreachable' }
  }
  const body: unknown = await response.json().catch(() => null)
  const service = typeof body === 'object' && body !== null && 'service' in body ? body.service : null
  return response.ok && service === PROXY_SERVICE ? 'ok' : 'invalid'
}
