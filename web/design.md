---
name: fingerpoint-design
description: 用于 Fingerpoint Detector 的网页工具界面（多卡片工作台、数据长列表、主从浏览）、文档站长文页、浏览器导出的结果图片和链接预览图。读者是逐条核对数字、标识符和百分比的技术用户；目标是中性灰阶表面、单一蓝色强调、像素指纹装饰和无回弹弹簧动效，中英文混排，浅色与深色主题。
version: 2026-10-06
---

## 1. 范围与优先级

- [MUST] 本文件约束 `web/` 的全部页面与浮层、浏览器导出的结果图片、`docs/` 文档站，以及文档构建生成的链接预览图。
- [MUST] 本文件不约束 CLI 的终端输出、README 和 GitHub 仓库页面。
- [MUST] 不参考旧站点的视觉外观。
- [MUST] 冲突时按以下顺序取舍：真实数据与用户要求、无障碍与可用性、读者当前的任务、本项目已有约定、品牌表达、装饰细节。
- [MUST] 页面的功能、字段、状态条件和阈值以任务需求和代码为准；本文件只规定它们的呈现方式。

## 2. 品牌与读者

读者在桌面上连续比较数字、模型标识符和百分比，也会在手机上查看结论；熟悉 API 术语；界面会出现中英文混排的标识符和原文。

- [SHOULD] 中性工具感：表面、文字和边框只用零彩度灰阶 token；`--primary` 蓝色只出现在主要操作、焦点环、当前导航下划线、链接和置信度条上。（决策：突出检测任务，不复制已有产品界面。来源：项目初版设计决策。）
- [MUST] 像素指纹是唯一的品牌装饰：品牌标识、加载、等待和空状态使用 `PixelShader` 的像素效果，颜色取 muted-foreground。
- [MUST] 动效是空间连续、无回弹的弹簧：卡片在原位伸缩，导航下划线和列表项平移到新位置。
- [SHOULD] 工具页高度由内容决定，不放全屏宣传区或插画。（决策：这是工具页，不是营销页。来源：项目初版设计决策。）
- [MUST] 文案语气直接、克制：陈述结果和限制，推断性的结论写成“候选”“最接近”“排名”，不写成“已确认”。
- [MUST] 状态同时用文字和颜色表达，不只靠颜色。

## 3. 页面结构与构图

### 应用外壳

- [MUST] 工具页和文档页共用顶栏 `fp-topbar`：桌面高 56px，三栏网格，左侧品牌标识，中间主导航，右侧仓库入口、Star 入口、语言切换和主题菜单。
- [SHOULD] 640px 以下顶栏改为 88px 双行（56px 加 32px），主导航排在第二行，仓库入口隐藏，由指向同一仓库的 Star 入口代替；1024px 以下仓库入口和 Star 入口只显示图标。
- [SHOULD] Star 入口 `fp-repository-star` 高 32px，`star` 色图标与 `text-meta` 500 字重文字，边框为 35% `star` 混入 `border`，底色为 8% `star`。（决策：在仓库入口旁给出一个低调的 Star 入口。来源：2026-10-06 用户要求。）
- [MUST] 768px 以下，顶栏右侧的图标按钮（仓库入口除外）至少 44×44px；Star 入口在这一宽度去掉边框和底色，只保留 `star` 色图标。
- [MUST] 品牌标识 `fp-brand`：左侧 32px 像素指纹 `fp-brand-mark`（muted-foreground），右侧两行文字，上行 `fp-brand-title`，下行 `fp-brand-byline`。
- [SHOULD] 当前导航项用 2px primary 下划线 `fp-nav-indicator` 标出，下划线只在导航容器内横移。指向另一个站点的导航项是普通整页链接，不参与下划线动画。
- [MUST] 主题菜单是“浅色 / 深色 / 跟随系统”三项单选，标出当前项，默认跟随系统；切换主题或语言不清除页面上已输入的内容。
- [SHOULD] 顶栏右侧图标：仓库入口用 lucide `GitBranch`，Star 入口用填充的 `Star`，语言切换用 `Languages`，主题按钮显示当前选项对应的 `Sun`、`Moon` 或 `Monitor`；图标 16px，按钮带可读名称。
- [MUST] 页脚居中，使用 `text-meta` muted 文字，不放像素装饰。

### 多卡片工作台

用于一次处理多份同类输入并在同一页给出结论的页面。

