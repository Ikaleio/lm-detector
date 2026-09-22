import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { ChevronLeft } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLoadedBank } from '@/lib/bank-context'
import { useI18n } from '@/i18n'
import * as client from '@/lib/client'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { redactPrivateMetadata } from '@fingerpoint/shared/privacy'
import { sourceLabel } from './library'
import type { SampleRow } from '@fingerpoint/shared/types'

const PAGE = 12

type SampleLoad = { status: 'loading' } | { status: 'ready'; rows: SampleRow[] } | { status: 'failed'; error: unknown }

export default function LibraryModelRoute() {
  const bank = useLoadedBank()
  const { t } = useI18n()
  const { modelId = '' } = useParams()
  const model = bank.models.find(m => m.id === modelId)

  return (
    <div className="fp-page-wide fp-library-model">
      <div className="flex min-w-0 shrink-0 flex-col gap-1">
        <Link to="/library" className="inline-flex w-fit items-center gap-1 rounded-sm text-meta text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><ChevronLeft className="size-3.5" />{t('library.back')}</Link>
        {model ? (
          <>
            <h1 className="text-h1 w-fit max-w-full [overflow-wrap:anywhere]">{model.display_name}</h1>
            {model.display_name !== model.id && <p className="fp-mono text-meta text-muted-foreground [overflow-wrap:anywhere]">{model.id}</p>}
            <p className="text-body text-muted-foreground [overflow-wrap:anywhere]">
              {model.family_name} · {t('library.samplesCount', { n: model.response_count })} · {Object.keys(model.sources).map(k => sourceLabel(t, k)).join(' / ')}
            </p>
          </>
        ) : <h1 className="text-h1">{t('library.notFound')}</h1>}
      </div>
      {model && <ModelSamples key={model.id} modelId={model.id} />}
    </div>
  )
}

function ModelSamples({ modelId }: { modelId: string }) {
  const i18n = useI18n()
  const { t } = i18n
  const [load, setLoad] = useState<SampleLoad>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [challenge, setChallenge] = useState('')
  const [limit, setLimit] = useState(PAGE)

  useEffect(() => {
    let live = true
    client.loadSamples(modelId).then(
      rows => { if (live) setLoad({ status: 'ready', rows }) },
      error => { if (live) setLoad({ status: 'failed', error }) },
    )
    return () => { live = false }
  }, [modelId, attempt])

  const groups = useMemo(() => {
    const byChallenge = new Map<string, SampleRow[]>()
    if (load.status === 'ready') {
      for (const row of load.rows) {
        const group = byChallenge.get(row.challenge_id)
        if (group) group.push(row)
        else byChallenge.set(row.challenge_id, [row])
      }
    }
    return [...byChallenge].sort((a, b) => a[0].localeCompare(b[0]))
  }, [load])
  const activeId = groups.some(([id]) => id === challenge) ? challenge : groups[0]?.[0] ?? ''
  const active = groups.find(([id]) => id === activeId)?.[1] ?? []

  if (load.status === 'failed') {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p>{describeError(i18n, load.error, 'library.samplesFailed')}</p>
          <Button variant="outline" size="sm" onClick={() => { setLoad({ status: 'loading' }); setAttempt(n => n + 1) }}>{t('app.retry')}</Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (load.status === 'loading') {
    return (
      <div className="flex flex-col gap-4" role="status" aria-busy="true">
        <span>{t('library.loading')}</span>
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    )
  }

  if (!load.rows.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{t('library.noSamples')}</EmptyTitle>
          <EmptyDescription>{t('library.noSamplesBody')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Tabs value={activeId} onValueChange={value => { setChallenge(String(value)); setLimit(PAGE) }} className="grid min-h-0 min-w-0 gap-6 lg:flex-1 lg:grid-cols-[288px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
      <nav aria-label={t('library.challenges')} className="min-h-0 min-w-0">
        <ChallengeList groups={groups} activeId={activeId} onSelect={id => { setChallenge(id); setLimit(PAGE) }} />
        <TabsList aria-label={t('library.challenges')} className="h-10 w-full justify-start overflow-x-auto overflow-y-hidden lg:hidden">
          {groups.map(([id], i) => <TabsTrigger key={id} value={id} className="flex-none">{t('library.challenge', { n: i + 1 })}</TabsTrigger>)}
        </TabsList>
      </nav>
      <TabsContent key={activeId} value={activeId} className="flex min-h-0 min-w-0 flex-col gap-4 lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
        {active.slice(0, limit).map((row, i) => <SampleReply key={row.row_id || i} row={row} index={i} />)}
        {active.length > limit && (
          <div><Button variant="outline" className="h-9" onClick={() => setLimit(n => n + PAGE)}>{t('library.showMore', { n: Math.min(PAGE, active.length - limit) })}</Button></div>
        )}
      </TabsContent>
    </Tabs>
  )
}

function ChallengeList({ groups, activeId, onSelect }: { groups: [string, SampleRow[]][]; activeId: string; onSelect: (id: string) => void }) {
  const { t } = useI18n()
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const focusPending = useRef(false)
  const activeIndex = groups.findIndex(([id]) => id === activeId)
  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: index => groups[index][0],
    estimateSize: () => 48,
    overscan: 4,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), activeIndex])].filter(index => index >= 0).sort((a, b) => a - b),
  })

  useLayoutEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: 'auto' })
    if (focusPending.current) {
      activeRef.current?.focus({ preventScroll: true })
      focusPending.current = false
    }
  }, [activeIndex, virtualizer])

  return <div ref={scrollRef} className="hidden h-full min-h-0 overflow-y-auto overscroll-contain px-1 [scrollbar-gutter:stable] lg:block">
    <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map(item => {
        const [id, rows] = groups[item.index]
        return <li key={item.key} aria-posinset={item.index + 1} aria-setsize={groups.length} className="absolute top-0 left-0 w-full pb-1" style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
          <button
            ref={id === activeId ? activeRef : undefined}
            type="button"
            tabIndex={id === activeId ? 0 : -1}
            aria-current={id === activeId ? 'true' : undefined}
            onClick={() => onSelect(id)}
            onKeyDown={event => {
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1
                : event.key === 'ArrowDown' ? Math.min(groups.length - 1, item.index + 1)
                  : event.key === 'ArrowUp' ? Math.max(0, item.index - 1) : null
              if (next === null) return
              event.preventDefault()
              focusPending.current = true
              onSelect(groups[next][0])
            }}
            className={cn('flex h-full w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-body hover:bg-muted', id === activeId && 'bg-muted font-medium')}
          >
            <span>{t('library.challenge', { n: item.index + 1 })}</span>
            <span className="shrink-0 text-meta text-muted-foreground">{t('library.challengeCount', { n: rows.length })}</span>
          </button>
        </li>
      })}
    </ul>
  </div>
}

