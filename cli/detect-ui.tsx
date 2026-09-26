import { useEffect, useState } from 'react'
import { Box, Text, render, useInput, useWindowSize } from 'ink'
import terminalLink from 'terminal-link'
import type { Analysis } from '@fingerpoint/shared/types'
import type { DetectOptions } from './detect-options'
import type { DetectionState } from './detect-run'
import { acceptedSample, cleanText, type Sample } from './detect-request'
import type { UpdateNotice } from './detect-update'

const seconds = (milliseconds: number) => `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`
const percentage = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`
const labels: Record<Sample['state'], string> = {
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
    <Text bold color="cyan">LEADING CANDIDATES</Text>
    <Box>
      <Box width={4}><Text dimColor>#</Text></Box>
      <Box flexGrow={1}><Text dimColor>Model</Text></Box>
      <Box width={9} justifyContent="flex-end"><Text dimColor>Score</Text></Box>
      <Box width={12} justifyContent="flex-end"><Text dimColor>{calibrated ? 'Confidence' : hasConfidence ? 'Verifier' : 'Confidence'}</Text></Box>
    </Box>
    {analysis.results.slice(0, compact ? 3 : 5).map((row, index) => <Box key={row.model}>
      <Box width={4}><Text color={index === 0 ? 'cyan' : undefined}>{index + 1}</Text></Box>
      <Box flexGrow={1} flexBasis={0}><Text wrap="truncate-end" bold={index === 0}>{safe(row.display_name)}</Text></Box>
      <Box width={9} justifyContent="flex-end"><Text>{row.score.toFixed(3)}</Text></Box>
      <Box width={12} justifyContent="flex-end"><Text color={index === 0 ? 'cyan' : undefined}>{percentage(row.verification_confidence)}</Text></Box>
    </Box>)}
    <Text dimColor>{analysis.decision === 'partial' ? 'Partial ranking · confidence unavailable'
      : calibrated ? 'Confidence is relative to the reference bank; it does not prove identity.'
      : hasConfidence ? 'Verifier values are uncalibrated scores, not identity probabilities.' : 'Confidence unavailable for this bank.'}</Text>
    {!compact && <Text dimColor>{safe(analysis.evidence.label)}</Text>}
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
  const phase = state.cancelled ? 'Cancelled' : state.finishedAt ? 'Finished' : 'Detecting'
  const spinner = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor(now / 100) % 10]
  const history = state.rounds.filter(round => round.finishedAt)
  const visibleHistory = history.slice(compact ? -3 : -5)
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
      <Text dimColor>{options.input ? 'Saved outputs' : `${options.api} · ${options.config.stream ? 'SSE' : 'JSON'} · count ${options.count} · parallel ${options.parallel}`} · {options.strict ? 'strict' : 'relaxed'} · {bankSize} models</Text>
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
        return <Box key={index} flexDirection="column">
          <Box>
            <Box width={5}><Text dimColor>#{index + 1}</Text></Box>
            <Box width={12}><Text color={colors[sample.state]}>{active ? spinner : acceptedSample(sample) ? '✓' : sample.state === 'failed' ? '×' : '·'} {labels[sample.state]}</Text></Box>
            {columns >= 75 && <Box width={15}><Text color={colors[sample.state]}>{'━'.repeat(filled)}<Text dimColor>{'─'.repeat(12 - filled)}</Text></Text></Box>}
            <Box flexGrow={1}><Text>{sample.count}/{sample.expectedCount}</Text></Box>
            <Text dimColor>{time}</Text>
          </Box>
          {sample.error && <Text color="red" wrap="truncate-end">   {safe(sample.error)}</Text>}
        </Box>
      })}
    </Box>}
    {latest?.error && <Text color="yellow">{safe(latest.error)}</Text>}
    {latest?.analysis && latest.analysis.results.length > 0 && <Ranking analysis={latest.analysis} compact={compact} safe={safe} />}
    {state.total > 1 && history.length > 0 && <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">ROUNDS <Text dimColor> · {completed}/{state.total} settled · {scored} scored</Text></Text>
      {visibleHistory.map(round => <Box key={round.index}>
        <Box width={5}><Text dimColor>#{round.index}</Text></Box>
        <Box flexGrow={1} flexBasis={0}><Text wrap="truncate-end" color={round.error ? 'yellow' : undefined}>{safe(round.analysis?.prediction_name || 'Not scored')}</Text></Box>
        <Box width={7} justifyContent="flex-end"><Text dimColor>{round.samples.filter(acceptedSample).length}/{round.samples.length}</Text></Box>
        <Box width={10} justifyContent="flex-end"><Text>{percentage(round.analysis?.verification_confidence)}</Text></Box>
      </Box>)}
      {history.length > visibleHistory.length && <Text dimColor>Showing the last {visibleHistory.length} rounds. Use --output to save every round.</Text>}
      {state.finishedAt && consensus && <Text>{tied ? 'Tied lead' : 'Most frequent'}: <Text bold>{safe(consensus[0])}</Text>{tied ? ' and others' : ''} · {consensus[1]}/{scored} scored rounds</Text>}
    </Box>}
    <Box marginTop={1} flexDirection="column">
      {fatal && <Text color="red">{safe(fatal)}</Text>}
      {saved && <Text color="green">Saved {safe(saved)}</Text>}
      <Text dimColor>{state.finishedAt ? `${scored}/${state.total} rounds scored · ${elapsed}` : 'q / Ctrl+C to cancel · each round waits for all requested samples'}</Text>
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
          process.stderr.write(`[${round.index}/${state.total}] Sample ${index + 1}: ${labels[sample.state]} (${sample.count}/${sample.expectedCount})${sample.error ? ` · ${sample.error}` : ''}\n`)
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
