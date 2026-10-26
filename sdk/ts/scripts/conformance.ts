// Checks the TypeScript SDK against sdk/conformance. Usage: bun sdk/ts/scripts/conformance.ts <conformance dir> <data dir>
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { serveStreamCases, type StreamCase } from '../../scripts/stream-cases'
import { buildRequest, loadDetector, parseNumbers, requestSample, type Api, type Output, type ServiceTier } from '../src/index'

const [dir, dataDir] = process.argv.slice(2)
if (!dir || !dataDir) throw new Error('Usage: conformance.ts <conformance dir> <data dir>')
const fixture = async (name: string) => JSON.parse(await readFile(join(dir, name), 'utf8'))
let failures = 0

/** Reports every mismatch. Numbers match within a relative 1e-9; everything else must be identical. */
function compare(file: string, name: string, expected: unknown, actual: unknown, path = '$') {
  const fail = () => {
    failures++
    console.log(`FAIL ${file}:${name}: ${path} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`)
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (!(Math.abs(expected - actual) <= 1e-9 * Math.max(1, Math.abs(expected), Math.abs(actual)))) fail()
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return fail()
    expected.forEach((item, i) => compare(file, name, item, actual[i], `${path}[${i}]`))
  } else if (expected && actual && typeof expected === 'object' && typeof actual === 'object' && !Array.isArray(expected) && !Array.isArray(actual)) {
    const left = expected as Record<string, unknown>, right = actual as Record<string, unknown>
    const keys = Object.keys(left).sort(), actualKeys = Object.keys(right).sort()
    if (keys.join('\0') !== actualKeys.join('\0')) return fail()
    for (const key of keys) compare(file, name, left[key], right[key], `${path}.${key}`)
  } else if (expected !== actual) fail()
}

const parse: { text: string; numbers: number[] }[] = await fixture('parse.json')
for (const [i, item] of parse.entries()) compare('parse.json', String(i), item.numbers, parseNumbers(item.text))

interface RequestConfig {
  base_url: string; api_key: string; model: string; api: Api; stream: boolean; effort?: string; service_tier?: ServiceTier; timeout?: number
}
const requests: { name: string; config: RequestConfig; prompt: string; expected: unknown }[] = await fixture('requests.json')
for (const { name, config, prompt, expected } of requests) {
  compare('requests.json', name, expected, buildRequest({
    baseUrl: config.base_url, apiKey: config.api_key, model: config.model, api: config.api, stream: config.stream,
    effort: config.effort, serviceTier: config.service_tier, timeout: config.timeout,
  }, prompt))
}

const streams: (StreamCase & { expected: Record<string, unknown> })[] = (await fixture('streams.json')).cases
const server = await serveStreamCases(streams)
try {
  for (const item of streams) {
    const { expected_count, ...sample } = await requestSample({
      baseUrl: `http://127.0.0.1:${server.port}/${item.name}`, apiKey: 'test-key', model: 'test-model',
      api: item.api, stream: item.stream, strict: item.strict, timeout: 10,
    }, { id: 'conformance', prompt: 'conformance', expected_count: item.expected_count })
    compare('streams.json', item.name, item.expected, sample)
  }
} finally { server.close() }

const analyze: { data: { built_at: string }; cases: { name: string; strict: boolean; outputs: Output[]; expected: unknown }[] } = await fixture('analyze.json')
const detector = await loadDetector({ source: dataDir })
if (detector.builtAt !== analyze.data.built_at) {
  console.log('FAIL analyze.json: analyze.json was generated for another data build; run bun run sdk:generate')
  process.exit(1)
}
for (const item of analyze.cases) compare('analyze.json', item.name, item.expected, detector.analyze(item.outputs, { strict: item.strict }))

if (failures) process.exit(1)
console.log(`ok analyze=${analyze.cases.length} parse=${parse.length} requests=${requests.length} streams=${streams.length}`)
