// Runs the conformance check of every SDK against sdk/conformance and data/. Run from projects/.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const conformance = resolve('sdk/conformance'), data = resolve('data')
const runners: [string, string[], string?][] = [
  ['bun', ['sdk/ts/scripts/conformance.ts', conformance, data]],
  ['cargo', ['run', '--quiet', '--release', '--manifest-path', 'sdk/rust/Cargo.toml', '--example', 'conformance', '--', conformance, data]],
  ['go', ['run', './cmd/conformance', conformance, data], 'sdk/go'],
  ['uv', ['run', '--project', 'sdk/python', 'python', 'sdk/python/scripts/conformance.py', conformance, data]],
]
for (const [command, args, cwd] of runners) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const { status, error } = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (error) throw error
  if (status !== 0) process.exit(status ?? 1)
}
