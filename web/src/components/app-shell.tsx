import { Suspense, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { useTheme } from 'next-themes'
import { GitBranch, Languages, Monitor, Moon, Star, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { PixelShader } from '@/components/pixel-shader'
import { DetectorProgress } from '@/components/detector-progress'
import { LOCALES, useI18n, type Locale } from '@/i18n'
import { useMotionPreset } from '@/lib/motion'
import { BankContext } from '@/lib/bank-context'
import { docsHref } from '@/lib/docs'
import { markStarVisited, REPOSITORY_URL } from '@/lib/star'
import * as client from '@/lib/client'
import { loadDetector } from '@/lib/detector'
import type { Bank } from '@fingerpoint/shared/types'

const { commit, time: buildTime } = __BUILD__

function ThemeToggle() {
  const { t } = useI18n()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const options = [
    { value: 'light', label: t('app.themeLight'), icon: Sun },
    { value: 'dark', label: t('app.themeDark'), icon: Moon },
    { value: 'system', label: t('app.themeSystem'), icon: Monitor },
  ] as const
  const selected = options.find(option => mounted && option.value === theme) ?? options[2]
  const Icon = selected.icon
  const label = t('app.toggleTheme', { theme: selected.label })
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label={label} />} />}>
          <Icon data-icon="inline-start" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={selected.value} onValueChange={setTheme} aria-label={t('app.theme')}>
            {options.map(option => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                <option.icon />
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LanguageMenu() {
  const { t, locale, setLocale } = useI18n()
  const label = t('app.language', { language: LOCALES.find(l => l.id === locale)!.name })
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label={label} />} />}>
          <Languages data-icon="inline-start" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={locale} onValueChange={value => setLocale(value as Locale)} aria-label={label}>
            {LOCALES.map(option => (
              <DropdownMenuRadioItem key={option.id} value={option.id} lang={option.tag}>{option.name}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Toasts line up with the right edge of the 1440px content column: `--fp-toast-gutter` is the page's side padding.
 * `--fp-toast-lift` raises them above the fixed action bar on narrow screens.
 */
const toastOffset = {
  right: 'max(var(--fp-toast-gutter), calc((100% - 1440px) / 2 + var(--fp-toast-gutter)))',
  bottom: 'calc(var(--fp-toast-lift) + 2rem)',
}
const toastMobileOffset = { bottom: 'calc(var(--fp-toast-lift) + 1rem + env(safe-area-inset-bottom))' }

export function AppShell({ detect }: { detect: ReactNode }) {
  const { t, locale } = useI18n()
  const { smooth, reduced } = useMotionPreset()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const pageTransition = useRef<ViewTransition | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const [indicator, setIndicator] = useState<{ x: number; width: number } | null>(null)
  useEffect(() => () => {
    pageTransition.current?.skipTransition()
    delete document.documentElement.dataset.pageDirection
  }, [])
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
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
  }, [pathname, t])
  useEffect(() => {
    document.title = `${t(pathname.startsWith('/library') ? 'library.title' : 'detect.title')} · ${t('app.name')}`
  }, [pathname, t])
  const links = [
    { to: '/', label: t('app.detect'), end: true },
    { to: '/library', label: t('app.library'), end: false },
  ]

  function navigatePage(event: MouseEvent<HTMLAnchorElement>, to: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const fromLibrary = pathname.startsWith('/library')
    const toLibrary = to === '/library'
    if (fromLibrary === toLibrary || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !document.startViewTransition) return

    event.preventDefault()
    pageTransition.current?.skipTransition()
    document.documentElement.dataset.pageDirection = toLibrary ? 'forward' : 'back'
    const transition = document.startViewTransition(() => {
      flushSync(() => navigate(to))
    })
    pageTransition.current = transition
    const clear = () => {
      if (pageTransition.current !== transition) return
      pageTransition.current = null
      delete document.documentElement.dataset.pageDirection
    }
    void transition.ready.catch(() => {})
    void transition.finished.then(clear, clear)
  }

  return (
    <div className="fp-shell" data-detect-active={pathname === '/'}>
      <header className="fp-topbar">
        <div className="fp-topbar-inner">
          <div className="fp-topbar-start">
            <NavLink to="/" onClick={event => navigatePage(event, '/')} className="fp-brand">
              <PixelShader effect="fingerprint" cell={2} className="fp-brand-mark" />
              <span className="fp-brand-text">
                <span className="fp-brand-title">{t('app.name')}</span>
                <span className="fp-brand-byline">by Ikaleio</span>
              </span>
            </NavLink>
            <DetectorProgress />
          </div>
          <nav ref={navRef} className="fp-nav" aria-label={t('app.navigation')}>
            {links.map(link => (
              <NavLink key={link.to} to={link.to} end={link.end} onClick={event => navigatePage(event, link.to)}>
                {link.label}
              </NavLink>
            ))}
            {/* The docs are a separate app served next to the detector, so this is a plain page link. */}
            <a href={docsHref(locale)}>{t('app.docs')}</a>
            {indicator && <motion.span aria-hidden="true" className="fp-nav-indicator" initial={false} animate={indicator} transition={reduced ? { duration: 0 } : smooth} />}
          </nav>
          <div className="fp-topbar-actions flex items-center gap-1 justify-self-end">
            <a className="fp-repository-link" href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" aria-label={t('app.repository')} title={t('app.repository')}>
              <GitBranch className="size-4" aria-hidden="true" />
              <span>Ikaleio/lm-detector</span>
            </a>
            <a className="fp-repository-star" href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" aria-label={t('app.star')} title={t('app.star')} onClick={markStarVisited}>
              <Star aria-hidden="true" />
              <span>Star</span>
            </a>
            <LanguageMenu />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main>
        <BankBoundary>
          <div style={{ display: pathname === '/' ? 'contents' : 'none' }} aria-hidden={pathname !== '/'}>
            {detect}
          </div>
          {pathname !== '/' && <Suspense fallback={null}><Outlet /></Suspense>}
        </BankBoundary>
      </main>
      <footer className="fp-footer text-meta text-muted-foreground">
        <p>{t('app.footer')}</p>
        <p className="fp-mono mt-1">
          BUILD{commit && <> <a href={`${REPOSITORY_URL}/commit/${commit}`} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">{commit}</a></>}
          {' ('}
          {/* sv-SE formats as YYYY-MM-DD HH:mm in the visitor's time zone. */}
          <time dateTime={buildTime}>{new Date(buildTime).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}</time>
          {')'}
        </p>
      </footer>
      <Toaster position="bottom-right" offset={toastOffset} mobileOffset={toastMobileOffset} />
    </div>
  )
}

function useBank() {
  const [bank, setBank] = useState<Bank | null>(null)
  const [failed, setFailed] = useState(false)
  const load = () => {
    setFailed(false)
    client.loadBank().then(bank => {
      setBank(bank)
      // Scoring is the only step that needs the detector, so it downloads in the background once the page can render.
      loadDetector().catch(() => {})
    }).catch(() => setFailed(true))
  }
  useEffect(load, [])
  return { bank, failed, reload: load }
}

/** 样本库是两个页面的共同依赖：加载中显示骨架，失败显示重试。 */
function BankBoundary({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const { bank, failed, reload } = useBank()
  if (failed) {
    return (
      <div className="fp-page">
        <h1 className="text-h1">{t('app.bankFailed')}</h1>
        <PixelShader effect="static" className="h-24 w-full rounded-xl text-destructive/35" />
        <div><Button variant="outline" onClick={reload}>{t('app.retry')}</Button></div>
      </div>
    )
  }
  if (!bank) {
    return (
      <div className="fp-page" aria-busy="true">
        <h1 className="sr-only">{t('app.bankLoading')}</h1>
        <Skeleton className="h-8 w-64" />
        <div className="fp-grid-samples">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="relative h-64 overflow-hidden rounded-xl">
              <PixelShader effect="blocks" className="absolute inset-0 text-muted-foreground/25" />
            </Skeleton>
          ))}
        </div>
      </div>
    )
  }
  return <BankContext.Provider value={bank}>{children}</BankContext.Provider>
}