- [SHOULD] 使用 `fp-page`。首屏自上而下：页头（唯一的 h1，右侧为 `Segmented` 模式切换）、一行紧凑提示条 `fp-cli-promo`、可选的整行配置卡片、卡片网格 `fp-grid-samples`、操作行 `fp-detect-footer`。
- [SHOULD] 提示条只占一行高度：命令片段用 `fp-cli-command`，其中的可执行名和参数为 primary 600 字重；点击命令复制全文并用 toast 反馈；行末是 primary 文字链接。
- [SHOULD] 卡片网格 1024px 起为三列等宽，1024px 以下为一列。
- [SHOULD] 输入卡片 `SampleCard` 自上而下：标题行（`text-card-title` 编号标题、状态徽标、更多菜单）、参考原文（默认显示四行，可展开全文）、输入区、底部 `text-meta` 计数。
- [SHOULD] 输入区 `fp-reply` 固定 12rem 高，保留原始换行，内容超出时在区内滚动，不随内容增高，不可拖拽改变大小；空白等待区保持同一高度。流式追加文本时滚到底部，手动编辑时跟随光标。
- [SHOULD] 操作行左侧是次要链接 `fp-star-link`，右侧是操作栏 `fp-actionbar`，两端与网格左右边缘对齐，同高 36px。
- [SHOULD] 768px 以下操作栏固定在视口底部（最小高 64px，避开 safe-area-inset-bottom），页面底部留出同样的空间；次要链接留在内容流末尾。
- [SHOULD] 结果状态：卡片网格收为一行摘要条 `SampleStrip`；点击一项在摘要条下方展开它的详情，一次只展开一项；再次点击该项或点详情右上角的“收起”关闭。640px 以下摘要条隐藏计数，不缩小文字。
- [SHOULD] 结果区 `ResultPanel` 自上而下：`text-section-title` 区块标题、摘要卡片、整行警告、`text-body` muted 说明、候选列表、参考核对卡片（可选）、限制说明。区块间隔 24px。
- [SHOULD] 参考核对卡片 `UsageCheck` 是一张 `fp-card`，内边距 16px、组间隔 12px：标题行左侧 `text-card-title`，右侧 `text-meta` muted 依据；一行 `text-body` muted 说明；无边框行列表，每行最小高 48px、行间 1px 分隔线，三列为名称（font-medium，下方 `text-meta` muted 角色）、4.5rem 宽右对齐的带符号百分比、5rem 宽右对齐的状态徽标（一致 success、不一致 destructive，文字前加 `Badge` 默认 12px 的 lucide 图标）；最后一行 `text-body` muted 汇总。（来源：2026-10-06 用户要求把回复的 token 用量与样本库历史记录拟合比对。）
- [SHOULD] 摘要卡片分左右两栏。左栏依次为 `text-meta` 标签、`text-display` 名称（`overflow-wrap:anywhere`）、`text-body` muted 次级信息，名称旁放 `logo` 像素标识。右栏右对齐，依次为 `text-display-number` 主百分比、`text-meta` 标签和来源行，整组相对卡片垂直居中。窄屏保留两栏，名称和来源可以换行。
- [SHOULD] 候选列表放在一张 `fp-card` 里，每行用 `fp-result-row`：24px 序号列、名称列（font-medium）、120px 次要标签列（muted，单行省略）、`ConfidenceBar`、64px 右对齐百分比列，最小行高 48px，行间 1px 分隔线。默认显示前 8 行，末行用 ghost 小按钮展开全部。
- [SHOULD] 768px 以下候选行改为序号、名称、百分比三列，置信度条移到第二行，隐藏次要标签列。
- [MUST] 置信度不可用时显示破折号或“不可用”，不显示 0%，也不画空置信度条（该行加 `data-unscored`）。
- [SHOULD] 结果区操作：主操作在右，次要操作在左，低频操作收进更多菜单。
- [SHOULD] 需要警示的卡片和它的详情使用 `fp-card[data-warning]`，卡片标题旁加警告图标；结果区同时用 `Alert variant="warning"` 说明原因，并排在其他警告之前。
- [SHOULD] 可折叠配置卡片 `ApiConfigPanel`：收起时为一行 48px 等宽摘要 `fp-api-summary`，长值单行省略，完整值放在 `title`，不显示密钥；展开后为表单，桌面两列，窄屏一列。展开和收起用 220ms 高度与透明度过渡，摘要位置不动。
- [SHOULD] 表单中的开关组之后用分隔线开始下一组。`Segmented` 下方用一行 `text-meta` muted 文字，只说明当前选中的选项。
- [SHOULD] `Segmented` 选项可以在文字前放 16px 图标（`icon`），在文字后放推荐标记 `RecommendMark`（`recommended`，传字符串时作为标记文字）。（来源：2026-10-06 用户要求为推荐选项加标记。）
- [SHOULD] 选项图标是协议或厂商的标识时，用 `BrandIcon` 画平面 SVG：取 `web/src/lib/brand-logos.ts` 的同一份标识，有彩色版用彩色版，单色部分用 currentColor；不做像素化。（来源：2026-10-06 用户要求用标识区分接口协议。）
- [SHOULD] 提交时有缺项：展开缺项所在的区域，聚焦第一个缺失字段，字段下方用 `FieldError` 说明。
- [SHOULD] 推荐标记 `RecommendMark`（`fp-recommend`）高 18px、`--radius-badge` 圆角、primary 文字和 10% primary 底色、`text-meta` 500 字重，放在推荐选项的文字后、推荐设置的标题后或推荐取值下方，文字计入该项的可访问名称或取值文本；一组选项最多一个推荐标记。标记文字默认是“推荐”，需要给出理由时换成一句短句。（来源：2026-10-06 用户要求为推荐选项和推荐设置加标记，并为 API 模式写明推荐理由。）
- [SHOULD] 带检查动作的输入框：右侧放 outline 按钮；检查结果写在输入框下方 `role="status"` 的 `text-meta` 文字中，成功用 success 色。

### 两列证据详情

工作台里展示一组判定、核对和逐条记录的展开详情，当前实现为 `TokenizerDetails`。

