import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, Copy, Loader2, MoreVertical, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ApiConfigPanel } from '@/components/api-config-panel'
import { Segmented } from '@/components/segmented'
import { useLoadedBank } from '@/lib/bank-context'
import { ResultPanel } from '@/components/result-panel'
import { SampleCard, SampleStrip, isBusyState, type Mode, type SampleUI } from '@/components/sample-card'
import { useI18n } from '@/i18n'
import * as client from '@/lib/client'
import { configComplete, useApiConfig, type WebApiConfig } from '@/lib/config'
import { describeError } from '@/lib/errors'
import { exportResultImage } from '@/lib/export-image'
import { useMotionPreset } from '@/lib/motion'
import { useModelMatchCelebration } from '@/lib/use-model-match-celebration'
import { cn } from '@/lib/utils'
import type { Analysis, Challenge, CodedError, CollectionProgress } from '@fingerpoint/shared/types'
import { redactPrivateMetadata } from '@fingerpoint/shared/privacy'

type Phase = 'edit' | 'sampling' | 'computing' | 'result'
const idle = (): SampleUI => ({ text: '', state: 'idle' })
const cliCommand = 'bunx lmfpd@latest --help'
type Run = { controller: AbortController; indexes: number[] }

function safeError(message: string | undefined, key: string): string | undefined {
  if (!message) return undefined
  const redacted = key ? message.replaceAll(key, '[REDACTED]') : message
  return redactPrivateMetadata(redacted
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[\w-]+/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|authorization|access_token|refresh_token)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[REDACTED]'))
}

