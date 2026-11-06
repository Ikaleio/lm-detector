import { useEffect, useState } from 'react'
import { Box, Text, render, useInput, useWindowSize } from 'ink'
import { cleanText } from '@fingerpoint/shared/detect-request'
import type { TokenizerBank } from '@fingerpoint/shared/tokenizer-bank'
import { tokenizerVerdict, type TokenizerVerdict } from '@fingerpoint/shared/tokenizer-posterior'
import type { TokenizerRun } from '@fingerpoint/shared/tokenizer-probe'
import type { DetectOptions } from './detect-options'

const percentage = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`

export function verdictLine(bank: TokenizerBank, verdict: TokenizerVerdict) {
  const item = bank.classes.find(entry => entry.id === verdict.top.id)
  const name = item ? `${item.series} (${item.lab_name})` : verdict.top.id
  if (verdict.kind === 'exact') return `${name} · exact match · ${percentage(verdict.confidence)}`
  if (verdict.kind === 'related') return `Unlisted relative of ${name} · ${percentage(verdict.confidence)}`
  return `Unlisted tokenizer · ${percentage(verdict.confidence)} · nearest class: ${name}`
}

const claimWords = { consistent: 'match', inconsistent: 'no match', uncertain: 'unclear' } as const

function claimLine(bank: TokenizerBank, verdict: TokenizerVerdict, model: string) {
  const claim = verdict.claim
  if (!claim) return `The tokenizer bank has no data for "${model}". FPD cannot check the tokenizer of this model.`
  const expected = claim.expected.length
    ? claim.expected.map(id => bank.classes.find(item => item.id === id)?.series ?? id).join(' or ')
    : `an unpublished ${claim.vendor} tokenizer`
  return `"${model}" uses ${expected} · ${claimWords[claim.status]} (${percentage(claim.probability)} probability)`
}

/** A relay that estimates usage locally with tiktoken also produces o200k_base or cl100k_base counts. */
const estimatedUsageClasses = new Set(['o200k', 'cl100k'])

export function TokenizerResult({ run, bank, model, settled, warning, spinner, safe, referenceOnly = false }: {
  run?: TokenizerRun; bank: TokenizerBank; model: string; settled: boolean; warning?: string
  spinner: string; safe: (text: string) => string; referenceOnly?: boolean
}) {
  if (!run) return null
  const answered = run.steps.filter(step => step.state === 'done').length
  // While probing, the leader is recomputed from the answers so far.
  const verdict = run.verdict ?? (!settled && run.posterior && run.posterior.answered > 0
    ? tokenizerVerdict(bank, run.posterior, model) : null)
  const error = run.error && run.error.code !== 'aborted' ? run.error : undefined
  const stopped = settled && run.error?.code === 'aborted'
  return <Box flexDirection="column" marginTop={1}>
    <Text bold color="cyan">TOKENIZER PROBE <Text dimColor> · {answered} request{answered === 1 ? '' : 's'} answered</Text></Text>
    <Text dimColor>{referenceOnly ? 'Reference only. The ranking and the confidence do not use it.' : 'Input token counts identify the tokenizer family, shared by many models.'}</Text>
    {warning && <Text color="yellow">{safe(warning)}</Text>}
    {!settled && <Text>{spinner} {verdict ? `Current leader: ${safe(verdictLine(bank, verdict))}` : 'Waiting for the first counts'}</Text>}
    {settled && verdict && <>
      <Text bold>{safe(verdictLine(bank, verdict))}</Text>
      {model && <Text color={verdict.claim?.status === 'inconsistent' ? 'red' : verdict.claim?.status === 'consistent' ? 'green' : 'yellow'}>{safe(claimLine(bank, verdict, model))}</Text>}
      {verdict.kind === 'exact' && estimatedUsageClasses.has(verdict.top.id) && verdict.claim?.status !== 'consistent' && <Text color="yellow">A relay that counts usage locally with tiktoken also gives this result. The count can come from the relay and not from the model.</Text>}
      {verdict.kind === 'exact' && verdict.claim?.status === 'consistent' && <Text dimColor>Many models share one tokenizer. A match does not identify the model.</Text>}
    </>}
    {settled && !verdict && <Text color="yellow">No tokenizer result{error ? `: ${safe(error.message)}` : '. No probe text got a count.'}</Text>}
    {settled && verdict && error && <Text color="yellow">Partial result from the counts before a failed request: {safe(error.message)}</Text>}
    {stopped && <Text color="yellow">The probe stopped after {answered} answered request{answered === 1 ? '' : 's'}.{verdict ? ' The result uses these counts.' : ''}</Text>}
    {run.baselineDrift && <Text color="yellow">The two baseline requests gave different counts. The API adds hidden input of varying length, so the result can be wrong. Run the command again and compare.</Text>}
  </Box>
}

export interface TokenizerState {
  run?: TokenizerRun
  model: string
  warning?: string
  startedAt: number
  finishedAt?: number
}

function Dashboard({ state, bank, options, cancel, saved, fatal }: {
  state: TokenizerState; bank: TokenizerBank; options: DetectOptions; cancel: () => void; saved?: string; fatal?: string
}) {
  const [now, setNow] = useState(Date.now())
  const { columns, rows } = useWindowSize()
  const safe = (value: string) => cleanText(options.config.apiKey ? value.replaceAll(options.config.apiKey, '[REDACTED]') : value)
  const settled = state.finishedAt !== undefined
  useEffect(() => {
    if (settled) return
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [settled])
  useInput((input, key) => { if (input === 'q' || key.ctrl && input === 'c') cancel() }, {
    isActive: !settled && !!process.stdin.isTTY,
  })
  const run = state.run
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][Math.floor(now / 100) % 10]
  const baseline = run?.observations.find(item => item.probe === null)?.tokens
  const steps = run?.steps ?? []
  const deltaWidth = columns < 50 ? 8 : 12
  const visible = settled ? steps : steps.slice(-Math.max(3, Math.min(8, (rows || 24) - 16)))
  return <Box flexDirection="column" width={Math.max(30, Math.min(columns || 80, 100))} paddingX={1}>
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text bold color="cyan">FPD / TOKENIZER DETECTOR</Text>
      <Text bold wrap="truncate-end">{safe(state.model || 'Saved tokenizer counts')}</Text>
      <Text dimColor>{options.input ? 'Offline replay' : `${options.api} · ${options.config.stream ? 'SSE' : 'JSON'} · parallel ${options.parallel} · ${options.timeoutMs / 1000}s per request`} · {bank.classes.length} classes</Text>
    </Box>
    <TokenizerResult run={run} bank={bank} model={state.model} settled={settled} warning={state.warning} spinner={spinner} safe={safe} />
    {settled && run?.posterior && run.posterior.answered > 0 && <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">TOKENIZER CANDIDATES</Text>
      {run.posterior.classes.slice(0, 6).map(score => {
        const item = bank.classes.find(entry => entry.id === score.id)
        return <Box key={score.id}>
          <Box flexGrow={1} flexBasis={0}><Text wrap="truncate-end">{safe(item ? `${item.series} · ${item.lab_name}` : score.id)}</Text></Box>
          <Box width={10} justifyContent="flex-end"><Text>{percentage(score.exact)}</Text></Box>
        </Box>
      })}
      <Text dimColor>Unlisted tokenizer: {percentage(run.posterior.unknown)}</Text>
    </Box>}
    {steps.length > 0 && <Box flexDirection="column" marginTop={1}>
      <Box>
        <Box flexGrow={1}><Text bold color="cyan">{columns < 50 ? 'COUNTS' : 'REQUEST COUNTS'}</Text></Box>
        <Box width={10} justifyContent="flex-end"><Text dimColor>Tokens</Text></Box>
        <Box width={deltaWidth} justifyContent="flex-end"><Text dimColor>{columns < 50 ? 'Δ' : 'Δ baseline'}</Text></Box>
      </Box>
      {visible.length < steps.length && <Text dimColor>Showing the latest {visible.length} of {steps.length} requests</Text>}
      {visible.map((step, index) => <Box key={index}>
        <Box flexGrow={1} flexBasis={0}><Text wrap="truncate-end" color={step.state === 'failed' ? 'yellow' : undefined}>
          {step.state === 'requesting' ? spinner : step.state === 'done' ? '✓' : '×'} {safe(step.probe ?? 'Baseline')}
        </Text></Box>
        <Box width={10} justifyContent="flex-end"><Text>{step.tokens ?? '—'}</Text></Box>
        <Box width={deltaWidth} justifyContent="flex-end"><Text dimColor>{step.probe !== null && step.tokens !== undefined && baseline !== undefined ? step.tokens - baseline : '—'}</Text></Box>
      </Box>)}
    </Box>}
    <Box flexDirection="column" marginTop={1}>
      {fatal && <Text color="red">{safe(fatal)}</Text>}
      {saved && <Text color="green">Saved {safe(saved)}</Text>}
      <Text dimColor>{((Math.max(0, (state.finishedAt ?? now) - state.startedAt)) / 1000).toFixed(1)}s · {settled ? `${steps.filter(step => step.state === 'done').length} requests answered` : 'q / Ctrl+C to stop and keep received counts'}</Text>
    </Box>
  </Box>
}

export function createTokenizerDisplay(options: DetectOptions, bank: TokenizerBank, initial: TokenizerState, cancel: () => void) {
  let state = initial
  const terminal = !!process.stdout.isTTY && !process.env.CI && process.env.TERM !== 'dumb'
  const element = (saved?: string, fatal?: string) => <Dashboard state={state} bank={bank} options={options} cancel={cancel} saved={saved} fatal={fatal} />
  const view = terminal ? render(element(), { exitOnCtrlC: false, patchConsole: false, maxFps: 10 }) : undefined
  let answered = 0
  return {
    update(next: TokenizerState) {
      state = next
      const count = state.run?.observations.length ?? 0
      if (!view && !options.input && count > answered) process.stderr.write(`Tokenizer: ${count} requests answered\n`)
      answered = count
      view?.rerender(element())
    },
    async finish(saved?: string, fatal?: string) {
      state = { ...state, finishedAt: state.finishedAt ?? Date.now() }
      const finalView = view ?? render(element(saved, fatal), { interactive: false, patchConsole: false })
      if (view) view.rerender(element(saved, fatal))
      await finalView.waitUntilRenderFlush()
      finalView.unmount()
    },
  }
}
