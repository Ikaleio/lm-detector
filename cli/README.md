# 检测与采样 CLI

从monorepo 根目录执行 `bun run detect --help`。需要 Bun，无需启动网站。

设置 `API_KEY` 后运行：

```bash
bun run detect --base-url https://api.example.com/v1 --model MODEL --output result.json
```

支持 `openai`、`responses` 和 `anthropic` 三种协议。用 `--api-key-env NAME` 从其他环境变量读取密钥；不会将密钥保存到结果中。API 地址与网页一样要求 HTTPS，接受 Base URL 或对应协议的完整端点。

`--input result.json` 可以离线复算；也接受含 `{ "text": "...", "expected_count": 300 }` 的 JSON 数组。`--bank FILE` 可使用自定义库。使用 `--json` 获取机器可读输出。

## 本机 Codex 登录

```bash
bun run detect --codex --model gpt-6-astra --effort low --trace-dir /tmp/codex-probe --output result.json
```

`--codex` 读取本机 `~/.codex/auth.json`（或 `CODEX_HOME`），只向固定 Codex 官方端点发送认证信息，不保存凭据。需要有效的 ChatGPT 登录，使用 Responses 流式模式。检测请求使用空 instructions；采样请求保留固定挑战的系统提示词。两者均省略 Codex 不支持的 max_output_tokens。缺失 Content-Type 的成功响应按 SSE 解析。

`--challenges FILE` 可让多次检测使用同一组三条挑战。`--trace-dir DIR` 保存每条实际请求和原始响应；使用新的目录保留每轮记录。

普通 API 模式也支持 `--trace-dir DIR`，保存请求正文和原始响应，便于核对返回型号与离线复算；认证头不写入记录。

## 采样、续采与入库

使用 `bun run sample` 创建批次，`bun run sample --resume DIR` 续采，`bun run enroll --run DIR` 校验并入库。新批次必须显式声明模型标签、家族、提供方、渠道和允许的返回模型名。

完整命令、状态恢复与入库规则见 [WORKFLOW.md](WORKFLOW.md)。查看 `bun run sample --help` 和 `bun run enroll --help` 获取全部参数。
