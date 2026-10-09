import { useCallback, useEffect, useRef, useState } from 'react'
import { isServiceTier, type ServiceTier } from '@fingerpoint/shared/completion-request'
import type { ApiConfig } from '@fingerpoint/shared/types'

export interface WebApiConfig extends ApiConfig {
  serviceTier: ServiceTier
  /** Requests that the samples and the tokenizer probe each keep in flight; 1 sends them one at a time. */
  concurrency: number
  relaxed: boolean
  autoVerify: boolean
  /** Probe the tokenizer alongside sampling and show it as reference information beside the result. */
  tokenizerProbe: boolean
}

export interface ApiProfile extends WebApiConfig {
  id: string
  name: string
}

interface ProfileSnapshot extends WebApiConfig {
  name: string
}

export interface StoredApiProfiles {
  activeId: string
  profiles: ApiProfile[]
  savedProfiles: Record<string, ProfileSnapshot>
}

export interface ApiProfileManager {
  profiles: ApiProfile[]
  activeId: string
  isActiveDirty: boolean
  select: (id: string) => void
  create: (name?: string, template?: Partial<WebApiConfig>) => string
  duplicate: (id: string, suffix?: string) => string
  remove: (id: string) => void
  rename: (id: string, name: string) => void
  markSaved: (profile: ApiProfile) => void
}

const PROFILES_STORAGE_KEY = 'fingerpoint-detect-profiles-v1'
const STORAGE_KEY = 'fingerpoint-detect-api-v2'
const LEGACY_KEY = 'fingerpoint-detect-api-v1'
const SESSION_KEY = 'fingerpoint-detect-api-key'

export const defaultConfig: WebApiConfig = {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: '',
  model: '',
  effort: '',
  format: 'openai',
  serviceTier: 'default',
  stream: true,
  concurrency: 3,
  relaxed: true,
  autoVerify: true,
  tokenizerProbe: false,
}

export const CONCURRENCY_RANGE = { min: 1, max: 8 } as const

/** The stored concurrency; an older `parallel` switch reads as the default when on and as 1 when off. */
export function readConcurrency(value: Record<string, unknown>): number | undefined {
  const { concurrency, parallel } = value
  if (typeof concurrency === 'number' && Number.isInteger(concurrency) && concurrency >= CONCURRENCY_RANGE.min && concurrency <= CONCURRENCY_RANGE.max) return concurrency
  if (typeof parallel === 'boolean') return parallel ? defaultConfig.concurrency : 1
  return undefined
}

const configFields = ['baseUrl', 'apiKey', 'model', 'effort', 'format', 'serviceTier', 'stream', 'concurrency', 'relaxed', 'autoVerify', 'tokenizerProbe'] as const

function snapshot(profile: ApiProfile): ProfileSnapshot {
  const { name, baseUrl, apiKey, model, effort, format, serviceTier, stream, concurrency, relaxed, autoVerify, tokenizerProbe } = profile
  return { name, baseUrl, apiKey, model, effort, format, serviceTier, stream, concurrency, relaxed, autoVerify, tokenizerProbe }
}

function readSnapshot(raw: unknown): ProfileSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (typeof value.name !== 'string') return null
  for (const field of ['baseUrl', 'apiKey', 'model', 'effort']) {
    if (typeof value[field] !== 'string') return null
  }
  if (value.format !== 'openai' && value.format !== 'responses' && value.format !== 'anthropic') return null
  if (value.serviceTier !== undefined && !isServiceTier(value.serviceTier)) return null
  for (const field of ['stream', 'autoVerify']) {
    if (typeof value[field] !== 'boolean') return null
  }
  for (const field of ['relaxed', 'tokenizerProbe']) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') return null
  }
  const concurrency = readConcurrency(value)
  if (concurrency === undefined) return null
  return {
    name: value.name,
    baseUrl: value.baseUrl as string,
    apiKey: value.apiKey as string,
    model: value.model as string,
    effort: value.effort as string,
    format: value.format,
    serviceTier: value.serviceTier ?? 'default',
    stream: value.stream as boolean,
    concurrency,
    relaxed: typeof value.relaxed === 'boolean' ? value.relaxed : true,
    autoVerify: value.autoVerify as boolean,
    tokenizerProbe: typeof value.tokenizerProbe === 'boolean' ? value.tokenizerProbe : false,
  }
}

