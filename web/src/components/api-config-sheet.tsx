import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { configComplete, type WebApiConfig } from '@/lib/config'
import { cn } from '@/lib/utils'

const placeholders: Record<WebApiConfig['format'], string> = {
  openai: 'https://api.openai.com/v1',
  responses: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
}
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function Segmented<T extends string>({ value, onChange, options, disabled, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean; label: string }) {
  return (
    <ToggleGroup value={[value]} onValueChange={values => { if (values.length) onChange(values[0] as T) }} aria-label={label} disabled={disabled} variant="outline" spacing={0} className="min-h-9 flex-wrap justify-start">
      {options.map(o => (
        <ToggleGroupItem key={o.value} value={o.value} className="h-9 flex-none">{o.label}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function SwitchRow({ id, label, help, checked, onChange }: { id: string; label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <FieldLabel htmlFor={id} className="text-body">{label}</FieldLabel>
        {help && <span className="text-meta text-muted-foreground">{help}</span>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-1" />
    </div>
  )
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: WebApiConfig
  update: (patch: Partial<WebApiConfig>) => void
  canStart: boolean
  onStart: (config: WebApiConfig) => void
}

export function ApiConfigSheet({ open, onOpenChange, config, update, canStart, onStart }: Props) {
  const { t } = useI18n()
  const [showKey, setShowKey] = useState(false)
  const [draft, setDraft] = useState(config)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) { setDraft(config); setShowKey(false) }
  }
  const change = (patch: Partial<WebApiConfig>) => setDraft(current => ({ ...current, ...patch }))
  function save(start: boolean) {
    const saved = { ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), effort: draft.effort.trim() }
    update(saved)
    onOpenChange(false)
    if (start) onStart(saved)
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full sm:max-w-[420px]" aria-describedby={undefined}>
        <SheetHeader className="border-b border-border">
          <SheetTitle>{t('api.title')}</SheetTitle>
          <SheetDescription className="sr-only">{t('api.title')}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="api-base-url">{t('api.baseUrl')}</FieldLabel>
              <Input id="api-base-url" className="fp-mono h-9" value={draft.baseUrl} placeholder={placeholders[draft.format]} autoComplete="off" spellCheck={false} onChange={e => change({ baseUrl: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="api-key">{t('api.apiKey')}</FieldLabel>
              <div className="flex gap-2">
                <Input id="api-key" className="fp-mono h-9" type={showKey ? 'text' : 'password'} value={draft.apiKey} autoComplete="off" spellCheck={false} onChange={e => change({ apiKey: e.target.value })} />
                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline" size="icon-lg" aria-label={t(showKey ? 'api.hideKey' : 'api.showKey')} aria-pressed={showKey} onClick={() => setShowKey(s => !s)} />}>
                    {showKey ? <EyeOff /> : <Eye />}
                  </TooltipTrigger>
                  <TooltipContent>{t(showKey ? 'api.hideKey' : 'api.showKey')}</TooltipContent>
                </Tooltip>
              </div>
              <FieldDescription className="text-meta">{t('api.apiKeyHelp')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="api-model">{t('api.model')}</FieldLabel>
              <Input id="api-model" className="fp-mono h-9" value={draft.model} placeholder={t('api.modelPlaceholder')} autoComplete="off" spellCheck={false} onChange={e => change({ model: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel>{t('api.format')}</FieldLabel>
              <Segmented
                label={t('api.format')}
                value={draft.format}
                onChange={format => change({ format })}
                options={[
                  { value: 'openai', label: t('api.formatChat') },
                  { value: 'anthropic', label: t('api.formatMessages') },
                  { value: 'responses', label: t('api.formatResponses') },
                ]}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="api-effort">{t('api.effort')}</FieldLabel>
              <Input id="api-effort" list="api-efforts" value={draft.effort} placeholder={t('api.effortDefault')} autoComplete="off" spellCheck={false} onChange={e => change({ effort: e.target.value })} aria-describedby="api-effort-help" />
              <datalist id="api-efforts">{efforts.map(effort => <option key={effort} value={effort} />)}</datalist>
              <FieldDescription id="api-effort-help">{t('api.effortHelp')}</FieldDescription>
            </Field>
            <div className="h-px bg-border" />
            <SwitchRow id="api-stream" label={t('api.stream')} help={t('api.streamHelp')} checked={draft.stream ?? true} onChange={stream => change({ stream })} />
            <SwitchRow id="api-parallel" label={t('api.parallel')} help={t('api.parallelHelp')} checked={draft.parallel ?? false} onChange={parallel => change({ parallel })} />
            <SwitchRow id="api-auto" label={t('api.autoVerify')} checked={draft.autoVerify} onChange={autoVerify => change({ autoVerify })} />
            <SwitchRow id="api-remember" label={t('api.remember')} help={t('api.rememberHelp')} checked={draft.remember} onChange={remember => change({ remember })} />
          </FieldGroup>
        </div>
        <SheetFooter className={cn('flex-row justify-end border-t border-border')}>
          <Button variant="outline" onClick={() => save(false)}>{t('api.save')}</Button>
          <Button disabled={!configComplete(draft) || !canStart} onClick={() => save(true)}>{t('api.saveAndStart')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
