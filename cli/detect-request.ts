import { stripVTControlCharacters } from 'node:util'
import { completionBody } from '@fingerpoint/shared/completion-request'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import type { Challenge } from '@fingerpoint/shared/types'
import { requestEndpoint, type DetectOptions } from './detect-options'

// Provider payloads have different shapes. Validate the fields used at this boundary.
type Payload = Record<string, any>
export interface Sample {
  state: 'queued' | 'waiting' | 'streaming' | 'complete' | 'truncated' | 'failed' | 'cancelled'
  text: string
  rawText: string
  count: number
  expectedCount: number
  startedAt?: number
  finishedAt?: number
  firstByteMs?: number
  responseModel?: string
  responseId?: string
  error?: string
}

export const minimumNumbers = (expected: number) => Math.max(80, Math.ceil(expected * 0.55))
export const acceptedSample = (sample: Sample) => sample.state === 'complete' || sample.state === 'truncated'
export const cleanText = (value: string) => stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
export function errorMessage(error: unknown, key = '') {
  const message = error instanceof Error ? error.message : String(error)
  return cleanText(key ? message.replaceAll(key, '[REDACTED]') : message).slice(0, 500)
}
const record = (value: unknown): Payload => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
const items = (value: unknown): Payload[] => Array.isArray(value) ? value.map(record) : []
const string = (value: unknown) => typeof value === 'string' ? value : ''
const responseText = (data: Payload) => items(data.output).filter(item => item.type === 'message')
  .flatMap(item => items(item.content)).filter(part => part.type === 'output_text').map(part => string(part.text)).join('')

