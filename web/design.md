---
name: fingerpoint-design
description: 用于 Fingerpoint 的三样本检测、API 配置、候选结果、图片导出和只读样本库。服务需要比较 LLM 指纹的用户，支持简体中文和英文、浅色和深色主题。
version: 2026-09-16
---

# Fingerpoint design.md

## 1. 范围与优先级

[必须] 将本文件用于 `web/` 的检测、样本库、反馈状态和结果图片。
[必须] 不参考旧站点的视觉外观。
[必须] 按用户要求、真实算法输出、安全与无障碍、当前任务、视觉表达的顺序处理冲突。
[必须] 保留三条算法生成的提示词和对应回复。
[必须] 将评分算法视为黑盒。界面不生成特征命中、贡献分或推理解释。
[必须] 不提供 URL 分享结果或网页端贡献样本功能。
[必须] 只发布静态网页。API 请求从浏览器直连用户指定的 HTTPS 服务。
[必须] 不使用固定评估集建库、校准或生成模型中心。

## 2. 品牌与读者

读者需要完成三种任务：手动粘贴回复、通过 API 自动取得回复、浏览已有参考样本。

[建议] 用中性表面和单一蓝色强调当前操作。（决策：突出检测任务，不复制已有产品 UI。）
[建议] 用空间连续的弹簧动画连接卡片、摘要条和导航状态。（决策：用户要求苹果式非线性动画。）
[建议] 使用内容决定高度，避免全屏宣传区。（决策：这是工具页，不是营销页。）
[必须] 用文字和颜色共同表达取样状态。
[必须] 区分“模型排名”和“身份已确认”。相似结果不能独立证明身份。

## 3. 页面结构与构图

### 应用外壳

- 顶栏高 56px；左侧站名，中间“检测 / 样本库”，右侧语言和主题切换。
- 当前导航链接用共享 `layoutId` 下划线表示。
- 不添加侧栏。
- 页脚说明本地分析及 API 请求去向，不声称密钥永不离开浏览器。

### 检测页

- 使用 `.fp-page`，最大宽度 1200px。
- 页头包含一个 h1、手动/API 模式和 API 设置入口。
- 使用 `.fp-grid-samples`：1024px 起三列，窄屏一列。
- 每个样本包含编号、状态、提示词、复制操作、回复输入和数字数量。
- 提示词默认显示四行，展开后显示全文。
- 回复区保留原始文本和换行，最大高 40vh，局部滚动。
- 每条提示词对应一条独立模型请求，不拼接对话历史。
- 切换模式不清除提示词和回复。
- 计算和结果阶段显示三条样本摘要；640px 以下隐藏摘要中的数量，不缩小文字。
- 结果阶段一次只展开一个样本，展开卡片占整行。
- 操作栏靠近样本；768px 以下固定在底部，并留出内容及安全区空间。
- 开始新检测前确认清除已有回复和结果。

### 取样状态

- `pending`、`requesting`、`streaming`、`done`、`rejected`、`stopped` 分别映射到本地化状态文案。
- 请求期间将完整旧回复与临时流式文本分开保存。
- 仅成功完整结束且达到数字阈值的回复替换旧回复。
- 失败或取消单条替换时保留旧回复和旧结果。
- 成功替换或手动编辑回复时清除旧结果。
- 未完成的流式片段不能自动参与验证。用户编辑后可手动采用。
- 单条重新取样沿用该条成功取样时的参数和原提示词。
- 并行开关控制三个请求同时或依次执行；不自动重试失败请求。
- 自动验证默认关闭。开启后仅在本轮指定请求全部成功、三条回复齐全时执行。
- 离开页面时中止请求，忽略旧运行的后续回调。

### API 配置

- 使用右侧 `Sheet`；桌面最大宽 420px，窄屏占满宽度。
- 字段顺序：Base URL、API Key、model、协议、reasoning_effort、流式、并行、自动验证、本标签页记住 Key。
- 协议选项固定为 Chat Completions、Messages、Responses。
- reasoning_effort 可留空，允许输入上游支持的任意值，不限制为少数预设。
- Key 默认隐藏，可通过有名称的按钮切换可见性。
- 面板使用本地草稿；“保存”或“保存并开始取样”才提交配置。
- 关闭面板放弃未保存的更改。
- 告知用户密钥发送到填写的服务，并要求该服务支持 CORS。
- 默认密钥只在内存中；显式选择记住后使用 sessionStorage，不将密钥写入 localStorage。

### 结果

