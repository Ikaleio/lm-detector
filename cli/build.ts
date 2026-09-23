import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const destination = resolve(root, 'dist/fpd')
const manifest = JSON.parse(await readFile(new URL('./npm-package.json', import.meta.url), 'utf8'))
const version = process.env.FPD_VERSION || `0.0.${Date.now()}`
if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) {
  throw new Error('FPD_VERSION must be a valid semantic version.')
}

// Reuse the website's bank integrity check and public metadata redaction.
execFileSync('bun', ['web/scripts/sync-data.ts'], { cwd: root, stdio: 'inherit' })

await rm(destination, { recursive: true, force: true })
await mkdir(resolve(destination, 'bin'), { recursive: true })
await mkdir(resolve(destination, 'data'), { recursive: true })

// Keep Ink and its WASM dependency as npm packages. Bundle all local algorithm code.
const dependencies: Record<string, string> = {}
for (const name of ['ink', 'react', 'terminal-link']) {
  const installed = JSON.parse(await readFile(new URL(`./node_modules/${name}/package.json`, import.meta.url), 'utf8'))
  dependencies[name] = installed.version
}
execFileSync('bun', [
  'build', resolve(root, 'cli/detect.ts'), '--outdir', resolve(destination, 'bin'),
  '--entry-naming', 'fpd.js', '--target', 'node',
  '--define', 'process.env.NODE_ENV="production"',
  '--define', `FPD_BUILD_VERSION=${JSON.stringify(version)}`,
  ...Object.keys(dependencies).flatMap(name => ['--external', name]),
], { cwd: root, stdio: 'inherit' })
const executable = resolve(destination, 'bin/fpd.js')
const bundle = await readFile(executable, 'utf8')
if (!bundle.startsWith('#!/usr/bin/env bun\n')) throw new Error('Unexpected CLI bundle shebang.')
await writeFile(executable, bundle.replace(/^#![^\n]+/, '#!/usr/bin/env node'))
await chmod(executable, 0o755)

await Promise.all([
  ...['unified_bank.json', 'shared_detector.json'].map(name =>
    copyFile(resolve(root, 'web/public/data', name), resolve(destination, 'data', name))),
  copyFile(resolve(root, 'cli/README.md'), resolve(destination, 'README.md')),
  copyFile(resolve(root, 'LICENSE'), resolve(destination, 'LICENSE')),
  writeFile(resolve(destination, 'package.json'), JSON.stringify({
    ...manifest, version, dependencies,
    ...(process.env.GITHUB_SHA ? { gitHead: process.env.GITHUB_SHA } : {}),
  }, null, 2) + '\n'),
])
console.log(`Built ${manifest.name}@${version} in dist/fpd.`)
