import { useId, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, Copy, Loader2, MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { useMotionPreset } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { parseNumbers } from '@/lib/client'
import { describe } from '@/lib/errors'
import type { Challenge, ErrorCode, SampleState } from '@fingerpoint/shared/types'

export interface SampleUI {
  text: string
  state: 'idle' | SampleState
  draftText?: string
  errorCode?: ErrorCode
  httpStatus?: number
  errorText?: string
  elapsedMs?: number
}

export type Mode = 'manual' | 'api'
export const minimumNumbers = (expected: number) => Math.max(80, Math.ceil(expected * 0.55))
export const isBusyState = (s: SampleUI['state']) => s === 'pending' || s === 'requesting' || s === 'streaming'

export function badgeFor(sample: SampleUI, expected: number): { key: 'empty' | 'filled' | 'short' | 'requesting' | 'streaming' | 'rejected' | 'stopped'; tone: 'muted' | 'success' | 'warning' | 'destructive' } {
  if (sample.state === 'pending' || sample.state === 'requesting') return { key: 'requesting', tone: 'warning' }
  if (sample.state === 'streaming') return { key: 'streaming', tone: 'warning' }
  if (sample.state === 'rejected') return { key: 'rejected', tone: 'destructive' }
  if (sample.state === 'stopped') return { key: 'stopped', tone: 'muted' }
  if (!sample.text.trim()) return { key: 'empty', tone: 'muted' }
  return parseNumbers(sample.text).length >= minimumNumbers(expected) ? { key: 'filled', tone: 'success' } : { key: 'short', tone: 'warning' }
}

const toneClass = {
  muted: 'bg-muted text-muted-foreground',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/12 text-destructive',
}

export function StateBadge({ sample, expected }: { sample: SampleUI; expected: number }) {
  const { t } = useI18n()
  const badge = badgeFor(sample, expected)
  return (
    <Badge className={cn('h-[22px] rounded-[var(--radius-badge)] px-2 text-meta font-medium', toneClass[badge.tone])}>
      {isBusyState(sample.state) && <Loader2 className="animate-spin" />}
      {t(`detect.state.${badge.key}`)}
    </Badge>
  )
}

interface SampleCardProps {
  index: number
  challenge: Challenge
  sample: SampleUI
  mode: Mode
  canSample: boolean
  locked: boolean
  onChange: (text: string) => void
  onResample: () => void
  onStop: () => void
  onShowError: () => void
}

export function SampleCard({ index, challenge, sample, mode, canSample, locked, onChange, onResample, onStop, onShowError }: SampleCardProps) {
  const i18n = useI18n()
  const { t, number } = i18n
  const replyId = useId()
  const { smooth } = useMotionPreset()
  const busy = isBusyState(sample.state)
  const visibleText = sample.draftText ?? sample.text
  const count = parseNumbers(visibleText).length
  const replacementFailed = (sample.state === 'rejected' || sample.state === 'stopped') && Boolean(sample.text.trim())
  const unaccepted = !sample.text.trim() && Boolean(sample.draftText?.trim()) && !busy
  const min = minimumNumbers(challenge.expected_count)
  const promptNote = t('detect.promptNote')

  async function copy() {
    try {
      await navigator.clipboard.writeText(challenge.prompt)
      toast.success(t('detect.copied', { n: index + 1 }))
    } catch {
      toast.error(t('detect.copyFailed'))
    }
  }

  return (
    <motion.article id={`sample-panel-${index}`} layoutId={`sample-${index}`} layout transition={smooth} className="fp-card flex min-w-0 flex-col gap-3 p-4" aria-label={t('detect.sample', { n: index + 1 })}>
      <div className="flex h-9 items-center justify-between gap-2">
        <span className="text-card-title">{t('detect.sample', { n: index + 1 })}</span>
        <div className="flex items-center gap-1">
          <StateBadge sample={sample} expected={challenge.expected_count} />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label={t('detect.more')} />} />}>
                <MoreVertical />
              </TooltipTrigger>
              <TooltipContent>{t('detect.more')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {sample.errorText && <DropdownMenuItem onClick={onShowError}>{t('detect.viewError')}</DropdownMenuItem>}
                <DropdownMenuItem disabled={busy || locked || !visibleText} onClick={() => onChange('')}>{t('detect.clearReply')}</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="h-px bg-border" />
      <div className="flex flex-col gap-1">
        <div className="flex h-6 items-center justify-between">
          <span className="text-meta text-muted-foreground">{t('detect.prompt')}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-primary hover:text-primary" onClick={copy}>
            <Copy data-icon="inline-start" />
            {t('detect.copy')}
          </Button>
        </div>
        <PromptText text={challenge.prompt} />
        {promptNote && <p className="text-meta text-muted-foreground">{promptNote}</p>}
      </div>
      <div className="h-px bg-border" />
      <div className="flex min-h-0 flex-col gap-1">
        <label htmlFor={replyId} className="flex h-6 items-center text-meta text-muted-foreground">{t('detect.reply')}</label>
        {busy || visibleText || mode === 'manual' ? (
          <Textarea
            id={replyId}
            value={visibleText}
            readOnly={busy || locked}
            aria-busy={busy}
            aria-describedby={replacementFailed || unaccepted || sample.state === 'rejected' ? `${replyId}-status` : undefined}
            onChange={e => onChange(e.target.value)}
            placeholder={t('detect.replyPlaceholder')}
            aria-label={`${t('detect.sample', { n: index + 1 })} · ${t('detect.reply')}`}
            className="fp-reply min-h-36 text-body"
            spellCheck={false}
          />
        ) : (
          <button
            type="button"
            id={replyId}
            className="flex h-11 w-full items-center justify-center rounded-lg border border-dashed border-input text-body text-muted-foreground hover:bg-muted disabled:opacity-50"
            disabled={!canSample || locked}
            onClick={onResample}
          >
            {t('detect.waitingSample')}
          </button>
        )}
        {(sample.state === 'rejected' || replacementFailed || unaccepted) && <div id={`${replyId}-status`} role="status" className="flex flex-col gap-1">
          {sample.state === 'rejected' && <p className="text-body text-destructive">{describe(i18n, sample.errorCode, sample.httpStatus)}</p>}
          {replacementFailed && <p className="text-meta text-muted-foreground">{t('detect.previousReplyKept')}</p>}
          {unaccepted && <p className="text-meta text-muted-foreground">{t('detect.partialReplyHelp')}</p>}
        </div>}
      </div>
      <div className="flex items-center justify-between gap-2 text-meta text-muted-foreground">
        <span>
          {t('detect.numbers', { count })}
          {visibleText.trim() && count < min ? ` · ${t('detect.numbersNeeded', { min })}` : ''}
          {sample.elapsedMs !== undefined ? ` · ${t('detect.seconds', { s: (sample.elapsedMs / 1000).toFixed(1) })}` : ''}
        </span>
        {busy ? (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-primary hover:text-primary" onClick={onStop}>{t('detect.stop')}</Button>
        ) : mode === 'api' && (sample.text || sample.state === 'rejected' || sample.state === 'stopped') ? (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-primary hover:text-primary" disabled={!canSample || locked} onClick={onResample}>{t('detect.resample')}</Button>
        ) : null}
      </div>
      <span className="sr-only">{number(count)}</span>
    </motion.article>
  )
}

