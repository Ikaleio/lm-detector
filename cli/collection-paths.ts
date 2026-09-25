import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { missing } from './storage'

async function isRepository(directory: string): Promise<boolean> {
  let manifest: { name?: string; private?: boolean; workspaces?: string[] }
  try { manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) }
  catch (error) { if (missing(error) || error instanceof SyntaxError) return false; throw error }
  if (manifest.name !== 'lm-fingerpoint-detector' || !manifest.private || !Array.isArray(manifest.workspaces) || !manifest.workspaces.includes('cli') || !manifest.workspaces.includes('shared')) return false
  try {
    const [reference, bank] = await Promise.all(['unified_reference.jsonl', 'unified_bank.json'].map(name => stat(join(directory, 'data', name))))
    return reference.isFile() && bank.isFile()
  } catch (error) { if (missing(error)) return false; throw error }
}

export async function discoverRepository(cwd = process.cwd()): Promise<string | null> {
  let directory = resolve(cwd)
  while (true) {
    if (await isRepository(directory)) return directory
    const nested = join(directory, 'projects')
    if (await isRepository(nested)) return nested
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

export function collectionDirectory(explicit: string | undefined, repository: string | null): string {
  if (explicit !== undefined) {
    if (!explicit.trim()) throw new Error('--output-dir cannot be empty.')
    return resolve(explicit)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(repository ? join(repository, 'runs') : resolve('fpd-runs'), `${stamp}-${randomUUID().slice(0, 8)}`)
}

export async function enrollmentDirectory(explicit: string | undefined, repository: string | null, interactive: boolean): Promise<{ path: string; automatic: boolean }> {
  if (explicit !== undefined && !explicit.trim()) throw new Error('--data-dir cannot be empty.')
  if (!explicit && !interactive) throw new Error('Non-interactive enrollment requires an explicit --data-dir.')
  if (!explicit && !repository) throw new Error('No FPD repository found. Specify --data-dir to choose the destination.')
  const path = explicit ? resolve(explicit) : join(repository!, 'data')
  let info
  try { info = await stat(path) } catch (error) {
    if (missing(error)) throw new Error(`Data directory does not exist: ${path}. Create it explicitly before enrolling.`)
    throw error
  }
  if (!info.isDirectory()) throw new Error(`Data destination is not a directory: ${path}`)
  return { path, automatic: !explicit }
}
