// @ts-check
/**
 * Fingerpoint API proxy: an HTTPS forwarding proxy for LLM API requests whose endpoint does not allow browser CORS.
 * This single file is a complete Cloudflare Worker (`export default { fetch }`). The shared site entry point
 * `api/proxy.ts` and the Vite dev server import `proxyRequest`, so every deployment runs the same code.
 *
 * Request: POST with `Authorization: Bearer <upstream key>` and a JSON body `{ url, format, body }`, where `url` is the
 * complete upstream endpoint and `format` is `openai`, `responses` or `anthropic`. JSON and SSE responses stream back
 * unchanged. The proxy follows no redirects, forwards no cookies and stores no keys.
 *
 * Cross-origin callers must be listed in `ALLOWED_ORIGINS` (comma-separated origins, or `*`). Same-origin calls, as
 * from a Pages deployment of the web app, need no configuration.
 *
 * The Workers runtime treats every named export of this module as an entrypoint and accepts only functions and
 * handlers, so the module exports functions and keeps its constants private.
 */

/** Deadline of one upstream request, equal to COMPLETION_TIMEOUT_MS of the clients in `shared/completion-request.ts`. */
const UPSTREAM_TIMEOUT_MS = 250_000
/** Used when a Worker has no ALLOWED_ORIGINS variable, as after a Playground deploy; `wrangler.json` sets the same value. */
const DEFAULT_ALLOWED_ORIGINS = 'https://lm.ikale.io'
/** Beta header that the Anthropic API needs for `speed`, equal to SPEED_BETA in `shared/completion-request.ts`. */
const SPEED_BETA = 'fast-mode-2026-02-01'

const MAX_BODY_BYTES = 128 * 1024
const ENDPOINT_SUFFIXES = { openai: '/chat/completions', responses: '/responses', anthropic: '/messages' }
const PREFLIGHT_MAX_AGE = '7200'

/** @typedef {keyof typeof ENDPOINT_SUFFIXES} Format */
/** @typedef {{ allowedOrigins?: readonly string[] }} ProxyOptions */
/** @typedef {Error & { status: number }} ProxyFailure */

/** @param {number} status @param {string} message @returns {ProxyFailure} */
const rejection = (status, message) => Object.assign(new Error(message), { status })

/** @param {unknown} error @returns {error is ProxyFailure} */
const isRejection = error => error instanceof Error && typeof (/** @type {Partial<ProxyFailure>} */ (error)).status === 'number'

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Decides the CORS answer for a request: `same` for same-origin or originless calls (no CORS headers needed), the
 * origin string to echo for an allowed cross-origin caller, or `null` for a forbidden one.
 * @param {Request} request @param {readonly string[]} allowed @returns {string | null}
 */
function corsOrigin(request, allowed) {
  const origin = request.headers.get('origin')
  if (!origin || origin === new URL(request.url).origin) return 'same'
  return allowed.includes('*') || allowed.includes(origin) ? origin : null
}

/** @param {string} origin @returns {Record<string, string>} */
const corsHeaders = origin => origin === 'same' ? {} : { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Retry-After', Vary: 'Origin' }

/**
 * @param {number} status @param {string} message @param {string} origin
 * @param {string} [code] Machine-readable reason, which the web app turns into a hint.
 */
function failure(status, message, origin, code) {
  return Response.json({ error: code ? { message, code } : { message } }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 405 ? { Allow: 'GET, POST, OPTIONS' } : {}), ...corsHeaders(origin) },
  })
}

/** @param {Request} request @returns {Promise<Record<string, unknown>>} */
async function readPayload(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw rejection(415, 'The proxy requires a JSON request.')
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    throw rejection(413, 'The request exceeds the 128 KiB limit.')
  }
  const reader = request.body?.getReader()
  if (!reader) throw rejection(400, 'The request body is missing.')
  const decoder = new TextDecoder()
  let size = 0, text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw rejection(413, 'The request exceeds the 128 KiB limit.')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  /** @type {unknown} */
  let payload
  try { payload = JSON.parse(text) } catch { throw rejection(400, 'The request body is not valid JSON.') }
  if (!isObject(payload)) throw rejection(400, 'The request body must be an object.')
  return payload
}

/** @param {unknown} value @param {Format} format */
function upstreamUrl(value, format) {
  /** @type {URL} */
  let url
  try {
    if (typeof value !== 'string') throw new Error('not a string')
    url = new URL(value)
  } catch { throw rejection(400, 'The upstream URL is invalid.') }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash
    || !url.pathname.endsWith(ENDPOINT_SUFFIXES[format])) {
    throw rejection(400, 'Use an HTTPS API endpoint on port 443 without credentials, query parameters or fragments.')
  }
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(url.hostname)
    || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)) {
    throw rejection(400, 'Use a public API hostname.')
  }
  return url
}

