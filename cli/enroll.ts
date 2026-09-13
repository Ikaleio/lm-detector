import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enroll } from './enrollment'

try {
  const { values } = parseArgs({ args: process.argv.slice(2), strict: true, options: {
    run: { type: 'string' }, 'data-dir': { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } })
  if (values.help) {
    console.log(`用法：bun run enroll --run DIR [--dry-run] [--data-dir DIR]

读取采样 manifest 中显式声明的 metadata，不允许入库时重新贴标签。
要求全部挑战成功，核对原始请求和响应，选择首次成功尝试。
--dry-run 只校验并报告新增、跳过数量；不改写正式库。
--data-dir 默认 monorepo 的 data/。正式写入会重建派生库并保存恢复记录。
相同批次或相同模型、挑战、环境、文本重复入库不会重复计数。
冻结核验器不会自动重训；参考库变化后使用新库的基础排名。`)
  } else {
    if (!values.run?.trim()) throw new Error('必须指定 --run DIR')
    const dataDirectory = values['data-dir'] ? resolve(values['data-dir']) : fileURLToPath(new URL('../data', import.meta.url))
    console.log(JSON.stringify(await enroll(resolve(values.run), dataDirectory, values['dry-run'] ?? false), null, 2))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
