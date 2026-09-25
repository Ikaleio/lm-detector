import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { completionBody, COMPLETION_TIMEOUT_MS } from '@fingerpoint/shared/completion-request'
import { readCompletion } from '@fingerpoint/shared/completion'
import type { CompletionResult } from '@fingerpoint/shared/completion'
import { directTransport, endpoint } from '@fingerpoint/shared/detection'
import type { CompletionTransport } from '@fingerpoint/shared/detection'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import { apiFormat, requestFormat, validateChannel } from '@fingerpoint/shared/reference'
import type { BatchInfo, Completion, ReferenceBatch } from '@fingerpoint/shared/reference'
import type { ApiConfig } from '@fingerpoint/shared/types'
import suite from '../data/enrollment-suite.json'
import { CODEX_ENDPOINT, codexRequest, codexTransport } from './codex'
import { traceTransport } from './trace'
import { atomicWrite, missing, readJson, saveJson, sha256 } from './storage'

export interface Metadata {
  label: string
  family: string
  family_name: string
  channel: string
  response_models: string[]
  subscription?: boolean
}
export interface Task {
  id: string
  condition: string
  expected_count: number
  prompt: string
  system: string
  body: Record<string, unknown>
  effort?: string
}
export interface Manifest extends BatchInfo {
  codex: boolean
  timeout_ms: number
  tasks: Task[]
  fingerprint: string
}
export interface Selection { attempt: number; text: string; note: string; take?: number }
export interface Attempt {
  manifest_sha256: string
  challenge_id: string
  attempt: number
  task: Task
  note?: string
  status: 'running' | 'accepted' | 'failed' | 'interrupted'
  started_at: string
  finished_at?: string
  trace: string
  text: string
  text_sha256: string
  parsed_count: number
  completion: Completion
  finish_reason?: string
  provider_reported?: string
  actual_channel?: string
  response_model?: string
  response_id?: string
  usage?: unknown
  http_status?: number
  error?: string
  retryable?: boolean
  selection?: Selection
}
export interface Adjustment { challenge: string; prompt?: string; systemPrompt?: string; effort?: string; note: string }
export interface LiveAttempt { challenge: string; attempt: number; text: string; count: number }
export interface CollectionProgress {
  manifest: Manifest
  attempts: Attempt[]
  selected: number
  active: LiveAttempt[]
  event: 'start' | 'progress' | 'attempt' | 'done'
  current?: LiveAttempt
}
function fingerprint(manifest: Manifest) {
  const { fingerprint: _ignored, ...content } = manifest
  return sha256(JSON.stringify(content))
}
export function validateMetadata(metadata: Metadata) {
  for (const field of ['label', 'family', 'family_name', 'channel'] as const) {
    if (typeof metadata[field] !== 'string' || !metadata[field].trim()) throw new Error(`Missing metadata: ${field}`)
  }
  validateChannel(metadata.channel, metadata.subscription)
  if (!Array.isArray(metadata.response_models) || !metadata.response_models.length || metadata.response_models.some(value => typeof value !== 'string' || !value.trim())) throw new Error('Specify at least one allowed --response-model.')
}
function apiConfig(manifest: Manifest, apiKey = ''): ApiConfig {
  if (!manifest.source.endpoint || !manifest.request.format || !manifest.request.model) throw new Error('Collection batch is missing its request configuration.')
  return { baseUrl: manifest.source.endpoint, apiKey, model: manifest.request.model, format: apiFormat(manifest.request.format), effort: manifest.request.reasoning_effort ?? 'default', stream: manifest.request.stream ?? true }
}
function plannedBody(config: ApiConfig, channel: string, codex: boolean, prompt: string, system: string, effort = config.effort): Record<string, unknown> {
  const body = completionBody({ ...config, effort }, prompt, system)
  const routeChannel = channel.replace(/-subscription$/, '')
  if (routeChannel === 'openrouter' || routeChannel.startsWith('openrouter/')) {
    const url = new URL(endpoint(config))
    if (url.origin !== 'https://openrouter.ai' || !url.pathname.startsWith('/api/v1/')) throw new Error('OpenRouter channels require the official https://openrouter.ai/api/v1 endpoint.')
    const route = routeChannel.slice('openrouter/'.length)
    if (routeChannel !== 'openrouter' && route !== 'unknown') body.provider = { only: [route], allow_fallbacks: false }
  }
  return codex ? codexRequest(body) : body
}
function actualChannel(manifest: Manifest, provider: string | undefined): string | undefined {
  if (new URL(manifest.source.endpoint!).hostname !== 'openrouter.ai') return manifest.source.channel
  // Provider display names are compared using lowercase ASCII letters/digits.
  // A fixed route keeps its variant only when its provider root matches evidence.
  const reported = provider?.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!reported) return undefined
  const channel = manifest.source.channel.replace(/-subscription$/, '')
  const route = channel.startsWith('openrouter/') ? channel.slice('openrouter/'.length) : undefined
  if (route && route !== 'unknown') {
    return route.split('/')[0].replace(/[^a-z0-9]/g, '') === reported ? manifest.source.channel : undefined
  }
  return `openrouter/${reported}${manifest.source.channel.endsWith('-subscription') ? '-subscription' : ''}`
}
export function createManifest(config: ApiConfig, metadata: Metadata, count: number, codex: boolean): Manifest {
  validateMetadata(metadata)
  if (!Number.isInteger(count) || count < 1 || count > suite.length) throw new Error(`count must be between 1 and ${suite.length}.`)
  const url = endpoint(config)
  if (codex && (metadata.channel !== 'codex-subscription' || url !== CODEX_ENDPOINT || config.format !== 'responses' || !config.stream)) throw new Error('Codex requires channel codex-subscription and its fixed streaming Responses endpoint.')
  if (!codex && metadata.channel === 'codex-subscription') throw new Error('Channel codex-subscription requires the Codex local-login transport.')
  const tasks = Array.from({ length: count }, (_, index) => {
    const task = suite[Math.floor(index * suite.length / count)]
    const prompt = task.user_prefix ? `${task.user_prefix}\n\nFinal task:\n${task.prompt}` : task.prompt
    return { id: task.challenge_id, condition: task.condition, expected_count: task.expected_count, prompt, system: task.system,
      body: plannedBody(config, metadata.channel, codex, prompt, task.system) }
  })
  const manifest: Manifest = {
    schema_version: 1, purpose: 'reference', id: randomUUID(), created_at: new Date().toISOString(),
    model: { id: metadata.label, family: metadata.family, family_name: metadata.family_name },
    source: { channel: metadata.channel, endpoint: url },
    request: { model: config.model, format: requestFormat(config.format), stream: config.stream ?? true, reasoning_effort: config.effort, response_models: [...metadata.response_models] },
    plan: { suite_sha256: sha256(JSON.stringify(suite)), challenge_ids: tasks.map(task => task.id) },
    codex, timeout_ms: COMPLETION_TIMEOUT_MS, tasks, fingerprint: '',
  }
  manifest.fingerprint = fingerprint(manifest)
  return manifest
}
export async function loadManifest(directory: string): Promise<Manifest> {
  const manifest = await readJson<Manifest>(join(directory, 'manifest.json'))
  if (manifest.schema_version !== 1 || manifest.purpose !== 'reference' || !manifest.model || !manifest.request || !manifest.source || !manifest.plan || !Array.isArray(manifest.tasks)) throw new Error('Only current reference collection manifests can be resumed or enrolled; legacy records are not supported.')
  if (manifest.fingerprint !== fingerprint(manifest)) throw new Error('Manifest was modified. Create a new batch to change its configuration.')
  validateMetadata({ label: manifest.model.id, family: manifest.model.family, family_name: manifest.model.family_name, channel: manifest.source.channel, response_models: manifest.request.response_models })
  if (!manifest.tasks.length || new Set(manifest.tasks.map(task => task.id)).size !== manifest.tasks.length || !isDeepStrictEqual(manifest.plan.challenge_ids, manifest.tasks.map(task => task.id))) throw new Error('Challenges must be nonempty, unique, and match the batch plan.')
  if (manifest.source.endpoint !== endpoint(apiConfig(manifest)) || !Number.isInteger(manifest.timeout_ms) || manifest.timeout_ms < 1) throw new Error('Invalid manifest request configuration.')
  for (const task of manifest.tasks) {
    if (!/^query-\d+$/.test(task.id) || !Number.isInteger(task.expected_count) || task.expected_count < 1 || typeof task.prompt !== 'string' || typeof task.system !== 'string') throw new Error('Invalid challenge ID, expected count, or prompt.')
    validateTask(manifest, task, task)
  }
  return manifest
}
const attemptPath = (directory: string, task: Task, number: number) => join(directory, 'attempts', task.id, `${String(number).padStart(4, '0')}.json`)
function validateTask(manifest: Manifest, original: Task, actual: Task, note?: string) {
  const effortChanged = actual.effort !== undefined
  const promptChanged = actual.prompt !== original.prompt || actual.system !== original.system
  const condition = effortChanged ? `${original.condition}-e${sha256(JSON.stringify([actual.prompt, actual.system, actual.effort])).slice(0, 12)}`
    : promptChanged ? `${original.condition}-p${sha256(JSON.stringify([actual.prompt, actual.system])).slice(0, 12)}` : original.condition
  const body = plannedBody(apiConfig(manifest), manifest.source.channel, manifest.codex, actual.prompt, actual.system, actual.effort)
  if (actual.effort !== undefined && (!actual.effort.trim() || actual.effort === manifest.request.reasoning_effort)) throw new Error(`Invalid effort override: ${original.id}`)
  if (actual.id !== original.id || actual.expected_count !== original.expected_count || actual.condition !== condition || !isDeepStrictEqual(actual.body, body) || ((promptChanged || effortChanged) && !note?.trim())) throw new Error(`Recorded challenge request does not match its plan: ${original.id}`)
}
function validateSelection(record: Attempt, selection: Selection) {
  if (selection.attempt !== record.attempt || !selection.note?.trim()) throw new Error('Manual selection requires an original attempt and a note.')
  const numbers = parseNumbers(record.text)
  if (selection.take !== undefined && (!Number.isInteger(selection.take) || selection.take < 1 || selection.take > numbers.length)) throw new Error('take must be a positive integer no greater than the available valid integers.')
  const text = selection.take === undefined ? record.text : numbers.slice(0, selection.take).join(', ')
  if (selection.text !== text) throw new Error('Selected text does not come from the recorded response.')
}
export async function loadAttempts(directory: string, manifest: Manifest): Promise<Attempt[]> {
  const attempts: Attempt[] = []
  for (const task of manifest.tasks) {
    let files: string[]
    try { files = await readdir(join(directory, 'attempts', task.id)) } catch (error) { if (missing(error)) continue; throw error }
    for (const file of files.filter(name => /^\d+\.json$/.test(name)).sort()) {
      const record = await readJson<Attempt>(join(directory, 'attempts', task.id, file))
      if (record.manifest_sha256 !== manifest.fingerprint || record.challenge_id !== task.id || record.attempt < 1 || record.attempt !== Number(file.slice(0, -5)) || record.text_sha256 !== sha256(record.text) || record.parsed_count !== parseNumbers(record.text).length || record.trace !== `trace/${task.id}/${String(record.attempt).padStart(4, '0')}`) throw new Error(`Attempt record mismatch: ${task.id}/${file}`)
      if (!['running', 'accepted', 'failed', 'interrupted'].includes(record.status) || !['complete', 'truncated', 'unknown'].includes(record.completion) || record.selection) throw new Error('Invalid raw attempt state.')
      validateTask(manifest, task, record.task, record.note)
      if (record.status === 'accepted') {
        validateAccepted(manifest, record.task, record)
        if (record.completion !== 'complete') throw new Error('Automatically accepted responses must be complete.')
      }
      attempts.push(record)
    }
    try {
      const selection = await readJson<Selection>(join(directory, 'selections', task.id + '.json'))
      const record = attempts.find(row => row.challenge_id === task.id && row.attempt === selection.attempt)
      if (!record) throw new Error('Manual selection is missing its original attempt.')
      validateSelection(record, selection)
      record.selection = selection
      validateAccepted(manifest, record.task, record)
    } catch (error) { if (!missing(error)) throw error }
  }
  return attempts
}
export function validateAccepted(manifest: Manifest, task: Task, attempt: Attempt) {
  const text = attempt.selection?.text ?? attempt.text
  if (parseNumbers(text).length < Math.max(80, Math.ceil(task.expected_count * .55))) throw new Error(`Too few valid integers: ${task.id}`)
  if (!manifest.request.response_models.includes(attempt.response_model ?? '')) throw new Error(`Response model is not in the allowed list: ${attempt.response_model ?? '(missing)'}`)
  const channel = manifest.source.channel.replace(/-subscription$/, '')
  if (channel.startsWith('openrouter/') && channel !== 'openrouter/unknown' && attempt.provider_reported && !actualChannel(manifest, attempt.provider_reported)) {
    throw new Error(`Reported provider does not match the fixed channel: ${attempt.provider_reported}`)
  }
}
export function selectedAttempts(manifest: Manifest, attempts: Attempt[]): (Attempt | undefined)[] {
  return manifest.tasks.map(task => {
    const history = attempts.filter(row => row.challenge_id === task.id).sort((a, b) => a.attempt - b.attempt)
    return history.find(row => row.selection) ?? history.find(row => row.status === 'accepted')
  })
}
export function referenceBatch(manifest: Manifest, attempts: Attempt[], requireComplete = true): ReferenceBatch {
  const selected = selectedAttempts(manifest, attempts)
  if (requireComplete && selected.some(row => !row)) throw new Error(`Collection incomplete: ${selected.filter(Boolean).length}/${manifest.tasks.length}. Resume collection first; partial enrollment is not allowed.`)
  const { tasks: _tasks, timeout_ms: _timeout, codex: _codex, fingerprint: _fingerprint, ...batch } = manifest
  return { ...batch, samples: selected.flatMap(row => {
    if (!row) return []
    validateAccepted(manifest, row.task, row)
    return [{ id: `${manifest.id}:${row.challenge_id}`, challenge_id: row.challenge_id, condition: row.task.condition,
      expected_count: row.task.expected_count, system_prompt: row.task.system, prompt: row.task.prompt, ...(row.task.effort ? { reasoning_effort: row.task.effort } : {}), attempt: row.attempt,
      started_at: row.started_at, finished_at: row.finished_at ?? null, actual_channel: row.actual_channel ?? null,
      provider_reported: row.provider_reported ?? null, response_model: row.response_model ?? null, response_id: row.response_id ?? null,
      text: row.selection?.text ?? row.text, completion: row.completion, finish_reason: row.finish_reason ?? null,
      usage: row.usage ?? null, note: [row.note, row.selection?.note].filter(Boolean).join('\n') || null, evidence_path: row.trace }]
  }) }
}
export async function saveSummary(directory: string, manifest: Manifest, attempts: Attempt[]) {
  await saveJson(join(directory, 'result.json'), referenceBatch(manifest, attempts, false))
  await atomicWrite(join(directory, 'attempts.jsonl'), attempts.map(({ selection: _selection, ...row }) => JSON.stringify(row)).join('\n') + (attempts.length ? '\n' : ''))
}
function applyCompletion(record: Attempt, result: CompletionResult, manifest: Manifest) {
  record.text = result.text; record.response_model = result.responseModel; record.response_id = result.responseId; record.usage = result.usage
  record.provider_reported = result.providerReported; record.finish_reason = result.finishReason; record.completion = result.completion
  record.actual_channel = actualChannel(manifest, result.providerReported)
  record.parsed_count = parseNumbers(record.text).length
}
/** Caller holds the collection lock. Injection supports offline transports. */
export async function collect(directory: string, manifest: Manifest, apiKey: string, maxAttempts: number, signal: AbortSignal, transport?: CompletionTransport, concurrency = 1, onProgress?: (progress: CollectionProgress) => void, adjustment?: Adjustment): Promise<Attempt[]> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error('max-attempts must be between 1 and 20.')
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 36) throw new Error('concurrency must be between 1 and 36.')
  if (adjustment && (!manifest.tasks.some(task => task.id === adjustment.challenge) || !adjustment.note?.trim() || (adjustment.prompt === undefined && adjustment.systemPrompt === undefined && adjustment.effort === undefined))) throw new Error('Challenge adjustment requires a valid challenge, a request change, and a note.')
  const config = apiConfig(manifest, apiKey), attempts = await loadAttempts(directory, manifest)
  const active = new Map<string, LiveAttempt>()
  const notify = (event: CollectionProgress['event'], current?: LiveAttempt) => onProgress?.({ manifest, attempts, selected: selectedAttempts(manifest, attempts).filter(Boolean).length, active: [...active.values()], event, current })
  for (const record of attempts.filter(row => row.status === 'running')) {
    try {
      const replay = await replayTrace(directory, manifest, record)
      applyCompletion(record, replay.result, manifest)
      if (replay.error) throw replay.error
      validateAccepted(manifest, record.task, record); record.status = 'accepted'
    } catch { record.status = 'interrupted'; record.error = 'Previous process was interrupted; original trace retained.'; record.retryable = true }
    record.text_sha256 = sha256(record.text); record.finished_at ??= new Date().toISOString()
    await saveJson(attemptPath(directory, record.task, record.attempt), record)
  }
  if (adjustment && selectedAttempts(manifest, attempts).some(row => row?.challenge_id === adjustment.challenge)) {
    await saveSummary(directory, manifest, attempts)
    throw new Error('Cannot refine a selected challenge. Create a new batch instead.')
  }
  let nextTask = 0, halted = false
  let summary = Promise.resolve()
  const save = () => { summary = summary.then(() => saveSummary(directory, manifest, attempts)); return summary }
  notify('start')
  const worker = async () => {
    while (nextTask < manifest.tasks.length && !signal.aborted && !halted) {
      const original = manifest.tasks[nextTask++]
      if (adjustment && original.id !== adjustment.challenge) continue
      const history = attempts.filter(row => row.challenge_id === original.id)
      const prior = history[history.length - 1]
      let task = prior?.task ?? original, note = prior?.note
      if (adjustment) {
        const prompt = adjustment.prompt ?? task.prompt, system = adjustment.systemPrompt ?? task.system
        const effort = adjustment.effort ?? task.effort
        const promptChanged = prompt !== original.prompt || system !== original.system
        const effortChanged = effort !== undefined
        const condition = effortChanged ? `${original.condition}-e${sha256(JSON.stringify([prompt, system, effort])).slice(0, 12)}`
          : promptChanged ? `${original.condition}-p${sha256(JSON.stringify([prompt, system])).slice(0, 12)}` : original.condition
        task = { ...original, prompt, system, ...(effortChanged ? { effort } : {}), condition,
          body: plannedBody(config, manifest.source.channel, manifest.codex, prompt, system, effort) }
        note = adjustment.note
      }
      let remaining = Math.max(0, maxAttempts - history.length)
      while (remaining-- > 0 && !selectedAttempts(manifest, attempts)[manifest.tasks.indexOf(original)] && !signal.aborted && !halted) {
        if (!apiKey && !transport && !manifest.codex) throw new Error('Missing API key. Set API_KEY or use --apikey.')
        const number = Math.max(0, ...history.map(row => row.attempt)) + 1
        const record: Attempt = { manifest_sha256: manifest.fingerprint, challenge_id: task.id, attempt: number, task, ...(note ? { note } : {}), status: 'running', started_at: new Date().toISOString(), trace: `trace/${task.id}/${String(number).padStart(4, '0')}`, text: '', text_sha256: sha256(''), parsed_count: 0, completion: 'unknown' }
        await saveJson(attemptPath(directory, task, number), record)
        attempts.push(record); history.push(record)
        const live: LiveAttempt = { challenge: task.id, attempt: number, text: '', count: 0 }
        active.set(task.id, live); notify('progress', live)
        const timeout = AbortSignal.timeout(manifest.timeout_ms), combined = AbortSignal.any([signal, timeout])
        try {
          const send = transport ? await traceTransport(join(directory, record.trace), transport) : manifest.codex ? await codexTransport(join(directory, record.trace)) : await traceTransport(join(directory, record.trace), directTransport)
          const response = await send(manifest.source.endpoint!, config, task.body, combined)
          record.http_status = response.status
          const result = await readCompletion(response, config.format, undefined, result => {
            applyCompletion(record, result, manifest); live.text = record.text; live.count = record.parsed_count; notify('progress', live)
          })
          applyCompletion(record, result, manifest); validateAccepted(manifest, task, record); record.status = 'accepted'
        } catch (error) {
          record.status = signal.aborted ? 'interrupted' : 'failed'
          const message = signal.aborted ? 'Collection cancelled.' : timeout.aborted ? 'Upstream request timed out.' : error instanceof Error ? error.message : String(error)
          record.error = apiKey ? message.replaceAll(apiKey, '[REDACTED]') : message
          record.retryable = ![400, 401, 402, 403, 404].includes(record.http_status ?? 0) && !record.error.startsWith('Response model is not in the allowed list:') && !record.error.startsWith('Reported provider does not match the fixed channel:')
        } finally {
          record.finished_at = new Date().toISOString(); record.parsed_count = parseNumbers(record.text).length; record.text_sha256 = sha256(record.text)
          await saveJson(attemptPath(directory, task, number), record)
          active.delete(task.id); await save(); notify('attempt', live)
        }
        if (record.status !== 'accepted' && !record.retryable) { halted = true; return }
        if (record.status !== 'accepted' && remaining > 0 && !signal.aborted && !halted) {
          await new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
            const timer = setTimeout(done, 1000)
            signal.addEventListener('abort', done, { once: true })
            if (signal.aborted) done()
          })
        }
      }
    }
  }
  try {
    const outcomes = await Promise.allSettled(Array.from({ length: concurrency }, () => worker().catch(error => { halted = true; throw error })))
    const failed = outcomes.find(outcome => outcome.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  } finally { await save(); notify('done') }
  return attempts
}
async function replayTrace(directory: string, manifest: Manifest, record: Attempt): Promise<{ result: CompletionResult; error?: Error }> {
  const prefix = join(directory, record.trace, 'attempt-1')
  const request = await readJson<{ url: string; body: unknown }>(prefix + '.request.json')
  if (request.url !== manifest.source.endpoint || !isDeepStrictEqual(request.body, record.task.body)) throw new Error(`Recorded request does not match the manifest: ${record.challenge_id}`)
  const info = await readJson<{ status: number; content_type: string | null }>(prefix + '.response.json')
  const bytes = await readFile(prefix + '.body.txt')
  const response = new Response(bytes, { status: info.status, headers: { 'content-type': info.content_type || (manifest.codex ? 'text/event-stream' : 'application/json') } })
  let result: CompletionResult = { text: '', completion: 'unknown' }
  try { result = await readCompletion(response, apiConfig(manifest).format, undefined, value => { result = value }); return { result } }
  catch (error) { return { result, error: error instanceof Error ? error : new Error(String(error)) } }
}
export async function verifyTrace(directory: string, manifest: Manifest, task: Task, attempt: Attempt) {
  validateTask(manifest, task, attempt.task, attempt.note)
  const replay = await replayTrace(directory, manifest, attempt)
  const result = replay.result
  if (attempt.actual_channel !== actualChannel(manifest, result.providerReported)) throw new Error(`Actual channel does not match recorded evidence: ${task.id}`)
  if (result.text !== attempt.text || result.responseModel !== attempt.response_model || result.responseId !== attempt.response_id || result.providerReported !== attempt.provider_reported || result.finishReason !== attempt.finish_reason || result.completion !== attempt.completion || !isDeepStrictEqual(result.usage, attempt.usage)) throw new Error(`Raw response does not match the sample: ${task.id}`)
  if (attempt.selection) validateSelection(attempt, attempt.selection)
  else if (replay.error) throw replay.error
}
/** Caller holds the collection lock. Raw attempts and traces are never rewritten. */
export async function adoptAttempt(directory: string, manifest: Manifest, challengeId: string, attemptNumber: number, take: number | undefined, note: string): Promise<Attempt[]> {
  if (!note.trim()) throw new Error('Manual adoption requires a note.')
  const attempts = await loadAttempts(directory, manifest), task = manifest.tasks.find(task => task.id === challengeId)
  const record = attempts.find(row => row.challenge_id === challengeId && row.attempt === attemptNumber)
  if (!task || !record || record.status === 'running') throw new Error('No finished original attempt was found.')
  const selection: Selection = { attempt: attemptNumber, text: take === undefined ? record.text : parseNumbers(record.text).slice(0, take).join(', '), note, ...(take === undefined ? {} : { take }) }
  validateSelection(record, selection)
  const selected = { ...record, selection }
  validateAccepted(manifest, record.task, selected)
  await verifyTrace(directory, manifest, task, selected)
  await saveJson(join(directory, 'selections', challengeId + '.json'), selection)
  for (const row of attempts.filter(row => row.challenge_id === challengeId)) delete row.selection
  record.selection = selection
  await saveSummary(directory, manifest, attempts)
  return attempts
}
