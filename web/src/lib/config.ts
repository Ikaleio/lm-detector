import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiConfig } from '@fingerpoint/shared/types'

export interface WebApiConfig extends ApiConfig {
  autoVerify: boolean
}

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

function restore(): WebApiConfig {
  const config = { ...defaultConfig }
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY)
    const saved = raw ? JSON.parse(raw) : null
    if (saved && typeof saved === 'object') {
      for (const field of ['baseUrl', 'apiKey', 'model', 'effort'] as const) {
        if (typeof saved[field] === 'string') config[field] = saved[field]
      }
      if (['openai', 'responses', 'anthropic'].includes(saved.format)) config.format = saved.format
      for (const field of ['stream', 'parallel', 'autoVerify'] as const) {
        if (typeof saved[field] === 'boolean') config[field] = saved[field]
      }
    }
    // Migrate old tab-scoped keys without overwriting an explicitly cleared key.
    if (typeof saved?.apiKey !== 'string') {
      const sessionKey = sessionStorage.getItem(SESSION_KEY)
      if (sessionKey) config.apiKey = sessionKey
    }
  } catch { /* storage unavailable */ }
  return config
}

function persist(config: WebApiConfig) {
  const { baseUrl, apiKey, model, effort, format, stream, parallel, autoVerify } = config
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl, apiKey, model, effort, format, stream, parallel, autoVerify }))
  localStorage.removeItem(LEGACY_KEY)
  sessionStorage.removeItem(SESSION_KEY)
}

export function useApiConfig(onPersistError?: () => void) {
  const [config, setConfig] = useState<WebApiConfig>(restore)
  const warned = useRef(false)
  const onError = useRef(onPersistError)
  onError.current = onPersistError
  useEffect(() => {
    try { persist(config) } catch {
      if (!warned.current) onError.current?.()
      warned.current = true
    }
  }, [config])
  const update = useCallback((patch: Partial<WebApiConfig>) => setConfig(c => ({ ...c, ...patch })), [])
  return [config, update, setConfig] as const
}

export const configComplete = (c: WebApiConfig) => Boolean(c.baseUrl.trim() && c.apiKey.trim() && c.model.trim())
