import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { isDeepStrictEqual } from 'node:util'
import type { Bank, SampleRow } from '@fingerpoint/shared/types'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import { redactPrivateMetadata } from '@fingerpoint/shared/privacy'
import { loadAttempts, loadManifest, referenceRows, selectedAttempts, verifyTrace } from './sampling'
import { atomicWrite, missing, readJson, saveJson, sha256, withLock } from './storage'

interface Receipt {
  schema: 'fingerpoint-enrollment-v1'
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
}
function validateRows(rows: SampleRow[]) {
  const ids = new Set<string>()
  for (const row of rows) {
    if (String(row.purpose ?? '').startsWith('holdout') || String(row.purpose ?? '').startsWith('evaluation') || row.test_set_id) throw new Error('评估记录不能入库')
    if (!row.row_id || !row.source || !row.condition_id || !row.challenge_id || typeof row.text !== 'string') throw new Error('参考样本缺少标识、模型或挑战信息')
    if (ids.has(row.row_id)) throw new Error(`参考样本标识重复：${row.row_id}`)
    ids.add(row.row_id)
    if (!['original', 'openrouter', 'api', 'codex'].includes(row.provenance?.kind)) throw new Error('参考样本缺少有效来源')
    if (!row.strict_valid || !Number.isInteger(row.requested_count) || row.requested_count < 1 || parseNumbers(row.text).length < Math.max(80, Math.ceil(row.requested_count * .55))) throw new Error(`无效参考样本：${row.row_id}`)
  }
}
export async function buildBankFile(reference: string, output: string) {
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./bank-worker.ts', import.meta.url), { workerData: { reference, output } })
    worker.on('message', message => console.error(message))
    worker.on('error', reject)
    worker.on('exit', code => code === 0 ? resolve() : reject(new Error(`建库进程退出：${code}`)))
  })
}
async function currentFile(path: string) {
  try { return await readFile(path, 'utf8') } catch (error) { if (missing(error)) return ''; throw error }
}

/** Complete a prepared transaction before allowing another enrollment. */
async function recover(directory: string) {
  const pending = join(directory, '.pending-enrollment')
  let receipt: Receipt
  try { receipt = await readJson<Receipt>(join(pending, 'receipt.json')) } catch (error) {
    if (!missing(error)) throw error
    // No receipt means preparation did not finish and no official file was replaced.
    await rm(pending, { recursive: true, force: true }); return
  }
  if (receipt.schema !== 'fingerpoint-enrollment-v1' || !/^[a-f0-9-]+$/.test(receipt.run_id)) throw new Error('入库恢复记录无效')
  for (const [name, oldHash, nextHash] of [
    ['unified_reference.jsonl', receipt.previous_reference_sha256, receipt.reference_sha256],
    ['unified_bank.json', receipt.previous_bank_sha256, receipt.bank_sha256],
  ]) {
    const staged = await readFile(join(pending, 'after', name), 'utf8')
    if (sha256(staged) !== nextHash) throw new Error('入库暂存文件哈希不匹配')
    const currentHash = sha256(await currentFile(join(directory, name)))
    if (currentHash !== oldHash && currentHash !== nextHash) throw new Error('正式库在事务外被修改，请先核对 .pending-enrollment 中的备份')
  }
  for (const name of ['unified_reference.jsonl', 'unified_bank.json']) {
    await atomicWrite(join(directory, name), await readFile(join(pending, 'after', name), 'utf8'))
  }
  await mkdir(join(directory, '.enrollments'), { recursive: true })
  await rename(pending, join(directory, '.enrollments', receipt.run_id))
}

