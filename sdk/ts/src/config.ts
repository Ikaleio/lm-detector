import { SERVICE_TIERS } from '@fingerpoint/shared/completion-request'
import { requestEndpoint, type DetectionOptions } from '@fingerpoint/shared/detect-request'
import type { ApiConfig } from '@fingerpoint/shared/types'
import type { DetectConfig } from './types.js'

const FORMATS = { responses: 'responses', chat_completions: 'openai', messages: 'anthropic' } as const

/** Validates an SDK config and fills the detection options with the SDK defaults. Throws on an invalid config. */
export function detectOptions(input: DetectConfig): DetectionOptions {
  const baseUrl = String(input.baseUrl ?? '').trim(), apiKey = String(input.apiKey ?? '').trim()
  const model = String(input.model ?? '').trim()
  if (!baseUrl || !apiKey || !model) throw new Error('base_url, api_key, and model are required.')
  const api = input.api ?? 'responses'
  if (!Object.hasOwn(FORMATS, api)) throw new Error('api must be responses, chat_completions, or messages.')
  const serviceTier = input.serviceTier ?? 'default'
  if (!SERVICE_TIERS.includes(serviceTier)) throw new Error('service_tier must be flex, default, fast, or ultrafast.')
  const count = input.count ?? 3, parallel = input.parallel ?? 3, timeout = input.timeout ?? 120
  if (!Number.isSafeInteger(count) || count < 1 || count > 3) throw new Error('count must be an integer from 1 to 3.')
  if (!Number.isSafeInteger(parallel) || parallel < 1 || parallel > 3) throw new Error('parallel must be an integer from 1 to 3.')
  if (!Number.isFinite(timeout) || (timeout !== 0 && (timeout < 0.001 || timeout > 2_147_483.647))) {
    throw new Error('timeout must be 0 (no timeout) or between 0.001 and 2147483.647 seconds.')
  }
  const strict = input.strict ?? false
  if (strict && count !== 3) throw new Error('strict requires count 3.')
  const config: ApiConfig = {
    baseUrl, apiKey, model, format: FORMATS[api], serviceTier,
    stream: input.stream ?? true, effort: input.effort ?? '',
  }
  requestEndpoint(config)
  return {
    config, count, parallel: Math.min(parallel, count), repeat: 1, strict,
    timeoutMs: Math.round(timeout * 1000), tokenizer: false, maxProbes: 20,
  }
}
