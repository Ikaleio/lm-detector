import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { en, zh, type Messages } from './messages'
import { zhHant } from './zh-hant'
import { ja } from './ja'
import { fr } from './fr'

/** `tag` is the BCP 47 tag for `<html lang>` and `Intl`; `name` is the language's own name in the picker. */
export const LOCALES = [
  { id: 'zh', tag: 'zh-CN', name: '简体中文', catalog: zh },
  { id: 'zh-Hant', tag: 'zh-TW', name: '繁體中文', catalog: zhHant },
  { id: 'en', tag: 'en-US', name: 'English', catalog: en },
  { id: 'ja', tag: 'ja-JP', name: '日本語', catalog: ja },
  { id: 'fr', tag: 'fr-FR', name: 'Français', catalog: fr },
] as const satisfies readonly { id: string; tag: string; name: string; catalog: Messages }[]

export type Locale = (typeof LOCALES)[number]['id']
const STORAGE_KEY = 'fp-locale'

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
  /** Calendar days between the value and today in the reader's time zone, e.g. "yesterday" or "4 days ago". */
  daysAgo: (value: string | number | Date) => string
}

const I18nContext = createContext<I18n | null>(null)

/** Traditional Chinese for zh-Hant scripts and the TW/HK/MO regions; otherwise match the primary language. */
function browserLocale(language: string): Locale {
  const lower = language.toLowerCase()
  if (lower.startsWith('zh')) return /hant|-(tw|hk|mo)\b/.test(lower) ? 'zh-Hant' : 'zh'
  const primary = lower.split('-')[0]
  return LOCALES.find(l => l.id === primary)?.id ?? 'en'
}

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const known = LOCALES.find(l => l.id === saved)
    if (known) return known.id
  } catch { /* storage unavailable */ }
  return browserLocale(navigator.language)
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
  const { tag, catalog } = LOCALES.find(l => l.id === locale)!
  useEffect(() => {
    document.documentElement.lang = tag
    try { localStorage.setItem(STORAGE_KEY, locale) } catch { /* storage unavailable */ }
  }, [locale, tag])
  const setLocale = useCallback((next: Locale) => setLocaleState(next), [])
  const value = useMemo<I18n>(() => {
    const numberFormat = new Intl.NumberFormat(tag)
    const percentFormat = new Intl.NumberFormat(tag, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
    const dateFormat = new Intl.DateTimeFormat(tag, { year: 'numeric', month: '2-digit', day: '2-digit' })
    const relativeFormat = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' })
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
      percent: (v) => percentFormat.format(v),
      date: (v) => {
        const d = new Date(v)
        return Number.isNaN(d.getTime()) ? String(v) : dateFormat.format(d)
      },
      daysAgo: (v) => {
        // Rounding absorbs the hour that a daylight saving change adds or removes.
        const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(v).setHours(0, 0, 0, 0)) / 86_400_000)
        return relativeFormat.format(-days, 'day')
      },
    }
  }, [locale, tag, catalog, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
