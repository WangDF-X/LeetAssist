# 07. AI Band（AI 与功能模块的耦合层）Spec

- 状态：Draft（方向已与用户确认 2026-10-12；落地细节见第 8 节待确认）
- 关联阶段：Phase 4（在 03 编译器 §4.6 与 04 §3.9 之后）
- 最后更新：2026-10-12
- 涉及代码目录：`src/panel/bridge/`（暂定；见 §4）

> 命名说明：本模块是 **04（AI）与 03（白板）之间的"连接带/胶水层"**，负责把 AI 的**结构化输出**安全地送进功能模块并回传状态。**未来其它"AI 相关、跨模块"的功能（如 AI 标注某一步、AI 解释并高亮）也复用本层**，而不是各写各的耦合代码。

## 1. 目标（In Scope）

- 定义 **04 → 03** 的单向数据流：AI 产出的 `LlmDiagram`（DSL，见 03 §4.6）经本层交给 03 的编译器，写入白板**覆盖层**。
- 定义**跨模块通信通道**：Agent（右栏）↔ 白板（左栏）的解耦接口，**04 不 import 03 内部实现，03 不知道 AI 的存在**。
- 定义**生命周期与状态回传**：作图成功/失败/被清空如何反馈到对话；覆盖层随题保存/恢复（挂接 01 `persistOnClose` 与 02 存储）。
- 提供**可复用的耦合范式**，供后续 AI 相关跨模块功能沿用（统一入口、统一错误处理、统一持久化）。

## 2. 明确不做（Out of Scope）

- 不做 DSL 的解析/校验（那是 03 §4.6 `compileDiagram` 的职责）。
- 不做 LLM 调用与提示词（那是 04 §3.9 的职责）。
- 不做白板渲染与元素模型（03）。
- 不做"AI 自动作图"（触发始终由用户显式发起）。
- V1 不做双向实时协同（白板改动反馈给 AI 上下文）——留待需要时评估。

## 3. 详细需求

### 3.1 分层与依赖方向（解耦核心）

```
[04 Agent/LLM] --(LlmDiagram JSON)--> [07 Bridge] --(compileDiagram)--> [03 编译器] --> overlay
                                        ^                                         │
                                        └──────────(状态: ok/dropped/error)──────┘
```

- **04 只产出 DSL 文本**，不认识白板 DOM / Konva / 编译器内部。
- **03 只暴露一个"命令接口"**（收 DSL 字符串、报告结果），不感知调用方是 AI 还是图元库。
- **07 是唯一知道"AI 与白板如何接线"的地方**；换通信方式/换模块，只改 07。

### 3.2 通信通道

- 面板内左右两栏是兄弟组件（01 的页内悬浮面板）。通道建议用**面板级 React Context + 命令 ref**（不引第三方状态库）：
  - 白板挂载时向 Context **注册命令接口** `WhiteboardApi`；
  - Agent 通过 Context 取到接口并调用。
- 通道只暴露**语义命令**（`insertDiagram(dsl)` / `clearOverlays()` / 订阅状态），**不暴露白板内部状态**。

### 3.3 触发与数据流

1. 用户在对话里显式要求作图（或走作图模式）。
2. 04 组装提示词（附 03 §4.6 的 DSL 契约 + few-shot），流式取回复。
3. 04 抽取 ```json 代码块 → 得到 DSL 文本（**04 §3.9**）。
4. 04 调用 `bridge.drawFromAI(dslText, { sourceMessageId })`。
5. 07：`compileDiagram(dsl)` → `{ elements, dropped, warnings }`；`WhiteboardApi.setOverlay(elements)`；必要时把视图居中到新图。
6. 07 把结果（成功/跳过 N 个/失败原因）**回传**给 04，在对话气泡上显示状态（如"已绘制到画板 · 清空"）。

### 3.4 生命周期与持久化

- 覆盖层随题保存：`ProblemSession.whiteboard`（02）中 `overlay` 一并持久化；切题/刷新恢复。
- 关闭面板前统一走 01 `persistOnClose` 钩子（不允许绕过）。
- 清空：对话侧"清空画板叠加"按钮 → `WhiteboardApi.clearOverlays()`；不触碰手绘层。
- 多题独立：覆盖层与题绑定（随 `problemId` 广播切换）。

### 3.5 错误与降级

- DSL 解析/校验失败：**不渲染**，回传明确原因（"作图输出无法解析"），不静默降级为裸坐标。
- 部分元素被丢弃：渲染可用部分 + 报告 `dropped` 数。
- 编译异常：捕获后回传，不崩溃白板。

### 3.6 面向未来的复用

- 新 AI 功能（如"高亮并解释当前步骤"）= 产出 DSL（结构 + `annotations`）+ 走同一 bridge；无需新增通道。
- 若未来出现新的目标模块（如 06-trace 的可视化），按同样的"命令接口 + 状态回传"范式接入，统一在 07 登记。

## 4. 数据结构 / 接口

```ts
/** 白板向 bridge 注册的命令接口（只暴露语义命令） */
interface WhiteboardApi {
  /** 用 DSL 文本/对象作图，返回编译结果；实现内部调用 03 的 compileDiagram */
  insertDiagram(dsl: string | LlmDiagram): DiagramResult;
  /** 清空覆盖层（不动手绘） */
  clearOverlays(): void;
  /** 订阅覆盖层状态（用于对话侧展示"已绘制/清空"） */
  onOverlayChange(cb: (state: OverlayState) => void): () => void;
}

