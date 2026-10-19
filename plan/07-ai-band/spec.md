# 07. AI Band（AI 与功能模块的耦合层）Spec

- 状态：Draft（方向已与用户确认 2026-10-12；落地细节见第 8 节待确认）
- 关联阶段：Phase 4（在 03 编译器 §4.6 与 04 §3.9 之后）
- 最后更新：2026-10-19
- 涉及代码目录：`src/panel/bridge/`（暂定；见 §4）

> 命名说明：本模块是 **04（AI）与 03（白板）之间的"连接带/胶水层"**，负责把 AI 的**结构化输出**安全地送进功能模块并回传状态。**未来其它"AI 相关、跨模块"的功能（如 AI 标注某一步、AI 解释并高亮）也复用本层**，而不是各写各的耦合代码。

## 1. 目标（In Scope）

- 定义 **04 → 03** 的单向数据流：AI 产出的 `LlmDiagram`（DSL，见 03 §4.6）经本层交给 03 的编译器，写入白板**覆盖层**。
- 定义**跨模块通信通道**：Agent（右栏）↔ 白板（左栏）的解耦接口，**04 不 import 03 内部实现，03 不知道 AI 的存在**。
- 定义**生命周期与状态回传**：作图成功/失败/被清空如何反馈到对话；覆盖层随题保存/恢复（挂接 01 `persistOnClose` 与 02 存储）。
- 提供**可复用的耦合范式**，供后续 AI 相关跨模块功能沿用（统一入口、统一错误处理、统一持久化）。

## 2. 明确不做（Out of Scope）

- 不做 DSL 文本抽取/JSON 解析（04 §3.9），不做 Schema/语义校验（03 §4.6），不复制规则。健壮性契约见 [03 补充规范](../03-whiteboard/diagram-contract.md)。
- 不做 LLM 调用与提示词（那是 04 §3.9 的职责）。
- 不充当 Service Worker 网络代理、凭据或授权通道；04 的 runtime Port 与本层面板内命令接口不同。07 不接收 API Key、完整 ProviderConfig 或任意 fetch 参数。
- 不做白板渲染与元素模型（03）。
- 不做"AI 自动作图"（触发始终由用户显式发起）。
- V1 不做双向实时协同（白板改动反馈给 AI 上下文）——留待需要时评估。

## 3. 详细需求

### 3.1 分层与依赖方向（解耦核心）

```
[04 输出适配] --(unknown JSON)--> [07 Bridge] --(语义命令)--> [03 编译器] --> 原子提交 overlay
                                        ^                                         │
                                        └────(状态: ok/partial/error + diagnostics)────┘
```

- **04 输出适配只提取/解析语义 JSON**，以 unknown 交给桥接层，不认识白板 DOM / Konva / 编译器内部。
- **03 只暴露一个"命令接口"**（收不可信 DSL 对象、编译/提交并报告结果），不感知调用方是 AI 还是图元库。
- **07 是唯一知道"AI 与白板如何接线"的地方**；换通信方式/换模块，只改 07。

### 3.2 通信通道

- 面板内左右两栏是兄弟组件（01 的页内悬浮面板）。通道建议用**面板级 React Context + 命令 ref**（不引第三方状态库）：
  - 白板挂载时向 Context **注册命令接口** `WhiteboardApi`；
  - Agent 通过 Context 取到接口并调用。
- 通道只暴露**语义命令**（`insertDiagram(dsl)` / `clearOverlays()` / 订阅状态），**不暴露白板内部状态**。

### 3.3 触发与数据流

1. 用户在对话里显式要求作图（或走作图模式）。
2. 04 组装提示词，经其 SW 请求代理/Port 取统一流事件；07 不参与网络连接、SSE 或认证。
3. 04 等待正常完整回复，提取唯一载荷并标准 JSON 解析为 unknown；失败不调用作图命令（04 §3.9）。
4. 调用 `bridge.drawFromAI(input, { problemId, requestId, sourceMessageId })`；上下文在请求发起时固定，不能用回复到达时的题目替代。
5. 07 检查目标和请求有效性，交给白板语义命令；03 在暂存区校验/编译/严格检查 IR，返回 CompileResult。
6. error 不提交；ok/partial 在提交前再次检查请求生命周期，居中后的批次符合几何边界才一次性替换 overlay。03 纯编译器不写场景，白板命令负责提交；07 不再额外 setOverlay，避免双重写入。
7. 实际应用后回传 04：成功、N 条标注未绘制、失败或过期未应用；不得根据非空元素/warnings 推断成功。

