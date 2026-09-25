import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { validateChannel } from '@fingerpoint/shared/reference'
import { CODEX_ENDPOINT } from './codex'
import { requestEndpoint } from './detect-options'
import { collectionApi, collectionConfig, collectionHelp, integer, parseCollectionOptions } from './collection-options'
import type { CollectionOptions } from './collection-options'
import { askCollectionField, CollectionCancelled, confirmCollection, createCollectionDisplay, printCollectionHelp, printCollectionReport, terminalText } from './collection-ui'
import type { CollectionProgress, CollectionReport } from './collection-ui'
import { collectionDirectory, discoverRepository, enrollmentDirectory } from './collection-paths'
import { adoptAttempt, collect, createManifest, loadAttempts, loadManifest, saveSummary, selectedAttempts } from './sampling'
import type { Attempt, CollectionProgress as EngineProgress, Manifest } from './sampling'
import { enroll } from './enrollment'
import { saveJson, withLock } from './storage'

function requireValue(value: string): void {
  if (!value.trim()) throw new Error('Enter a value.')
}

async function setup(options: CollectionOptions, repository: string | null, interactive: boolean): Promise<void> {
  const missing = !options.model || !options.label || !options.family || !options.familyName || !options.channel || !options.responseModels.length
    || options.channel !== 'codex-subscription' && (!options.baseUrl || !options.apiKey)
  if (missing && !interactive) {
    throw new Error('Set --model, --label, --family, --family-name, --channel, --response-model, and API credentials. Use --help for details.')
  }
  if (missing) {
    for (const [key, label, hint] of [
      ['model', 'Requested model', 'API model ID (or set MODEL).'],
      ['label', 'Reference model label', 'Stable label stored in the reference bank.'],
      ['family', 'Model family', 'Family ID, for example gpt or claude.'],
      ['familyName', 'Family display name', 'For example GPT or Claude.'],
    ] as const) {
      if (!options[key]) options[key] = await askCollectionField({ title: 'Setup', label, hint, validate: requireValue })
    }
    if (!options.channel) options.channel = await askCollectionField({ title: 'Setup', label: 'Collection channel',
      hint: 'Route ID, for example openrouter/anthropic, codex-subscription, or kimi-code-subscription.',
      validate: value => { requireValue(value); validateChannel(value, options.subscription) } })
    if (!options.responseModels.length) options.responseModels = (await askCollectionField({ title: 'Setup', label: 'Allowed response models',
      hint: 'Comma-separated exact IDs. Responses outside this list stop collection.',
      validate: value => { if (!value.split(',').every(model => model.trim())) throw new Error('Enter one or more model IDs, separated by commas.') },
    })).split(',').map(model => model.trim())
  }
  validateChannel(options.channel, options.subscription)
  if (options.channel === 'codex-subscription') {
    if (options.baseUrl && options.baseUrl !== CODEX_ENDPOINT && (options.supplied.has('baseurl') || options.supplied.has('base-url'))) throw new Error('codex-subscription uses the fixed local-login endpoint; omit --baseurl.')
    if (options.supplied.has('api') && options.api !== 'responses' || !options.stream) throw new Error('codex-subscription requires Responses streaming.')
    options.baseUrl = CODEX_ENDPOINT
    options.api = 'responses'
    options.stream = true
  } else if (missing) {
    if (!options.supplied.has('api') && options.channel !== 'codex-subscription') {
      options.api = collectionApi(await askCollectionField({ title: 'Setup', label: 'API format', hint: 'responses, chatcompletion (cc), or message', defaultValue: options.api, validate: value => { collectionApi(value) } }))
    }
    if (!options.baseUrl) options.baseUrl = await askCollectionField({ title: 'Setup', label: 'API endpoint', hint: 'Base URL or full endpoint (or set BASE_URL).',
      validate: value => { requireValue(value); requestEndpoint({ ...collectionConfig(options), baseUrl: value }) } })
    if (!options.apiKey) options.apiKey = await askCollectionField({ title: 'Setup', label: 'API key', hint: 'Masked input. Prefer setting API_KEY before running fpd. The key is never saved.', secret: true, validate: requireValue })
  }
  if (missing) {
    if (!options.supplied.has('effort')) options.effort = await askCollectionField({ title: 'Setup', label: 'Reasoning effort', hint: 'Use default to omit this parameter, or enter the API effort level.', defaultValue: options.effort, validate: requireValue })
    if (!options.outputDir) options.outputDir = await askCollectionField({ title: 'Setup', label: 'Output directory', defaultValue: collectionDirectory(undefined, repository), validate: requireValue })
    for (const [key, flag, label, maximum] of [
      ['count', 'count', 'Fixed suite challenge count', 36],
      ['parallel', 'parallel', 'Concurrent requests', 36],
      ['maxAttempts', 'max-attempts', 'Maximum cumulative attempts per challenge', 20],
    ] as const) {
      if (!options.supplied.has(flag)) options[key] = integer(await askCollectionField({ title: 'Setup', label,
        defaultValue: String(options[key]), validate: value => { integer(value, label, maximum) } }), label, maximum)
    }
  }
  requestEndpoint(collectionConfig(options))
}

