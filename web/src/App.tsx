import { HashRouter, Link, Route, Routes } from 'react-router'
import { MotionConfig } from 'framer-motion'
import { ThemeProvider } from 'next-themes'
import { Analytics } from '@vercel/analytics/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/app-shell'
import { I18nProvider, useI18n } from '@/i18n'
import DetectRoute from '@/routes/detect'
import LibraryRoute from '@/routes/library'
import LibraryModelRoute from '@/routes/library-model'

function NotFound() {
  const { t } = useI18n()
  return (
    <div className="fp-page">
      <h1 className="text-h1">{t('app.notFound')}</h1>
      <Link to="/" className="w-fit text-body text-primary">{t('app.backHome')}</Link>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="fp-theme">
      <I18nProvider>
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <HashRouter useTransitions={false}>
              <Routes>
                <Route element={<AppShell detect={<DetectRoute />} />}>
                  <Route index element={null} />
                  <Route path="/library" element={<LibraryRoute />} />
                  <Route path="/library/:modelId" element={<LibraryModelRoute />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </HashRouter>
          </TooltipProvider>
        </MotionConfig>
      </I18nProvider>
      <Analytics />
    </ThemeProvider>
  )
}