interface DiagramResult {
  status: "ok" | "partial" | "error";
  elementCount: number;
  dropped: number;
  warnings?: string[];
  message?: string; // 失败原因（面向用户）
}

interface OverlayState {
  hasOverlay: boolean;
  elementCount: number;
}

/** 07 暴露给 04 的门面（04 只依赖这一个） */
interface AiBridge {
  drawFromAI(
    dsl: string | LlmDiagram,
    meta?: { sourceMessageId?: string },
  ): DiagramResult;
  clear(): void;
}
```

- `LlmDiagram` 类型定义在 **03 §4.6**（07 只引用，不重复定义）。
- 通道注册/获取：`useWhiteboardApi()` / `WhiteboardApiProvider`（面板级）。

## 5. UI / 交互

- 对话气泡：作图消息下方显示状态芯片 `[已绘制到画板]`（失败则 `[作图失败：原因]`），旁带 `[清空叠加]`。
- 白板侧：AI 图与手绘视觉一致（同一编译器）；清空 AI 图不影响手绘图。
- 触发入口：输入框旁的作图模式/斜杠命令（具体形态与 04 模式清单一起定，见 04 §8）。

## 6. 依赖

- 依赖的其他 spec：**03-whiteboard §4.6**（DSL + 编译器 + 覆盖层）、**04-ai-assistant §3.9**（DSL 产出与提示词）、01-extension-shell（面板容器、`persistOnClose`、`problemId` 广播）、02-storage（`ProblemSession.whiteboard.overlay` 持久化）。
- 依赖的第三方库：无（Context + ref）。

## 7. 验收标准

- [ ] AI 产出的 DSL 能经 `bridge` 确定性编译并绘到盖层；同一 DSL 与图元库生成的同结构**视觉一致**。
- [ ] 04 不 import 03 内部实现；03 不感知 AI；唯一耦合点集中在 07。
- [ ] 解析/校验失败**不渲染且不降级**，有明确原因回传并在对话中显示。
- [ ] 覆盖层随题保存/恢复；关闭面板走 `persistOnClose`；切题不串图。
- [ ] 清空叠加不触碰手绘层。
- [ ] 通信通道可被后续 AI 相关跨模块功能复用（新增功能不新开通道）。

## 8. 待确认问题

> 这里的问题一天没有答案，本文档状态就一天不能改成 Confirmed。

- [ ] 通信通道的最终形态（面板级 Context + 命令 ref vs 其它）；模块目录名（暂定 `src/panel/bridge/`）。
- [ ] 触发入口形态（作图模式 / 斜杠命令 / 按钮），与 04 §8 模式清单一起定。
- [ ] AI 图与手绘是否需要"分层开关显隐"（先不做，确认）。
- [ ] 覆盖层是否参与 100KB 体积估算与"超限提示"（倾向参与）。

## 9. 变更记录

| 日期 | 修改内容 |
|---|---|
| 2026-10-12 | 初稿：确立 04→03 单一数据流、面板级通道、覆盖层生命周期与状态回传；确定"AI 只产 DSL、07 负责耦合"的分工，并为未来 AI 相关跨模块功能预留统一范式 |
