# LM Fingerpoint Detector

基于 [ModelTrace](https://github.com/xqy2006/ModelTrace) 的模型指纹检测器。通过三条整数生成挑战比较模型的输出分布。Web 与 CLI 使用同一套算法和正式数据库。

## 目录

```text
.
├── web/       # React 检测网站
├── server/    # 共用 API 代理
├── api/       # Vercel Functions 入口
├── functions/ # Cloudflare Pages Functions 入口
├── docs/      # 部署与运行说明
├── cli/       # Bun + TypeScript 检测、采样工具
├── shared/    # 挑战、响应解析、评分和建库算法
├── data/      # 正式参考数据、模型参数和固定采样挑战
└── runs/      # 本地采样与检测记录，不提交 Git
```

本目录是独立的 Bun workspace。依赖、锁文件、TypeScript 配置、部署配置和 CI 均在本目录。构建不需要外层研究目录。以下命令均从本目录执行。

`api/` 和 `functions/` 分别保留部署平台要求的路由入口，共用 `server/proxy.ts`。`web/scripts/` 保存数据同步和 Vite 代理适配脚本。生成目录 `web/public/data/`、`web/dist/`、`.vercel/`、`.wrangler/` 不提交 Git；`data/archive/` 与 `data/collections/` 是需要保留的采样证据。

## 安装与运行

需要 Bun 1.4.2。

```sh
bun install --frozen-lockfile
bun run dev
bun run typecheck
bun run build
bun run preview
```

`dev` 和 `build` 会将脱敏数据同步到 `web/public/data/`。生产静态文件位于 `web/dist/`。

## Web

- 检测：生成三条挑战并粘贴回答，或调用 API 自动检测。支持 Chat Completions、Responses 和 Anthropic Messages，支持流式输出与单条重试。
- 统一库：只读查看模型、来源和参考样本，支持导出。

Web 只读取随构建发布的数据库。没有采样入库、JSONL 导入、浏览器建库或 IndexedDB 数据库覆盖功能。

网站支持简体中文和英文，语言与主题偏好保存在 localStorage。API 设置（包括 API Key）自动保存在 localStorage，刷新或重新打开浏览器后仍可恢复。旧版 sessionStorage 中的密钥会迁移到 localStorage。

API 请求和密钥通过同源 `/api/proxy` 转发到用户填写的 HTTPS 地址。代理不保存或记录密钥，上游不需要支持浏览器 CORS。Chat Completions、Responses 和 Messages 均支持 JSON 与 SSE；并行开关决定三个请求同时或依次执行。回复框固定高度，流式输出在框内自动滚动。单条重试沿用该条成功取样时的配置，失败或取消时保留旧回复。结果只呈现算法返回的候选顺序及置信度，不生成特征解释，不提供 URL 分享。可保存当前主题的 PNG 图片或导出候选列表 JSON。

## 检测 CLI

检测 CLI 使用英文 Ink TUI，显示采样进度、候选排名和多轮结果。设置 `API_KEY`、`MODEL`、`BASE_URL`，或用命令行参数覆盖：

```sh
bun run fpd --model gpt-5.6-sol --apikey sk-xxx --baseurl https://openrouter.ai/api/v1 -p 3 -n 5
bun run fpd --api chatcompletion --output result.json
bun run fpd --input result.json --json
bun run fpd --help
```

默认使用 Responses 和 SSE，每轮三条挑战，最多三条并行。`-n` 指定轮数，每轮三条采样全部结束后才启动下一轮。宽松模式达到目标数字数量后自动截断，部分样本成功时只给排名；`-s` 关闭自动截断，要求三条全部成功。`-ns` 关闭 SSE。`--timeout` 以秒指定首字节超时，默认 120 秒，收到 SSE 后不再计时。

也可通过 `npx lmfpd@latest -b URL -k KEY -m MODEL` 直接运行 npm 包；仅安装 Bun 时使用 `bunx --bun lmfpd@latest`。发布包支持 Node.js 22+ 和 Bun 1.4.2+。`--help` 提供分组说明和使用示例。CLI、共享算法、参考库或依赖更新到 `main` 后，发布工作流会自动生成新版本并更新 npm 的 `latest` 标签。

旧检测入口 `bun run detect:legacy` 保留原有检测接口。采样与入库已接入新版 `fpd sample`、`fpd enroll`。详见 [`cli/README.md`](cli/README.md)。

## 采样与入库 CLI

`fpd sample` 提供参数向导、请求前确认、实时进度和取消续采。仓库内可用 `bun run sample`；仓库外可用 `npx lmfpd@latest sample`，不需要检出仓库。非交互运行必须提供完整参数，`--json` 将结果写到 stdout。

批次共用模型、渠道和调用设置，每条样本保存实际提示词、回答、完整性、尝试编号、`note` 和证据路径。订阅渠道必须以 `-subscription` 结尾，例如 `codex-subscription`、`kimi-code-subscription`。`openrouter/anthropic` 等固定供应商渠道会发送仅允许该供应商、禁止回退的路由参数；实际供应商信息另外保留。

使用 `fpd sample --resume DIR` 续采，成功挑战直接跳过。`fpd enroll DIR --dry-run` 预览入库，`fpd enroll DIR` 确认后去重与重建。交互模式从当前目录识别本仓库并选择 `data/`；仓库外或非交互模式必须指定 `--data-dir DIR`。显式目录始终优先，CLI 安装目录中的参考库只读。

完整示例、必填 metadata、恢复规则和产物说明见 [CLI 采样流程](cli/WORKFLOW.md)。

## 数据与算法

- `data/unified_reference.jsonl`：每行一个批次，共用元数据与 `samples` 数组；只接受新格式。
- `data/unified_bank.json`：参考回答派生的指纹库。
- `data/shared_detector.json`：冻结的排名、核验参数与排名温度校准层。
- `data/enrollment-suite.json`：固定采样挑战集。
- `data/import_manifest.json`：保留的历史迁移清单，不作为当前数量统计，也不随 Web 构建发布。

`shared/shared-detector.ts` 计算候选排名、核验分数和置信度。浏览器 Worker、主线程回退和 CLI 共用同一实现。正式库需要三条有效回答；回答不足时返回 `unscorable`。置信度是校准层在参考身份上的闭集概率：按排名分数乘以冻结的温度后归一化，合计为 100%，与排名同序。它不含库外概率，也不能独立证明后端身份。核验分数只作为第二意见显示是否与排名一致。缺少匹配校准层时回退为未校准的核验 sigmoid 读数，未适配冻结核验器的自定义库使用传统排名。

`shared/builder.ts` 提供离线建库算法。参考库、派生库和冻结核验参数需要匹配。参考样本不能包含固定评估集的回答。采样与入库由 TypeScript CLI 完成，回归评估在外层研究仓库进行。产品构建只同步正式数据。参考库变化后，核验器不匹配时使用基础排名，置信度为空；核验器匹配、仅校准层缺失或不匹配时，显示未校准的核验读数。

原始参考数据来自 ModelTrace 提交 `60949ef522a84f66b1236b459308b48028d36949`。格式迁移前的原始行完整保存在 `data/archive/schema-cutover/`，后续批次保留来源和请求证据。来源标签不能作为上游身份的独立认证。

## 部署

Vercel、Cloudflare Pages、GitHub Pages 及本地代理的配置见 [部署说明](docs/deployment.md)。
