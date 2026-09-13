import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { lock } from 'proper-lockfile'

export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export const serialize = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
export const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8'))
export const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

export async function atomicWrite(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(content); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}
export const saveJson = (path: string, value: unknown) => atomicWrite(path, serialize(value))

export async function withLock<T>(directory: string, work: () => Promise<T>): Promise<T> {
  const release = await lock(directory, { stale: 10000, update: 2000, retries: 0 })
  try { return await work() } finally { await release() }
}
