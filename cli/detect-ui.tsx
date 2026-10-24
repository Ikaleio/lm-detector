import { useEffect, useState } from 'react'
import { Box, Text, render, useInput, useWindowSize } from 'ink'
import terminalLink from 'terminal-link'
import { anomalousSamples } from '@fingerpoint/shared/sample-distribution'
import type { TokenizerBank } from '@fingerpoint/shared/tokenizer-bank'
import { tokenizerVerdict, type TokenizerVerdict } from '@fingerpoint/shared/tokenizer-posterior'
import type { Analysis } from '@fingerpoint/shared/types'
import { acceptedSample, cleanText, type Sample } from '@fingerpoint/shared/detect-request'
import type { DetectionState } from '@fingerpoint/shared/detect-run'
import type { DetectOptions } from './detect-options'
import type { UpdateNotice } from './detect-update'
import { StarNote } from './detect-help'

const seconds = (milliseconds: number) => `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`
/** Narrow terminals keep only the decode rate. */
function speed({ throughput }: Sample, wide: boolean) {
  if (!throughput) return ''
  const rate = throughput.tokensPerSecond === undefined ? '' : `${throughput.estimated ? '≈' : ''}${Math.round(throughput.tokensPerSecond)} tok/s`
  const ttft = `TTFT ${seconds(throughput.ttftMs)}`
  return wide || !rate ? [ttft, rate].filter(Boolean).join(' · ') : rate
}
const percentage = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const labels: Record<Sample['state'], string> = {
  queued: 'Queued', waiting: 'Waiting', streaming: 'Streaming', complete: 'Complete',
  truncated: 'Capped', failed: 'Failed', cancelled: 'Cancelled',
}
const colors: Record<Sample['state'], string> = {
  queued: 'gray', waiting: 'yellow', streaming: 'cyan', complete: 'green', truncated: 'green', failed: 'red', cancelled: 'yellow',
}

