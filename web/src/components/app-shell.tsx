import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { motion } from 'framer-motion'
import { useTheme } from 'next-themes'
import { Languages, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useI18n } from '@/i18n'
import { useMotionPreset } from '@/lib/motion'
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
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  return (
    <IconAction label={t('app.toggleTheme')} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <Sun /> : <Moon />}
    </IconAction>
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

export function AppShell() {
  const { t } = useI18n()
  const { smooth } = useMotionPreset()
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = `${t(pathname.startsWith('/library') ? 'library.title' : 'detect.title')} · Fingerpoint`
  }, [pathname, t])
  const links = [
    { to: '/', label: t('app.detect'), end: true },
    { to: '/library', label: t('app.library'), end: false },
  ]
  return (
    <div className="fp-shell">
      <header className="fp-topbar">
        <div className="fp-topbar-inner">
          <NavLink to="/" className="text-card-title justify-self-start">{t('app.name')}</NavLink>
          <nav className="fp-nav" aria-label={t('app.navigation')}>
            {links.map(link => (
              <NavLink key={link.to} to={link.to} end={link.end}>
                {({ isActive }) => (
                  <>
                    {link.label}
                    {isActive && <motion.span className="fp-nav-indicator" layoutId="nav-indicator" transition={smooth} />}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1 justify-self-end">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main>
        <BankBoundary>
          <Outlet />
        </BankBoundary>
      </main>
      <footer className="fp-footer text-meta text-muted-foreground">{t('app.footer')}</footer>
      <Toaster position="bottom-right" />
    </div>
  )
}

export function useBank() {
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

const BankContext = createContext<Bank | null>(null)
export function useLoadedBank(): Bank {
  const bank = useContext(BankContext)
  if (!bank) throw new Error('bank not loaded')
  return bank
}
