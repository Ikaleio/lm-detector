import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { completionBody, COMPLETION_TIMEOUT_MS } from '@fingerpoint/shared/completion-request'
import { readCompletion } from '@fingerpoint/shared/completion'
import { directTransport, endpoint, type CompletionTransport } from '@fingerpoint/shared/detection'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import type { ApiConfig, Output, SampleRow } from '@fingerpoint/shared/types'
import suite from '../data/enrollment-suite.json'
import { CODEX_ENDPOINT, codexRequest, codexTransport } from './codex'
import { traceTransport } from './trace'
import { atomicWrite, missing, readJson, saveJson, sha256 } from './storage'

export interface Metadata {
  label: string
  family: string
  family_name: string
  provider: string
  source: 'openrouter' | 'api' | 'codex'
  source_name: string
  response_models: string[]
}
export interface Task {
  id: string
  condition: string
  expected_count: number
  prompt: string
  system: string
  body: Record<string, unknown>
}
export interface Manifest {
  schema: 'fingerpoint-collection-v2'
  purpose: 'reference-collection'
  id: string
  created_at: string
  metadata: Metadata
  config: Omit<ApiConfig, 'apiKey'>
  endpoint: string
  codex: boolean
  timeout_ms: number
  suite_sha256: string
  tasks: Task[]
  fingerprint: string
}
export interface Attempt {
  manifest_sha256: string
  challenge_id: string
  attempt: number
  status: 'running' | 'accepted' | 'failed' | 'interrupted'
  started_at: string
  finished_at?: string
  trace: string
  text: string
  text_sha256: string
  parsed_count: number
  response_model?: string
  response_id?: string
  usage?: unknown
  http_status?: number
  error?: string
  retryable?: boolean
}

function fingerprint(manifest: Omit<Manifest, 'fingerprint'> | Manifest) {
  const { fingerprint: _ignored, ...content } = manifest as Manifest
  return sha256(JSON.stringify(content))
}
export function validateMetadata(metadata: Metadata) {
  for (const field of ['label', 'family', 'family_name', 'provider', 'source_name'] as const) {
    if (typeof metadata[field] !== 'string' || !metadata[field].trim()) throw new Error(`缺少 metadata: ${field}`)
  }
  if (!['openrouter', 'api', 'codex'].includes(metadata.source)) throw new Error('source 必须为 openrouter、api 或 codex')
  if (!Array.isArray(metadata.response_models) || !metadata.response_models.length || metadata.response_models.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('必须显式指定允许的 --response-model，可重复指定多个别名')
  }
}
export function createManifest(config: ApiConfig, metadata: Metadata, count: number, codex: boolean): Manifest {
  validateMetadata(metadata)
  if (!Number.isInteger(count) || count < 1 || count > suite.length) throw new Error(`count 必须为 1–${suite.length}`)
  const url = endpoint(config)
  if ((metadata.source === 'codex') !== codex) throw new Error('--source codex 必须与 --codex 一起使用')
  if (codex && (url !== CODEX_ENDPOINT || config.format !== 'responses' || !config.stream)) throw new Error('Codex 必须使用固定 Responses 流式端点')
  if (metadata.source === 'openrouter' && !url.startsWith('https://openrouter.ai/api/v1/')) throw new Error('openrouter 来源只用于官方端点；其他网关请使用 --source api 并明确来源名称')
  const { apiKey: _key, ...request } = config
  const manifest: Manifest = {
    schema: 'fingerpoint-collection-v2', purpose: 'reference-collection', id: randomUUID(),
    created_at: new Date().toISOString(), metadata, config: request, endpoint: url, codex,
    timeout_ms: COMPLETION_TIMEOUT_MS, suite_sha256: sha256(JSON.stringify(suite)),
    tasks: Array.from({ length: count }, (_, index) => {
      const task = suite[Math.floor(index * suite.length / count)]
      const prompt = task.user_prefix ? `${task.user_prefix}\n\nFinal task:\n${task.prompt}` : task.prompt
      const body = completionBody(config, prompt, task.system)
      return { id: task.challenge_id, condition: task.condition, expected_count: task.expected_count,
        prompt, system: task.system, body: codex ? codexRequest(body) : body }
    }), fingerprint: '',
  }
  manifest.fingerprint = fingerprint(manifest)
  return manifest
}
export async function loadManifest(directory: string): Promise<Manifest> {
  const manifest = await readJson<Manifest>(join(directory, 'manifest.json'))
  if (manifest.schema !== 'fingerpoint-collection-v2' || manifest.purpose !== 'reference-collection') throw new Error('仅支持 v2 参考采集 manifest；旧采样和评估记录不能直接续采或入库')
  if (manifest.fingerprint !== fingerprint(manifest)) throw new Error('manifest 已被修改，请保留原文件；更改 metadata 或请求参数必须创建新批次')
  validateMetadata(manifest.metadata)
  if (!manifest.tasks.length || new Set(manifest.tasks.map(task => task.id)).size !== manifest.tasks.length) throw new Error('挑战不能为空或重复')
  if (manifest.endpoint !== endpoint({ ...manifest.config, apiKey: '' })) throw new Error('manifest 端点不匹配')
  for (const task of manifest.tasks) {
    if (!/^query-\d+$/.test(task.id) || !Number.isInteger(task.expected_count) || task.expected_count < 1) throw new Error('挑战标识或数量无效')
  }
  return manifest
}
const attemptPath = (directory: string, task: Task, number: number) => join(directory, 'attempts', task.id, `${String(number).padStart(4, '0')}.json`)

