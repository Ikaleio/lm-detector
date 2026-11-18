import { isLocalApiUrl } from './api-url'
import { coded } from './detection'
import type { ApiConfig, CodedError, ErrorCode } from './types'

const COMPLETION_SUFFIXES = ['/chat/completions', '/responses', '/messages'] as const
const LIST_TIMEOUT_MS = 30_000
const MAX_PAGES = 20
const MAX_MODELS = 5_000
const KNOWN_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const GENERIC_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const
const OPENAI_FULL_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
const CLASSIC_O_SERIES = ['low', 'medium', 'high'] as const
const LOW_HIGH = ['low', 'high'] as const
const REASONING_PARAMETERS = new Set([
  'reasoning', 'reasoning_effort', 'include_reasoning', 'thinking', 'thinking_budget', 'effort',
])

export type EffortSource = 'api' | 'fallback' | 'none'

/** A model entry from GET /models, with reasoning-effort options resolved from the payload or a name table. */
export interface ListedModel {
  id: string
  name?: string
  ownedBy?: string
  efforts: string[]
  effortSource: EffortSource
}

export type ModelListConfig = Pick<ApiConfig, 'baseUrl' | 'format' | 'apiKey'>

/** Optional page cursor passed to a transport when the previous /models page said there were more results. */
export interface ModelListPage {
  afterId: string
  param?: string
}

export type ModelsTransport = (
  url: string,
  config: ModelListConfig,
  signal: AbortSignal,
  page?: ModelListPage,
) => Promise<Response>

/**
 * Builds the GET /models URL from a Base URL or a complete completion endpoint, with or without a trailing `/v1`.
 */
export function modelsEndpoint(baseUrl: string): string {
  let url: URL
  try { url = new URL(baseUrl) } catch { throw coded('请输入有效的 Base URL', 'invalid_base_url') }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && isLocalApiUrl(url)))
    || url.username || url.password || url.search || url.hash) {
    throw coded('Base URL 格式不正确', 'invalid_base_url')
  }
  let base = url.href.replace(/\/$/, '')
  for (const suffix of COMPLETION_SUFFIXES) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length)
      break
    }
  }
  if (base.endsWith('/models')) return base
  return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`
}

/** Appends a pagination cursor without otherwise changing a models URL that has no query string. */
export function modelsPageUrl(url: string, page?: ModelListPage): string {
  if (!page?.afterId) return url
  const next = new URL(url)
  next.searchParams.set(page.param ?? 'after_id', page.afterId)
  return next.href
}

export const directModelsTransport: ModelsTransport = (url, config, signal, page) => {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (config.format === 'anthropic') {
    if (config.apiKey) headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`
  }
  return fetch(modelsPageUrl(url, page), { method: 'GET', headers, signal, redirect: 'error' })
}

/**
 * Fetches every page of GET /models and returns unique model ids, with reasoning-effort options attached.
 * `transport` defaults to a direct GET; the web app supplies a proxy-aware transport.
 */
