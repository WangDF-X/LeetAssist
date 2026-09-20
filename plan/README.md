# plan/ 目录说明

这个目录是整个项目"要做什么"的唯一事实来源（source of truth）。项目根目录的 `AGENTS.md` 定义的是"怎么做"的流程规则，这里定义的是每个模块具体做成什么样。

## 目录结构

| 目录 | 内容 |
|---|---|
| `00-product/vision.md` | 产品定位、核心原则（Local First / BYOK / Small & Useful）、明确不做的事、整体阶段路线图 |
| `01-extension-shell/` | Chrome Extension 骨架：manifest、background、content script、Side Panel 外壳 |
| `02-storage/` | 本地存储：`chrome.storage.local` + IndexedDB 数据结构、导入导出 |
| `03-whiteboard/` | 画板功能（Konva 自建轻量画板） |
| `04-ai-assistant/` | BYOK AI 助手 |
| `05-timer/` | AI 智能计时 |
| `06-trace/` | 代码执行 Trace（Python / AI Simulation / 未来 Go） |

每个模块目录下有一个 `spec.md`，模板见 `_template.md`。

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
