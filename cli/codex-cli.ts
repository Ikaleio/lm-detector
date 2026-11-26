import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanText, errorMessage, minimumNumbers, type DetectionOptions, type Sample } from '@fingerpoint/shared/detect-request'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import type { Challenge } from '@fingerpoint/shared/types'

interface ProcessResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function requestCodexCliSample(
  executable: string,
  options: Pick<DetectionOptions, 'config' | 'strict' | 'timeoutMs'>,
  challenge: Challenge,
  signal: AbortSignal,
  update: (sample: Sample) => void,
): Promise<Sample> {
  const sample: Sample = {
    state: 'waiting', text: '', rawText: '', count: 0,
    expectedCount: challenge.expected_count, startedAt: Date.now(),
  }
  const report = () => update({ ...sample })
  report()
  let directory = ''
  try {
    signal.throwIfAborted()
    directory = await mkdtemp(join(tmpdir(), 'fpd-codex-cli-'))
    const args = [
      'exec', '--strict-config', '--json', '--skip-git-repo-check',
      '--sandbox', 'read-only', '--color', 'never', '--cd', directory,
      '--model', options.config.model, '-c', 'tools.web_search=false',
    ]
    if (options.config.effort) args.push('-c', `model_reasoning_effort=${JSON.stringify(options.config.effort)}`)
    args.push('-')
    const child = spawn(executable, args, { cwd: directory, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', timedOut = false, exited = false
    let killTimer: NodeJS.Timeout | undefined
    const stop = () => {
      if (exited) return
      child.kill('SIGTERM')
      killTimer ??= setTimeout(() => { if (!exited) child.kill('SIGKILL') }, 2000)
      killTimer.unref()
    }
    const timer = options.timeoutMs > 0 ? setTimeout(() => { timedOut = true; stop() }, options.timeoutMs) : undefined
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    child.stdin.on('error', () => {})
    child.stdin.end(challenge.prompt)
    let result: ProcessResult
    try {
      const [code, processSignal] = await once(child, 'close')
      result = { code, signal: processSignal, stdout, stderr, timedOut }
    } finally {
      exited = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal.removeEventListener('abort', stop)
    }

    let finalText = '', turnCompleted = false
    const errors: string[] = []
    for (const [index, line] of result.stdout.split('\n').entries()) {
      if (!line.trim()) continue
      let event: Record<string, unknown>
      try { event = record(JSON.parse(line)) } catch {
        errors.push(`Invalid JSON on stdout line ${index + 1}.`)
        continue
      }
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        sample.transportSessionId = event.thread_id
      } else if (event.type === 'turn.completed') {
        turnCompleted = true
      } else if (event.type === 'turn.failed') {
        const detail = record(event.error)
        errors.push(cleanText(typeof detail.message === 'string' ? detail.message : 'Codex CLI turn failed.'))
      } else if (event.type === 'error') {
        errors.push(cleanText(typeof event.message === 'string' ? event.message : 'Codex CLI reported an error.'))
      } else if (event.type === 'item.completed') {
        const item = record(event.item)
        if (item.type === 'agent_message' && typeof item.text === 'string') finalText = item.text
        else if (item.type === 'reasoning') continue
        else if (item.type === 'error') errors.push(cleanText(typeof item.message === 'string' ? item.message : 'Codex CLI item failed.'))
        else errors.push(`Unexpected Codex CLI item type: ${String(item.type ?? 'missing')}.`)
      }
    }
    const numbers = parseNumbers(finalText) as number[]
    sample.rawText = finalText
    sample.text = finalText
    sample.count = numbers.length
    if (signal.aborted) throw new Error('Cancelled.')
    if (result.timedOut) throw new Error(`Timed out after ${options.timeoutMs / 1000}s waiting for codex exec.`)
    if (result.code !== 0) errors.unshift(`codex exec exited with status ${result.code ?? result.signal ?? 'unknown'}.`)
    if (!turnCompleted) errors.push('Codex CLI did not complete its turn.')
    if (!finalText) errors.push('Codex CLI returned no final agent message.')
    if (errors.length && result.stderr.trim()) errors.push(result.stderr.trim())
    if (errors.length) throw new Error([...new Set(errors)].join(' '))

    if (!options.strict && numbers.length >= challenge.expected_count) {
      sample.text = numbers.slice(0, challenge.expected_count).join(', ')
      sample.count = challenge.expected_count
      sample.state = numbers.length > challenge.expected_count ? 'truncated' : 'complete'
    } else if (numbers.length < minimumNumbers(challenge.expected_count)) {
      throw new Error(`Too few valid numbers: ${numbers.length}; need at least ${minimumNumbers(challenge.expected_count)}.`)
    } else sample.state = 'complete'
  } catch (error) {
    sample.state = signal.aborted ? 'cancelled' : 'failed'
    sample.error = signal.aborted ? 'Cancelled.' : errorMessage(error, options.config.apiKey)
  } finally {
    sample.finishedAt = Date.now()
    report()
    if (directory) await rm(directory, { recursive: true, force: true })
  }
  return { ...sample }
}
