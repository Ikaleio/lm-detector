import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Cable, Check, ChevronDown, MoreVertical, PenLine, RotateCcw, Square, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PixelShader } from '@/components/pixel-shader'
import { StateBadge, isBusyState, type Mode, type SampleUI } from '@/components/sample-card'
import { parseNumbers } from '@/lib/client'
import { describe } from '@/lib/errors'
import { useI18n } from '@/i18n'
import { useMotionPreset } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { Analysis, Challenge } from '@fingerpoint/shared/types'

/** The manual / API radio group with a pill that slides to the chosen option. */
export function ModeSwitch({ mode, onChange, disabled }: { mode: Mode; onChange: (mode: Mode) => void; disabled: boolean }) {
  const { t } = useI18n()
  const { snappy } = useMotionPreset()
  const options = [{ value: 'manual', label: t('detect.modeManual'), icon: PenLine }, { value: 'api', label: t('detect.modeApi'), icon: Cable }] as const
  return (
    <div className="fp-custom-mode-switch" role="radiogroup" aria-label={t('detect.modeLabel')}>
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          tabIndex={mode === value ? 0 : -1}
          disabled={disabled}
          data-mode={value}
          onClick={() => onChange(value)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next: Mode = event.key === 'Home' ? 'manual' : event.key === 'End' ? 'api' : value === 'manual' ? 'api' : 'manual'
            onChange(next)
            event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus()
          }}
        >
          {mode === value && <motion.span className="fp-custom-mode-pill" layoutId="detect-mode-pill" transition={snappy} />}
          <span><Icon aria-hidden="true" />{label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * API mode's three samples as one compact list instead of question cards: the bench shows the scan,
 * each row its state, count and timing, with stop, resample and error details at the row's end.
 */
export function ApiSampleList({ samples, challenges, anomalous, canSample, locked, onResample, onStop, onShowError }: {
  samples: SampleUI[]
  challenges: Challenge[]
  anomalous: number[]
  canSample: boolean
  locked: boolean
  onResample: (index: number) => void
  onStop: (index: number) => void
  onShowError: (index: number) => void
}) {
  const i18n = useI18n()
  const { t } = i18n
  return (
    <ol className="fp-card flex flex-col" aria-label={t('detect.samples')}>
      {samples.map((sample, i) => {
        const busy = isBusyState(sample.state)
        const text = sample.draftText ?? sample.text
        return (
          <li key={challenges[i].id} className="relative flex min-h-12 flex-col justify-center gap-0.5 border-t border-border px-4 py-2 first:border-t-0">
            {busy && <PixelShader effect="march" cell={2} className="absolute inset-x-0 top-0 h-1 text-muted-foreground/60" />}
            <div className="flex items-center gap-2">
              <span className="text-body font-medium">{t('detect.sample', { n: i + 1 })}</span>
              {anomalous.includes(i) && <TriangleAlert className="size-4 text-warning" aria-label={t('detect.anomalousShort')} />}
              <StateBadge sample={sample} expected={challenges[i].expected_count} />
              <span className="ms-auto truncate text-meta text-muted-foreground">
                {t('detect.numbers', { count: parseNumbers(text).length })}
                {sample.elapsedMs !== undefined ? ` · ${t('detect.seconds', { s: (sample.elapsedMs / 1000).toFixed(1) })}` : ''}
              </span>
              {busy
                ? <Button variant="ghost" size="icon-sm" aria-label={t('detect.stop')} title={t('detect.stop')} onClick={() => onStop(i)}><Square /></Button>
                : <Button variant="ghost" size="icon-sm" aria-label={t('detect.resample')} title={t('detect.resample')} disabled={!canSample || locked} onClick={() => onResample(i)}><RotateCcw /></Button>}
              {sample.errorText && <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('detect.more')} />}><MoreVertical /></DropdownMenuTrigger>
                <DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => onShowError(i)}>{t('detect.viewError')}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
              </DropdownMenu>}
            </div>
            {sample.state === 'rejected' && <p className="line-clamp-2 text-meta text-destructive" role="status">{describe(i18n, sample.errorCode, sample.httpStatus)}</p>}
          </li>
        )
      })}
    </ol>
  )
}