- [SHOULD] 头部与卡片详情相同：左侧标题；右侧依次为“收起”按钮、状态徽标、更多菜单；标题下一行 `text-meta` muted 说明；其下为分隔线，进行中时分隔线改为 `march` 像素效果。
- [SHOULD] 正文网格 1024px 起为 `minmax(0,3fr) minmax(0,2fr)` 两列、一个列间距；DOM 顺序为摘要块、核对块、候选列表、记录列表，前两项为第一行。1024px 以下排成一列，顺序不变，所有块左右边缘相同。
- [SHOULD] 摘要块和核对块各三行，字号相同：`text-meta` 标签、`text-section-title` 主值、`text-body` muted 次行；摘要块的百分比用 `fp-mono` 右对齐。核对块的状态行左侧放 16px 语义色 lucide 图标，不用 `Alert` 框。
- [SHOULD] 候选列表和记录列表没有边框，不嵌套卡片。两者以 44px 头部行开始（左侧 `text-body` font-medium 标题，右侧 `text-meta` muted 数量，底部分隔线），行高 48px。候选列表复用 `fp-result-row`；`fp-custom-tokenizer-candidates` 在 768px 起为名称列保留 8rem。
- [SHOULD] 记录列表 1024px 起最多显示 7 行（336px），超出部分在列表内滚动，列表可以用键盘聚焦；长原文单行省略，完整原文放在 `title`。
- [MUST] 详情网格共享边缘和行线：上下相邻的块左边缘相同；摘要块的百分比与候选列表的百分比列右边缘相同；摘要块与核对块三行基线相同；两个列表的头部行同 y、同高，前 7 条行线同 y。检查方法：1440px 下用 `getBoundingClientRect` 比较，误差不超过 1px。
- [SHOULD] 整行 `Alert` 放在分隔线与网格之间，左右与卡片内容边缘对齐；操作只放在更多菜单和底部行，正文里不另放按钮。
- [SHOULD] 底部行左侧为 `text-meta` muted 统计，右侧为 ghost primary 小按钮；其下为整行 `Collapsible` 折叠项。折叠项里的数值表格：文本列左对齐，数值列右对齐。

### 数据长列表

- [SHOULD] 使用 `fp-page-wide`。首屏自上而下：页头行、工具行、列表；列表下方以一行 `text-meta` muted 的数据日期与显示数量结束。
- [SHOULD] 页头行：h1 在左，`text-body` muted 的总量在右，两者基线对齐；宽度不足时总量换到 h1 下方（`flex flex-wrap items-baseline justify-between gap-3`）。
- [SHOULD] 工具行是一行 `flex flex-wrap items-center gap-2`：288px 搜索框（`w-72 max-w-full`）、outline 筛选菜单按钮（文字后加 `ChevronDown`，已选时在文字后追加“ · 数量”）、`Segmented` 排序依次排列；导出等次要操作用 `ms-auto` 靠右，是文字前带图标的 outline 菜单按钮。控件同高 36px（`h-9`）；宽度不足时按顺序换行。
- [SHOULD] 768px 起用 `Table`，放在 `fp-card` 里：表头行高 44px，数据行高 48px，单元格左右内边距 16px，数值列右对齐，次要列用 muted 文字。
- [SHOULD] 768px 以下改为 `fp-card` 里的两层信息列表：每项是一个整块链接，最小高 56px，左右内边距 16px、上下 8px，项之间 1px 分隔线，悬停为 muted 底色，焦点为内收 2px ring 轮廓。第一层是 `text-body` font-medium 名称，第二层是 `text-meta` muted 的次要信息，两层间隔 4px；长名称和标识符换行，不压缩字号。
- [SHOULD] 名称是真实链接；桌面上整行普通点击进入详情，键盘聚焦行时整行显示 muted 底色。
- [SHOULD] 载入时显示 `blocks` 骨架；载入失败显示 `static`（destructive/35）和重试按钮；没有数据和搜索无结果分别用 `Empty` 显示。

### 主从浏览

- [SHOULD] 1024px 起页面锁定在视口可用高度内：左侧 288px 导航列表，右侧内容，两侧分别滚动。1024px 以下导航改为横向 `Tabs`，页面整体滚动。
- [SHOULD] 导航列表使用虚拟滚动，只渲染可见项、预加载项和当前选中项；方向键、Home、End 切换选中项，焦点随选中项移动。
- [SHOULD] 内容区的每条记录是一张 `fp-card`：标题行为 `text-meta` muted 的序号与元数据，右侧为状态徽标；原文用 `fp-reply` 原样显示；参考原文放在 `text-card-title` 的折叠项里。

### 长文文档

