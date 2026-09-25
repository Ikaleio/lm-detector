import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ChevronDown, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Segmented } from '@/components/segmented'
import { useLoadedBank } from '@/lib/bank-context'
import { useI18n } from '@/i18n'
import * as client from '@/lib/client'
import { describeError } from '@/lib/errors'
import type { BankModel } from '@fingerpoint/shared/types'

type Sort = 'samples' | 'name'


export default function LibraryRoute() {
  const bank = useLoadedBank()
  const i18n = useI18n()
  const { t, number, date } = i18n
  const [query, setQuery] = useState('')
  const [families, setFamilies] = useState<string[]>([])
  const [sort, setSort] = useState<Sort>('samples')

  const allFamilies = useMemo(() => [...new Set(bank.models.map(m => m.family_name))].sort((a, b) => a.localeCompare(b)), [bank])
  const total = bank.models.reduce((s, m) => s + m.response_count, 0)
  const models = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = bank.models.filter(m => (!q || `${m.display_name} ${m.id} ${m.family_name}`.toLowerCase().includes(q)) && (!families.length || families.includes(m.family_name)))
    return list.sort((a, b) => (sort === 'samples' ? b.response_count - a.response_count || a.display_name.localeCompare(b.display_name) : a.display_name.localeCompare(b.display_name)))
  }, [bank, query, families, sort])
  const filtered = Boolean(query || families.length)

  return (
    <div className="fp-page-wide">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-h1">{t('library.title')}</h1>
        <span className="text-body text-muted-foreground">{t('library.summary', { models: bank.models.length, samples: total })}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('library.search')} aria-label={t('library.search')} className="h-9 w-72 max-w-full" />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="h-9" />}>
            {t('library.family')}{families.length ? ` · ${number(families.length)}` : ''}
            <ChevronDown data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setFamilies([])}>{t('library.allFamilies')}</DropdownMenuItem>
            {allFamilies.map(f => (
              <DropdownMenuCheckboxItem key={f} checked={families.includes(f)} onCheckedChange={on => setFamilies(cur => (on ? [...cur, f] : cur.filter(x => x !== f)))}>
                {f}
              </DropdownMenuCheckboxItem>
            ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Segmented label={t('library.sort')} value={sort} onChange={setSort} options={[{ value: 'samples', label: t('library.sortBySamples') }, { value: 'name', label: t('library.sortByName') }]} />
        <div className="ms-auto">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="h-9" />}>
              <Download data-icon="inline-start" />
              {t('library.export')}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => client.exportReferences().catch(e => toast.error(describeError(i18n, e)))}>{t('library.exportReferences')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => client.exportBank(bank)}>{t('library.exportBank')}</DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {models.length ? (
        <>
          <div className="fp-card hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 px-4">{t('library.colModel')}</TableHead>
                  <TableHead className="h-11 px-4">{t('library.colFamily')}</TableHead>
                  <TableHead className="h-11 px-4 text-right">{t('library.colSamples')}</TableHead>
                  <TableHead className="h-11 px-4 text-right">{t('library.colNumbers')}</TableHead>
                  <TableHead className="h-11 px-4">{t('library.colSources')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map(m => <ModelRow key={m.id} model={m} />)}
              </TableBody>
            </Table>
          </div>
          <ul className="fp-card overflow-hidden md:hidden">
            {models.map(m => (
              <li key={m.id} className="border-t border-border first:border-t-0">
                <Link to={`/library/${encodeURIComponent(m.id)}`} className="flex min-h-14 items-center justify-between gap-4 px-4 py-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-body font-medium [overflow-wrap:anywhere]">{m.display_name}</span>
                    {m.display_name !== m.id && <span className="fp-mono text-meta text-muted-foreground [overflow-wrap:anywhere]">{m.id}</span>}
                    <span className="text-meta text-muted-foreground [overflow-wrap:anywhere]">{m.family_name} · {t('library.samplesCount', { n: m.response_count })}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Empty className="border">
          <EmptyHeader><EmptyTitle>{t(filtered ? 'library.empty' : 'library.emptyBank')}</EmptyTitle></EmptyHeader>
          {filtered && <EmptyContent><Button variant="outline" size="sm" onClick={() => { setQuery(''); setFamilies([]) }}>{t('library.clearFilters')}</Button></EmptyContent>}
        </Empty>
      )}
      <p className="text-meta text-muted-foreground">{t('library.builtAt', { date: date(bank.built_at) })} · {number(models.length)} / {number(bank.models.length)}</p>
    </div>
  )
}

function ModelRow({ model }: { model: BankModel }) {
  const { t, number } = useI18n()
  const link = useRef<HTMLAnchorElement>(null)
  return (
    <TableRow className="h-12 cursor-pointer focus-within:bg-muted" onClick={event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if ((event.target as Element).closest('a, button, input') || window.getSelection()?.toString()) return
      link.current?.click()
    }}>
      <TableCell className="max-w-96 px-4 py-0 whitespace-normal">
        <Link ref={link} to={`/library/${encodeURIComponent(model.id)}`} className="flex flex-col rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <span className="text-body font-medium [overflow-wrap:anywhere]">{model.display_name}</span>
          {model.display_name !== model.id && <span className="fp-mono text-meta text-muted-foreground [overflow-wrap:anywhere]">{model.id}</span>}
        </Link>
      </TableCell>
      <TableCell className="px-4 py-0 text-muted-foreground">{model.family_name}</TableCell>
      <TableCell className="px-4 py-0 text-right">{number(model.response_count)}</TableCell>
      <TableCell className="px-4 py-0 text-right">{number(model.valid_number_count)}</TableCell>
      <TableCell className="px-4 py-0 text-muted-foreground">{Object.keys(model.sources).join(' / ')}</TableCell>
    </TableRow>
  )
}
