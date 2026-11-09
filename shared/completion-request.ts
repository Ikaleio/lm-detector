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

/** A prompt sent as a PNG of its text (`png` is base64), with `text` as the only words in the request. */
export interface ImagePrompt { png: string; text: string }
/** Draws a prompt as an image; the CLI and the website load the renderer only in image mode. */
export type PromptRenderer = (prompt: string) => Promise<ImagePrompt>

/** The image goes before the text, as Anthropic recommends. */
function userContent(format: ApiConfig['format'], prompt: string | ImagePrompt) {
  if (typeof prompt === 'string') return prompt
  const text = { type: format === 'responses' ? 'input_text' : 'text', text: prompt.text }
  if (format === 'anthropic') return [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: prompt.png } }, text]
  const url = `data:image/png;base64,${prompt.png}`
  // The Responses schema marks `detail` as required; `auto` is what clients send by default.
  return [format === 'responses' ? { type: 'input_image', image_url: url, detail: 'auto' } : { type: 'image_url', image_url: { url } }, text]
}

export function completionBody(config: Pick<ApiConfig, 'model' | 'format' | 'effort' | 'stream' | 'serviceTier'>, prompt: string | ImagePrompt, system = '') {
  const messages: {role: string; content: unknown}[] = [{role: 'user', content: userContent(config.format, prompt)}]
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
    if (/^openpangu-/i.test(config.model) && config.effort === 'none') body.chat_template_kwargs = {thinking: false}
    else if (config.effort && config.effort !== 'default') body.reasoning_effort = config.effort
  }
  if (config.serviceTier && config.serviceTier !== 'default') body[serviceTierField(config.format)] = config.serviceTier
  return body
}
