import { Worker } from 'node:worker_threads'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { missing, withLock } from './storage'

const usage = `Usage: fpd retrain --data-dir DIR

Refit the ranker and closed-set confidence calibration from an enrolled
reference bank. Runs with Node or Bun and does not call a model API. The original
detector is preserved if fitting or calibration validation fails.
`

export async function runRetrainCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    'data-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } })
  if (values.help) { process.stdout.write(usage); return }
  if (!values['data-dir']?.trim()) throw new Error('Specify an existing --data-dir.\n' + usage)
  const directory = resolve(values['data-dir'])
  const info = await stat(directory).catch(error => {
    if (missing(error)) throw new Error(`Data directory does not exist: ${directory}`)
    throw error
  })
  if (!info.isDirectory()) throw new Error(`Data destination is not a directory: ${directory}`)

  await withLock(directory, () => new Promise<void>((done, reject) => {
    const entry = import.meta.url.endsWith('.ts') ? './retrain-worker.ts' : './retrain-worker.js'
    const worker = new Worker(new URL(entry, import.meta.url), { workerData: { directory } })
    let result: unknown, interrupted = false
    const cancel = () => { interrupted = true; void worker.terminate() }
    process.once('SIGINT', cancel)
    process.once('SIGTERM', cancel)
    worker.on('message', message => {
      if (message.progress) process.stderr.write(message.progress + '\n')
      if (message.result) result = message.result
    })
    worker.once('error', reject)
    worker.once('exit', code => {
      process.off('SIGINT', cancel)
      process.off('SIGTERM', cancel)
      if (code === 0 && result && !interrupted) {
        process.stdout.write(JSON.stringify(result) + '\n')
        done()
      } else reject(new Error(`Retraining ${interrupted ? 'was interrupted' : `failed (exit ${code})`}. Evidence is in ${directory}/.training/.`))
    })
  }))
}