/** Takes the form's place once the ticket has printed: what was measured, the inputs to look back on, and the result actions. */
export function ScanSummary({ result, model, samples, challenges, anomalous, mode, canResample, onResample, onRestart, onSaveImage, onExportJson, extra }: {
  result: Analysis
  model: string | null
  samples: SampleUI[]
  challenges: Challenge[]
  anomalous: number[]
  mode: Mode
  canResample: boolean
  onResample: (index: number) => void
  onRestart: () => void
  onSaveImage: () => void
  onExportJson: () => void
  extra?: ReactNode
}) {
  const { t, number, percent } = useI18n()
  const { snappy, reduced } = useMotionPreset()
  const [expanded, setExpanded] = useState(false)
  const top = result.results[0]
  const scorable = result.decision !== 'not_model' && result.decision !== 'unscorable' && top
  return (
    <section className="fp-custom-summary" aria-labelledby="scan-summary-title">
      <div className="fp-custom-summary-check"><Check className="size-6" aria-hidden="true" /></div>
      <span className="text-meta text-muted-foreground">{t('detect.summaryEyebrow')}</span>
      <h2 id="scan-summary-title" className="mt-2 text-section-title">{t('detect.summaryTitle')}</h2>
      <p className="mt-2 text-body text-muted-foreground">{t('detect.summaryBody')}</p>
      <dl>
        {model?.trim() && <div><dt>{t('detect.stageModel')}</dt><dd className="fp-mono">{model.trim()}</dd></div>}
        <div><dt>{t('detect.summaryUsed')}</dt><dd>{number(result.used_outputs)}/3</dd></div>
        <div>
          <dt>{t('detect.topLabel')}</dt>
          <dd className="font-medium">{scorable ? `${top.display_name}${top.probability === null ? '' : ` · ${percent(top.probability)}`}` : t(result.decision === 'not_model' ? 'detect.notModel' : 'detect.unscorable')}</dd>
        </div>
      </dl>
      <button type="button" className="flex w-full items-center justify-between border-t border-border py-3 text-body text-muted-foreground hover:text-foreground" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
        {t('detect.reviewInputs')}
        <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {expanded && <motion.div className="fp-custom-snapshot" initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={reduced ? undefined : { height: 0, opacity: 0 }} transition={snappy}>
          {samples.map((sample, i) => (
            <div key={challenges[i].id}>
              <span className="flex items-center gap-2 text-meta text-muted-foreground">
                {t('detect.question', { n: i + 1 })}
                {anomalous.includes(i) && <TriangleAlert className="size-3.5 text-warning" aria-label={t('detect.anomalousShort')} />}
                <span className="ms-auto flex items-center gap-1">
                  <StateBadge sample={sample} expected={challenges[i].expected_count} />
                  {mode === 'api' && <Button variant="ghost" size="sm" className="h-6 px-2 text-primary hover:text-primary" disabled={!canResample} onClick={() => onResample(i)}>{t('detect.resample')}</Button>}
                </span>
              </span>
              <p className="line-clamp-3 text-body" title={challenges[i].prompt}>{challenges[i].prompt}</p>
              <pre tabIndex={0}>{sample.text || '—'}</pre>
            </div>
          ))}
        </motion.div>}
      </AnimatePresence>
      <div className="mt-4 flex items-center gap-2">
        {extra}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label={t('detect.more')} />}><MoreVertical /></DropdownMenuTrigger>
          <DropdownMenuContent align="start"><DropdownMenuGroup><DropdownMenuItem onClick={onExportJson}>{t('detect.exportJson')}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
        {result.results.length > 0 && <Button variant="outline" className="ms-auto h-9" onClick={onSaveImage}>{t('detect.saveImage')}</Button>}
      </div>
      <Button className="mt-3 h-11 w-full justify-between px-4" onClick={onRestart}>
        <span className="flex items-center gap-2"><RotateCcw aria-hidden="true" />{t('detect.restart')}</span>
        <ArrowRight aria-hidden="true" />
      </Button>
      <p className="mt-3 text-center text-meta text-muted-foreground">{t('detect.summaryFootnote')}</p>
    </section>
  )
}