function PromptText({ text }: { text: string }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const promptId = useId()
  return (
    <div className="flex flex-col items-start gap-1">
      <p id={promptId} className={cn('text-body whitespace-pre-wrap [overflow-wrap:anywhere]', !open && 'line-clamp-4')}>{text}</p>
      <Button variant="ghost" size="sm" className="h-6 px-0 text-primary hover:bg-transparent hover:text-primary" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={promptId}>
        {t(open ? 'detect.collapse' : 'detect.expand')}
        <ChevronDown data-icon="inline-end" className={cn('transition-transform', open && 'rotate-180')} />
      </Button>
    </div>
  )
}


export function SampleStrip({ samples, challenges, expanded, onToggle }: { samples: SampleUI[]; challenges: Challenge[]; expanded: number | null; onToggle: (i: number) => void }) {
  const { t } = useI18n()
  const { smooth } = useMotionPreset()
  return (
    <div className="grid grid-cols-3 gap-2">
      {samples.map((sample, i) => (
        <motion.button
          key={challenges[i].id}
          type="button"
          layoutId={expanded === i ? undefined : `sample-${i}`}
          transition={smooth}
          className="fp-card flex h-11 min-w-0 items-center justify-between gap-2 px-3 text-left text-body hover:bg-muted"
          aria-expanded={expanded === i}
          aria-controls={expanded === i ? `sample-panel-${i}` : undefined}
          onClick={() => onToggle(i)}
        >
          <span className="truncate">
            {t('detect.sample', { n: i + 1 })}
            <span className="hidden text-muted-foreground sm:inline"> · {t('detect.numbers', { count: parseNumbers(sample.text).length })}</span>
          </span>
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', expanded === i && 'rotate-180')} />
        </motion.button>
      ))}
    </div>
  )
}