- [SHOULD] 顶栏下为 1440px 框架：1024px 起左侧为页面树侧栏（顶部是搜索框），中间为正文，1280px 起右侧为本页目录。1024px 以下页面树改为抽屉，顶栏下方 44px 的 `DocsBar` 放目录和搜索按钮，本页目录收为可展开的条。
- [SHOULD] 页面标题用 `text-h1`；描述、侧栏、目录用 `text-body`；h2 用 `text-section-title`，h3 用 `text-card-title`；正文段落 14px、行高 1.75，颜色为 90% 前景色；行内代码和代码块 13px 等宽。（决策：长文行高高于工具页的 1.5，只用于文档正文。来源：2026-10-01 文档站按本文件实现时确定。）
- [SHOULD] `Card` 为 12px 圆角、1px 边框、16px 内边距、无阴影，卡片间隔 16px；图标用 muted-foreground 放在标题左侧，不放图标底板。
- [SHOULD] `Callout` 沿用 `Alert` 的外观：8px 圆角；info 与 idea 用 primary 图标；warn 用 warning 底色和边框；error 用 destructive；success 用 success 图标。
- [SHOULD] 代码块为 8px 圆角、细边框；Tabs 的标签栏和面板是同一张 12px 圆角卡片，面板内不再嵌套卡片。
- [SHOULD] 表格撑满正文宽度，表头为 600 字重、muted 底色；列宽之和超过正文时，表格在外层容器内横向滚动，字号不变；同一列的 th 与 td 对齐方式相同。（决策：表格保持表格布局，宽表交给外层容器滚动。来源：2026-10-02 用户指出文档表格没有撑满外框。）
- [SHOULD] 表头不换行；某列所有正文单元格都不超过 8 个汉字或 16 个拉丁字符时，整列 `whitespace-nowrap`。（决策：自动表格布局把剩余宽度分给最长的列，中文可在任意两字之间断行，短表头会被挤成一字一行。来源：2026-10-02 用户指出“位置”表头竖排。）
- [SHOULD] Mermaid 图居中，过宽时横向滚动；渲染完成前显示 13px muted 源码。

### 导出图片

- [SHOULD] 用浏览器 Canvas 绘制：逻辑宽度 1200px，按 2 倍像素密度导出 PNG；使用当前语言和主题配色，等待字体加载完成后绘制。
- [MUST] 导出图片不包含凭据、请求地址和用户输入的原文。
- [MUST] 零置信度的条形宽度为零；不可用的置信度显示破折号。

### 链接预览图

- [MUST] 1200×630，深色主题。顶部一行：左侧品牌，右侧主机名（22px，muted-foreground）。中间垂直居中依次为分组行、标题、描述。底部为 128px 高的数字雨像素带，上边 2px border 分隔：`rain` 效果，每格 8px，muted-foreground/30，`mask-image: linear-gradient(90deg, transparent 25%, #000 70%)` 向左渐隐。
- [SHOULD] 字号只用于预览图：品牌为顶栏尺寸的 1.5 倍（指纹 48px、标题 21px、署名 18px）；分组行 24px、行高 1.4、muted；标题 68px、行高 1.12、600 字重、`text-balance`，最多 2 行；描述 30px、行高 1.5、muted、`text-pretty`，最多 2 行。（决策：预览图在链接卡片里约缩小到 0.4 倍，字号需要放大。来源：2026-10-02 预览图改版时确定。）
- [MUST] 限制行数的文字同时使用 `line-clamp-*` 和 `text-ellipsis`，截断处显示省略号。
- [MUST] 文字框离左右边缘至少 48px、离上下边缘至少 20px，文字框之间不重叠，装饰不压在文字上。检查方法：对全部预览图用 Takumi `measure()` 比较文字框与装饰框。
- [SHOULD] 分组行显示页面所在的上级分组，用“ / ”连接；末级分组与标题相同时不显示它；没有分组或没有描述时，不输出对应的行。
- [SHOULD] 颜色只用 `fd-*` 类（如 `bg-fd-background`、`text-fd-muted-foreground`）；像素图案是对应效果减少动效时的静帧（3.7 秒、固定种子），用 currentColor 的方格绘制。

## 4. 视觉规则

### 字体与颜色

- [SHOULD] 界面文字用 `--font-sans`（Geist Variable 加 CJK 系统回退）；列表、表格和结论中作为条目名称的标识符也用 `--font-sans`。`fp-mono` 只用于输入框里的地址、标识符和密钥，命令片段，名称下方的次级原始标识符（`text-meta` muted），以及证据详情中逐位比较的数值。
- [MUST] 品牌标题用 `--font-brand-title`（Noto Serif SC Variable），署名用 `--font-brand-byline`（Noto Sans SC Variable）。
- [SHOULD] 字号只用以下角色。例外：按钮的 `sm`/`xs` 尺寸自带字号；代码片段与提示条用 13px。

| 角色 | 用途 |
|---|---|
| `text-display` | 结论中的主名称、不可评分时的结论 |
| `text-display-number` | 结论中的主百分比 |
| `text-h1` | 页面标题，每页一个 |
| `text-section-title` | 区块标题、证据块的主值、文档 h2 |
| `text-card-title` | 卡片标题、折叠项标题、文档 h3 |
| `text-body` | 正文、控件、表格、列表行 |
| `text-meta` | 计数、日期、标签、次要说明 |

- [MUST] `text-meta` 不承载主要操作、结论和限制说明。
- [SHOULD] 768px 以下输入框字号为 1rem，避免移动浏览器自动缩放。
- [SHOULD] 数值使用 tabular-nums（全局已开启）。
- [SHOULD] 颜色只用 `web/src/tokens.css` 的 token，浅色与深色各一套；页面不写色值字面量。语义如下：

| token | 含义 |
|---|---|
| `primary` | 主要操作、焦点环、当前导航、链接、置信度条 |
| `success` | 完成、一致、可用 |
| `warning` | 进行中、不足、需要注意 |
| `destructive` | 失败、错误、不一致 |
| `muted-foreground` | 次要文字、像素装饰 |
| `star` | 只用于 Star 入口（`fp-star-link`、`fp-repository-star`），不作状态色 |

