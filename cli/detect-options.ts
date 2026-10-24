import { parseArgs } from 'node:util'
import { SERVICE_TIERS, type ServiceTier } from '@fingerpoint/shared/completion-request'
import type { DetectionOptions } from '@fingerpoint/shared/detect-request'
import { TOKENIZER_MODEL } from '@fingerpoint/shared/tokenizer-posterior'
import type { ApiConfig } from '@fingerpoint/shared/types'

const TIER_ALIASES: Record<string, ServiceTier> = { f: 'fast', uf: 'ultrafast', slow: 'flex', priority: 'fast', standard: 'default' }

export interface DetectOptions extends DetectionOptions {
  api: 'responses' | 'chatcompletion' | 'message'
  input?: string
  output?: string
  bank?: string
  challenges?: string
  json: boolean
  updateCheck: boolean
  tokenizerBank?: string
}

export function positiveInteger(value: string, name: string, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`)
  }
  return number
}

export function parseOptions(args: string[], env = process.env): DetectOptions | undefined {
  const { values } = parseArgs({ args: args.map(arg => arg === '-ns' ? '--no-stream' : arg), options: {
    model: { type: 'string', short: 'm' }, apikey: { type: 'string', short: 'k' }, baseurl: { type: 'string', short: 'b' },
    api: { type: 'string', short: 'a' }, count: { type: 'string' }, parallel: { type: 'string', short: 'p' },
    repeat: { type: 'string', short: 'n' }, strict: { type: 'boolean', short: 's' },
    'no-stream': { type: 'boolean' }, timeout: { type: 'string' }, effort: { type: 'string', short: 'e' },
    'service-tier': { type: 'string', short: 't' },
    input: { type: 'string' }, output: { type: 'string' }, bank: { type: 'string' },
    challenges: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    'base-url': { type: 'string' }, 'api-key': { type: 'string' },
    'no-update-check': { type: 'boolean' }, tokenizer: { type: 'boolean' },
    'max-probes': { type: 'string' }, 'tokenizer-bank': { type: 'string' },
  }, strict: true, allowPositionals: false })
  if (values.help) return undefined
  const apiInput = (values.api ?? 'responses').toLowerCase()
  const api = apiInput === 'cc' ? 'chatcompletion'
    : (['responses', 'chatcompletion', 'message'] as const).find(name => name.startsWith(apiInput))
  if (!apiInput || !api) throw new Error('--api must be a prefix of responses, chatcompletion, or message (or cc).')
  // Aliases come first, so `f` means fast rather than flex.
  const tierInput = (values['service-tier'] ?? 'default').toLowerCase()
  const serviceTier = Object.hasOwn(TIER_ALIASES, tierInput) ? TIER_ALIASES[tierInput] : SERVICE_TIERS.find(tier => tier.startsWith(tierInput))
  if (!tierInput || !serviceTier) throw new Error('--service-tier must be flex, default, fast, or ultrafast, a prefix, or an alias: f, uf, slow, priority, standard.')
  const count = positiveInteger(values.count ?? '3', '--count', 3)
  const parallel = Math.min(positiveInteger(values.parallel ?? '3', '--parallel', 3), count)
  const repeat = positiveInteger(values.repeat ?? '1', '--repeat')
  const timeout = Number(values.timeout ?? '120')
  if (!Number.isFinite(timeout) || timeout < 0.001 || timeout > 2_147_483.647) {
    throw new Error('--timeout must be between 0.001 and 2147483.647 seconds.')
  }
  if (values.input && (repeat !== 1 || values.challenges || values.count !== undefined)) {
    throw new Error('--input cannot be combined with --repeat, --challenges, or --count.')
  }
  if (values.strict && count !== 3) {
    throw new Error('--strict requires --count 3. Use relaxed mode for one or two samples without confidence scores.')
  }
  const maxProbes = positiveInteger(values['max-probes'] ?? String(TOKENIZER_MODEL.maximumProbes), '--max-probes', 60)
  if (maxProbes < TOKENIZER_MODEL.minimumProbes) throw new Error(`--max-probes must be an integer from ${TOKENIZER_MODEL.minimumProbes} to 60.`)
  // Without --tokenizer, the probe options are mistakes; with --input, no request is sent, but --tokenizer-bank still
  // recomputes a probe saved in the file.
  const unused = (values.input ? ['tokenizer', 'max-probes'] as const : values.tokenizer ? [] : ['max-probes', 'tokenizer-bank'] as const)
    .filter(name => values[name] !== undefined).map(name => `--${name}`)
  if (unused.length) {
    const names = unused.join(' and '), verb = unused.length === 1 ? 'applies' : 'apply'
    throw new Error(values.input
      ? `${names} ${verb} only to live detection. --input sends no requests. It shows the tokenizer probe saved in the file, if any. Remove ${names}.`
      : `${names} ${verb} only to the tokenizer probe. Add --tokenizer to run the probe, or remove ${names}.`)
  }
  const config: ApiConfig = {
    model: (values.model ?? env.MODEL ?? '').trim(),
    apiKey: (values.apikey ?? values['api-key'] ?? env.API_KEY ?? '').trim(),
    baseUrl: (values.baseurl ?? values['base-url'] ?? env.BASE_URL ?? '').trim(),
    format: api === 'message' ? 'anthropic' : api === 'chatcompletion' ? 'openai' : 'responses',
    serviceTier, stream: !values['no-stream'], effort: values.effort ?? '',
  }
  if (!values.input) {
    for (const [name, value, variable] of [
      ['model', config.model, 'MODEL'], ['apikey', config.apiKey, 'API_KEY'], ['baseurl', config.baseUrl, 'BASE_URL'],
    ]) {
      if (!value) throw new Error(`Set --${name} or the ${variable} environment variable.`)
    }
  }
  return {
    config, api, count, parallel, repeat, timeoutMs: Math.round(timeout * 1000),
    strict: !!values.strict, json: !!values.json,
    updateCheck: !values['no-update-check'] && !env.FPD_NO_UPDATE_CHECK && !env.NO_UPDATE_NOTIFIER,
    input: values.input, output: values.output, bank: values.bank, challenges: values.challenges,
    tokenizer: !!values.tokenizer, maxProbes, tokenizerBank: values['tokenizer-bank'],
  }
}
