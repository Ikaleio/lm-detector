import type { ApiConfig } from './types'

export const COMPLETION_TIMEOUT_MS = 250000

export function completionBody(config: Pick<ApiConfig, 'model' | 'format' | 'effort' | 'stream'>, prompt: string, system = '') {
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
  return body
}
