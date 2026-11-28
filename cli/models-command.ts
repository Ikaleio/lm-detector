import { parseArgs } from 'node:util'
import { directModelsTransport, fetchModelList, type ListedModel } from '@fingerpoint/shared/model-list'
import type { ApiConfig } from '@fingerpoint/shared/types'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function runModelsCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      model: { type: 'string', short: 'm' },
      apikey: { type: 'string', short: 'k' },
      baseurl: { type: 'string', short: 'b' },
      'api-key': { type: 'string' },
      'base-url': { type: 'string' },
      api: { type: 'string', short: 'a' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.help) {
    printModelsHelp()
    return
  }
  const apiInput = (values.api ?? 'responses').toLowerCase()
  const api = apiInput === 'cc' ? 'chatcompletion'
    : (['responses', 'chatcompletion', 'message'] as const).find(name => name.startsWith(apiInput))
  if (!apiInput || !api) throw new Error('--api must be a prefix of responses, chatcompletion, or message (or cc).')
  const config: Pick<ApiConfig, 'baseUrl' | 'apiKey' | 'format'> = {
    baseUrl: text(values.baseurl ?? values['base-url'] ?? process.env.BASE_URL),
    apiKey: text(values.apikey ?? values['api-key'] ?? process.env.API_KEY),
    format: api === 'message' ? 'anthropic' : api === 'chatcompletion' ? 'openai' : 'responses',
  }
  if (!config.baseUrl) throw new Error('Set --baseurl or the BASE_URL environment variable.')
  if (!config.apiKey) throw new Error('Set --apikey or the API_KEY environment variable.')
  const models = await fetchModelList(config, directModelsTransport)
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ models }, null, 2)}\n`)
    return
  }
  if (!models.length) {
    process.stderr.write('The API returned no available models.\n')
    process.exitCode = 1
    return
  }
  const width = Math.max(8, ...models.map(model => model.id.length))
  for (const model of models) process.stdout.write(`${formatRow(model, width)}\n`)
}

function formatRow(model: ListedModel, width: number): string {
  const name = model.name ? `  ${model.name}` : ''
  const efforts = model.efforts.length
    ? `  [${model.efforts.join(', ')}${model.effortSource === 'fallback' ? ', inferred' : ''}]`
    : ''
  return `${model.id.padEnd(width)}${name}${efforts}`
}

function printModelsHelp() {
  const lines = [
    'fpd models — list models from GET /models using the configured API.',
    '',
    'Usage:',
    '  fpd models -b URL -k KEY [-a responses|chatcompletion|message] [--json]',
    '',
    'Options:',
    '  -b, --baseurl URL   Base URL or complete endpoint. Env: BASE_URL.',
    '  -k, --apikey KEY    API key. Env: API_KEY.',
    '  -a, --api TYPE      responses (default), chatcompletion, or message; any prefix or cc.',
    '                      Messages uses x-api-key and anthropic-version headers.',
    '  --json              Write JSON to stdout.',
    '  -h, --help          Show this help.',
    '',
    'The model field is not required. Reasoning-effort values come from the API when present,',
    'otherwise from a built-in name table. Inferred values are marked in the text output.',
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}
