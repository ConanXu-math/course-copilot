# 知页 · 课程 Copilot

个人部署的课程学习工作台：左侧阅读教材，在教材下方选择课程工具并输入要求；右侧查看 Copilot 回答与生成资料。两条分隔线可以拖动；右侧最多占教材与结果区可用宽度的一半，即左右 1:1（不含目录）。整个项目按三层分工：

```text
前端 UI：教材、目录、选中文字、对话、图谱、课件、视频
                    ↕ 请求、进度、回答、结果
Coding Agent：理解要求 → 读取教材 → 调用一个或多个 Skill
                    ↕ 读取与保存文件
个人课程目录：原始教材、解析内容、阅读记录、对话、生成资料
```

本机 HTTP 服务负责传递请求、返回进度、读写文件和提供 PDF／生成文件。教学任务统一交给 `server/agent.mjs` 中的 Coding Agent。六个按钮表达操作意图，Agent 可以组合多个 Skill。

**支持个人部署，在页面中选择 Codex、Claude Code 或 OpenCode，再选择模型和填写 Skill 路径。** 每个人使用自己电脑上的 Agent 安装和账号。自由问答通过所选 Agent 执行；思维导图和知识图谱提供仓库内置 Skill，其他三个专项 Skill 需分别配置可读的 `SKILL.md`。路径已配置只代表文件可读，不代表该 Skill 已执行成功。

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
        │   └── images/             # 留给解析 Skill 保存图片
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

阅读器使用 PDF.js 展示原始 PDF，页码对应 PDF 页序。教材支持连续上下滚动，按需渲染附近页面；当前页码和章节随滚动更新，也可通过页码、目录和书签跳转。正文随着阅读提取并保存到 `textbook/pages/`；**当前不会自动解析整本书或提取全部图片**。整章、整书的处理由 Agent 调用相应 Skill 完成。

左侧始终显示教材。右侧的「学习资料」汇总当前教材的全部生成资料；「思维导图」与「知识图谱」分别按资料类型展示并统计数量。已有资料和新生成资料都会自动出现在对应分类中，分类列表和具体内容均在右侧展开，关闭一份图的查看标签后会在右侧返回所属分类列表，教材保持原阅读位置。

思维导图和知识图谱均按教材目录的章、节顺序排列：全书图谱在最前，每章的整章图谱在该章各节之前，每节的整节图谱在该节的局部内容与选文之前。同一范围的多份图谱保留当前列表中的相对顺序；列表下方标注所属章、节和范围。「学习资料」中两类图谱各自在原类型位置上按此规则排列。新生成的图谱会保存生成范围，旧图谱结合标题与引用页码识别；无法定位的资料保留在已识别资料后面。

思维导图的生成原文为只读，始终显示黑色。右键节点或点击铅笔按钮，可以添加、修改或删除自己的补充文字，补充始终显示蓝色。编辑框分别展示只读原文和可编辑补充，清空补充不会删除原文。每个节点的补充最多2000个字符，支持 Markdown 与公式；保存到当前课程的结果文件，刷新、重开或从历史对话打开都会保留，取消不会保存。旧版修改过的节点会恢复生成原文，并将其中新增的文字作为蓝色补充保留。文本框按内容自动展开：长文字换行增高，较宽公式撑宽节点，节点间距同步调整，框内不出现滚动条。

## LaTeX 公式

对话、文字资料和课件共用同一个公式渲染组件。支持 `$...$` 与 `\(...\)` 行内公式，以及 `$$...$$` 与 `\[...\]` 独立公式。分式、上下标、求和、矩阵等由 KaTeX 显示；较长公式可横向滚动。代码中的原始 LaTeX 保留为代码，不会被误转换。

此处渲染数学公式；完整 `.tex` 文档的编译与 PDF 预览尚未接入。

知识图谱从教材正文提炼概念与有依据的关系，支持当前节、当前章、全书或选文。页面采用彩色概念网络：同色表示按实际连接划分的群组，节点越大表示不同的直接邻居越多。支持拖动画布和节点、滚轮缩放、适应全图及概念/别名搜索。点击节点突出直接联系，在对应箭头线上显示完整关系文字；文字无底板，使用连线的原色，连线与圆点使用较浅的颜色。文字范围仅让对应连线留空，不遮断其他经过的线。点击关系文字展开适用条件、依据与PDF页码，节点详情保留完整文字和公式。画布概览使用短名，完整内容仍保留。拖动位置只影响本次浏览；个人补充编辑目前仅用于思维导图。