export default function DetectRoute() {
  const bank = useLoadedBank()
  const i18n = useI18n()
  const { t } = i18n
  const { snappy, reduced } = useMotionPreset()
  const active = useLocation().pathname === '/'
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>(() => params.get('mode') === 'api' ? 'api' : 'manual')
  useEffect(() => {
    if (active && (params.get('mode') === 'api') !== (mode === 'api')) {
      setParams(mode === 'api' ? { mode: 'api' } : {}, { replace: true })
    }
  }, [active, mode, params, setParams])

  const [challenges, setChallenges] = useState<Challenge[]>(() => client.generateChallenges(3))
  const [samples, setSamples] = useState<SampleUI[]>(() => [idle(), idle(), idle()])
  const [phase, setPhase] = useState<Phase>('edit')
  const [result, setResult] = useState<Analysis | null>(null)
  const [resultModel, setResultModel] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [config, update, profileManager] = useApiConfig(() => toast.error(t('errors.unknown')))
  const previousProfileId = useRef(profileManager.activeId)
  const [apiConfigOpen, setApiConfigOpen] = useState(() => !configComplete(config))
  const apiConfigRef = useRef<HTMLDivElement>(null)
  const activeRun = useRef<Run | null>(null)
  const mounted = useRef(true)
  const samplesRef = useRef(samples)
  const sampledConfigs = useRef<(WebApiConfig | undefined)[]>([])
  const resultRef = useRef(result)
  useLayoutEffect(() => {
    if (previousProfileId.current === profileManager.activeId) return
    previousProfileId.current = profileManager.activeId
    restart()
  }, [profileManager.activeId])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const run = activeRun.current
      activeRun.current = null
      run?.controller.abort()
    }
  }, [])

  const filled = samples.filter(s => s.text.trim()).length
  const locked = phase === 'sampling' || phase === 'computing'
  const canSample = configComplete(config) && !locked
  useModelMatchCelebration(result, resultModel, active && mode === 'api' && phase === 'result')

  function replaceSamples(next: SampleUI[]) {
    samplesRef.current = next
    setSamples(next)
  }

  function patch(index: number, changes: Partial<SampleUI>) {
    replaceSamples(samplesRef.current.map((sample, i) => i === index ? { ...sample, ...changes } : sample))
  }

  function clearResult() {
    resultRef.current = null
    setResult(null)
  }

  function stop() {
    const run = activeRun.current
    if (!run) return
    activeRun.current = null
    run.controller.abort()
    replaceSamples(samplesRef.current.map((sample, i) => run.indexes.includes(i) && isBusyState(sample.state)
      ? { ...sample, state: 'stopped', draftText: sample.text.trim() ? undefined : sample.draftText, errorCode: undefined, errorText: undefined }
      : sample))
    setPhase(resultRef.current ? 'result' : 'edit')
  }

  useEffect(() => {
    if (!active) {
      stop()
      setErrorDetail(null)
    }
  }, [active])

  async function sampleIndexes(indexes: number[], requestConfig: WebApiConfig = config) {
    if (!indexes.length || activeRun.current || !mounted.current) return
    if (!configComplete(requestConfig)) {
      setApiConfigOpen(true)
      requestAnimationFrame(() => {
        const inputs = apiConfigRef.current?.querySelectorAll<HTMLInputElement>('[data-api-required]')
        Array.from(inputs ?? []).find(input => !input.value.trim())?.focus()
      })
      toast.error(t('api.incomplete'))
      return
    }
    const frozenConfig = { ...requestConfig, parallel: indexes.length > 1 && (requestConfig.parallel ?? false) }
    const run: Run = { controller: new AbortController(), indexes: [...indexes] }
    activeRun.current = run
    const current = () => mounted.current && activeRun.current === run && !run.controller.signal.aborted
    const startedAt = new Map<number, number>()
    const accepted = new Set<number>()
    setPhase('sampling')
    replaceSamples(samplesRef.current.map((sample, i) => indexes.includes(i)
      ? { ...sample, draftText: '', state: 'pending', errorCode: undefined, httpStatus: undefined, errorText: undefined, elapsedMs: undefined }
      : sample))

    function applyProgress(progress: CollectionProgress) {
      if (!current() || !progress.challenges) return
      progress.challenges.forEach((challenge, k) => {
        const index = indexes[k]
        if (index === undefined || accepted.has(index)) return
        const state = challenge.state ?? 'pending'
        if (state === 'requesting' && !startedAt.has(index)) startedAt.set(index, performance.now())
        const finished = state === 'done' || state === 'rejected'
        const elapsedMs = finished && startedAt.has(index) ? performance.now() - startedAt.get(index)! : undefined
        if (state === 'done' && challenge.text.trim()) {
          accepted.add(index)
          sampledConfigs.current[index] = frozenConfig
          patch(index, { text: challenge.text, draftText: undefined, state, elapsedMs, errorCode: undefined, httpStatus: undefined, errorText: undefined })
          clearResult()
        } else {
          const previous = samplesRef.current[index]
          patch(index, {
            draftText: state === 'rejected' && previous.text.trim() ? undefined : challenge.text,
            state, elapsedMs,
            errorCode: state === 'rejected' ? challenge.errorCode : undefined,
            httpStatus: state === 'rejected' ? challenge.httpStatus : undefined,
            errorText: state === 'rejected' ? safeError(challenge.error, frozenConfig.apiKey) : undefined,
          })
        }
      })
    }

    try {
      await client.testApi(frozenConfig, indexes.map(i => challenges[i]), applyProgress, run.controller.signal)
    } catch (error) {
      if (!current()) return
      const coded = error as CodedError
      replaceSamples(samplesRef.current.map((sample, i) => indexes.includes(i) && isBusyState(sample.state)
        ? { ...sample, state: 'rejected', draftText: sample.text.trim() ? undefined : sample.draftText, errorCode: coded?.code, httpStatus: coded?.httpStatus, errorText: safeError(error instanceof Error ? error.message : undefined, frozenConfig.apiKey) }
        : sample))
    }
    if (!current()) return
    activeRun.current = null
    setPhase(resultRef.current ? 'result' : 'edit')
    if (frozenConfig.autoVerify && accepted.size === indexes.length && samplesRef.current.every(sample => sample.text.trim())) {
      void verify()
    }
  }

  async function verify() {
    if (activeRun.current || !mounted.current || !samplesRef.current.some(sample => sample.text.trim())) return
    const run: Run = { controller: new AbortController(), indexes: [] }
    activeRun.current = run
    const outputs = samplesRef.current.map((sample, i) => ({ text: sample.text, expected_count: challenges[i].expected_count }))
    setPhase('computing')
    setExpanded(null)
    try {
      const analysis = await client.analyze(outputs, bank)
      if (!mounted.current || activeRun.current !== run) return
      resultRef.current = analysis
      setResultModel(mode === 'api' ? config.model : null)
      setResult(analysis)
      setPhase('result')
    } catch (error) {
      if (!mounted.current || activeRun.current !== run) return
      toast.error(describeError(i18n, error, 'errors.analyze'))
      setPhase(resultRef.current ? 'result' : 'edit')
    } finally {
      if (activeRun.current === run) activeRun.current = null
    }
  }

  function restart() {
    stop()
    setChallenges(client.generateChallenges(3))
    replaceSamples([idle(), idle(), idle()])
    sampledConfigs.current = []
    clearResult()
    setExpanded(null)
    setPhase('edit')
  }

  function edit(i: number, text: string) {
    if (activeRun.current) return
    patch(i, { text, draftText: undefined, state: 'idle', errorCode: undefined, httpStatus: undefined, errorText: undefined, elapsedMs: undefined })
    clearResult()
    setPhase('edit')
  }

  async function saveImage() {
    if (!result) return
    try { await exportResultImage(result, i18n); if (mounted.current) toast.success(t('detect.imageSaved')) }
    catch { if (mounted.current) toast.error(t('detect.imageFailed')) }
  }

  async function copyCliCommand() {
    try {
      await navigator.clipboard.writeText(cliCommand)
      toast.success(t('detect.cliCopied'))
    } catch {
      toast.error(t('detect.cliCopyFailed'))
    }
  }

  const emptyIndexes = samples.map((s, i) => (s.text.trim() ? -1 : i)).filter(i => i >= 0)
  const showStrip = phase === 'computing' || phase === 'result'

  function collapseSample(index: number) {
    setExpanded(null)
    document.getElementById(`sample-trigger-${index}`)?.focus({ preventScroll: true })
  }

  function renderSample(index: number, collapsible = false) {
    return <SampleCard
      key={challenges[index].id}
      index={index}
      challenge={challenges[index]}
      sample={samples[index]}
      mode={mode}
      canSample={canSample}
      locked={locked}
      onChange={text => edit(index, text)}
      onResample={() => sampleIndexes([index], sampledConfigs.current[index] ?? config)}
      onStop={stop}
      onShowError={() => setErrorDetail(samples[index].errorText ?? null)}
      onCollapse={collapsible ? () => collapseSample(index) : undefined}
    />
  }

  return (
    <div className={cn('fp-page', 'has-actionbar')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1">{t('detect.title')}</h1>
        <Segmented label={t('detect.modeLabel')} value={mode} onChange={m => { if (!activeRun.current) setMode(m) }} disabled={locked} options={[{ value: 'manual', label: t('detect.modeManual') }, { value: 'api', label: t('detect.modeApi') }]} />
      </div>

      <aside className="fp-cli-promo" aria-label={t('detect.cliTitle')}>
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <strong className="shrink-0 font-medium">{t('detect.cliTitle')}</strong>
          <span className="text-muted-foreground">{t('detect.cliDescription')}</span>
        </div>
        <button type="button" className="fp-cli-command" onClick={copyCliCommand} aria-label={t('detect.cliCopy', { command: cliCommand })} title={t('detect.cliCopy', { command: cliCommand })}>
          <code className="fp-mono text-meta"><span>bunx</span> lmfpd@latest <span>--help</span></code>
          <Copy className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <a href="https://github.com/Ikaleio/lm-detector#%E6%A3%80%E6%B5%8B-cli" target="_blank" rel="noopener noreferrer" className="fp-cli-link">
          <span className="sm:hidden">{t('detect.cliGuideShort')}</span>
          <span className="hidden sm:inline">{t('detect.cliGuide')}</span>
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
      </aside>

      <AnimatePresence initial={false}>
        {mode === 'api' && <motion.div
          key="api-configuration"
          initial={{ height: 0, opacity: 0, marginBottom: -24 }}
          animate={{ height: 'auto', opacity: 1, marginBottom: 0 }}
          exit={{ height: 0, opacity: 0, marginBottom: -24 }}
          transition={snappy}
          className="shrink-0 overflow-hidden"
        >
          <ApiConfigPanel containerRef={apiConfigRef} open={apiConfigOpen} onOpenChange={setApiConfigOpen} config={config} update={update} profileManager={profileManager} disabled={locked} />
        </motion.div>}
      </AnimatePresence>

      <section className="flex flex-col gap-4" aria-label={t('detect.samples')}>
        {showStrip && <SampleStrip samples={samples} challenges={challenges} expanded={expanded} onToggle={i => setExpanded(e => (e === i ? null : i))} />}
        {showStrip ? (
          <AnimatePresence initial={false}>
            {expanded !== null && <motion.div
              key="sample-details"
              initial={{ height: 0, opacity: 0, marginTop: -16 }}
              animate={{ height: 'auto', opacity: 1, marginTop: 0 }}
              exit={{ height: 0, opacity: 0, marginTop: -16 }}
              transition={reduced ? { duration: 0 } : snappy}
              className="overflow-hidden"
            >
              {renderSample(expanded, true)}
            </motion.div>}
          </AnimatePresence>
        ) : <div className="fp-grid-samples">{challenges.map((_, index) => renderSample(index))}</div>}
      </section>

      {phase === 'computing' && (
        <div className="flex h-12 items-center gap-2 text-body text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" />
          {t('detect.computing')}
        </div>
      )}
      {phase === 'result' && result && <ResultPanel result={result} />}

      <div className="fp-actionbar">
        {phase === 'result' ? (
          <>
            {result && <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-lg" aria-label={t('detect.more')} />}><MoreVertical /></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => client.exportAnalysis(result)}>{t('detect.exportJson')}</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
            </DropdownMenu>}
            <Button variant="outline" className="h-9" onClick={saveImage}>{t('detect.saveImage')}</Button>
            <Button className="h-9" onClick={restart}>{t('detect.restart')}</Button>
          </>
        ) : phase === 'sampling' ? (
          <>
            <Button variant="outline" className="h-9" onClick={stop}>{t('detect.stop')}</Button>
            <Button className="h-9" disabled><Loader2 data-icon="inline-start" className="animate-spin" />{t('detect.sampling')}</Button>
          </>
        ) : phase === 'computing' ? (
          <Button className="h-9" disabled><Loader2 data-icon="inline-start" className="animate-spin" />{t('detect.computing')}</Button>
        ) : (
          <>
            {samples.some(s => s.text.trim() || s.draftText?.trim()) && <Button variant="ghost" className="h-9" onClick={restart}>{t('detect.restart')}</Button>}
            {mode === 'api' && emptyIndexes.length > 0 ? (
              <>
                {filled > 0 && <Button variant="outline" className="h-9" onClick={() => verify()}>{t('detect.verifyPartial', { n: filled })}</Button>}
                <Button className="h-9" onClick={() => sampleIndexes(emptyIndexes)}>{t('detect.startSampling')}</Button>
              </>
            ) : (
              <Button className="h-9" disabled={filled === 0} onClick={() => verify()}>{filled === 0 ? t('detect.verifyLocked') : filled < 3 ? t('detect.verifyPartial', { n: filled }) : t('detect.verify')}</Button>
            )}
          </>
        )}
      </div>

      <Dialog open={active && errorDetail !== null} onOpenChange={open => !open && setErrorDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('detect.errorDetails')}</DialogTitle>
            <DialogDescription className="sr-only">{t('detect.errorDetails')}</DialogDescription>
          </DialogHeader>
          <pre tabIndex={0} className="fp-mono rr-mask max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-meta [overflow-wrap:anywhere]">{errorDetail ?? ''}</pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
