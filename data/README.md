# 正式数据

此目录保存正式参考样本、派生指纹库、冻结检测参数和固定采样挑战。`unified_reference.jsonl` 每行一个版本 1 批次，共用模型、渠道与调用设置，回答放在 `samples` 数组中。`enrollment-suite.json` 是采样输入，不是参考回答。`import_manifest.json` 是历史清单，不代表当前数量。

新版 CLI 使用 `fpd sample`、`fpd enroll DIR` 和 `fpd retrain --data-dir DIR`，三者都可在仓库外运行。入库校验完整批次和原始证据，按模型、渠道、条件、题目与文本去重并重建派生库。重训从目标参考库离线拟合核验器与置信度；嵌套校准未通过时不替换 `shared_detector.json`，训练证据保存在 `.training/`。CLI 随包数据只读，维护目标必须显式指定或在交互入库时识别本仓库后确认。固定评估集不能加入参考库、模型中心或校准。

Web 构建会将脱敏数据写入 `../web/public/data/`。该目录是生成产物，不能作为另一份正式库维护。

`archive/` 保存已退出参考库的历史批次，`collections/` 保存采样请求、尝试和来源核验记录。两者不参与评分，也不复制到 Web 公开数据。2026-09-14 的 K3 更新使用 36 条固定 MoonshotAI 来源、关闭思考的回答，替换此前未固定提供方的 36 条回答。新旧批次分别位于 `collections/kimi-k3-moonshotai-20260914/` 和 `archive/kimi-k3-unpinned-20260914/`；前缀版本及生效尝试见新批次 manifest。

2026-09-26 将六个 DeepSeek 型号的 15 个未固定供应商批次（216 条）全部退出正式库，原始行保存在 `archive/deepseek-unpinned-20260926/unified_reference.rows.jsonl`，原采样尝试继续留在研究目录。新参考批次按型号独立保存在 `collections/deepseek-*-20260926/`：V4.1 Flash 与 V4 Pro 0813 各 36 条固定 `openrouter/deepseek`，Flash 0731、Pro 预览、Flash 预览、V3.2 各 36 条固定 `openrouter/novita`。Flash 0731 的 `query-11` 第 11 次和 `query-23` 第 12 次尝试只覆写 `reasoning_effort=low`，原始失败均保留；停用的 SiliconFlow 备用批次保留在 `collections/` 但没有入库。正式库只纳入完整且来源核对通过的批次，不让 OpenRouter 自动回退或混合供应商回答。

格式迁移前的 1,804 条参考行原样保存在 `archive/schema-cutover/unified_reference.rows.jsonl`。新格式保留全部样本 ID、回答、提示词和顺序，未知完整性不会补成成功。旧格式不再由运行时读取，历史请求与失败尝试仍保留。
