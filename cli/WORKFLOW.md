# 采样、续采与入库

新版命令是 `fpd sample` 和 `fpd enroll`。在仓库内可用 `bun run sample`、`bun run enroll`；独立发布包不依赖仓库。Web 只检测和只读查看参考库。

## 开始采样

交互终端运行 `fpd sample` 会询问缺少的参数，并在发送请求前展示确认页。API Key 隐藏输入，不写入文件。已有参数或环境变量不会重复询问。

也可以显式指定全部参数：

```sh
export API_KEY='你的密钥'
fpd sample \
  --baseurl https://openrouter.ai/api/v1 \
  --api chatcompletion \
  --model provider/api-model \
  --label my-model \
  --family my-family \
  --family-name 'My Family' \
  --channel openrouter/provider-route \
  --response-model provider/returned-model \
  --effort default \
  --output-dir ./my-run
```

模型 ID、允许的返回模型 ID 和渠道需要替换为实际值。`--response-model` 可以重复指定多个别名。连接信息也可来自 `API_KEY`、`MODEL`、`BASE_URL`。

默认使用全部 36 条固定挑战、最多 3 条并行、每题累计最多尝试 3 次。`--count` 选择较小的固定计划，`--parallel` 控制并发，`--max-attempts` 控制累计上限。正式入库要求计划全部成功，不按检测分数挑选回答。采样不使用检测命令的宽松截断规则。

仓库内默认保存到 `runs/<批次>/`；其他目录默认保存到 `./fpd-runs/<批次>/`。`--output-dir` 始终优先，新批次不会覆盖已有目录。

## 渠道

渠道表示具体采集路径，不是模型家族或计费信息：

- `codex-subscription`：读取本机 Codex 登录，固定 Responses 流式端点；不需要提供 API Key 或地址。
- `kimi-code-subscription`：Kimi Code 渠道，显式提供其接口配置和密钥。
- `openrouter/anthropic`、`openrouter/xiaomi/fp8`：OpenRouter 固定供应商；实际请求使用 `provider.only` 并关闭回退。
- `openrouter`：允许自动路由，实际供应商记录在每条样本中。
- 其他网关使用明确的自定义渠道 ID，并保留实际 endpoint。

订阅渠道必须以 `-subscription` 结尾。已知订阅产品会强制校验，其他订阅路径可使用 `--subscription` 要求该后缀；这个标记不产生 billing 字段。

返回模型必须在声明的别名列表中。固定 OpenRouter 渠道会核对返回供应商名称，不匹配时保留失败记录并停止本轮。供应商原始返回值与请求渠道分开记录；未返回供应商信息时实际渠道为 `null`，不把请求值当成返回事实。这些记录不构成上游身份的独立认证。

## 续采与取消

```sh
fpd sample --resume ./my-run --max-attempts 5
```

成功或已手工选中的题直接跳过。旧失败、中断和请求都保留，累计上限包含旧尝试。遇到传输失败或有效数字不足等可重试错误时，间隔一秒重试；明确的 HTTP 配置/认证错误及返回模型不匹配会停止本轮。

`q`、Ctrl+C 或 SIGTERM 会取消活动请求并保存进度。异常退出留下的完整响应会优先离线恢复。续采以题目为单位，不接续上游 token 流。已完成的批次可以不加载密钥直接核对。

模型、渠道和批次默认调用设置不可在原批次中修改；需要改动整批时创建新批次。仅对未选中回答的单题，可带说明覆写其提示词或推理强度，保留此前全部尝试。

## 逐题请求微调与截断采用

对尚无选中回答的题，可以调整提示词再尝试：

```sh
fpd sample --resume ./my-run --max-attempts 5 \
  --challenge query-07 --prompt-file ./prompt.txt \
  --note '原提示触发误拒绝，改写前缀'
```

`--system-file` 可同时替换系统提示词。新尝试保存实际提示词和独立条件标识，旧尝试不覆盖。没有提示词版本链或额外处理对象，说明写入 `note`。

若固定提示词不变、仅需降低单题推理强度，可指定 `--effort`：

```sh
fpd sample --resume ./my-run --challenge query-07 --effort low \
  --max-attempts 15 --note '此前尝试均在输出上限前未给出有效回答'
```

`--effort` 只作用于指定题目的新尝试，其他题与批次默认设置不变。实际请求体和覆写强度保存在该题的 `attempts/`、`trace/`；入库样本记录 `reasoning_effort`、生效尝试编号、独立条件标识、说明及证据路径。旧尝试原样保留。同一固定环境下的单题覆写仍归属原环境，离线校准留出该环境时一并排除。

循环、截断等回答可以在审查原始证据后明确采用：

```sh
fpd sample --resume ./my-run --adopt query-07:3 --take 300 \
  --note '循环后保留前300个有效整数'
```