export async function fetchModelList(
  config: ModelListConfig,
  transport: ModelsTransport = directModelsTransport,
  signal?: AbortSignal,
): Promise<ListedModel[]> {
  const url = modelsEndpoint(config.baseUrl)
  const timeout = AbortSignal.timeout(LIST_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const models: ListedModel[] = []
  const seen = new Set<string>()
  let page: ModelListPage | undefined
  try {
    for (let i = 0; i < MAX_PAGES && models.length < MAX_MODELS; i++) {
      const response = await transport(url, config, combined, page)
      const { models: batch, next } = await readModelListResponse(response)
      for (const model of batch) {
        if (seen.has(model.id)) continue
        seen.add(model.id)
        models.push(model)
        if (models.length >= MAX_MODELS) break
      }
      if (!next) break
      page = next
    }
  } catch (error) {
    if (signal?.aborted) throw coded('已取消请求', 'aborted')
    if (timeout.aborted) throw coded('上游请求超时，请重试', 'timeout')
    if (error instanceof TypeError) throw coded('API 连接失败，请检查地址和网络', 'network')
    if (error instanceof Error) {
      const codedError = error as CodedError
      codedError.message = codedError.message.replaceAll(config.apiKey, '[REDACTED]')
      throw codedError
    }
    throw coded('调用失败', 'network')
  }
  return models
}

/** Parses one /models JSON body into listed models and an optional next-page cursor. */
export function parseModelList(payload: unknown): { models: ListedModel[]; next?: ModelListPage } {
  const items = modelItems(payload)
  const models = items.map(listedModel).filter((model): model is ListedModel => model !== null)
  return { models, next: paginationCursor(payload) }
}

/**
 * Resolves reasoning-effort options for a model id, preferring explicit API fields on `raw` when present,
 * otherwise the built-in name table.
 */
export function resolveReasoningEfforts(id: string, raw?: unknown): { efforts: string[]; source: EffortSource } {
  const record = isObject(raw) ? raw : undefined
  const fromApi = record ? effortsFromApi(record) : undefined
  if (fromApi?.length) return { efforts: fromApi, source: 'api' }
  if (record && parameterList(record) && !supportsReasoningParameter(record)) {
    return { efforts: [], source: 'none' }
  }
  const fallback = fallbackReasoningEfforts(id)
  if (fallback.length) return { efforts: fallback, source: 'fallback' }
  if (record && supportsReasoningParameter(record)) {
    return { efforts: [...GENERIC_EFFORTS], source: 'fallback' }
  }
  return { efforts: [], source: 'none' }
}

/** Built-in reasoning-effort options from a model id or OpenRouter-style `provider/id` name. */
export function fallbackReasoningEfforts(id: string): string[] {
  const name = modelKey(id)
  if (/^o1(-mini|-preview|-pro)?$/.test(name) || /^o1-/.test(name)) return [...CLASSIC_O_SERIES]
  if (/^o[34](-|$)/.test(name)) return [...CLASSIC_O_SERIES]
  if (/^gpt-5([.-]|$)/.test(name)) {
    if (/^gpt-5\.[1-9]/.test(name)) return ['none', ...GENERIC_EFFORTS]
    return [...GENERIC_EFFORTS]
  }
  if (/^gpt-6([.-]|$)/.test(name) || /(^|-)(sol|astra)([.-]|$)/.test(name)) return [...OPENAI_FULL_EFFORTS]
  if (/codex/.test(name) && /gpt|codex-mini/.test(name)) return [...GENERIC_EFFORTS]
  if (/^claude-/.test(name)) {
    if (/thinking|3-7|3\.7|(sonnet|opus|haiku)-4|claude-4/.test(name)) return [...CLASSIC_O_SERIES]
    return []
  }
  if (/deepseek-(r1|reasoner)|deepseek-v3(\.\d+)?-thinking/.test(name)) return []
  if (/^gemini-/.test(name)) {
    if (/thinking|2\.5|2-5|^gemini-3|^gemini-4/.test(name)) return [...CLASSIC_O_SERIES]
    return []
  }
  if (/^grok-/.test(name)) {
    if (/grok-3-mini|grok-4|reasoning|thinking/.test(name)) return [...LOW_HIGH]
    return []
  }
  if (/qwq|qwen.*thinking/.test(name)) return [...CLASSIC_O_SERIES]
  if (/kimi.*thinking|k2-thinking|k2\.5/.test(name)) return [...CLASSIC_O_SERIES]
  return []
}

async function readModelListResponse(response: Response): Promise<{ models: ListedModel[]; next?: ModelListPage }> {
  let body: unknown
  try { body = await response.json() } catch {
    if (!response.ok) {
      throw httpFailure(response.status, `HTTP ${response.status}`, response.status === 404 ? undefined : 'proxy_unavailable')
    }
    throw coded('接口返回的不是 JSON 或流式数据', 'not_json')
  }
  if (!response.ok) {
    const record = isObject(body) ? body : {}
    const error = isObject(record.error) ? record.error : {}
    const message = stringValue(error.message) || stringValue(record.message) || `HTTP ${response.status}`
    const code = error.code === 'upstream_not_api' ? 'upstream_not_api'
      : isOldProxyModelsRejection(response.status, message) ? 'proxy_models_unsupported'
        : 'http'
    throw httpFailure(response.status, `HTTP ${response.status}：${message}`, code)
  }
  const parsed = parseModelList(body)
  if (isEmptyPayload(body) && !parsed.models.length) {
    // A successful HTML/JSON wrapper with no list is treated as empty; the caller shows that state.
  }
  return parsed
}

function isOldProxyModelsRejection(status: number, message: string): boolean {
  return status === 400 && /must contain a model|API protocol is not supported|API request must contain/i.test(message)
}

function httpFailure(status: number, message: string, code: ErrorCode = 'http'): CodedError {
  return coded(message, code, { httpStatus: status })
}

function modelItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isObject(payload)) return []
  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.models)) return payload.models
  if (isObject(payload.data) && Array.isArray(payload.data.data)) return payload.data.data
  return []
}

