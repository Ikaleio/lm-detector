# 共享算法库

Web 与 Bun CLI 共用此包。模块不依赖 React、浏览器存储或外层研究目录。

- `challenge-browser.js`：检测挑战生成。
- `completion-request.ts`、`completion.ts`、`detection.ts`：请求体、响应解析和检测流程。
- `fingerprint-core.js`、`number-features.js`、`gaussian-core.js`：数字特征与基础评分。
- `shared-detector.ts`：冻结排名器和核验器。
- `builder.ts`：从参考样本离线建库；拒绝带评估标记的样本。
- `privacy.ts`、`types.ts`：脱敏与公共类型。

正式数据和冻结参数位于 `../data/`。Web 仅调用检测模块，不打包建库入口。
