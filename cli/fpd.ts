#!/usr/bin/env bun

// Ink and React stay external npm packages, so they read NODE_ENV when they load. Static imports would load them
// before this line, so the commands are imported dynamically. React's development build records every render with
// performance.measure, Node keeps each entry, and long runs exhaust the heap.
process.env.NODE_ENV = 'production'

const [command, ...args] = process.argv.slice(2)
if (command === 'sample' || command === 'enroll') {
  const { runCollectionCommand } = await import('./collection-command')
  await runCollectionCommand(command, args)
} else if (command === 'retrain') {
  const { runRetrainCommand } = await import('./retrain-command')
  try { await runRetrainCommand(args) }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
} else {
  const { runDetectionCommand } = await import('./detect')
  await runDetectionCommand(command === 'detect' ? args : process.argv.slice(2))
}

export {}