function verdictLine(bank: TokenizerBank, verdict: TokenizerVerdict) {
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

function Ranking({ analysis, compact, safe }: { analysis: Analysis; compact: boolean; safe: (text: string) => string }) {
  const calibrated = analysis.probability_status === 'reference_calibrated'
  return <Box flexDirection="column" marginTop={1}>
    <Text bold color="cyan">LEADING CANDIDATES</Text>
    <Box>
      <Box width={4}><Text dimColor>#</Text></Box>
      <Box flexGrow={1}><Text dimColor>Model</Text></Box>
      <Box width={9} justifyContent="flex-end"><Text dimColor>Score</Text></Box>
      <Box width={12} justifyContent="flex-end"><Text dimColor>Confidence</Text></Box>
    </Box>
    {analysis.results.slice(0, compact ? 3 : 5).map((row, index) => <Box key={row.model}>
      <Box width={4}><Text color={index === 0 ? 'cyan' : undefined}>{index + 1}</Text></Box>
      <Box flexGrow={1} flexBasis={0}><Text wrap="truncate-end" bold={index === 0}>{safe(row.display_name)}</Text></Box>
      <Box width={9} justifyContent="flex-end"><Text>{row.score.toFixed(3)}</Text></Box>
      <Box width={12} justifyContent="flex-end"><Text color={index === 0 ? 'cyan' : undefined}>{percentage(row.probability)}</Text></Box>
    </Box>)}
    <Text dimColor>{analysis.decision === 'partial' ? 'Partial ranking · confidence unavailable'
      : calibrated ? 'Confidence is relative to the reference bank; it does not prove identity.'
      : 'Confidence unavailable for this detector.'}</Text>
    {!compact && <Text dimColor>{safe(analysis.evidence.label)}</Text>}
  </Box>
}

function Tokenizer({ state, bank, options, spinner, safe }: {
  state: DetectionState; bank: TokenizerBank; options: DetectOptions; spinner: string; safe: (text: string) => string
}) {
  const run = state.tokenizer
  if (!run) return null
  const settled = state.tokenizerSettled !== false
  const answered = run.steps.filter(step => step.state === 'done').length
  // While probing, the leader is recomputed from the answers so far.
  const verdict = run.verdict ?? (!settled && run.posterior && run.posterior.answered > 0
    ? tokenizerVerdict(bank, run.posterior, options.config.model) : null)
  const error = run.error && run.error.code !== 'aborted' ? run.error : undefined
  const stopped = settled && run.error?.code === 'aborted'
  const model = state.tokenizerModel ?? options.config.model
  return <Box flexDirection="column" marginTop={1}>
    <Text bold color="cyan">TOKENIZER PROBE <Text dimColor> · {answered} request{answered === 1 ? '' : 's'} answered</Text></Text>
    <Text dimColor>Reference only. The ranking and the confidence do not use it.</Text>
    {state.tokenizerWarning && <Text color="yellow">{safe(state.tokenizerWarning)}</Text>}
    {!settled && <Text>{spinner} {verdict ? `Current leader: ${verdictLine(bank, verdict)}` : 'Waiting for the first counts'}</Text>}
    {settled && verdict && <>
      <Text bold>{verdictLine(bank, verdict)}</Text>
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

function Dashboard({ state, options, bankSize, tokenizerBank, cancel, saved, fatal, updateNotice }: {
  state: DetectionState; options: DetectOptions; bankSize: number; tokenizerBank?: TokenizerBank; cancel: () => void; saved?: string; fatal?: string; updateNotice?: UpdateNotice
}) {
  const [now, setNow] = useState(Date.now())
  const { columns, rows } = useWindowSize()
  const compact = rows < 32
  useEffect(() => {
    if (state.finishedAt) return
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [state.finishedAt])
  useInput((input, key) => { if (input === 'q' || (key.ctrl && input === 'c')) cancel() }, {
    isActive: !!process.stdin.isTTY && !state.finishedAt,
  })
  const safe = (value: string) => cleanText(options.config.apiKey ? value.replaceAll(options.config.apiKey, '[REDACTED]') : value)
  const latest = state.rounds.at(-1)
  const completed = state.rounds.filter(round => round.finishedAt).length
  const scored = state.rounds.filter(round => round.analysis?.results.length).length
  const elapsed = seconds((state.finishedAt ?? now) - state.startedAt)
  // The rounds can be final while the run still waits for the tokenizer probe.
  const final = state.roundsFinishedAt ?? state.finishedAt
  const phase = state.cancelled ? 'Cancelled' : state.finishedAt ? 'Finished' : final ? 'Ranking final · tokenizer probe running' : 'Detecting'
  const spinner = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor(now / 100) % 10]
  const history = state.rounds.filter(round => round.finishedAt)
  const visibleHistory = history.slice(compact ? -3 : -5)
  const anomalous = latest?.analysis?.results.length || latest?.analysis?.decision === 'not_model'
    ? anomalousSamples(latest.outputs.map(output => output.text)) : []
  const winnerCounts = new Map<string, number>()
  for (const round of history) {
    if (round.analysis?.results.length) {
      const name = round.analysis.prediction_name
      winnerCounts.set(name, (winnerCounts.get(name) ?? 0) + 1)
    }
  }
  const consensus = [...winnerCounts].sort((a, b) => b[1] - a[1])[0]
  const tied = consensus ? [...winnerCounts].filter(([, count]) => count === consensus[1]).length > 1 : false
  return <Box flexDirection="column" width={Math.max(30, Math.min(columns || 80, 100))} paddingX={1}>
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text><Text bold color="cyan">FPD</Text><Text dimColor> / MODEL FINGERPOINT DETECTOR (</Text><Text color="cyan">{terminalLink('lm.ikale.io', 'https://lm.ikale.io', { fallback: false })}</Text><Text dimColor>)</Text></Text>
      <Text wrap="truncate-end" bold>{options.input ? `Offline · ${safe(options.input)}` : safe(options.config.model)}</Text>
      {!compact && !options.input && <Text dimColor wrap="truncate-middle">{safe(options.config.baseUrl)}</Text>}
      <Text dimColor>{options.input ? 'Saved outputs' : `${options.api}${options.config.serviceTier === 'default' ? '' : ` · ${options.config.serviceTier}`} · ${options.config.stream ? 'SSE' : 'JSON'} · count ${options.count} · parallel ${options.parallel}`} · {options.strict ? 'strict' : 'relaxed'} · {bankSize} models{options.tokenizer ? ' · tokenizer probe' : ''}</Text>
    </Box>
    <Box justifyContent="space-between">
      <Text bold>{state.finishedAt ? '●' : spinner} {phase} · round {latest?.index ?? 1}/{state.total}</Text>
      <Text dimColor>{elapsed}</Text>
    </Box>
    {!options.input && <Text dimColor>First byte {options.timeoutMs / 1000}s{options.config.stream ? ' · no deadline after SSE starts' : ' · deadline covers the full JSON response'}</Text>}
    {latest && <Box flexDirection="column" marginTop={1}>
      {latest.samples.map((sample, index) => {
        const active = sample.state === 'waiting' || sample.state === 'streaming'
        const time = sample.startedAt ? seconds((sample.finishedAt ?? now) - sample.startedAt) : '—'
        const filled = Math.min(12, Math.round(12 * sample.count / sample.expectedCount))
        const warning = anomalous.includes(index)
        const color = warning ? 'yellow' : colors[sample.state]
        return <Box key={index} flexDirection="column">
          <Box>
            <Box width={5}><Text dimColor>#{index + 1}</Text></Box>
            <Box width={12}><Text color={color}>{active ? spinner : warning ? '!' : acceptedSample(sample) ? '✓' : sample.state === 'failed' ? '×' : '·'} {labels[sample.state]}</Text></Box>
            {columns >= 75 && <Box width={15}><Text color={color}>{'━'.repeat(filled)}<Text dimColor>{'─'.repeat(12 - filled)}</Text></Text></Box>}
            <Box flexGrow={1}><Text>{sample.count}/{sample.expectedCount}</Text></Box>
            {!active && sample.throughput && <Text dimColor>{speed(sample, columns >= 75)} · </Text>}
            <Text dimColor>{time}</Text>
          </Box>
          {sample.error && <Text color="red" wrap="truncate-end">   {safe(sample.error)}</Text>}
          {warning && <Text color="yellow" wrap="truncate-end">   Abnormal distribution · every number is 200 or higher</Text>}
        </Box>
      })}
    </Box>}
    {latest?.error && <Text color="yellow">{safe(latest.error)}</Text>}
    {anomalous.length > 0 && <Text color="yellow">Sample {anomalous.map(index => index + 1).join(', ')}: abnormal distribution. This result is unreliable. The prompt causes it, so {options.challenges ? 'replace these prompts in the --challenges file' : 'rerun to draw new prompts'}.</Text>}
    {latest?.analysis && latest.analysis.results.length > 0 && <Ranking analysis={latest.analysis} compact={compact} safe={safe} />}
    {tokenizerBank && <Tokenizer state={state} bank={tokenizerBank} options={options} spinner={spinner} safe={safe} />}
    {state.total > 1 && history.length > 0 && <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">ROUNDS <Text dimColor> · {completed}/{state.total} settled · {scored} scored</Text></Text>
      {visibleHistory.map(round => <Box key={round.index}>
        <Box width={5}><Text dimColor>#{round.index}</Text></Box>
        <Box flexGrow={1} flexBasis={0}><Text wrap="truncate-end" color={round.error ? 'yellow' : undefined}>{safe(round.analysis?.prediction_name || 'Not scored')}</Text></Box>
        <Box width={7} justifyContent="flex-end"><Text dimColor>{round.samples.filter(acceptedSample).length}/{round.samples.length}</Text></Box>
        <Box width={10} justifyContent="flex-end"><Text>{percentage(round.analysis?.probability)}</Text></Box>
      </Box>)}
      {history.length > visibleHistory.length && <Text dimColor>Showing the last {visibleHistory.length} rounds. Use --output to save every round.</Text>}
      {final && consensus && <Text>{tied ? 'Tied lead' : 'Most frequent'}: <Text bold>{safe(consensus[0])}</Text>{tied ? ' and others' : ''} · {consensus[1]}/{scored} scored rounds</Text>}
    </Box>}
    <Box marginTop={1} flexDirection="column">
      {fatal && <Text color="red">{safe(fatal)}</Text>}
      {saved && <Text color="green">Saved {safe(saved)}</Text>}
      <Text dimColor>{state.finishedAt ? `${scored}/${state.total} rounds scored · ${elapsed}`
        : final && !state.cancelled ? 'q / Ctrl+C stops the tokenizer probe and exits · the ranking stays'
        : 'q / Ctrl+C to cancel · each round waits for all requested samples'}</Text>
      {state.finishedAt && scored > 0 && !fatal && <StarNote />}
    </Box>
    {updateNotice && <Box marginTop={1} flexDirection="column">
      <Text color="yellow">Update available: {updateNotice.current} → {updateNotice.latest}</Text>
      <Text>{updateNotice.temporary ? 'Run the latest version' : 'Update'}: <Text color="cyan">{updateNotice.command}</Text></Text>
    </Box>}
  </Box>
}

export interface DetectionDisplay {
  update(state: DetectionState): void
  finish(saved?: string, fatal?: string, updateNotice?: UpdateNotice): Promise<void>
}

export function createDisplay(options: DetectOptions, bankSize: number, cancel: () => void, tokenizerBank?: TokenizerBank): DetectionDisplay {
  let state: DetectionState = { rounds: [], total: options.repeat, startedAt: Date.now(), cancelled: false }
  const terminal = !!process.stdout.isTTY && !process.env.CI && process.env.TERM !== 'dumb'
  const view = render(<Dashboard state={state} options={options} bankSize={bankSize} tokenizerBank={tokenizerBank} cancel={cancel} />, {
    exitOnCtrlC: false, patchConsole: false, maxFps: 10, interactive: terminal,
  })
  const settled = new Set<string>()
  const clean = (text: string) => cleanText(options.config.apiKey ? text.replaceAll(options.config.apiKey, '[REDACTED]') : text)
  return {
    update(next: DetectionState) {
      state = next
      if (!terminal && !options.input) {
        const round = state.rounds.at(-1)
        round?.samples.forEach((sample, index) => {
          const id = `${round.index}:${index}`
          if (!sample.finishedAt || settled.has(id)) return
          settled.add(id)
          process.stderr.write(`[${round.index}/${state.total}] Sample ${index + 1}: ${labels[sample.state]} (${sample.count}/${sample.expectedCount})${sample.throughput ? ` · ${speed(sample, true)}` : ''}${sample.error ? ` · ${sample.error}` : ''}\n`)
        })
        if (round?.finishedAt && !settled.has(`${round.index}`)) {
          settled.add(`${round.index}`)
          const analysis = round.analysis?.results.length ? round.analysis : undefined
          process.stderr.write(`[${round.index}/${state.total}] ${analysis ? `Leading: ${clean(analysis.prediction_name)} · ${percentage(analysis.probability)}` : `Not scored: ${clean(round.error ?? '')}`}\n`)
        }
        if (state.roundsFinishedAt && state.tokenizerSettled === false && !state.cancelled && !settled.has('final')) {
          settled.add('final')
          process.stderr.write('All rounds finished. The tokenizer probe is still running. Ctrl+C stops the probe and keeps the round results.\n')
        }
        const run = state.tokenizer
        if (run && tokenizerBank && state.tokenizerSettled && !settled.has('tokenizer')) {
          settled.add('tokenizer')
          const answered = run.steps.filter(step => step.state === 'done').length
          const outcome = run.verdict ? verdictLine(tokenizerBank, run.verdict) : `no result${run.error ? ` (${clean(run.error.message)})` : ''}`
          process.stderr.write(`Tokenizer probe, reference only, ${answered} request${answered === 1 ? '' : 's'} answered: ${outcome}\n`)
        }
      }
      view.rerender(<Dashboard state={state} options={options} bankSize={bankSize} tokenizerBank={tokenizerBank} cancel={cancel} />)
    },
    async finish(saved?: string, fatal?: string, updateNotice?: UpdateNotice) {
      state = { ...state, finishedAt: state.finishedAt ?? Date.now() }
      view.rerender(<Dashboard state={state} options={options} bankSize={bankSize} tokenizerBank={tokenizerBank} cancel={cancel} saved={saved} fatal={fatal} updateNotice={updateNotice} />)
      await view.waitUntilRenderFlush()
      view.unmount()
    },
  }
}
