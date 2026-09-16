# 01. Extension Shell（插件骨架）Spec

- 状态：Confirmed
- 关联阶段：Phase 1
- 最后更新：2026-09-15
- 涉及代码目录：`src/background/`, `src/content/`, `src/panel/`（页内面板 React 应用）, `manifest.json`

## 1. 目标（In Scope）

- 基于 Chrome Extension Manifest V3 搭建插件骨架，插件名称 **LeetAssist**，仅支持 **leetcode.cn**。
- **悬浮 logo 入口**：题目页注入一个悬浮 logo 按钮（插件默认激活态）；点击以弹簧动画展开主面板；关闭时反向收回 logo。
- **页内悬浮主面板**（用户 2026-09-15 提供新 UI 设计后，替代原 Chrome Side Panel 方案）：左画板 + 右 Agent 的双栏布局，中间一条竖直工具栏；面板整体可像窗口一样拖边调节大小；拖动中间分隔线可调节画板与 Agent 的比例。
- 中间竖直工具栏承载模块入口：**计时 / 数据 / 白板设置 / 模型配置**（第一版范围），点击各自弹出 popover 窗口展示对应内容。
- Content Script 读取题目信息（标题/难度/标签/URL/当前语言/当前代码/通过率），并监听 SPA 路由变化。

## 2. 明确不做

- **不使用 Chrome Side Panel 作为主 UI**：原生 Side Panel 无法实现窗口级 resize、自定义弹簧开合动画、双栏宽布局；manifest 不再声明 `sidePanel` 权限。
- 不做 leetcode.com（国际版）适配；不做国际化（i18n）。
- 面板容器不实现各模块业务逻辑（画板/AI/计时分别见 03/04/05 spec），本模块只提供容器、入口、通信与持久化骨架。

## 3. 详细需求

### 3.1 题目信息获取策略（分层，带兜底）

不使用 Selenium / Playwright（二者是外部遥控浏览器的测试工具，与页内 Content Script 不是一回事）。采用"结构化数据优先、DOM 兜底"：

1. **优先**：读取 leetcode.cn 前端自己调用的 GraphQL 接口数据（页内同源请求，不受跨域限制），拿标题/难度/标签/约束/通过率等结构化字段。
2. **兜底**：按优先级尝试候选 CSS 选择器；全部失败时 UI 明确提示"未能识别当前题目"，不静默失败。
3. **代码内容**：Monaco Editor 虚拟滚动导致 DOM 文本读不全，通过 Main World 注入脚本拿 Monaco 实例的 `editor.getValue()` / 语言；代码进入 AI 上下文的方式由 04 的 `@code` 机制控制（不默认全量携带）。
4. 具体查询语句/选择器为实现细节，实现时实测确定；与假设实质出入时按 AGENTS.md 回改本 spec。

### 3.2 UI 注入技术

- Content Script 注入容器节点 + **Shadow DOM**（样式双向隔离：不污染页面、不被页面样式污染）。
- 样式通过 `adoptedStyleSheets` 或扩展资源 CSS（`web_accessible_resources`）注入，规避页面 CSP 限制。
- React 应用挂载在 Shadow Root 内；面板关闭时仅保留 logo 节点，不拦截页面任何事件。

### 3.3 悬浮 logo 与开合动画（用户要求"非常流畅且 Q 弹、惊艳"）

- logo 固定于页面右下角；idle 态呼吸感悬浮动画（上下 ±3px，约 3s 循环）；hover 放大 1.08 + 轻微旋转（约 6°）；按下有回弹反馈。
- **开**：面板以 logo 位置为锚点做弹簧缩放展开（过冲约 1.03 后回稳），同时 logo 缩小淡出、视觉上"飞入"面板边角；**关**：反向播放收回 logo。
- 实现：Web Animations API + CSS `linear()` 弹簧缓动曲线（零依赖）；若实机效果不足再评估引入 framer-motion 的 spring（届时单独说明）。尊重 `prefers-reduced-motion`，降级为简单淡入淡出。
- 时长：开约 420ms、关约 320ms。

### 3.4 面板布局（依据用户手绘 mockup）

```
┌──────────────────┬──┬──────────────────────┐
│ 白板区            │计│ 对话标题：题号+题目+难度 │
│ [顶部工具行]      │时│                      │
│ [常]             │──│ 消息流                │
│ [用]   画布       │数│                      │
│ [图]             │据│                      │
│ [形]             │──│──────────────────────│
│ [左]             │白│ 输入框（支持 @code）    │
│ [竖]             │板│──────────────────────│
│ [条]             │设│ 选择模型 ◯上下文/资费 模式│
│                  │置│                      │
│                  │──│                      │
│                  │模│                      │
│                  │型│                      │
└──────────────────┴──┴──────────────────────┘
```

