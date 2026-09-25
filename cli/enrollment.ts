import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { isDeepStrictEqual } from 'node:util'
import type { Bank } from '@fingerpoint/shared/types'
import type { ReferenceBatch, ReferenceSample } from '@fingerpoint/shared/reference'
import { parseReference, referenceSamples } from '@fingerpoint/shared/reference'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import { loadAttempts, loadManifest, referenceBatch, selectedAttempts, verifyTrace } from './sampling'
import { atomicWrite, missing, readJson, saveJson, sha256, withLock } from './storage'

export interface EnrollmentProgress { stage: 'validating' | 'building' | 'writing'; message: string }
export interface Receipt {
  schema: 'fingerpoint-enrollment-v2'
  run_id: string
  manifest_sha256: string
  added: number
  skipped: number
  total: number
  created_at: string
  previous_reference_sha256: string
  reference_sha256: string
  previous_bank_sha256: string
  bank_sha256: string
  selected_attempts: { challenge_id: string; attempt: number; row_id: string }[]
  detector_status: 'legacy-ranking-until-retrained'
  dry_run?: boolean
  already_enrolled?: boolean
}
function validateSamples(batches: ReferenceBatch[]) {
  for (const { sample } of referenceSamples(batches)) {
    if (parseNumbers(sample.text).length < Math.max(80, Math.ceil(sample.expected_count * .55))) throw new Error(`Invalid reference sample: ${sample.id}`)
  }
}
export async function buildBankFile(reference: string, output: string) {
  await new Promise<void>((resolve, reject) => {
    const entry = import.meta.url.endsWith('.ts') ? './bank-worker.ts' : './bank-worker.js'
    const worker = new Worker(new URL(entry, import.meta.url), { workerData: { reference, output } })
    worker.on('message', message => console.error(message))
    worker.on('error', reject)
    worker.on('exit', code => code === 0 ? resolve() : reject(new Error(`Bank worker exited with code ${code}.`)))
  })
}
async function currentFile(path: string) {
  try { return await readFile(path, 'utf8') } catch (error) { if (missing(error)) return ''; throw error }
}

/** Validate prepared files for preview; install them only after write confirmation. */
async function recover(directory: string, apply = true) {
  const pending = join(directory, '.pending-enrollment')
  let receipt: Receipt
  try { receipt = await readJson<Receipt>(join(pending, 'receipt.json')) } catch (error) {
    if (!missing(error)) throw error
    // No receipt means preparation did not finish and no official file was replaced.
    if (apply) await rm(pending, { recursive: true, force: true })
    return
  }
  if (receipt.schema !== 'fingerpoint-enrollment-v2' || !/^[a-f0-9-]+$/.test(receipt.run_id)) throw new Error('Invalid enrollment recovery receipt.')
  const stagedFiles: Record<string, string> = {}
  for (const [name, oldHash, nextHash] of [
    ['unified_reference.jsonl', receipt.previous_reference_sha256, receipt.reference_sha256],
    ['unified_bank.json', receipt.previous_bank_sha256, receipt.bank_sha256],
  ]) {
    const staged = await readFile(join(pending, 'after', name), 'utf8')
    if (sha256(staged) !== nextHash) throw new Error('Staged enrollment file hash mismatch.')
    const currentHash = sha256(await currentFile(join(directory, name)))
    if (currentHash !== oldHash && currentHash !== nextHash) throw new Error('Official data changed outside the transaction. Inspect the backups in .pending-enrollment before continuing.')
    stagedFiles[name] = staged
  }
  if (apply) {
    for (const [name, content] of Object.entries(stagedFiles)) await atomicWrite(join(directory, name), content)
    await mkdir(join(directory, '.enrollments'), { recursive: true })
    await rename(pending, join(directory, '.enrollments', receipt.run_id))
  }
  return { runId: receipt.run_id, reference: stagedFiles['unified_reference.jsonl'], bank: stagedFiles['unified_bank.json'] }
}

