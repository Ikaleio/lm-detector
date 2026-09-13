# Web 检测网站

从 monorepo 根目录运行 `bun run dev`、`bun run build` 或 `bun run preview`。

`src/` 包含检测页面和只读参考库页面。`server/proxy.ts` 转发检测请求，`api/complete.ts` 是部署入口。检测复用 `../shared/`，正式数据来自 `../data/`。

网站没有入库功能。浏览器不读取旧的 IndexedDB 自定义库，也不合并或重建参考数据。只读库页面支持查看和导出。

构建前的 `scripts/sync-data.ts` 仅同步脱敏数据，不依赖外层研究代码。静态产物为 `dist/`。Vercel 从 monorepo 根目录部署，Pages 仅支持静态页面。
