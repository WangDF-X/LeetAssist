# 产品定位与核心原则

- 状态：Confirmed（方向已确定；具体某个功能的实现细节以对应模块 spec 为准）
- 最后更新：2026-09-15
- 来源：《LeetCode 刷题辅助插件——技术栈与开发规划.md》整理

## 1. 一句话定位

> 轻量级的 LeetCode 刷题辅助工具，不是"AI LeetCode"。

## 1a. 产品身份信息

- **名称**：LeetAssist
- **图标**：`plan/assets/logo.png`（源文件；实现阶段需要按 Chrome 扩展规范切出 16/32/48/128 像素等多个尺寸放进扩展的 `public/icons/` 目录，manifest 里引用这些尺寸，这是实现细节，不需要你现在处理）。
- **支持域名**：仅 `leetcode.cn`，不支持 `leetcode.com`。
- **界面语言**：第一版只做中文，不引入 i18n 框架；后续如果要支持英文，再单独立项。
- 关于"品牌视觉"：这里指的是除了名称/图标之外的一整套视觉规范（主色调、UI 配色风格是否要跟图标呼应、Chrome 应用商店上架用的宣传图/截图风格等）。这属于锦上添花的部分，**不影响任何功能开发，可以先不管，等第一版做出来再回头考虑**。

## 2. 核心目标（只做这四件事）

1. 帮助思考 —— 画板
2. 帮助控制做题节奏 —— AI 智能计时
3. 帮助理解代码运行过程 —— 代码 Trace / 模拟执行
4. 需要帮助时提供 AI —— 用户自行配置 API Key / Base URL / Model（BYOK）

## 3. 明确不做

- 用户账号系统
- 云端同步
- 社交功能 / 排行榜
- 复杂的刷题统计 / 学习计划
- 自建 AI 后端
- 强制绑定某一家模型厂商
- "一键解题 / 一键生成完整代码 / 一键提交"等大量自动做题功能

任何新功能提案，如果落在上面的"不做"列表里，需要先更新本文件并获得用户明确同意，才能立项写 spec。

## 4. 三个核心原则

### Local First

用户数据、API Key、AI 请求全部走本地或用户自己配置的服务，不需要项目方的服务器。

### BYOK（Bring Your Own Key）

不卖 AI、不提供自己的模型。用户自己选择 Provider（OpenAI / Claude / Gemini / DeepSeek / Qwen / OpenRouter / Ollama / 自定义 API）。第一版实现 **OpenAI-compatible 接口 + Anthropic 原生协议**（用户 2026-09-15 确认：预置清单包含 Anthropic，故 V1 增加其原生适配器）；其余原生协议后续按需添加。

### Small & Useful

只解决："不知道怎么想（画板）/ 不知道做多久（AI Timer）/ 不知道代码怎么跑（Trace）/ 卡住了（AI）"，不向社交、社区、题库、学习计划、Agent、云端账户扩张。

## 5. 技术栈总览

| 模块 | 第一版方案 | 后续 |
|---|---|---|
| 浏览器扩展 | Chrome Extension MV3 | Firefox/Edge |
| 前端 | React + TypeScript | 不需要更换 |
| 构建 | Vite + @crxjs/vite-plugin | 不需要更换 |
| UI | Tailwind + shadcn/ui | 不需要更换 |
| LeetCode 集成 | Content Script（仅 leetcode.cn，GraphQL 优先 + DOM 兜底） | 视情况支持更多域名 |
| 常驻界面 | 页内悬浮面板（content script 注入 + Shadow DOM）+ 悬浮 logo 入口 | 不需要更换 |
| 画板 | Konva + react-konva（自建轻量画板） | 见 03-whiteboard spec |
| 本地配置 | chrome.storage.local | 不需要更换 |
| 业务数据 | IndexedDB（通过 Dexie 封装） | 不需要更换 |
| AI | OpenAI-compatible API + Anthropic 原生适配器 | 其余原生协议后续按需添加（Gemini 等已走 OpenAI-compatible 端点覆盖） |
| Python 执行 | Pyodide（第一版正式版之后上线） | 不需要更换 |
| Go 执行 | Yaegi（Go 解释器）编译成 WASM（第一版正式版之后上线） | 不需要更换 |
| Python / Go Trace | Instrumentation + 统一 TraceEvent，两个语言同一优先级（第一版正式版之后上线） | 扩展数据结构 |
| 数据备份 | JSON 导入导出 | 不需要后端 |
| 后端 | 没有 | 暂时没有 |

