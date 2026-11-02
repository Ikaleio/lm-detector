import { useRef, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { docsHref } from '@/lib/docs'

/** Change the version when the notice changes, so every visitor reads it again. */
const ACCEPTED_KEY = 'fp-disclaimer-v1'

function accepted() {
  try { return localStorage.getItem(ACCEPTED_KEY) !== null } catch { return false }
}

/** The usage notice on the first visit. The confirm button and Escape both count as read; the backdrop does not close it. */
export function DisclaimerDialog() {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(() => !accepted())
  const confirmRef = useRef<HTMLButtonElement>(null)
  const accept = () => {
    setOpen(false)
    try { localStorage.setItem(ACCEPTED_KEY, String(Date.now())) } catch { /* storage unavailable: the notice shows again on the next visit */ }
  }
  return (
    <Dialog open={open} onOpenChange={next => { if (!next) accept() }} disablePointerDismissal>
      <DialogContent showCloseButton={false} initialFocus={confirmRef} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('disclaimer.title')}</DialogTitle>
          <DialogDescription>{t('disclaimer.intro')}</DialogDescription>
        </DialogHeader>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-body">
          <li>{t('disclaimer.reference')}</li>
          <li>{t('disclaimer.providers')}</li>
          <li>{t('disclaimer.liability')}</li>
        </ul>
        <DialogFooter>
          <a className={buttonVariants({ variant: 'outline' })} href={docsHref(locale, 'disclaimer')} target="_blank" rel="noopener noreferrer">
            {t('disclaimer.full')}
          </a>
          <Button ref={confirmRef} onClick={accept}>{t('disclaimer.accept')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