**原子性**：不先清空旧图。error 不改变旧 overlay、手稿、视口或撤销状态；partial 是完整新主体与有效标注的整批替换，不是部分结构与旧图拼接。

### 3.4 生命周期与持久化

- 覆盖层随题保存：`ProblemSession.whiteboard`（02）中 `overlay` 一并持久化；切题/刷新恢复。
- 关闭面板前统一走 01 `persistOnClose` 钩子（不允许绕过）。
- 清空：对话侧"清空画板叠加"按钮 → `WhiteboardApi.clearOverlays()`；不触碰手绘层。
- 多题独立：覆盖层与题绑定（随 `problemId` 广播切换）。
- 请求有效性：同目标新作图请求使旧待提交请求失效；切题、取消、显式清空、卸载使相关待提交请求失效。用 requestId/代次检查，旧结果晚到不得覆盖新图、串题或复活已清空的图。
- 过期结果明确回传 STALE_REQUEST，不缓存等待切回题目后自动应用，不自动重放。
- 04 的 cancelled/interrupted/error（含撤权、配置改变、Worker/Port 断开、截断）均不抽取 DSL 或调用本层，即使已接收文本含完整 JSON 块；只有 Provider 正常完成且请求仍有效才可作图。作图失效时通过 04 客户端取消网络，不让 07 直接操作后台凭据/AbortController。

### 3.5 错误与降级

- 抽取/解析/主体校验失败：不提交，保留旧图并明确提示，不降级裸坐标。
- **仅非法标注允许 partial**：主体完整、有效标注完整，按条计数与安全诊断可见；部分结构/IR 不得成功。
- 主体/有效标注内部编译异常、重复锚点、IR 后置失败：error，暂存产物整批丢弃，异常不传播到 UI。
- 目标未挂载、请求过期/题目不匹配分别为 TARGET_UNAVAILABLE、STALE_REQUEST，不排队自动重放。桥接错误单列，不另造编译规则。

### 3.6 面向未来的复用

- 新 AI 功能（如"高亮并解释当前步骤"）= 产出 DSL（结构 + `annotations`）+ 走同一 bridge；无需新增通道。
- 若未来出现新的目标模块（如 06-trace 的可视化），按同样的"命令接口 + 状态回传"范式接入，统一在 07 登记。

## 4. 数据结构 / 接口

```ts
/** 白板向 bridge 注册的命令接口（只暴露语义命令） */
interface WhiteboardApi {
  /** 内部调用纯编译器；有效请求的 ok/partial 才原子提交 */
  insertDiagram(input: unknown, context: DiagramRequestContext): DiagramResult;
  /** 清空覆盖层（不动手绘） */
  clearOverlays(): void;
  /** 订阅覆盖层状态（用于对话侧展示"已绘制/清空"） */
  onOverlayChange(cb: (state: OverlayState) => void): () => void;
}

interface DiagramResult {
  status: "ok" | "partial" | "error";
  applied: boolean; // ok/partial=true；error=false
  elementCount: number; // 本次实际提交数；error=0，不表示旧图为空
  droppedAnnotations: number; // 本次提交时未绘制的标注条数；error=0
  diagnostics: DiagramDiagnostic[]; // 原样继承 03 结构化诊断
  bridgeError?: "TARGET_UNAVAILABLE" | "STALE_REQUEST";
  message?: string; // 安全、简明的用户提示
}

interface DiagramRequestContext {
  problemId: string;
  requestId: string; // 发起时登记，用于取消/清空/切题/晚到结果校验
  sourceMessageId?: string;
}

interface OverlayState {
  hasOverlay: boolean;
  elementCount: number;
}

/** 07 暴露给 04 的门面（04 只依赖这一个） */
interface AiBridge {
  drawFromAI(
    input: unknown,
    context: DiagramRequestContext,
  ): DiagramResult;
  clear(): void;
}
```