- [MUST] 置信度条只用 primary，不按候选所属的分组分配颜色。

### 布局与表面

- [SHOULD] 页面容器左右内边距：640px 以下 16px，640px 起 24px，1024px 起 32px；顶栏内容区相同。最大宽度 1440px。
- [SHOULD] 区块间隔 24px；卡片间隔和卡片内边距 16px；卡片内的组间隔 12px；行内元素间隔 8px。
- [SHOULD] 卡片用 `--radius-card`，控件、代码块和提示框用 `--radius`，徽标用 `--radius-badge`；边框为 1px `--border`。普通卡片不加阴影，只有浮层使用 `--shadow-overlay`。
- [SHOULD] 只为真实的对象或数据集合设置表面；卡片里不再嵌套卡片，详情中的列表不加边框。
- [MUST] 页面不横向溢出：长文本先换行（标识符用 `overflow-wrap:anywhere`）或在自身区域内滚动，不隐藏整页溢出。
- [MUST] 全局预留滚动条空间（`scrollbar-gutter: stable`），内容不随滚动条出现而横移。
- [SHOULD] 断点只用以下四个：640px（容器内边距、顶栏双行）、768px（固定操作栏、候选行两行、列表与表格切换、触控尺寸）、1024px（三列网格、文档侧栏、主从分栏、证据两列）、1280px（文档本页目录）。文档站 Fumadocs 的 `md` 断点设为 1024px。

### 控件与状态

- [SHOULD] 按钮 `Button`：每个操作区只有一个 `default`（primary）主按钮，放在最右；次要操作用 `outline`；工具栏和行内低优先级操作用 `ghost`；危险操作用 `destructive`。操作栏用默认尺寸（36px），行内用 `sm`，图标按钮用 `icon-*`。
- [SHOULD] 状态徽标：`Badge` 高 22px、`--radius-badge`、`text-meta` font-medium，色调取 `toneClass` 的 muted、success、warning、destructive；进行中时在文字前加旋转的 lucide `Loader2`。
- [MUST] 进行中的徽标和按钮用 lucide `Loader2` 旋转图标，不用像素 spinner。
- [SHOULD] 等待与载入：计算状态行用 `scan` 加 `PixelSpinner`；列表载入用 `blocks`；尚无内容的输入区用 `rain`；等待开始的区域背景用 `dither`。
- [SHOULD] 空状态、未找到、无法评分：`Empty` 加 `static` 像素效果；载入失败时改用 destructive/35，并给出重试按钮。
- [SHOULD] 错误：字段错误用 `FieldError`；区块级错误用 `Alert variant="destructive"`；需要注意的整行提示用 `Alert variant="warning"`；原始错误详情放在用户主动打开的 `Dialog` 里。
- [SHOULD] 禁用：50% 不透明度、`not-allowed` 光标；运行中被锁定的区域整体禁用，不隐藏。
- [SHOULD] 复制、保存等即时操作用 `Sonner` toast 反馈结果。
- [SHOULD] 请求读者行动的 toast 用 `toastWithStar` 的 `fp-star-toast`：外观与 Sonner 默认 toast 相同（`popover` 表面、1px 边框、`--radius`、13px 文字，成功时标题前加 `CircleCheck`）；文字下方右对齐一行操作，依次为 muted ghost `sm` 的拒绝、ghost `sm` 的忽略，最右为 `fp-star-link[data-size="sm"]`。拒绝和忽略的文案写明各自的隐藏时长（一周、一次）。读者点过 Star 入口后，同一操作只显示普通 toast；拒绝后一周内也是如此。（来源：2026-10-06 用户要求 Star 请求带忽略和拒绝按钮，并给出两者的文案。）
- [SHOULD] toast 停在右下角：600px 以上右缘与 1440px 内容栏的右缘对齐（离视口右边至少等于页面左右内边距），离底边 32px；600px 及以下左右各 16px、离底边 16px。768px 以下的检测页再抬高 64px，停在固定操作栏上方。（来源：2026-10-06 用户要求 toast 离右下角留出更多距离。）
- [MUST] 每个可聚焦元素有可见的焦点样式：控件原语用 3px `ring-ring/50` 加 `border-ring`；链接和其他元素用全局 2px `--ring` outline、偏移 2px；第三方控件去掉 outline 时补 2px ring。可滚动区域可以用键盘聚焦。

### 动效

