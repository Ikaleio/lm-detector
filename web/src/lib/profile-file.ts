import { isServiceTier } from '@fingerpoint/shared/completion-request'
import { readConcurrency, type ApiProfile, type WebApiConfig } from '@/lib/config'

const fileKind = 'fingerpoint-api-profile'
const fileVersion = 1

interface SavedProfile extends WebApiConfig {
  kind: typeof fileKind
  version: typeof fileVersion
  name: string
}

type SaveFilePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<{ createWritable: () => Promise<{ write: (content: string) => Promise<void>; close: () => Promise<void> }> }>

function fileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '-').replace(/[.\s]+$/g, '').slice(0, 80) || 'profile'
  return `fingerpoint-${safe}.json`
}

export async function readProfileFile(file: File): Promise<{ name: string; config: WebApiConfig }> {
  if (file.size > 64 * 1024) throw new Error('Profile file is too large')
  const raw: unknown = JSON.parse(await file.text())
  if (!raw || typeof raw !== 'object') throw new Error('Invalid profile file')
  const value = raw as Record<string, unknown>
  if (value.kind !== fileKind || value.version !== fileVersion || typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Invalid profile file')
  }
  for (const field of ['baseUrl', 'apiKey', 'model', 'effort']) {
    if (typeof value[field] !== 'string') throw new Error('Invalid profile file')
  }
  if (value.format !== 'openai' && value.format !== 'responses' && value.format !== 'anthropic') {
    throw new Error('Invalid profile file')
  }
  if (value.serviceTier !== undefined && !isServiceTier(value.serviceTier)) throw new Error('Invalid profile file')
  for (const field of ['stream', 'autoVerify']) {
    if (typeof value[field] !== 'boolean') throw new Error('Invalid profile file')
  }
  for (const field of ['relaxed', 'tokenizerProbe']) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') throw new Error('Invalid profile file')
  }
  const concurrency = readConcurrency(value)
  if (concurrency === undefined) throw new Error('Invalid profile file')
  return {
    name: value.name.trim(),
    config: {
      baseUrl: value.baseUrl as string,
      apiKey: value.apiKey as string,
      model: value.model as string,
      effort: value.effort as string,
      format: value.format,
      serviceTier: value.serviceTier ?? 'default',
      stream: value.stream as boolean,
      concurrency,
      relaxed: value.relaxed === undefined ? true : value.relaxed as boolean,
      autoVerify: value.autoVerify as boolean,
      tokenizerProbe: value.tokenizerProbe === undefined ? false : value.tokenizerProbe as boolean,
    },
  }
}

export async function saveProfileFile(profile: ApiProfile, name: string): Promise<'saved' | 'downloaded'> {
  const contents: SavedProfile = {
    kind: fileKind,
    version: fileVersion,
    name,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    effort: profile.effort,
    format: profile.format,
    serviceTier: profile.serviceTier,
    stream: profile.stream,
    concurrency: profile.concurrency,
    relaxed: profile.relaxed,
    autoVerify: profile.autoVerify,
    tokenizerProbe: profile.tokenizerProbe,
  }
  const json = JSON.stringify(contents, null, 2) + '\n'
  const suggestedName = fileName(name)
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (picker) {
    const handle = await picker.call(window, {
      suggestedName,
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    })
    const writable = await handle.createWritable()
    await writable.write(json)
    await writable.close()
    return 'saved'
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = suggestedName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return 'downloaded'
}
