import { coded } from '@fingerpoint/shared/detection'
import { isLocalApiUrl } from '@fingerpoint/shared/api-url'
import {
  fetchModelList,
  type ListedModel,
  type ModelListConfig,
  type ModelListPage,
  type ModelsTransport,
} from '@fingerpoint/shared/model-list'
import type { Route } from '@/lib/client'
import { connectionSetting, directHeaders, directInit, SITE_PROXY } from '@/lib/route'

function placeholderKey(apiKey: string): string {
  return apiKey.trim() || 'sk-none'
}

function directModelsHeaders(config: ModelListConfig): Record<string, string> {
  const headers = directHeaders(config, config.apiKey, false)
  delete headers['Content-Type']
  headers.Accept = 'application/json'
  if (!config.apiKey) {
    delete headers.Authorization
    delete headers['x-api-key']
  }
  return headers
}

const directModelsTransport: ModelsTransport = (url, config, signal, page) => {
  const target = page ? new URL(url) : url
  if (page && target instanceof URL) {
    target.searchParams.set(page.param ?? 'after_id', page.afterId)
  }
  return fetch(typeof target === 'string' ? target : target.href, {
    ...directInit,
    method: 'GET',
    headers: directModelsHeaders(config),
    signal,
  }).catch(error => {
    if (!(error instanceof TypeError)) throw error
    const href = typeof target === 'string' ? target : target.href
    const code = isLocalApiUrl(new URL(href)) ? 'local_direct_network' : 'direct_network'
    throw coded('The browser could not call the API directly.', code)
  })
}

function proxyModelsTransport(endpoint: string): ModelsTransport {
  return (url, config, signal, page?: ModelListPage) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${placeholderKey(config.apiKey)}`,
      Accept: 'application/json',
    }
    return fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url,
        format: config.format,
        method: 'GET',
        ...(page?.afterId ? { after_id: page.afterId, ...(page.param ? { after_param: page.param } : {}) } : {}),
      }),
      signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    })
  }
}

function transportFor(route: Route): ModelsTransport {
  return route.kind === 'direct' ? directModelsTransport : proxyModelsTransport(route.endpoint)
}

/**
 * Lists models through the same connection route as detection. An older proxy that cannot relay GET /models
 * is retried once as a direct browser call, so a CORS-friendly API still works before the Worker is updated.
 */
export async function fetchModelsForConfig(
  config: ModelListConfig,
  route: Route,
  signal?: AbortSignal,
): Promise<ListedModel[]> {
  try {
    return await fetchModelList(config, transportFor(route), signal)
  } catch (error) {
    const code = (error as { code?: string }).code
    // Auto probes the completion endpoint, so it can pick a direct route even when GET /models is blocked by CORS.
    if (route.kind === 'direct' && code === 'direct_network' && connectionSetting().mode === 'auto') {
      try {
        return await fetchModelList(config, proxyModelsTransport(SITE_PROXY), signal)
      } catch (proxyError) {
        const proxyCode = (proxyError as { code?: string }).code
        if (proxyCode === 'proxy_unavailable' || proxyCode === 'network' || proxyCode === 'direct_network') throw error
        throw proxyError
      }
    }
    if (route.kind !== 'proxy' || code !== 'proxy_models_unsupported') throw error
    try {
      return await fetchModelList(config, directModelsTransport, signal)
    } catch (directError) {
      const directCode = (directError as { code?: string }).code
      if (directCode === 'direct_network' || directCode === 'local_direct_network') {
        throw coded('The proxy cannot list models, and the browser could not call the API directly.', 'proxy_models_unsupported_cors')
      }
      throw directError
    }
  }
}

export type { ListedModel }