- 展示算法返回顺序，不以置信度重新排序。
- 第一项使用模型名和置信度作为主要信息。
- 无置信度时显示不可用状态，不以零替代。
- 无可评分结果时显示补齐有效回复的操作提示，不输出模型推断。
- 候选行包含名次、模型名、家族、置信度条、百分比。
- 窄屏将置信度条移到下一行；保留完整模型名和百分比。
- 默认显示前八项，允许展开全部。
- 说明各候选置信度不必递减，也不必合计 100%。
- 保留库外模型、相近指纹、间歇性替换等限制说明。
- 主操作保存 PNG；次要操作重新检测；JSON 候选列表导出放在更多菜单。
- 不给概率添加未经算法校准支持的“低于 50%”等阈值。

### 图片

- 使用浏览器 Canvas，逻辑宽度 1200px，按 2 倍像素密度导出 PNG。
- 包含站名、日期、第一候选、前五项、实际有效样本数和限制说明。
- 使用当前语言及主题，并等待字体加载。
- 不包含 API Key、接口地址、用户填写的模型 ID 或回复正文。
- 零置信度的填充宽度为零；不可用置信度显示破折号。

### 样本库

- 使用 `.fp-page-wide`，最大宽度 1440px。
- 首屏包含标题、真实模型/样本总数、搜索、家族筛选、排序与导出入口。
- 桌面使用表格：模型、家族、样本数、有效数字、来源。
- 数量右对齐；同一列的 th/td 对齐方式一致。
- 窄屏使用两层信息列表，长模型名称和 ID 换行，不压缩正文。
- 模型名称为真实链接；桌面整行普通点击进入详情。
- 详情页桌面左侧挑战导航、右侧回复；窄屏导航转为横向 Tabs。
- 每条回复展示自己的原始提示词，不从同组第一条回复推断其他提示词。
- 只展示记录实际具有的来源、服务提供方、渠道、批次、时间信息。
- 清除端点中的认证信息、查询参数和私有主机信息；不展示完整原始 metadata 对象。
- 请求失败显示重试；没有模型、没有回复、搜索为空分别显示对应状态。

## 4. 视觉规则

### 字体与颜色

- 使用 `src/index.css` 的 Geist Variable 和 CJK 系统回退。接口、Key 和 ID 输入可用 `--font-mono`。
- 正文与控件使用 `text-body` 或组件的 `text-sm`。移动输入框使用 1rem，避免浏览器自动缩放。
- `text-meta` 只承载数量、日期等次要内容，不承载主要操作和限制说明。
- 数值统一使用 tabular-nums；百分比保留一位小数。
- 浅色及深色 token 都在 `src/index.css` 中定义，页面不复制色值。
- 蓝色用于主要操作、焦点和置信度条；状态使用 success、warning、destructive 语义色。
- 不按厂商分配置信度条颜色。

### 布局与表面

- 页面边距在 640px 和 1024px 处从 16px 增为 24px 和 32px。
- 页面区域间隔 24px；卡片间隔及内边距 16px。
- 卡片圆角 12px，控件 8px，细边框。普通卡片不加阴影。
- 只为真正的对象或数据集合设置表面，不堆叠多层卡片。
- 遇到长文本先换行或局部滚动，不隐藏整页溢出。
- 窄屏操作栏避开 safe-area-inset-bottom，不遮挡末尾内容。
- 保留可见 focus-visible；可滚动回复允许键盘聚焦。

### 动效

- `src/lib/motion.ts` 是弹簧参数唯一来源。
- snappy：stiffness 500 / damping 40；用于短控件反馈。
- smooth：260 / 30；用于样本卡、摘要条和导航位置变化。
- gentle：120 / 20；用于结果条和数值过渡。
- 首批八项可错开 60ms；展开的后续候选不延长等待。
- 流式文本不添加逐字动画。
- 尊重 reduced-motion：取消错开与位移，数字直接到目标值，保留短淡入或即时状态变化。
- 动效不能阻止取消、输入或键盘导航。

## 5. 可用原语

