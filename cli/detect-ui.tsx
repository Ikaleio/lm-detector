import { useEffect, useState } from 'react'
import { Box, Text, render, useInput, useWindowSize } from 'ink'
import terminalLink from 'terminal-link'
import { anomalousSamples } from '@fingerpoint/shared/sample-distribution'
import type { Analysis } from '@fingerpoint/shared/types'
import { t, translateLabel, type Message } from './i18n'
import type { DetectOptions } from './detect-options'
import type { DetectionState } from './detect-run'
import { acceptedSample, cleanText, type Sample } from './detect-request'
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
const labels: Record<Sample['state'], Message> = {
  queued: 'Queued', waiting: 'Waiting', streaming: 'Streaming', complete: 'Complete',
  truncated: 'Capped', failed: 'Failed', cancelled: 'Cancelled',
}
const colors: Record<Sample['state'], string> = {
  queued: 'gray', waiting: 'yellow', streaming: 'cyan', complete: 'green', truncated: 'green', failed: 'red', cancelled: 'yellow',
}

function Ranking({ analysis, compact, safe }: { analysis: Analysis; compact: boolean; safe: (text: string) => string }) {
  const calibrated = analysis.probability_status === 'reference_calibrated'
  const hasConfidence = analysis.results.some(row => row.verification_confidence != null)
  return <Box flexDirection="column" marginTop={1}>
    <Text bold color="cyan">{t('LEADING CANDIDATES')}</Text>
    <Box>
      <Box width={4}><Text dimColor>#</Text></Box>
      <Box flexGrow={1}><Text dimColor>{t('Model')}</Text></Box>
      <Box width={9} justifyContent="flex-end"><Text dimColor>{t('Score')}</Text></Box>
      <Box width={12} justifyContent="flex-end"><Text dimColor>{calibrated ? t('Confidence') : hasConfidence ? t('Verifier') : t('Confidence')}</Text></Box>
    </Box>
    {analysis.results.slice(0, compact ? 3 : 5).map((row, index) => <Box key={row.model}>
      <Box width={4}><Text color={index === 0 ? 'cyan' : undefined}>{index + 1}</Text></Box>
      <Box flexGrow={1} flexBasis={0}><Text wrap="truncate-end" bold={index === 0}>{safe(row.display_name)}</Text></Box>
      <Box width={9} justifyContent="flex-end"><Text>{row.score.toFixed(3)}</Text></Box>
      <Box width={12} justifyContent="flex-end"><Text color={index === 0 ? 'cyan' : undefined}>{percentage(row.verification_confidence)}</Text></Box>
    </Box>)}
    <Text dimColor>{analysis.decision === 'partial' ? t('Partial ranking · confidence unavailable')
      : calibrated ? t('Confidence is relative to the reference bank; it does not prove identity.')
      : hasConfidence ? t('Verifier values are uncalibrated scores, not identity probabilities.') : t('Confidence unavailable for this bank.')}</Text>
    {!compact && <Text dimColor>{safe(translateLabel(analysis.evidence.label))}</Text>}
  </Box>
}

