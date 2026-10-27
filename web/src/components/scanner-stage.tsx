import { AnimatePresence, motion } from 'framer-motion'
import { CircleCheck, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FamilyIcon } from '@/components/brand-icon'
import { PixelShader } from '@/components/pixel-shader'
import { badgeFor, isBusyState, toneClass, type Mode, type SampleUI } from '@/components/sample-card'
import { useI18n } from '@/i18n'
import { brandLogos } from '@/lib/brand-logos'
import { useMotionPreset } from '@/lib/motion'
import { cn } from '@/lib/utils'
import type { Analysis, Bank, Challenge } from '@fingerpoint/shared/types'

export type StagePhase = 'edit' | 'sampling' | 'computing' | 'result'

/** The library family of the model id typed into the API configuration, matched on the id after any provider prefix. */
function declaredFamily(bank: Bank, model: string): string | null {
  const id = model.trim().toLowerCase().split('/').pop() ?? ''
  if (!id) return null
  return bank.models.find(m => m.id.toLowerCase() === id || m.display_name.toLowerCase() === id)?.family ?? null
}

const phaseTone = { edit: 'muted', sampling: 'warning', computing: 'warning', result: 'success' } as const

/**
 * The scanner bed beside the form: the declared input on top, a pixel fingerprint as the specimen,
 * one slot per sample along the bottom, and the leading candidate sliding up over the slots once a result exists.
 */
export function ScannerStage({ bank, mode, model, samples, challenges, phase, waitingDetector, result, anomalous }: {
  bank: Bank
  mode: Mode
  model: string
  samples: SampleUI[]
  challenges: Challenge[]
  phase: StagePhase
  waitingDetector: boolean
  result: Analysis | null
  anomalous: number[]
}) {
  const { t, percent } = useI18n()
  const { smooth, reduced } = useMotionPreset()
  const family = mode === 'api' ? declaredFamily(bank, model) : null
  const scanning = phase === 'sampling' || phase === 'computing'
  const top = result?.results[0]
  const scorable = result && result.decision !== 'not_model' && result.decision !== 'unscorable' && top
  const logo = scorable ? brandLogos[top.family] : undefined
  const phaseLabel = phase === 'computing' && waitingDetector ? t('detect.waitingDetectorShort') : t(`detect.stagePhase.${phase}`)

  return (
    <section className="fp-card fp-custom-stage relative isolate flex flex-col overflow-hidden" aria-label={t('detect.stageLabel')} data-phase={phase}>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-meta text-muted-foreground">{mode === 'api' ? t('detect.stageModel') : t('detect.modeLabel')}</span>
          <span className="flex min-w-0 items-center gap-2 text-body font-medium">
            {mode === 'api' && family && <FamilyIcon family={family} />}
            {mode === 'api'
              ? model.trim()
                ? <span className="fp-mono truncate" title={model.trim()}>{model.trim()}</span>
                : <span className="text-muted-foreground">{t('detect.stageNoModel')}</span>
              : t('detect.stageManual')}
          </span>
        </div>
        <Badge className={cn('h-[22px] shrink-0 rounded-[var(--radius-badge)] px-2 text-meta font-medium', toneClass[phaseTone[phase]])}>
          {scanning && <Loader2 className="animate-spin" />}
          {phaseLabel}
        </Badge>
      </div>

      <div className="relative isolate flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4">
        {phase === 'edit' && <PixelShader effect="dither" className="absolute inset-0 -z-10 text-muted-foreground/20" />}
        <PixelShader effect="fingerprint" cell={4} className="fp-custom-stage-specimen text-muted-foreground" />
        {/* The scan band runs under the specimen while replies arrive and while the detector scores them. */}
        <span className="h-6 w-full max-w-72">
          {scanning && <PixelShader effect="scan" cell={3} className="block h-full w-full text-muted-foreground/60" />}
        </span>
      </div>

      <div className="relative">
        <ol className="grid grid-cols-3 border-t border-border">
          {samples.map((sample, i) => {
            const badge = badgeFor(sample, challenges[i].expected_count)
            const busy = isBusyState(sample.state)
            return (
              <li key={i} className="relative flex min-w-0 flex-col gap-1 border-s border-border px-3 py-3 first:border-s-0 sm:px-4">
                {busy && <PixelShader effect="march" cell={2} className="absolute inset-x-0 top-0 h-1 text-muted-foreground/60" />}
                <span className="truncate text-meta text-muted-foreground">{t('detect.sample', { n: i + 1 })}</span>
                <span className={cn('truncate text-body font-medium', {
                  'text-muted-foreground': badge.tone === 'muted',
                  'text-success': badge.tone === 'success',
                  'text-warning': badge.tone === 'warning' || anomalous.includes(i),
                  'text-destructive': badge.tone === 'destructive',
                })}>
                  {t(`detect.state.${badge.key}`)}
                </span>
              </li>
            )
          })}
        </ol>
        <AnimatePresence initial={false}>
          {phase === 'result' && result && <motion.div
            key="ticket"
            className="absolute inset-0 flex items-center justify-between gap-3 border-t border-border bg-card px-4"
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? undefined : { y: '100%' }}
            transition={smooth}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-meta text-muted-foreground">{scorable ? t('detect.topLabel') : t('detect.result')}</span>
              {(() => {
                const name = scorable ? top.display_name : t(result.decision === 'not_model' ? 'detect.notModel' : 'detect.unscorable')
                return <span className="truncate text-card-title" title={name}>{name}</span>
              })()}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {scorable && <span className="text-card-title tabular-nums">{top.probability === null ? '—' : percent(top.probability)}</span>}
              {logo && <PixelShader effect="logo" image={logo} className="size-10 shrink-0 text-foreground" />}
            </div>
          </motion.div>}
        </AnimatePresence>
      </div>
    </section>
  )
}

/** Takes the form's place once a result exists: what was measured, with the ranking itself below the workbench. */
export function DetectSummary({ result, mode, model }: { result: Analysis; mode: Mode; model: string | null }) {
  const { t, number } = useI18n()
  const top = result.results[0]
  const scorable = result.decision !== 'not_model' && result.decision !== 'unscorable' && top
  const rows: [string, string, boolean?][] = [
    [t('detect.modeLabel'), mode === 'api' ? t('detect.modeApi') : t('detect.modeManual')],
    ...(mode === 'api' && model?.trim() ? [[t('detect.stageModel'), model.trim(), true] as [string, string, boolean]] : []),
    [t('detect.summaryUsed'), `${number(result.used_outputs)}/3`],
    [t('detect.topLabel'), scorable ? top.display_name : t(result.decision === 'not_model' ? 'detect.notModel' : 'detect.unscorable')],
  ]
  return (
    <section className="fp-card flex flex-col gap-3 p-4" aria-labelledby="detect-summary-title">
      <div className="flex items-center gap-2">
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
        <h2 id="detect-summary-title" className="text-section-title">{t('detect.summaryTitle')}</h2>
      </div>
      <p className="text-body text-muted-foreground">{t('detect.summaryBody')}</p>
      <dl className="flex flex-col">
        {rows.map(([label, value, mono]) => (
          <div key={label} className="flex min-h-10 items-center justify-between gap-4 border-t border-border py-2 text-body">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className={cn('min-w-0 text-right font-medium [overflow-wrap:anywhere]', mono && 'fp-mono')}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
