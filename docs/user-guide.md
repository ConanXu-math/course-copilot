# VeryMath 智慧教材 · 用户手册

本手册面向首次使用的人，重点是安装与启动。装好并连上 Agent 后，教材解析、讲解、出题、思维导图、知识图谱和课件生成都由所选 Coding Agent 按各 Skill 自主完成，你只需在界面上选择功能、提出要求和查看结果。

## 这是什么

左侧阅读教材，右侧与 Copilot 交互，两条分隔线可以拖动。整个项目按三层分工：

```text
前端 UI：教材、目录、选中文字、对话、图谱、课件、视频
                    ↕ 请求、进度、回答、结果
Coding Agent：理解要求 → 读取教材 → 调用一个或多个 Skill
                    ↕ 读取与保存文件
个人课程目录：原始教材、解析内容、阅读记录、对话、生成资料
```

教学任务统一交给 Coding Agent，它调用项目内置的 Skill（讲解、出题、导图、图谱、课件）完成具体工作。每个人使用自己的 Agent 账号，教材和课程记录保存在部署者自己的电脑上。

## 准备工作

在要部署的电脑上准备两样东西：

- **Node.js 22.13 或更新版本**，用 `node --version` 检查。
- **至少一个 Coding Agent**，安装并登录其一即可，无需全部安装：

| Agent | 安装说明 |
| --- | --- |
| Codex | [安装 Codex CLI](https://developers.openai.com/codex/cli/) |
| Claude Code | [安装 Claude Code](https://code.claude.com/docs/en/setup) |
| OpenCode | [安装 OpenCode](https://opencode.ai/docs/) |

教材 PDF 可以现在就准备好，也可以装完再导入。

## 安装与启动

### 方式一：让 Coding Agent 安装（推荐）

把下面这段发给你使用的 Coding Agent，它会读取并执行仓库内的 [verymath-install Skill](../skills/verymath-install/SKILL.md)，自动完成依赖安装、内置课程 Skill 配置、Agent 连接和服务启动，最后给你访问地址：

```text
https://github.com/ConanXu-math/course-copilot
安装这个仓库的 verymath-install Skill，并按照它完成 VeryMath 智慧教材的本机部署：
检查并安装必要依赖，配置内置课程 Skill，连接我现有的 Agent，启动工作台并给我访问地址。
```

需要账号登录时由你本人完成。安装完成后，Agent 会返回可点击的访问地址、安装与数据目录、Agent 状态和停止/再次启动命令。

### 方式二：手动安装

私有仓库需要先获得访问权限。在项目目录依次运行：

```bash
git clone https://github.com/ConanXu-math/course-copilot.git
cd course-copilot
npm install --package-lock=false
```

开发模式（地址以终端输出为准，通常为 `http://127.0.0.1:5173`）：

```bash
npm run dev
```

正式运行（默认地址 `http://127.0.0.1:4173`，可用 `PORT` 改端口，默认只监听本机）：

```bash
npm run build
npm start
```

日常使用执行 `npm start` 后在浏览器打开对应地址即可。开发和正式服务共用同一份文件接口与个人目录，日常只需启动其中一个。

> 前端、本机文件服务与 Agent 运行在同一台部署电脑上；单独把 `dist` 传到静态托管平台无法运行 Agent。

### 首次使用

1. 打开页面，点击「导入教材」选择你的 PDF。
2. 点击右上角「工作区设置」，在 Coding Agent 列表中选择程序，点「连接本机…」。
3. 复用已有登录或按 Agent 的认证方式完成登录；在「使用模型」选择模型或保留默认。
4. 关闭设置页即可开始提问。

## 其余功能

连接 Agent 后，界面提供教材解析、讲解内容、知识点出题、思维导图、知识图谱、生成课件等按钮，并可与 Copilot 自由问答。各功能选择范围（当前页、选中内容、当前章节或整本教材）并发送要求后，由所选 Agent 读取教材和对应 Skill 自主执行，结果保存到当前课程的 `outputs` 目录，并在界面左侧打开。

生成课件需要部署电脑有可用的 XeLaTeX 及 Beamer、ctex、数学宏包和中文字体。「工作区设置 → 课件编译环境」可查看缺失项并重新检查；具体补齐由 Agent 按检查列表执行。

## 你的数据

默认保存在 `~/.course-copilot/`，设置页显示实际路径。教材原件、解析内容、阅读记录、对话和生成资料都在这个目录里；备份时复制完整目录即可。换电脑后在新电脑上安装并登录所选 Agent，手动填写过的程序或 Skill 路径改变时在设置页更新。

## 常见问题

- **页面打不开 / 端口被占**：确认服务在运行，地址以终端输出为准；端口被其他程序占用时换端口启动。
- **Agent 连不上 / 要登录**：在「工作区设置」点「刷新状态」，按 Agent 提供的认证方式登录，或先在本机终端登录再重新连接。
- **课件说缺 TeX 或中文字体**：查看「课件编译环境」列出的缺失项，由 Agent 补齐后重新检查；中文字体（如 Fandol）缺失时尤其确认在补装清单内。
- **换浏览器数据还在吗**：在。教材、阅读位置、书签、对话和结果由本机服务保存在个人目录，换浏览器或清除缓存后重新读取即可。

## 进一步

- [Agent 接入说明](agent-integration.md)：各 Agent 的连接方式、模型与兼容选项。
- [Skill 模块开发与接入](skill-development.md)：如何新增或修改课程 Skill。
- [README](../README.md)：架构、接口字段与开发参考。
