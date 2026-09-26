import { useState, type Ref } from 'react'
import { ChevronDown, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Segmented } from '@/components/segmented'
import { useI18n } from '@/i18n'
import type { ApiProfile, ApiProfileManager, WebApiConfig } from '@/lib/config'
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
  config: ApiProfile
  update: (patch: Partial<WebApiConfig>) => void
  profileManager: ApiProfileManager
  disabled: boolean
  containerRef: Ref<HTMLDivElement>
}

export function ApiConfigPanel({ open, onOpenChange, config, update, profileManager, disabled, containerRef }: Props) {
  const { t } = useI18n()
  const [showKey, setShowKey] = useState(false)
  const baseUrl = config.baseUrl.trim() || t('api.baseUrlMissing')
  const model = config.model.trim() || t('api.modelMissing')
  const activeProfileName = config.name.trim() || config.model.trim() || t('api.defaultProfileName')

  return (
    <Collapsible
      ref={containerRef}
      open={open}
      onOpenChange={next => { setShowKey(false); onOpenChange(next) }}
      className="fp-card rr-block scroll-mt-20"
      aria-label={t('api.title')}
    >
      <div className="flex items-center min-h-[48px] px-2 sm:px-3 py-1 gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2.5 font-normal max-w-[140px] sm:max-w-[200px] shrink-0"
              disabled={disabled}
              aria-label={t('api.selectProfile')}
            >
              <span className="truncate">{activeProfileName}</span>
              <ChevronDown className="size-3.5 shrink-0 opacity-60" />
            </Button>
          } />
          <DropdownMenuContent align="start" className="min-w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('api.profiles')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={profileManager.activeId}
                onValueChange={id => {
                  setShowKey(false)
                  profileManager.select(id)
                }}
              >
                {profileManager.profiles.map(p => {
                  const label = p.name.trim() || p.model.trim() || t('api.defaultProfileName')
                  return (
                    <DropdownMenuRadioItem key={p.id} value={p.id} className="cursor-pointer">
                      <span className="truncate">{label}</span>
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                setShowKey(false)
                profileManager.create()
                onOpenChange(true)
                toast.success(t('api.profileCreated'))
              }}
              className="cursor-pointer"
            >
              <Plus className="size-4" />
              <span>{t('api.newProfile')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <CollapsibleTrigger
          className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 py-1.5 px-2 fp-mono text-sm rounded-md hover:bg-muted transition-colors cursor-pointer text-left"
          aria-label={`${t(open ? 'api.collapse' : 'api.expand')}: ${baseUrl}, ${model}`}
        >
          <span className="min-w-0 flex-1 truncate text-left" title={baseUrl}>{baseUrl}</span>
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">/</span>
          <span className="min-w-0 flex-1 truncate text-left" title={model}>{model}</span>
          <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="fp-api-content">
        <Separator />
        <FieldSet disabled={disabled} className="min-w-0 p-4 space-y-4" aria-label={t('api.title')}>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/70">
            <div className="flex flex-1 min-w-[220px] items-center gap-2">
              <FieldLabel htmlFor="api-profile-name" className="shrink-0 text-meta text-muted-foreground">
                {t('api.profileName')}
              </FieldLabel>
              <Input
                id="api-profile-name"
                className="h-8 max-w-xs text-sm"
                value={config.name}
                placeholder={config.model.trim() || t('api.profileNamePlaceholder')}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                onChange={e => profileManager.rename(config.id, e.target.value)}
                onBlur={() => profileManager.rename(config.id, config.name.trim())}
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Tooltip>
                <TooltipTrigger render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    disabled={disabled}
                    onClick={() => {
                      setShowKey(false)
                      profileManager.create()
                      toast.success(t('api.profileCreated'))
                    }}
                  >
                    <Plus className="size-3.5" />
                    <span>{t('api.newProfile')}</span>
                  </Button>
                } />
                <TooltipContent>{t('api.newProfileHelp')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    disabled={disabled}
                    onClick={() => {
                      setShowKey(false)
                      profileManager.duplicate(config.id, t('api.duplicateSuffix'))
                      toast.success(t('api.profileDuplicated'))
                    }}
                  >
                    <Copy className="size-3.5" />
                    <span className="hidden sm:inline">{t('api.duplicateProfile')}</span>
                  </Button>
                } />
                <TooltipContent>{t('api.duplicateProfileHelp')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    disabled={disabled || profileManager.profiles.length <= 1}
                    onClick={() => {
                      setShowKey(false)
                      profileManager.remove(config.id)
                      toast.success(t('api.profileDeleted'))
                    }}
                    aria-label={t('api.deleteProfile')}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                } />
                <TooltipContent>{t('api.deleteProfileHelp')}</TooltipContent>
              </Tooltip>
            </div>
          </div>

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
                  <TooltipTrigger render={<Button type="button" variant="outline" size="icon-lg" disabled={disabled} aria-label={t(showKey ? 'api.hideKey' : 'api.showKey')} aria-pressed={showKey} onClick={() => setShowKey(s => !s)} />}>
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
