// Builds dist/lmfpd-data, the npm package that JSDMirror (cdn.jsdmirror.com) mirrors for the SDKs. It holds bundle.json
// and the detector chunks it lists, in the same layout as the site's /data/. .github/workflows/publish-data.yml runs it
// and publishes the result whenever the data changes on main.
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../..', import.meta.url))
const destination = resolve(root, 'dist/lmfpd-data')
const version = process.env.LMFPD_DATA_VERSION || `0.0.${Date.now()}`
if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/.test(version)) throw new Error('LMFPD_DATA_VERSION must be a valid semantic version.')

// Reuse the website's integrity check and public metadata redaction; it also writes bundle.json.
execFileSync('bun', ['web/scripts/sync-data.ts'], { cwd: root, stdio: 'inherit' })
const data = resolve(root, 'web/public/data')
const bundle: { built_at: string; files: Record<string, { parts: string[] }> } = JSON.parse(await readFile(resolve(data, 'bundle.json'), 'utf8'))

await rm(destination, { recursive: true, force: true })
await mkdir(resolve(destination, 'chunks'), { recursive: true })
const parts = Object.values(bundle.files).flatMap(file => file.parts)
await Promise.all([
  ...parts.map(part => copyFile(resolve(data, 'chunks', part), resolve(destination, 'chunks', part))),
  copyFile(resolve(data, 'bundle.json'), resolve(destination, 'bundle.json')),
  copyFile(resolve(root, 'LICENSE'), resolve(destination, 'LICENSE')),
  writeFile(resolve(destination, 'package.json'), JSON.stringify({
    name: 'lmfpd-data', version, description: `lmfpd reference data built ${bundle.built_at}, mirrored for the lmfpd SDKs`,
    license: 'MIT', homepage: 'https://lm.ikale.io',
    repository: { type: 'git', url: 'git+https://github.com/Ikaleio/lm-detector.git' },
    files: ['bundle.json', 'chunks', 'LICENSE'],
  }, null, 2) + '\n'),
])
console.log(`Built lmfpd-data@${version} (${bundle.built_at}) in dist/lmfpd-data.`)
