import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiConfig } from '@fingerpoint/shared/types'

export interface WebApiConfig extends ApiConfig {
  autoVerify: boolean
}

export interface ApiProfile extends WebApiConfig {
  id: string
  name: string
}

export interface StoredApiProfiles {
  activeId: string
  profiles: ApiProfile[]
}

export interface ApiProfileManager {
  profiles: ApiProfile[]
  activeId: string
  select: (id: string) => void
  create: (name?: string, template?: Partial<WebApiConfig>) => string
  duplicate: (id: string, suffix?: string) => string
  remove: (id: string) => void
  rename: (id: string, name: string) => void
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
  stream: true,
  parallel: false,
  autoVerify: false,
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
    for (const field of ['stream', 'parallel', 'autoVerify'] as const) {
      if (typeof obj[field] === 'boolean') profile[field] = obj[field] as boolean
    }
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
        return { activeId, profiles: sanitizedList }
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
        return { activeId: id, profiles: [migrated] }
      }
    }
  } catch {
    /* storage unavailable or parse error */
  }

  const initialId = generateId()
  return {
    activeId: initialId,
    profiles: [{ ...defaultConfig, id: initialId, name: 'OpenRouter' }],
  }
}

function persist(state: StoredApiProfiles) {
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(state))
  const active = state.profiles.find(p => p.id === state.activeId) ?? state.profiles[0]
  if (active) {
    const { baseUrl, apiKey, model, effort, format, stream, parallel, autoVerify } = active
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl, apiKey, model, effort, format, stream, parallel, autoVerify }))
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
      return {
        activeId: nextActiveId,
        profiles: nextProfiles,
      }
    })
  }, [commit])

  const rename = useCallback((id: string, name: string) => {
    commit(prev => ({
      ...prev,
      profiles: prev.profiles.map(p => (p.id === id ? { ...p, name } : p)),
    }))
  }, [commit])

  const manager: ApiProfileManager = {
    profiles: state.profiles,
    activeId: state.activeId,
    select,
    create,
    duplicate,
    remove,
    rename,
  }

  return [activeProfile, update, manager] as const
}

export const configComplete = (c: WebApiConfig) => Boolean(c.baseUrl.trim() && c.apiKey.trim() && c.model.trim())
