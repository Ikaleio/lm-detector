import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, zh, type Messages } from './messages'

export type Locale = 'zh' | 'en'
const STORAGE_KEY = 'fp-locale'
const catalogs: Record<Locale, Messages> = { zh, en }

type Leaves<T, P extends string = ''> = T extends string
  ? P
  : { [K in keyof T & string]: Leaves<T[K], P extends '' ? K : `${P}.${K}`> }[keyof T & string]
export type MessageKey = Leaves<Messages>

export interface I18n {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: MessageKey, params?: Record<string, string | number>) => string
  number: (value: number) => string
  percent: (value: number) => string
  date: (value: string | number | Date) => string
}

const I18nContext = createContext<I18n | null>(null)

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch { /* storage unavailable */ }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function lookup(catalog: Messages, key: string): string {
  let node: unknown = catalog
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return key
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : key
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    try { localStorage.setItem(STORAGE_KEY, locale) } catch { /* storage unavailable */ }
  }, [locale])
  const setLocale = useCallback((next: Locale) => setLocaleState(next), [])
  const value = useMemo<I18n>(() => {
    const tag = locale === 'zh' ? 'zh-CN' : 'en-US'
    const numberFormat = new Intl.NumberFormat(tag)
    const percentFormat = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    const dateFormat = new Intl.DateTimeFormat(tag, { year: 'numeric', month: '2-digit', day: '2-digit' })
    const catalog = catalogs[locale]
    return {
      locale,
      setLocale,
      t: (key, params) => {
        const template = lookup(catalog, key)
        if (!params) return template
        return template.replace(/\{(\w+)\}/g, (_, name: string) => {
          const v = params[name]
          return typeof v === 'number' ? numberFormat.format(v) : String(v ?? '')
        })
      },
      number: (v) => numberFormat.format(v),
      percent: (v) => `${percentFormat.format(v * 100)}%`,
      date: (v) => {
        const d = new Date(v)
        return Number.isNaN(d.getTime()) ? String(v) : dateFormat.format(d)
      },
    }
  }, [locale, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