export async function requestSample(
  options: DetectOptions, challenge: Challenge, signal: AbortSignal, update: (sample: Sample) => void,
): Promise<Sample> {
  const { config } = options
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  const sample: Sample = {
    state: 'waiting', text: '', rawText: '', count: 0, expectedCount: challenge.expected_count, startedAt: Date.now(),
  }
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, options.timeoutMs)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let finish = '', terminal = false, truncated = false
  const report = () => update({ ...sample })
  const metadata = (data: Payload) => {
    if (typeof data.model === 'string') sample.responseModel = data.model
    if (typeof data.id === 'string') sample.responseId = data.id
  }
  const acceptText = (text: string, final = false) => {
    sample.rawText = text
    // A trailing digit can belong to an unfinished SSE token (for example, 3 -> 355).
    const numbers = parseNumbers(final ? text : text.replace(/\d+$/, '')) as number[]
    sample.count = numbers.length
    sample.text = text
    if (!options.strict && numbers.length >= challenge.expected_count) {
      sample.text = numbers.slice(0, challenge.expected_count).join(', ')
      sample.count = challenge.expected_count
      truncated = !final || numbers.length > challenge.expected_count
    }
    report()
  }
  const upstreamError = (data: Payload) => {
    if (data.error || data.type === 'error') {
      throw new Error(`Upstream error: ${string(data.error?.message) || string(data.message) || string(data.error) || 'Request failed.'}`)
    }
  }
  const event = (frame: string) => {
    const payload = frame.split(/\r\n|\r|\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, '')).join('\n')
    if (!payload) return
    if (payload.trim() === '[DONE]') { terminal = true; return }
    let data: Payload
    try { data = record(JSON.parse(payload)) } catch { throw new Error('The SSE response contains invalid JSON.') }
    upstreamError(data)
    metadata(data)
    if (config.format === 'openai') {
      const choice = items(data.choices).find(choice => choice.index === 0) ?? items(data.choices)[0]
      if (choice?.delta?.refusal) throw new Error('The model refused the request.')
      if (choice?.finish_reason) finish = string(choice.finish_reason)
      if (typeof choice?.delta?.content === 'string') acceptText(sample.rawText + choice.delta.content)
    } else if (config.format === 'anthropic') {
      if (data.type === 'message_start') metadata(record(data.message))
      if (data.type === 'content_block_start' && data.content_block?.type === 'text') {
        acceptText(sample.rawText + string(data.content_block.text))
      }
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
        acceptText(sample.rawText + string(data.delta.text))
      }
      if (data.type === 'message_delta') finish = string(data.delta?.stop_reason) || finish
      if (data.type === 'message_stop') terminal = true
    } else {
      if (data.type === 'response.created' || data.type === 'response.in_progress') metadata(record(data.response))
      if (data.type === 'response.output_text.delta') acceptText(sample.rawText + string(data.delta))
      if (data.type === 'response.output_text.done' && !sample.rawText) acceptText(string(data.text), true)
      if (data.type === 'response.output_item.done' && !sample.rawText) {
        acceptText(responseText({ output: [data.item] }), true)
      }
      if (data.type === 'response.refusal.delta') throw new Error('The model refused the request.')
      if (data.type === 'response.completed') {
        const response = record(data.response)
        metadata(response)
        terminal = true
        finish = string(response.status) || 'completed'
        const full = responseText(response)
        if (full) acceptText(full, true)
      }
      if (data.type === 'response.failed' || data.type === 'response.incomplete') {
        throw new Error(`Responses request did not complete: ${string(data.response?.error?.message) || string(data.response?.incomplete_details?.reason) || data.type}.`)
      }
    }
    if (['refusal', 'content_filter'].includes(finish)) throw new Error('The model refused the request.')
  }
  report()
  try {
    combined.throwIfAborted()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', Accept: config.stream ? 'text/event-stream' : 'application/json',
    }
    if (config.format === 'anthropic') {
      headers['x-api-key'] = config.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else headers.Authorization = `Bearer ${config.apiKey}`
    const body = completionBody(config, challenge.prompt)
    if (config.format === 'responses') delete body.max_output_tokens
    else if (config.format === 'openai') delete body.max_tokens
    const init = {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: combined, redirect: 'error' as const,
      timeout: false, // Disable Bun's socket idle timeout; only the first-byte timer applies.
    }
    const response = await fetch(requestEndpoint(config), init)
    if (!response.ok) {
      const body = await response.text()
      let detail = body
      try { const data = record(JSON.parse(body)); detail = string(data.error?.message) || string(data.message) || body } catch { /* Plain-text HTTP error. */ }
      throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`)
    }
    if (response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
      if (!response.body) throw new Error('The server returned an empty SSE body.')
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!terminal && !truncated) {
        const { done, value } = await reader.read()
        if (value?.length && sample.firstByteMs === undefined) {
          clearTimeout(timer)
          sample.firstByteMs = Date.now() - sample.startedAt!
          sample.state = 'streaming'
          report()
        }
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
        // Keep split CRLF delimiters buffered until the next chunk arrives.
        let boundary: RegExpExecArray | null
        while (!terminal && !truncated && (boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
          event(buffer.slice(0, boundary.index))
          buffer = buffer.slice(boundary.index + boundary[0].length)
        }
        if (done) { if (!terminal && !truncated && buffer.trim()) event(buffer); break }
      }
    } else {
      let data: Payload
      try { data = record(await response.json()) } catch (error) {
        if (combined.aborted) throw error
        throw new Error('The server did not return valid JSON or SSE.')
      }
      clearTimeout(timer)
      sample.firstByteMs = Date.now() - sample.startedAt!
      upstreamError(data)
      metadata(data)
      let text: string
      if (config.format === 'responses') {
        text = responseText(data); finish = string(data.status); terminal = finish === 'completed'
      } else if (config.format === 'anthropic') {
        text = items(data.content).filter(part => part.type === 'text').map(part => string(part.text)).join('')
        finish = string(data.stop_reason); terminal = true
      } else {
        const choice = items(data.choices)[0]
        if (choice?.message?.refusal) throw new Error('The model refused the request.')
        text = string(choice?.message?.content); finish = string(choice?.finish_reason); terminal = true
      }
      if (['refusal', 'content_filter'].includes(finish)) throw new Error('The model refused the request.')
      if (!terminal || !['stop', 'end_turn', 'completed'].includes(finish)) {
        throw new Error(`The response did not complete (${finish || 'missing finish status'}).`)
      }
      acceptText(text, true)
    }
    combined.throwIfAborted()
    if (!truncated && (!terminal || !['stop', 'end_turn', 'completed'].includes(finish))) {
      throw new Error(`The response did not complete (${finish || 'missing finish status'}).`)
    }
    if (!truncated) acceptText(sample.rawText, true)
    if (sample.count < minimumNumbers(challenge.expected_count)) {
      throw new Error(`Too few valid numbers: ${sample.count}; need at least ${minimumNumbers(challenge.expected_count)}.`)
    }
    sample.state = truncated ? 'truncated' : 'complete'
  } catch (error) {
    sample.state = signal.aborted ? 'cancelled' : 'failed'
    sample.error = signal.aborted ? 'Cancelled.' : timedOut
      ? `Timed out after ${options.timeoutMs / 1000}s waiting for ${config.stream ? 'the first SSE byte' : 'the JSON response'}.`
      : errorMessage(error, config.apiKey)
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
    sample.finishedAt = Date.now()
    report()
  }
  return { ...sample }
}
