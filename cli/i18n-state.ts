export type Locale = 'en' | 'zh' | 'ja' | 'ko' | 'fr'

// A shared object keeps language selection consistent across the bundled CLI modules.
export default { locale: 'en' as Locale }
