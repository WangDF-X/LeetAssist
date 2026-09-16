# 04. AI Assistant（BYOK AI 助手）Spec

- 状态：Draft（仅剩 1 个待确认问题：模式选择器的最终模式清单，见第 8 节；其余全部已确认）
- 关联阶段：Phase 3
- 最后更新：2026-09-15
- 涉及代码目录：`src/ai/provider.ts`, `src/ai/openai-compatible.ts`, `src/ai/anthropic.ts`, `src/ai/prompt.ts`, `src/panel/agent/`

## 1. 目标（In Scope）

- BYOK：用户配置 Provider（Name / Base URL / API Key / Model / 上下文窗口 / 价格），可多个；预置快捷项见 3.6。
- Agent 区界面（对标主流 Agent 客户端形态，依据用户 mockup）：
  - 头部：**对话标题直接从网页读取**（题号 + 题目 + 难度），不用 LLM 总结；旁有对话历史入口（该题的多个对话列表 + 新建对话）。
  - 消息流：流式渲染回复。
  - 底部输入框：支持 **`@code`** 将网页中已写的代码作为附件加入上下文（代码不再默认全量自动携带）；题目 + 约束仍自动携带。
  - 底栏：选择模型（下拉列表选已配置 Provider/模型）+ **圆环状上下文占用指示**（hover 显示具体 tokens/窗口详情）+ 资费显示 + 模式选择。
- **对话记录完整保留，一个题目可以有多个对话**（覆盖此前"只存摘要卡片"的方案，用户 2026-09-15 更新）；体积控制靠上下文快照去重（见 3.3）。
- 模式选择器（草稿清单，**最终清单待定**，见第 8 节）：给提示 / 分析目前我的思路 / 自由提问 / 完整分析 / 分析我的思路并给出建议。
- 请求失败：清晰提示、不自动重试、用户提示词不消失、手动 [重试]。
- 权限方案 B：保存 Base URL 后运行时动态申请该域名权限 + 连通性验证；拒绝则提醒不可用。
- V1 协议：OpenAI-compatible + Anthropic 原生（方案 a 已确认）。

## 2. 明确不做

- 不做"一键解题 / 一键生成完整代码 / 一键提交"。
- 不自动重试。
- 对话标题不用 LLM 生成（直接读网页）。
- 上下文裁剪策略 V1 不做（用户：刷题场景一般不会超窗，后面再想办法）；超窗时给出明确报错提示。
- 除 Anthropic 外的其他原生协议不做（Gemini 等走 OpenAI-compatible 端点）。

## 3. 详细需求

### 3.1 流式实现位置

流式 fetch 在面板页面（content script 注入的 React 应用）内执行，不放 Service Worker（MV3 SW 空闲回收会掐断长流）；SSE 逐块读取渲染。跨域由 host 权限保障。

### 3.2 上下文组装

- 自动携带：题目标题/难度/标签/约束/通过率（`ProblemMeta` 快照）。
- **代码携带：仅当用户在输入框使用 `@code`** 时，把当前编辑器代码快照作为附件芯片（chip）加入该条消息；芯片可见可移除。语言随代码快照记录。
- 对话标题：`#题号 题目名 · 难度`，直接从页面读取。

### 3.3 对话持久化：多会话 + 完整记录 + 快照去重

- 一个 `problemId` 下可建多个对话（session）；每个对话完整保留消息记录（用户 2026-09-15 确认保留记录，取代摘要卡片方案）。
- 体积控制（去重）：题目描述/约束等上下文**每个对话只存一份快照**（`contextSnapshot`），不随每条消息重复；`@code` 附件按快照存储、消息内引用 id，同一份代码不重复存。去重后单轮消息约 1–3KB。
- 重开旧对话：加载其消息作为上下文继续；若累计超出模型上下文窗口，V1 直接报错提示（裁剪策略后续设计）。
- 对话历史入口在 Agent 头部：列出该题全部对话（标题 + 更新时间 + 消息数），可切换/新建。

### 3.4 费用与上下文展示

