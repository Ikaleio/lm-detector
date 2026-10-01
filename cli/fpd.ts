#!/usr/bin/env bun

import { runCollectionCommand } from './collection-command'
import { runDetectionCommand } from './detect'
import { runRetrainCommand } from './retrain-command'
import { configureLanguage, t } from './i18n'

try {
  const argv = configureLanguage(process.argv.slice(2))
  const [command, ...args] = argv
  if (command === 'sample' || command === 'enroll') {
    await runCollectionCommand(command, args)
  } else if (command === 'retrain') {
    await runRetrainCommand(args)
  } else {
    await runDetectionCommand(command === 'detect' ? args : argv)
  }
} catch (error) {
  console.error(t('Error') + ': ' + (error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
}
