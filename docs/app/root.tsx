import type { ReactNode } from 'react'
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useLocation, useNavigate } from 'react-router'
import { i18nProvider } from 'fumadocs-ui/i18n'
import { RootProvider } from 'fumadocs-ui/provider/react-router'
import type { Route } from './+types/root'
import SearchDialog from '@/components/search'
import { NotFound } from '@/components/not-found'
import { translations } from '@/lib/layout.shared'
import { docsBase } from '@/lib/shared'
import { localeOf, switchLocale } from '@/lib/urls'
import favicon from '../../web/src/assets/branding/favicon.png'
import faviconIco from '../../web/src/assets/branding/favicon.ico'
import appleTouchIcon from '../../web/src/assets/branding/apple-touch-icon.png'
import './app.css'

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const locale = localeOf(pathname, docsBase)
  // Fumadocs' switcher puts the locale first (`/en/docs/…`); here it follows the docs prefix instead.
  const i18n = { ...i18nProvider(translations, locale), onLocaleChange: (next: string) => navigate(switchLocale(pathname, docsBase, next)) }
  return (
    <html lang={locale === 'zh' ? 'zh-CN' : 'en'} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" href={faviconIco} sizes="16x16 32x32 48x48 64x64" />
        <link rel="icon" type="image/png" href={favicon} sizes="256x256" />
        <link rel="apple-touch-icon" href={appleTouchIcon} sizes="180x180" />
        <Meta />
        <Links />
      </head>
      <body className="flex min-h-screen flex-col">
        {/* The detector stores the theme under the same key, so both sites follow one choice. */}
        <RootProvider
          i18n={i18n}
          search={{ SearchDialog }}
          theme={{ storageKey: 'fp-theme', attribute: 'class', defaultTheme: 'system', enableSystem: true, disableTransitionOnChange: true }}
        >
          {children}
        </RootProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />
  const details = error instanceof Error ? error.message : isRouteErrorResponse(error) ? error.statusText : String(error)
  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-6 sm:px-6 md:px-8">
      <h1 className="text-h1">Error</h1>
      <p className="text-body text-fd-muted-foreground">{details}</p>
      {import.meta.env.DEV && error instanceof Error && error.stack && <pre className="w-full overflow-x-auto p-4"><code>{error.stack}</code></pre>}
    </main>
  )
}
