import { parseArgs } from 'node:util'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ApiConfig } from '@fingerpoint/shared/types'
import { CODEX_ENDPOINT } from './codex'
import { collect, createManifest, loadManifest, selectedAttempts, type Metadata } from './sampling'
import { enroll } from './enrollment'
import { saveJson, withLock } from './storage'

const help = `用法：bun run sample --output-dir DIR [metadata 和 API 参数]
续采：bun run sample --resume DIR [--max-attempts N] [--enroll]

新批次必须显式指定：
  --model MODEL           API 请求的模型 ID
  --label LABEL           参考库中的模型标签
  --family ID             模型家族 ID，例如 gpt、claude
  --family-name NAME      家族显示名称，例如 GPT、Claude
  --provider NAME         声明的模型提供方，例如 OpenAI
  --source KIND           openrouter（官方端点）、api（其他接口）、codex
  --source-name NAME      采集渠道名称
  --response-model ID     允许的响应模型 ID；可重复指定别名
  --format FORMAT         openai、responses、anthropic（Codex 固定 responses）
  --effort LEVEL          推理强度；使用 default 明确表示不传
  --base-url URL          HTTPS API 地址（Codex 模式不填）

运行选项：
  --output-dir DIR        创建新目录，不覆盖已有批次
  --resume DIR            使用原 manifest 续采，禁止覆盖 metadata 或请求参数
  --api-key-env NAME      密钥环境变量，默认 API_KEY；不写入文件
  --codex                 读取本机 Codex 登录；必须使用 --source codex
  --count N               固定挑战数量 1–36，默认全部 36 条
  --no-stream             非流式响应；默认流式
  --max-attempts N        每条挑战累计尝试上限 1–20，默认 3；续采可提高
  --enroll                完成后校验原始响应、去重入库并重建
  --data-dir DIR          入库目录，默认 monorepo 的 data/
  --help                  查看帮助

成功挑战不再请求；只采用首次成功回答，保留全部失败和中断记录。
断电后锁约 10 秒失效。完整落盘的响应优先离线恢复。
返回模型不符或 HTTP 400/401/402/403/404 会停止本轮，修复后显式续采。
退出码：0 完成，1 运行错误，2 采样未完整。`

let key = ''
try {
  const { values } = parseArgs({ args: process.argv.slice(2), strict: true, options: {
    'output-dir': { type: 'string' }, resume: { type: 'string' }, 'base-url': { type: 'string' },
    model: { type: 'string' }, label: { type: 'string' }, family: { type: 'string' },
    'family-name': { type: 'string' }, provider: { type: 'string' }, source: { type: 'string' },
    'source-name': { type: 'string' }, 'response-model': { type: 'string', multiple: true },
    format: { type: 'string' }, effort: { type: 'string' }, 'api-key-env': { type: 'string' },
    codex: { type: 'boolean' }, count: { type: 'string' }, 'no-stream': { type: 'boolean' },
    'max-attempts': { type: 'string' }, enroll: { type: 'boolean' }, 'data-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } })
  if (values.help) { console.log(help); process.exit(0) }
  const required = (name: keyof typeof values): string => {
    const value = values[name]
    if (typeof value !== 'string' || !value.trim()) throw new Error(`必须显式指定 --${name}`)
    return value.trim()
  }
  const maxAttempts = Number(values['max-attempts'] ?? 3)
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error('--max-attempts 必须为 1–20')
  if (values['data-dir'] && !values.enroll) throw new Error('--data-dir 必须与 --enroll 一起使用')
  const directory = resolve(values.resume || required('output-dir'))
  if (values.resume) {
    for (const name of ['output-dir', 'base-url', 'model', 'label', 'family', 'family-name', 'provider', 'source', 'source-name', 'response-model', 'format', 'effort', 'codex', 'count', 'no-stream'] as const) {
      if (values[name] !== undefined) throw new Error(`续采不能覆盖 --${name}；请使用原 manifest，或创建新批次`)
    }
  } else {
    const codex = values.codex ?? false
    const format = codex ? values.format ?? 'responses' : required('format')
    if (!['openai', 'responses', 'anthropic'].includes(format)) throw new Error('无效的 --format')
    if (codex && (values['base-url'] || values['no-stream'])) throw new Error('Codex 不允许覆盖端点或关闭流式')
    const metadata: Metadata = {
      label: required('label'), family: required('family'), family_name: required('family-name'),
      provider: required('provider'), source: required('source') as Metadata['source'],
      source_name: required('source-name'), response_models: values['response-model'] ?? [],
    }
    const config: ApiConfig = { baseUrl: codex ? CODEX_ENDPOINT : required('base-url'), apiKey: '',
      model: required('model'), format: format as ApiConfig['format'], effort: required('effort'), stream: !values['no-stream'], parallel: false }
    const manifest = createManifest(config, metadata, Number(values.count ?? 36), codex)
    await mkdir(dirname(directory), { recursive: true })
    await mkdir(directory, { mode: 0o700 })
    await saveJson(resolve(directory, 'manifest.json'), manifest)
  }
  const abort = new AbortController()
  const cancel = () => abort.abort()
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
  let complete = false
  try {
    complete = await withLock(directory, async () => {
      const manifest = await loadManifest(directory)
      const keyEnv = values['api-key-env'] ?? 'API_KEY'
      key = manifest.codex ? 'codex-local-login' : process.env[keyEnv]?.trim() ?? ''
      // A complete run can be verified or enrolled without loading credentials.
      const attempts = await collect(directory, manifest, key, maxAttempts, abort.signal)
      const accepted = selectedAttempts(manifest, attempts).filter(Boolean).length
      console.log(`有效回答 ${accepted}/${manifest.tasks.length}：${directory}`)
      return accepted === manifest.tasks.length && !abort.signal.aborted
    })
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel) }
  if (complete && values.enroll) {
    const dataDirectory = values['data-dir'] ? resolve(values['data-dir']) : fileURLToPath(new URL('../data', import.meta.url))
    console.log(JSON.stringify(await enroll(directory, dataDirectory), null, 2))
  }
  if (!complete) process.exitCode = 2
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(key ? message.replaceAll(key, '[REDACTED]') : message)
  process.exitCode = 1
}