- [MUST] 弹簧参数只来自 `web/src/lib/motion.ts` 的 `spring`：`snappy` 用于短控件反馈和局部高度展开；`smooth` 用于导航容器内的位置变化和列表重排；`gentle` 用于数值和置信度条。
- [MUST] 弹簧阻尼足够，元素不越过目标位置再回弹。
- [SHOULD] 置信度条用 `scaleX` 做动画，不逐帧修改宽度；按钮、徽标和 Tabs 不用 `transition-all`。
- [SHOULD] 工具页之间切换用原生 View Transition 横向平移 300ms：前进向左，返回向右，顶栏不动；切换后回到顶部；浏览器不支持时直接切换。
- [SHOULD] 列表首批最多 8 项，每项错开 60ms（`listStagger`、`listItem`）；展开的后续项不错开。
- [SHOULD] 卡片和它的详情不共享 `layoutId`，详情只在原位做高度展开。
- [SHOULD] 卡片里的参考原文被替换时，卡片按位置保留，原文在原位用 `smooth` 交叉淡入：旧文字上移 8px、模糊 4px 后淡出，新文字从下方 8px、模糊 4px 进入；多张卡片按顺序错开 60ms。触发替换的按钮图标每次用 `smooth` 转半圈。（来源：2026-10-06 用户要求替换提示词时加过渡动画。）
- [SHOULD] 流式文本不做逐字动画，末尾用 `fp-caret` 闪烁光标。
- [SHOULD] 成功确认的庆祝效果：从视口左下角和右下角同时向中间喷出一次彩带，每侧 220 片、扩散角 32°，主体射程为视口宽度的 75%；同一结果只播放一次。
- [MUST] 减少动效时：取消错开与位移，数值直接显示目标值，浮层、加载和 CSS 过渡立即完成，像素装饰只画一帧，不播放庆祝效果。
- [MUST] 动效不阻挡取消、输入和键盘导航。

### 像素装饰

- [MUST] 只用 `PixelShader` 和 `PixelSpinner`；全站共享 `web/src/lib/pixel-renderer.ts` 的一个 WebGL 上下文，不为单个装饰新建上下文。
- [SHOULD] 宿主元素决定尺寸，画布按 `cell` 整格放大，`image-rendering: pixelated`。
- [MUST] 颜色取宿主的 currentColor（含透明度），按下表使用 muted-foreground 及其透明度，不用蓝色或黄色粒子。例外：主按钮内的 spinner 跟随按钮文字色；载入失败用 destructive/35。
- [MUST] 装饰设 `aria-hidden`，不接收指针事件，不承载数据含义；背景装饰放在 `isolate` 容器的 `-z-10` 层，不遮挡文字。
- [MUST] 只绘制进入视口的装饰，最高 24fps，时间按 0.5 倍速推进（`PLAYBACK_RATE`）；不支持 WebGL 时保持透明。

| 效果 | 使用位置 | 颜色 |
|---|---|---|
| `fingerprint` | 品牌标识，2px 格；预览图品牌标识的静帧 | muted-foreground |
| `rain` | 提示条背景（向左渐隐）；尚无内容的输入区；预览图底部像素带的静帧 | muted-foreground/30 |
| `dither` | 等待开始的区域背景 | muted-foreground/20 |
| `march` | 进行中卡片标题下的分隔线 | muted-foreground/60 |
| `scan` | 计算状态行 | muted-foreground/60 |
| `spinner` | 计算中的主按钮、计算状态行、详情载入 | currentColor |
| `blocks` | 列表与详情的载入骨架 | muted-foreground/25 |
| `logo` | 结论名称旁的品牌像素标识 | 品牌色；单色部分用 foreground |
| `static` | 空状态、未找到、无法评分、载入失败 | muted-foreground/40–45；失败用 destructive/35 |

- [MUST] `logo` 效果画成像素画：24×24 网格，覆盖过半的格子画成实心像素并沿用品牌色，无抗锯齿，轮廓压暗，右下方一格半透明黑色阴影。黑色或白色的单色标识用 currentColor，随主题重绘。宽屏 72px，放在名称右侧；窄屏 48px，放在标签上方。`web/src/lib/brand-logos.ts` 没有对应 SVG 时不显示。

## 5. 可用原语