/**
 * Handles one proxy request: CORS preflight, a GET health check for clients that test a configured proxy, or the
 * relayed POST.
 * @param {Request} request @param {ProxyOptions} [options] @returns {Promise<Response>}
 */
export async function proxyRequest(request, options = {}) {
  const origin = corsOrigin(request, options.allowedOrigins ?? [])
  if (request.method === 'OPTIONS') {
    if (origin === null) return new Response(null, { status: 403, headers: { Vary: 'Origin' } })
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Max-Age': PREFLIGHT_MAX_AGE,
      },
    })
  }
  if (origin === null) return failure(403, 'This origin is not allowed to use the proxy.', 'same')
  if (request.method === 'GET') {
    return Response.json({ service: 'fingerpoint-api-proxy', formats: Object.keys(ENDPOINT_SUFFIXES) }, { headers: { 'Cache-Control': 'no-store', ...corsHeaders(origin) } })
  }
  if (request.method !== 'POST') return failure(405, 'Use POST for API requests.', origin)
  // Fetch metadata catches cross-site calls from browsers that omit Origin; allowed cross-origin callers are expected.
  const site = request.headers.get('sec-fetch-site')
  if (origin === 'same' && site && site !== 'same-origin' && site !== 'none') {
    return failure(403, 'Cross-origin proxy requests are not allowed.', origin)
  }
  const authorization = request.headers.get('authorization') ?? ''
  if (!/^Bearer \S+$/i.test(authorization) || authorization.length > 8192) {
    return failure(401, 'Supply an API key for the selected service.', origin)
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)])
  try {
    const payload = await readPayload(request)
    const { format, body } = payload
    if (format !== 'openai' && format !== 'responses' && format !== 'anthropic') {
      throw rejection(400, 'The API protocol is not supported.')
    }
    if (!isObject(body) || typeof body.model !== 'string' || !body.model.trim()
      || (body.stream !== undefined && typeof body.stream !== 'boolean')) {
      throw rejection(400, 'The API request must contain a model and valid streaming option.')
    }
    const url = upstreamUrl(payload.url, format)
    const headers = new Headers({ 'Content-Type': 'application/json', Accept: body.stream ? 'text/event-stream' : 'application/json' })
    if (format === 'anthropic') {
      headers.set('x-api-key', authorization.slice(7))
      headers.set('anthropic-version', '2023-06-01')
      if (body.speed !== undefined) headers.set('anthropic-beta', SPEED_BETA)
    } else headers.set('Authorization', authorization)

    const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'manual' })
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel()
      return failure(502, 'The upstream returned a redirect. Use its final API address.', origin)
    }
    const contentType = upstream.headers.get('content-type') ?? ''
    const mediaType = contentType.split(';')[0].trim().toLowerCase()
    if (mediaType !== 'text/event-stream' && mediaType !== 'application/json' && !/^application\/[\w.-]+\+json$/.test(mediaType)) {
      await upstream.body?.cancel()
      // A successful answer that is no API reply is almost always a web page behind a wrong path in the Base URL.
      if (upstream.ok) {
        return failure(502, `The upstream returned a web page or other non-API content (HTTP ${upstream.status}). Check the path in the Base URL.`, origin, 'upstream_not_api')
      }
      return failure(upstream.status, `The upstream returned an unsupported response (HTTP ${upstream.status}).`, origin)
    }
    const responseHeaders = new Headers({
      'Content-Type': contentType, 'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no',
      ...corsHeaders(origin),
    })
    const retryAfter = upstream.headers.get('retry-after')
    if (retryAfter) responseHeaders.set('Retry-After', retryAfter)
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
  } catch (error) {
    if (isRejection(error)) return failure(error.status, error.message, origin)
    if (request.signal.aborted) return failure(499, 'The request was cancelled.', origin)
    if (signal.aborted) return failure(504, 'The upstream request timed out.', origin)
    return failure(502, 'The proxy could not reach the upstream service.', origin)
  }
}

/**
 * Normalizes each entry to the form browsers send in `Origin` (lowercase, no path or trailing slash), so a value
 * copied from the address bar still matches. Entries that are not URLs are dropped.
 * @param {string | undefined} value @returns {string[]}
 */
export const parseOrigins = value => (value ?? DEFAULT_ALLOWED_ORIGINS).split(',').map(origin => origin.trim()).flatMap(origin => {
  if (origin === '*') return [origin]
  try { return [new URL(origin).origin] } catch { return [] }
})

export default {
  /** @param {Request} request @param {{ ALLOWED_ORIGINS?: string }} env */
  fetch(request, env) {
    return proxyRequest(request, { allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS) })
  },
}
