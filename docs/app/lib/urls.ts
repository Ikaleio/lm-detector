import { i18n, type Locale } from './i18n'

/**
 * Builds URLs under the docs `base` with the locale right after it and an optional `section` next
 * (`/docs/en/llms.mdx/cli`), so every language stays inside the prefix the site is deployed under. Fumadocs' default
 * puts the locale first (`/en/docs/cli`).
 */
export function localizedUrl(base: string, section = '') {
  return (slugs: string[], locale?: string) => {
    const rest = [locale && locale !== i18n.defaultLanguage ? locale : '', ...section.split('/'), ...slugs].filter(segment => segment.length > 0)
    return rest.length ? `${base}/${rest.join('/')}` : base
  }
}

/**
 * Reads the locale from a pathname under `base`: the default language unless the path continues with `/en`.
 * React Router's single-fetch requests end in `.data` (`/docs/en.data`), which is not part of the page path.
 */
export function localeOf(pathname: string, base: string): Locale {
  const rest = pathname.replace(/\.data$/, '').slice(base.length).split('/').filter(Boolean)
  const first = rest[0]
  return i18n.languages.find(language => language === first && language !== i18n.defaultLanguage) ?? i18n.defaultLanguage
}

/** The same page in another language: the locale segment after `base` is replaced, the rest of the path kept. */
export function switchLocale(pathname: string, base: string, target: string) {
  const rest = pathname.slice(base.length).split('/').filter(Boolean)
  if (rest[0] !== undefined && rest[0] === localeOf(pathname, base)) rest.shift()
  return localizedUrl(base)(rest, target)
}

/**
 * Splits a content file name such as `cli/index.en.mdx` into its slugs path and locale. `node:fs` globs hand back
 * platform separators, so Windows paths are normalized first and the slugs stay `/`-joined on every machine.
 */
export function parseContentFile(file: string): { path: string; locale: Locale } {
  const match = /^(.*?)(?:\.([a-z]{2}))?\.mdx$/.exec(file.replace(/\\/g, '/'))
  if (!match) throw new Error(`Not an MDX content file: ${file}`)
  const locale = i18n.languages.find(language => language === match[2]) ?? i18n.defaultLanguage
  if (match[2] && locale !== match[2]) throw new Error(`Unknown locale "${match[2]}" in ${file}`)
  return { path: `${match[1]}.mdx`, locale }
}