## 6. 阶段路线图（对应 plan 各模块）

```
① Chrome Extension 骨架          → plan/01-extension-shell
② LeetCode 题目/代码获取          → plan/01-extension-shell
③ Side Panel                     → plan/01-extension-shell
④ tldraw 画板                    → plan/03-whiteboard
⑤ IndexedDB 保存 + 导入导出       → plan/02-storage
⑥ BYOK AI                        → plan/04-ai-assistant
⑦ AI 智能计时                    → plan/05-timer
⑧ Python + Pyodide               → plan/06-trace（第一版正式版之后）
⑨ Go + Yaegi（与⑧同一优先级）    → plan/06-trace（第一版正式版之后）
⑩ Python / Go Trace              → plan/06-trace（第一版正式版之后）
⑪ AI Simulation                  → plan/06-trace（第一版正式版之后）
```

①～⑦ 是工程实现，即第一版正式版（V1）的范围；⑧～⑪ 是核心技术难点，但用户 2026-09-15 确认：**第一版正式版不包含任何 trace 功能**，⑧～⑪ 全部延后到正式版之后，作为第一优先的扩展方向。Go 与 Python 保持同一优先级（详见 06-trace spec）。

## 7. MVP 范围

第一版正式版（V1）只包含：基础题目信息读取 + 画板 + 智能计时（**本地算法估算，不调用 AI**） + BYOK AI（提示/分析思路/找 Bug/自由提问，流式返回）。**不包含任何 trace 功能**：Python Trace 与 Go Trace 延后到第一版正式版之后，作为并列的第一优先扩展方向（技术结论保留在 06-trace spec）。

## 8. 待确认问题

暂无。以下问题已在 2026-09-15 确认完毕，答案已写入第 1a 节：

- ~~是否需要同时支持 leetcode.com 和 leetcode.cn~~ → 仅支持 leetcode.cn。
- ~~插件名称、图标、品牌视觉~~ → 名称 LeetAssist，图标见 `plan/assets/logo.png`，品牌视觉细节延后。
- ~~是否需要国际化~~ → 第一版只做中文。

## 9. 变更记录

| 日期 | 修改内容 |
|---|---|
| 2026-09-12 | 根据总体规划文档整理出初稿 |
| 2026-09-13 | 画板技术方案从 tldraw 改为待确认（倾向 Excalidraw） |
| 2026-09-14 | 根据用户反馈，将 Go Trace 从"后续阶段"提升为与 Python Trace 同一优先级，更新技术栈表格、阶段路线图、MVP 范围 |
| 2026-09-15 | 确认产品身份信息（名称 LeetAssist、图标、仅支持 leetcode.cn、第一版只做中文），新增 1a 节；同步更新技术栈表格（构建工具 Vite+@crxjs/vite-plugin、Dexie） |
| 2026-09-15 | 画板技术选型最终确定为 Konva + react-konva（自建轻量画板），更新技术栈表格 |
| 2026-09-15 | 确认第一版正式版（V1）不含任何 trace 功能，路线图 ⑧～⑪ 全部延后到正式版之后；计时改为本地算法估算（不调用 AI） |
| 2026-09-15 | 确认 V1 AI 协议范围扩展为 OpenAI-compatible + Anthropic 原生（方案 a），更新核心原则与技术栈表格 |
| 2026-09-15 | 主 UI 由 Chrome Side Panel 改为页内悬浮面板 + 悬浮 logo 入口（用户新 UI 设计：左画板右 Agent 双栏 + 中间竖直工具栏）；AI 对话改为完整保留、一题多对话 |
