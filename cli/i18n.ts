import zh from './locales/zh'
import ja from './locales/ja'
import ko from './locales/ko'
import fr from './locales/fr'

import language, { type Locale } from './i18n-state'

export type { Locale } from './i18n-state'
export type Message = keyof typeof zh
const catalogs: Record<Exclude<Locale, 'en'>, Record<Message, string>> = { zh, ja, ko, fr }

/** One language per CLI invocation. Configure before dispatching a subcommand. */
export function configureLanguage(args: string[], env = process.env): string[] {
  language.locale = 'en'
  let selected = env.FPD_LANG ?? 'en'
  const remaining: string[] = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (argument === '--') {
      remaining.push(...args.slice(index))
      break
    }
    if (argument === '--lang') {
      selected = args[++index] ?? ''
    } else if (argument.startsWith('--lang=')) {
      selected = argument.slice('--lang='.length)
    } else remaining.push(argument)
  }
  if (!['en', 'zh', 'ja', 'ko', 'fr'].includes(selected)) {
    throw new Error('--lang must be one of en, zh, ja, ko, fr.')
  }
  language.locale = selected as Locale
  return remaining
}

export function t(source: Message, ...values: (string | number)[]): string {
  const message = language.locale === 'en' ? source : catalogs[language.locale][source]
  return message.replace(/\{(\d+)\}/g, (slot, index: string) => String(values[Number(index)] ?? slot))
}

/** Localize only known CLI labels; preserve unknown messages and external data. */
export function translateLabel(source: string): string {
  return Object.hasOwn(zh, source) ? t(source as Message) : source
}

/** Keep command syntax intact while translating the CLI-owned help prose. */
export function translateHelp(text: string): string {
  return text.split('\n').map(line => {
    if (line.startsWith('Usage:')) return t('Usage:') + line.slice('Usage:'.length)
    const option = /^(\s+--.*?\s{2,})(.*)$/.exec(line)
    if (option) return option[1] + translateLabel(option[2]!)
    const indentation = /^\s*/.exec(line)![0]
    return indentation + translateLabel(line.slice(indentation.length))
  }).join('\n')
}
