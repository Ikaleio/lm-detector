import { readFile } from 'node:fs/promises'
import { atomicWrite, sha256 } from '../cli/storage'

export function serialize(value: unknown): string {
  return JSON.stringify(value, (_, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Training produced nonfinite data.')
    return item
  }, 2) + '\n'
}

export const save = (path: string, value: unknown) => atomicWrite(path, serialize(value))
export const fileHash = async (path: string) => sha256(await readFile(path))
