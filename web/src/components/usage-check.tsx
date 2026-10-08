import { CircleAlert, CircleCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { toneClass } from '@/components/sample-card'
import { useI18n } from '@/i18n'
import { useLoadedBank } from '@/lib/bank-context'
import { modelId } from '@/lib/use-model-match-celebration'
import { cn } from '@/lib/utils'
import type { UsageComparison } from '@fingerpoint/shared/usage-fit'

type Role = 'top' | 'claimed' | 'best'

/**
 * Compares the output tokens the API reported with the usage fits of the library models. Rows cover the top
 * candidate, the model the user entered when the library has it, and the closest fit when it is neither.
 */
export function UsageCheck({ comparisons, observations, top, claimed }: { comparisons: UsageComparison[]; observations: number; top: string | undefined; claimed: string | null }) {
  const { t, percent } = useI18n()
  const bank = useLoadedBank()
  const names = new Map(bank.models.map(model => [model.id, model.display_name]))
  const byModel = new Map(comparisons.map(comparison => [comparison.model, comparison]))
  const claimedId = claimed && comparisons.find(comparison => modelId(comparison.model) === modelId(claimed))?.model
  const rows: { role: Role; comparison: UsageComparison }[] = []
  const add = (role: Role, model: string | undefined | null) => {
    const comparison = model ? byModel.get(model) : undefined
    if (comparison && !rows.some(row => row.comparison.model === comparison.model)) rows.push({ role, comparison })
  }
  add('top', top)
  add('claimed', claimedId)
  add('best', comparisons[0]?.model)
  const consistent = comparisons.filter(comparison => comparison.consistent).length
  const signed = (value: number) => `${value < 0 ? '−' : '+'}${percent(Math.abs(value))}`

  return (
    <section className="fp-card flex flex-col gap-3 p-4" aria-labelledby="usage-check-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="usage-check-title" className="text-card-title">{t('usage.title')}</h3>
        <span className="text-meta text-muted-foreground">{t('usage.basis', { n: observations })}</span>
      </div>
      <p className="text-body text-muted-foreground">{t('usage.note')}</p>
      <ul className="flex flex-col">
        {rows.map(({ role, comparison }) => (
          <li key={comparison.model} className="grid min-h-12 grid-cols-[minmax(0,1fr)_4.5rem_5rem] items-center gap-x-4 border-t border-border py-2 first:border-t-0">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium [overflow-wrap:anywhere]">{names.get(comparison.model) ?? comparison.model}</span>
              <span className="text-meta text-muted-foreground">{t(`usage.role.${role}`)}</span>
            </span>
            <span className="text-right" title={t('usage.deviation')}>
              <span className="sr-only">{t('usage.deviation')} </span>{signed(comparison.deviation)}
            </span>
            <Badge className={cn('h-[22px] justify-self-end rounded-[var(--radius-badge)] px-2 text-meta font-medium', toneClass[comparison.consistent ? 'success' : 'destructive'])}>
              {comparison.consistent ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
              {t(comparison.consistent ? 'usage.consistent' : 'usage.inconsistent')}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="text-body text-muted-foreground">{consistent ? t('usage.consistentCount', { n: consistent, total: comparisons.length }) : t('usage.noneConsistent')}</p>
    </section>
  )
}
