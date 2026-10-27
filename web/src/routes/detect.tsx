import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, ArrowUpRight, Check, Copy, Fingerprint, Loader2, RefreshCw, ShieldCheck, Star, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ApiConfigPanel } from '@/components/api-config-panel'
import { PixelShader, PixelSpinner } from '@/components/pixel-shader'
import { downloadBytes, downloadFraction, ProgressCells } from '@/components/detector-progress'
import { useDetectorDownload } from '@/lib/detector'
import { BrandIcon } from '@/components/brand-icon'
import { ProbeDrawer } from '@/components/scanner/ProbeDrawer'
import { ApiConnectionFields, ModeSwitch, ScanSummary } from '@/components/scanner/ScannerPanels'
import { PRINT_SECONDS, SCAN_SECONDS, resolveBrand, type MotionState, type Phase as ScenePhase, type SceneResult } from '@/components/scanner/model'
import { useLoadedBank } from '@/lib/bank-context'
import { ResultPanel } from '@/components/result-panel'
import { isBusyState, type Mode, type SampleUI } from '@/components/sample-card'
import { TokenizerCard, TokenizerDetails, TokenizerStripButton } from '@/components/tokenizer-panel'
import { useI18n } from '@/i18n'
import * as client from '@/lib/client'
import { configComplete, useApiConfig, type WebApiConfig } from '@/lib/config'
import { describeError } from '@/lib/errors'
import { exportResultImage } from '@/lib/export-image'
import { useMotionPreset } from '@/lib/motion'
import { useModelMatchCelebration } from '@/lib/use-model-match-celebration'
import { trackDetection } from '@/lib/telemetry'
import { useTokenizerProbe } from '@/lib/use-tokenizer-probe'
import { useConnectionRoute } from '@/lib/use-connection-route'
import { docsHref } from '@/lib/docs'
import { markStarVisited, REPOSITORY_URL, starPromptAllowed } from '@/lib/star'
import { toastWithStar } from '@/components/star-prompt'
import { cn } from '@/lib/utils'
import type { Analysis, Challenge, CodedError, CollectionProgress } from '@fingerpoint/shared/types'
import { redactPrivateMetadata } from '@fingerpoint/shared/privacy'
import { anomalousSamples } from '@fingerpoint/shared/sample-distribution'

