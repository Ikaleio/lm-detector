import { parseArgs } from 'node:util'
import { validateChannel } from '@fingerpoint/shared/reference'
import type { ApiConfig } from '@fingerpoint/shared/types'

export interface CollectionOptions {
  command: 'sample' | 'enroll'
  model: string
  apiKey: string
  baseUrl: string
  label: string
  family: string
  familyName: string
  channel: string
  responseModels: string[]
  api: 'responses' | 'chatcompletion' | 'message'
  effort: string
  stream: boolean
  count: number
  parallel: number
  maxAttempts: number
  outputDir?: string
  resume?: string
  dataDir?: string
  challenge?: string
  promptFile?: string
  systemFile?: string
  adopt?: { id: string; attempt: number }
  take?: number
  note?: string
  subscription: boolean
  json: boolean
  enroll: boolean
  yes: boolean
  dryRun: boolean
  supplied: Set<string>
}

export function integer(value: string, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`)
  }
  return number
}

export function collectionApi(value: string): CollectionOptions['api'] {
  const input = value.toLowerCase()
  const api = input === 'cc' ? 'chatcompletion' : (['responses', 'chatcompletion', 'message'] as const).find(name => input && name.startsWith(input))
  if (!api) throw new Error('--api must be responses, chatcompletion, or message (or cc).')
  return api
}

export function collectionConfig(options: CollectionOptions): ApiConfig {
  return { model: options.model, apiKey: options.apiKey, baseUrl: options.baseUrl,
    format: options.api === 'message' ? 'anthropic' : options.api === 'chatcompletion' ? 'openai' : 'responses',
    effort: options.effort === 'default' ? '' : options.effort, stream: options.stream }
}

export function parseCollectionOptions(command: 'sample' | 'enroll', args: string[], env = process.env): CollectionOptions | undefined {
  const { values, positionals } = parseArgs({ args: args.map(arg => arg === '-ns' ? '--no-stream' : arg), strict: true, allowPositionals: command === 'enroll', options: {
    model: { type: 'string', short: 'm' }, apikey: { type: 'string', short: 'k' }, baseurl: { type: 'string', short: 'b' },
    'api-key': { type: 'string' }, 'base-url': { type: 'string' }, api: { type: 'string', short: 'a' }, effort: { type: 'string', short: 'e' },
    label: { type: 'string' }, family: { type: 'string' }, 'family-name': { type: 'string' }, channel: { type: 'string' },
    'response-model': { type: 'string', multiple: true }, subscription: { type: 'boolean' }, 'no-stream': { type: 'boolean' },
    count: { type: 'string' }, parallel: { type: 'string', short: 'p' }, 'max-attempts': { type: 'string' },
    'output-dir': { type: 'string' }, resume: { type: 'string' }, 'data-dir': { type: 'string' }, enroll: { type: 'boolean' },
    json: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' }, help: { type: 'boolean', short: 'h' },
    'dry-run': { type: 'boolean' },
    challenge: { type: 'string' }, 'prompt-file': { type: 'string' }, 'system-file': { type: 'string' }, note: { type: 'string' },
    adopt: { type: 'string' }, take: { type: 'string' },
  } })
  if (values.help) return undefined
  const supplied = new Set(Object.keys(values))
  const text = (value: string | undefined) => value?.trim() ?? ''
  const options: CollectionOptions = {
    command, model: text(values.model ?? env.MODEL), apiKey: text(values.apikey ?? values['api-key'] ?? env.API_KEY),
    baseUrl: text(values.baseurl ?? values['base-url'] ?? env.BASE_URL), label: text(values.label), family: text(values.family),
    familyName: text(values['family-name']), channel: text(values.channel), responseModels: (values['response-model'] ?? []).map(text),
    api: collectionApi(values.api ?? 'responses'), effort: text(values.effort ?? env.REASONING_EFFORT ?? 'default'), stream: !values['no-stream'],
    count: integer(values.count ?? '36', '--count', 36), parallel: integer(values.parallel ?? '3', '--parallel', 36),
    maxAttempts: integer(values['max-attempts'] ?? '3', '--max-attempts', 20),
    outputDir: values['output-dir'], resume: values.resume ?? positionals[0], dataDir: values['data-dir'],
    challenge: values.challenge, promptFile: values['prompt-file'], systemFile: values['system-file'], note: values.note,
    take: values.take === undefined ? undefined : integer(values.take, '--take'),
    subscription: !!values.subscription, json: !!values.json, enroll: command === 'enroll' || !!values.enroll, yes: !!values.yes, dryRun: !!values['dry-run'], supplied,
  }
  if (command === 'sample' && !options.resume && env.REASONING_EFFORT && values.effort === undefined) supplied.add('effort')
  if (options.resume !== undefined && !options.resume.trim()) throw new Error('The batch directory cannot be empty.')
  if (positionals.length > 1 || (positionals.length && values.resume)) throw new Error('Provide one batch directory, either positional or --resume.')
  if (values.adopt !== undefined) {
    const match = /^(.+):(\d+)$/.exec(values.adopt)
    if (!match) throw new Error('--adopt must be CHALLENGE_ID:ATTEMPT.')
    options.adopt = { id: match[1]!, attempt: integer(match[2]!, '--adopt attempt') }
  }
  if (options.resume) {
    for (const flag of ['output-dir', 'baseurl', 'base-url', 'model', 'label', 'family', 'family-name', 'channel', 'response-model', 'api', 'subscription', 'count', 'no-stream']) {
      if (supplied.has(flag)) throw new Error(`--resume cannot override --${flag}; create a new batch instead.`)
    }
    if (supplied.has('effort') && (!options.challenge || !options.note?.trim())) throw new Error('--resume --effort requires --challenge and --note.')
  }
  const adjustment = options.challenge !== undefined || options.promptFile !== undefined || options.systemFile !== undefined || !!options.resume && supplied.has('effort')
  if (adjustment && (!options.resume || !options.challenge || !options.note?.trim() || (!options.promptFile && !supplied.has('effort')) || (options.systemFile && !options.promptFile))) {
    throw new Error('Challenge adjustment requires --resume, --challenge, --note, and --prompt-file or --effort.')
  }
  if (options.adopt && (!options.resume || !options.note?.trim())) throw new Error('--adopt requires --resume and --note.')
  if (options.adopt && adjustment) throw new Error('Adjust prompts and adopt attempts in separate invocations.')
  if (options.take !== undefined && !options.adopt) throw new Error('--take requires --adopt.')
  if (options.note !== undefined && !options.adopt && !adjustment) throw new Error('--note requires a prompt adjustment or --adopt.')
  if (options.dataDir && !options.enroll) throw new Error('--data-dir requires --enroll or the enroll command.')
  if (options.yes && (!options.enroll || !options.dataDir)) throw new Error('--yes requires enrollment with an explicit --data-dir.')
  if (options.dryRun && command !== 'enroll') throw new Error('--dry-run is available only for fpd enroll.')
  if (options.dryRun && options.yes) throw new Error('--dry-run cannot be combined with --yes.')
  if (command === 'enroll') {
    for (const flag of supplied) {
      if (!['resume', 'data-dir', 'json', 'yes', 'dry-run'].includes(flag)) throw new Error(`--${flag} is not an enrollment option.`)
    }
  }
  if (options.channel) validateChannel(options.channel, options.subscription)
  if (options.responseModels.some(model => !model)) throw new Error('--response-model cannot be empty.')
  return options
}

export const collectionHelp = (command: 'sample' | 'enroll') => command === 'enroll' ? `Usage: fpd enroll DIR [--data-dir DIR] [--dry-run] [--yes] [--json]

Validate saved evidence, deduplicate accepted samples, and rebuild the reference bank.
Interactive enrollment previews the destination and counts before confirmation.
Noninteractive enrollment requires an explicit --data-dir.
--yes skips confirmation only with an explicit --data-dir.
--dry-run validates evidence and reports counts without writing or confirmation.
After a write, run fpd retrain --data-dir DIR to fit matching verifier and confidence parameters.
--json selects noninteractive mode and writes the final report to stdout.
` : `Usage: fpd sample [options]
       fpd sample --resume DIR [--max-attempts N]

Missing setup fields open a focused wizard in an interactive terminal.
  --model, -m MODEL       Requested model (or MODEL)
  --baseurl, -b URL       API endpoint (or BASE_URL)
  --apikey, -k KEY        API key (prefer API_KEY; never saved)
  --api, -a FORMAT        responses (default), chatcompletion/cc, message
  --label LABEL          Reference model label
  --family ID            Model family ID
  --family-name NAME     Model family display name
  --channel CHANNEL      Collection route, e.g. openrouter/anthropic
  --subscription         Require a channel ending in -subscription
  --response-model ID    Allowed response model; repeat for aliases
  --effort, -e LEVEL     Reasoning effort; default omits it; with --resume, requires --challenge and --note
  --count N              Fixed suite challenges, 1–36 (default 36)
  --parallel, -p N       Concurrent requests, 1–36 (default 3)
  --max-attempts N       Cumulative attempts per challenge, 1–20 (default 3)
  --no-stream            Request a non-streamed response
  --output-dir DIR       New batch directory (default runs/<timestamp>)
  --resume DIR           Resume an existing batch without changing its setup
  --challenge ID --prompt-file FILE [--system-file FILE] --note TEXT
                         Adjust one challenge prompt before resuming
  --challenge ID --effort LEVEL --note TEXT
                         Adjust one challenge effort before resuming; prior attempts remain
  --adopt ID:ATTEMPT [--take N] --note TEXT
                         Adopt saved evidence offline; truncation is labeled
  --enroll               Validate and enroll accepted samples after collection
  --data-dir DIR         Enrollment destination (required noninteractively)
  --yes, -y              Skip enrollment confirmation with explicit --data-dir
  --json                 Final JSON on stdout; concise progress on stderr
                         Noninteractive mode; provide all required setup fields.

codex-subscription uses the local Codex login and fixed Responses endpoint.
Subscription channels must end in -subscription (including kimi-code-subscription).
q / Ctrl+C cancels collection and saves progress. Partial batches exit with code 2.
`