export async function loadAttempts(directory: string, manifest: Manifest): Promise<Attempt[]> {
  const attempts: Attempt[] = []
  for (const task of manifest.tasks) {
    let files: string[]
    try { files = await readdir(join(directory, 'attempts', task.id)) } catch (error) { if (missing(error)) continue; throw error }
    for (const file of files.filter(name => /^\d+\.json$/.test(name)).sort()) {
      const record = await readJson<Attempt>(join(directory, 'attempts', task.id, file))
      if (record.manifest_sha256 !== manifest.fingerprint || record.challenge_id !== task.id || record.attempt < 1 || record.attempt !== Number(file.slice(0, -5)) || record.text_sha256 !== sha256(record.text)) throw new Error(`采样记录不匹配：${task.id}/${file}`)
      if (!['running', 'accepted', 'failed', 'interrupted'].includes(record.status)) throw new Error('无效的采样状态')
      if (record.status === 'accepted') validateAccepted(manifest, task, record)
      attempts.push(record)
    }
  }
  return attempts
}
export function validateAccepted(manifest: Manifest, task: Task, attempt: Attempt) {
  const count = parseNumbers(attempt.text).length
  if (count !== attempt.parsed_count || count < Math.max(80, Math.ceil(task.expected_count * .55))) throw new Error(`有效数字不足或记录不一致：${task.id}`)
  if (!manifest.metadata.response_models.includes(attempt.response_model ?? '')) throw new Error(`返回模型不在显式声明的别名列表中：${attempt.response_model ?? '(missing)'}`)
}
export function selectedAttempts(manifest: Manifest, attempts: Attempt[]): (Attempt | undefined)[] {
  return manifest.tasks.map(task => attempts.filter(row => row.challenge_id === task.id && row.status === 'accepted').sort((a, b) => a.attempt - b.attempt)[0])
}
export function referenceRows(manifest: Manifest, attempts: Attempt[]): SampleRow[] {
  const selected = selectedAttempts(manifest, attempts)
  if (selected.some(row => !row)) throw new Error(`采样未完成：${selected.filter(Boolean).length}/${manifest.tasks.length}。请先续采；不会部分入库。`)
  const metadata = manifest.metadata
  return manifest.tasks.map((task, index) => {
    const row = selected[index]!
    validateAccepted(manifest, task, row)
    return {
      row_id: `${manifest.id}:${task.id}`, bank_id: 'unified', purpose: 'reference',
      source: metadata.label, model_id: metadata.label, family_id: metadata.family, family_name: metadata.family_name,
      condition_id: task.condition, nuisance_condition_id: task.condition, challenge_id: task.id,
      requested_count: task.expected_count, parsed_count: row.parsed_count, strict_threshold: Math.max(80, Math.ceil(task.expected_count * .55)),
      strict_valid: true, text: row.text, prompt: task.prompt, system_prompt: task.system,
      api_format: manifest.config.format, stream: manifest.config.stream,
      reasoning_effort: manifest.config.format === 'openai'
        ? String(task.body.reasoning_effort ?? 'default') : manifest.config.effort,
      response_model: row.response_model, usage: row.usage, collected_at: row.finished_at,
      request: task.body, manifest_sha256: manifest.fingerprint, selected_attempt: row.attempt,
      provenance: { kind: metadata.source, name: metadata.source_name, provider: metadata.provider,
        endpoint: manifest.endpoint, batch: manifest.id, api_model: manifest.config.model,
        response_id: row.response_id, trust_basis: 'user-declared', suite_sha256: manifest.suite_sha256 },
    }
  })
}
export async function saveSummary(directory: string, manifest: Manifest, attempts: Attempt[], cancelled = false) {
  const selected = selectedAttempts(manifest, attempts)
  const outputs: Output[] = manifest.tasks.map((task, index) => ({ text: selected[index]?.text ?? '', expected_count: task.expected_count }))
  await saveJson(join(directory, 'result.json'), { ...manifest, outputs, accepted: selected.filter(Boolean).length,
    attempted: attempts.length, cancelled, selected_attempts: selected.map(row => row?.attempt ?? null),
    groups: [...new Set(manifest.tasks.map(task => task.condition))].map(condition => ({ condition,
      outputs: outputs.filter((_, index) => manifest.tasks[index].condition === condition) })) })
  await atomicWrite(join(directory, 'attempts.jsonl'), attempts.map(row => JSON.stringify(row)).join('\n') + (attempts.length ? '\n' : ''))
}

