import { useCallback, useEffect, useRef, useState, type Ref } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Copy, Download, Eye, EyeOff, FolderOpen, Pencil, Play, Plus, RefreshCw, Save, Search, Settings2, Trash2 } from 'lucide-react'
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
import { BrandIcon } from '@/components/brand-icon'
import { useI18n } from '@/i18n'
import type { ApiProfile, ApiProfileManager, WebApiConfig } from '@/lib/config'
import { readProfileFile, saveProfileFile } from '@/lib/profile-file'
import { ProxySettings } from '@/components/proxy-settings'
import { cn } from '@/lib/utils'
import { useMotionPreset } from '@/lib/motion'
import { TOKENIZER_MODEL } from '@fingerpoint/shared/tokenizer-posterior'
import { serviceTierField } from '@fingerpoint/shared/completion-request'
import { listModels } from '@/lib/client'

const placeholders: Record<WebApiConfig['format'], string> = {
  openai: 'https://api.openai.com/v1',
  responses: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
}
const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const MotionButton = motion.create(Button)

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
  onStartSampling?: () => void
}

export function ApiConfigPanel({ open, onOpenChange, config, update, profileManager, disabled, containerRef, onStartSampling }: Props) {
  const { t } = useI18n()
  const { reduced, snappy } = useMotionPreset()
  const [showKey, setShowKey] = useState(false)
  const profileNameRef = useRef<HTMLInputElement>(null)
  const profileFileRef = useRef<HTMLInputElement>(null)
  const [models, setModels] = useState<string[] | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelsFetchSeq = useRef(0)
  const modelFieldRef = useRef<HTMLDivElement>(null)
  const baseUrl = config.baseUrl.trim() || t('api.baseUrlMissing')
  const model = config.model.trim() || t('api.modelMissing')
  const activeProfileName = config.name.trim() || config.model.trim() || t('api.defaultProfileName')

  async function loadProfile(file: File | undefined) {
    if (!file) return
    try {
      const { name, config: loaded } = await readProfileFile(file)
      setShowKey(false)
      profileManager.create(name, loaded)
      onOpenChange(true)
      toast.success(t('api.profileLoaded'))
    } catch {
      toast.error(t('api.profileLoadFailed'))
    }
  }

  function saveProfile() {
    profileManager.markSaved(config)
    toast.success(t('api.profileSaved'))
  }

  const fetchModels = useCallback(async () => {
    if (disabled) return
    const seq = ++modelsFetchSeq.current
    setModelsLoading(true)
    setModelsError(false)
    try {
      const found = await listModels(config)
      if (seq !== modelsFetchSeq.current) return
      setModels(found)
    } catch {
      if (seq !== modelsFetchSeq.current) return
      setModelsError(true)
      setModels(null)
    } finally {
      if (seq === modelsFetchSeq.current) setModelsLoading(false)
    }
  }, [config, disabled])

  // Automatically fetch the model list once the base URL and key are present, and again when either changes.
  const canFetch = Boolean(config.baseUrl.trim() && config.apiKey.trim())
  useEffect(() => {
    if (!canFetch) { setModels(null); setModelsError(false); return }
    const timer = setTimeout(() => { void fetchModels() }, 400)
    return () => clearTimeout(timer)
  }, [config.baseUrl, config.apiKey, config.format, canFetch, fetchModels])

  // Close the model menu on outside click.
  useEffect(() => {
    if (!modelMenuOpen) return
    const onDown = (event: MouseEvent) => {
      if (modelFieldRef.current && !modelFieldRef.current.contains(event.target as Node)) setModelMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [modelMenuOpen])

  const filteredModels = (models ?? []).filter(name => name.toLowerCase().includes(config.model.trim().toLowerCase()))

  async function exportProfile() {
    try {
      const result = await saveProfileFile(config, activeProfileName)
      toast.success(t(result === 'saved' ? 'api.profileExported' : 'api.profileDownloadStarted'))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.error(t('api.profileExportFailed'))
    }
  }

  return (
    <Collapsible
      ref={containerRef}
      open={open}
      onOpenChange={next => { setShowKey(false); onOpenChange(next) }}
      className="fp-card rr-block scroll-mt-20"
      aria-label={t('api.title')}
    >
      <input
        ref={profileFileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={event => {
          void loadProfile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <div className="flex items-center min-h-[48px] px-2 sm:px-3 py-1 gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <MotionButton
              type="button"
              variant="outline"
              size={profileManager.isActiveDirty ? 'icon-sm' : 'sm'}
              layout="size"
              transition={snappy}
              className={cn(
                'h-8 shrink-0 overflow-hidden font-normal',
                profileManager.isActiveDirty ? 'w-8' : 'gap-1.5 px-2.5 max-w-[140px] sm:max-w-[200px]',
              )}
              disabled={disabled}
              aria-label={t(profileManager.isActiveDirty ? 'api.selectProfileDirty' : 'api.selectProfile')}
              title={profileManager.isActiveDirty ? t('api.selectProfileDirty') : undefined}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {profileManager.isActiveDirty
                  ? <motion.span key="dirty" initial={reduced ? false : { opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={snappy} className="flex items-center justify-center">
                      <Settings2 className="size-4" aria-hidden="true" />
                    </motion.span>
                  : <motion.span key="named" initial={reduced ? false : { opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={snappy} className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{activeProfileName}</span>
                      <ChevronDown className="size-3.5 shrink-0 opacity-60" />
                    </motion.span>}
              </AnimatePresence>
            </MotionButton>
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
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  onOpenChange(true)
                  requestAnimationFrame(() => {
                    profileNameRef.current?.focus()
                    profileNameRef.current?.select()
                  })
                }}
                className="cursor-pointer"
              >
                <Pencil className="size-4" />
                <span>{t('api.renameProfile')}</span>
              </DropdownMenuItem>
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
              <DropdownMenuItem onClick={() => profileFileRef.current?.click()} className="cursor-pointer">
                <FolderOpen className="size-4" />
                <span>{t('api.loadProfile')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={saveProfile} className="cursor-pointer">
                <Save className="size-4" />
                <span>{t('api.saveProfile')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { void exportProfile() }} className="cursor-pointer">
                <Download className="size-4" />
                <span>{t('api.exportProfile')}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
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
            <div className="flex flex-1 min-w-[220px] flex-col gap-1">
              <div className="flex items-center gap-2">
                <FieldLabel htmlFor="api-profile-name" className="shrink-0 text-meta text-muted-foreground">
                  {t('api.profileName')}
                </FieldLabel>
                <Input
                  ref={profileNameRef}
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
              <p className="text-xs text-muted-foreground">{t('api.profileStorageHelp')}</p>
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
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    disabled={disabled}
                    onClick={saveProfile}
                  >
                    <Save className="size-3.5" />
                    <span>{t('api.saveProfile')}</span>
                  </Button>
                } />
                <TooltipContent>{t('api.saveProfileHelp')}</TooltipContent>
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
              <div ref={modelFieldRef} className="relative">
                <div className="flex gap-2">
                  <Input id="api-model" data-api-required className="fp-mono h-9 min-w-0 flex-1" value={config.model} placeholder={t('api.modelPlaceholder')} autoComplete="off" spellCheck={false} onChange={e => update({ model: e.target.value })} onFocus={() => setModelMenuOpen(true)} onBlur={() => update({ model: config.model.trim() })} />
                  <Tooltip>
                    <TooltipTrigger render={<Button type="button" variant="outline" size="icon-lg" className="h-9 w-9 shrink-0" disabled={disabled || !canFetch} onClick={() => void fetchModels()} aria-label={t('api.modelsRefresh')}><RefreshCw className={cn('size-4', modelsLoading && 'animate-spin')} aria-hidden="true" /></Button>} />
                    <TooltipContent>{t('api.modelsRefresh')}</TooltipContent>
                  </Tooltip>
                  {onStartSampling && (
                    <Button type="button" className="h-9 shrink-0 gap-1.5" disabled={disabled || !config.model.trim()} onClick={onStartSampling}>
                      <Play className="size-3.5" aria-hidden="true" />
                      <span>{t('detect.startSampling')}</span>
                    </Button>
                  )}
                </div>
                {modelMenuOpen && (
                  <div className="fp-model-menu absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                    {modelsLoading ? (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
                        <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                        {t('api.modelsFetching')}
                      </div>
                    ) : modelsError ? (
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm text-muted-foreground">
                        <span>{t('api.modelsFailed')}</span>
                        <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => void fetchModels()}>{t('app.retry')}</Button>
                      </div>
                    ) : filteredModels.length === 0 ? (
                      <div className="px-3 py-2.5 text-sm text-muted-foreground">{t('api.modelsEmpty')}</div>
                    ) : (
                      <>
                        <div className="max-h-64 overflow-y-auto p-1" role="listbox" aria-label={t('api.model')}>
                          {filteredModels.slice(0, 100).map(name => (
                            <button
                              key={name}
                              type="button"
                              role="option"
                              aria-selected={name === config.model.trim()}
                              className={cn('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted', name === config.model.trim() && 'text-primary')}
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => { update({ model: name }); setModelMenuOpen(false) }}
                            >
                              <span className="fp-mono min-w-0 flex-1 truncate" title={name}>{name}</span>
                            </button>
                          ))}
                        </div>
                        {(models?.length ?? 0) > 100 && (
                          <div className="border-t border-border/70 px-3 py-1.5 text-xs text-muted-foreground">
                            {t('api.modelsCount', { n: models?.length ?? 0 })} · {t('api.modelsSearch')}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
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
            <Field>
              <FieldLabel>{t('api.format')}</FieldLabel>
              <Segmented label={t('api.format')} value={config.format} disabled={disabled} onChange={format => update({ format })} options={[
                { value: 'openai', label: t('api.formatChat'), icon: <BrandIcon family="gpt" /> },
                { value: 'responses', label: t('api.formatResponses'), icon: <BrandIcon family="gpt" /> },
                { value: 'anthropic', label: t('api.formatMessages'), icon: <BrandIcon family="claude" /> },
              ]} />
            </Field>
            <Field>
              <FieldLabel>{t('api.serviceTier')}</FieldLabel>
              <Segmented label={t('api.serviceTier')} value={config.serviceTier} disabled={disabled} onChange={serviceTier => update({ serviceTier })} options={[
                { value: 'flex', label: 'Flex' },
                { value: 'default', label: t('api.serviceTierDefault') },
                { value: 'fast', label: 'Fast' },
                { value: 'ultrafast', label: 'Ultrafast' },
              ]} />
              <FieldDescription>
                {config.serviceTier === 'default' ? t('api.serviceTierDefaultHelp')
                  : t(config.format === 'anthropic' ? 'api.serviceTierSpeedHelp' : 'api.serviceTierHelp', { field: serviceTierField(config.format), tier: config.serviceTier })}
              </FieldDescription>
            </Field>
          </FieldGroup>
          <Separator />
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <SwitchRow id="api-stream" label={t('api.stream')} help={t('api.streamHelp')} checked={config.stream ?? true} onChange={stream => update({ stream })} disabled={disabled} />
            <SwitchRow id="api-parallel" label={t('api.parallel')} help={t(config.tokenizerProbe ? 'api.parallelProbeHelp' : 'api.parallelHelp')} checked={config.parallel ?? true} onChange={parallel => update({ parallel })} disabled={disabled} />
            <SwitchRow id="api-relaxed" label={t('api.relaxed')} help={t('api.relaxedHelp')} checked={config.relaxed} onChange={relaxed => update({ relaxed })} disabled={disabled} />
            <SwitchRow id="api-auto" label={t('api.autoVerify')} checked={config.autoVerify} onChange={autoVerify => update({ autoVerify })} disabled={disabled} />
            <SwitchRow id="api-tokenizer" label={t('api.tokenizerProbe')} help={t('api.tokenizerProbeHelp', { max: TOKENIZER_MODEL.maximumProbes + 2 })} checked={config.tokenizerProbe} onChange={tokenizerProbe => update({ tokenizerProbe })} disabled={disabled} />
          </FieldGroup>
          <Separator />
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <ProxySettings disabled={disabled} />
          </FieldGroup>
        </FieldSet>
      </CollapsibleContent>
    </Collapsible>
  )
}