export async function enroll(directory: string, dataDirectory: string, dryRun = false) {
  await mkdir(dataDirectory, { recursive: true })
  return withLock(directory, async () => withLock(dataDirectory, async () => {
    if (!dryRun) await recover(dataDirectory)
    const manifest = await loadManifest(directory)
    const attempts = await loadAttempts(directory, manifest)
    const incoming: SampleRow[] = JSON.parse(JSON.stringify(redactPrivateMetadata(referenceRows(manifest, attempts))))
    const selected = selectedAttempts(manifest, attempts)
    for (const [index, task] of manifest.tasks.entries()) await verifyTrace(directory, manifest, task, selected[index]!)
    validateRows(incoming)
    const referencePath = join(dataDirectory, 'unified_reference.jsonl'), bankPath = join(dataDirectory, 'unified_bank.json')
    const oldReference = await currentFile(referencePath), oldBank = await currentFile(bankPath)
    const existing: SampleRow[] = oldReference.split('\n').filter(line => line.trim()).map(line => JSON.parse(line))
    validateRows(existing)
    if (oldBank && (JSON.parse(oldBank) as Bank).reference_sha256 !== sha256(oldReference)) throw new Error('正式参考库与派生库哈希不匹配，请先恢复或重建')
    const byId = new Map(existing.map(row => [row.row_id, row]))
    const signature = (row: SampleRow) => sha256(JSON.stringify([row.source, row.condition_id, row.challenge_id, row.text.trim()]))
    const signatures = new Set(existing.map(signature))
    const rows = [...existing]
    let skipped = 0
    for (const row of incoming) {
      const sameModel = existing.find(old => old.source === row.source)
      if (sameModel && (sameModel.family_id !== row.family_id || sameModel.family_name !== row.family_name)) throw new Error(`模型家族 metadata 与已有模型冲突：${row.source}`)
      const prior = byId.get(row.row_id)
      if (prior && !isDeepStrictEqual(prior, row)) throw new Error(`样本标识内容冲突：${row.row_id}`)
      if (prior || signatures.has(signature(row))) { skipped++; continue }
      rows.push(row); byId.set(row.row_id, row); signatures.add(signature(row))
    }
    const added = rows.length - existing.length
    if (dryRun || !added) {
      if (!dryRun) {
        try {
          const receipt = await readJson<Receipt>(join(dataDirectory, '.enrollments', manifest.id, 'receipt.json'))
          if (receipt.manifest_sha256 !== manifest.fingerprint) throw new Error('已入库批次的 manifest 不匹配')
          await saveJson(join(directory, 'enrollment.json'), receipt)
          return { ...receipt, added: 0, skipped, already_enrolled: true }
        } catch (error) { if (!missing(error)) throw error }
      }
      const result = { run_id: manifest.id, added, skipped, total: rows.length, dry_run: dryRun }
      if (!dryRun) await saveJson(join(directory, 'enrollment.json'), result)
      return result
    }
    const pending = join(dataDirectory, '.pending-enrollment')
    await mkdir(join(pending, 'before'), { recursive: true })
    await mkdir(join(pending, 'after'), { recursive: true })
    await atomicWrite(join(pending, 'before', 'unified_reference.jsonl'), oldReference)
    await atomicWrite(join(pending, 'before', 'unified_bank.json'), oldBank)
    const nextReference = rows.map(row => JSON.stringify(row)).join('\n') + '\n'
    await atomicWrite(join(pending, 'after', 'unified_reference.jsonl'), nextReference)
    await buildBankFile(join(pending, 'after', 'unified_reference.jsonl'), join(pending, 'after', 'unified_bank.json'))
    const nextBank = await readFile(join(pending, 'after', 'unified_bank.json'), 'utf8')
    const receipt: Receipt = { schema: 'fingerpoint-enrollment-v1', run_id: manifest.id, manifest_sha256: manifest.fingerprint,
      added, skipped, total: rows.length, created_at: new Date().toISOString(),
      previous_reference_sha256: sha256(oldReference), reference_sha256: sha256(nextReference),
      previous_bank_sha256: sha256(oldBank), bank_sha256: sha256(nextBank),
      selected_attempts: manifest.tasks.map((task, index) => ({ challenge_id: task.id, attempt: selected[index]!.attempt, row_id: incoming[index].row_id })),
      detector_status: 'legacy-ranking-until-retrained' }
    await saveJson(join(pending, 'receipt.json'), receipt)
    await recover(dataDirectory)
    await saveJson(join(directory, 'enrollment.json'), receipt)
    return receipt
  }))
}
