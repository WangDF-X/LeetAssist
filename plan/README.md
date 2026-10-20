# plan/ 目录说明

这个目录是整个项目"要做什么"的唯一事实来源（source of truth）。项目根目录的 `AGENTS.md` 定义的是"怎么做"的流程规则，这里定义的是每个模块具体做成什么样。

## 目录结构

| 目录 | 内容 |
|---|---|
| `00-product/vision.md` | 产品定位、核心原则（Local First / BYOK / Small & Useful）、明确不做的事、整体阶段路线图 |
| `01-extension-shell/` | Chrome/Edge 扩展骨架：manifest、background、content script、页内悬浮面板与中间工具栏（非 Side Panel） |
| `02-storage/` | 本地存储：`chrome.storage.local` + IndexedDB 数据结构、导入导出 |
| `03-whiteboard/` | 画板功能（Konva 自建轻量画板） |
| `04-ai-assistant/` | BYOK AI 助手 |
| `05-timer/` | AI 智能计时 |
| `06-trace/` | 代码执行 Trace（Python / AI Simulation / 未来 Go） |
| `07-ai-band/` | AI 与功能模块的耦合层：AI 结构化输出（DSL）→ 白板编译器；可复用于后续 AI 相关跨模块功能 |

每个模块目录下有一个 `spec.md`，模板见 `_template.md`。

程序化作图专项契约见 [`03-whiteboard/diagram-contract.md`](03-whiteboard/diagram-contract.md)：03 §4.6 的规范性补充，集中定义 DSL v2、Schema/语义校验、标注、诊断、预算和原子提交；2026-10-19 用户接受推荐方案后为 Confirmed，2026-10-20 补充多叉树 null 缺位、builder 语义补齐、实体级冲突/原始索引、严格 IR 与单题 100KB（含 overlay）预算，§10 是确认记录。04/07 整体仍按各自 spec 状态推进。

Provider 请求与配置约定：01 提供主面板入口打开独立扩展配置页；02 管理可信 local 存储与无 Key 摘要；04 定义 Service Worker 请求代理、动态主机授权和 Port 流式生命周期；07 只接正常完成的作图输出，不承担网络代理。具体规则见 02 §3.5–3.6、04 §3.1/3.8。

## Spec 状态机

```
Draft → Confirmed → In Progress → Done
```

- **Draft**：初稿，可能包含未决问题（见文档内"待确认问题"章节）。**不能**据此开发正式功能。
- **Confirmed**：用户已经对该文档里的范围、边界、待确认问题给出明确答复，可以开发。
- **In Progress**：已经开出对应 feature 分支，正在开发。
- **Done**：已合并进 `main`，功能上线。

## 跨模块硬规则

- **主题/颜色**：任何模块新增 UI 只允许使用 `--la-*` 设计令牌（CSS 变量），禁止硬编码颜色；规则与色板见 `01-extension-shell/spec.md` §3.7，`npm run check:theme` 构建前强制检查。

## 新增一个模块

1. 建一个新目录，例如 `plan/07-xxx/`。
2. 复制 `_template.md` 为 `plan/07-xxx/spec.md`，按模板填写。
3. 状态先设为 `Draft`，把不确定的地方都写进"待确认问题"。
4. 和用户确认完之后，把状态改成 `Confirmed`，才允许开始写代码。

## 和 AGENTS.md 的关系

- `AGENTS.md`：流程规则（怎么用 git、什么时候能写代码、提交前要做什么 review）。
- `plan/`：产品规则（每个功能具体是什么、边界在哪、还有什么没定）。

两者冲突时，以用户最新的口头/文字确认为准，并及时回写更新这两类文档。