- `ProviderConfig` 含 `contextWindow` / `priceInput` / `priceOutput` / `currency`；预置项预填 contextWindow，价格留空由用户填。
- 底栏圆环：`已用 tokens / contextWindow` 的环形进度；hover tooltip 显示 `prompt/completion tokens` 明细。
- 每轮回复 footer 显示本轮费用与本次对话累计费用（`usage × 单价`）；usage 缺失时只显示 tokens。

### 3.5 Prompt 模板 v1（Agent 初版稿，用户后续看着改）

**共用 System：**

```
你是 LeetAssist 内置的刷题教练。用户正在 leetcode.cn 刷题。
你的职责是引导用户独立思考，而不是替他解题。
必须遵守：
1. 永远不要直接输出完整解法代码（"完整分析"模式除外，该模式允许带讲解的核心代码片段）。
2. 优先用渐进式提示、反问、小类比来引导。
3. 用中文回答，简洁、结构化（必要时用 markdown 列表/标题），避免长篇大论。
4. 若用户提供的信息不足以判断，先问最关键的一个缺失信息再回答。
5. 只讨论算法与代码本身。
```

**给提示：**

```
【题目】{title}（{difficulty}，通过率 {acceptanceRate}）
【描述】{description}
【约束】{constraints}
【我当前的代码】{code via @code，可缺省}
【我的请求】我卡住了。请只给我一个能让我自己继续想下去的最小提示，不要透露完整思路，不要给代码。
```

**分析目前我的思路：**

```
（同上上下文）
【我的思路】{userInput}
【我的请求】请评估这个思路的正确性与复杂度风险，指出漏洞或遗漏，可以给出需要验证的反例/边界情形方向。不要直接给完整解法。
```

**帮我找 Bug（保留为模式候选，见第 8 节）：**

```
（同上上下文）
【现象】{userInput}（可选：报错/错误表现）
【我的请求】我的代码行为不符合预期。请定位最可疑的 bug，解释成因与修复方向；可以给出关键几行的修改示意，但不要重写整份解法。
```

**自由提问：**

```
（同上上下文）
【我的问题】{userInput}
```

**完整分析（超时触发或模式选择）：**

```
（同上上下文）
【我的请求】我超时了且没做出来。请给出这道题的完整解析：思路推导（为什么会想到这个方向）、算法步骤、时间/空间复杂度、关键实现要点（可以给核心代码片段，但需逐段解释）。目标是帮我读懂并学会，而不是让我复制。
```

### 3.6 预置 Provider 快捷项

| 预置名 | Base URL | 示例 Model | 上下文窗口预填 |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | 128K |
| Anthropic | `https://api.anthropic.com`（原生协议，专用适配器） | `claude-3-5-haiku-latest`（以官方当前为准） | 200K |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` | 1M |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` | 64K |
| GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | 128K |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-32k` | 32K |
| Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | 128K |

（URL/模型名为当前公开信息，实现时以官方文档为准；用户可改；其余自定义。）

### 3.7 Anthropic 原生适配器要点（方案 a，已确认）

- 端点：`POST https://api.anthropic.com/v1/messages`；认证头 `x-api-key` + `anthropic-version: 2023-06-01`。
- system 走请求体独立 `system` 字段；`max_tokens` 必填（默认 4096）。
- 流式 SSE 事件 `message_start` / `content_block_delta`（`delta.text`）/ `message_delta`（usage）映射为统一流式块与 `ChatResponse.usage`。
- 错误码（401/429/529 等）映射统一失败提示，复用失败态 UI。

### 3.8 权限流程（方案 B）

1. 保存 Provider（含 baseUrl）时 `chrome.permissions.contains` 检查；未授权则在用户手势回调里 `chrome.permissions.request({ origins: [origin] })`。
2. 授权后自动连通性验证（最小请求），展示通过/失败。
3. 拒绝授权：提醒"未授予对该域名的访问权限，LeetAssist 无法向此 Provider 发送请求，AI 功能不可用"，保留重新授权入口。
4. manifest 已声明 `optional_host_permissions: ["https://*/*"]`（安装时无警告）。

