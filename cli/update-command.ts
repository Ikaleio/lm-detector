import { access, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'

type Manager = 'bun' | 'npm' | 'pnpm' | 'yarn'
export interface UpdateCommand { command: string; temporary: boolean }

const normalize = (path: string) => path.replaceAll('\\', '/')
const managerName = (value: string): Manager | undefined => /^(bun|npm|pnpm|yarn)(?:[\/@]|$)/.exec(value)?.[1] as Manager | undefined
const available = async (path: string) => access(path).then(() => true, () => false)

function commandFor(manager: Manager, scope: 'temporary' | 'global' | 'local', root?: string): UpdateCommand {
  if (scope === 'temporary') {
    const runner = { bun: 'bunx', npm: 'npx', pnpm: 'pnpm dlx', yarn: 'yarn dlx' }[manager]
    return { command: `${runner} lmfpd@latest`, temporary: true }
  }
  const install = manager === 'npm' ? 'npm install' : `${manager} add`
  const command = manager === 'yarn' && scope === 'global' ? 'yarn global add'
    : `${install}${scope === 'global' ? ' -g' : ''}`
  const quote = (value: string) => `'${value.replaceAll("'", process.platform === 'win32' ? "''" : "'\"'\"'")}'`
  const directoryFlag = { npm: '--prefix', pnpm: '--dir', bun: '--cwd', yarn: '--cwd' }[manager]
  const directory = root && normalize(resolve(root)) !== normalize(process.cwd()) ? ` ${directoryFlag} ${quote(root)}` : ''
  return { command: `${command}${directory} lmfpd@latest`, temporary: false }
}

export async function detectUpdateCommand(entry: string, env = process.env): Promise<UpdateCommand> {
  const resolved = await realpath(entry).catch(() => resolve(entry))
  const paths = [normalize(entry), normalize(resolved)]
  const agent = managerName(env.npm_config_user_agent ?? '')
  const executable = normalize(env.npm_execpath ?? '')
  const manager = agent ?? /(?:^|\/)(bun|npm|pnpm|yarn)(?:[.-]|$)/.exec(executable)?.[1] as Manager | undefined

  // Installation paths take precedence over the runtime or an enclosing package script.
  for (const path of paths) {
    if (/\/bunx-[^/]+\//.test(path)) return commandFor('bun', 'temporary')
    if (/\/_npx\//.test(path)) return commandFor('npm', 'temporary')
    if (/\/(?:pnpm[^/]*\/.*)?dlx\//.test(path) && (path.includes('/pnpm') || manager === 'pnpm')) return commandFor('pnpm', 'temporary')
    if (/\/(?:dlx-[^/]+|yarn\/.*\/dlx)\//.test(path)) return commandFor('yarn', 'temporary')
  }
  for (const path of paths) {
    const bunRoot = normalize(env.BUN_INSTALL ?? '')
    if (/\/(?:\.bun|bun)\/install\/global\//.test(path) || (bunRoot && path.startsWith(`${bunRoot}/install/global/`))) return commandFor('bun', 'global')
    if (/\/pnpm\/global\//i.test(path) || /\/global\/\d+\/(?:\.pnpm\/|node_modules\/)/.test(path)) return commandFor('pnpm', 'global')
    if (/\/yarn\/global\//i.test(path)) return commandFor('yarn', 'global')
    if (/\/lib\/node_modules\/lmfpd\//.test(path) || /\/AppData\/Roaming\/npm\/node_modules\/lmfpd\//i.test(path)) return commandFor('npm', 'global')
  }

  const modules = normalize(resolved).indexOf('/node_modules/')
  if (modules >= 0) {
    // For pnpm's virtual store, inspect the project containing the outer node_modules.
    const root = normalize(resolved).slice(0, modules)
    let declared: Manager | undefined
    try { declared = managerName(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).packageManager ?? '') } catch {}
    const locks: [Manager, string][] = [['bun', 'bun.lock'], ['bun', 'bun.lockb'], ['pnpm', 'pnpm-lock.yaml'], ['yarn', 'yarn.lock'], ['npm', 'package-lock.json']]
    const found = await Promise.all(locks.map(async ([name, lock]) => await available(join(root, lock)) ? name : undefined))
    const markers: [Manager, string][] = [['pnpm', '.modules.yaml'], ['bun', '.bun'], ['npm', '.package-lock.json'], ['yarn', '.yarn-state.yml'], ['yarn', '.yarn-integrity']]
    const installedBy = await Promise.all(markers.map(async ([name, marker]) => await available(join(root, 'node_modules', marker)) ? name : undefined))
    const installed = installedBy.find(Boolean) ?? (normalize(resolved).includes('/node_modules/.pnpm/') ? 'pnpm' : undefined) ?? declared ?? found.find(Boolean) ?? manager
    if (installed) return commandFor(installed, 'local', root)
  }
  if (manager) return commandFor(manager, 'temporary')
  // A copied executable carries no installer identity. Offer a runner, not a guessed global install.
  return commandFor('bun', 'temporary')
}
