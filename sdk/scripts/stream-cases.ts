import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Api } from '../ts/src/index'

export interface StreamCase {
  name: string
  api: Api
  stream: boolean
  strict: false
  expected_count: number
  response: { status: number; content_type: string; body: string }
}

/** Serves every POST under `/<case name>/` with that case's canned response. */
export async function serveStreamCases(cases: Pick<StreamCase, 'name' | 'response'>[]) {
  const server = createServer((request, response) => {
    const item = cases.find(item => request.url?.startsWith(`/${item.name}/`))
    request.resume()
    if (request.method !== 'POST' || !item) return response.writeHead(404).end('not found')
    response.writeHead(item.response.status, { 'Content-Type': item.response.content_type }).end(item.response.body)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { port: (server.address() as AddressInfo).port, close: () => server.close() }
}

/** Deterministic replies: x = (x * 1103515245 + 12345) mod 2^31 from seed 1, value 1 + x mod 355. */
function numbers(count: number) {
  let x = 1n
  return Array.from({ length: count }, () => {
    x = (x * 1103515245n + 12345n) % 2n ** 31n
    return Number(1n + x % 355n)
  })
}
const text = (count: number) => numbers(count).join(', ')
/** Five numbers per delta; every delta after the first starts with ", ". */
function deltas(count: number) {
  const values = numbers(count), parts: string[] = []
  for (let i = 0; i < values.length; i += 5) parts.push((i ? ', ' : '') + values.slice(i, i + 5).join(', '))
  return parts
}
const sse = (events: [string | undefined, unknown][]) => events
  .map(([type, data]) => `${type ? `event: ${type}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`).join('')
const ok = (body: string, content_type = 'text/event-stream') => ({ status: 200, content_type, body })

const responsesEvents = (count: number): [string, unknown][] => [
  ['response.created', { type: 'response.created', response: { id: 'resp_1', model: 'test-model' } }],
  ...deltas(count).map((delta): [string, unknown] => ['response.output_text.delta', { type: 'response.output_text.delta', delta }]),
  ['response.completed', { type: 'response.completed', response: {
    status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: text(count) }] }],
  } }],
]
const chatEvents = (count: number, finish: boolean): [undefined, unknown][] => [
  ...deltas(count).map((content): [undefined, unknown] => [undefined, { id: 'chat_1', model: 'test-model', choices: [{ index: 0, delta: { content } }] }]),
  ...finish ? [[undefined, { id: 'chat_1', model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }] as [undefined, unknown]] : [],
  [undefined, '[DONE]'],
]
const messagesEvents = (count: number, stopReason: string): [string, unknown][] => [
  ['message_start', { type: 'message_start', message: { id: 'msg_1', model: 'test-model' } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ...deltas(count).map((text): [string, unknown] => ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }]),
  ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason } }],
  ['message_stop', { type: 'message_stop' }],
]

const streamCase = (name: string, api: Api, stream: boolean, expected_count: number, response: StreamCase['response']): StreamCase =>
  ({ name, api, stream, strict: false, expected_count, response })

export const STREAM_CASES: StreamCase[] = [
  streamCase('responses-sse', 'responses', true, 150, ok(sse(responsesEvents(150)))),
  streamCase('chat-sse', 'chat_completions', true, 150, ok(sse(chatEvents(150, true)))),
  streamCase('messages-sse', 'messages', true, 150, ok(sse(messagesEvents(150, 'end_turn')))),
  streamCase('chat-sse-truncated', 'chat_completions', true, 150, ok(sse(chatEvents(200, true)))),
  streamCase('chat-json', 'chat_completions', false, 150, ok(JSON.stringify({
    id: 'chat_1', model: 'test-model', choices: [{ index: 0, message: { content: text(150) }, finish_reason: 'stop' }],
  }), 'application/json')),
  streamCase('responses-json-incomplete', 'responses', false, 150, ok(JSON.stringify({
    status: 'incomplete', output: [{ type: 'message', content: [{ type: 'output_text', text: text(150) }] }],
  }), 'application/json')),
  streamCase('messages-sse-refusal', 'messages', true, 150, ok(sse(messagesEvents(150, 'refusal')))),
  streamCase('http-401', 'responses', true, 150,
    { status: 401, content_type: 'application/json', body: JSON.stringify({ error: { message: 'Invalid key test-key' } }) }),
  streamCase('chat-sse-no-finish', 'chat_completions', true, 150, ok(sse(chatEvents(150, false)))),
  streamCase('chat-sse-too-few', 'chat_completions', true, 150, ok(sse(chatEvents(10, true)))),
  streamCase('responses-sse-failed', 'responses', true, 150, ok(sse([
    ['response.failed', { type: 'response.failed', response: { error: { message: 'boom' } } }],
  ]))),
  streamCase('chat-sse-upstream-error', 'chat_completions', true, 150, ok(sse([[undefined, { error: { message: 'overloaded' } }]]))),
  streamCase('not-json', 'responses', false, 150, ok('<html>', 'text/html')),
]