function isDirty(profile: ApiProfile, saved: ProfileSnapshot): boolean {
  return profile.name.trim() !== saved.name.trim() || configFields.some(field => profile[field] !== saved[field])
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

function sanitizeProfile(raw: unknown, fallbackId: string, fallbackName = ''): ApiProfile {
  const profile: ApiProfile = {
    ...defaultConfig,
    id: fallbackId,
    name: fallbackName,
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (typeof obj.id === 'string' && obj.id.trim()) profile.id = obj.id.trim()
    if (typeof obj.name === 'string') profile.name = obj.name
    for (const field of ['baseUrl', 'apiKey', 'model', 'effort'] as const) {
      if (typeof obj[field] === 'string') profile[field] = obj[field] as string
    }
    if (obj.format === 'openai' || obj.format === 'responses' || obj.format === 'anthropic') {
      profile.format = obj.format
    }
    if (isServiceTier(obj.serviceTier)) profile.serviceTier = obj.serviceTier
    for (const field of ['stream', 'relaxed', 'autoVerify', 'tokenizerProbe'] as const) {
      if (typeof obj[field] === 'boolean') profile[field] = obj[field] as boolean
    }
    profile.concurrency = readConcurrency(obj) ?? profile.concurrency
  }
  return profile
}

function readProfiles(): StoredApiProfiles | null {
  try {
    const rawProfiles = localStorage.getItem(PROFILES_STORAGE_KEY)
    if (rawProfiles) {
      const parsed = JSON.parse(rawProfiles)
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
        const sanitizedList = parsed.profiles.map((p: unknown, i: number) =>
          sanitizeProfile(p, `p_${i}_${Date.now()}`)
        )
        const activeId = typeof parsed.activeId === 'string' && sanitizedList.some((p: ApiProfile) => p.id === parsed.activeId)
          ? parsed.activeId
          : sanitizedList[0].id
        const rawSnapshots = parsed.savedProfiles && typeof parsed.savedProfiles === 'object'
          ? parsed.savedProfiles as Record<string, unknown>
          : {}
        const savedProfiles = Object.fromEntries(sanitizedList.map((profile: ApiProfile) => [
          profile.id,
          readSnapshot(rawSnapshots[profile.id]) ?? snapshot(profile),
        ]))
        return { activeId, profiles: sanitizedList, savedProfiles }
      }
    }
  } catch { /* No usable profiles in storage */ }
  return null
}

function restore(): StoredApiProfiles {
  const stored = readProfiles()
  if (stored) return stored
  try {
    const rawLegacy = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (rawLegacy) {
      const saved = JSON.parse(rawLegacy)
      if (saved && typeof saved === 'object') {
        const id = generateId()
        const initialName = typeof saved.model === 'string' && saved.model.trim() ? saved.model.trim() : 'OpenRouter'
        const migrated = sanitizeProfile(saved, id, initialName)
        if (typeof saved.apiKey !== 'string') {
          const sessionKey = sessionStorage.getItem(SESSION_KEY)
          if (sessionKey) migrated.apiKey = sessionKey
        }
        return { activeId: id, profiles: [migrated], savedProfiles: { [id]: snapshot(migrated) } }
      }
    }
  } catch {
    /* storage unavailable or parse error */
  }

  const initialId = generateId()
  const initialProfile = { ...defaultConfig, id: initialId, name: 'OpenRouter' }
  return {
    activeId: initialId,
    profiles: [initialProfile],
    savedProfiles: { [initialId]: snapshot(initialProfile) },
  }
}

function persist(state: StoredApiProfiles) {
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(state))
  const active = state.profiles.find(p => p.id === state.activeId) ?? state.profiles[0]
  if (active) {
    const { baseUrl, apiKey, model, effort, format, serviceTier, stream, concurrency, relaxed, autoVerify, tokenizerProbe } = active
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl, apiKey, model, effort, format, serviceTier, stream, concurrency, relaxed, autoVerify, tokenizerProbe }))
  }
  localStorage.removeItem(LEGACY_KEY)
  sessionStorage.removeItem(SESSION_KEY)
}

