import type { CodedError, ErrorCode } from './types'
import type { Completion } from './reference'
import { parseNumbers } from './fingerprint-core.js'
import { readBefore, USAGE_GRACE_MS, type ThroughputMeter } from './throughput'

export type Format = 'openai' | 'responses' | 'anthropic'
export interface CompletionResult {
  text: string
  responseModel?: string
  responseId?: string
  usage?: unknown
  /** The whole reply that `usage` counts, including text after a number cap; absent until the reply has ended. */
  usageText?: string
  providerReported?: string
  finishReason?: string
  completion: Completion
  capped?: boolean
}
const coded = (message: string, code: ErrorCode, extra?: Partial<CodedError>): CodedError => Object.assign(new Error(message), { code }, extra)
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function object(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {}
}
function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : []
}
function string(value: unknown): string { return typeof value === 'string' ? value : '' }
const outputText = (response: Record<string, unknown>): string => array(response.output).filter(x => x.type === 'message').flatMap(x => array(x.content)).filter(x => x.type === 'output_text').map(x => string(x.text)).join('')

/** A meter also keeps reading for USAGE_GRACE_MS after the cap so that the usage report can arrive; the accepted text does not change. */
export async function readCompletion(response: Response, format: Format, onText?: (text: string) => void, onProgress?: (result: CompletionResult) => void, maxNumbers?: number, meter?: ThroughputMeter): Promise<CompletionResult> {
  let text = '', raw = '', finish = '', terminal = false, ended = false, capped = false
  let responseModel: string | undefined, responseId: string | undefined, providerReported: string | undefined, usage: unknown
  const snapshot = (): CompletionResult => ({ text, responseModel, responseId, usage, usageText: terminal ? raw : undefined, providerReported, finishReason: finish || undefined,
    capped, completion: capped ? 'truncated' : terminal && ['stop', 'end_turn', 'completed'].includes(finish) ? 'complete' : ['length', 'max_tokens', 'incomplete', 'max_output_tokens'].includes(finish) || (ended && !terminal && text.length > 0) ? 'truncated' : 'unknown' })
  const report = () => onProgress?.(snapshot())
  const metadata = (value: unknown) => {
    const d = object(value)
    if (typeof d.model === 'string') responseModel = d.model
    if (typeof d.id === 'string') responseId = d.id
    if (typeof d.provider === 'string') providerReported = d.provider
    if (d.usage) usage = d.usage
  }
  const emit = (part: string) => {
    raw += part
    meter?.update(raw)
    if (capped) return
    text += part
    onText?.(text)
    report()
    if (maxNumbers === undefined) return
    // A trailing digit may still grow (for example, 3 -> 355); count only complete integers.
    const numbers = parseNumbers(text.replace(/\d+$/, '')) as number[]
    if (numbers.length >= maxNumbers) {
      text = numbers.slice(0, maxNumbers).join(', ')
      capped = true
    }
  }
  try {
    if (!response.ok) {
      let d: Record<string, unknown>
      try { d = object(await response.json()) } catch { throw coded(`代理不可用（HTTP ${response.status}），请确认站点包含 API 代理函数`, 'proxy_unavailable', { httpStatus: response.status }) }
      metadata(d)
      const error = object(d.error)
      // The proxy marks an upstream that answered with a web page instead of an API reply.
      throw coded(`HTTP ${response.status}：${string(error.message) || string(d.message) || '请求失败'}`, error.code === 'upstream_not_api' ? 'upstream_not_api' : 'http', { httpStatus: response.status })
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      let d: Record<string, unknown>
      try { d = object(await response.json()) } catch { throw coded('接口未返回 JSON 或 SSE，请检查部署是否包含 API Function', 'not_json') }
      metadata(d)
      if (format === 'responses') { text = outputText(d); finish = string(d.status); terminal = d.status === 'completed' }
      else if (format === 'anthropic') { text = array(d.content).filter(x => x.type === 'text').map(x => string(x.text)).join(''); finish = string(d.stop_reason); terminal = true }
      else { const c = array(d.choices)[0] ?? {}, message = object(c.message); text = string(message.content); finish = message.refusal ? 'refusal' : string(c.finish_reason); terminal = true }
      raw = text
      onText?.(text); report()
    } else {
      if (!response.body) throw coded('接口未返回流式正文', 'no_stream_body')
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let buffer = ''
      const event = (frame: string) => {
        const payload = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n')
        if (!payload) return
        if (payload.trim() === '[DONE]') { terminal = true; report(); return }
        let d: Record<string, unknown>
        try { d = object(JSON.parse(payload)) } catch { throw coded('流式数据不是有效的 JSON', 'bad_stream_json') }
        const previousUsage = usage
        metadata(d); metadata(d.response)
        if (d.error || d.type === 'error') throw coded(string(object(d.error).message) || string(d.message) || '上游流式调用失败', 'upstream_stream_error')
        if (format === 'openai') {
          const choices = array(d.choices), c = choices.find(c => c.index === 0) ?? choices[0] ?? {}, delta = object(c.delta)
          if (delta.reasoning_content || delta.reasoning) meter?.reasoning()
          if (delta.refusal) finish = 'refusal'
          if (c.finish_reason) finish = string(c.finish_reason)
          if (typeof delta.content === 'string') emit(delta.content)
        } else if (format === 'anthropic') {
          const block = object(d.content_block), delta = object(d.delta)
          if (d.type === 'message_start') metadata(d.message)
          if (block.type === 'thinking' || block.type === 'redacted_thinking' || delta.type === 'thinking_delta') meter?.reasoning()
          if (d.type === 'content_block_start' && block.type === 'text' && block.text) emit(string(block.text))
          if (d.type === 'content_block_delta' && delta.type === 'text_delta') emit(string(delta.text))
          if (d.type === 'message_delta') { finish = string(delta.stop_reason) || finish; usage = { ...object(previousUsage), ...object(d.usage) } }
          if (d.type === 'message_stop') terminal = true
        } else {
          if (string(d.type).startsWith('response.reasoning')) meter?.reasoning()
          if (d.type === 'response.output_text.delta') emit(string(d.delta))
          if (d.type === 'response.output_item.done' && !text) { const fallback = outputText({ output: [d.item] }); if (fallback) emit(fallback) }
          const type = string(d.type), response = object(d.response)
          if (['response.completed', 'response.failed', 'response.incomplete'].includes(type)) {
            finish = string(response.status) || type.slice(9); terminal = type === 'response.completed'
            const full = outputText(response); if (full && !capped) { text = full; onText?.(text) }
            report()
            if (!terminal) throw coded(string(object(response.error).message) || 'Responses 输出未完整结束', 'responses_incomplete')
          }
        }
        report()
      }
      let deadline = Infinity, draining = true, finishAtCap = ''
      const reading = () => !terminal && (!capped || (!!meter && draining))
      // Errors after the cap cannot affect the accepted text; they only end the wait for usage.
      const handle = (frame: string) => { if (!capped) return event(frame); try { event(frame) } catch { draining = false } }
      try {
        while (reading()) {
          if (capped && deadline === Infinity) { deadline = performance.now() + USAGE_GRACE_MS; finishAtCap = finish }
          const chunk = await readBefore(reader, deadline)
          if (!chunk) break
          const { done, value } = chunk
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
          let match: RegExpExecArray | null
          while (reading() && (match = /\r?\n\r?\n/.exec(buffer))) { handle(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length) }
          if (done) { if (reading() && buffer.trim()) handle(buffer); break }
        }
        if (deadline !== Infinity) finish = finishAtCap
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
    }
    ended = true
    if (['refusal', 'content_filter'].includes(finish)) throw coded('渠道拒绝了此请求', 'refused')
    if (!capped && snapshot().completion !== 'complete') throw coded('输出未完整结束，本条不计入检测或入库', 'incomplete')
    if (maxNumbers !== undefined && !capped) {
      const numbers = parseNumbers(text) as number[]
      if (numbers.length > maxNumbers) {
        text = numbers.slice(0, maxNumbers).join(', ')
        capped = true
      }
    }
    if (!text) throw coded('输出未完整结束，本条不计入检测或入库', 'incomplete')
    return snapshot()
  } catch (error) {
    ended = true
    report()
    const failure = error instanceof Error ? error : new Error(String(error))
    Object.assign(failure, { completionDetails: { ...snapshot(), finish, terminal } })
    throw failure
  }
}
