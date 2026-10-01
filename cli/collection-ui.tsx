import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Text, render, useInput, useWindowSize } from 'ink'
import { t, translateLabel } from './i18n'
import type { Receipt } from './enrollment'

export interface CollectionProgress {
  total: number
  accepted: number
  failed: number
  pending: number
  startedAt: number
  active: { id: string; attempt: number; count: number; expected: number; state: string }[]
  failures: { id: string; message: string }[]
}

export interface CollectionReport {
  status: 'complete' | 'partial' | 'enrolled' | 'cancelled' | 'validated'
  directory: string
  total: number
  accepted: number
  natural: number
  truncated: number
  unknownCompletion: number
  failed: number
  pending: number
  elapsedMs: number
  enrollment?: Receipt
  destination?: string
  error?: string
  next: string[]
}

export class CollectionCancelled extends Error {
  constructor() { super('Cancelled.'); this.name = 'CollectionCancelled' }
}

export function terminalText(value: string, secret = ''): string {
  const redacted = secret ? value.replaceAll(secret, '[REDACTED]') : value
  return redacted.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  const { columns } = useWindowSize()
  return <Box flexDirection="column" width={Math.max(12, Math.min(columns || 80, 100))} paddingX={columns < 45 ? 0 : 1}>
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text><Text bold color="cyan">FPD</Text><Text dimColor> / {t('REFERENCE COLLECTION')}</Text></Text>
      <Text bold>{title}</Text>
    </Box>
    {children}
  </Box>
}

interface Field {
  title: string
  label: string
  hint?: string
  defaultValue?: string
  secret?: boolean
  validate?: (value: string) => void
}

function FieldPrompt({ field, finish }: { field: Field; finish: (value?: string) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  useInput((input, key) => {
    if (key.ctrl && input === 'c' || key.escape) { finish(); return }
    if (key.return) {
      const answer = value.trim() || field.defaultValue || ''
      try { field.validate?.(answer); finish(answer) }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
      return
    }
    if (key.backspace || key.delete) { setValue(previous => Array.from(previous).slice(0, -1).join('')); setError(''); return }
    if (key.ctrl && input === 'u') { setValue(''); return }
    if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) {
      setValue(previous => previous + input.replace(/[\x00-\x1f\x7f-\x9f]/g, ''))
      setError('')
    }
  })
  return <Frame title={field.title}>
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">{field.label}</Text>
      {field.hint && <Text dimColor>{field.hint}</Text>}
      <Text><Text color="cyan">› </Text>{field.secret ? '*'.repeat(Array.from(value).length) : terminalText(value)}<Text inverse> </Text></Text>
      {field.defaultValue && !value && <Text dimColor>{t('Enter to use {0}', field.secret ? t('the saved value') : terminalText(field.defaultValue))}</Text>}
      {error && <Text color="red">{terminalText(translateLabel(error))}</Text>}
      <Text dimColor>{t('Enter to continue · Esc / Ctrl+C to cancel')}</Text>
    </Box>
  </Frame>
}

export async function askCollectionField(field: Field): Promise<string> {
  let resolve!: (value?: string) => void
  const answer = new Promise<string | undefined>(done => { resolve = done })
  const view = render(<FieldPrompt field={field} finish={resolve} />, { stdout: process.stderr, exitOnCtrlC: false, patchConsole: false })
  try {
    const result = await answer
    view.clear()
    if (result === undefined) throw new CollectionCancelled()
    return result
  } finally { view.unmount() }
}

function Review({ title, rows, question, finish }: {
  title: string; rows: [string, string][]; question: string; finish: (yes: boolean) => void
}) {
  useInput((input, key) => {
    if (input.toLowerCase() === 'y') finish(true)
    else if (input.toLowerCase() === 'n' || key.return || key.escape || key.ctrl && input === 'c') finish(false)
  })
  const { columns } = useWindowSize()
  return <Frame title={title}>
    <Box flexDirection="column" marginTop={1}>
      {rows.map(([name, value], index) => columns < 55
        ? <Text key={index}><Text dimColor>{name}: </Text>{terminalText(value)}</Text>
        : <Box key={index}>
          <Box width={19}><Text dimColor>{name}</Text></Box>
          <Box flexGrow={1} flexBasis={0}><Text>{terminalText(value)}</Text></Box>
        </Box>)}
    </Box>
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">{question}</Text>
      <Text dimColor>{t('y to confirm · Enter / n / Esc to cancel')}</Text>
    </Box>
  </Frame>
}

