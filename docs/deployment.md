# Web 部署

以下路径和命令均相对于产品根目录 `projects/`。当前 WebUI 位于 `web/`。

前端统一请求 `/api/proxy`。`server/proxy.ts` 使用标准 Request/Response，两个平台共用该实现。JSON 和 SSE 响应直接透传，不等待完整流。请求超时为 250 秒，客户端取消会传给上游。使用 HashRouter，无需页面路由重写。

## Vercel

项目根目录设为产品目录（外层仓库的 `projects/`）。`vercel.json` 构建 `web/dist/`，并部署 `api/proxy.ts`。函数使用 Node.js runtime，最大执行时间为 300 秒，并启用请求取消。无需配置站点共用 API Key；每次请求使用用户填写的密钥。

入口格式及取消设置依据 [Vercel Functions 文档](https://vercel.com/docs/functions/functions-api-reference)。

## Cloudflare Pages

项目根目录同样设为产品目录，构建命令设为 `bun run build`，输出目录设为 `web/dist`。`functions/api/proxy.ts` 提供同一路径。`wrangler.jsonc` 固定兼容日期并启用 `enable_request_signal`，`web/public/_routes.json` 仅让 `/api/*` 进入函数。

```sh
bun run build:pages
bun run preview:pages
# 发布到 wrangler.jsonc 指定的 Pages 项目
bun run deploy:pages
```

本地 Pages 预览位于 `http://127.0.0.1:8788`。使用 Pages Git 集成或 Wrangler 发布，不能只上传静态目录。配置方式见 [Pages Functions 文档](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)。

## 上游地址与本地开发

代理默认允许 `openrouter.ai`、`api.openai.com` 和 `api.anthropic.com`。自定义服务需要在服务器设置 `PROXY_ALLOWED_HOSTS`，值为逗号分隔的完整域名，例如 `api.example.com,models.example.net`。这些域名会加入默认列表；不支持通配符。仅添加自己信任、解析到公网的服务域名。

Vercel 在项目环境变量中设置。Cloudflare Pages 在 Functions 变量中设置，或在 `wrangler.jsonc` 的 `vars` 中声明。本地 Vite 从根目录 `.env.local` 读取，Wrangler 从 `.dev.vars` 读取。修改后重启本地服务或重新部署。

代理只接受 HTTPS 的默认 443 端口、三种协议端点和不超过 128 KiB 的 JSON 请求。不跟随重定向，不透传 Cookie 或任意请求头。客户端必须提供自己的上游密钥。`Origin` 校验限制浏览器跨站调用，但不替代站点鉴权或平台限流。

`bun run dev` 和 `bun run preview` 已接入同一代理，无需再启动后端服务。CLI 仍直接连接上游。

## GitHub Pages

`.github/workflows/pages.yml` 在推送时构建并保存静态产物，手动触发时发布到 GitHub Pages。手动发布前需在仓库设置中启用 GitHub Actions 作为 Pages 来源。GitHub Pages 没有服务器函数，仅支持手动检测和参考库查看。API 模式需要部署到 Vercel、Cloudflare Pages 或运行本地预览；不会自动回退到浏览器直连。
