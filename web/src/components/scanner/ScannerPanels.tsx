import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Cable, Check, ChevronDown, Eye, EyeOff, MoreVertical, PenLine, RotateCcw, Settings2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { BrandIcon } from '@/components/brand-icon'
import { Segmented } from '@/components/segmented'
import { StateBadge, type Mode, type SampleUI } from '@/components/sample-card'
import { useI18n } from '@/i18n'
import { useMotionPreset } from '@/lib/motion'
import type { WebApiConfig } from '@/lib/config'
import { cn } from '@/lib/utils'
import type { Analysis, Challenge } from '@fingerpoint/shared/types'

/**
 * The manual / API radio group with a pill that slides to the chosen option. The pill is measured inside the
 * switch, as in `Segmented`, so it only ever slides sideways even when the form around it changes height.
 */
export function ModeSwitch({ mode, onChange, disabled }: { mode: Mode; onChange: (mode: Mode) => void; disabled: boolean }) {
  const { t } = useI18n()
  const { snappy } = useMotionPreset()
  const root = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const container = root.current
    if (!container) return
    const measure = () => {
      const selected = container.querySelector<HTMLElement>('[aria-checked="true"]')
      setPill(selected ? { x: selected.offsetLeft, width: selected.offsetWidth } : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [mode])
  const options = [{ value: 'manual', label: t('detect.modeManual'), icon: PenLine }, { value: 'api', label: t('detect.modeApi'), icon: Cable }] as const
  return (
    <div ref={root} className="fp-custom-mode-switch" role="radiogroup" aria-label={t('detect.modeLabel')}>
      {pill && <motion.span className="fp-custom-mode-pill" aria-hidden="true" initial={false} animate={pill} transition={snappy} />}
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
          <span><Icon aria-hidden="true" />{label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * API mode's settings in the form, as in Fingerprint Report: the protocol, which decides how the endpoint is read,
 * then the endpoint and the key (the model field sits above). Everything else, profiles included, lives in the
 * advanced settings dialog, which edits the same configuration.
 */
export function ApiConnectionFields({ config, update, disabled, profileName, onAdvanced }: {
  config: WebApiConfig
  update: (changes: Partial<WebApiConfig>) => void
  disabled: boolean
  profileName?: string
  onAdvanced: () => void
}) {
  const { t } = useI18n()
  const [showKey, setShowKey] = useState(false)
  return (
    <div className="fp-custom-api-fields">
      <div className="flex flex-col gap-2">
        <span className="fp-custom-field-label">{t('api.format')}</span>
        <Segmented label={t('api.format')} value={config.format} disabled={disabled} onChange={format => update({ format })} options={[
          { value: 'openai', label: t('api.formatChat'), icon: <BrandIcon family="gpt" /> },
          { value: 'responses', label: t('api.formatResponses'), icon: <BrandIcon family="gpt" /> },
          { value: 'anthropic', label: t('api.formatMessages'), icon: <BrandIcon family="claude" /> },
        ]} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="detect-base-url" className="fp-custom-field-label">{t('api.baseUrl')}</label>
        <Input id="detect-base-url" data-api-required className="fp-mono h-10" value={config.baseUrl} readOnly={disabled} placeholder={config.format === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'} autoComplete="off" spellCheck={false} onChange={event => update({ baseUrl: event.target.value })} onBlur={() => update({ baseUrl: config.baseUrl.trim() })} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="detect-api-key" className="fp-custom-field-label flex items-center justify-between gap-2">
          {t('api.apiKey')}
          <small className="text-meta font-normal">{t('detect.keyNote')}</small>
        </label>
        <div className="relative">
          <Input id="detect-api-key" data-api-required className="fp-mono h-10 pe-11" type={showKey ? 'text' : 'password'} value={config.apiKey} readOnly={disabled} autoComplete="off" spellCheck={false} onChange={event => update({ apiKey: event.target.value })} />
          <Button variant="ghost" size="icon-sm" className="absolute end-1 top-1/2 -translate-y-1/2" aria-label={t(showKey ? 'api.hideKey' : 'api.showKey')} aria-pressed={showKey} onClick={() => setShowKey(v => !v)}>
            {showKey ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-3">
        <Button variant="outline" className="h-9" onClick={onAdvanced}><Settings2 data-icon="inline-start" />{t('detect.advancedSettings')}</Button>
        {profileName && <span className="min-w-0 truncate text-meta text-muted-foreground" title={profileName}>{t('detect.profileNote', { name: profileName })}</span>}
      </div>
    </div>
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
