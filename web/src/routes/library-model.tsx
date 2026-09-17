import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { motion } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLoadedBank } from '@/components/app-shell'
import { useI18n } from '@/i18n'
import * as client from '@/lib/client'
import { describeError } from '@/lib/errors'
import { useMotionPreset } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { redactPrivateMetadata } from '@fingerpoint/shared/privacy'
import { sourceLabel } from './library'
import type { SampleRow } from '@fingerpoint/shared/types'

const PAGE = 12

type SampleLoad = { status: 'loading' } | { status: 'ready'; rows: SampleRow[] } | { status: 'failed'; error: unknown }

export default function LibraryModelRoute() {
  const bank = useLoadedBank()
  const { t } = useI18n()
  const { smooth } = useMotionPreset()
  const { modelId = '' } = useParams()
  const model = bank.models.find(m => m.id === modelId)

  return (
    <div className="fp-page-wide">
      <div className="flex min-w-0 flex-col gap-1">
        <Link to="/library" className="inline-flex w-fit items-center gap-1 rounded-sm text-meta text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><ChevronLeft className="size-3.5" />{t('library.back')}</Link>
        {model ? (
          <>
            <motion.h1 layoutId={`model-${model.id}`} transition={smooth} className="text-h1 w-fit max-w-full [overflow-wrap:anywhere]">{model.display_name}</motion.h1>
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
    <Tabs value={activeId} onValueChange={value => { setChallenge(String(value)); setLimit(PAGE) }} className="grid min-w-0 gap-6 lg:grid-cols-[288px_minmax(0,1fr)]">
      <nav aria-label={t('library.challenges')} className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <div className="hidden flex-col gap-1 lg:flex">
          {groups.map(([id, list], i) => (
            <button
              key={id}
              type="button"
              aria-current={id === activeId ? 'true' : undefined}
              onClick={() => { setChallenge(id); setLimit(PAGE) }}
              className={cn('flex min-h-10 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-body hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', id === activeId && 'bg-muted font-medium')}
            >
              <span>{t('library.challenge', { n: i + 1 })}</span>
              <span className="text-meta text-muted-foreground">{t('library.challengeCount', { n: list.length })}</span>
            </button>
          ))}
        </div>
        <TabsList aria-label={t('library.challenges')} className="h-10 w-full justify-start overflow-x-auto lg:hidden">
          {groups.map(([id], i) => <TabsTrigger key={id} value={id} className="flex-none">{t('library.challenge', { n: i + 1 })}</TabsTrigger>)}
        </TabsList>
      </nav>
      <TabsContent value={activeId} className="flex min-w-0 flex-col gap-4">
        {active.slice(0, limit).map((row, i) => <SampleReply key={row.row_id || i} row={row} index={i} />)}
        {active.length > limit && (
          <div><Button variant="outline" className="h-9" onClick={() => setLimit(n => n + PAGE)}>{t('library.showMore', { n: Math.min(PAGE, active.length - limit) })}</Button></div>
        )}
      </TabsContent>
    </Tabs>
  )
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
