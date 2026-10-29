import type { ApiConfig } from './types.ts'

/** Deadline of one upstream request. The proxy in `worker/main.js` must stay self-contained, so it repeats the value. */
export const COMPLETION_TIMEOUT_MS = 250000

/** Service tiers from slowest to fastest. `default` sends no tier field. */
export const SERVICE_TIERS = ['flex', 'default', 'fast', 'ultrafast'] as const
export type ServiceTier = typeof SERVICE_TIERS[number]
export const isServiceTier = (value: unknown): value is ServiceTier => SERVICE_TIERS.includes(value as ServiceTier)
/** Messages carries the tier in Anthropic's `speed` field; Chat Completions and Responses use OpenAI's `service_tier`. */
export const serviceTierField = (format: ApiConfig['format']) => format === 'anthropic' ? 'speed' : 'service_tier'
/** The Anthropic API reads `speed` only with this beta header. The proxy in `worker/main.js` repeats the value. */
export const SPEED_BETA = 'fast-mode-2026-02-01'
/** Whether the request body carries `speed`, which needs the SPEED_BETA header. */
export const sendsSpeed = (config: Pick<ApiConfig, 'format' | 'serviceTier'>) =>
  config.format === 'anthropic' && config.serviceTier !== undefined && config.serviceTier !== 'default'

export function completionBody(config: Pick<ApiConfig, 'model' | 'format' | 'effort' | 'stream' | 'serviceTier'>, prompt: string, system = '') {
  if (config.format === 'gemini') {
    const body: Record<string, unknown> = { contents: [{ role: 'user', parts: [{ text: prompt }] }] }
    if (system) body.systemInstruction = { parts: [{ text: system }] }
    return body
  }
  const messages: {role: string; content: string}[] = [{role: 'user', content: prompt}]
  let body: Record<string, unknown> = {model: config.model, messages, max_tokens: 8192, stream: config.stream ?? true}
  if (config.format === 'anthropic') {
    if (system) body.system = system
    if (config.effort === 'none') body.thinking = {type: 'disabled'}
    else if (config.effort && config.effort !== 'default') {
      body.thinking = {type: 'adaptive'}
      body.output_config = {effort: config.effort}
    }
  } else if (config.format === 'responses') {
    body = {model: config.model, input: messages, max_output_tokens: 8192, stream: config.stream ?? true, store: false}
    if (system) body.instructions = system
    if (config.effort && config.effort !== 'default') body.reasoning = {effort: config.effort}
  } else {
    if (system) messages.unshift({role: 'system', content: system})
    if (config.effort && config.effort !== 'default') body.reasoning_effort = config.effort
  }
  if (config.serviceTier && config.serviceTier !== 'default') body[serviceTierField(config.format)] = config.serviceTier
  return body
}