export async function confirmCollection(title: string, rows: [string, string][], question: string): Promise<boolean> {
  let resolve!: (yes: boolean) => void
  const answer = new Promise<boolean>(done => { resolve = done })
  const view = render(<Review title={title} rows={rows} question={question} finish={resolve} />, { stdout: process.stderr, exitOnCtrlC: false, patchConsole: false })
  try { return await answer } finally { view.unmount() }
}

function Dashboard({ progress, model, directory, cancel, finished, secret }: {
  progress: CollectionProgress; model: string; directory: string; cancel: () => void; finished: boolean; secret: string
}) {
  const [now, setNow] = useState(Date.now())
  const [cancelling, setCancelling] = useState(false)
  const { columns, rows } = useWindowSize()
  useEffect(() => {
    if (finished) return
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [finished])
  useInput((input, key) => {
    if (input === 'q' || key.ctrl && input === 'c') { setCancelling(true); cancel() }
  }, { isActive: !finished })
  const width = Math.max(8, Math.min(36, columns - 16))
  const settled = progress.accepted + progress.failed
  const filled = progress.total ? Math.min(width, Math.round(width * settled / progress.total)) : 0
  const activeLimit = Math.max(1, Math.floor((rows - 13) / 2))
  const active = progress.active.slice(0, activeLimit)
  const failures = progress.failures.slice(rows < 28 ? -1 : -3)
  return <Frame title={t('Collect · {0}', terminalText(model, secret))}>
    <Box justifyContent="space-between" marginTop={1}>
      <Text bold color={cancelling ? 'yellow' : 'cyan'}>{cancelling ? t('Saving…') : finished ? t('Saved') : t('Collecting')} {settled}/{progress.total}</Text>
      <Text dimColor>{(Math.max(0, now - progress.startedAt) / 1000).toFixed(1)}s</Text>
    </Box>
    <Text color="cyan">{'━'.repeat(filled)}<Text dimColor>{'─'.repeat(width - filled)}</Text></Text>
    <Text><Text color="green">{t('{0} accepted', progress.accepted)}</Text> · <Text color="red">{t('{0} failed', progress.failed)}</Text> · <Text dimColor>{t('{0} pending', progress.pending)}</Text></Text>
    <Box flexDirection="column" marginTop={1}>
      {active.map(task => <Box flexDirection="column" key={task.id}>
        <Text wrap="truncate-end"><Text color="cyan">{terminalText(task.id, secret)}</Text> <Text dimColor>{t(' · attempt {0}', task.attempt)}</Text></Text>
        <Text>  {t('{0}/{1} numbers', task.count, task.expected)} <Text dimColor>· {terminalText(translateLabel(task.state))}</Text></Text>
      </Box>)}
      {progress.active.length > active.length && <Text dimColor>{t('+ {0} other active requests', progress.active.length - active.length)}</Text>}
    </Box>
    {failures.length > 0 && <Box flexDirection="column" marginTop={1}>
      <Text bold color="yellow">{t('RECENT FAILURES')}</Text>
      {failures.map((failure, index) => <Text key={index} color="yellow" wrap="truncate-end">{terminalText(failure.id, secret)} · {terminalText(translateLabel(failure.message), secret)}</Text>)}
    </Box>}
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor wrap="truncate-middle">{terminalText(directory, secret)}</Text>
      <Text dimColor>{finished ? t('Evidence saved.') : cancelling ? t('Cancelling active requests and saving evidence…') : t('q / Ctrl+C to cancel and save')}</Text>
    </Box>
  </Frame>
}

export function createCollectionDisplay(initial: CollectionProgress, model: string, directory: string, cancel: () => void, interactive: boolean, secret: string) {
  let progress = initial
  const view = interactive ? render(<Dashboard progress={progress} model={model} directory={directory} cancel={cancel} finished={false} secret={secret} />, {
    stdout: process.stderr, exitOnCtrlC: false, patchConsole: false, maxFps: 10,
  }) : undefined
  let lastSummary = ''
  return {
    update(next: CollectionProgress) {
      progress = next
      if (view) view.rerender(<Dashboard progress={progress} model={model} directory={directory} cancel={cancel} finished={false} secret={secret} />)
      else {
        const summary = t('{0}/{1} accepted · {2} failed · {3} pending', progress.accepted, progress.total, progress.failed, progress.pending)
        if (summary !== lastSummary) { process.stderr.write(summary + '\n'); lastSummary = summary }
      }
    },
    async finish() {
      if (!view) return
      view.rerender(<Dashboard progress={progress} model={model} directory={directory} cancel={cancel} finished secret={secret} />)
      await view.waitUntilRenderFlush()
      view.unmount()
    },
  }
}

function collectionStatus(status: CollectionReport['status']) {
  const labels = { complete: 'Complete', partial: 'Partial', enrolled: 'Enrolled', cancelled: 'Cancelled', validated: 'Validated' } as const
  return t(labels[status])
}

function Completion({ report }: { report: CollectionReport }) {
  return <Frame title={t('Completion · {0}', collectionStatus(report.status))}>
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={report.status === 'partial' || report.status === 'cancelled' ? 'yellow' : 'green'}>{t('{0}/{1} samples accepted', report.accepted, report.total)}</Text>
      <Text>{t('{0} natural completions · {1} accepted truncations', report.natural, report.truncated)}</Text>
      {report.unknownCompletion > 0 && <Text color="yellow">{t('{0} accepted with unknown completion', report.unknownCompletion)}</Text>}
      <Text dimColor>{t('{0} failed · {1} pending · {2}s', report.failed, report.pending, (report.elapsedMs / 1000).toFixed(1))}</Text>
      <Text>{t('Saved: {0}', terminalText(report.directory))}</Text>
      {report.destination && <Text color="green">{report.status === 'enrolled' ? t('Enrolled') : t('Destination')}: {terminalText(report.destination)}</Text>}
      {report.enrollment && <Text>{t('{0} new · {1} duplicates skipped · {2} total', report.enrollment.added, report.enrollment.skipped, report.enrollment.total)}{report.status === 'validated' ? t(' · dry run, no changes') : ''}</Text>}
      {report.destination && report.status === 'complete' && !report.enrollment && !report.error && <Text dimColor>{t('No reference data was written.')}</Text>}
      {report.status === 'enrolled' && !!report.enrollment?.added && <Text color="yellow">{t('Verifier/calibration not retrained. Confidence is unavailable until matching parameters are exported.')}</Text>}
      {report.error && <Text color="red">{terminalText(translateLabel(report.error))}</Text>}
      {report.next.map(command => <Text key={command} color="cyan">{terminalText(command)}</Text>)}
    </Box>
  </Frame>
}

export async function printCollectionReport(report: CollectionReport, json: boolean, interactive: boolean): Promise<void> {
  if (json) { process.stdout.write(JSON.stringify(report) + '\n'); return }
  if (interactive) {
    const view = render(<Completion report={report} />, { patchConsole: false })
    await view.waitUntilRenderFlush()
    view.unmount()
    return
  }
  process.stdout.write(t('{0}: {1}/{2} samples accepted ({3} natural completions, {4} accepted truncations)', collectionStatus(report.status), report.accepted, report.total, report.natural, report.truncated) + '\n' + t('Saved: {0}', report.directory) + '\n')
  if (report.unknownCompletion > 0) process.stdout.write(t('{0} accepted with unknown completion', report.unknownCompletion) + '\n')
  if (report.destination) process.stdout.write(`${report.status === 'enrolled' ? t('Enrolled') : t('Destination')}: ${report.destination}\n`)
  if (report.enrollment) process.stdout.write(`${t('{0} new · {1} duplicates skipped · {2} total', report.enrollment.added, report.enrollment.skipped, report.enrollment.total)}${report.status === 'validated' ? t(' · dry run, no changes') : ''}\n`)
  for (const command of report.next) process.stdout.write(command + '\n')
}

export async function printCollectionHelp(command: 'sample' | 'enroll', text: string, interactive: boolean): Promise<void> {
  if (!interactive) { process.stdout.write(text); return }
  const view = render(<Frame title={`${command === 'sample' ? t('Sample') : t('Enroll')} · ${t('Help')}`}>
    <Box flexDirection="column" marginTop={1}>
      {text.trimEnd().split('\n').map((line, index) => <Text key={index} color={line.startsWith(t('Usage:')) ? 'cyan' : undefined}>
        {line.startsWith('  --') ? <><Text color="cyan">{line.slice(0, 25)}</Text>{line.slice(25)}</> : line || ' '}
      </Text>)}
    </Box>
  </Frame>, { patchConsole: false })
  await view.waitUntilRenderFlush()
  view.unmount()
}
