# VeryMath智慧教材

个人部署的课程学习工作台：左侧阅读教材，右侧与 Copilot 交互，两条分隔线可以拖动。整个项目按三层分工：

```text
前端 UI：教材、目录、选中文字、对话、图谱、课件、视频
                    ↕ 请求、进度、回答、结果
Coding Agent：理解要求 → 读取教材 → 调用一个或多个 Skill
                    ↕ 读取与保存文件
个人课程目录：原始教材、解析内容、阅读记录、对话、生成资料
```

本机 HTTP 服务负责传递请求、返回进度、读写文件和提供 PDF／生成文件。教学任务统一交给 `server/agent.mjs` 中的 Coding Agent。七个专项 Skill 与自由问答按钮表达操作意图，Agent 可以组合多个 Skill。

**支持个人部署，选择 Agent 后连接即可，默认统一使用 ACP。** 提供 Codex、Claude Code、OpenCode、Cursor、Gemini CLI、Copilot CLI、Qwen Code、Kimi Code、Kiro CLI 和自定义 Agent。Codex 与 Claude 的 ACP 适配器随项目安装；原生接口及非交互命令行兼容选项放在高级设置中。每个人使用自己的 Agent 账号。教材解析、讲解内容、知识点出题、思维导图、知识图谱和 LaTeX Beamer 课件随项目提供 Skill；讲解视频可在工作区设置中填写自定义 Skill 路径。各项任务通过所选 Agent 执行，路径已配置不代表任务已经执行成功。

## 运行

在要部署的电脑上准备 Node.js 22.13 或更新版本，并安装至少一种 Agent：

