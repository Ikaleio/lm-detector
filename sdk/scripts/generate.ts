// Writes the cross-language conformance fixtures in sdk/conformance from the TypeScript SDK. Run from projects/.
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { redactPrivateMetadata } from '../../shared/privacy'
import { buildRequest, loadDetector, parseNumbers, requestSample, type Api, type Output } from '../ts/src/index'
import { STREAM_CASES, serveStreamCases } from './stream-cases'

const out = 'sdk/conformance'
const write = (name: string, value: unknown) => writeFile(join(out, name), JSON.stringify(value, null, 2) + '\n')
await mkdir(out, { recursive: true })

// templates.json: the challenge text of shared/challenge-browser.js, with request() rendered around placeholders.
const source = await readFile('shared/challenge-browser.js', 'utf8')
const module = join(tmpdir(), `lmfpd-challenges-${process.pid}.mjs`)
await writeFile(module, `${source}\nexport { LANGUAGES };\n`)
interface Language {
  space: string; openings: string[]; actions: string[]; request: (action: string, count: string) => string
  rules: string; endings: string[]; separators: string[]; start: string
}
// Dynamic: the module is a temp copy that also exports the private LANGUAGES table, written just above.
const { LANGUAGES }: { LANGUAGES: Record<string, Language> } = await import(pathToFileURL(module).href)
await rm(module)
const languages = Object.entries(LANGUAGES).map(([id, language]) => {
  const request = language.request('{action}', '{count}')
  for (const placeholder of ['{action}', '{count}']) {
    if (request.split(placeholder).length !== 2) throw new Error(`${id}: ${placeholder} must occur once in request.`)
  }
  const { space, openings, actions, rules, endings, separators, start } = language
  return { id, space, openings, actions, request, rules, endings, separators, start }
})
await write('templates.json', { languages })
for (const target of ['sdk/rust/src/templates.json', 'sdk/go/templates.json', 'sdk/python/src/lmfpd/templates.json']) {
  await mkdir(dirname(target), { recursive: true })
  await copyFile(join(out, 'templates.json'), target)
}

const parseTexts = [
  '12, 13, 14', 'abc 12, 13 def 9', '-5, 007, 3.5, 99999, 400, 355, 0, 1', '1、2、3。４５ 6', '中12，13文14 15',
  'été 1 2 3 x 4 5', '1\n2\r\n3\t4', '', 'ｱ1 2', '1e5 2 3', '١٢٣ 5 6',
]
await write('parse.json', parseTexts.map(text => ({ text, numbers: parseNumbers(text) })))

// requests.json: config keys are snake_case so every runner can read them directly.
type RequestConfig = { base_url: string; api_key: string; model: string; api: Api; stream: boolean; effort?: string; service_tier?: 'default' | 'fast' }
const requestCases: { name: string; config: RequestConfig }[] = []
for (const api of ['responses', 'chat_completions', 'messages'] as const) {
  for (const stream of [true, false]) {
    for (const effort of ['', 'high', 'none']) {
      for (const service_tier of ['default', 'fast'] as const) {
        requestCases.push({
          name: `${api}-${stream ? 'stream' : 'json'}-effort_${effort || 'empty'}-${service_tier}`,
          config: { base_url: 'https://api.example.com/v1', api_key: 'test-key', model: 'test-model', api, stream, effort, service_tier },
        })
      }
    }
  }
}
for (const base_url of [
  'https://api.example.com', 'https://api.example.com/', 'https://api.example.com/api', 'https://api.example.com/v1/responses',
  'http://127.0.0.1:8080/v1', 'not a url', 'ftp://api.example.com/v1', 'https://user:pw@api.example.com/v1',
  'https://api.example.com/v1?x=1', 'https://api.example.com/v1#f',
]) {
  requestCases.push({ name: `base_url ${base_url}`, config: { base_url, api_key: 'test-key', model: 'test-model', api: 'responses', stream: true } })
}
requestCases.push({
  name: 'messages endpoint mismatch',
  config: { base_url: 'https://api.example.com/v1/responses', api_key: 'test-key', model: 'test-model', api: 'messages', stream: true },
})
await write('requests.json', requestCases.map(({ name, config }) => ({
  name, config, prompt: 'conformance',
  expected: buildRequest({
    baseUrl: config.base_url, apiKey: config.api_key, model: config.model, api: config.api, stream: config.stream,
    effort: config.effort, serviceTier: config.service_tier,
  }, 'conformance'),
})))

// streams.json: canned provider responses and the sample the TypeScript sampler makes of each.
const server = await serveStreamCases(STREAM_CASES)
const streams = []
for (const item of STREAM_CASES) {
  const { expected_count, ...sample } = await requestSample({
    baseUrl: `http://127.0.0.1:${server.port}/${item.name}`, apiKey: 'test-key', model: 'test-model',
    api: item.api, stream: item.stream, timeout: 10,
  }, { id: 'conformance', prompt: 'conformance', expected_count: item.expected_count })
  streams.push({ ...item, expected: sample })
}
server.close()
await write('streams.json', { cases: streams })

// analyze.json: the first batch with three replies of each of the first six models in the reference file.
const firsts: Output[][] = [], seen = new Set<string>(), names: string[] = []
for (const line of (await readFile('data/unified_reference.jsonl', 'utf8')).split('\n')) {
  if (!line.trim() || firsts.length === 6) continue
  const batch = JSON.parse(line)
  if (seen.has(batch.model.id) || batch.samples.length < 3) continue
  seen.add(batch.model.id)
  names.push(`scored-${batch.model.id}`)
  firsts.push(batch.samples.slice(0, 3).map(({ text, expected_count }: Output) => ({ text: redactPrivateMetadata(text), expected_count })))
}
const sorted = Array.from({ length: 300 }, (_, i) => i + 1).join(', ')
const inputs: { name: string; strict: boolean; outputs: Output[] }[] = [
  ...firsts.map((outputs, i) => ({ name: names[i], strict: false, outputs })),
  { name: 'partial-two', strict: false, outputs: firsts[0].slice(0, 2) },
  { name: 'partial-one', strict: false, outputs: firsts[0].slice(0, 1) },
  { name: 'truncated', strict: false, outputs: firsts[0].map(output => ({ ...output, expected_count: 100 })) },
  { name: 'strict-two', strict: true, outputs: firsts[0].slice(0, 2) },
  { name: 'unscorable-short', strict: false, outputs: Array(3).fill({ text: '1, 2, 3', expected_count: 300 }) },
  { name: 'not-model-sorted', strict: false, outputs: Array(3).fill({ text: sorted, expected_count: 300 }) },
]
const detector = await loadDetector({ source: 'data' })
await write('analyze.json', {
  data: { built_at: detector.builtAt },
  cases: inputs.map(input => ({ ...input, expected: detector.analyze(input.outputs, { strict: input.strict }) })),
})
console.log(`Wrote ${out}: ${inputs.length} analyze, ${parseTexts.length} parse, ${requestCases.length} requests, ${streams.length} streams.`)
