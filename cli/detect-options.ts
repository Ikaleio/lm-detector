import { parseArgs } from 'node:util'
import type { ApiConfig } from '@fingerpoint/shared/types'

export interface DetectOptions {
  config: ApiConfig
  api: 'responses' | 'chatcompletion' | 'message'
  parallel: number
  repeat: number
  strict: boolean
  timeoutMs: number
  input?: string
  output?: string
  bank?: string
  challenges?: string
  json: boolean
}

function positiveInteger(value: string, name: string, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`)
  }
  return number
}

export function parseOptions(args: string[], env = process.env): DetectOptions | undefined {
  const { values } = parseArgs({ args: args.map(arg => arg === '-ns' ? '--no-stream' : arg), options: {
    model: { type: 'string', short: 'm' }, apikey: { type: 'string', short: 'k' }, baseurl: { type: 'string', short: 'b' },
    api: { type: 'string', short: 'a' }, parallel: { type: 'string', short: 'p' },
    repeat: { type: 'string', short: 'n' }, strict: { type: 'boolean', short: 's' },
    'no-stream': { type: 'boolean' }, timeout: { type: 'string' }, effort: { type: 'string', short: 'e' },
    input: { type: 'string' }, output: { type: 'string' }, bank: { type: 'string' },
    challenges: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    'base-url': { type: 'string' }, 'api-key': { type: 'string' },
  }, strict: true, allowPositionals: false })
  if (values.help) return undefined
  const api = values.api ?? 'responses'
  if (api !== 'responses' && api !== 'chatcompletion' && api !== 'message') {
    throw new Error('--api must be responses, chatcompletion, or message.')
  }
  const parallel = positiveInteger(values.parallel ?? '3', '--parallel', 3)
  const repeat = positiveInteger(values.repeat ?? '1', '--repeat')
  const timeout = Number(values.timeout ?? '120')
  if (!Number.isFinite(timeout) || timeout < 0.001 || timeout > 2_147_483.647) {
    throw new Error('--timeout must be between 0.001 and 2147483.647 seconds.')
  }
  if (values.input && (repeat !== 1 || values.challenges)) {
    throw new Error('--input cannot be combined with --repeat or --challenges.')
  }
  const config: ApiConfig = {
    model: (values.model ?? env.MODEL ?? '').trim(),
    apiKey: (values.apikey ?? values['api-key'] ?? env.API_KEY ?? '').trim(),
    baseUrl: (values.baseurl ?? values['base-url'] ?? env.BASE_URL ?? '').trim(),
    format: api === 'message' ? 'anthropic' : api === 'chatcompletion' ? 'openai' : 'responses',
    stream: !values['no-stream'], effort: values.effort ?? '',
  }
  if (!values.input) {
    for (const [name, value, variable] of [
      ['model', config.model, 'MODEL'], ['apikey', config.apiKey, 'API_KEY'], ['baseurl', config.baseUrl, 'BASE_URL'],
    ]) {
      if (!value) throw new Error(`Set --${name} or the ${variable} environment variable.`)
    }
  }
  return {
    config, api, parallel, repeat, timeoutMs: Math.round(timeout * 1000),
    strict: !!values.strict, json: !!values.json,
    input: values.input, output: values.output, bank: values.bank, challenges: values.challenges,
  }
}

export function requestEndpoint(config: ApiConfig): string {
  let url: URL
  try { url = new URL(config.baseUrl) } catch { throw new Error('Base URL must be a valid HTTP or HTTPS URL.') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL must use HTTP or HTTPS without credentials, a query, or a fragment.')
  }
  const suffix = config.format === 'responses' ? '/responses' : config.format === 'anthropic' ? '/messages' : '/chat/completions'
  const path = url.pathname.replace(/\/+$/, '')
  if (/\/(responses|messages|chat\/completions)$/.test(path) && !path.endsWith(suffix)) {
    throw new Error('The endpoint in --baseurl does not match --api.')
  }
  url.pathname = path.endsWith(suffix) ? path : (path || '/v1') + suffix
  return url.href
}
