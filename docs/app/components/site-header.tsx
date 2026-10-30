import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation } from 'react-router'
import { Menu } from '@base-ui/react/menu'
import { Check, GitBranch, Languages, Monitor, Moon, Star, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { markStarVisited } from '../../../web/src/lib/star'
import brandLogo from '../../../web/src/assets/branding/logo.webp'
import type { Locale } from '@/lib/i18n'
import { siteText } from '@/lib/layout.shared'
import { appUrl, docsBase, repositoryUrl } from '@/lib/shared'
import { localizedUrl, switchLocale } from '@/lib/urls'

const homeUrl = localizedUrl(docsBase)
const noop = () => () => {}

/** The detector's ghost icon button (`Button variant="ghost" size="icon-lg"`) in Fumadocs' colour names. */
export const iconButton =
  'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-transparent outline-none transition-[color,background-color,border-color,box-shadow] hover:bg-fd-muted dark:hover:bg-fd-muted/50 aria-expanded:bg-fd-muted focus-visible:border-fd-ring focus-visible:ring-3 focus-visible:ring-fd-ring/50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'

function ThemeMenu({ locale }: { locale: Locale }) {
  const text = siteText[locale]
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const options = [
    { value: 'light', label: text.themeLight, icon: Sun },
    { value: 'dark', label: text.themeDark, icon: Moon },
    { value: 'system', label: text.themeSystem, icon: Monitor },
  ] as const
  const selected = options.find(option => mounted && option.value === theme) ?? options[2]
  const label = text.toggleTheme.replace('{theme}', selected.label)
  return (
    <Menu.Root>
      <Menu.Trigger className={iconButton} aria-label={label} title={label}>
        <selected.icon />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="isolate z-50 outline-none" align="end" sideOffset={4}>
          <Menu.Popup className="min-w-40 origin-(--transform-origin) rounded-lg bg-fd-popover p-1 text-fd-popover-foreground shadow-md ring-1 ring-fd-foreground/10 outline-none data-open:animate-fd-popover-in data-closed:animate-fd-popover-out">
            <Menu.RadioGroup value={selected.value} onValueChange={setTheme} aria-label={text.theme}>
              {options.map(option => (
                <Menu.RadioItem
                  key={option.value}
                  value={option.value}
                  className="relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-fd-accent data-highlighted:text-fd-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0"
                >
                  <option.icon aria-hidden="true" />
                  {option.label}
                  <span className="pointer-events-none absolute right-2 flex items-center">
                    <Menu.RadioItemIndicator>
                      <Check aria-hidden="true" />
                    </Menu.RadioItemIndicator>
                  </span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/**
 * The detector's top bar (design.md 3「应用外壳」) with the docs as the current section: "Detect" and "Library" lead
 * back into the detector, which is another app, so they are plain links.
 */
export function SiteHeader({ locale }: { locale: Locale }) {
  const text = siteText[locale]
  const { pathname } = useLocation()
  const navRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState<{ x: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('a[aria-current="page"]')
      setIndicator(active ? { x: active.offsetLeft, width: active.offsetWidth } : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [locale])
  const home = homeUrl([], locale)
  const otherLocale: Locale = locale === 'zh' ? 'en' : 'zh'
  return (
    <header className="fp-topbar">
      <div className="fp-topbar-inner">
        <Link to={home} className="fp-brand">
          <img src={brandLogo} alt="" width={32} height={32} className="fp-brand-mark" />
          <span className="fp-brand-text">
            <span className="fp-brand-title">Fingerpoint Detector</span>
            <span className="fp-brand-byline">{text.brandLine}</span>
          </span>
        </Link>
        <nav ref={navRef} className="fp-nav" aria-label={text.navigation}>
          <a href={`${appUrl}#/`}>{text.detect}</a>
          <a href={`${appUrl}#/library`}>{text.library}</a>
          <Link to={home} aria-current="page">{text.docs}</Link>
          {indicator && <span aria-hidden="true" className="fp-nav-indicator" style={{ width: indicator.width, transform: `translateX(${indicator.x}px)` }} />}
        </nav>
        <div className="fp-topbar-actions flex items-center gap-1 justify-self-end">
          <a className="fp-repository-link" href={repositoryUrl} target="_blank" rel="noopener noreferrer" aria-label={text.repository} title={text.repository}>
            <GitBranch className="size-4" aria-hidden="true" />
            <span>Ikaleio/lm-detector</span>
          </a>
          <a className="fp-repository-star" href={repositoryUrl} target="_blank" rel="noopener noreferrer" aria-label={text.star} title={text.star} onClick={markStarVisited}>
            <Star aria-hidden="true" />
            <span>Star</span>
          </a>
          <Link
            to={switchLocale(pathname, docsBase, otherLocale)}
            hrefLang={otherLocale === 'zh' ? 'zh-CN' : 'en'}
            className={iconButton}
            aria-label={text.toggleLanguage}
            title={text.toggleLanguage}
          >
            <Languages aria-hidden="true" />
          </Link>
          <ThemeMenu locale={locale} />
        </div>
      </div>
    </header>
  )
}
