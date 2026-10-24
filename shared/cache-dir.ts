import { homedir } from 'node:os'
import { join } from 'node:path'

/** The lmfpd cache directory: the CLI's update check and the SDK's reference data live under it. */
export function cacheRoot() {
  const home = homedir()
  const root = process.env.XDG_CACHE_HOME || (process.platform === 'darwin' ? join(home, 'Library/Caches')
    : process.platform === 'win32' ? process.env.LOCALAPPDATA || join(home, 'AppData/Local') : join(home, '.cache'))
  return join(root, 'lmfpd')
}
