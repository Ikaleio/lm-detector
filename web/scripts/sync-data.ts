import { mkdir, readFile, writeFile, copyFile, stat, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { redactPrivateMetadata } from '@fingerpoint/shared/privacy'
import { parseReference, referenceSamples } from '@fingerpoint/shared/reference'

try {
  await stat('data/.pending-enrollment')
  throw new Error('入库事务尚未完成，请重跑 enroll 恢复后再构建。')
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
const referenceBytes = await readFile('data/unified_reference.jsonl', 'utf8')
const bank = JSON.parse(await readFile('data/unified_bank.json', 'utf8'))
if (bank.reference_sha256 !== createHash('sha256').update(referenceBytes).digest('hex')) {
  throw new Error('参考数据与派生库不匹配，不能发布。请先完成入库或重建。')
}
const batches = parseReference(referenceBytes)
const sampleCounts = new Map<string, number>()
for (const { batch } of referenceSamples(batches)) sampleCounts.set(batch.model.id, (sampleCounts.get(batch.model.id) ?? 0) + 1)
if (sampleCounts.size !== bank.models.length || bank.models.some((model: { id: string; response_count: number }) => sampleCounts.get(model.id) !== model.response_count)) {
  throw new Error('参考样本数与派生库不匹配，不能发布。')
}
const references = batches.map(batch => JSON.stringify(redactPrivateMetadata(batch))).join('\n') + '\n'
const publicBank = redactPrivateMetadata(bank)
publicBank.reference_sha256 = createHash('sha256').update(references).digest('hex')
await mkdir('web/public/data', { recursive: true })
await writeFile('web/public/data/unified_reference.jsonl', references)
await writeFile('web/public/data/unified_bank.json', JSON.stringify(publicBank, null, 2) + '\n')
await rm('web/public/data/import_manifest.json', { force: true })
await copyFile('data/shared_detector.json', 'web/public/data/shared_detector.json')
console.log(`Synced ${batches.length} reference batches, ${[...sampleCounts.values()].reduce((sum, count) => sum + count, 0)} samples and their derived bank.`)