type Phase = 'edit' | 'sampling' | 'computing' | 'result'
/** A sample index, or the tokenizer probe in the fourth slot of the sample strip. */
type Expanded = number | 'tokenizer' | null
const idle = (): SampleUI => ({ text: '', state: 'idle' })
const cliCommand = 'bunx lmfpd@latest --help'
const MotionRefresh = motion.create(RefreshCw)
// three.js loads with the detect page only, after the form is usable.
const ScannerScene = lazy(() => import('@/components/scanner/ScannerScene'))

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
  const { t, percent } = i18n
  const { snappy, smooth, reduced } = useMotionPreset()
  const active = useLocation().pathname === '/'
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>(() => params.get('mode') === 'api' ? 'api' : 'manual')
  useEffect(() => {
    if (active && (params.get('mode') === 'api') !== (mode === 'api')) {
      setParams(mode === 'api' ? { mode: 'api' } : {}, { replace: true })
    }
  }, [active, mode, params, setParams])
  const tokenizer = useTokenizerProbe()
  const connection = useConnectionRoute()
  const detectorDownload = useDetectorDownload()
  const detectorFraction = downloadFraction(detectorDownload)
  const detectorBytes = downloadBytes(detectorDownload, t)

  const [challenges, setChallenges] = useState<Challenge[]>(() => client.generateChallenges(3))
  const [samples, setSamples] = useState<SampleUI[]>(() => [idle(), idle(), idle()])
  const [computing, setComputing] = useState(false)
  const [result, setResult] = useState<Analysis | null>(null)
  const [resultModel, setResultModel] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Expanded>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  /** Turns the rotate icon half a turn per rotation. */
  const [rotations, setRotations] = useState(0)
  const askedStar = useRef(false)
  const [config, update, profileManager] = useApiConfig(() => toast.error(t('errors.unknown')))
  const previousProfileId = useRef(profileManager.activeId)
  /** The full API configuration opens in a dialog; the form keeps its one-line summary. */
  const [apiConfigOpen, setApiConfigOpen] = useState(false)
  const apiConfigRef = useRef<HTMLDivElement>(null)
  /** One controller per running sample, so each card starts and stops on its own. */
  const runs = useRef(new Map<number, AbortController>())
  const verifying = useRef<object | null>(null)
  /** Changes when everything stops, the page restarts or a verification begins; a run waiting for its route then does not start. */
  const generation = useRef(0)
  const mounted = useRef(true)
  const samplesRef = useRef(samples)
  const challengesRef = useRef(challenges)
  /** The configuration of the last reply the API returned for each index, so a resample asks the same endpoint. */
  const sampled = useRef<(WebApiConfig | undefined)[]>([])
  useLayoutEffect(() => {
    if (previousProfileId.current === profileManager.activeId) return
    previousProfileId.current = profileManager.activeId
    restart()
  }, [profileManager.activeId])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const controller of runs.current.values()) controller.abort()
      runs.current.clear()
    }
  }, [])

  const filled = samples.filter(s => s.text.trim()).length
  const sampling = samples.some(sample => isBusyState(sample.state))
  const phase: Phase = computing ? 'computing' : sampling ? 'sampling' : result ? 'result' : 'edit'
  const locked = sampling || computing || connection.checking
  const canSample = configComplete(config) && !computing && !connection.checking
  const probeShown = mode === 'api' && tokenizer.session.phase !== 'idle'

  /** The model typed in manual mode only labels the bench and the summary; it is never sent. */
  const [declaredModel, setDeclaredModel] = useState('')
  /** The focused question card lights its lamp on the bench; -1 is the model field. */
  const [focus, setFocus] = useState<number | null>(null)
  const stageRef = useRef<HTMLElement>(null)
  const reportRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const sceneModel = mode === 'api' ? config.model : declaredModel
  const modelBrand = resolveBrand(sceneModel, bank)
  const sceneFilled = samples.map(sample => Boolean(sample.text.trim())) as [boolean, boolean, boolean]
  const sceneMotion = useRef<MotionState>({ scan: 0, print: 0, phase: 'editing' })
  const [scenePhase, setScenePhase] = useState<ScenePhase>('editing')
  const scanStartedAt = useRef(0)
  function moveScene(next: ScenePhase) {
    sceneMotion.current.phase = next
    setScenePhase(next)
  }
  // The bench scans while replies arrive and scoring runs. A result prints only after the full sweep, then the report opens.
  useEffect(() => {
    if (phase === 'sampling' || phase === 'computing' || (phase === 'result' && scenePhase === 'editing')) {
      if (scenePhase === 'editing' || scenePhase === 'report') {
        scanStartedAt.current = performance.now()
        moveScene('scanning')
      }
      return
    }
    if (phase === 'edit') {
      if (scenePhase !== 'editing') moveScene('editing')
      return
    }
    if (scenePhase === 'scanning') {
      const handle = setTimeout(() => moveScene('printing'), reduced ? 0 : Math.max(0, SCAN_SECONDS * 1000 - (performance.now() - scanStartedAt.current)))
      return () => clearTimeout(handle)
    }
    if (scenePhase === 'printing') {
      const handle = setTimeout(() => moveScene('report'), reduced ? 0 : PRINT_SECONDS * 1000)
      return () => clearTimeout(handle)
    }
  }, [phase, scenePhase, reduced])
  // Once the report unfolds, bring it into view below the bench.
  useEffect(() => {
    if (scenePhase !== 'report') return
    const handle = setTimeout(() => {
      const top = reportRef.current?.getBoundingClientRect().top
      if (top === undefined || top < window.innerHeight * 0.6) return
      window.scrollTo({ top: Math.max(0, window.scrollY + top - Math.min(window.innerHeight * 0.43, 380)), behavior: reduced ? 'auto' : 'smooth' })
    }, reduced ? 0 : 700)
    return () => clearTimeout(handle)
  }, [scenePhase, reduced])
  const sceneResult = useMemo<SceneResult | null>(() => {
    if (!result) return null
    const top = result.results[0]
    const scorable = result.decision !== 'not_model' && result.decision !== 'unscorable' && top
    return {
      best: scorable ? { id: top.family, name: top.display_name } : { id: 'neutral', name: t(result.decision === 'not_model' ? 'detect.notModel' : 'detect.unscorable') },
      title: t('detect.topLabel'),
      detail: scorable && top.probability !== null ? percent(top.probability) : '',
    }
  }, [result, t, percent])
  useModelMatchCelebration(result, resultModel, active && mode === 'api' && scenePhase === 'report')

  function replaceSamples(next: SampleUI[]) {
    samplesRef.current = next
    setSamples(next)
  }

  function replaceChallenges(next: Challenge[]) {
    challengesRef.current = next
    setChallenges(next)
  }

  function patch(index: number, changes: Partial<SampleUI>) {
    replaceSamples(samplesRef.current.map((sample, i) => i === index ? { ...sample, ...changes } : sample))
  }

  /**
   * Stops the given samples, or all of them; other samples keep running.
   * Stopping all of them also stops the tokenizer probe, which serves every sample.
   */
  function stop(indexes?: number[]) {
    if (!indexes) {
      generation.current++
      tokenizer.stop()
    }
    const stopped = (indexes ?? [...runs.current.keys()]).filter(i => runs.current.has(i))
    if (!stopped.length) return
    for (const i of stopped) {
      runs.current.get(i)!.abort()
      runs.current.delete(i)
    }
    replaceSamples(samplesRef.current.map((sample, i) => stopped.includes(i) && isBusyState(sample.state)
      ? { ...sample, state: 'stopped', draftText: sample.text.trim() ? undefined : sample.draftText, errorCode: undefined, errorText: undefined }
      : sample))
  }

  useEffect(() => {
    if (!active) {
      stop()
      setErrorDetail(null)
    }
  }, [active])

  /** Focuses the first missing required field: in the form when it is on screen, otherwise in the advanced settings dialog. Returns whether the configuration is usable. */
  function requireConfig(requestConfig: WebApiConfig) {
    if (configComplete(requestConfig)) return true
    const missing = (root: ParentNode | null | undefined) => Array.from(root?.querySelectorAll<HTMLInputElement>('[data-api-required]') ?? []).find(input => !input.value.trim())
    const inline = missing(formRef.current)
    if (inline) inline.focus()
    else {
      setApiConfigOpen(true)
      // The dialog mounts its fields on the next frames.
      setTimeout(() => missing(apiConfigRef.current)?.focus(), 80)
    }
    toast.error(t('api.incomplete'))
    return false
  }

  /** Decides the route of a run from the connection setting. Returns null when nothing may be sent. */
  async function resolveRoute(requestConfig: WebApiConfig): Promise<client.Route | null> {
    try {
      return await connection.resolve(requestConfig)
    } catch (error) {
      toast.error(describeError(i18n, error))
      if ((error as CodedError).code === 'proxy_missing') {
        setApiConfigOpen(true)
        setTimeout(() => apiConfigRef.current?.querySelector<HTMLInputElement>('#proxy-worker-url')?.focus(), 80)
      }
      return null
    }
  }

  async function sampleIndexes(requested: number[], requestConfig: WebApiConfig = config) {
    const indexes = requested.filter(i => !runs.current.has(i))
    if (!indexes.length || verifying.current || !mounted.current || connection.checking) return
    if (!requireConfig(requestConfig)) return
    const token = generation.current
    const route = await resolveRoute(requestConfig)
    if (!route || generation.current !== token || verifying.current || !mounted.current || indexes.some(i => runs.current.has(i))) return
    const frozenConfig = { ...requestConfig, parallel: indexes.length > 1 && (requestConfig.parallel ?? false) }
    const controllers = new Map(indexes.map(i => [i, new AbortController()]))
    for (const [i, controller] of controllers) runs.current.set(i, controller)
    // The probe measures the upstream itself, so one probe serves every sample drawn with this configuration.
    if (requestConfig.tokenizerProbe && tokenizer.needed(requestConfig)) void tokenizer.start(requestConfig, route)
    replaceSamples(samplesRef.current.map((sample, i) => indexes.includes(i)
      ? { ...sample, draftText: '', state: 'pending', errorCode: undefined, httpStatus: undefined, errorText: undefined, elapsedMs: undefined, throughput: undefined }
      : sample))

    const accepted: boolean[] = []
    if (frozenConfig.parallel) accepted.push(...await Promise.all(indexes.map(i => sampleOne(i, frozenConfig, controllers.get(i)!, route))))
    else for (const i of indexes) accepted.push(await sampleOne(i, frozenConfig, controllers.get(i)!, route))
    if (frozenConfig.autoVerify && accepted.every(Boolean) && samplesRef.current.every(sample => sample.text.trim())) {
      void verify()
    }
  }

  async function sampleOne(index: number, requestConfig: WebApiConfig, controller: AbortController, route: client.Route): Promise<boolean> {
    const current = () => mounted.current && runs.current.get(index) === controller
    if (!current()) return false
    let accepted = false
    let startedAt: number | undefined

    function applyProgress(progress: CollectionProgress) {
      const challenge = progress.challenges?.[0]
      if (!current() || !challenge || accepted) return
      const state = challenge.state ?? 'pending'
      if (state === 'requesting' && startedAt === undefined) startedAt = performance.now()
      const finished = state === 'done' || state === 'capped' || state === 'rejected'
      const elapsedMs = finished && startedAt !== undefined ? performance.now() - startedAt : undefined
      if ((state === 'done' || state === 'capped') && challenge.text.trim()) {
        accepted = true
        sampled.current[index] = requestConfig
        patch(index, { text: challenge.text, draftText: undefined, state, elapsedMs, throughput: challenge.throughput, errorCode: undefined, httpStatus: undefined, errorText: undefined })
        setResult(null)
      } else {
        const previous = samplesRef.current[index]
        patch(index, {
          draftText: state === 'rejected' && previous.text.trim() ? undefined : challenge.text,
          state, elapsedMs, throughput: challenge.throughput,
          errorCode: state === 'rejected' ? challenge.errorCode : undefined,
          httpStatus: state === 'rejected' ? challenge.httpStatus : undefined,
          errorText: state === 'rejected' ? safeError(challenge.error, requestConfig.apiKey) : undefined,
        })
      }
    }

    try {
      await client.testApi(requestConfig, [challengesRef.current[index]], applyProgress, route, controller.signal)
    } catch (error) {
      if (!current()) return false
      const coded = error as CodedError
      const sample = samplesRef.current[index]
      if (isBusyState(sample.state)) patch(index, { state: 'rejected', draftText: sample.text.trim() ? undefined : sample.draftText, errorCode: coded?.code, httpStatus: coded?.httpStatus, errorText: safeError(error instanceof Error ? error.message : undefined, requestConfig.apiKey) })
    }
    if (current()) runs.current.delete(index)
    return accepted
  }

  async function verify() {
    if (verifying.current || runs.current.size || !mounted.current || !samplesRef.current.some(sample => sample.text.trim())) return
    const token = {}
    verifying.current = token
    generation.current++
    const outputs = samplesRef.current.map((sample, i) => ({ text: sample.text, expected_count: challengesRef.current[i].expected_count }))
    setComputing(true)
    setExpanded(null)
    try {
      // The result is the number fingerprint alone; a probe still running keeps going beside it.
      const analysis = await client.analyze(outputs, bank)
      if (!mounted.current || verifying.current !== token) return
      const model = mode === 'api' ? config.model : null
      setResultModel(model)
      setResult(analysis)
      if (model) trackDetection(model, analysis)
    } catch (error) {
      if (!mounted.current || verifying.current !== token) return
      toast.error(describeError(i18n, error, 'errors.analyze'))
    } finally {
      if (verifying.current === token) {
        verifying.current = null
        setComputing(false)
      }
    }
  }

  /** Probes again with the configuration of the probe on screen; the result on screen stays as it is. */
  async function retryProbe() {
    const requestConfig = tokenizer.session.config ?? config
    if (locked || tokenizer.busy || !requireConfig(requestConfig)) return
    const token = generation.current
    const route = await resolveRoute(requestConfig)
    if (route && generation.current === token && mounted.current) tokenizer.start(requestConfig, route)
  }

  /** Three new prompts; the replies and the result belonged to the old ones. */
  function freshPrompts() {
    replaceChallenges(client.generateChallenges(3))
    replaceSamples([idle(), idle(), idle()])
    sampled.current = []
    setResult(null)
    setExpanded(null)
  }

  function restart() {
    stop()
    tokenizer.reset()
    verifying.current = null
    setComputing(false)
    freshPrompts()
  }

  /** After a finished detection, Start over asks for a Star once per page session. */
  function restartAfterResult() {
    restart()
    if (askedStar.current || !starPromptAllowed()) return
    askedStar.current = true
    toastWithStar(t('detect.restartReady'), t('detect.starAfterRestart'), 'message')
  }

  /** The probe measures the upstream rather than the prompts, so rotating keeps it. */
  function rotatePrompts() {
    if (locked) return
    setRotations(n => n + 1)
    freshPrompts()
  }

  /** Abnormal distributions follow the prompt, so retrying them needs new prompts. */
  function replacePrompts(indexes: number[]) {
    if (verifying.current || indexes.some(i => runs.current.has(i))) return
    const kept = challengesRef.current.filter((_, i) => !indexes.includes(i)).map(challenge => challenge.expected_count)
    const fresh = client.generateChallenges(indexes.length, kept)
    replaceChallenges(challengesRef.current.map((challenge, i) => indexes.includes(i) ? fresh[indexes.indexOf(i)] : challenge))
    replaceSamples(samplesRef.current.map((sample, i) => indexes.includes(i) ? idle() : sample))
    setResult(null)
    setExpanded(null)
    if (mode === 'api') void sampleIndexes(indexes, sampled.current[indexes[0]] ?? config)
  }

  function edit(i: number, text: string) {
    if (runs.current.has(i) || verifying.current) return
    patch(i, { text, draftText: undefined, state: 'idle', errorCode: undefined, httpStatus: undefined, errorText: undefined, elapsedMs: undefined, throughput: undefined })
    setResult(null)
  }

  async function saveImage() {
    if (!result) return
    try { await exportResultImage(result, i18n); if (mounted.current) toastWithStar(t('detect.imageSaved'), t('detect.starAfterImage'), 'success') }
    catch { if (mounted.current) toast.error(t('detect.imageFailed')) }
  }

  /** The JSON carries the settled probe on screen as reference information next to the number-only candidates. */
  function exportJson(analysis: Analysis) {
    const { phase: probePhase, bank: probeBank, run, startedAt, config: probeConfig } = tokenizer.session
    const probe = probeShown && probePhase === 'result' && probeBank && run ? { run, bank: probeBank, startedAt, model: probeConfig?.model.trim() ?? '' } : undefined
    client.exportAnalysis(analysis, probe)
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
  const anomalous = phase === 'result' && result
    ? anomalousSamples(samples.map((sample, i) => result.diagnostics[i]?.accepted ? sample.text : ''))
    : []
  const showProbeError = (detail: string) => setErrorDetail(safeError(detail, tokenizer.session.config?.apiKey ?? config.apiKey) ?? '')
  // The probe bills requests, so it can be stopped in every phase; while sampling, Stop covers it.
  const stopProbe = tokenizer.busy && <Button variant="outline" className="h-9" onClick={tokenizer.stop}>{t('tokenizer.stop')}</Button>

  /** The probe belongs to API mode, so manual mode stops it and closes its details. */
  function changeMode(next: Mode) {
    if (locked || next === mode) return
    if (next === 'manual') {
      tokenizer.stop()
      if (expanded === 'tokenizer') setExpanded(null)
    }
    setMode(next)
  }

  function collapseProbe() {
    setExpanded(null)
    document.getElementById('tokenizer-trigger')?.focus({ preventScroll: true })
  }

  /** On narrow screens the bench sits above the form, so starting a run brings it into view. */
  function showStage() {
    if (window.innerWidth < 1024) stageRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }

  const waitingDetector = detectorDownload.status === 'loading'
  const sceneBusy = scenePhase === 'scanning' || scenePhase === 'printing'
  const primary = phase === 'sampling'
    ? { label: t('detect.sampling'), busy: true }
    : phase === 'computing' || sceneBusy
      ? { label: scenePhase === 'printing' ? t('detect.printing') : waitingDetector ? <>{t('detect.waitingDetectorShort')}{detectorFraction !== null && <span className="tabular-nums">{percent(detectorFraction)}</span>}</> : t('detect.computing'), busy: true }
      : mode === 'api' && emptyIndexes.length > 0
        ? { label: connection.checking ? t('proxy.checking') : t('detect.startSampling'), busy: connection.checking, disabled: locked, run: () => { showStage(); void sampleIndexes(emptyIndexes) } }
        : { label: filled === 0 ? t('detect.verifyLocked') : filled < 3 ? t('detect.verifyPartial', { n: filled }) : t('detect.verify'), busy: false, disabled: filled === 0, run: () => { showStage(); void verify() } }

  return (
    <div className="fp-page">
      <h1 className="text-h1">{t('detect.title')}</h1>

      <aside className="fp-cli-promo relative isolate overflow-hidden" aria-label={t('detect.cliTitle')}>
        <PixelShader effect="rain" className="absolute inset-0 -z-10 text-muted-foreground/30 [mask-image:linear-gradient(90deg,transparent_25%,#000_70%)]" />
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <strong className="shrink-0 font-medium">{t('detect.cliTitle')}</strong>
          <span className="text-muted-foreground">{t('detect.cliDescription')}</span>
        </div>
        <button type="button" className="fp-cli-command" onClick={copyCliCommand} aria-label={t('detect.cliCopy', { command: cliCommand })} title={t('detect.cliCopy', { command: cliCommand })}>
          <code className="fp-mono text-meta"><span>bunx</span> lmfpd@latest <span>--help</span></code>
          <Copy className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
        <span className="fp-cli-links">
          <a href={docsHref(i18n.locale, 'cli/detect')} target="_blank" rel="noopener noreferrer" className="fp-cli-link">
            <span className="sm:hidden">{t('detect.cliGuideShort')}</span>
            <span className="hidden sm:inline">{t('detect.cliGuide')}</span>
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
          <a href={docsHref(i18n.locale, 'sdk')} target="_blank" rel="noopener noreferrer" className="fp-cli-link" title={t('detect.sdkDescription')}>
            <span className="sm:hidden">SDK</span>
            <span className="hidden sm:inline">{t('detect.sdkGuide')}</span>
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        </span>
      </aside>

      <div className="fp-custom-workbench" data-phase={scenePhase}>
        <section ref={stageRef} className="fp-custom-stage" aria-label={t('detect.stageLabel')}>
          {active && <Suspense fallback={<div className="fp-custom-scene-loading">{t('detect.scene.loading')}</div>}>
            <ScannerScene name={sceneModel} inputMode={mode} baseUrl={config.baseUrl} apiKey={config.apiKey} filled={sceneFilled} focus={focus} phase={scenePhase} motion={sceneMotion} result={sceneResult} />
          </Suspense>}
        </section>

        <aside className="min-w-0">
          {scenePhase === 'report' && result ? (
            <ScanSummary
              result={result}
              model={resultModel ?? (mode === 'manual' ? declaredModel : null)}
              samples={samples}
              challenges={challenges}
              anomalous={anomalous}
              mode={mode}
              canResample={canSample && !locked}
              onResample={index => void sampleIndexes([index], sampled.current[index] ?? config)}
              onRestart={() => { restartAfterResult(); window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }) }}
              onSaveImage={saveImage}
              onExportJson={() => exportJson(result)}
              extra={stopProbe}
            />
          ) : (
            <div ref={formRef} className="fp-custom-form" aria-label={t('detect.samples')}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.p key={mode} className="fp-custom-mode-note" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={snappy}>
                  <ShieldCheck aria-hidden="true" />{t(mode === 'api' ? 'detect.modeApiHint' : 'detect.modeManualHint')}
                </motion.p>
              </AnimatePresence>
              <ModeSwitch mode={mode} onChange={changeMode} disabled={locked || sceneBusy} />

              <div className="flex flex-col gap-2">
                <label htmlFor="detect-model" className="fp-custom-field-label">{t(mode === 'api' ? 'api.model' : 'detect.declaredLabel')}</label>
                <div className="fp-custom-model-input">
                  {modelBrand !== 'neutral' && sceneModel.trim() ? <BrandIcon family={modelBrand} className="size-5" /> : <Fingerprint aria-hidden="true" />}
                  {/* In API mode this is the profile's model, the same value the advanced settings edit. */}
                  <input
                    id="detect-model"
                    data-api-required={mode === 'api' || undefined}
                    className={cn(mode === 'api' && 'fp-mono')}
                    value={sceneModel}
                    readOnly={locked || sceneBusy}
                    maxLength={160}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t(mode === 'api' ? 'api.modelPlaceholder' : 'detect.declaredPlaceholder')}
                    onChange={event => mode === 'api' ? update({ model: event.target.value }) : setDeclaredModel(event.target.value)}
                    onFocus={() => setFocus(-1)}
                    onBlur={() => { setFocus(null); if (mode === 'api') update({ model: config.model.trim() }) }}
                  />
                  {sceneModel.trim() && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
                </div>
              </div>

              {mode === 'api' ? (
                <ApiConnectionFields config={config} update={update} disabled={locked || sceneBusy} profileName={profileManager.profiles.find(profile => profile.id === profileManager.activeId)?.name} onAdvanced={() => setApiConfigOpen(true)} />
              ) : (
              <div className="fp-custom-probes">
                {challenges.map((challenge, index) => (
                  // Keyed by slot, so a new prompt crossfades inside the card that stays.
                  <ProbeDrawer
                    key={index}
                    index={index}
                    challenge={challenge}
                    sample={samples[index]}
                    mode={mode}
                    canSample={canSample}
                    locked={computing || sceneBusy}
                    focused={focus === index}
                    anomalous={anomalous.includes(index)}
                    onChange={text => edit(index, text)}
                    onFocus={() => setFocus(index)}
                    onBlur={() => setFocus(null)}
                    onResample={() => sampleIndexes([index], sampled.current[index] ?? config)}
                    onStop={() => stop([index])}
                    onShowError={() => setErrorDetail(samples[index].errorText ?? null)}
                  />
                ))}
              </div>
              )}
              {probeShown && <TokenizerCard session={tokenizer.session} onShowError={showProbeError} onRetry={() => void retryProbe()} canRetry={!locked && config.tokenizerProbe} />}

              {phase === 'computing' && (waitingDetector ? (
                // Scoring waits for the detector download; say so instead of showing a plain computing line.
                <div className="flex flex-col justify-center gap-2">
                  <div className="flex items-center gap-2 text-body text-muted-foreground">
                    <PixelSpinner />
                    <span role="status">{t('detect.waitingDetector')}</span>
                    {detectorBytes && <span className="ms-auto text-meta tabular-nums">{detectorBytes}</span>}
                  </div>
                  <ProgressCells value={detectorFraction} active label={t('app.detector')} className="w-full" />
                </div>
              ) : (
                <div className="flex h-8 items-center gap-2 text-body text-muted-foreground" role="status">
                  <PixelSpinner />
                  {t('detect.computing')}
                  <PixelShader effect="scan" cell={3} className="h-6 min-w-0 flex-1 text-muted-foreground/60" />
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-end gap-2">
                {phase === 'edit' && !sceneBusy && (samples.some(s => s.text.trim() || s.draftText?.trim())
                  ? <Button variant="ghost" className="me-auto h-9" onClick={restart}>{t('detect.restart')}</Button>
                  : <Button variant="ghost" className="me-auto h-9" disabled={locked} onClick={rotatePrompts}>
                      <MotionRefresh data-icon="inline-start" aria-hidden="true" initial={false} animate={{ rotate: rotations * 180 }} transition={smooth} />
                      {t('detect.rotatePrompts')}
                    </Button>)}
                {phase === 'sampling' && <Button variant="outline" className="h-9" onClick={() => stop()}>{t('detect.stop')}</Button>}
                {phase !== 'sampling' && stopProbe}
                {phase === 'edit' && !sceneBusy && mode === 'api' && emptyIndexes.length > 0 && filled > 0 && <Button variant="outline" className="h-9" onClick={() => { showStage(); void verify() }}>{t('detect.verifyPartial', { n: filled })}</Button>}
                <Button className="fp-custom-primary h-11 justify-between gap-6 px-4" disabled={primary.busy || primary.disabled} onClick={primary.run}>
                  <span className="flex items-center gap-2">{primary.label}</span>
                  {primary.busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                </Button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <AnimatePresence initial={false}>
        {scenePhase === 'report' && result && <motion.div
          key="report"
          ref={reportRef}
          className="flex flex-col gap-6 overflow-hidden"
          initial={reduced ? false : { height: 0 }}
          animate={{ height: 'auto' }}
          exit={reduced ? undefined : { height: 0 }}
          transition={smooth}
        >
          <ResultPanel result={result} anomalous={anomalous} mode={mode} onReplacePrompts={() => replacePrompts(anomalous)} />
          {probeShown && <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:max-w-xs">
              <TokenizerStripButton session={tokenizer.session} expanded={expanded === 'tokenizer'} onToggle={() => setExpanded(e => (e === 'tokenizer' ? null : 'tokenizer'))} />
            </div>
            <AnimatePresence initial={false}>
              {expanded === 'tokenizer' && <motion.div key="tokenizer-details" initial={reduced ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={reduced ? undefined : { height: 0, opacity: 0 }} transition={snappy} className="overflow-hidden">
                <TokenizerDetails session={tokenizer.session} onShowError={showProbeError} onCollapse={collapseProbe} onRetry={retryProbe} canRetry={!locked && config.tokenizerProbe} />
              </motion.div>}
            </AnimatePresence>
          </div>}
        </motion.div>}
      </AnimatePresence>

      <div className="fp-detect-footer">
        <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" className="fp-star-link" onClick={markStarVisited}>
          <Star className="size-4" aria-hidden="true" />
          {t('detect.starRequest')}
        </a>
      </div>

      <Dialog open={active && mode === 'api' && apiConfigOpen} onOpenChange={setApiConfigOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('detect.advancedSettings')}</DialogTitle>
            <DialogDescription className="sr-only">{t('api.title')}</DialogDescription>
          </DialogHeader>
          <ApiConfigPanel containerRef={apiConfigRef} open onOpenChange={open => !open && setApiConfigOpen(false)} config={config} update={update} profileManager={profileManager} disabled={locked} />
        </DialogContent>
      </Dialog>

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
