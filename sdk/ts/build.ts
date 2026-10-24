import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('../..', import.meta.url))
const destination = resolve(root, 'dist/lmfpd-sdk')
const manifest = JSON.parse(await readFile(new URL('./npm-package.json', import.meta.url), 'utf8'))
const version = process.env.LMFPD_SDK_VERSION || `0.0.${Date.now()}`
if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) {
  throw new Error('LMFPD_SDK_VERSION must be a valid semantic version.')
}

await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })
// The package has no dependencies: the bundle includes the shared scoring code and fzstd.
execFileSync('bun', [
  'build', resolve(root, 'sdk/ts/src/index.ts'), '--outdir', destination, '--entry-naming', 'index.js', '--target', 'node',
], { cwd: root, stdio: 'inherit' })
execFileSync('bunx', ['tsc', '-p', 'sdk/ts/tsconfig.build.json'], { cwd: root, stdio: 'inherit' })

await Promise.all([
  copyFile(resolve(root, 'sdk/ts/README.md'), resolve(destination, 'README.md')),
  copyFile(resolve(root, 'LICENSE'), resolve(destination, 'LICENSE')),
  writeFile(resolve(destination, 'package.json'), JSON.stringify({
    ...manifest, version,
    ...(process.env.GITHUB_SHA ? { gitHead: process.env.GITHUB_SHA } : {}),
  }, null, 2) + '\n'),
])
console.log(`Built ${manifest.name}@${version} in dist/lmfpd-sdk.`)