| 角色 | 实现名称 | 路径 | 使用条件 | 状态 |
|---|---|---|---|---|
| 颜色与主题 | `background` `foreground` `card` `popover` `primary` `secondary` `muted` `muted-foreground` `accent` `border` `input` `ring` `success` `warning` `destructive` `star` | `web/src/tokens.css`、`web/src/index.css` | 所有颜色 | 已实现 |
| 圆角与阴影 | `--radius` `--radius-card` `--radius-badge` `--shadow-overlay` | `web/src/tokens.css` | 控件、卡片、徽标、浮层 | 已实现 |
| 字号角色 | `text-display` `text-display-number` `text-h1` `text-section-title` `text-card-title` `text-body` `text-meta` | `web/src/tokens.css` | 所有文字 | 已实现 |
| 应用外壳 | `fp-topbar` `fp-topbar-inner` `fp-topbar-actions` `fp-brand` `fp-brand-mark` `fp-brand-text` `fp-brand-title` `fp-brand-byline` `fp-nav` `fp-nav-indicator` `fp-repository-link` `fp-repository-star`；`--fp-topbar-height` | `web/src/shell.css` | 工具页和文档页顶栏 | 已实现 |
| 页面容器 | `fp-shell` `fp-page` `fp-page-wide` `fp-footer` | `web/src/index.css` | 工具页 | 已实现 |
| 工作台布局 | `fp-grid-samples` `fp-detect-footer` `fp-actionbar` `fp-cli-promo` `fp-cli-command` `fp-cli-link` `fp-star-link`（`data-size="sm"`） | `web/src/index.css` | 多卡片工作台 | 已实现 |
| 表面与数据 | `fp-card`（`data-warning`） `fp-bar` `fp-reply` `fp-mono` `fp-caret` `fp-api-summary` `fp-result-summary` `fp-result-score` `fp-result-row`（`data-unscored`） | `web/src/index.css` | 卡片、置信度条、原文、标识符、候选行 | 已实现 |
| 控件 | `Button` `Input` `Textarea` `Field` `FieldError` `Switch` `ToggleGroup` `Segmented`（选项 `icon` `recommended`） `Tabs` `Collapsible` | `web/src/components/ui/`、`web/src/components/segmented.tsx` | 表单与操作 | 已实现 |
| 品牌标识 | `BrandIcon` | `web/src/components/brand-icon.tsx` | `Segmented` 选项 | 已实现 |
| 浮层 | `Dialog` `DropdownMenu` `Tooltip` `Sonner` `toastWithStar`（`fp-star-toast`） | `web/src/components/ui/`、`web/src/components/star-prompt.tsx` | 详情、菜单、提示、toast | 已实现 |
| 数据反馈 | `Table` `Badge` `Empty` `Skeleton` `Alert`（`default` `warning` `destructive`） `Separator` | `web/src/components/ui/` | 表格、状态、空状态、警告 | 已实现 |
| 工作台组件 | `SampleCard` `SampleStrip` `StateBadge` `toneClass` `ResultPanel` `ConfidenceBar` `AnimatedPercent` `ApiConfigPanel` `ProxySettings` `UsageCheck` | `web/src/components/` | 多卡片工作台 | 已实现 |
| 证据详情 | `TokenizerCard` `TokenizerStripButton` `TokenizerDetails` `ModelCheck`；`fp-custom-tokenizer-candidates` | `web/src/components/tokenizer-panel.tsx`、`web/src/components/tokenizer-claim.tsx`、`web/src/index.css` | 两列证据详情 | 已实现 |
| 动效 | `spring` `useMotionPreset` `listStagger` `listItem` | `web/src/lib/motion.ts` | 所有动画 | 已实现 |
| 推荐标记 | `RecommendMark`（`fp-recommend`） | `web/src/components/recommend-mark.tsx`、`web/src/index.css` | 推荐选项、推荐设置、推荐取值 | 已实现 |
| 像素装饰 | `PixelShader`（`effect` `cell` `image`） `PixelSpinner` `fp-pixel` | `web/src/components/pixel-shader.tsx`、`web/src/lib/pixel-effects.ts`、`web/src/lib/pixel-renderer.ts`、`web/src/shell.css` | 品牌、加载、等待、空状态 | 已实现 |
| 文档组件 | `SiteHeader` `DocsBar` `Card` `Callout` `Mermaid` `TokenizerClasses` | `docs/app/components/` | 文档站 | 已实现 |
| 预览图 | `OgImage` `ogResponse` `ogRenderer` `ogFontFamilies` | `docs/app/lib/og-image.tsx`、`docs/app/lib/og-response.ts`、`docs/app/lib/og.server.ts` | 链接预览图 | 已实现 |
| 图标 | lucide-react | `web/package.json`、`docs/package.json` | 所有图标 | 已实现 |

- [MUST] 公开原语是本表列出的 token、类、组件和 prop；页面只使用这些名称，使用前确认 API 存在，不猜测未列出的名称。
- [SHOULD] 页面专用样式使用 `fp-custom-*` 名称，可以使用 Tailwind 的布局和间距工具。（决策：区分共享原语与页面例外，保留 shadcn 的组合方式。来源：项目初版设计决策。）
- [MUST] 页面专用样式只调整位置、尺寸和间距，不改变已发布原语的字号、边框、圆角和表面；新的跨页面视觉变体先加入共享组件或类。

背景装饰需要 `isolate` 容器：

```tsx
<div className="relative isolate overflow-hidden rounded-xl border">
  <PixelShader effect="dither" className="absolute inset-0 -z-10 text-muted-foreground/20" />
  <p className="text-body">等待开始</p>
</div>
```

整行警告带图标与可选操作：

```tsx
<Alert variant="warning" className="p-4">
  <TriangleAlert aria-hidden="true" />
  <AlertTitle>标题</AlertTitle>
  <AlertDescription>说明</AlertDescription>
</Alert>
```

## 6. 文案与数字格式

- [MUST] 界面文案按读者选择的语言显示；用户输入的文本、生成的文本、标识符和原始记录保持原文，不翻译。
- [SHOULD] 标题用名词短语；按钮用动词开头的短语；说明文字用一句话写条件或后果，不重复标题。
- [SHOULD] 第三方协议和 API 名称使用官方写法。
- [MUST] 结果文案只复述数据给出的结论、排名和限制说明，不补写解释、原因或数据之外的阈值判断；排名不写成身份确认。
- [MUST] 错误提示用读者能操作的语言列出可能的原因和检查项，不断言单一原因；原始错误详情只在用户打开的对话框里显示。
- [MUST] 界面、导出图片、错误详情和日志不显示密钥和 Authorization 值；原始详情先脱敏。
- [MUST] 缺失的日期、来源和原文写明缺失，不补造；记录里不存在的元数据项不显示占位值。
- [SHOULD] 百分比保留一位小数，按读者语言格式化（i18n 的 `percent`）；计数使用读者语言的千位分隔（`number`）；日期显示为年、月、日，月和日补足两位（`date`）。
- [SHOULD] 单行省略的长值（标识符、地址、原文）把完整值放在 `title` 中。

## 7. 反模式