/** The caller holds the run lock. Transport injection also permits offline replay. */
export async function collect(directory: string, manifest: Manifest, apiKey: string, maxAttempts: number, signal: AbortSignal, transport?: CompletionTransport) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error('max-attempts 必须为 1–20')
  const config: ApiConfig = { ...manifest.config, apiKey }
  const attempts = await loadAttempts(directory, manifest)
  // A running marker means the previous process ended before it committed the response.
  for (const record of attempts.filter(row => row.status === 'running')) {
    const task = manifest.tasks.find(task => task.id === record.challenge_id)!
    try {
      const replay = await replayTrace(directory, manifest, task, record.attempt)
      record.text = replay.text; record.response_model = replay.responseModel; record.response_id = replay.responseId; record.usage = replay.usage
      record.parsed_count = parseNumbers(record.text).length
      validateAccepted(manifest, task, record)
      record.status = 'accepted'
    } catch {
      record.status = 'interrupted'; record.error = '上次进程中断，原始 trace 保留'; record.retryable = true
    }
    record.text_sha256 = sha256(record.text); record.finished_at ??= new Date().toISOString()
    await saveJson(attemptPath(directory, task, record.attempt), record)
  }
  try {
    for (const task of manifest.tasks) {
      let history = attempts.filter(row => row.challenge_id === task.id)
      while (!history.some(row => row.status === 'accepted') && history.length < maxAttempts && !signal.aborted) {
        if (!apiKey && !transport) throw new Error('密钥环境变量未设置；请设置 API_KEY 或使用 --api-key-env NAME')
        const number = Math.max(0, ...history.map(row => row.attempt)) + 1
        const relative = `trace/${task.id}/${String(number).padStart(4, '0')}`
        const record: Attempt = { manifest_sha256: manifest.fingerprint, challenge_id: task.id, attempt: number,
          status: 'running', started_at: new Date().toISOString(), trace: relative,
          text: '', text_sha256: sha256(''), parsed_count: 0 }
        await saveJson(attemptPath(directory, task, number), record)
        attempts.push(record); history.push(record)
        const timeout = AbortSignal.timeout(manifest.timeout_ms)
        const combined = AbortSignal.any([signal, timeout])
        try {
          const send = transport ? await traceTransport(join(directory, relative), transport)
            : manifest.codex ? await codexTransport(join(directory, relative)) : await traceTransport(join(directory, relative), directTransport)
          const response = await send(manifest.endpoint, config, task.body, combined)
          record.http_status = response.status
          const result = await readCompletion(response, config.format, value => { record.text = value })
          record.text = result.text; record.response_model = result.responseModel; record.response_id = result.responseId; record.usage = result.usage
          record.parsed_count = parseNumbers(record.text).length
          validateAccepted(manifest, task, record)
          record.status = 'accepted'
        } catch (error) {
          record.status = signal.aborted ? 'interrupted' : 'failed'
          const message = signal.aborted ? '采样已取消' : timeout.aborted ? '上游请求超时' : error instanceof Error ? error.message : String(error)
          record.error = apiKey ? message.replaceAll(apiKey, '[REDACTED]') : message
          record.retryable = ![400, 401, 402, 403, 404].includes(record.http_status ?? 0) && !record.error.startsWith('返回模型不在')
        } finally {
          record.finished_at = new Date().toISOString(); record.parsed_count = parseNumbers(record.text).length
          record.text_sha256 = sha256(record.text)
          await saveJson(attemptPath(directory, task, number), record)
          await saveSummary(directory, manifest, attempts, signal.aborted)
        }
        console.error(`${task.id} 尝试 ${number}: ${record.status}${record.error ? ` (${record.error})` : ''}`)
        if (record.status !== 'accepted' && !record.retryable) return attempts
        if (record.status !== 'accepted' && history.length < maxAttempts && !signal.aborted) {
          await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }; const timer = setTimeout(done, 1000); signal.addEventListener('abort', done, { once: true }) })
        }
      }
    }
  } finally { await saveSummary(directory, manifest, attempts, signal.aborted) }
  return attempts
}

async function replayTrace(directory: string, manifest: Manifest, task: Task, attempt: number) {
  const prefix = join(directory, `trace/${task.id}/${String(attempt).padStart(4, '0')}`, 'attempt-1')
  const request = await readJson<{ url: string; body: unknown }>(prefix + '.request.json')
  if (request.url !== manifest.endpoint || JSON.stringify(request.body) !== JSON.stringify(task.body)) throw new Error(`实际请求与 manifest 不匹配：${task.id}`)
  const info = await readJson<{ status: number; content_type: string | null }>(prefix + '.response.json')
  const bytes = await readFile(prefix + '.body.txt')
  const response = new Response(bytes, { status: info.status, headers: { 'content-type': info.content_type || (manifest.codex ? 'text/event-stream' : 'application/json') } })
  return readCompletion(response, manifest.config.format)
}
export async function verifyTrace(directory: string, manifest: Manifest, task: Task, attempt: Attempt) {
  const replay = await replayTrace(directory, manifest, task, attempt.attempt)
  if (replay.text !== attempt.text || replay.responseModel !== attempt.response_model || replay.responseId !== attempt.response_id) throw new Error(`原始响应与样本不匹配：${task.id}`)
}