| Agent | 官方安装说明 | 本机账号配置 |
| --- | --- | --- |
| Codex | [安装 Codex CLI](https://developers.openai.com/codex/cli/) | 使用自己的 Codex 登录或模型服务配置 |
| Claude Code | [安装 Claude Code](https://code.claude.com/docs/en/setup) | 使用自己的 Claude 登录或 Claude Code 配置 |
| OpenCode | [安装 OpenCode](https://opencode.ai/docs/) | 在 OpenCode 中配置自己的模型服务 |

无需安装 Codex 桌面应用，也无需安装全部三种 Agent。在项目目录运行：

```bash
git clone https://github.com/ConanXu-math/course-copilot.git
cd course-copilot
npm install --package-lock=false
npm run dev
```

私有仓库需要先获得访问权限。首次打开页面，点击「导入教材」选择自己的 PDF，再到「工作区设置」连接 Agent。GitHub 仓库包含应用代码和开发文档，教材原件与个人课程记录保存在部署者自己的电脑上。

开发地址通常为 `http://127.0.0.1:5173`，以终端输出为准。正式运行：

```bash
npm run build
npm start
```

正式地址默认为 `http://127.0.0.1:4173`，可用 `PORT` 改端口。默认只监听本机。开发和正式服务共用同一份文件接口与个人目录，日常只需启动其中一个。

日常使用执行 `npm start`，在浏览器打开上面的地址即可。前端、本机文件服务与 Agent 运行在同一台部署电脑上；单独上传 `dist` 到静态网页托管平台无法运行 Agent。

程序位置优先从该电脑的 `PATH` 查找，也支持在页面中填写完整路径。源码不依赖开发者的用户名、个人目录或账号；macOS 桌面应用路径只用于可选的自动查找。macOS 已进行实际连接与页面验证；Linux 使用相同 Node.js 启动方式，Windows 建议将项目、Node.js 和 Agent 一起安装在 WSL2 中。Linux / WSL2 尚未实际运行验证，暂不声称原生 Windows 已验证。

## 个人数据目录

默认位置为 `~/.course-copilot/`，设置页显示实际完整路径：

```text
~/.course-copilot/
├── settings.json                   # 当前课程、栏目宽度、Agent 与 Skill 设置
└── courses/
    └── 面向机器学习的最优化方法/
        ├── textbook.pdf            # 原始教材
        ├── textbook/
        │   ├── course.json         # 教材名称、页数
        │   ├── outline.json        # 章节目录
        │   ├── pages/              # 已阅读页面的正文
        │   └── images/             # 教材图片预留目录；当前解析 Demo 写入 outputs
        ├── reading.json            # 页码、书签、笔记数据、当前对话
        ├── conversations/          # 每段对话分别保存
        └── outputs/                # 图谱、课件、视频和结果描述
```

启动时可指定其他位置：

```bash
COURSE_COPILOT_HOME="$HOME/Documents/我的课程资料" npm start
```

切换路径后会使用新位置，不自动搬动旧目录。迁移时先停止服务，复制完整个人目录，再指定新位置启动。备份也复制完整目录；生成任务结束后再备份能避免漏掉正在写入的文件。

换电脑后，在新电脑上安装并登录所选 Agent。如果手动填写的程序或 Skill 路径改变，在设置页更新即可。默认自动查找的程序路径无需随电脑修改源码。

应用创建的目录权限为 `0700`，文件为 `0600`。Agent 写入生成文件时也应使用私有权限；服务发布本地文件结果时会将对应文件收紧为 `0600`。不要把个人数据目录作为网页静态目录公开。

浏览器内仅保留当前界面状态。教材文件、阅读位置、书签、对话、结果和栏宽由本机服务保存，换浏览器或清除缓存后可重新读取。页面显示保存失败时可以重试，关闭前等待保存完成。当前有笔记数据字段，尚未增加笔记编辑界面。

首次使用时可以直接导入自己的 PDF；如果本地项目目录已有配套的最优化教材 PDF，空课程目录会自动导入它，源码仓库不包含该 PDF。导入 PDF 会新增独立课程，同名教材使用不同文件夹。旧版浏览器中的教材、阅读和对话会在启动时迁移；服务确认成功后才清理对应旧记录。迁移失败时原浏览器数据仍保留，刷新可重试。

阅读器使用 PDF.js 连续滚动展示原始 PDF，页码对应 PDF 页序。滚动时界面同步当前可见页；目录跳转、书签和页码输入会定位到指定页。选中文字可跨连续页面引用。正文随着阅读提取并保存到 `textbook/pages/`。整章、整书的知识结构任务由 Agent 调用相应 Skill 补读原始 PDF。

## 思维导图与知识图谱

[`skills/mindmap`](skills/mindmap/SKILL.md) 与 [`skills/knowledge-graph`](skills/knowledge-graph/SKILL.md) 随项目提供，默认路径在 [`server/skills/structure.mjs`](server/skills/structure.mjs) 中按仓库位置计算。连接 Agent 后即可在课程工具中选择。

思维导图按章、节或选文范围生成层级知识树。节点可带 PDF 页码，点击返回教材。学生可在节点上保存蓝色补充文字；生成原文保持黑色，补充通过专用接口持久保存。

知识图谱使用 v2 格式，支持概览与详细两种深度。节点记录概念类型与同义标识，连线记录关系文字、教材依据或推断标记，以及带页码的证据摘要。中央面板提供概念网络视图，支持搜索、拖动、缩放和证据跳转。

学习资料按类型分列：全部资料、思维导图、知识图谱。列表按教材章节顺序排列，并显示每条资料的范围标注。继续讨论某份导图或图谱时，Copilot 会带上该资料上下文。

PDF 页码范围读取共用 [`skills/mindmap/scripts/read-pages.mjs`](skills/mindmap/scripts/read-pages.mjs)。知识图谱 JSON 写完后，运行 [`skills/knowledge-graph/scripts/validate-knowledge-graph.mjs`](skills/knowledge-graph/scripts/validate-knowledge-graph.mjs) 检查结构。

## LaTeX 公式

对话、文字资料和文字课件共用 KaTeX 公式渲染组件，支持行内公式和独立公式。分式、上下标、求和与矩阵按数学排版显示，较长公式可横向滚动。代码块中的 LaTeX 以源码形式展示。

「生成课件」通过 LaTeX Beamer 编译 PDF，学习资料支持章节 PDF 预览与源文件下载。

## 教材 PDF 课件

[`skills/textbook-to-ppt`](skills/textbook-to-ppt/SKILL.md) 随项目接入「生成课件」。连接 Agent 后，选择当前页、选中内容、当前章节或整本教材，并发送要求。整书任务按教材章节分别生成 PDF；章内按教材小节编排，默认采用 16:9 页面。定义、定理、证明、算法和例题按教材内容展开，页脚使用幻灯片页码，教材位置对应与校对说明记录在 LaTeX 源码注释中。

部署电脑需要可用的 XeLaTeX，以及 Beamer、ctex、数学宏包和中文字体。可使用包含这些组件的 TeX Live 或 MacTeX 安装；程序从 PATH 查找 XeLaTeX，macOS 也查找 `/Library/TeX/texbin/xelatex`。Agent 直接运行编译命令并检查生成页面，依赖缺失时会报告具体原因。

「生成课件」提供白底深蓝、米白宋体、蓝色标题栏三套模板。新建课件默认使用白底深蓝，修改已有课件时默认沿用原模板。选择模板后，应用将模板资源目录与选择结果交给 Agent；公共排版设置和所选主题会一同保存到源码 ZIP。

「工作区设置 → 课件编译环境」显示 XeLaTeX 路径、版本、缺失宏包和字体情况，可点击「重新检查」。环境信息也随课件任务传给 Agent。检查通过表示所列程序和资源能够被找到，最终 PDF 的编译与页面检查由生成任务完成。

生成结果保存在当前课程的 `outputs/slides-<结果ID>/`。学习资料中的课件提供章节选择、PDF 预览、PDF 下载和 LaTeX 源文件 ZIP 下载。源文件包含公共排版设置、各章编译入口、小节正文及引用图片，支持教师选取小节后重新组合编译。PDF 预览使用浏览器的 PDF 阅读器，工具栏也提供独立打开文件的链接。

默认 Skill 路径由项目位置计算。个人设置中已有的路径配置继续生效；曾保存过空路径的用户，可在「工作区设置 → 接入 Skill → 生成课件」填入项目中 `skills/textbook-to-ppt/SKILL.md` 的完整路径。

## 课程智能体的公共教学要求

[`server/prompts/course-tutor.md`](server/prompts/course-tutor.md) 面向不同学科、学习阶段和部署者，定义课程智能体如何帮助学习：围绕课程目标组织内容、连接先修知识、依据教材讲解、按理解程度调整解释、提供练习反馈、衔接已有讨论，以及制作与课程目标一致的资料。交流语言跟随用户，不固定学校、教材或个人背景。

三种 Agent 共用这份提示词，每次任务重新读取，修改后下一轮问答即可使用。具体课程、阅读位置和已有对话由本次请求提供，专项 Skill 补充相应方法。这些要求指导 Agent 的教学行为，不代表工作台已经具备自动测评或长期学习档案功能。

可视化也是公共教学要求的一部分：图表有助于理解时，Agent 应主动采用关系图、流程图、时间线、对比表、曲线或示意图，并配合阅读指引与解释。界面当前支持 Markdown 表格、图片和知识结构资料；交互式演示取决于实际接入的工具及展示能力，提示词本身不会增加渲染组件。

图表同时要求明确的视觉层次、克制且一致的配色、易读标签和充分留白。复杂讲解应分图呈现，在实际显示尺寸下检查效果；美化保持数据、几何比例和数学含义准确。

## 三人开发 Skill

完整操作步骤、最小 `SKILL.md`、结果格式和新增按钮示例见 **[Skill 模块开发与接入](docs/skill-development.md)**。

同学 A 的三个 Demo 已放在 [`skills/textbook-parse`](skills/textbook-parse/SKILL.md)、[`skills/explain`](skills/explain/SKILL.md)、[`skills/quiz`](skills/quiz/SKILL.md)，默认路径按项目所在位置计算。连接 Agent 后即可选择对应按钮。演示步骤与已知范围见 [同学 A Demo](docs/demo-a.md)。

| 负责方向 | 配置文件 | 对应功能 |
| --- | --- | --- |
| A：教材、讲解与练习 | `server/skills/tutoring.mjs` | 教材解析、讲解内容、知识点出题；自由问答由 Agent 处理 |
| B：知识结构 | `server/skills/structure.mjs` | 思维导图、知识图谱 |
| C：教学材料 | `server/skills/materials.mjs` | 课件、讲解视频 |

每位同学独立维护自己的 Skill 目录，包含 `SKILL.md` 及其资源。打开「工作区设置 → 接入 Skill」，填写本机 `SKILL.md` 的完整路径并保存，即时生效。支持 `~/` 开头的路径；留空表示暂不接入。上表文件定义功能的名称和分工，页面保存的个人路径优先于其中的默认 `path`。

这些配置描述技能位置和用途，不运行模型。Agent 读取 Skill 指令，使用课程目录中的真实材料完成任务，结果存入该课程的 `outputs`。各 Skill 共用课程文件，无须修改各自的前端按钮。

接入上表的现有功能时，开发者只需准备自己的 Skill 目录并在设置中填写路径。新增其他功能按钮时，需要同时更新功能列表、`SkillId`、前端按钮和设置页分组；具体文件与代码在开发指南中列出。当前不会仅通过新增一个目录就自动出现按钮。

## 连接 Coding Agent

1. 打开页面右上角「工作区设置」，在统一的 Coding Agent 列表中选择程序，再点击「连接本机…」。Codex、Claude Code 使用项目自带的 ACP 适配器，其他预设自动查找本机程序。具体方法见 [Agent 接入说明](docs/agent-integration.md)。
2. 复用已有登录或按 Agent 提供的认证方式完成登录；也可先在本机终端登录，再重新连接。账号凭据仍由 Agent 自己管理。
3. 在「使用模型」中选择 Agent 返回的模型，或保留「跟随…设置」。关闭设置页即可自由提问。
4. 在「接入 Skill」配置所需技能的路径，即可启用对应功能按钮。

默认 ACP 连接从真实会话读取模型列表，没有提供模型选择接口时跟随原配置。需要兼容旧环境时，可在「高级设置」为 Codex、Claude Code、OpenCode 选择原生接口；自定义 Agent 也可改用非交互命令行。每种方式的程序参数与模型分别保存，升级前的原生程序设置会保留到兼容方式中。仅有封闭图形界面、没有开放接口的产品无法直接接入。

配图由所选 Agent 根据自身实际可调用的 API 和工具自主完成：有文生图能力时优先使用，否则程序绘图。生成的图片保存到当前课程 `outputs`，通过 Markdown 展示。工作台不单独配置图片服务，也不会依据模型名称假定存在生图能力。已有图片和 LaTeX 公式继续正常展示。

切换 Agent 会断开前一个连接，各自的模型和程序路径分别保存在个人设置中，Skill 路径共用。正在执行任务时，先停止任务或等待完成再切换。

「刷新状态」会重新读取连接和账号状态。「断开连接」只结束本工作台持有的连接和进程，保留原生 Agent 的账号配置。服务重启后，在设置中点击连接即可恢复使用；已保存的模型和路径仍保留。连接成功代表程序与本机配置可读，模型服务是否有额度、凭据是否有效仍以实际问答结果为准。

`server/agent.mjs` 统一传递课程内容、历史问答与选定 Skill，处理回答和学习资料；默认使用同一个 ACP 客户端：

- `server/acp-client.mjs` 使用 [ACP](https://agentclientprotocol.com/get-started/agents) 标准接口，处理认证、模型、正文、进度与结束状态。Codex 和 Claude 分别使用随项目安装的 `@agentclientprotocol/codex-acp`、`@agentclientprotocol/claude-agent-acp`；OpenCode 等直接启动各自的 ACP 模式。
- `server/agent-providers.mjs` 维护统一 Agent 列表、默认 ACP 命令、项目适配器入口和高级兼容选项。新增 ACP 预设无需修改前端或课程逻辑。
- `server/codex-client.mjs`、`server/claude-client.mjs`、`server/opencode-client.mjs` 只用于显式选择的原生兼容方式，保留原来的登录与调用流程。
- `server/command-client.mjs` 用于自定义 Agent 的命令行兼容方式，读取非交互 CLI 的纯文本输出。

OpenCode 使用独立的课程配置目录 `<数据目录>/agent/opencode/config`，仅从个人 OpenCode 的 JSON/JSONC 配置接入模型服务、默认模型和模型服务启停设置；登录信息仍由 OpenCode 原生管理。不会继承个人配置中的插件、MCP、Skill 路径或教学指令，并关闭 `.claude`、`.agents` 的 Skill 自动扫描。课程固定使用 `course` Agent，关闭原生 Skill 自动选择和子代理调用，直接读取「接入 Skill」中提供的文件。未配置 Skill 时仍可正常自由问答、绘图和生成资料。

连接时读取标准全局配置和 `OPENCODE_CONFIG` / `OPENCODE_CONFIG_CONTENT` 中的模型设置；配置中的相对文件引用保留原目录含义。修改个人模型配置后，在课程页面断开并重新连接即可生效。课程隔离设置只作用于本应用启动的进程，不修改其他用户的全局配置，也不是操作系统级文件沙箱。

ACP 模式将公共教学要求、教材上下文与本轮要求交给同一个课程任务流程。原生兼容方式继续使用各自的指令接口；OpenCode 原生兼容方式结束后还会补读本次会话消息，检查完成状态。

课程对话保存在本应用的个人目录。ACP 每次课程请求创建独立会话，支持关闭会话的 Agent 会收到关闭请求。原生兼容方式保留原来的临时会话处理。Agent 自身的会话和日志可能继续保存在各自目录中，本应用不会删除这些个人配置和历史。

账号凭据与登录刷新由各 Agent 自己管理，沿用它们原有的保存位置。课程设置不保存 API Key 或登录令牌。本机运行的是 Agent 程序，模型仍使用该 Agent 配置的服务。复制本项目或课程目录不会替其他用户配置账号。

所有 Agent 都收到相同的课程上下文，并被要求只在该课程的 `outputs` 中保存结果。Codex 使用其工作区写入限制；Claude Code 和 OpenCode 使用原生权限处理，不开启跳过权限检查的选项。原生程序要求额外交互时，按回答中的提示在对应 Agent 中处理。

`request` 完整类型在 `src/lib/types.ts`：

| 字段 | 含义 |
| --- | --- |
| `skillId` | 用户选择的操作意图 |
| `book`、`chapter`、`page` | 当前教材、章节与页码 |
| `scope` | 当前页、当前节、当前章、选中内容或整本教材 |
| `knowledgeGraphDetail` | 知识图谱深度：`overview` 或 `detailed` |
| `selectedText`、`pageText` | 选中文字、当前页正文 |
| `prompt` | 用户要求 |
| `artifact` | 正在查看的结果，可要求继续修改 |
| `history` | 当前对话中的问答 |

`scope` 表示范围，不代表整章或整书全文已经放进请求。Agent 可以读取本地教材。

`context` 由本机服务提供：

| 字段 | 含义 |
| --- | --- |
| `courseDir` | 当前课程目录 |
| `textbookPath` | 原始 PDF 完整路径 |
| `textbookDir` | 解析内容目录 |
| `outputsDir` | 生成结果保存目录 |
| `skills` | 已配置且可读的 Skill 信息与路径 |
| `outputUrl(filename)` | outputs 内相对文件名对应的浏览器地址 |
| `signal` | 点击停止或连接关闭时触发取消 |

课程路径由服务端根据课程 ID 查找；前端不指定任意磁盘路径。应把 `signal` 传给实际 Agent 并停止它启动的工作。

## 返回进度与结果

`POST /api/agent/run` 接收请求，逐行返回 JSON 事件：

| `type` | 内容 | 界面用途 |
| --- | --- | --- |
| `progress` | `message` | 当前正在执行的真实步骤 |
| `text` | `content` | 追加回答，支持 Markdown 与公式 |
| `artifact` | `artifact` | 保存结果并在左侧打开 |
| `done` | 无 | 任务完成 |
| `error` | `message` | 显示失败原因 |

每次需要生成资料时，接入层会把一个 `outputs/pending-<结果ID>.json` 的完整路径告诉所选 Agent。Agent 将展示用 JSON 写入该待检查文件，并把图片、PDF 等媒体文件写入同一 `outputs` 目录。服务校验通过后保存为 `result-<结果ID>.json` 并发送 `artifact` 事件；校验失败时保留已有资料。普通问答不要求生成文件。继续修改时会生成新的资料，原资料保留。

| `artifact.kind` | 内容 |
| --- | --- |
| `markdown` | `content` 正文 |
| `mindmap` / `knowledge-graph` | `nodes` 与 `edges`，节点可带教材页码；思维导图节点可含 `userText` 学生补充；知识图谱 v2 含 `detailLevel`、`coverage`、连线 `evidence` 与 `basis` |
| `slides` | PDF 课件使用 `chapters: [{title, url, filename?}]`，可附源文件 ZIP 的 `sourceUrl`；文字课件使用 `slides: [{title, content}]`，可附 `url` |
| `video` / `file` | 文件 `url`，可选 `filename` |

所有结果需要 `id`、`title`、`kind`；具体字段见 `src/lib/types.ts`。未连接 Agent 时返回 HTTP 503，选定的 Skill 未配置时返回 HTTP 501；任务没有返回 `done` 就结束时显示未完成。

## 公共模块

- `src/App.tsx`、`src/components/`：界面与交互。
- `src/lib/useCourseWorkspace.ts`：课程切换、恢复与保存状态。
- `src/lib/storage.ts`：文件接口和旧浏览器数据迁移。
- `src/lib/skill-client.ts`：Agent 状态与流式通信。
- `server/agent.mjs`：连接设置、状态与课程任务。
- `server/codex-client.mjs`：本机 Codex 进程、消息与取消操作。
- `src/components/AgentConnection.tsx`：交互式连接和 Skill 路径表单。
- `server/course-store.mjs`：课程文件读写。
- `server/course-api.mjs`：课程接口、PDF 和输出文件访问。
- `server/api.mjs`：Agent 请求与 PDF 阅读资源。
- `server/index.mjs`：正式本地页面服务。

课程接口包括 `/api/storage`、`/api/settings`、`/api/courses`，以及 `/api/courses/:id/` 下的 `state`、`textbook`、`pages/:page`、`conversations`、`outputs/*`、`migrate`。`GET /api/agent/status` 返回 Agent 和 Skill 配置状态，`GET /api/skills` 返回按钮可用状态。

连接接口包括 `POST /api/agent/connect`、`disconnect`、`login`、`login/cancel` 和 `PATCH /api/agent/config`。这些操作使用 JSON 请求体；配置仅写入个人 `settings.json` 的 `agent` 字段。

后续开发方向见 [围绕知识点的学习流程](docs/learning-flow.md)：图谱选点 → 讲解 → 作答 → 针对性补讲 → 变式练习，文档区分已有能力与待开发部分。

另一个已记录的方向是 [数学与算法实验](docs/math-experiments.md)：调整参数、比较方法，交付真实运行结果、图形和可运行代码，首先考虑用梯度下降的步长实验辅助理解教材。