- 左白板区默认占比约 55%–60%，符合常规画图比例（用户要求"白板区域稍大"）。
- 中间竖直工具栏四个入口：计时 / 数据 / 白板设置 / 模型配置；hover 显示名称 tooltip；点击弹出锚定工具栏的 popover 窗口（不遮挡双栏主操作区，可关闭）。
- **整体 resize**：拖面板四边/四角像窗口一样调节（最小 720×480）。
- **比例调节**：拖中间分隔线（工具栏所在列）调节白板:Agent 比例（允许范围 30%–70%）。
- 尺寸与比例写入设置持久化，下次打开恢复；面板默认关闭（只显示 logo），刷新后不强制恢复打开态。

### 3.5 SPA 路由变化检测

监听 `history.pushState`/`popstate` + `MutationObserver`（题目标题节点）双重检测，任一触发重新拉取题目信息并通知面板内各模块（画板切题恢复、对话标题更新等）。

### 3.6 通信骨架

- 面板 React 运行在 Content Script 的 isolated world（由 content script 注入），与 background 通过 `chrome.runtime` 消息通信；background 负责：badge 倒计时（05）、notifications（05）、运行时权限申请（04）。
- 题目信息（`ProblemMeta`）由 content 层统一维护并广播给面板内各模块，避免各自重复抓取。

## 4. 数据结构 / 接口

```ts
interface ProblemMeta {
  problemId: string;   // slug，例如 "two-sum"
  title: string;
  difficulty: "简单" | "中等" | "困难"; // leetcode.cn 中文难度标签
  tags: string[];
  url: string;
  language: string;    // 当前 LeetCode 编辑器选择的语言
  code: string;        // 当前编辑器内容
  acceptanceRate: number; // 通过率（0–1），供 05-timer 本地估时
}
```

## 5. UI / 交互

- Phase 1 验收形态：logo + 面板骨架（双栏 + 中间工具栏 + 四个 popover 占位）+ Agent 区头部显示题目信息（题号+题目+难度）。
- 各 popover 与双栏内部的具体内容由 03/04/05/02 spec 定义。

## 6. 依赖

- 依赖的其他 spec：无（最底层骨架模块）
- 依赖的第三方库：React + TypeScript + Vite + `@crxjs/vite-plugin`；动画不引库（WAAPI + `linear()`）
- 可参考的开源项目：LeetCode AI Assistant、LeetPilot（仅架构参考）

## 7. 验收标准

- [ ] leetcode.cn 题目页显示悬浮 logo；点击以弹簧动画展开面板，关闭反向收回；动画流畅无卡顿。
- [ ] 面板四边/四角可窗口式 resize；中间分隔线可调双栏比例；尺寸与比例下次打开恢复。
- [ ] 中间工具栏四个入口（计时/数据/白板设置/模型配置）各自弹出 popover。
- [ ] 切题（SPA 不刷新）时题目信息同步更新；刷新页面后重新正确识别。
- [ ] 非 leetcode.cn 网站不出现 logo/面板。
- [ ] 题目信息获取失败时有明确错误提示，不空白不崩溃。
- [ ] 面板与页面样式互不污染（Shadow DOM 验证），不破坏 LeetCode 页面布局与操作。

## 8. 实现决策记录

- **manifest**（用户委托 Agent 决策；Side Panel 方案已废弃）：
  ```json
  {
    "manifest_version": 3,
    "name": "LeetAssist",
    "permissions": ["storage", "notifications"],
    "host_permissions": ["https://leetcode.cn/*"],
    "optional_host_permissions": ["https://*/*"],
    "content_scripts": [
      {
        "matches": ["https://leetcode.cn/problems/*"],
        "js": ["content.js"],
        "run_at": "document_idle"
      }
    ],
    "web_accessible_resources": [
      { "resources": ["panel.css", "assets/*"], "matches": ["https://leetcode.cn/*"] }
    ]
  }
  ```
  说明：`storage` 用于配置持久化；`notifications` 用于计时到时通知（05）；`host_permissions` 仅 leetcode.cn；`optional_host_permissions` 供 04-ai-assistant 运行时按用户填写的 AI Base URL 动态申请（方案 B，安装时无警告）；`web_accessible_resources` 供 Shadow DOM 加载扩展内样式/资源。
- **构建工具链**：Vite + `@crxjs/vite-plugin`（理由见历史记录：Vite 生态最活跃的扩展打包插件，自动处理 manifest/多入口/Content Script 热更新）。
- **图标**：源文件 `plan/assets/logo.png`，实现时切 16/32/48/128 尺寸；悬浮 logo 复用同一视觉。

## 9. 变更记录

| 日期 | 修改内容 |
|---|---|
| 2026-09-12 | 根据总体规划文档整理出初稿 |
| 2026-09-15 | 用户确认全部待确认问题；状态 Draft → Confirmed |
| 2026-09-15 | V1 布局调整为两 Tab + 顶部计时条；ProblemMeta 增加 acceptanceRate；manifest 增加 notifications/optional_host_permissions |
| 2026-09-15 | **用户提供新 UI 设计：主 UI 由 Chrome Side Panel 改为页内悬浮面板 + 悬浮 logo 入口**（窗口式 resize、中间分隔线调比例、弹簧开合动画、中间竖直工具栏四入口、左白板右 Agent 双栏）；废弃 sidePanel 权限；重写布局/动画/注入技术章节 |