新生成的知识图谱使用 v2 格式，可选「概览／详细」，逐条记录关系依据、适用条件与覆盖说明；只有用户明确要求推断时才生成并标识推断关系。旧图谱保留并继续展示，缺少逐条依据时显示提示；要获得新版依据，需要重新核实教材并另存新图。格式校验不等于教材语义核实。完整格式见 [`skills/knowledge-graph/references/schema.md`](skills/knowledge-graph/references/schema.md)。

## 三人开发 Skill

完整操作步骤、最小 `SKILL.md`、结果格式和新增按钮示例见 **[Skill 模块开发与接入](docs/skill-development.md)**。

| 负责方向 | 配置文件 | 对应功能 |
| --- | --- | --- |
| A：内容讲解 | `server/skills/tutoring.mjs` | 讲解内容；自由问答由 Agent 处理 |
| B：知识结构 | `server/skills/structure.mjs` | 思维导图、知识图谱 |
| C：教学材料 | `server/skills/materials.mjs` | 课件、讲解视频 |

每位同学独立维护自己的 Skill 目录，包含 `SKILL.md` 及其资源。打开「工作区设置 → 接入 Skill」，填写本机 `SKILL.md` 的完整路径并保存，即时生效。支持 `~/` 开头的路径；留空表示暂不接入。上表文件定义功能的名称和分工，页面保存的个人路径优先于其中的默认 `path`。

内置的 [`skills/mindmap/SKILL.md`](skills/mindmap/SKILL.md) 根据当前节、当前章、整本教材或选文提炼知识树，生成可点击返回 PDF 原页的导图。辅助脚本复用项目已有的 Node.js 和 PDF.js 读取教材，并校验结果结构，无新增依赖。首次部署自动使用仓库内路径；如果个人设置之前已保存空路径或其他路径，在设置中重新选择这份 `SKILL.md` 即可。交付这个功能时，保留整个 `skills/mindmap/` 目录和 `server/skills/structure.mjs` 的默认路径设置。

内置的 [`skills/knowledge-graph/SKILL.md`](skills/knowledge-graph/SKILL.md) 提炼带逐条教材依据的概念网络，支持多父关系、环和同对概念的不同关系。它复用思维导图目录的PDF读取脚本；交付时需同时保留两个Skill的完整目录。

这些配置描述技能位置和用途，不运行模型。Agent 读取 Skill 指令，使用课程目录中的真实材料完成任务，结果存入该课程的 `outputs`。各 Skill 共用课程文件，无须修改各自的前端按钮。

接入上表的现有功能时，开发者只需准备自己的 Skill 目录并在设置中填写路径。新增「习题生成」之类的按钮时，需要同时更新功能列表、`SkillId`、前端按钮和设置页分组；具体文件与代码在开发指南中列出。当前不会仅通过新增一个目录就自动出现按钮。

## 连接 Coding Agent

1. 打开页面右上角「工作区设置」，在「Coding Agent」中选择 Codex、Claude Code 或 OpenCode，再点击「连接本机…」。也可以在「程序位置」填写该 Agent 的完整程序路径。
2. 已有登录和模型服务配置会自动复用。Codex 可在页面发起 ChatGPT 登录；Claude Code 使用它原生的登录流程，有登录链接时可以从页面打开；OpenCode 显示原生 `auth login` 命令，在部署电脑的终端完成后刷新状态。
3. 在独立的「使用模型」中选择模型，或保留「跟随…设置」。Codex 和 OpenCode 的列表来自本机 Agent；Claude Code 提供由其原生程序解析的模型名称。关闭设置页即可自由提问。
4. 在「接入 Skill」配置三位同学的技能路径，即可启用对应功能按钮。

切换 Agent 会断开前一个连接，各自的模型和程序路径分别保存在个人设置中，Skill 路径共用。正在执行任务时，先停止任务或等待完成再切换。

