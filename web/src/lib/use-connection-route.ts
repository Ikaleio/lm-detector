import { useCallback, useState } from 'react'
import { coded, endpoint } from '@fingerpoint/shared/detection'
import { isLocalApiUrl } from '@fingerpoint/shared/api-url'
import type { ApiConfig } from '@fingerpoint/shared/types'
import type { Route } from '@/lib/client'
import { allowsDirect, connectionSetting, SITE_PROXY } from '@/lib/route'

/**
 * Decides the route for one run from the connection setting. Auto mode checks the endpoint once (`checking` is true
 * meanwhile) and goes direct when the browser can read its answer, otherwise through this site's proxy. Rejects with
 * `invalid_base_url`, or with `proxy_missing` when Worker mode has no valid address; nothing is sent in either case.
 * Local API targets always go direct because cloud relays cannot reach the user's local network.
 */
export function useConnectionRoute() {
  const [checking, setChecking] = useState(false)

  const resolve = useCallback(async (config: ApiConfig): Promise<Route> => {
    const url = endpoint(config)
    if (isLocalApiUrl(new URL(url))) return { kind: 'direct' }
    const { mode, endpoint: worker } = connectionSetting()
    if (mode === 'direct') return { kind: 'direct' }
    if (mode === 'site') return { kind: 'proxy', endpoint: SITE_PROXY }
    if (mode === 'worker') {
      if (!worker) throw coded('Worker mode has no valid Worker address.', 'proxy_missing')
      return { kind: 'proxy', endpoint: worker }
    }
    setChecking(true)
    try {
      return await allowsDirect(url, config) ? { kind: 'direct' } : { kind: 'proxy', endpoint: SITE_PROXY }
    } finally { setChecking(false) }
  }, [])

  return { resolve, checking }
}
