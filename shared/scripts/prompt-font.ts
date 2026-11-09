/**
 * Rebuilds `shared/prompt-font.otf`, the subset of Noto Sans CJK SC that image mode draws prompts with:
 *
 *   bun shared/scripts/prompt-font.ts path/to/NotoSansCJKsc-Regular.otf
 *
 * The subset keeps printable ASCII and every character of `shared/challenge-browser.js`, so run it again whenever the
 * challenge templates change. fonttools runs through uvx.
 */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const [source] = process.argv.slice(2)
if (!source) throw new Error('Usage: bun shared/scripts/prompt-font.ts NotoSansCJKsc-Regular.otf')
const templates = await readFile(new URL('../challenge-browser.js', import.meta.url), 'utf8')
const ascii = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join('')
const text = [...new Set(ascii + templates.replace(/[\0-\x1f]/g, ''))].join('')
// All name records stay, so the subset still carries the copyright notice and the OFL. Layout features go: the
// drawing uses plain advances, and the features would grow the file by more than half.
execFileSync('uvx', [
  '--from', 'fonttools', 'pyftsubset', source, `--text=${text}`, '--name-IDs=*', '--no-hinting', '--layout-features=',
  `--output-file=${fileURLToPath(new URL('../prompt-font.otf', import.meta.url))}`,
], { stdio: 'inherit' })
