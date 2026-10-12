# 产品 monorepo

- 使用 Bun 管理依赖并运行 TypeScript。CLI 使用 Bun + TypeScript。
- `web/` 只提供检测和只读参考库页面；采样在 `cli/`，算法在 `shared/`，数据在 `data/`。
- 产品构建不得依赖本目录之外的文件。配置、锁文件和部署入口放在本目录。
- 不新增测试文件，除非用户明确要求。变更后运行 `bun run typecheck` 和 `bun run build`。
- 界面改动遵守 `web/design.md`；编写或修改 design.md、按它实现或审查页面时，使用 `.agents/skills/ikadesign3/` 的 `ikadesign3` skill。design.md 只写呈现方式，功能、字段和阈值留在代码与文档页。
- 文档站在 `docs/`（Fumadocs），内容在 `docs/content/docs/`，每页有中文 `页面.mdx` 与英文 `页面.en.mdx`；由 `worker/openapi.json` 生成的代理 API 参考页只有一个版本。用户可见的功能或数据变更同步更新两种语言的页面；README 只保留概览和文档入口。
- 参考库模型标签的数字版本使用小数点（如 `claude-opus-5.5`），不要写成 `claude-opus-5-5`；`claude-haiku-4-5-20251001` 的展示/参考标签固定为 `claude-haiku-4.5`。API 请求型号和原始采样证据保持上游原值。
- 每次入库都要同步更新该模型的固定基线评估组，沿用固定挑战补齐两组三条独立回答。入库请求包含这部分评估采集授权，记录实际渠道和推理参数。
- 入库前保存基线评估，入库、重建和重训后再次评估，分别报告相同旧评估组的前后变化和新增模型的识别结果。完整研究仓库的评估文件位于 `../research/evaluation/holdout/`。
- 其他情况不自动请求模型 API。只有用户要求采集或检测上游时才发送请求。
- 评估样本不得进入参考库、模型中心或校准。采样记录保留失败和旧尝试。
