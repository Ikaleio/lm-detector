import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { buildBank } from '@fingerpoint/shared/builder'
import { parseReference } from '@fingerpoint/shared/reference'
import { atomicWrite, sha256 } from './storage'

const { reference, output } = workerData as { reference: string; output: string }
const content = await readFile(reference, 'utf8')
const batches = parseReference(content)
const bank = buildBank(batches, message => parentPort?.postMessage(message))
bank.reference_sha256 = sha256(content)
const contentBank = JSON.stringify(bank, (_key, value) => {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('建库产生无效数值')
  return value
}, 2) + '\n'
await atomicWrite(output, contentBank)