function Dashboard({ state, options, bankSize, cancel, saved, fatal, updateNotice }: {
  state: DetectionState; options: DetectOptions; bankSize: number; cancel: () => void; saved?: string; fatal?: string; updateNotice?: UpdateNotice
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
  const phase = state.cancelled ? t('Cancelled') : state.finishedAt ? t('Finished') : t('Detecting')
  const spinner = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor(now / 100) % 10]
  const history = state.rounds.filter(round => round.finishedAt)
  const visibleHistory = history.slice(compact ? -3 : -5)
  const anomalous = latest?.analysis?.results.length ? anomalousSamples(latest.outputs.map(output => output.text)) : []
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
      <Text><Text bold color="cyan">FPD</Text><Text dimColor> / {t('MODEL FINGERPOINT DETECTOR')} (</Text><Text color="cyan">{terminalLink('lm.ikale.io', 'https://lm.ikale.io', { fallback: false })}</Text><Text dimColor>)</Text></Text>
      <Text wrap="truncate-end" bold>{options.input ? t('Offline · {0}', safe(options.input)) : safe(options.config.model)}</Text>
      {!compact && !options.input && <Text dimColor wrap="truncate-middle">{safe(options.config.baseUrl)}</Text>}
      <Text dimColor>{options.input ? t('Saved outputs') : t('{0} · {1} · count {2} · parallel {3}', options.api, options.config.stream ? 'SSE' : 'JSON', options.count, options.parallel)} · {options.strict ? t('strict') : t('relaxed')} · {t('{0} models', bankSize)}</Text>
    </Box>
    <Box justifyContent="space-between">
      <Text bold>{state.finishedAt ? '●' : spinner} {phase}{t(' · round {0}/{1}', latest?.index ?? 1, state.total)}</Text>
      <Text dimColor>{elapsed}</Text>
    </Box>
    {!options.input && <Text dimColor>{t('First byte {0}s', options.timeoutMs / 1000)}{options.config.stream ? t(' · no deadline after SSE starts') : t(' · deadline covers the full JSON response')}</Text>}
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
            <Box width={12}><Text color={color}>{active ? spinner : warning ? '!' : acceptedSample(sample) ? '✓' : sample.state === 'failed' ? '×' : '·'} {t(labels[sample.state])}</Text></Box>
            {columns >= 75 && <Box width={15}><Text color={color}>{'━'.repeat(filled)}<Text dimColor>{'─'.repeat(12 - filled)}</Text></Text></Box>}
            <Box flexGrow={1}><Text>{sample.count}/{sample.expectedCount}</Text></Box>
            {!active && sample.throughput && <Text dimColor>{speed(sample, columns >= 75)} · </Text>}
            <Text dimColor>{time}</Text>
          </Box>
          {sample.error && <Text color="red" wrap="truncate-end">   {safe(translateLabel(sample.error))}</Text>}
          {warning && <Text color="yellow" wrap="truncate-end">   {t('Abnormal distribution · every number is 200 or higher')}</Text>}
        </Box>
      })}
    </Box>}
    {latest?.error && <Text color="yellow">{safe(translateLabel(latest.error))}</Text>}
    {anomalous.length > 0 && <Text color="yellow">{t('Sample {0}: abnormal distribution. This result is unreliable. The prompt causes it, so {1}.', anomalous.map(index => index + 1).join(', '), options.challenges ? t('replace these prompts in the --challenges file') : t('rerun to draw new prompts'))}</Text>}
    {latest?.analysis && latest.analysis.results.length > 0 && <Ranking analysis={latest.analysis} compact={compact} safe={safe} />}
    {state.total > 1 && history.length > 0 && <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">{t('ROUNDS')} <Text dimColor>{t(' · {0}/{1} settled · {2} scored', completed, state.total, scored)}</Text></Text>
      {visibleHistory.map(round => <Box key={round.index}>
        <Box width={5}><Text dimColor>#{round.index}</Text></Box>
        <Box flexGrow={1} flexBasis={0}><Text wrap="truncate-end" color={round.error ? 'yellow' : undefined}>{safe(round.analysis?.prediction_name || t('Not scored'))}</Text></Box>
        <Box width={7} justifyContent="flex-end"><Text dimColor>{round.samples.filter(acceptedSample).length}/{round.samples.length}</Text></Box>
        <Box width={10} justifyContent="flex-end"><Text>{percentage(round.analysis?.verification_confidence)}</Text></Box>
      </Box>)}
      {history.length > visibleHistory.length && <Text dimColor>{t('Showing the last {0} rounds. Use --output to save every round.', visibleHistory.length)}</Text>}
      {state.finishedAt && consensus && <Text>{tied ? t('Tied lead') : t('Most frequent')}: <Text bold>{safe(consensus[0])}</Text>{tied ? t(' and others') : ''}{t(' · {0}/{1} scored rounds', consensus[1], scored)}</Text>}
    </Box>}
    <Box marginTop={1} flexDirection="column">
      {fatal && <Text color="red">{safe(fatal)}</Text>}
      {saved && <Text color="green">{t('Saved {0}', safe(saved))}</Text>}
      <Text dimColor>{state.finishedAt ? t('{0}/{1} rounds scored · {2}', scored, state.total, elapsed) : t('q / Ctrl+C to cancel · each round waits for all requested samples')}</Text>
      {state.finishedAt && scored > 0 && !fatal && <StarNote />}
    </Box>
    {updateNotice && <Box marginTop={1} flexDirection="column">
      <Text color="yellow">{t('Update available: {0} → {1}', updateNotice.current, updateNotice.latest)}</Text>
      <Text>{updateNotice.temporary ? t('Run the latest version') : t('Update')}: <Text color="cyan">{updateNotice.command}</Text></Text>
    </Box>}
  </Box>
}

export interface DetectionDisplay {
  update(state: DetectionState): void
  finish(saved?: string, fatal?: string, updateNotice?: UpdateNotice): Promise<void>
}

export function createDisplay(options: DetectOptions, bankSize: number, cancel: () => void): DetectionDisplay {
  let state: DetectionState = { rounds: [], total: options.repeat, startedAt: Date.now(), cancelled: false }
  const terminal = !!process.stdout.isTTY && !process.env.CI && process.env.TERM !== 'dumb'
  const view = render(<Dashboard state={state} options={options} bankSize={bankSize} cancel={cancel} />, {
    exitOnCtrlC: false, patchConsole: false, maxFps: 10, interactive: terminal,
  })
  const settled = new Set<string>()
  return {
    update(next: DetectionState) {
      state = next
      if (!terminal && !options.input) {
        const round = state.rounds.at(-1)
        round?.samples.forEach((sample, index) => {
          const id = `${round.index}:${index}`
          if (!sample.finishedAt || settled.has(id)) return
          settled.add(id)
          process.stderr.write(`${t('[{0}/{1}] Sample {2}: {3} ({4}/{5})', round.index, state.total, index + 1, t(labels[sample.state]), sample.count, sample.expectedCount)}${sample.throughput ? ` · ${speed(sample, true)}` : ''}${sample.error ? ` · ${translateLabel(sample.error)}` : ''}\n`)
        })
      }
      view.rerender(<Dashboard state={state} options={options} bankSize={bankSize} cancel={cancel} />)
    },
    async finish(saved?: string, fatal?: string, updateNotice?: UpdateNotice) {
      state = { ...state, finishedAt: state.finishedAt ?? Date.now() }
      view.rerender(<Dashboard state={state} options={options} bankSize={bankSize} cancel={cancel} saved={saved} fatal={fatal} updateNotice={updateNotice} />)
      await view.waitUntilRenderFlush()
      view.unmount()
    },
  }
}