function publicMetadata(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const text = redactPrivateMetadata(value).replace(/\bsk-[\w-]+/g, '••••') as string
  if (!/^https?:\/\//i.test(text)) return text
  try {
    const url = new URL(text)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return undefined
  }
}

function SampleReply({ row, index }: { row: SampleRow; index: number }) {
  const { t, number, date } = useI18n()
  const { provenance } = row
  const endpoint = publicMetadata(provenance.endpoint)
  const provider = publicMetadata(provenance.provider_name ?? provenance.reported_provider ?? provenance.provider)
  const channel = publicMetadata(provenance.channel ?? provenance.original_provider ?? provenance.name ?? row.provider)
  const batch = publicMetadata(provenance.batch ?? row.collection_batch)

  return (
    <article className="fp-card flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-meta text-muted-foreground">
          {t('library.replyN', { n: index + 1 })} · {t('detect.numbers', { count: client.parseNumbers(row.text).length })} / {number(row.requested_count)} · {row.collected_at ? t('library.collectedAt', { date: date(row.collected_at) }) : t('library.noDate')} · {sourceLabel(t, provenance.kind)}
        </h2>
        <Badge className={cn('h-[22px] rounded-[var(--radius-badge)] px-2 text-meta font-medium', row.strict_valid ? 'bg-success/12 text-success' : 'bg-muted text-muted-foreground')}>
          {t(row.strict_valid ? 'library.strictValid' : 'library.strictInvalid')}
        </Badge>
      </div>
      {row.prompt ? (
        <details className="text-body">
          <summary className="w-fit cursor-pointer rounded-sm text-card-title focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('library.viewPrompt')}</summary>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{row.prompt}</p>
        </details>
      ) : <p className="text-meta text-muted-foreground">{t('library.noPrompt')}</p>}
      <pre tabIndex={0} aria-label={t('library.replyN', { n: index + 1 })} className="fp-reply max-h-[60vh] whitespace-pre-wrap font-sans text-body [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{row.text}</pre>
      {(endpoint || provider || channel || batch) && (
        <details className="text-meta text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t('library.provenance')}</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)] [&>dd]:[overflow-wrap:anywhere]">
            {endpoint && <><dt>{t('library.endpoint')}</dt><dd>{endpoint}</dd></>}
            {provider && <><dt>{t('library.provider')}</dt><dd>{provider}</dd></>}
            {channel && <><dt>{t('library.channel')}</dt><dd>{channel}</dd></>}
            {batch && <><dt>{t('library.batch')}</dt><dd>{batch}</dd></>}
          </dl>
        </details>
      )}
    </article>
  )
}
