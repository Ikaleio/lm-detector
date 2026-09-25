import type { ApiConfig } from './types'

export type RequestFormat = 'chat_completions' | 'responses' | 'messages'
export type Completion = 'complete' | 'truncated' | 'unknown'

export interface BatchModel {
  id: string
  family: string
  family_name: string
}

export interface BatchSource {
  channel: string
  endpoint: string | null
}

export interface BatchRequest {
  model: string | null
  format: RequestFormat | null
  stream: boolean | null
  reasoning_effort: string | null
  response_models: string[]
  temperature?: number | null
  max_tokens?: number | null
}

export interface ReferenceSample {
  id: string
  challenge_id: string
  condition: string
  expected_count: number
  system_prompt: string
  reasoning_effort?: string
  prompt: string
  base_prompt?: string
  user_prefix?: string
  attempt: number | null
  started_at: string | null
  finished_at: string | null
  actual_channel: string | null
  provider_reported: string | null
  response_model: string | null
  response_id: string | null
  text: string
  completion: Completion
  finish_reason: string | null
  usage: unknown | null
  note: string | null
  evidence_path: string | null
}

export interface BatchInfo {
  schema_version: 1
  id: string
  purpose: 'reference'
  created_at: string | null
  model: BatchModel
  source: BatchSource
  request: BatchRequest
  plan: { suite_sha256: string | null; challenge_ids: string[] }
  imported_from?: { file: string | null; sha256: string | null; repository?: string; commit?: string }
}

export interface ReferenceBatch extends BatchInfo {
  samples: ReferenceSample[]
}

export function apiFormat(format: RequestFormat): ApiConfig['format'] {
  return format === 'chat_completions' ? 'openai' : format === 'messages' ? 'anthropic' : 'responses'
}

export function requestFormat(format: ApiConfig['format']): RequestFormat {
  return format === 'openai' ? 'chat_completions' : format === 'anthropic' ? 'messages' : 'responses'
}

/** Channel identifies the collection path, not a claim of upstream identity. */
export function validateChannel(channel: string, subscription = false): void {
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(channel) || channel.includes('..') || channel.endsWith('/')) {
    throw new Error('Channel must be a lowercase identifier such as openrouter/anthropic or codex-subscription.')
  }
  if ((subscription || /^(codex|kimi-code)(?:\/|$|-)/.test(channel)) && !channel.endsWith('-subscription')) {
    throw new Error('Subscription channels must end with -subscription (for example codex-subscription).')
  }
}

export function* referenceSamples(batches: Iterable<ReferenceBatch>) {
  for (const batch of batches) for (const sample of batch.samples) yield { batch, sample }
}

export function parseReference(content: string): ReferenceBatch[] {
  const batches: ReferenceBatch[] = content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line))
  const ids = new Set<string>()
  const batchIds = new Set<string>()
  for (const batch of batches) {
    if (!batch || batch.schema_version !== 1 || batch.purpose !== 'reference' || typeof batch.id !== 'string' || !batch.id || batchIds.has(batch.id) || !batch.model?.id || !batch.model.family || !batch.model.family_name || !batch.source?.channel || !batch.request || !Array.isArray(batch.request.response_models) || !Array.isArray(batch.plan?.challenge_ids) || !Array.isArray(batch.samples) || !batch.samples.length) {
      throw new Error('Reference data must contain version 1 reference batches; legacy rows and evaluation data are not supported.')
    }
    if ('test_set_id' in batch) throw new Error('Evaluation batches cannot be used as reference data.')
    validateChannel(batch.source.channel)
    batchIds.add(batch.id)
    if ((batch.source.endpoint !== null && typeof batch.source.endpoint !== 'string') || (batch.request.format !== null && !['chat_completions', 'responses', 'messages'].includes(batch.request.format))) {
      throw new Error(`Invalid request configuration in batch ${batch.id}.`)
    }
    const planned = new Set(batch.plan.challenge_ids)
    for (const sample of batch.samples) {
      if (!sample || typeof sample.id !== 'string' || !sample.id || ids.has(sample.id) || !planned.has(sample.challenge_id) || !sample.condition || typeof sample.prompt !== 'string' || typeof sample.system_prompt !== 'string' || typeof sample.text !== 'string' || !Number.isInteger(sample.expected_count) || sample.expected_count < 1 || !['complete', 'truncated', 'unknown'].includes(sample.completion) || (sample.attempt !== null && (!Number.isInteger(sample.attempt) || sample.attempt < 1)) || (sample.note !== null && typeof sample.note !== 'string') || (sample.reasoning_effort !== undefined && (typeof sample.reasoning_effort !== 'string' || !sample.reasoning_effort))) {
        throw new Error(`Invalid or duplicate reference sample in batch ${batch.id}.`)
      }
      if ('test_set_id' in sample || 'purpose' in sample) throw new Error('Evaluation records cannot be used as reference samples.')
      if (sample.actual_channel !== null) validateChannel(sample.actual_channel)
      ids.add(sample.id)
    }
  }
  return batches
}