export function useApiConfig(onPersistError?: () => void) {
  const [state, setState] = useState<StoredApiProfiles>(restore)
  const current = useRef(state)
  const warned = useRef(false)
  const persistenceFailed = useRef(false)
  const onError = useRef(onPersistError)
  onError.current = onPersistError

  useEffect(() => {
    try {
      const stored = readProfiles()
      if (stored) {
        current.current = stored
        setState(stored)
      } else {
        persist(current.current)
      }
    } catch {
      if (!warned.current) onError.current?.()
      warned.current = true
      persistenceFailed.current = true
    }

    const syncProfiles = (event: StorageEvent) => {
      if (event.key !== PROFILES_STORAGE_KEY) return
      const stored = readProfiles()
      if (!stored) return
      current.current = stored
      persistenceFailed.current = false
      setState(stored)
    }
    window.addEventListener('storage', syncProfiles)
    return () => window.removeEventListener('storage', syncProfiles)
  }, [])

  const commit = useCallback((change: (previous: StoredApiProfiles) => StoredApiProfiles) => {
    const previous = (persistenceFailed.current ? null : readProfiles()) ?? current.current
    const next = change(previous)
    current.current = next
    setState(next)
    if (next === previous) return
    try {
      persist(next)
      persistenceFailed.current = false
    } catch {
      if (!warned.current) onError.current?.()
      warned.current = true
      persistenceFailed.current = true
    }
  }, [])

  const activeProfile = state.profiles.find(p => p.id === state.activeId) ?? state.profiles[0]

  const update = useCallback((patch: Partial<WebApiConfig>) => {
    const activeId = state.activeId
    commit(prev => ({
      ...prev,
      profiles: prev.profiles.map(p => (p.id === activeId ? { ...p, ...patch } : p)),
    }))
  }, [commit, state.activeId])

  const select = useCallback((id: string) => {
    commit(prev => {
      if (prev.activeId === id) return prev
      if (!prev.profiles.some(p => p.id === id)) return prev
      return { ...prev, activeId: id }
    })
  }, [commit])

  const create = useCallback((name?: string, template?: Partial<WebApiConfig>) => {
    const id = generateId()
    const newProfile: ApiProfile = {
      ...defaultConfig,
      ...template,
      id,
      name: name ?? '',
    }
    commit(prev => ({
      activeId: id,
      profiles: [...prev.profiles, newProfile],
      savedProfiles: { ...prev.savedProfiles, [id]: snapshot(newProfile) },
    }))
    return id
  }, [commit])

  const duplicate = useCallback((id: string, suffix = ' (copy)') => {
    const newId = generateId()
    commit(prev => {
      const source = prev.profiles.find(p => p.id === id) ?? prev.profiles[0]
      if (!source) return prev
      const newProfile: ApiProfile = {
        ...source,
        id: newId,
        name: source.name ? `${source.name}${suffix}` : (source.model ? `${source.model}${suffix}` : ''),
      }
      const idx = prev.profiles.findIndex(p => p.id === id)
      const nextProfiles = [...prev.profiles]
      if (idx >= 0) {
        nextProfiles.splice(idx + 1, 0, newProfile)
      } else {
        nextProfiles.push(newProfile)
      }
      return {
        activeId: newId,
        profiles: nextProfiles,
        savedProfiles: { ...prev.savedProfiles, [newId]: snapshot(newProfile) },
      }
    })
    return newId
  }, [commit])

  const remove = useCallback((id: string) => {
    commit(prev => {
      if (prev.profiles.length <= 1) return prev
      const nextProfiles = prev.profiles.filter(p => p.id !== id)
      let nextActiveId = prev.activeId
      if (prev.activeId === id) {
        nextActiveId = nextProfiles[0].id
      }
      const savedProfiles = { ...prev.savedProfiles }
      delete savedProfiles[id]
      return {
        activeId: nextActiveId,
        profiles: nextProfiles,
        savedProfiles,
      }
    })
  }, [commit])

  const rename = useCallback((id: string, name: string) => {
    commit(prev => ({
      ...prev,
      profiles: prev.profiles.map(p => (p.id === id ? { ...p, name } : p)),
    }))
  }, [commit])

  const markSaved = useCallback((profile: ApiProfile) => {
    commit(prev => {
      if (!prev.profiles.some(p => p.id === profile.id)) return prev
      return {
        ...prev,
        savedProfiles: { ...prev.savedProfiles, [profile.id]: snapshot(profile) },
      }
    })
  }, [commit])

  const manager: ApiProfileManager = {
    profiles: state.profiles,
    activeId: state.activeId,
    isActiveDirty: isDirty(activeProfile, state.savedProfiles[activeProfile.id]),
    select,
    create,
    duplicate,
    remove,
    rename,
    markSaved,
  }

  return [activeProfile, update, manager] as const
}

export const configComplete = (c: WebApiConfig) => Boolean(c.baseUrl.trim() && c.apiKey.trim() && c.model.trim())
