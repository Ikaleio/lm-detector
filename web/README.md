# Web 检测网站

从 monorepo 根目录运行 `bun run dev`、`bun run build` 或 `bun run preview`。

`src/` 包含检测页面、只读样本库与中英文文案。检测复用 `../shared/`，正式数据来自 `../data/`。API 请求从浏览器直连用户填写的 HTTPS 地址；没有本站代理。上游必须允许 CORS。

网站没有入库功能。浏览器不读取旧的 IndexedDB 自定义库，也不合并或重建参考数据。只读库页面支持查看和导出。

路由使用 React Router v7 的 HashRouter。界面使用 shadcn/ui（Base UI）、Tailwind v4 和 Framer Motion。`design.md` 定义本项目的视觉原语和交互约束。

`src/i18n/messages.ts` 包含中英文文案，`src/i18n/index.tsx` 提供语言偏好、插值及日期/数字格式化。语言切换不修改算法提示词或用户回复。密钥默认仅在内存中保存；用户可选择在当前标签页的 sessionStorage 中保留。PNG 导出在浏览器 Canvas 中生成，不包含密钥、接口地址或回复正文。

构建前的 `scripts/sync-data.ts` 仅同步脱敏数据，不依赖外层研究代码。静态产物为 `dist/`。Vercel 从 monorepo 根目录部署，Pages 仅支持静态页面。
