import { COMPLETION_TIMEOUT_MS } from '../shared/completion-request.ts'

export interface ProxyEnvironment {
  PROXY_ALLOWED_HOSTS?: string
}

const DEFAULT_HOSTS = ['openrouter.ai', 'api.openai.com', 'api.anthropic.com']
const MAX_BODY_BYTES = 128 * 1024
const endpointSuffixes = {
  openai: '/chat/completions',
  responses: '/responses',
  anthropic: '/messages',
} as const

class ProxyError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function failure(status: number, message: string) {
  return Response.json({ error: { message } }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 405 ? { Allow: 'POST' } : {}) },
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ProxyError(415, 'The proxy requires a JSON request.')
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    throw new ProxyError(413, 'The request exceeds the 128 KiB limit.')
  }
  const reader = request.body?.getReader()
  if (!reader) throw new ProxyError(400, 'The request body is missing.')
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new ProxyError(413, 'The request exceeds the 128 KiB limit.')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  let payload: unknown
  try { payload = JSON.parse(text) } catch { throw new ProxyError(400, 'The request body is not valid JSON.') }
  if (!isObject(payload)) throw new ProxyError(400, 'The request body must be an object.')
  return payload
}

function upstreamUrl(value: unknown, format: keyof typeof endpointSuffixes, env: ProxyEnvironment) {
  let url: URL
  try {
    if (typeof value !== 'string') throw new Error()
    url = new URL(value)
  } catch { throw new ProxyError(400, 'The upstream URL is invalid.') }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash
    || !url.pathname.endsWith(endpointSuffixes[format])) {
    throw new ProxyError(400, 'Use an HTTPS API endpoint on port 443 without credentials, query parameters or fragments.')
  }
  const hosts = new Set([...DEFAULT_HOSTS, ...(env.PROXY_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean)])
  if (!hosts.has(url.hostname) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(url.hostname)
    || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)) {
    throw new ProxyError(403, 'This API host is not enabled for proxying on this site.')
  }
  return url
}

export async function proxyRequest(request: Request, env: ProxyEnvironment = {}): Promise<Response> {
  if (request.method !== 'POST') return failure(405, 'Use POST for API requests.')
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if ((origin && origin !== new URL(request.url).origin) || (site && site !== 'same-origin' && site !== 'none')) {
    return failure(403, 'Cross-origin proxy requests are not allowed.')
  }
  const authorization = request.headers.get('authorization') ?? ''
  if (!/^Bearer \S+$/i.test(authorization) || authorization.length > 8192) {
    return failure(401, 'Supply an API key for the selected service.')
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(COMPLETION_TIMEOUT_MS)])
  try {
    const payload = await readPayload(request)
    const { format, body } = payload
    if (format !== 'openai' && format !== 'responses' && format !== 'anthropic') {
      throw new ProxyError(400, 'The API protocol is not supported.')
    }
    if (!isObject(body) || typeof body.model !== 'string' || !body.model.trim()
      || (body.stream !== undefined && typeof body.stream !== 'boolean')) {
      throw new ProxyError(400, 'The API request must contain a model and valid streaming option.')
    }
    const url = upstreamUrl(payload.url, format, env)
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: body.stream ? 'text/event-stream' : 'application/json',
    })
    if (format === 'anthropic') {
      headers.set('x-api-key', authorization.slice(7))
      headers.set('anthropic-version', '2023-06-01')
    } else headers.set('Authorization', authorization)

    const upstream = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'manual',
    })
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel()
      return failure(502, 'The upstream returned a redirect. Use its final API address.')
    }
    const contentType = upstream.headers.get('content-type') ?? ''
    const mediaType = contentType.split(';')[0].trim().toLowerCase()
    if (mediaType !== 'text/event-stream' && mediaType !== 'application/json' && !/^application\/[\w.-]+\+json$/.test(mediaType)) {
      await upstream.body?.cancel()
      return failure(upstream.ok ? 502 : upstream.status, `The upstream returned an unsupported response (HTTP ${upstream.status}).`)
    }
    const responseHeaders = new Headers({
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    })
    const retryAfter = upstream.headers.get('retry-after')
    if (retryAfter) responseHeaders.set('Retry-After', retryAfter)
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch (error) {
    if (error instanceof ProxyError) return failure(error.status, error.message)
    if (request.signal.aborted) return failure(499, 'The request was cancelled.')
    if (signal.aborted) return failure(504, 'The upstream request timed out.')
    return failure(502, 'The proxy could not reach the upstream service.')
  }
}
