import { useRef, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { zhDisclaimerCheck } from '@/i18n/messages'
import { docsHref } from '@/lib/docs'
import { cn } from '@/lib/utils'

/** The stronger Chinese confirmation must not accept the original notice's acknowledgment. */
const ACCEPTED_KEY = 'fp-disclaimer-v1'
const ZH_ACCEPTED_KEY = 'fp-disclaimer-zh-v2'

function accepted(key: string) {
  try { return localStorage.getItem(key) !== null } catch { return false }
}

/** Chinese requires explicit confirmation after the questions; other locales retain the one-click notice. */
export function DisclaimerDialog() {
  const { t, locale } = useI18n()
  const requiresCheck = locale === 'zh'
  const [acknowledged, setAcknowledged] = useState(() => ({
    standard: accepted(ACCEPTED_KEY),
    zh: accepted(ZH_ACCEPTED_KEY),
  }))
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const correctCount = zhDisclaimerCheck.questions.filter(question => answers[question.id] === question.answer).length
  const canAccept = !requiresCheck || correctCount === zhDisclaimerCheck.questions.length
  const open = requiresCheck ? !acknowledged.zh : !acknowledged.standard
  const titleRef = useRef<HTMLHeadingElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const accept = () => {
    if (!canAccept) return
    setAcknowledged(previous => ({ standard: true, zh: previous.zh || requiresCheck }))
    try {
      const timestamp = String(Date.now())
      if (requiresCheck) localStorage.setItem(ZH_ACCEPTED_KEY, timestamp)
      localStorage.setItem(ACCEPTED_KEY, timestamp)
    } catch { /* storage unavailable: acknowledgment lasts for this page */ }
  }
  return (
    <Dialog open={open} onOpenChange={(next, details) => {
      if (next) return
      if (requiresCheck) details.cancel()
      else accept()
    }} disablePointerDismissal>
      <DialogContent showCloseButton={false} initialFocus={requiresCheck ? titleRef : confirmRef} className={cn('flex max-h-[calc(100dvh-2rem)] flex-col', requiresCheck ? 'sm:max-w-xl' : 'sm:max-w-md')}>
        <DialogHeader className="shrink-0">
          <DialogTitle ref={titleRef} tabIndex={-1}>{t('disclaimer.title')}</DialogTitle>
          <DialogDescription>{t('disclaimer.intro')}</DialogDescription>
        </DialogHeader>
        <div className="-m-1 flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-1 text-body">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>{t('disclaimer.reference')}</li>
            <li>{t('disclaimer.providers')}</li>
            <li>{t('disclaimer.liability')}</li>
          </ul>
          {requiresCheck && <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="disclaimer-check-title">
            <div className="flex flex-col gap-1">
              <h3 id="disclaimer-check-title" className="font-medium">{zhDisclaimerCheck.title}</h3>
              <p className="text-muted-foreground">{zhDisclaimerCheck.help}</p>
            </div>
            {zhDisclaimerCheck.questions.map(question => {
              const incorrect = answers[question.id] !== undefined && answers[question.id] !== question.answer
              const errorId = `disclaimer-${question.id}-error`
              return (
                <fieldset key={question.id} className="min-w-0" aria-describedby={incorrect ? errorId : undefined}>
                  <legend className="mb-1 font-medium">{question.prompt}</legend>
                  {question.options.map((option, index) => (
                    <label key={option} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted">
                      <input type="radio" name={`disclaimer-${question.id}`} value={index} checked={answers[question.id] === index} onChange={() => setAnswers(previous => ({ ...previous, [question.id]: index }))} className="size-4 shrink-0 accent-primary" aria-invalid={incorrect || undefined} aria-describedby={incorrect ? errorId : undefined} />
                      <span>{option}</span>
                    </label>
                  ))}
                  {incorrect && <p id={errorId} role="status" className="mt-1 text-destructive">{zhDisclaimerCheck.retry}</p>}
                </fieldset>
              )
            })}
          </section>}
        </div>
        {requiresCheck && <p role="status" className="shrink-0 text-meta text-muted-foreground">{zhDisclaimerCheck.progress.replace('{count}', String(correctCount))}</p>}
        <DialogFooter className="shrink-0">
          <a className={buttonVariants({ variant: 'outline' })} href={docsHref(locale, 'disclaimer')} target="_blank" rel="noopener noreferrer">
            {t('disclaimer.full')}
          </a>
          <Button ref={confirmRef} onClick={accept} disabled={!canAccept}>{requiresCheck ? zhDisclaimerCheck.accept : t('disclaimer.accept')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
