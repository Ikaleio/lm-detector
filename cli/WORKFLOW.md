# 采样、续采与入库

CLI 使用 Bun + TypeScript。采样和入库都可以独立重跑。Web 只负责检测和只读查看数据。

## 从采样到入库

以下命令从 monorepo 根目录执行。示例中的接口模型 ID、返回模型 ID 和参考库标签必须替换为实际值。

```sh
bun install --frozen-lockfile
export API_KEY='你的密钥'

bun run sample \
  --output-dir runs/my-model-001 \
  --base-url https://openrouter.ai/api/v1 \
  --model provider/api-model \
  --label my-model \
  --family my-family \
  --family-name 'My Family' \
  --provider 'Model Provider' \
  --source openrouter \
  --source-name 'OpenRouter official' \
  --response-model provider/returned-model \
  --format openai \
  --effort default \
  --enroll
```

默认采集固定挑战集的全部 36 条，每条挑战累计最多尝试 3 次。`--count N` 可显式缩小本轮计划；入库要求本轮计划全部成功。`--enroll` 在完整采样后执行校验、去重和重建。省略它就只采样。

新目录已创建但因密钥缺失而停止时，设置密钥后使用 `--resume`。同一目录不能重新初始化。

如果需要先审查样本：

```sh
bun run enroll --run runs/my-model-001 --dry-run
bun run enroll --run runs/my-model-001
bun run build
```

`--dry-run` 核对完整性、原始响应、metadata 和冲突，报告新增、跳过数量，不修改正式库。正式入库默认写入 `data/`；`--data-dir DIR` 可以指定另一份数据目录。构建将正式库同步到 Web。

## 必须声明的 metadata

| 参数 | 含义 |
|---|---|
| `--model` | 实际请求的 API 模型 ID |
| `--label` | 参考库模型标签，与 API ID 分开保存 |
| `--family` | 模型家族 ID |
| `--family-name` | 家族显示名称 |
| `--provider` | 用户声明的模型提供方 |
| `--source` | `openrouter`、`api` 或 `codex` |
| `--source-name` | 采集渠道名称 |
| `--response-model` | 允许的返回模型 ID，可重复指定多个别名 |
| `--format` | `openai`、`responses`、`anthropic`；Codex 固定为 Responses |
| `--effort` | 推理强度；`default` 表示不传该参数 |

`openrouter` 仅用于官方 HTTPS 端点。其他网关使用 `api`，并填写实际渠道名称。提供方和来源是用户声明，保存为 `trust_basis: user-declared`，不代表独立认证了上游身份。

返回模型名必须属于显式声明的列表；缺失或不匹配均不接受。已有参考模型的家族 ID、家族名称不能被新批次悄悄改写。

密钥默认从 `API_KEY` 读取，可以用 `--api-key-env NAME` 切换。密钥和认证头不写入 manifest、尝试记录或请求 trace。

## 固定请求与续采

新批次将 metadata、挑战、最终请求体、超时设置及哈希写入 `manifest.json`。续采直接发送已保存的请求体，不重新生成挑战，也不采用当前默认参数覆盖旧参数。

```sh
bun run sample --resume runs/my-model-001 --max-attempts 5 --enroll
```

`--max-attempts` 是每条挑战的累计上限，包含旧失败和中断，范围为 1–20。到达上限的挑战不会继续请求。需要更多尝试时显式提高上限。

成功挑战直接跳过。出现传输、截断或有效数字不足等可重试失败时，在累计上限内间隔一秒重试。HTTP 400、401、402、403、404 或返回模型名不匹配会停止本轮；修复渠道或密钥后显式续采。需要修改模型别名或其他 metadata 时创建新批次，不能修改旧 manifest。

按 Ctrl+C 或发送 SIGTERM 会中断请求并保存进度。进程异常退出后，失效锁通常在 10 秒后可重新获取。如果原始响应已经完整写入磁盘，续采先离线回放并恢复成功状态；否则保留旧 trace，创建新的尝试。这里的续采以挑战为单位，不接续上游已中断的 token 流。

## 状态与文件

每条挑战的尝试状态为：

```text
running → accepted
        → failed
        → interrupted
```

只有完整结束、数字数量达标且返回模型名匹配的响应可以成为 `accepted`。每条挑战固定选择首次成功尝试，不根据检测分数选择回答。

```text
runs/my-model-001/
├── manifest.json
├── attempts/query-01/0001.json
├── trace/query-01/0001/attempt-1.request.json
├── trace/query-01/0001/attempt-1.response.json
├── trace/query-01/0001/attempt-1.body.txt
├── attempts.jsonl
├── result.json
└── enrollment.json
```

`attempts/` 中的单次记录是续采依据。开始请求前先写入 `running`，结束后以原子替换写入最终状态。旧失败不会被后续尝试覆盖。

`attempts.jsonl` 和 `result.json` 是可重新生成的汇总。`result.json` 保存首次成功回答、采用的尝试编号及按环境分组的输出。未成功的回答位置保持为空。

正式评分器需要恰好三条有效回答。三条采样可用 `bun run detect --input runs/my-model-001/result.json` 离线检测；整轮 36 条可从 `result.json` 的 `groups` 中按环境取出三条分别检测。入库过程不依赖这些识别结果。

## 入库校验与写入恢复

入库只接受 v2 的 `reference-collection` manifest。旧版采样文件和 holdout/evaluation 记录不能直接导入。

每次入库都会重新检查：

1. manifest 哈希与必填 metadata。
2. 每条挑战是否有完整的首次成功记录。
3. 保存的实际请求是否与 manifest 一致。
4. 原始响应是否可以重新解析，且文本、返回模型和响应 ID 与记录一致。
5. 数字数量、来源类别、模型家族和样本标识是否有效。
6. 正式参考文件与派生库的哈希是否匹配。

新参考样本保留请求体、来源、响应型号、采用的尝试编号及 manifest 哈希。`row_id` 由批次 UUID 和挑战 ID 组成。同一标识内容冲突会拒绝入库；同一模型、环境、挑战和文本也会去重。

采样目录和数据目录分别使用写锁。建库在 Worker 中运行，主进程持续更新锁，避免长计算被误判为失效。

入库先在 `data/.pending-enrollment/` 中保存前后版本并完成建库，再写入恢复记录，最后替换正式文件。进程在替换两个文件之间退出时，下一次 `enroll` 会核对哈希并完成该事务。正式文件被事务外的操作修改时，恢复会拒绝覆盖。

完成后，备份与收据保存在 `data/.enrollments/<run-id>/`，采样目录另存 `enrollment.json`。重跑同一批次不会再次增加样本。临时事务、备份、锁和默认 `runs/` 均被 Git 与部署上传规则排除。

## 检测参数与评估

入库使用共享 TypeScript 建库算法更新参考库和派生库，不自动训练冻结核验器或置信度校准层。核验器与新库不匹配时，Web 与 CLI 使用基础排名，置信度为空。只有核验器匹配、校准层缺失或不匹配时，才回退为未校准的核验 sigmoid 读数。恢复流程为重训核验器、导出匹配参数、拟合排名温度，再导出校准层。

Web 构建会拒绝未完成的入库事务或参考/派生库哈希不匹配的状态。完成入库后执行 `bun run build` 发布数据副本。

产品 CLI 不依赖外层研究目录。在完整研究仓库中，正式数据更新后还应从 `research/` 执行 `bun run evaluate:holdout`，核对覆盖率、识别结果及前后变化。评估只使用固定回答，不重新请求模型 API，也不把评估数据用于建库。

退出码：`0` 表示完成，`1` 表示参数、文件或运行错误，`2` 表示采样未完整或取消。