- `LlmDiagram`、`DiagramDiagnostic` 与编译状态语义定义在 03 §4.6 及补充规范；07 只依赖公开契约，不 import builder 等内部实现。外部参数保留 unknown，03 内部校验后才生成可信类型。
- 接口示意表达职责；若命令异步则返回 Promise，并在异步完成后再次检查请求再提交。同步/异步均不能放宽原子性。
- 结果不变量：ok/partial 必须 applied=true 且无 bridgeError；error 必须 applied=false、elementCount=0、droppedAnnotations=0，并含编译 error 诊断或 bridgeError。生产类型应使用判别联合约束这些组合，禁止构造“失败但已应用”的结果。
- 通道注册/获取：`useWhiteboardApi()` / `WhiteboardApiProvider`（面板级）。

## 5. UI / 交互

- 对话气泡：作图消息下方显示状态芯片 `[已绘制到画板]`（失败则 `[作图失败：原因]`），旁带 `[清空叠加]`。
- partial 为 `[主体已绘制 · N 条标注未绘制]`，可查看安全诊断/路径；error 明确失败或未应用，不能因为旧图还在显示成功。
- **标注反馈**：未绘制诊断按原始 annotationIndex/path 展示，每条只计一次；全部无效时显示“主体已绘制 · 标注均未绘制”。按 03 §4.3 已确认规则启用 ANNOTATION_CONFLICT / LAYOUT_OVERLAP：冲突丢弃按条 partial；布局 warning 单列，不计丢弃数、不改变 ok；无损去重保留来源索引、不计丢弃。
- Bridge 不改标注颜色/文字/引用、不代替编译器去重，不尝试把失效局部 note 改成图级 note；合法引用缺锚点的内部错误原样回传 error。
- 白板侧：AI 图与手绘视觉一致（同一编译器）；清空 AI 图不影响手绘图。
- 触发入口：输入框旁的作图模式/斜杠命令（具体形态与 04 模式清单一起定，见 04 §8）。

## 6. 依赖

- 依赖的其他 spec：**03-whiteboard §4.6**（DSL + 编译器 + 覆盖层）、**04-ai-assistant §3.9**（DSL 产出与提示词）、01-extension-shell（面板容器、`persistOnClose`、`problemId` 广播）、02-storage（`ProblemSession.whiteboard.overlay` 持久化）。
- 依赖的第三方库：无（Context + ref）。

## 7. 验收标准

- [ ] AI 产出的 DSL 能经 `bridge` 确定性编译并绘到盖层；同一 DSL 与图元库生成的同结构**视觉一致**。
- [ ] 04 不 import 03 内部实现；03 不感知 AI；唯一耦合点集中在 07。
- [ ] 解析/校验失败**不渲染且不降级**，有明确原因回传并在对话中显示。
- [ ] 原子替换：error 保留旧图/手稿/视口/撤销状态；ok/partial 一次提交；partial 只丢非法标注，内部坏 IR 不能部分成功。
- [ ] 03 diagnostics 原样回传，按条计数，实际应用后显示状态；目标不可用/过期为未应用。
- [ ] 请求竞态测试：新请求先完成旧请求后完成、切题再切回、请求期间清空/取消/卸载，不串图、不复活旧图、不自动重放。
- [ ] 标注反馈按原索引定位、按条计数；全部标注无效提示明确；非丢弃型布局 warning 与 partial 分开，桥接层不擅自改标注。
- [ ] **Chrome/Edge**：分别验证跨栏命令、原子提交、切题/取消/清空竞态及保存恢复，按 AGENTS.md 记录版本与结果。
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
| 2026-10-19 | 对齐 SW Provider 代理：区分网络 Port 与面板内 bridge；07 不接触凭据，取消/中断流不作图、不重放，保留完整成功及原子提交门槛 |
| 2026-10-19 | 同步 Confirmed v2 标注冲突/无损去重/布局提示反馈；03 契约确认不改变本模块其余待定通信/UI 状态 |
| 2026-10-15 | 补标注状态回传/展示：原索引与按条计数、全标注无效提示、布局 warning 与 partial 分离；桥接层不修改标注语义，缺合法锚点的内部错误保持 error |
| 2026-10-15 | 对齐健壮性契约：04 解析、03 唯一校验、07 生命周期/原子提交；unknown 接口、诊断、仅非法标注 partial、失败保留旧图、过期请求与清空竞态；原通信/UI 待确认保留，整体仍 Draft |
| 2026-10-12 | 初稿：确立 04→03 单一数据流、面板级通道、覆盖层生命周期与状态回传；确定"AI 只产 DSL、07 负责耦合"的分工，并为未来 AI 相关跨模块功能预留统一范式 |