function listedModel(item: unknown): ListedModel | null {
  if (typeof item === 'string') {
    const id = item.trim()
    if (!id) return null
    const { efforts, source } = resolveReasoningEfforts(id)
    return { id, efforts, effortSource: source }
  }
  if (!isObject(item)) return null
  const id = stringValue(item.id) || stringValue(item.model) || stringValue(item.model_id) || stringValue(item.modelId)
  if (!id) return null
  const display = stringValue(item.display_name) || stringValue(item.name) || stringValue(item.model_name)
  const ownedBy = stringValue(item.owned_by) || stringValue(item.ownedBy) || stringValue(item.publisher)
  const { efforts, source } = resolveReasoningEfforts(id, item)
  return {
    id,
    name: display && display !== id ? display : undefined,
    ownedBy: ownedBy || undefined,
    efforts,
    effortSource: source,
  }
}

function paginationCursor(payload: unknown): ModelListPage | undefined {
  if (!isObject(payload)) return undefined
  const lastId = stringValue(payload.last_id) || stringValue(payload.lastId)
  if ((payload.has_more === true || payload.hasMore === true) && lastId) return { afterId: lastId, param: 'after_id' }
  const startingAfter = stringValue(payload.starting_after) || stringValue(payload.startingAfter)
  if (startingAfter) return { afterId: startingAfter, param: 'starting_after' }
  const next = stringValue(payload.next_page_token) || stringValue(payload.next_cursor) || stringValue(payload.next)
  if (next && !/^https?:/i.test(next)) return { afterId: next, param: 'after_id' }
  return undefined
}

function effortsFromApi(item: Record<string, unknown>): string[] | undefined {
  const buckets: unknown[] = [
    item.supported_reasoning_efforts,
    item.reasoning_efforts,
    item.supported_efforts,
    item.reasoning_effort,
  ]
  if (isObject(item.reasoning)) {
    const reasoning = item.reasoning
    buckets.push(reasoning.efforts, reasoning.supported_efforts, reasoning.effort_options, reasoning.supported_reasoning_efforts)
  }
  for (const bucket of buckets) {
    const values = normalizeEfforts(bucket)
    if (values.length) return values
  }
  return undefined
}

function normalizeEfforts(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = canonicalizeEffort(value)
    return trimmed ? [trimmed] : []
  }
  if (!Array.isArray(value)) return []
  const efforts: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const label = typeof entry === 'string' ? entry
      : isObject(entry) ? stringValue(entry.name) || stringValue(entry.id) || stringValue(entry.value) || stringValue(entry.effort)
        : typeof entry === 'number' && Number.isFinite(entry) ? String(entry)
          : ''
    const normalized = canonicalizeEffort(label)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    efforts.push(normalized)
  }
  return efforts
}

function canonicalizeEffort(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const key = trimmed.toLowerCase().replace(/[\s_]+/g, '').replace('x-high', 'xhigh')
  const known = KNOWN_EFFORTS.find(effort => effort === key)
  return known ?? trimmed
}

function parameterList(item: Record<string, unknown>): string[] | undefined {
  const value = item.supported_parameters ?? item.supported_parameter ?? item.parameters
  if (!Array.isArray(value)) return undefined
  return value.map(entry => typeof entry === 'string' ? entry : isObject(entry) ? stringValue(entry.name) || stringValue(entry.id) : '').filter(Boolean)
}

function supportsReasoningParameter(item: Record<string, unknown>): boolean {
  const parameters = parameterList(item)
  if (!parameters) return false
  return parameters.some(parameter => REASONING_PARAMETERS.has(parameter.toLowerCase()))
}

function modelKey(id: string): string {
  const trimmed = id.trim().toLowerCase()
  const slash = trimmed.lastIndexOf('/')
  return (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).replace(/:\w+$/, '').replace(/-\d{8}$/, '')
}

function isEmptyPayload(payload: unknown): boolean {
  if (payload == null) return true
  if (Array.isArray(payload)) return payload.length === 0
  return isObject(payload) && !modelItems(payload).length
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const LIST_MODELS_TIMEOUT_MS = LIST_TIMEOUT_MS