function progressSnapshot(manifest: Manifest, attempts: Attempt[], maxAttempts: number, startedAt: number, live?: EngineProgress): CollectionProgress {
  const selected = selectedAttempts(manifest, attempts)
  const active = live?.active ?? []
  let failed = 0
  manifest.tasks.forEach((task, index) => {
    if (selected[index] || active.some(row => row.challenge === task.id)) return
    const history = attempts.filter(row => row.challenge_id === task.id)
    if (history.length && (Math.max(...history.map(row => row.attempt)) >= maxAttempts || history.at(-1)?.retryable === false)) failed++
  })
  const accepted = selected.filter(Boolean).length
  return {
    total: manifest.tasks.length, accepted, failed, pending: manifest.tasks.length - accepted - failed, startedAt,
    active: active.map(row => ({ id: row.challenge, attempt: row.attempt, count: row.count,
      expected: manifest.tasks.find(task => task.id === row.challenge)!.expected_count, state: row.text ? 'Streaming' : 'Waiting' })),
    failures: attempts.filter(row => row.status === 'failed' || row.status === 'interrupted').slice(-3)
      .map(row => ({ id: `${row.challenge_id}:${row.attempt}`, message: row.error || row.status })),
  }
}

export async function runCollectionCommand(command: 'sample' | 'enroll', args: string[]): Promise<void> {
  let options: CollectionOptions | undefined
  let report: CollectionReport | undefined
  let failure: string | undefined
  const startedAt = Date.now()
  const interactive = !!process.stdin.isTTY && !!process.stderr.isTTY && !args.includes('--json') && !process.env.CI && process.env.TERM !== 'dumb'
  try {
    options = parseCollectionOptions(command, args)
    if (!options) { await printCollectionHelp(command, collectionHelp(command), interactive); return }
    const repository = await discoverRepository()
    const destination = options.enroll ? await enrollmentDirectory(options.dataDir, repository, interactive) : undefined
    if (command === 'enroll' && !options.resume) {
      if (!interactive) throw new Error('Specify the saved batch directory: fpd enroll DIR --data-dir DIR.')
      options.resume = await askCollectionField({ title: 'Setup · Enrollment', label: 'Saved batch directory', validate: requireValue })
    }
    let manifest: Manifest
    let directory: string
    let attempts: Attempt[] = []
    if (options.resume) {
      directory = resolve(options.resume)
      manifest = await loadManifest(directory)
      attempts = await loadAttempts(directory, manifest)
    } else {
      await setup(options, repository, interactive)
      directory = collectionDirectory(options.outputDir, repository)
      manifest = createManifest(collectionConfig(options), {
        label: options.label, family: options.family, family_name: options.familyName,
        channel: options.channel, response_models: options.responseModels, subscription: options.subscription,
      }, options.count, options.channel === 'codex-subscription')
    }
    let adjustment: { challenge: string; prompt?: string; systemPrompt?: string; effort?: string; note: string } | undefined
    if (options.challenge && (options.promptFile || options.supplied.has('effort'))) {
      const prompt = options.promptFile ? await readFile(resolve(options.promptFile), 'utf8') : undefined
      adjustment = { challenge: options.challenge, prompt,
        systemPrompt: options.systemFile ? await readFile(resolve(options.systemFile), 'utf8') : undefined,
        effort: options.supplied.has('effort') ? options.effort : undefined, note: options.note! }
      if (prompt !== undefined && !prompt.trim()) throw new Error('--prompt-file must contain a nonempty prompt.')
    }
    const selected = selectedAttempts(manifest, attempts)
    if (adjustment && !manifest.tasks.some(task => task.id === adjustment.challenge)) throw new Error(`Unknown challenge: ${adjustment.challenge}`)
    if (adjustment && selected.some(row => row?.challenge_id === adjustment.challenge)) throw new Error('A selected challenge cannot be adjusted. Create a new batch instead.')
    const needsRequests = command === 'sample' && !options.adopt && manifest.tasks.some((task, index) => !selected[index]
      && Math.max(0, ...attempts.filter(row => row.challenge_id === task.id).map(row => row.attempt)) < options!.maxAttempts)
    if (needsRequests && !manifest.codex && !options.apiKey) {
      if (!interactive) throw new Error('Set --apikey or API_KEY before resuming collection.')
      options.apiKey = await askCollectionField({ title: 'Setup · Resume', label: 'API key', hint: 'Masked input. The key is never saved.', secret: true, validate: requireValue })
    }
    if (interactive && command === 'sample') {
      const rows: [string, string][] = [
        ['Batch', options.resume ? `Resume ${manifest.id}` : 'New reference batch'],
        ['Label / family', `${manifest.model.id} / ${manifest.model.family_name}`],
        ['Requested model', manifest.request.model ?? 'Unknown'],
        ['Channel', manifest.source.channel],
        ['Endpoint', manifest.source.endpoint ?? 'Unknown'],
        ['Allowed models', manifest.request.response_models.join(', ')],
        ['Request', `${manifest.request.format} · ${manifest.request.stream ? 'streaming' : 'JSON'} · effort ${manifest.request.reasoning_effort || 'default'}`],
        ['Plan', `${manifest.tasks.length} fixed challenges · ${options.parallel} concurrent · ${options.maxAttempts} attempts maximum`],
        ['Authentication', manifest.codex ? 'Local Codex login (run codex login if needed)' : options.apiKey ? 'API key supplied (not saved)' : 'Offline; no credentials needed'],
        ['Output', directory],
      ]
      if (destination) rows.push(['Enrollment target', destination.path])
      if (adjustment) rows.push(['Challenge adjustment', `${adjustment.challenge}${options.promptFile ? `: ${resolve(options.promptFile)}` : ''}${options.systemFile ? `; system ${resolve(options.systemFile)}` : ''}${adjustment.effort ? `; effort ${adjustment.effort}` : ''}`], ['Note', adjustment.note])
      if (options.adopt) rows.push(['Offline adoption', `${options.adopt.id}:${options.adopt.attempt}${options.take ? ` · first ${options.take} numbers` : ''}`], ['Note', options.note!])
      if (!await confirmCollection('Setup · Review', rows.map(([name, value]) => [name, terminalText(value, options!.apiKey)]),
        options.adopt ? 'Adopt this saved response? No API requests will run.' : needsRequests ? 'Start these API requests?' : 'Verify and save this batch?')) throw new CollectionCancelled()
    }
    if (!options.resume) {
      await mkdir(dirname(directory), { recursive: true })
      await mkdir(directory, { mode: 0o700 })
      await saveJson(join(directory, 'manifest.json'), manifest)
    }
    const abort = new AbortController()
    const cancel = () => abort.abort()
    let state = progressSnapshot(manifest, attempts, options.maxAttempts, startedAt)
    report = { status: 'partial', directory, total: state.total, accepted: state.accepted, natural: 0, truncated: 0, unknownCompletion: 0,
      failed: state.failed, pending: state.pending, elapsedMs: 0, next: [] }
    if (destination) report.destination = destination.path
    if (command === 'sample') {
      process.once('SIGINT', cancel)
      process.once('SIGTERM', cancel)
      const display = createCollectionDisplay(state, manifest.model.id, directory, cancel, interactive, options.apiKey)
      try {
        await withLock(directory, async () => {
          try {
            if (options!.adopt) {
              attempts = await adoptAttempt(directory, manifest, options!.adopt.id, options!.adopt.attempt, options!.take, options!.note!)
            } else {
              attempts = await collect(directory, manifest, options!.apiKey, options!.maxAttempts, abort.signal, undefined, options!.parallel, live => {
                attempts = live.attempts
                state = progressSnapshot(manifest, attempts, options!.maxAttempts, startedAt, live)
                display.update(state)
              }, adjustment)
            }
          } finally { await saveSummary(directory, manifest, attempts) }
        })
      } catch (cause) {
        failure = terminalText(cause instanceof Error ? cause.message : String(cause), options.apiKey)
        process.exitCode = 1
      } finally {
        state = progressSnapshot(manifest, attempts, options.maxAttempts, startedAt)
        display.update(state)
        await display.finish()
        process.removeListener('SIGINT', cancel)
        process.removeListener('SIGTERM', cancel)
      }
    }
    const accepted = selectedAttempts(manifest, attempts).filter((row): row is Attempt => !!row)
    report.accepted = accepted.length
    report.natural = accepted.filter(row => row.completion === 'complete').length
    report.truncated = accepted.filter(row => row.completion === 'truncated').length
    report.unknownCompletion = accepted.filter(row => row.completion === 'unknown').length
    report.failed = state.failed
    report.pending = state.pending
    report.status = abort.signal.aborted ? 'cancelled' : accepted.length === manifest.tasks.length ? 'complete' : 'partial'
    if (!failure && !abort.signal.aborted && destination && (command === 'enroll' || report.status === 'complete')) {
      const progress = (value: { stage: 'validating' | 'building' | 'writing'; message: string }) => process.stderr.write(`${value.stage}: ${terminalText(value.message, options!.apiKey)}\n`)
      const preview = await enroll(directory, destination.path, true, progress)
      if (options.dryRun) {
        report.enrollment = preview
        report.destination = destination.path
        report.status = 'validated'
      } else {
        const confirmed = !interactive || options.yes || await confirmCollection('Setup · Enrollment review', [
          ['Batch', directory], ['Destination', destination.path], ['Destination source', destination.automatic ? 'Detected repository (not yet written)' : 'Explicit --data-dir'],
          ['New samples', String(preview.added)], ['Duplicates skipped', String(preview.skipped)], ['Resulting samples', String(preview.total)],
          ['Accepted responses', `${report.natural} natural completions · ${report.truncated} accepted truncations · ${report.unknownCompletion} unknown completion`],
          ['Verifier', preview.added ? 'Not retrained; updated bank needs matching verifier/calibration.' : 'No reference changes.'],
        ], 'Write these samples and rebuild this reference bank?')
        if (confirmed) {
          report.enrollment = await enroll(directory, destination.path, false, progress)
          report.destination = destination.path
          report.status = 'enrolled'
        }
      }
    }
    if (report.status === 'partial' || report.status === 'cancelled') {
      if (!failure) process.exitCode = 2
    }
  } catch (cause) {
    failure = terminalText(cause instanceof Error ? cause.message : String(cause), options?.apiKey || process.env.API_KEY || '')
    process.exitCode = cause instanceof CollectionCancelled ? 2 : 1
  }
  if (report) {
    report.elapsedMs = Date.now() - startedAt
    const quoted = `'${report.directory.replaceAll("'", "'\\''")}'`
    if (report.status === 'partial' || report.status === 'cancelled') report.next.push(`fpd sample --resume ${quoted} --max-attempts ${Math.min(20, (options?.maxAttempts ?? 3) + 3)}`)
    const target = report.destination ?? (options?.dataDir ? resolve(options.dataDir) : undefined)
    if (report.status !== 'enrolled') report.next.push(`fpd enroll ${quoted}${target ? ` --data-dir '${target.replaceAll("'", "'\\''")}'` : ' --data-dir /path/to/data'}`)
    if (report.status === 'enrolled' && report.enrollment?.added && report.destination) {
      report.next.push(`fpd retrain --data-dir '${report.destination.replaceAll("'", "'\\''")}'`)
    }
    if (failure) report.error = failure
    await printCollectionReport(report, options?.json ?? args.includes('--json'), interactive)
  } else if (failure && (options?.json || args.includes('--json'))) process.stdout.write(JSON.stringify({ status: 'error', error: failure }) + '\n')
  if (failure) process.stderr.write(failure + '\n')
}
