import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { resolveReasoningEfforts, type ListedModel } from '@fingerpoint/shared/model-list'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { describeError } from '@/lib/errors'
import { fetchModelsForConfig } from '@/lib/model-list-client'
import { useConnectionRoute } from '@/lib/use-connection-route'
import type { ApiProfile, WebApiConfig } from '@/lib/config'
import { cn } from '@/lib/utils'

interface Props {
  config: ApiProfile
  update: (patch: Partial<WebApiConfig>) => void
  disabled: boolean
  models: ListedModel[] | null
  onModelsChange: (models: ListedModel[] | null) => void
}

export function ModelPicker({ config, update, disabled, models, onModelsChange }: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const { resolve, checking } = useConnectionRoute()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const busy = disabled || loading || checking

  const query = config.model.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!models) return []
    if (!query) return models
    return models.filter(model => {
      const name = model.name?.toLowerCase() ?? ''
      return model.id.toLowerCase().includes(query) || name.includes(query)
    })
  }, [models, query])

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 36,
    overscan: 8,
  })

  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0)
  }, [filtered.length, highlight])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    abortRef.current?.abort()
    onModelsChange(null)
    setError(null)
    setOpen(false)
    setLoading(false)
  }, [config.id, config.baseUrl, config.format, onModelsChange])

  function selectModel(model: ListedModel) {
    update({ model: model.id })
    setOpen(false)
    inputRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }
    if (!models?.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (!filtered.length) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const next = (highlight + delta + filtered.length) % filtered.length
      setHighlight(next)
      virtualizer.scrollToIndex(next)
      return
    }
    if (event.key === 'Enter' && open && filtered[highlight]) {
      event.preventDefault()
      selectModel(filtered[highlight])
    }
  }

  async function fetchModels() {
    const baseUrl = config.baseUrl.trim()
    if (!baseUrl) {
      setError(t('api.modelsNeedBaseUrl'))
      onModelsChange(null)
      return
    }
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    setLoading(true)
    setError(null)
    try {
      const route = await resolve(config)
      const list = await fetchModelsForConfig(
        { baseUrl, format: config.format, apiKey: config.apiKey.trim() },
        route,
        abort.signal,
      )
      if (abort.signal.aborted) return
      onModelsChange(list)
      if (!list.length) {
        setOpen(false)
        return
      }
      setOpen(true)
      setHighlight(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    } catch (cause) {
      if (abort.signal.aborted) return
      onModelsChange(null)
      setOpen(false)
      setError(describeError(i18n, cause))
    } finally {
      if (abortRef.current === abort) setLoading(false)
    }
  }

  const status = error ? null
    : loading || checking ? t('api.fetchingModels')
      : models && !models.length ? t('api.modelsEmpty')
        : models ? t('api.modelsLoaded', { count: models.length })
          : null
  const statusId = status ? 'api-model-status' : undefined
  const errorId = error ? 'api-model-error' : undefined
  const canOpen = !!models?.length && !busy

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor="api-model">{t('api.model')}</FieldLabel>
      <div ref={rootRef} className="relative">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 basis-40">
            <Input
              ref={inputRef}
              id="api-model"
              data-api-required
              className="fp-mono h-9 pr-8"
              value={config.model}
              placeholder={t('api.modelPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={open && filtered[highlight] ? `${listId}-${highlight}` : undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={[statusId, errorId].filter(Boolean).join(' ') || undefined}
              disabled={disabled}
              onChange={e => {
                update({ model: e.target.value })
                if (models?.length) {
                  setOpen(true)
                  setHighlight(0)
                }
              }}
              onFocus={() => { if (models?.length) setOpen(true) }}
              onBlur={() => update({ model: config.model.trim() })}
              onKeyDown={onKeyDown}
            />
            {canOpen && (
              <button
                type="button"
                tabIndex={-1}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t('api.modelsList')}
                disabled={disabled}
                onClick={() => {
                  setOpen(value => !value)
                  inputRef.current?.focus()
                }}
              >
                <ChevronDown className={cn('size-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
              </button>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={busy}
            aria-describedby="api-fetch-models-help"
            onClick={() => { void fetchModels() }}
          >
            {loading || checking
              ? <><Loader2 data-icon="inline-start" className="animate-spin" />{t('api.fetchingModels')}</>
              : models ? t('api.fetchModelsAgain') : t('api.fetchModels')}
          </Button>
        </div>
        {open && models && (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={t('api.modelsList')}
            className="absolute z-50 mt-1 max-h-64 w-full min-w-32 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            {filtered.length === 0
              ? <p className="px-1.5 py-1 text-sm text-muted-foreground">{t('api.modelsNoMatch')}</p>
              : (
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                  {virtualizer.getVirtualItems().map(item => {
                    const model = filtered[item.index]
                    const selected = model.id === config.model.trim()
                    const active = item.index === highlight
                    return (
                      <div
                        key={model.id}
                        id={`${listId}-${item.index}`}
                        role="option"
                        aria-selected={selected}
                        className={cn(
                          'absolute top-0 left-0 w-full cursor-pointer rounded-md px-1.5 py-1 text-sm outline-hidden',
                          active && 'bg-accent text-accent-foreground',
                        )}
                        style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                        onMouseEnter={() => setHighlight(item.index)}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => selectModel(model)}
                      >
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="fp-mono min-w-0 truncate">{model.id}</span>
                          {model.name && <span className="min-w-0 truncate text-meta text-muted-foreground">{model.name}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
          </div>
        )}
      </div>
      <p id="api-fetch-models-help" className="sr-only">{t('api.fetchModelsHelp')}</p>
      {status && (
        <p id={statusId} role="status" aria-live="polite" className={cn('text-meta', models && models.length ? 'text-success' : 'text-muted-foreground')}>
          {status}
        </p>
      )}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  )
}

export function EffortSuggestions({
  model,
  models,
  effort,
  disabled,
  onChange,
}: {
  model: string
  models: ListedModel[] | null
  effort: string
  disabled: boolean
  onChange: (effort: string) => void
}) {
  const { t } = useI18n()
  const id = model.trim()
  const listed = models?.find(entry => entry.id === id)
  const resolved = listed ?? (id ? { id, ...toListed(id) } : null)
  const efforts = resolved?.efforts ?? []
  if (!efforts.length || !resolved) {
    return (
      <Field>
        <FieldLabel htmlFor="api-effort">{t('api.effort')}</FieldLabel>
        <Input
          id="api-effort"
          list="api-efforts"
          className="h-9"
          value={effort}
          placeholder={t('api.effortDefault')}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          onBlur={() => onChange(effort.trim())}
          aria-describedby="api-effort-help"
        />
        <datalist id="api-efforts">{['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => <option key={value} value={value} />)}</datalist>
        <FieldDescription id="api-effort-help">{t('api.effortHelp')}</FieldDescription>
      </Field>
    )
  }

  return (
    <Field>
      <FieldLabel htmlFor="api-effort">{t('api.effort')}</FieldLabel>
      <Input
        id="api-effort"
        list="api-efforts-suggested"
        className="h-9"
        value={effort}
        placeholder={t('api.effortDefault')}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onBlur={() => onChange(effort.trim())}
        aria-describedby="api-effort-help"
      />
      <datalist id="api-efforts-suggested">{efforts.map(value => <option key={value} value={value} />)}</datalist>
      <div className="flex flex-wrap gap-1.5">
        {efforts.map(value => (
          <Button
            key={value}
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled}
            aria-pressed={effort.trim() === value}
            className={cn(effort.trim() === value && 'border-primary bg-primary/10 text-foreground')}
            onClick={() => onChange(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <FieldDescription id="api-effort-help">
        {t('api.effortSuggested')} {t(resolved.effortSource === 'api' ? 'api.effortFromApi' : 'api.effortFromTable')}
      </FieldDescription>
    </Field>
  )
}

function toListed(id: string): Pick<ListedModel, 'efforts' | 'effortSource'> {
  const { efforts, source } = resolveReasoningEfforts(id)
  return { efforts, effortSource: source }
}