- [SHOULD] 不默认采用居中宣传标题加卡片网格的页面结构。
- [SHOULD] 不在卡片里嵌套卡片。
- [SHOULD] 不放装饰性图标底板或彩色图标背景；`EmptyMedia` 只放像素装饰。
- [SHOULD] 不使用原语之外的字号、字重或色值字面量。
- [SHOULD] 主要信息不用小号、低对比度的文字。
- [SHOULD] 普通元数据不用胶囊徽标；徽标只表示状态。
- [SHOULD] 不使用渐变；预览图像素带的渐隐遮罩除外。
- [MUST] 不用蓝色或黄色像素粒子装饰非强调区域。
- [MUST] 不把未知或不可用的数值显示为 0。
- [MUST] 不把推断性的结论写成确认。

## 8. 实现与接入

- [MUST] 颜色 token、字号角色和品牌字体只在 `web/src/tokens.css` 定义；顶栏外壳类和像素装饰宿主 `.fp-pixel` 只在 `web/src/shell.css` 定义。检测站由 `web/src/index.css` 在 `@import "tailwindcss"` 之后导入两者；文档站由 `docs/app/app.css` 直接导入两者，再由 Fumadocs 的 `shadcn.css` 把颜色映射为 `fd-*`。修改 token 或外壳类时同时检查两处和预览图。
- [SHOULD] 预览图由 `docs/app/lib/og-response.ts` 把 `web/src/tokens.css` 和 Fumadocs 的 `shadcn.css` 原文交给 Takumi；`docs/app/lib/og.server.ts` 用 tokens.css 中的族名注册 Geist Variable、Noto Sans SC Variable 和 Noto Serif SC Variable 的 Latin 子集，没有指定字体的文字按 Geist、Noto Sans SC 回退（Takumi 不读系统字体）。
- [SHOULD] 字体加载：Geist 来自 `@fontsource-variable/geist`；品牌字体在 `web/src/tokens.css` 用 `@font-face` 引用 `@fontsource-variable/noto-serif-sc` 与 `@fontsource-variable/noto-sans-sc` 的 Latin WOFF2，随站点构建加载。
- [MUST] 主题由 next-themes 在 `html` 上切换 `dark` 类；`web/index.html` 在页面加载前读取偏好，避免闪烁。偏好保存在 `fp-theme`，文档站通过 Fumadocs RootProvider 的 `storageKey` 使用同一个键，两站的主题选择互相同步。存储不可用时按系统外观显示；原生控件和滚动条使用当前主题的 color-scheme。
- [SHOULD] 组件来自 shadcn 的 base-nova（Base UI），位于 `web/src/components/ui/`；动画使用 framer-motion；图标使用 lucide-react。不切换到另一套组件系统。
- [SHOULD] 文档站的 MDX 组件映射在 `docs/app/components/mdx.tsx`。Markdown 表格使用 Fumadocs 的滚动外层，表头与短列由 `docs/app/lib/remark-label-columns.ts` 标记为不换行；由数据生成的表格使用同一个外层，表头同样不换行。文档顶栏通过相对路径导入 `web/src/components/pixel-shader.tsx`，只在浏览器中懒加载。
- [SHOULD] 公式样式来自 `katex/dist/katex.css`；`docs/package.json` 中 `katex` 的版本与 rehype-katex 依赖的版本保持一致，否则公式失去排版规则。

## 词汇表

| 概念 | 名称 |
|---|---|
| 工具页和文档页共用的顶部条 | 顶栏 `fp-topbar` |
| 顶栏左侧的像素指纹与两行文字 | 品牌标识 `fp-brand` |
| 一次处理多份同类输入并给出结论的页面类型 | 多卡片工作台 |
| 工作台里的一份输入及其参考原文 | 输入卡片 `SampleCard` |
| 结果状态下收起的卡片行 | 摘要条 `SampleStrip` |
| 页头下方一行的命令与入口 | 提示条 `fp-cli-promo` |
| 页面末尾的主次操作 | 操作栏 `fp-actionbar` |
| 结论卡片与候选列表 | 结果区 `ResultPanel` |
| 候选列表中的一行 | 候选行 `fp-result-row` |
| 表示匹配程度的横条 | 置信度条 `ConfidenceBar` |
| 收起为一行摘要的表单卡片 | 配置卡片 `ApiConfigPanel` |
| 判定、核对和逐条记录的展开详情 | 两列证据详情 `TokenizerDetails` |
| 表格或两层列表形式的数据页 | 数据长列表 |
| 左侧导航、右侧内容的页面类型 | 主从浏览 |
| 侧栏、正文、本页目录组成的页面类型 | 长文文档 |
| 浏览器生成的结果 PNG | 导出图片 |
| 文档构建生成的 Open Graph 图片 | 链接预览图 `OgImage` |
| GLSL 像素动画 | 像素装饰 `PixelShader` |
| 表示状态的小标签 | 状态徽标 `Badge`、`StateBadge` |

## 待定事项

- [UNCONFIRMED] 数据记录卡片和主从浏览的分组小标题使用 h2 语义，但视觉为 `text-meta`；区块标题的语义层级与视觉层级是否应一致，尚未确认。（来源：2026-10-02 测量记录，主从浏览页“Closest fingerprints”与记录卡片标题。）
- [UNCONFIRMED] 768px 以下，32px 高的输入框行高为 22.857px，其他输入框为 24px；高度与行高是否应统一，尚未确认。（来源：2026-10-02 测量记录，配置卡片在 390px 宽度下。）
