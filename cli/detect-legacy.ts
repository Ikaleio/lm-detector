import { parseArgs } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { generateChallenges } from '@fingerpoint/shared/challenge-browser.js'
import { endpoint, testApi, directTransport } from '@fingerpoint/shared/detection'
import { traceTransport } from './trace'
import { CODEX_ENDPOINT, codexTransport } from './codex'
import { analyzeSharedOutputs, type SharedDetector } from '@fingerpoint/shared/shared-detector'
import type { Analysis, ApiConfig, Bank, Output } from '@fingerpoint/shared/types'

const help = `用法：bun run detect --base-url https://api.example.com/v1 --model MODEL

密钥从 API_KEY 环境变量读取，也可用 --api-key-env 指定变量名。
  --codex                             使用本机 Codex 登录（Responses 流式）
  --challenges FILE                    使用保存的三条挑战
  --trace-dir DIR                      保存实际请求与响应（不含认证头）
  --format openai|responses|anthropic  默认 openai
  --effort LEVEL                      同网页的推理强度，默认不传
  --parallel                          并行发送三个挑战（默认串行）
  --no-stream                         使用非流式响应（默认流式）
  --bank FILE                         自定义参考库，默认 data/unified_bank.json
  --input FILE                        离线分析 JSON 输出数组或本工具保存的结果
  --json                              stdout 输出完整 JSON
  --output FILE                       保存挑战、输出和分析 JSON（不包含密钥）
  --help                              查看帮助

API 模式与网页共用挑战、请求参数、响应解析、有效性判定和评分。
每次生成三个随机挑战；正式库需要三条有效回答，失败挑战会保留为空输出。
输出排名分数和逐候选置信度。置信度为当前 36 模型核验器的匹配估计，各项不要求合计 100%。
自定义库使用传统排名。不会将回答加入参考库。
`

let key = ''
try {
  const { values } = parseArgs({ args: process.argv.slice(2), strict: true, options: {
    codex: {type:'boolean'}, challenges: {type:'string'}, 'trace-dir': {type:'string'},
    'base-url': {type:'string'}, model: {type:'string'}, format: {type:'string'},
    effort: {type:'string'}, 'api-key-env': {type:'string'}, bank: {type:'string'},
    input: {type:'string'}, output: {type:'string'}, json: {type:'boolean'},
    parallel: {type:'boolean'}, 'no-stream': {type:'boolean'}, help: {type:'boolean',short:'h'},
  } })
  if (values.help) { console.log(help); process.exit(0) }
  const bankPath = values.bank ?? fileURLToPath(new URL('../data/unified_bank.json',import.meta.url))
  const bank:Bank = JSON.parse(await readFile(bankPath,'utf8'))
  if (!Array.isArray(bank.models) || !bank.models.length) throw new Error('参考库缺少 models')
  let outputs:Output[]
  let challenges:ReturnType<typeof generateChallenges> = []
  let request:Omit<ApiConfig,'apiKey'>|undefined
  if (values.input) {
    const data:unknown = JSON.parse(await readFile(values.input,'utf8'))
    const rows = Array.isArray(data) ? data : data && typeof data === 'object' && 'outputs' in data ? data.outputs : undefined
    if (!Array.isArray(rows) || !rows.length || !rows.every((row:unknown) =>
      row !== null && typeof row === 'object' && 'text' in row && typeof row.text === 'string' &&
      'expected_count' in row && typeof row.expected_count === 'number' && Number.isInteger(row.expected_count) && row.expected_count > 0
    )) throw new Error('输入必须包含非空 outputs 数组，每条有 text 和正整数 expected_count')
    outputs = rows as Output[]
  } else {
    const format = values.format ?? (values.codex?'responses':'openai')
    if(values.codex && (values['base-url'] || format!=='responses' || values['no-stream'])) throw new Error('--codex 使用固定官方 Responses 流式端点，不能指定其他地址或协议')
    if (!['openai','responses','anthropic'].includes(format)) throw new Error('format 必须为 openai、responses 或 anthropic')
    if ((!values.codex && !values['base-url']) || !values.model?.trim()) throw new Error('请指定 --base-url 和 --model；用 --help 查看用法')
    const keyEnv = values['api-key-env'] ?? 'API_KEY'
    key = values.codex ? 'codex-local-login' : process.env[keyEnv]?.trim() ?? ''
    if (!key) throw new Error(`环境变量 ${keyEnv} 未设置`)
    const config:ApiConfig = {
      baseUrl:values.codex?CODEX_ENDPOINT:values['base-url']!,model:values.model,apiKey:key,format:format as ApiConfig['format'],
      effort:values.effort ?? '',stream:!values['no-stream'],parallel:values.parallel ?? false,
    }
    endpoint(config)
    const { apiKey: _key, ...metadata } = config
    request = metadata
    if(values.challenges){
      const saved:unknown=JSON.parse(await readFile(values.challenges,'utf8'))
      if(!Array.isArray(saved) || saved.length!==3 || !saved.every((c:unknown)=>c && typeof c==='object' && 'id' in c && typeof c.id==='string' && 'prompt' in c && typeof c.prompt==='string' && 'expected_count' in c && typeof c.expected_count==='number' && Number.isInteger(c.expected_count) && c.expected_count>0)) throw new Error('挑战文件必须包含三条有效挑战')
      challenges=saved as typeof challenges
    }else challenges = generateChallenges()
    const transport=values.codex?await codexTransport(values['trace-dir']):values['trace-dir']?await traceTransport(values['trace-dir'],directTransport):undefined
    const abort = new AbortController()
    const cancel = () => abort.abort()
    process.once('SIGINT',cancel)
    let completed = -1
    try {
      outputs = await testApi(config,challenges,p => {
        if (p.completed !== completed) { completed=p.completed; console.error(`[${p.completed}/${p.total}] ${p.message}`) }
      },abort.signal,transport)
    } finally { process.removeListener('SIGINT',cancel) }
  }
  const detector:SharedDetector=JSON.parse(await readFile(fileURLToPath(new URL('../data/shared_detector.json',import.meta.url)),'utf8'))
  const analysis:Analysis = analyzeSharedOutputs(outputs,bank,detector)
  const result = {created_at:new Date().toISOString(),request,bank:{path:bankPath,reference_sha256:bank.reference_sha256},challenges,outputs,analysis}
  const serialized = JSON.stringify(result,null,2)+'\n'
  if (values.output) await writeFile(values.output,serialized,{mode:0o600})
  if (values.json) process.stdout.write(serialized)
  else {
    console.log(`第一候选：${analysis.prediction_name}`)
    console.log(`有效回答：${analysis.used_outputs}/${outputs.length}；${analysis.evidence.label}`)
    console.log(analysis.evidence.reason)
    for (const row of analysis.results.slice(0,5)) console.log(`${row.display_name}\t排名 ${row.score.toFixed(4)}\t置信度 ${row.verification_confidence != null ? `${(row.verification_confidence*100).toFixed(1)}%` : '不可用'}`)
    if (values.output) console.log(`结果已保存：${values.output}`)
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(key ? message.replaceAll(key,'[REDACTED]') : message)
  process.exitCode = 1
}
