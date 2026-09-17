# LM Fingerpoint Detector

基于 [ModelTrace](https://github.com/xqy2006/ModelTrace) 的模型指纹检测器。通过三条整数生成挑战比较模型的输出分布。Web 与 CLI 使用同一套算法和正式数据库。

## 目录

```text
.
├── web/       # 纯前端 React 检测网站
├── cli/       # Bun + TypeScript 检测、采样工具
├── shared/    # 挑战、响应解析、评分和建库算法
└── data/      # 正式参考数据、模型参数和固定采样挑战
```

本目录是独立的 Bun workspace。依赖、锁文件、TypeScript 配置、部署配置和 CI 均在本目录。构建不需要外层研究目录。以下命令均从本目录执行。

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

网站支持简体中文和英文，语言与主题偏好保存在 localStorage。API Key 默认只在内存中保存；勾选“在本标签页记住”后写入 sessionStorage，关闭标签页后清除。旧版 localStorage 中的密钥会迁移到内存并移除。其他接口配置保存在 localStorage。

API 请求由浏览器直接发送到用户填写的 HTTPS 地址，不经过本站代理。目标服务必须允许浏览器跨域访问（CORS）。Chat Completions、Responses 和 Messages 均支持 JSON 与 SSE；并行开关决定三个请求同时或依次执行。单条重试沿用该条成功取样时的配置，失败或取消时保留旧回复。结果只呈现算法返回的候选顺序及置信度，不生成特征解释，不提供 URL 分享。可保存当前主题的 PNG 图片或导出候选列表 JSON。

## 检测 CLI

先在环境变量 `API_KEY` 中设置密钥：

```sh
bun run detect --base-url https://api.example.com/v1 --model MODEL
bun run detect --base-url https://api.example.com/v1 --model MODEL --format responses --output result.json
bun run detect --input result.json --json
bun run detect --help
```

默认发送三条随机挑战，串行请求、流式读取。`--parallel` 启用并行，`--effort` 指定推理强度，`--no-stream` 关闭流式。`--api-key-env NAME` 指定密钥环境变量。`--bank FILE` 使用其他数据库。

使用 `--challenges FILE` 可以复用三条挑战。`--trace-dir DIR` 保存实际请求体和原始响应，不保存认证头。`--codex` 支持读取本机 Codex 登录并使用固定官方 Responses 端点。详见 [`cli/README.md`](cli/README.md)。

## 采样与入库 CLI

`sample` 要求显式声明模型、家族、提供方、来源渠道和允许的返回模型 ID。采样使用固定挑战，保存每次实际请求、原始响应和失败记录。

使用 `bun run sample --resume DIR` 续采，成功挑战直接跳过。`bun run enroll --run DIR --dry-run` 检查入库结果，`bun run enroll --run DIR` 执行去重与重建。也可在采样命令中加 `--enroll`，采样完成后自动入库。

完整示例、必填 metadata、恢复规则和产物说明见 [CLI 采样流程](cli/WORKFLOW.md)。

## 数据与算法

- `data/unified_reference.jsonl`：参考回答、提示词、模型标签与来源信息。
- `data/unified_bank.json`：参考回答派生的指纹库。
- `data/shared_detector.json`：冻结的排名、核验参数与排名温度校准层。
- `data/enrollment-suite.json`：固定采样挑战集。
- `data/import_manifest.json`：初始迁移的来源与哈希记录。

`shared/shared-detector.ts` 计算候选排名、核验分数和置信度。浏览器 Worker、主线程回退和 CLI 共用同一实现。正式库需要三条有效回答；回答不足时返回 `unscorable`。置信度是校准层在参考身份上的闭集概率：按排名分数乘以冻结的温度后归一化，合计为 100%，与排名同序。它不含库外概率，也不能独立证明后端身份。核验分数只作为第二意见显示是否与排名一致。缺少匹配校准层时回退为未校准的核验 sigmoid 读数，未适配冻结核验器的自定义库使用传统排名。

`shared/builder.ts` 提供离线建库算法。参考库、派生库和冻结核验参数需要匹配。参考样本不能包含固定评估集的回答。采样与入库由 TypeScript CLI 完成，回归评估在外层研究仓库进行。产品构建只同步正式数据。参考库变化后，核验器不匹配时使用基础排名，置信度为空；核验器匹配、仅校准层缺失或不匹配时，显示未校准的核验读数。

原始参考数据来自 ModelTrace 提交 `60949ef522a84f66b1236b459308b48028d36949`，保留各条样本的 provenance。来源标签表示采集记录，不能作为上游身份的独立认证。

## 部署

Vercel 项目根目录设为本目录。`vercel.json` 只构建 `web/dist/`，不部署 API Function。使用 HashRouter，无需服务端路由重写。

`.github/workflows/pages.yml` 在推送时构建并保存静态产物，手动触发时发布到 GitHub Pages。手动发布前需在仓库设置中启用 GitHub Actions 作为 Pages 来源。API 模式也可在静态站点使用，但目标上游必须允许该站点来源的跨域请求。
