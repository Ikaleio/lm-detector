import { useState, type Ref } from 'react'
import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Segmented } from '@/components/segmented'
import { useI18n } from '@/i18n'
import type { WebApiConfig } from '@/lib/config'
import { cn } from '@/lib/utils'

const placeholders: Record<WebApiConfig['format'], string> = {
  openai: 'https://api.openai.com/v1',
  responses: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
}
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function SwitchRow({ id, label, help, checked, onChange, disabled }: { id: string; label: string; help?: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <Field orientation="horizontal" data-disabled={disabled}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {help && <FieldDescription id={`${id}-help`}>{help}</FieldDescription>}
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-describedby={help ? `${id}-help` : undefined} />
    </Field>
  )
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: WebApiConfig
  update: (patch: Partial<WebApiConfig>) => void
  disabled: boolean
  containerRef: Ref<HTMLDivElement>
}

export function ApiConfigPanel({ open, onOpenChange, config, update, disabled, containerRef }: Props) {
  const { t } = useI18n()
  const [showKey, setShowKey] = useState(false)
  const baseUrl = config.baseUrl.trim() || t('api.baseUrlMissing')
  const model = config.model.trim() || t('api.modelMissing')

  return (
    <Collapsible ref={containerRef} open={open} onOpenChange={next => { setShowKey(false); onOpenChange(next) }} className="fp-card rr-block scroll-mt-20" aria-label={t('api.title')}>
      <CollapsibleTrigger className="fp-api-summary fp-mono" aria-label={`${t(open ? 'api.collapse' : 'api.expand')}: ${baseUrl}, ${model}`}>
        <span className="min-w-0 flex-1 truncate text-left" title={baseUrl}>{baseUrl}</span>
        <span className="shrink-0 text-muted-foreground" aria-hidden="true">/</span>
        <span className="min-w-0 flex-1 truncate text-left" title={model}>{model}</span>
        <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="fp-api-content">
        <Separator />
        <FieldSet disabled={disabled} className="min-w-0 p-4" aria-label={t('api.title')}>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="api-base-url">{t('api.baseUrl')}</FieldLabel>
              <Input id="api-base-url" data-api-required className="fp-mono h-9" value={config.baseUrl} placeholder={placeholders[config.format]} autoComplete="off" spellCheck={false} onChange={e => update({ baseUrl: e.target.value })} onBlur={() => update({ baseUrl: config.baseUrl.trim() })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="api-model">{t('api.model')}</FieldLabel>
              <Input id="api-model" data-api-required className="fp-mono h-9" value={config.model} placeholder={t('api.modelPlaceholder')} autoComplete="off" spellCheck={false} onChange={e => update({ model: e.target.value })} onBlur={() => update({ model: config.model.trim() })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="api-key">{t('api.apiKey')}</FieldLabel>
              <div className="flex gap-2">
                <Input id="api-key" data-api-required className="fp-mono h-9" type={showKey ? 'text' : 'password'} value={config.apiKey} autoComplete="off" spellCheck={false} onChange={e => update({ apiKey: e.target.value })} aria-describedby="api-key-help" />
                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline" size="icon-lg" disabled={disabled} aria-label={t(showKey ? 'api.hideKey' : 'api.showKey')} aria-pressed={showKey} onClick={() => setShowKey(s => !s)} />}>
                    {showKey ? <EyeOff /> : <Eye />}
                  </TooltipTrigger>
                  <TooltipContent>{t(showKey ? 'api.hideKey' : 'api.showKey')}</TooltipContent>
                </Tooltip>
              </div>
              <FieldDescription id="api-key-help">{t('api.apiKeyHelp')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="api-effort">{t('api.effort')}</FieldLabel>
              <Input id="api-effort" list="api-efforts" className="h-9" value={config.effort} placeholder={t('api.effortDefault')} autoComplete="off" spellCheck={false} onChange={e => update({ effort: e.target.value })} onBlur={() => update({ effort: config.effort.trim() })} aria-describedby="api-effort-help" />
              <datalist id="api-efforts">{efforts.map(effort => <option key={effort} value={effort} />)}</datalist>
              <FieldDescription id="api-effort-help">{t('api.effortHelp')}</FieldDescription>
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel>{t('api.format')}</FieldLabel>
              <Segmented label={t('api.format')} value={config.format} disabled={disabled} onChange={format => update({ format })} options={[
                { value: 'openai', label: t('api.formatChat') },
                { value: 'anthropic', label: t('api.formatMessages') },
                { value: 'responses', label: t('api.formatResponses') },
              ]} />
            </Field>
          </FieldGroup>
          <Separator />
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <SwitchRow id="api-stream" label={t('api.stream')} help={t('api.streamHelp')} checked={config.stream ?? true} onChange={stream => update({ stream })} disabled={disabled} />
            <SwitchRow id="api-parallel" label={t('api.parallel')} help={t('api.parallelHelp')} checked={config.parallel ?? false} onChange={parallel => update({ parallel })} disabled={disabled} />
            <SwitchRow id="api-auto" label={t('api.autoVerify')} checked={config.autoVerify} onChange={autoVerify => update({ autoVerify })} disabled={disabled} />
          </FieldGroup>
        </FieldSet>
      </CollapsibleContent>
    </Collapsible>
  )
}
