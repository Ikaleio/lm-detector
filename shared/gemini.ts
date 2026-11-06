import type { ApiConfig } from './types'

/** Protocol adaptation only: sampling, deadlines and scoring stay in the shared request pipeline. */
export function geminiEndpoint(config: ApiConfig): string {
  let url: URL
  try { url = new URL(config.baseUrl) } catch { throw new Error('Base URL must be a valid HTTP or HTTPS URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL must use HTTP or HTTPS without credentials, a query, or a fragment.')
  }
  const model = config.model.replace(/^models\//, '')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) throw new Error('Gemini model must be an ID or models/<model-id>.')
  if (config.effort && config.effort !== 'default') throw new Error('Gemini uses provider-default thinking; effort is not supported.')
  if (config.serviceTier && config.serviceTier !== 'default') throw new Error('Gemini supports only the default service tier.')
  const action = config.stream === false ? 'generateContent' : 'streamGenerateContent'
  const path = url.pathname.replace(/\/+$/, '')
  const endpoint = path.match(/\/models\/([^/]+):(generateContent|streamGenerateContent)$/)
  if (endpoint) {
    if (endpoint[1] !== model || endpoint[2] !== action) throw new Error('The Gemini endpoint does not match model or stream.')
  } else {
    if (/\/(responses|messages|chat\/completions)$/.test(path) || /\/models\//.test(path)) {
      throw new Error('Use a Gemini API base URL or a matching generateContent endpoint.')
    }
    url.pathname = (path.replace(/\/models$/, '') || '/v1beta') + `/models/${model}:${action}`
  }
  if (config.stream !== false) url.searchParams.set('alt', 'sse')
  return url.href
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const items = (value: unknown) => Array.isArray(value) ? value.map(object) : []

/** Normalize Gemini's candidate zero to the finish reasons already understood by both response readers. */
export function geminiResponse(payload: unknown): { text: string; finish: '' | 'stop' | 'length'; reasoning: boolean } {
  const data = object(payload), error = object(data.error), feedback = object(data.promptFeedback)
  if (data.error) throw Object.assign(new Error(String(error.message || 'Gemini request failed.')), { code: 'upstream_stream_error' })
  if (feedback.blockReason && feedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
    throw Object.assign(new Error(`Gemini blocked the prompt (${feedback.blockReason}).`), { code: 'refused' })
  }
  const candidates = items(data.candidates)
  const candidate = candidates.find(value => value.index === 0) ?? candidates.find(value => value.index === undefined) ?? {}
  const reason = candidate.finishReason
  if (reason && !['STOP', 'MAX_TOKENS', 'FINISH_REASON_UNSPECIFIED'].includes(String(reason))) {
    throw Object.assign(new Error(`Gemini response rejected (${reason}).`), { code: 'refused' })
  }
  const parts = items(object(candidate.content).parts)
  return {
    text: parts.filter(part => part.thought !== true && typeof part.text === 'string').map(part => part.text).join(''),
    finish: reason === 'STOP' ? 'stop' : reason === 'MAX_TOKENS' ? 'length' : '',
    reasoning: parts.some(part => part.thought === true),
  }
}
