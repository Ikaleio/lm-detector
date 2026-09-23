# Web 检测网站

从 monorepo 根目录运行 `bun run dev`、`bun run build` 或 `bun run preview`。

`src/` 包含检测页面、只读样本库与中英文文案。检测复用 `../shared/`，正式数据来自 `../data/`。API 请求经同源 `/api/proxy` 转发到用户填写的 HTTPS 服务，不设供应商域名白名单，上游不需要支持浏览器 CORS。代理实现位于 `../server/proxy.ts`，Vite 开发及预览服务复用该实现。

网站没有入库功能。浏览器不读取旧的 IndexedDB 自定义库，也不合并或重建参考数据。只读库页面支持查看和导出。

路由使用 React Router v7 的 HashRouter。界面使用 shadcn/ui（Base UI）、Tailwind v4 和 Framer Motion。`design.md` 定义本项目的视觉原语和交互约束。

`src/i18n/messages.ts` 包含中英文文案，`src/i18n/index.tsx` 提供语言偏好、插值及日期/数字格式化。语言切换不修改算法提示词或用户回复。API 设置和密钥自动保存在 localStorage，刷新或重新打开浏览器后恢复；旧版 sessionStorage 密钥自动迁移。PNG 导出在浏览器 Canvas 中生成，不包含密钥、接口地址或回复正文。

构建前的 `scripts/sync-data.ts` 仅同步脱敏数据，不依赖外层研究代码。静态产物为 `dist/`。Vercel 和 Cloudflare Pages 均从 monorepo 根目录部署。两平台的函数入口、上游地址要求及运行命令见 [部署说明](../docs/deployment.md)。GitHub Pages 仅支持手动检测和参考库查看。

生产构建从 `telemetry.json` 注入 Koitoyu 和 Recorder 脚本；本地开发不加载。站点 ID 和脚本来源集中在该配置文件。Recorder 回放会遮蔽 API 配置区和错误详情；输入框由 Recorder 默认遮蔽。
