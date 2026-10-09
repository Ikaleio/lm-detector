<div align="center">

# LM Fingerpoint Detector

**让模型随手写几百个整数，识别 API 背后的大语言模型**

简体中文 · [English](./README.en.md)

[![npm](https://img.shields.io/npm/v/lmfpd?logo=npm&label=lmfpd&color=cb3837)](https://www.npmjs.com/package/lmfpd)
[![Web](https://img.shields.io/badge/Web-lm.ikale.io-0ea5e9)](https://lm.ikale.io)
[![Docs](https://img.shields.io/badge/Docs-lm.ikale.io%2Fdocs-6366f1)](https://lm.ikale.io/docs/)
[![Bun](https://img.shields.io/badge/Bun-1.4.2-000?logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-MIT-22c55e)](./LICENSE)

[在线检测](https://lm.ikale.io) · [文档](https://lm.ikale.io/docs/) · [快速开始](#快速开始) · [命令行](https://lm.ikale.io/docs/cli) · [原理](https://lm.ikale.io/docs/principles)

</div>

---

## 简介

中转站或第三方 API 声称提供某个模型，实际接入的可能是另一个模型。LM Fingerpoint Detector 用一个与语义无关的任务核对这一点：让模型凭第一反应写出约 300 个 1–355 之间的整数。语言模型写出的“随机数”并不均匀，每个模型偏好的数值、区间和末位数字相对稳定。检测器把这组分布与参考库比对，给出最接近的候选模型。

- **两种入口**：[网页](https://lm.ikale.io)支持手动粘贴和直连 API；命令行 `fpd` 提供实时终端界面、多轮检测和 JSON 输出。
- **三种协议**：OpenAI Responses、Chat Completions 和 Anthropic Messages，默认使用 SSE 流式响应。
- **参考库**：覆盖 GPT、Claude、Gemini、Grok、Qwen、DeepSeek 等常见模型家族。网页的参考库页面可以只读浏览和导出。
- **分词器探测（可选，默认关闭）**：在网页的 API 配置中打开“分词器探测”，或在命令行加上 `--tokenizer`，检测会多发约 12 个短请求，从接口返回的用量（`usage`）识别上游的分词器（模型把文字切成 token 的规则），并与所填模型核对。结果只作参考：排名和置信度只由数字指纹计算，也不等待探测。很多模型共用同一种分词器，所以分词器一致不能证明模型身份。
- **连接方式可选**：默认为“自动”，接口允许网页直接访问时由浏览器直接请求，受浏览器跨域限制（CORS）不允许时改经本站代理；也可以固定直连、固定经本站代理，或自己[一键部署](https://lm.ikale.io/docs/deployment/worker)的 Cloudflare Worker。
- **可追溯的数据维护**：`fpd sample`、`fpd enroll`、`fpd retrain` 依次完成采样、入库和离线重训。失败记录和旧尝试全部保留。

> [!IMPORTANT]
> 检测结果是**参考库内的封闭集合排序**。不在库中的模型也会得到一个“最像”的候选，排名分数和置信度都不是身份证明。判断渠道是否可信时，请固定请求参数、重复多轮，并结合其他证据。

## 快速开始

**网页**：打开 [lm.ikale.io](https://lm.ikale.io)，选择手动或 API 模式。每条回答至少需要 80 个有效整数；三条回答都有效时，页面给出排名和每个候选的置信度。API 模式打开分词器探测后，页面还会单独显示探测结果。

**命令行**：无需安装，任选一种运行时：

```sh
# Node.js ≥ 22
npx lmfpd@latest -b https://api.example.com/v1 -k sk-xxx -m gpt-6-astra

# Bun ≥ 1.4.2
bunx --bun lmfpd@latest -b https://api.example.com/v1 -k sk-xxx -m gpt-6-astra
```

**本地开发**：

```sh
bun install
bun run dev          # 同步数据并启动 Web 开发服务器（已接入 /api/proxy）
bun run dev:docs     # 启动文档开发服务器
bun run typecheck    # 网页、命令行与文档的 TypeScript 类型检查
bun run build        # 构建网站和文档到 web/dist
bun run build:cli    # 打包 npm CLI 到 dist/fpd
bun run fpd --help   # 在仓库内直接运行 CLI
```

## 文档

完整文档位于 [lm.ikale.io/docs](https://lm.ikale.io/docs/)，源文件在 [`docs/content/docs/`](./docs/content/docs/)：

| 章节 | 内容 |
| --- | --- |
| [网页检测](https://lm.ikale.io/docs/web) | 取样方式、API 配置、结果解读、分词器探测、连接方式 |
| [命令行](https://lm.ikale.io/docs/cli) | 检测、可选的分词器探测、采样与续采、入库与重训 |
| [原理](https://lm.ikale.io/docs/principles) | 挑战与特征、排名、置信度校准、分词器探测 |
| [部署](https://lm.ikale.io/docs/deployment) | Cloudflare Pages、GitHub Pages、Vercel、自建 Worker 代理 |
| [参考](https://lm.ikale.io/docs/reference/data) | 数据文件与变更记录、代理 API |
| [开发](https://lm.ikale.io/docs/development) | 项目结构、设计规范、打包与发布 |

## 致谢

感谢 [xqy2006/ModelTrace](https://github.com/xqy2006/ModelTrace) 提供了算法思路参考和部分原始数据。

## 许可证

[MIT](./LICENSE)