## 4. 数据结构 / 接口

```ts
interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  temperature?: number;
  stream?: boolean; // V1 默认 true
}

interface ChatResponse {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;      // 明文 + 常驻提醒，见 02-storage 3.5
  model: string;
  contextWindow?: number;
  priceInput?: number;   // 每百万 tokens
  priceOutput?: number;
  currency?: "CNY" | "USD";
}

interface Conversation {
  id: string;
  problemId: string;
  title: string;             // 直接读网页：题号+题目+难度
  contextSnapshot: {         // 每对话一份，去重
    description: string;
    constraints: string;
    tags: string[];
    acceptanceRate: number;
  };
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  mode?: string;             // 触发模式（草稿清单见第 8 节）
  codeSnapshotId?: string;   // 引用 @code 附件快照（存于 02-storage）
  usage?: { promptTokens: number; completionTokens: number };
  cost?: number;
  createdAt: string;
}
```

## 5. UI / 交互

```
┌──────────────────────────────┐
│ #1 两数之和 · 简单   [历史≡]  │
├──────────────────────────────┤
│ (流式消息流)                  │
│ 本轮 ≈ ¥0.003                │
├──────────────────────────────┤
│ [@code] 输入框…               │
├──────────────────────────────┤
│ [选择模型▾]  ◯ 12% · ¥0.01  [模式▾] │
└──────────────────────────────┘
```

- 历史入口 popover：该题对话列表（标题/更新时间/消息数）+ [新建对话]。
- 模型选择下拉：已配置 Provider×Model 列表；圆环 hover 显示 tokens 明细。
- 失败态：红色错误条 + 原因摘要 + [重试]；用户提示词保留可见。

## 6. 依赖

- 依赖的其他 spec：01-extension-shell（ProblemMeta、面板容器、optional_host_permissions）、02-storage（Provider/对话/代码快照持久化）、05-timer（超时触发"完整分析"）
- 依赖的第三方库：无强制（fetch 直连 + 自解析 SSE）

## 7. 验收标准

- [ ] 对话标题直接取自网页（题号+题目+难度），一题可建/切换多个对话，记录完整保留且刷新/重开设备后可恢复（含 Export/Import）。
- [ ] `@code` 可将当前编辑器代码作为芯片附件加入上下文；未 @code 时不携带代码。
- [ ] 回复流式渲染；失败不重试、提示词不消失、有 [重试] 与清晰原因。
- [ ] 底栏模型下拉、上下文圆环（hover 明细）、资费显示、模式选择均可用。
- [ ] 保存 Provider 触发方案 B 权限申请与连通性验证；拒绝有提醒与重试入口。
- [ ] 预置七项快捷填入可用；Anthropic 走原生适配器可正常流式对话。
- [ ] API Key 只发往用户配置的 Base URL。

## 8. 待确认问题

- [ ] **模式选择器的最终模式清单**（用户 2026-09-15：列出的几个模式还没完全理清楚，作为部分待定）。当前草稿清单：给提示 / 分析目前我的思路 / 自由提问 / 完整分析 / 分析我的思路并给出建议（"帮我找 Bug"是否保留亦在整理范围内）。V1 先按草稿清单实现，用户理清后调整（prompt 模板已具备，调整成本低）。

## 9. 变更记录

| 日期 | 修改内容 |
|---|---|
| 2026-09-12 | 初稿 |
| 2026-09-13 | 跨域结论、host_permissions 待确认 |
| 2026-09-15 | 确认流式/摘要卡片/预置清单/失败态/资费展示/方案 B；移除估时按钮 |
| 2026-09-15 | Anthropic 方案 a；full-analysis 模板；状态 Confirmed |
| 2026-09-15 | **用户新 UI 设计落地**：对话标题读网页、一题多对话且完整保留记录（取代摘要卡片，快照去重控体积）、`@code` 携带代码（取代默认全量携带）、底栏模型下拉+上下文圆环+资费+模式选择；模式清单列为待定 → 状态回退 **Draft**（仅此一问） |
