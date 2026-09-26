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

function restore(): StoredApiProfiles {
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
  const warned = useRef(false)
  const onError = useRef(onPersistError)
  onError.current = onPersistError

  useEffect(() => {
    try {
      persist(state)
    } catch {
      if (!warned.current) onError.current?.()
      warned.current = true
    }
  }, [state])

  const activeProfile = state.profiles.find(p => p.id === state.activeId) ?? state.profiles[0]

  const update = useCallback((patch: Partial<WebApiConfig>) => {
    setState(prev => ({
      ...prev,
      profiles: prev.profiles.map(p => (p.id === prev.activeId ? { ...p, ...patch } : p)),
    }))
  }, [])

  const select = useCallback((id: string) => {
    setState(prev => {
      if (prev.activeId === id) return prev
      if (!prev.profiles.some(p => p.id === id)) return prev
      return { ...prev, activeId: id }
    })
  }, [])

  const create = useCallback((name?: string, template?: Partial<WebApiConfig>) => {
    const id = generateId()
    const newProfile: ApiProfile = {
      ...defaultConfig,
      ...template,
      id,
      name: name ?? '',
    }
    setState(prev => ({
      activeId: id,
      profiles: [...prev.profiles, newProfile],
    }))
    return id
  }, [])

  const duplicate = useCallback((id: string, suffix = ' (copy)') => {
    const newId = generateId()
    setState(prev => {
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
  }, [])

  const remove = useCallback((id: string) => {
    setState(prev => {
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
  }, [])

  const rename = useCallback((id: string, name: string) => {
    setState(prev => ({
      ...prev,
      profiles: prev.profiles.map(p => (p.id === id ? { ...p, name } : p)),
    }))
  }, [])

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
