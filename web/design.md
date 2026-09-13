---
name: fingerpoint-design
description: 用于 Fingerpoint 模型检测、统一库浏览页面；从 Vercel 的排版、灰阶和线框结构提取规则，服务反复检测与结果比较。
version: 2026-09-11
---

## 1. 范围与优先级

[必须] 将本文件用于 web/ 内的检测、只读统一库和反馈状态。
[必须] 按用户要求、数据事实、无障碍、读者任务、视觉表达的顺序处理冲突。
[必须] 保留当前所有功能及结果字段，包括库内相对分数、绝对匹配度和证据提示。
[必须] 保留三条挑战、复制、重置、切换保留回答和不满三条时的检测。
[必须] 保留三种 API 协议、流式/完整响应、并行、取消、配置恢复和实时输出。
[必须] 保留库搜索、来源详情、更多样本、导出。
[建议] 沿用单一浅色主题。（决策：项目原本只支持浅色；Vercel 浅色页面提供直接视觉依据。）

## 2. 品牌与读者

[建议] 保留 Fingerpoint 名称和现有指纹图标。（决策：保留产品识别，不复用 Vercel 商标。）
[建议] 使用黑白灰表达正文、控件和层级。
[建议] 使用细分隔线连接工作区域，减少彼此孤立的卡片。
[必须] 让用户先看到当前任务和操作入口。
[必须] 用直接的中文说明输入、动作和结果。

## 3. 页面结构与构图

[建议] 将品牌、两项导航和真实库状态放在顶部水平栏。（决策：两个入口不需要占用固定侧栏，给双栏编辑器更多空间。）
[建议] 将主内容放在 1180px 容器中。（决策：保留项目既有内容宽度。）
[建议] 使用 src/index.css 的 .fp-main 边距：桌面 32px、760px 以下 24px、600px 以下 16px。（决策：窄屏为提示词和完整协议选项保留行宽。）
[必须] 将任务标题左对齐，不添加重复的副标题、英文编号和宣传说明。
[建议] 将检测页按标题、模式标签、挑战切换、双栏编辑器、操作、结果排序。
[建议] 将手动编辑器分成等宽两栏，左侧提示词、右侧回答。（决策：两步操作使用相同信息权重。）
[建议] 用一条简短的横向空状态说明结果位置。（决策：空结果不需要占据大块首屏空间。）
[必须] 在结果区完整展示最高候选、两个分数、证据说明、输入有效性及所有候选表。
[建议] 将统一库统计放在同一条分隔带中，将清单保留为表格。
[建议] 在 760px 以下将双栏表单改成单列。（决策：沿用项目既有断点。）
[建议] 在 600px 以下将顶部导航放到品牌下一行。（决策：窄屏保留全部文字入口。）
[必须] 在窄屏保留所有操作，允许表格在自身容器中滚动。

## 4. 视觉规则

[建议] 使用本地依赖 @fontsource-variable/geist 的 Geist Variable，中文回退 PingFang SC 和系统无衬线。（决策：原站测得 GeistSans；使用现有可分发依赖，不下载原站字体文件。）
[建议] 将页标题设为 48px/1.15、600，窄屏 32px/1.25。（决策：从原站 56–64px 标题缩小，保证工具操作出现在首屏。）
[建议] 将章节标题设为 18px/1.4、600，将正文设为 14px/1.7，将说明段设为 16px/1.6。（决策：保持现有工具的信息密度。）
[建议] 将元数据设为 12px/1.5，将分数设为 36px 等宽数字。
[必须] 在 index.css 中定义语义颜色，组件引用现有 token。
[建议] 将 background 设为 #fafafa、card 设为 #ffffff、foreground 和 primary 设为 #171717、muted 设为 #f2f2f2、muted-foreground 设为 #606060、border 设为 #e5e5e5、destructive 设为 #c42b32、ring 设为 #006bdf。（决策：基于测量的 Vercel 浅色灰阶，为控件边界和辅助文字调整对比度。）
[建议] 使用 4、8、12、16、24、32、48、64px 间距序列。
[建议] 将控件圆角设为 6px，编辑器圆角设为 8px，边框设为 1px。（决策：沿用 Vercel Docs 小圆角控件关系。）
[建议] 将主要按钮设为黑底白字，将次要按钮设为浅色描边。
[建议] 将模式标签设为下划线选中态，挑战切换保留分段按钮。（决策：沿用 Vercel Docs 标签形态，区分模式与步骤。）
[建议] 将主要按钮高度设为 40px，将普通按钮高度设为 36px。（决策：适配反复点击与触控。）
[必须] 为每个可聚焦元素提供可见焦点。
[必须] 每个路由只使用一个 h1。
[必须] 为输入、切换、图标按钮和弹层保留可访问名称。
[必须] 在长模型名、错误、实时输出和加载骨架上避免整页横向溢出。
[必须] 保留禁用、加载、空、错误和取消状态。
[建议] 仅使用现有 lucide-react 图标表达动作，不增加装饰性图标底板。
[必须] 保持分数条和表格数据来自真实检测结果。
[建议] 沿用现有 Framer Motion 的短时淡入、导航指示器和挑战切换动画。
[必须] 遵从 prefers-reduced-motion。

