import type { CodedError, ErrorCode } from '@fingerpoint/shared/types'
import type { I18n } from '@/i18n'

const codeKeys: Record<ErrorCode, Parameters<I18n['t']>[0]> = {
  invalid_base_url: 'errors.invalid_base_url',
  aborted: 'errors.aborted',
  timeout: 'errors.timeout',
  network: 'errors.network',
  http: 'errors.httpOther',
  proxy_unavailable: 'errors.proxy_unavailable',
  not_json: 'errors.not_json',
  no_stream_body: 'errors.no_stream_body',
  bad_stream_json: 'errors.bad_stream_json',
  upstream_stream_error: 'errors.upstream_stream_error',
  refused: 'errors.refused',
  incomplete: 'errors.incomplete',
  insufficient_numbers: 'errors.insufficient_numbers',
  no_output: 'errors.no_output',
  responses_incomplete: 'errors.responses_incomplete',
}

/** 把共享层错误映射为用户可读文案（design.md 6.4）。原始 message 由调用方放入「查看详情」。 */
export function describeError(i18n: I18n, error: unknown, fallbackKey: Parameters<I18n['t']>[0] = 'errors.unknown'): string {
  return describe(i18n, (error as CodedError)?.code, (error as CodedError)?.httpStatus, fallbackKey)
}

export function describe(i18n: I18n, code: ErrorCode | undefined, status: number | undefined, fallbackKey: Parameters<I18n['t']>[0] = 'errors.unknown'): string {
  if (status !== undefined && (code === 'http' || code === 'proxy_unavailable')) {
    if (code === 'proxy_unavailable') return i18n.t('errors.proxy_unavailable')
    if (status === 401 || status === 403) return i18n.t('errors.http401')
    if (status === 404) return i18n.t('errors.http404')
    if (status === 429) return i18n.t('errors.http429')
    if (status >= 500) return i18n.t('errors.http5xx')
    return i18n.t('errors.httpOther', { status })
  }
  if (code && codeKeys[code]) return i18n.t(codeKeys[code])
  return i18n.t(fallbackKey)
}

export const rawMessage = (error: unknown) => (error instanceof Error ? error.message : String(error ?? ''))
