import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { redactPrivateMetadata } from '@fingerpoint/shared/privacy'

try {
  await stat('data/.pending-enrollment')
  throw new Error('入库事务尚未完成，请重跑 enroll 恢复后再构建。')
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
const referenceBytes = await readFile('data/unified_reference.jsonl', 'utf8')
const bank = JSON.parse(await readFile('data/unified_bank.json', 'utf8'))
if (bank.reference_sha256 !== createHash('sha256').update(referenceBytes).digest('hex')) {
  throw new Error('参考数据与派生库不匹配，不能发布。请先完成入库或重建。')
}
const references = referenceBytes.split('\n').filter(Boolean)
  .map(line => JSON.stringify(redactPrivateMetadata(JSON.parse(line)))).join('\n') + '\n'
const publicBank = redactPrivateMetadata(bank)
publicBank.reference_sha256 = createHash('sha256').update(references).digest('hex')
await mkdir('web/public/data', { recursive: true })
await writeFile('web/public/data/unified_reference.jsonl', references)
await writeFile('web/public/data/unified_bank.json', JSON.stringify(publicBank, null, 2) + '\n')
const manifest = redactPrivateMetadata(JSON.parse(await readFile('data/import_manifest.json', 'utf8')))
await writeFile('web/public/data/import_manifest.json', JSON.stringify(manifest, null, 2) + '\n')
await copyFile('data/shared_detector.json', 'web/public/data/shared_detector.json')
console.log('Synced the unified dataset and its derived bank.')