## 5. 可用原语

| 角色 | 实现名称或值 | 来源或路径 | 使用条件 | 状态 |
|---|---|---|---|---|
| 颜色 | background / foreground / card / muted / muted-foreground / border / primary / primary-foreground / destructive / ring | src/index.css | 全部页面 | 已实现 |
| 字体 | --font-sans / --font-mono | src/index.css | 正文与数字 | 已实现 |
| 操作 | Button default / outline / ghost，size default / lg | src/components/ui/button.tsx | 主次操作 | 已实现 |
| 表单 | FieldGroup / Field / FieldLabel / FieldDescription / Input / Textarea | src/components/ui/ | 检测与采集 | 已实现 |
| 模式 | Tabs / TabsList variant="line" / TabsTrigger / TabsContent | src/components/ui/tabs.tsx | 检测 | 已实现 |
| 步骤与开关 | ToggleGroup / ToggleGroupItem / Switch | src/components/ui/ | 挑战与 API 配置 | 已实现 |
| 数据 | Table / Badge / Progress | src/components/ui/ | 候选、有效性与进度 | 已实现 |
| 反馈 | Alert / Empty / Skeleton / sonner | src/components/ui/ | 空、错误、加载 | 已实现 |
| 详情 | Sheet / SheetContent / SheetHeader / SheetTitle / SheetDescription | src/components/ui/sheet.tsx | 来源详情 | 已实现 |
| 分隔 | Separator | src/components/ui/separator.tsx | 必要内容分组 | 已实现 |
| 布局 | fp-* 类 | src/App.tsx、src/index.css | 页面布局与响应式 | 已实现 |
| 图标与动画 | lucide-react / MotionConfig / motion / AnimatePresence | package.json、src/App.tsx | 现有交互 | 已实现 |

[必须] 将以上名称作为公开原语，不猜测不存在的组件变体。
[建议] 在 fp-* 命名空间中增加必要的页面布局类。（决策：沿用宿主项目命名。）
[必须] 在主题入口或组件变体调整字体、边框和表面，不在页面里覆盖组件内部外观。
[建议] 允许页面布局类调整容器尺寸和排列。（决策：本次重排工具页面。）

## 6. 文案与数据

[必须] 将页面标题写为“模型检测”“统一库”。
[必须] 删除宣传句、重复操作描述和“独立对话 / 原样回答”式标签。
[必须] 保留必要的操作要求、配置存储说明和分数限定。
[必须] 保留分数定义及“不能证明真实后端身份”的限定。
[必须] 从真实库计算模型数、样本数和来源类别数。
[必须] 保留 API 配置含密钥自动保存到当前浏览器的说明。
[必须] 不改动挑战提示词、评分、请求参数和数据文件。
[必须] 错误信息提供可执行的简短原因，不显示密钥或堆栈。

## 7. 反模式

[建议] 不把居中宣传标题加卡片网格作为检测页模板。
[建议] 不使用卡片嵌套卡片。
[建议] 不增加装饰性彩色图标底板。
[建议] 不使用原语之外的颜色和字号。
[建议] 不用小号低对比文字承载主要信息。
[建议] 不将普通元数据包装成胶囊。
[必须] 不用隐藏控件或省略结果列换取简洁。
[建议] 不把原站营销页的光照图形搬入检测页。（决策：没有读者任务依据，并非宣称 Vercel 禁止此类设计。）

## 8. 实现与接入

[必须] 沿用 Vite、React Router HashRouter、shadcn/ui、Framer Motion 和 Bun。
[必须] 在 src/index.css 中加载现有 Geist 依赖一次。
[必须] 保留 src/lib/client.ts、Web Worker、../shared/ 和 API 代理 的真实行为。
[必须] 不把 research/evaluation/holdout/ 内容用于参考库、校准或模型中心。
[必须] 不复制 Vercel 商标、客户标识、原站图像或受限字体文件。
[建议] 将 Vercel 首页、Pricing 和 Docs 作为样式来源。（决策：用户指定 vercel.com；页面分别覆盖宣传、密集比较与操作说明。）

## 词汇表

| 概念 | 名称 |
|---|---|
| 产品 | Fingerpoint |
| 候选集合 | 统一库 |
| 候选相对权重 | 库内相对分数 |
| 与模型中心的相似程度 | 绝对匹配度 |
| 原始回答记录 | 样本 |