| 角色 | 实现名称 | 路径 | 状态 |
|---|---|---|---|
| 颜色与主题 | background、foreground、card、popover、primary、muted、muted-foreground、border、input、ring、success、warning、destructive | `src/index.css` | 已实现 |
| 字号 | text-display、text-display-number、text-h1、text-section-title、text-card-title、text-body、text-meta | `src/index.css` | 已实现 |
| 容器 | fp-shell、fp-page、fp-page-wide、fp-grid-samples、fp-actionbar、fp-result-row | `src/index.css` | 已实现 |
| 表面与数据 | fp-card、fp-bar、fp-reply、fp-mono | `src/index.css` | 已实现 |
| 控件 | Button、Input、Textarea、Field、Switch、ToggleGroup、Tabs | `src/components/ui/` | 已实现 |
| 浮层 | Dialog、Sheet、DropdownMenu、Tooltip、Sonner | `src/components/ui/` | 已实现 |
| 数据反馈 | Table、Badge、Empty、Skeleton、Alert | `src/components/ui/` | 已实现 |
| 检测对象 | SampleCard、SampleStrip、ResultPanel、ApiConfigSheet | `src/components/` | 已实现 |
| 动效 | useMotionPreset、spring、listStagger、listItem | `src/lib/motion.ts` | 已实现 |
| 图标 | lucide-react | `package.json` | 已安装 |

[必须] 公开原语是本表的组件、类和 token；使用前确认 API 存在。
[建议] 页面专用样式使用 `fp-custom-*` 名称。（决策：区分共享布局与页面例外。）
[建议] 页面可使用 Tailwind 默认布局和间距工具；不得另建平行的颜色或字号系统。（决策：保留 shadcn 的组合方式。）
[必须] 新的跨页面视觉变体先加入共享组件，不用页面覆盖隐藏行为差异。

## 6. 文案与数据

- 文案唯一入口：`src/i18n/messages.ts`。英文对象必须满足与中文相同的键结构。
- Provider 位于 `src/i18n/index.tsx`，负责语言偏好、插值、数字和日期格式。
- 初始语言先读取用户偏好，再根据浏览器语言选择中文或英文。
- 切换语言时更新 document.lang 和页面标题，不清除检测内容。
- 提示词、用户回复、模型 ID 和原始样本不翻译；翻译提示词会改变算法输入。
- 协议名称保留 API 官方名称。
- 错误正文按 code/HTTP 状态映射为本地化提示，原始详情仅在主动打开的对话框中显示。
- 原始详情先脱敏，不显示密钥或 Authorization 值。
- 不猜测网络错误就是 CORS、401 就是 Key 错误；文案要求检查相关条件。
- 缺失日期或提示词明确说明缺失，不补造记录。

## 7. 反模式

[必须] 不把评分原因、内部特征向量或诊断对象作为黑盒结果解释。
[必须] 不把未知置信度显示为 0%，不自行添加判定阈值。
[必须] 不把密钥写入 localStorage、URL、导出图片或日志。
[必须] 不在设置草稿变化时自动发送模型请求。
[必须] 不自动向参考库写入检测回复。
[必须] 不添加 URL 分享、贡献样本、登录等未请求入口。
[建议] 不默认采用居中宣传标题加卡片网格。（决策：检测工具需要任务密度。）
[建议] 不叠加卡片、装饰图标底板或渐变。（决策：使用表面、文字和状态建立层级。）
[建议] 普通元数据不使用胶囊徽标。（决策：徽标只表示状态。）

## 8. 实现与接入

- Bun workspace 根目录为 `projects/`；产品构建不依赖 `research/`。
- React Router v7 使用 HashRouter，路由为 `/`、`/library`、`/library/:modelId`。
- 样式为 Tailwind v4；shadcn 使用现有 base-nova / Base UI 组件，不切换到另一套组件系统。
- 动效使用已安装的 `framer-motion`。
- `next-themes` 通过 html.dark 应用主题，`index.html` 在加载前恢复偏好。
- `src/lib/client.ts` 载入静态参考库，在 Worker 中调用共享算法，Worker 不可用时使用同一实现回退。
- 浏览器传输只向填写的 HTTPS 端点发送密钥，不携带网站 Cookie，不跟随重定向。
- Messages 发送 anthropic-version 和 anthropic-dangerous-direct-browser-access 请求头；服务仍须允许 CORS。
- `shared/detection.ts` 与 `shared/completion.ts` 负责请求和 JSON/SSE 解析；UI 使用结构化状态和错误 code。
- `src/lib/export-image.ts` 在 Canvas 中生成 PNG，JSON 导出仅包含候选列表。
- 构建命令为 `bun run typecheck` 和 `bun run build`；渲染检查直接运行网页，不用单元测试替代视觉检查。

## 词汇表

| 概念 | 名称 |
|---|---|
| 一条生成提示词及其回复 | 样本 / Sample |
| API 生成回复 | 取样 / Sampling |
| 提交三条回复给算法 | 验证 / Verify |
| 算法返回的候选集合 | 结果 / Result |
| 历史参考数据 | 样本库 / Reference Library |
| 算法给出的匹配估计 | 置信度 / Confidence |
