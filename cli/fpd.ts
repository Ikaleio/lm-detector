#!/usr/bin/env bun

import { runCollectionCommand } from './collection-command'
import { runDetectionCommand } from './detect'
import { runRetrainCommand } from './retrain-command'

const [command, ...args] = process.argv.slice(2)
if (command === 'sample' || command === 'enroll') {
  await runCollectionCommand(command, args)
} else if (command === 'retrain') {
  try { await runRetrainCommand(args) }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
} else {
  await runDetectionCommand(command === 'detect' ? args : process.argv.slice(2))
}