export async function enroll(directory: string, dataDirectory: string, dryRun = false, onProgress?: (progress: EnrollmentProgress) => void): Promise<Receipt> {
  await mkdir(dataDirectory, { recursive: true })
  return withLock(directory, async () => withLock(dataDirectory, async () => {
    onProgress?.({ stage: 'validating', message: 'Validating samples and original evidence' })
    const prepared = await recover(dataDirectory, !dryRun)
    if (prepared) onProgress?.({ stage: 'validating', message: dryRun ? `Prepared enrollment ${prepared.runId} will be recovered on write.` : `Recovered enrollment ${prepared.runId}.` })
    const manifest = await loadManifest(directory)
    const attempts = await loadAttempts(directory, manifest)
    const incoming = referenceBatch(manifest, attempts)
    const selected = selectedAttempts(manifest, attempts)
    for (const [index, task] of manifest.tasks.entries()) await verifyTrace(directory, manifest, task, selected[index]!)
    parseReference(JSON.stringify(incoming))
    validateSamples([incoming])
    const referencePath = join(dataDirectory, 'unified_reference.jsonl'), bankPath = join(dataDirectory, 'unified_bank.json')
    const oldReference = prepared?.reference ?? await currentFile(referencePath), oldBank = prepared?.bank ?? await currentFile(bankPath)
    if (!!oldReference !== !!oldBank) throw new Error('Reference data and bank must both exist, or the destination must be empty.')
    const existing = parseReference(oldReference)
    validateSamples(existing)
    if (oldBank && (JSON.parse(oldBank) as Bank).reference_sha256 !== sha256(oldReference)) throw new Error('Reference data and derived bank hashes do not match. Recover or rebuild first.')
    const byId = new Map<string, { batch: ReferenceBatch; sample: ReferenceSample }>()
    const signature = (batch: ReferenceBatch, sample: ReferenceSample) => sha256(JSON.stringify([batch.model.id, batch.source.channel, sample.actual_channel, sample.condition, sample.challenge_id, sample.text.trim()]))
    const signatures = new Set<string>()
    for (const row of referenceSamples(existing)) { byId.set(row.sample.id, row); signatures.add(signature(row.batch, row.sample)) }
    const priorBatch = existing.find(batch => batch.id === incoming.id)
    const { samples: _incomingSamples, ...incomingInfo } = incoming
    if (priorBatch) {
      const { samples: _priorSamples, ...priorInfo } = priorBatch
      if (!isDeepStrictEqual(priorInfo, incomingInfo)) throw new Error(`Batch metadata conflict: ${incoming.id}`)
    }
    for (const batch of existing) {
      if (batch.model.id === incoming.model.id && !isDeepStrictEqual(batch.model, incoming.model)) throw new Error(`Model family metadata conflicts with the existing model: ${incoming.model.id}`)
    }
    const addedSamples: ReferenceSample[] = []
    let skipped = 0
    for (const sample of incoming.samples) {
      const prior = byId.get(sample.id)
      if (prior && (prior.batch.id !== incoming.id || !isDeepStrictEqual(prior.sample, sample))) throw new Error(`Conflicting content for sample ID: ${sample.id}`)
      const key = signature(incoming, sample)
      if (prior || signatures.has(key)) { skipped++; continue }
      addedSamples.push(sample); signatures.add(key)
    }
    const added = addedSamples.length, total = byId.size + added
    const batches = existing.map(batch => batch === priorBatch ? { ...batch, samples: [...batch.samples, ...addedSamples] } : batch)
    if (!priorBatch && added) batches.push({ ...incomingInfo, samples: addedSamples })
    const nextReference = added ? batches.map(batch => JSON.stringify(batch)).join('\n') + '\n' : oldReference
    const receipt: Receipt = { schema: 'fingerpoint-enrollment-v2', run_id: manifest.id, manifest_sha256: manifest.fingerprint,
      added, skipped, total, created_at: new Date().toISOString(),
      previous_reference_sha256: sha256(oldReference), reference_sha256: sha256(nextReference),
      previous_bank_sha256: sha256(oldBank), bank_sha256: sha256(oldBank),
      selected_attempts: incoming.samples.map(sample => ({ challenge_id: sample.challenge_id, attempt: sample.attempt!, row_id: sample.id })),
      detector_status: 'legacy-ranking-until-retrained', ...(dryRun ? { dry_run: true } : {}) }
    if (dryRun || !added) {
      if (!dryRun) {
        try {
          const priorReceipt = await readJson<Receipt>(join(dataDirectory, '.enrollments', manifest.id, 'receipt.json'))
          if (priorReceipt.manifest_sha256 !== manifest.fingerprint) throw new Error('Previously enrolled batch has a different manifest fingerprint.')
          const result = { ...priorReceipt, added: 0, skipped, total, already_enrolled: true }
          await saveJson(join(directory, 'enrollment.json'), result)
          return result
        } catch (error) { if (!missing(error)) throw error }
        await saveJson(join(directory, 'enrollment.json'), receipt)
      }
      return receipt
    }
    const pending = join(dataDirectory, '.pending-enrollment')
    await mkdir(join(pending, 'before'), { recursive: true })
    await mkdir(join(pending, 'after'), { recursive: true })
    await atomicWrite(join(pending, 'before', 'unified_reference.jsonl'), oldReference)
    await atomicWrite(join(pending, 'before', 'unified_bank.json'), oldBank)
    await atomicWrite(join(pending, 'after', 'unified_reference.jsonl'), nextReference)
    onProgress?.({ stage: 'building', message: 'Building the reference fingerprint bank' })
    await buildBankFile(join(pending, 'after', 'unified_reference.jsonl'), join(pending, 'after', 'unified_bank.json'))
    receipt.bank_sha256 = sha256(await readFile(join(pending, 'after', 'unified_bank.json'), 'utf8'))
    await saveJson(join(pending, 'receipt.json'), receipt)
    onProgress?.({ stage: 'writing', message: 'Atomically writing reference data and bank' })
    await recover(dataDirectory)
    await saveJson(join(directory, 'enrollment.json'), receipt)
    return receipt
  }))
}
