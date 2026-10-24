import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { prepareReferenceRows } from '../shared/builder'
import { parseReference } from '../shared/reference'
import { encodeDetector } from '../shared/detector-codec'
import type { SharedDetector } from '../shared/shared-detector'
import type { Bank } from '../shared/types'
import { atomicWrite, missing, sha256 } from '../cli/storage'
import { calibrate } from './calibrate'
import { fileHash, save, serialize } from './export'
import { referencePanel } from './reference'
import { fitRanker, prepareTrainingRows } from './train'

async function optionalHash(path: string) {
  return fileHash(path).catch(error => { if (missing(error)) return null; throw error })
}

/** Freeze source files in a checkout, or the executable bundles in an installed CLI. */
async function trainerSources() {
  const directory = dirname(fileURLToPath(import.meta.url))
  if (!import.meta.url.endsWith('.ts')) {
    return (await readdir(directory)).filter(name => name.endsWith('.js')).sort()
      .map(name => ({ name: `bin/${name}`, path: join(directory, name) }))
  }
  const root = dirname(directory)
  const names = [
    ...(await readdir(directory)).filter(name => name.endsWith('.ts')).sort().map(name => `offline/${name}`),
    'shared/builder.ts', 'shared/fingerprint-core.js', 'shared/positional.ts', 'shared/shared-detector.ts',
    'shared/detector-codec.ts', 'shared/reference.ts', 'cli/storage.ts', 'cli/retrain-worker.ts',
    'package.json', 'bun.lock',
  ]
  return [...names.map(name => ({ name, path: join(root, name) })),
    { name: 'dependencies/ml-matrix.js', path: createRequire(import.meta.url).resolve('ml-matrix') }]
}

export async function retrain(dataDir: string, progress: (message: string) => void = () => {}) {
  progress('VALIDATE reference data and bank')
  const referencePath = join(dataDir, 'unified_reference.jsonl'), bankPath = join(dataDir, 'unified_bank.json')
  const referenceBytes = await readFile(referencePath), bankBytes = await readFile(bankPath)
  const referenceSha = sha256(referenceBytes), bankSha = sha256(bankBytes)
  const bank: Bank = JSON.parse(bankBytes.toString())
  if (bank.schema !== 'robust-number-fingerprint-bank' || bank.reference_sha256 !== referenceSha) {
    throw new Error('Reference data and bank differ; rebuild the bank first.')
  }
  const ids = bank.models.map(model => model.id)
  if (ids.length < 2 || new Set(ids).size !== ids.length) throw new Error('Ranking needs at least two distinct models.')
  const rows = prepareReferenceRows(parseReference(referenceBytes.toString()))
  if (new Set(rows.map(row => row.source)).size !== ids.length || rows.some(row => !ids.includes(row.source))
    || bank.models.some(model => rows.filter(row => row.source === model.id).length !== model.response_count)
    || bank.robust.training_rows !== rows.length || JSON.stringify(bank.robust.model_order) !== JSON.stringify(ids)) {
    throw new Error('Reference rows and bank statistics differ; rebuild the bank first.')
  }
  const panel = referencePanel(rows, ids), training = prepareTrainingRows(rows)
  const detectorPath = join(dataDir, 'shared_detector.bin'), previousSha = await optionalHash(detectorPath)
  const stamp = `${new Date().toISOString().replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`
  const out = join(dataDir, '.training', stamp), fitDir = join(out, 'fit')
  await mkdir(fitDir, { recursive: true })
  if (previousSha !== null) {
    const backup = join(out, 'before-shared-detector.bin')
    await copyFile(detectorPath, backup)
    if (await fileHash(backup) !== previousSha) throw new Error('Previous detector changed while saving its backup.')
  }
  const frozen = join(out, 'frozen-source')
  const sources = await Promise.all((await trainerSources()).map(async source => {
    const bytes = await readFile(source.path), path = join(frozen, source.name)
    await mkdir(dirname(path), { recursive: true })
    await atomicWrite(path, bytes)
    return { ...source, sha256: sha256(bytes), frozen: path }
  }))
  await save(join(out, 'plan.json'), { created_at: new Date().toISOString(), runtime: process.versions,
    reference_sha256: referenceSha, bank_sha256: bankSha, previous_detector_sha256: previousSha,
    code_sha256: Object.fromEntries(sources.map(source => [source.name, source.sha256])),
    model_ids: ids, panel_groups: panel.length, new_api_calls: 0 })
  progress(`TRAIN ${out}`)
  const ranker = fitRanker(training, ids)
  await save(join(fitDir, 'ranker.json'), ranker)
  const baseSha = await fileHash(join(fitDir, 'ranker.json'))
  const artifact: SharedDetector & { bank_robust_sha256: string; probability_status: string } = {
    schema: 'shared-detector-v2', source_run: relative(dataDir, fitDir), base_sha256: baseSha,
    source_reference_sha256: referenceSha, bank_built_at: bank.built_at,
    bank_robust_sha256: sha256(serialize(bank.robust)), model_ids: ids,
    response_counts: bank.models.map(model => model.response_count), ranker,
    calibration: null, calibration_sha256: null, probability_status: 'unavailable',
  }
  const candidatePath = join(fitDir, 'shared_detector.json')
  await save(candidatePath, artifact)
  const candidateSha = await fileHash(candidatePath)
  await save(join(fitDir, 'fit-complete.json'), { artifact_sha256: candidateSha, bank_sha256: bankSha,
    models: ids.length, training_rows: rows.length, new_api_calls: 0 })
  progress('CALIBRATE 78 held-out ranker fits')
  const calibrationDir = join(out, 'calibration')
  const calibration = await calibrate(dataDir, calibrationDir, training, panel, artifact, progress)
  if (!calibration.passed) throw new Error(`Nested calibration rejected the detector. Evidence: ${out}`)

  progress('EXPORT frozen detector after calibration passed')
  for (const source of sources) {
    if (await fileHash(source.path) !== source.sha256 || await fileHash(source.frozen) !== source.sha256) {
      throw new Error(`Training code changed during fitting: ${source.name}`)
    }
  }
  if (await fileHash(candidatePath) !== candidateSha || await fileHash(join(fitDir, 'ranker.json')) !== baseSha
    || await fileHash(join(calibrationDir, 'calibration.json')) !== calibration.calibrationSha) {
    throw new Error('Frozen training or calibration artifacts changed.')
  }
  for (const fold of calibration.completion.folds) {
    if (await fileHash(join(calibrationDir, fold.artifact)) !== fold.sha256) throw new Error(`Frozen fold changed: ${fold.artifact}`)
  }
  artifact.calibration = calibration.head
  artifact.calibration_sha256 = calibration.calibrationSha
  artifact.probability_status = 'reference_calibrated'
  const payload = encodeDetector(artifact)
  if (await fileHash(referencePath) !== referenceSha || await fileHash(bankPath) !== bankSha
    || await optionalHash(detectorPath) !== previousSha) {
    throw new Error('Reference inputs or the installed detector changed during fitting.')
  }
  await atomicWrite(detectorPath, payload)
  return { path: detectorPath, bytes: payload.length, sha256: sha256(payload), models: ids.length }
}
