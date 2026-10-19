import { useState } from 'react'
import { CloudUpload, FileCode2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { isLocalApiUrl } from '@fingerpoint/shared/api-url'
import { parseOrigins } from '../../../worker/main.js'
import workerConfig from '../../../worker/wrangler.json'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/segmented'
import { useI18n } from '@/i18n'
import { checkProxy, connectionSetting, parseProxyEndpoint, setConnectionSetting, type ConnectionSetting, type ProxyHealth } from '@/lib/route'
import { DEPLOY_BUTTON_URL, openWorkerPlayground } from '@/lib/worker-deploy'
import { cn } from '@/lib/utils'

/**
 * Chooses how runs reach the API: auto, direct, this site's proxy, or a Worker the user deployed from
 * `worker/main.js`. The choice is global, not part of a profile, because it describes the user's infrastructure.
 */
export function ProxySettings({ disabled, baseUrl }: { disabled: boolean; baseUrl: string }) {
  const { t } = useI18n()
  const [setting, setSetting] = useState(connectionSetting)
  const { mode, endpoint } = setting
  const [draft, setDraft] = useState(() => endpoint ?? '')
  const [touched, setTouched] = useState(false)
  const [health, setHealth] = useState<{ endpoint: string; result: ProxyHealth } | null>(null)
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const invalid = touched && draft.trim() !== '' && endpoint === null
  const allowed = parseOrigins(workerConfig.vars.ALLOWED_ORIGINS)
  const outsideDefault = !allowed.includes('*') && !allowed.includes(location.origin)
  let local = false
  try { local = isLocalApiUrl(new URL(baseUrl)) } catch { /* The API configuration validates the address. */ }

  function save(next: ConnectionSetting) {
    setSetting(next)
    setConnectionSetting(next)
  }

  /** An empty or invalid address clears the saved one, so no request goes to a stale Worker. */
  function edit(value: string) {
    setDraft(value)
    save({ mode: 'worker', endpoint: parseProxyEndpoint(value) })
  }

  async function check(endpoint: string) {
    setChecking(true)
    try { setHealth({ endpoint, result: await checkProxy(endpoint) }) } finally { setChecking(false) }
  }

  async function importPlayground() {
    setImporting(true)
    try {
      if (await openWorkerPlayground() === 'blocked') toast.error(t('proxy.popupBlocked'))
    } catch {
      toast.error(t('proxy.playgroundFailed'))
    } finally { setImporting(false) }
  }

  const result = endpoint !== null && health?.endpoint === endpoint ? health.result : null
  return (
    <Field className="md:col-span-2">
      <FieldTitle>{t('proxy.setting')}</FieldTitle>
      <Segmented label={t('proxy.setting')} value={local ? 'direct' : mode} disabled={disabled || local} onChange={next => save({ ...setting, mode: next })} options={[
        { value: 'auto', label: t('proxy.mode.auto') },
        { value: 'direct', label: t('proxy.mode.direct') },
        { value: 'site', label: t('proxy.mode.site') },
        { value: 'worker', label: t('proxy.mode.worker'), recommended: !local },
      ]} />
      <FieldDescription>{t(local ? 'proxy.localHelp' : `proxy.help.${mode}`)}</FieldDescription>
      {!local && mode === 'worker' && <>
        <Field data-invalid={invalid || undefined}>
          <FieldLabel htmlFor="proxy-worker-url">{t('proxy.workerUrl')}</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <Input
              id="proxy-worker-url"
              className="fp-mono h-9 min-w-0 flex-1 basis-64"
              value={draft}
              placeholder="https://fingerpoint-api-proxy.example.workers.dev"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? 'proxy-worker-error' : undefined}
              onChange={event => edit(event.target.value)}
              onBlur={() => { setTouched(true); setDraft(current => parseProxyEndpoint(current) ?? current.trim()) }}
            />
            <Button type="button" variant="outline" className="h-9" disabled={disabled || checking || endpoint === null} onClick={() => { if (endpoint) void check(endpoint) }}>
              {checking ? <><Loader2 data-icon="inline-start" className="animate-spin" />{t('proxy.checkingProxy')}</> : t('proxy.check')}
            </Button>
          </div>
          {invalid && <FieldError id="proxy-worker-error">{t('proxy.workerInvalid')}</FieldError>}
        </Field>
        <p role="status" aria-live="polite" className={cn('text-meta', result === 'ok' ? 'text-success' : 'text-muted-foreground', !result && 'sr-only')}>
          {result && t(`proxy.health.${result}`, { origin: location.origin })}
        </p>
        <div className="flex flex-col gap-2 rounded-lg border border-border/70 p-3">
          <p className="text-meta font-medium">{t('proxy.deployTitle')}</p>
          <div className="flex flex-wrap gap-2">
            <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={DEPLOY_BUTTON_URL} target="_blank" rel="noopener noreferrer" aria-describedby="proxy-deploy-help">
              <CloudUpload data-icon="inline-start" aria-hidden="true" />{t('proxy.deployButton')}
            </a>
            <Button type="button" variant="outline" size="sm" disabled={disabled || importing} onClick={() => { void importPlayground() }} aria-describedby="proxy-playground-help">
              {importing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FileCode2 data-icon="inline-start" aria-hidden="true" />}{t('proxy.playground')}
            </Button>
          </div>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-meta text-muted-foreground">
            <li id="proxy-deploy-help">{t('proxy.deployButtonHelp')}</li>
            <li id="proxy-playground-help">{t('proxy.playgroundHelp')}</li>
            {outsideDefault && <li>{t('proxy.originHint', { allowed: allowed.join(', '), origin: location.origin })}</li>}
          </ul>
        </div>
      </>}
    </Field>
  )
}
