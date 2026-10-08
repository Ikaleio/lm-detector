import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { zstdCompressSync } from 'node:zlib'
import { redactPrivateMetadata } from '@fingerpoint/shared/privacy'
import { parseReference, referenceSamples } from '@fingerpoint/shared/reference'
import { nearestModels, supportsSharedDetector } from '@fingerpoint/shared/shared-detector'
import { assertTokenizerBank } from '@fingerpoint/shared/tokenizer-bank'
import { fitUsage } from '@fingerpoint/shared/usage-fit'

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
const detectorText = await readFile('data/shared_detector.json', 'utf8')
const detector = JSON.parse(detectorText)
const tokenizerBankText = await readFile('data/tokenizer_bank.json', 'utf8')
assertTokenizerBank(JSON.parse(tokenizerBankText))
const publicBank = redactPrivateMetadata(bank)
publicBank.reference_sha256 = createHash('sha256').update(references).digest('hex')
if (supportsSharedDetector(bank, detector)) {
  nearestModels(detector).forEach((neighbors, i) => { publicBank.models[i].nearest_models = neighbors })
}
const chunkSize = 4 * 1024 * 1024
const manifest: Record<string, string[]> = {}
async function publish(name: string, content: string) {
  const compressed = zstdCompressSync(Buffer.from(content))
  const digest = createHash('sha256').update(compressed).digest('hex').slice(0, 16)
  const parts: string[] = []
  for (let offset = 0; offset < compressed.length; offset += chunkSize) {
    const part = `${name}.${digest}.${parts.length}.zst`
    await writeFile(`web/public/data/chunks/${part}`, compressed.subarray(offset, offset + chunkSize))
    parts.push(part)
  }
  manifest[name] = parts
}
await rm('web/public/data', { recursive: true, force: true })
await mkdir('web/public/data', { recursive: true })
await mkdir('web/public/data/chunks')
await publish('unified_reference.jsonl', references)
await publish('unified_bank.json', JSON.stringify(publicBank))
await publish('shared_detector.json', detectorText)
await publish('tokenizer_bank.json', tokenizerBankText)
const usageFit = fitUsage(batches)
await publish('usage_fit.json', JSON.stringify(usageFit))
await writeFile('web/public/data/manifest.json', JSON.stringify(manifest))
await mkdir('web/.generated', { recursive: true })
await writeFile('web/.generated/unified_bank.json', JSON.stringify(publicBank, null, 2) + '\n')
console.log(`Synced ${batches.length} reference batches, ${[...sampleCounts.values()].reduce((sum, count) => sum + count, 0)} samples and their derived bank; fitted usage for ${usageFit.models.length} models.`)