此命令不请求 API。`--take` 取已记录回答中的前 N 个有效整数；省略时采用该次回答原文。仍须满足有效数字阈值和返回模型限制。原始尝试和 trace 不修改，样本记录最终采用文本和说明。截断响应仍标记为 `truncated`；自然完成后裁剪文本不会伪装成网络截断。

## 批次与样本格式

`result.json` 是一个批次；正式 `unified_reference.jsonl` 每行一个同结构批次。

- 批次：`schema_version`、`id`、`purpose`、`created_at`、`model`、`source`、`request`、`plan`。
- 每条 `samples`：样本/题目 ID、`condition`、实际提示词、`expected_count`、`attempt`、时间、实际渠道与返回型号、`text`、`completion`、`usage`、`note`、`evidence_path`；逐题覆写时另有可选的 `reasoning_effort`。
- 不保存重复的模型标签、`strict_valid`、派生数字统计或独立的 `nuisance_group`。当前算法使用 `condition` 作为干扰分组。
- 历史未知信息保留为 `null`，完整性无法确认时标记 `unknown`。

目录中的 `manifest.json` 冻结公共设置和采样计划；`attempts/` 保存逐次结果；`trace/` 保存实际请求和原始响应；`selections/` 保存显式手工选择。`attempts.jsonl` 与 `result.json` 是可重新生成的汇总。

新 CLI 不接受旧 collection manifest 或旧参考行格式。格式迁移前的正式行原样保存在 `data/archive/schema-cutover/`，历史采样证据不改写。

`fpd --input ./my-run/result.json` 可离线检测，按条件组成最多三条回答一轮。严格模式拒绝截断或完整性未知的样本。

## 入库与目标目录

```sh
fpd enroll ./my-run --dry-run
fpd enroll ./my-run
```

交互模式从当前目录向上查找本仓库，也识别外层目录下的 `projects/`。识别依赖包名、workspace 和正式数据文件，不依赖 Git。预览会显示完整目标路径、新增及去重数量；默认不确认写入。

仓库外或非交互模式需要显式指定目标：

```sh
mkdir -p ./reference-data
fpd enroll ./my-run --data-dir ./reference-data --dry-run --json
fpd enroll ./my-run --data-dir ./reference-data --json
```

目标必须是已有目录；空目录可以建立单独的参考库。显式路径无效时直接报错，不回退到自动识别结果。`--yes` 仅在指定 `--data-dir` 时跳过交互确认，不能与 `--dry-run` 同用。也可在采样时加 `--enroll`，完整采样后进入入库流程。

入库重新解析原始响应，校验请求、文本、型号、批次哈希及正式库哈希，然后去重、重建和写入。相同模型、渠道、条件、题目和文本的重复记录不会再次计数；不同渠道的证据不互相吞并。写入使用锁和可恢复事务，收据与备份位于目标目录的 `.enrollments/`。

存在未完成事务时，预览核对暂存文件和正式文件的哈希，按恢复后的状态计算数量，但不写文件。确认入库后才完成恢复；发现事务外改动时拒绝覆盖。

随 CLI 安装的参考库始终只读。正式入库不会自动重训核验器或置信度校准层；不匹配时检测退回基础排名，置信度为空。

## 维护端重训与发布

在完整仓库更新正式数据后，可从 `projects/` 运行 `bun run retrain --data-dir ./data`。独立 CLI 使用 `fpd retrain --data-dir /path/to/data`。需要安装 `uv` 和 Python；CLI 用 Bun/TypeScript 管理目录锁、参数和进程，数值拟合由包内的 `offline/` 模块完成。命令不请求模型 API，也不读取固定评估集。

入库已重建目标库。重训检查参考库与指纹库哈希，然后按固定参考环境重拟合排序器、核验器和置信度温度。训练证据保存在目标目录的 `.training/`；如已有参数，同一运行目录保存 `before-shared-detector.json`。校准必须通过嵌套留出验收，才能原子替换 `shared_detector.json`。失败时保留原参数，继续使用基础排名。`--data-dir` 必须指向已有目录，发布包的随包库仍只读。

在完整研究仓库，从 `research/` 运行 `bun run rebuild-bank` 和 `bun run evaluate:holdout`，检查 `reports/holdout/latest.md` 的覆盖率、识别结果及前后变化。固定评估数据不得用于建库、训练或校准。`rebuild-bank` 必须在重训之前运行，不能在重训后再改动参考库或重建目标库。

从 `projects/` 运行 `bun run build` 构建 Web 数据，运行 `bun run build:cli` 打包独立 CLI；这些命令本身不发布。

采样/入库退出码：`0` 完成或校验通过，`1` 参数/文件/运行错误，`2` 采样未完整或取消。`--json` 保持 stdout 为机器可读结果，进度写 stderr。