「刷新状态」会重新读取连接和账号状态。「断开连接」只结束本工作台持有的连接和进程，保留原生 Agent 的账号配置。服务重启后，在设置中点击连接即可恢复使用；已保存的模型和路径仍保留。连接成功代表程序与本机配置可读，模型服务是否有额度、凭据是否有效仍以实际问答结果为准。

`server/agent.mjs` 统一传递课程内容、历史问答与选定 Skill，处理回答和学习资料；各 Agent 只负责连接自己的原生程序：

- `server/codex-client.mjs` 使用 [Codex App Server](https://developers.openai.com/codex/app-server/) 的本机标准输入输出接口。
- `server/claude-client.mjs` 使用 [Claude Code 的非交互运行接口](https://code.claude.com/docs/en/headless)，读取原生流式消息。
- `server/opencode-client.mjs` 启动 [OpenCode 本机服务](https://opencode.ai/docs/server/)，读取模型配置并通过原生 `run --attach` 执行课程请求。

课程对话保存在本应用的个人目录；Codex 使用临时会话，Claude Code 关闭本次会话的持久保存，OpenCode 在任务结束后删除本工作台刚创建的临时会话。原生 Agent 仍可能保存自己的运行日志。

账号凭据与登录刷新由各 Agent 自己管理，沿用它们原有的保存位置。课程设置不保存 API Key 或登录令牌。本机运行的是 Agent 程序，模型仍使用该 Agent 配置的服务。复制本项目或课程目录不会替其他用户配置账号。

所有 Agent 都收到相同的课程上下文，并被要求只在该课程的 `outputs` 中保存结果。Codex 使用其工作区写入限制；Claude Code 和 OpenCode 使用原生权限处理，不开启跳过权限检查的选项。原生程序要求额外交互时，按回答中的提示在对应 Agent 中处理。

`request` 完整类型在 `src/lib/types.ts`：

| 字段 | 含义 |
| --- | --- |
| `skillId` | 用户选择的操作意图 |
| `book`、`chapter`、`page` | 当前教材、章节与页码 |
| `scope` | 思维导图和知识图谱：当前节、当前章、整本教材或选中内容；其他工具：当前页、当前章节、整本教材或选中内容 |
| `knowledgeGraphDetail` | 知识图谱的概览或详细程度（`overview` / `detailed`） |
| `selectedText`、`pageText` | 选中文字、当前页正文 |
| `prompt` | 用户要求 |
| `artifact` | 正在查看的结果，可要求继续修改 |
| `history` | 当前对话中的问答 |

`scope` 表示范围，不代表整章或整书全文已经放进请求。Agent 可以读取本地教材。

思维导图和知识图谱的「当前章」对应 PDF 目录的一级条目，「当前节」对应章内的二级条目（包含其下级小节）。请求中的 `chapter` 提供所选章或节的标题及起始页；目录缺失或尚未进入某节时，Agent 会被要求先从原始教材定位，无法确定时询问用户。

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
| `artifact` | `artifact` | 保存结果并在右侧结果区打开 |
| `done` | 无 | 任务完成 |
| `error` | `message` | 显示失败原因 |

每次需要生成资料时，接入层会把一个 `outputs/pending-<结果ID>.json` 的完整路径告诉所选 Agent。Agent 将文件和这个 JSON 对象写入当前课程的 `outputs`；JSON 中包含下表的展示内容。服务读取待检查结果，核对ID及引用文件，对新知识图谱强制执行v2校验，通过后才保存为 `result-<结果ID>.json` 并发送 `artifact` 事件。生成期间界面读取已确认资料；任务结束或停止后隔离未经确认的结果、恢复被意外改写的旧资料，同时保留期间正式保存的用户补充。普通问答不要求生成文件。继续修改时会生成新的资料，原资料保留。

| `artifact.kind` | 内容 |
| --- | --- |
| `markdown` | `content` 正文 |
| `mindmap` / `knowledge-graph` | `nodes` 与 `edges`，节点可带教材页码 |
| `slides` | 每页 `title` 与 `content`，可选下载 `url` |
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

## 本轮开发交付

相对初始开发基线的完整功能、文件分组、验证结果和已知限制见 [2026年9月开发总结](docs/development-summary-2026-09.md)。
