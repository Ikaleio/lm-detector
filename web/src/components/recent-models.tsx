import { useMemo } from 'react'
import { Sparkles } from 'lucide-react'
import { BrandIcon } from '@/components/brand-icon'
import { ModelChip } from '@/components/model-chip'
import { useI18n } from '@/i18n'
import { useLoadedBank } from '@/lib/bank-context'
import { brandLogos } from '@/lib/brand-logos'
import { cn } from '@/lib/utils'
import type { BankModel } from '@fingerpoint/shared/types'

const RECENT_DAYS = 7
const LIMIT = 5
/** OpenAI, Anthropic, DeepSeek and Gemini models go first; each group lists the newest first. */
const PINNED_FAMILIES: Record<string, true> = { gpt: true, claude: true, deepseek: true, gemini: true }

function recentModels(models: BankModel[], now: number) {
  const since = now - RECENT_DAYS * 24 * 60 * 60 * 1000
  return models
    .map(model => ({ model, addedAt: Date.parse(model.added_at ?? ''), pinned: model.family in PINNED_FAMILIES }))
    .filter(entry => entry.addedAt >= since)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.addedAt - a.addedAt)
    .slice(0, LIMIT)
}

/** The models added to the library in the last week; it renders nothing when there are none. */
export function RecentModels({ className }: { className?: string }) {
  const bank = useLoadedBank()
  const { t, date, daysAgo } = useI18n()
  const entries = useMemo(() => recentModels(bank.models, Date.now()), [bank])
  if (!entries.length) return null
  return (
    <aside aria-label={t('detect.recentTitle')} className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-body font-medium" title={t('detect.recentDescription', { days: RECENT_DAYS })}>
        <Sparkles className="size-4 text-primary" aria-hidden="true" />
        {t('detect.recentTitle')}
      </span>
      <ul className="flex min-w-0 flex-wrap gap-2">
        {entries.map(({ model, addedAt }) => (
          <li key={model.id} className="min-w-0">
            <ModelChip id={model.id} title={date(addedAt)}>
              {model.family in brandLogos && <BrandIcon family={model.family} className="size-3.5" />}
              <span className="truncate">{model.display_name}</span>
              <span className="shrink-0 text-meta text-muted-foreground">{daysAgo(addedAt)}</span>
            </ModelChip>
          </li>
        ))}
      </ul>
    </aside>
  )
}
