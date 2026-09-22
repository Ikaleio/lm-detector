import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { useTheme } from 'next-themes'
import { Languages, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useI18n } from '@/i18n'
import { useMotionPreset } from '@/lib/motion'
import { BankContext } from '@/lib/bank-context'
import * as client from '@/lib/client'
import type { Bank } from '@fingerpoint/shared/types'

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-lg" aria-label={label} onClick={onClick} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

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

function LanguageToggle() {
  const { t, locale, setLocale } = useI18n()
  return (
    <IconAction label={t('app.toggleLanguage')} onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>
      <Languages />
    </IconAction>
  )
}

export function AppShell({ detect }: { detect: ReactNode }) {
  const { t } = useI18n()
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
    document.title = `${t(pathname.startsWith('/library') ? 'library.title' : 'detect.title')} · Fingerpoint`
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
          <NavLink to="/" onClick={event => navigatePage(event, '/')} className="text-card-title justify-self-start">{t('app.name')}</NavLink>
          <nav ref={navRef} className="fp-nav" aria-label={t('app.navigation')}>
            {links.map(link => (
              <NavLink key={link.to} to={link.to} end={link.end} onClick={event => navigatePage(event, link.to)}>
                {link.label}
              </NavLink>
            ))}
            {indicator && <motion.span aria-hidden="true" className="fp-nav-indicator" initial={false} animate={indicator} transition={reduced ? { duration: 0 } : smooth} />}
          </nav>
          <div className="flex items-center gap-1 justify-self-end">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main>
        <BankBoundary>
          <div style={{ display: pathname === '/' ? 'contents' : 'none' }} aria-hidden={pathname !== '/'}>
            {detect}
          </div>
          {pathname !== '/' && <Outlet />}
        </BankBoundary>
      </main>
      <footer className="fp-footer text-meta text-muted-foreground">{t('app.footer')}</footer>
      <Toaster position="bottom-right" />
    </div>
  )
}

function useBank() {
  const [bank, setBank] = useState<Bank | null>(null)
  const [failed, setFailed] = useState(false)
  const load = () => {
    setFailed(false)
    client.loadBank().then(setBank).catch(() => setFailed(true))
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
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    )
  }
  return <BankContext.Provider value={bank}>{children}</BankContext.Provider>
}
