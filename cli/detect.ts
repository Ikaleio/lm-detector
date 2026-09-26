import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Bank } from '@fingerpoint/shared/types'
import type { SharedDetector } from '@fingerpoint/shared/shared-detector'
import { parseOptions, requestEndpoint } from './detect-options'
import { errorMessage } from './detect-request'
import { analyzeInput, loadChallenges, readJson, runDetection, serializeResult } from './detect-run'
import { startUpdateCheck } from './detect-update'
import type { UpdateCheck } from './detect-update'
import { createDisplay } from './detect-ui'
import type { DetectionDisplay } from './detect-ui'
import { printHelp } from './detect-help'

export async function runDetectionCommand(args: string[]) {
  let key = ''
  let display: DetectionDisplay | undefined
  let stopUpdateCheck: UpdateCheck | undefined
  const abort = new AbortController()
  const cancel = () => abort.abort()
  const terminate = () => { process.exitCode = 143; abort.abort() }

  try {
    // Redact explicit credentials even when argument parsing fails.
    for (let index = 0; index < args.length; index++) {
      const argument = args[index]
      if (['--apikey', '--api-key', '-k'].includes(argument)) key = args[++index] ?? ''
      else if (/^--(apikey|api-key)=/.test(argument)) key = argument.slice(argument.indexOf('=') + 1)
      else if (argument.startsWith('-k') && argument.length > 2) key = argument.slice(2)
    }
    key ||= process.env.API_KEY ?? ''
    const options = parseOptions(args)
    if (!options) {
      await printHelp()
    } else {
      key = options.config.apiKey
      if (!options.input) requestEndpoint(options.config)
      if (options.updateCheck && !options.input && !options.json && process.stdout.isTTY && !process.env.CI && process.env.TERM !== 'dumb') {
        stopUpdateCheck = startUpdateCheck()
      }
      const [bankData, detectorData, challenges] = await Promise.all([
        readJson(options.bank ?? fileURLToPath(new URL('../data/unified_bank.json', import.meta.url))),
        readJson(fileURLToPath(new URL('../data/shared_detector.json', import.meta.url))),
        loadChallenges(options.challenges, options.count),
      ])
      const bank = bankData as Bank, detector = detectorData as SharedDetector
      if (!Array.isArray(bank?.models) || !bank.models.length) throw new Error('The reference bank must contain a nonempty models array.')
      if (detector?.schema !== 'shared-detector-v1') throw new Error('The detector artifact has an unsupported schema.')
      process.on('SIGINT', cancel)
      process.on('SIGTERM', terminate)
      if (!options.json) display = createDisplay(options, bank.models.length, cancel)
      const state = options.input ? await analyzeInput(options, bank, detector)
        : await runDetection(options, bank, detector, state => display?.update(state), abort.signal, challenges)
      display?.update(state)
      const serialized = serializeResult(state, options, bank)
      if (options.output) await writeFile(options.output, serialized, { mode: 0o600 })
      if (options.json) process.stdout.write(serialized)
      const updateNotice = stopUpdateCheck?.()
      await display?.finish(options.output, undefined, state.cancelled ? undefined : updateNotice)
      display = undefined
      if (state.cancelled) process.exitCode = process.exitCode || 130
      else if (state.rounds.some(round => round.error)) process.exitCode = 1
    }
  } catch (error) {
    stopUpdateCheck?.()
    const message = errorMessage(error, key)
    if (display) await display.finish(undefined, message)
    else process.stderr.write(`Error: ${message}\nUse --help for usage.\n`)
    process.exitCode = 1
  } finally {
    stopUpdateCheck?.()
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', terminate)
  }
}
