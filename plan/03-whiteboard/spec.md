# 03. Whiteboard（画板）Spec

- 状态：In Progress（2026-09-21 开出 `feature/whiteboard-konva` 分支）
- 关联阶段：Phase 2
- 最后更新：2026-09-21
- 涉及代码目录：`src/panel/whiteboard/`

## 1. 目标（In Scope）

- 提供每道题独立的轻量画板：自由绘图（画笔）、箭头、矩形、圆形、文本、拖拽、缩放、撤销/重做、清空。
- 自动保存到 `02-storage` 定义的 `ProblemSession.whiteboard`：**编辑停止 1 秒后自动保存**（防抖 1s）；**单题存储目标 ≤ 100KB**（lz-string 压缩后）。
- 切换题目 / 刷新页面后能恢复对应题目的画板内容。
- 快捷交互（用户已确认，2026-09-15）：
  - 鼠标右键 = 快速进入文字输入（拦截默认右键菜单）；
  - 滚轮 = 缩放（以光标为中心）；
  - Space + 鼠标拖动 = 平移画布；
  - 工具切换靠键盘快捷键或单次点击，不做多层菜单。
  - 后续可慢慢追加更多自定义交互，第一版只做以上这些。
- 工具栏完全自建（裸画布库），具体设计见第 5 节（Agent 初版稿）。
- 架构上为程序化作图留门：场景组织支持"从结构化 JSON 批量生成图形元素"（覆盖层设计），供未来 AI 作图 / trace 渲染复用。

## 2. 明确不做

- **AI 根据题目/代码作图功能不做进第一版**（用户 2026-09-15 确认：功能一个个来做，该功能等用户明确说做时再立项补 spec）；本 spec 只保留架构留门（覆盖层 + 场景图 + JSON 双向序列化）。
- 不做多人协作、云端同步。
- 不做画板分享链接、导出图片（除非用户后续明确要求）。
- 不引入完整白板套件（tldraw / Excalidraw 等），理由见第 3 节选型记录。
- 不追求专业绘图软件级功能完整度，只服务"刷题时快速示意"。

## 3. 技术选型决策记录：Konva + react-konva

用户明确三条选型标准——①不拖累插件内存/性能、②便于与 LLM 协同的深度自定义、③实现难度可控——并要求在 Fabric 与 Konva 之间做最终选择。**结论：Konva（+ 官方 React 绑定 react-konva）**。

- **性能/内存**：公开 canvas 基准（slaylines/canvas-engines-comparison，8k 运动矩形，方向性参考）Chrome 下 Konva ≈23fps vs Fabric ≈9fps；Konva 多层架构（每个 Layer 独立 canvas、静态层不重绘）匹配本画板"静态绘制层 + 动态覆盖层"设计；两库包体积同量级（gzip 几十 KB 级），远小于完整白板套件。
- **LLM 协同/自定义**：场景图 `Stage > Layer > Group > Shape` 与结构化 JSON 一一映射（一个链表节点 = 一个 `Group(Rect+Text)`）；react-konva 声明式渲染让"LLM 输出 → setState → 画布更新"数据流顺畅；Fabric 命令式 API 在 React 中需手动同步易出 bug。
- **难度**：Transformer（选中/缩放）、拖拽、Tween 动画、事件冒泡、`toJSON()`/`Node.create()` 双向序列化均内置；唯一缺口是自由画笔需自写约 30 行 pointer 事件收集（官方教程有示例）。
- 不选 Fabric 的反方记录：内置画笔/选择控件省一点初始功夫，但命令式模型与 React 相冲、无官方 React 绑定、基准性能更差、捆绑用不到的 SVG/滤镜功能。

## 4. 数据结构 / 接口

### 4.1 设计原则

1. **自定义元素模型**（2026-09-21 用户决策，替代原 `stage.toJSON()` 方案）：画板数据 = 扁平的元素数组，与 Konva 内部表示解耦。理由：① 主题语义色要求数据不含字面颜色（深浅色切换时已有图形自动跟随，杜绝"黑纸黑线"）；② 比 `stage.toJSON()` 更紧凑（利于 100KB 目标）；③ 与 LLM 程序化生成天然契合——LLM 只需产出一个 JSON 数组，无需了解 Konva。
2. **语义化属性**：颜色/线宽存语义 id，渲染时按当前主题映射为实际值（`src/panel/theme.ts`）。
3. **世界坐标**：元素坐标为世界坐标（逻辑像素，+x 右、+y 下），视图缩放/平移只影响显示、不进数据。

### 4.2 元素模型

```ts
/** 语义色 id：渲染时按主题映射（theme.ts WB_COLORS），数据不含字面颜色 */
type WBColorId = "default" | "red" | "blue" | "green" | "orange";
/** 语义线宽 id：渲染时映射为像素（theme.ts） */
type WBWidthId = "thin" | "medium" | "thick";

interface WBElementBase {
  id: string;            // 唯一 id；手绘元素 nanoid，覆盖层程序化元素用 "ov-" 前缀
  color: WBColorId;      // 缺省 "default"
  width: WBWidthId;      // 缺省 "medium"
}

/** 画笔自由路径 */
interface WBPathElement extends WBElementBase {
  type: "path";
  points: number[];      // 扁平 [x1,y1,x2,y2,...]，入库前 simplify-js 抽稀 + 坐标取整
}
/** 矩形：x,y = 左上角 */
interface WBRectElement extends WBElementBase {
  type: "rect";
  x: number; y: number; w: number; h: number;
}
/** 椭圆：x,y = 外接框左上角（与 rect 参数形态一致，降低 LLM 记忆负担） */
interface WBEllipseElement extends WBElementBase {
  type: "ellipse";
  x: number; y: number; w: number; h: number;
}
/** 箭头 / 直线：两点式 [x1,y1,x2,y2] */
interface WBArrowElement extends WBElementBase {
  type: "arrow";
  points: [number, number, number, number];
}
interface WBLineElement extends WBElementBase {
  type: "line";
  points: [number, number, number, number];
}
/** 文本：x,y = 左上角 */
interface WBTextElement extends WBElementBase {
  type: "text";
  x: number; y: number;
  text: string;
  size?: number;         // 字号，缺省 16
}

type WBElement = WBPathElement | WBRectElement | WBEllipseElement
               | WBArrowElement | WBLineElement | WBTextElement;
```

- z 序 = 数组顺序（越靠后越在上层），无独立 z 字段。
- 每种类型"最小必填 + 语义缺省"，未知字段在加载时剥离（见 4.4）。

### 4.3 场景模型（三层架构的持久化形态）

```ts
interface WBViewState {
  scale: number;     // 0.1–4
  offsetX: number;
  offsetY: number;
}

interface WhiteboardScene {
  schemaVersion: number;   // 当前 1；与 02-storage 惰性兼容策略对齐
  elements: WBElement[];   // 绘制层：用户手绘内容
  overlay: WBElement[];    // 覆盖层：程序化生成元素（未来 AI 作图 / trace 高亮）
  view: WBViewState;       // 每题记住自己的视口
}
```

- 持久化：`JSON.stringify(scene)` → `lz-string` 压缩 → `ProblemSession.whiteboard`（02 spec）；背景层（网格）是纯渲染、不入库。
- **覆盖层与绘制层同构**（同一 `WBElement` 模型），程序化管线与用户渲染管线完全复用；覆盖层支持整体清空 + 批量重绘（`setOverlay(elements)`），不污染手绘内容。

### 4.4 LLM 程序化生成契约（架构留门的核心）

未来 AI 作图 / trace 渲染向覆盖层写入时，输入 = 4.2 的 `WBElement[]` JSON。加载管线统一做防御性校验：

1. 逐元素校验 `type` 合法、必填字段存在且为有限数值、字符串字段确为字符串；
2. 数值 clamp 到合理范围（坐标 ±100000、尺寸 ≤ 100000、字号 8–72）；
3. 未知字段剥离、非法元素丢弃并计数，UI 一次性提示"N 个元素无法识别已跳过"；
4. `id` 缺失时自动生成 `ov-` 前缀 id。

效果：LLM 的 prompt 只需描述 4.2 的类型表，无需了解 Konva / 存储 / 压缩的任何细节；校验层保证垃圾输入不污染画板。

### 4.5 紧凑化与 100KB 目标

坐标取整（保留 1 位小数）、path 抽稀（simplify-js，tolerance ≈ 1.0）、语义 id 短字符串。保存时估算压缩后大小，超过 100KB 弹一次轻量提示（toast）告知"本题画板数据偏大，建议清理无用笔迹"，不阻断保存、不自动删用户数据。

## 5. UI / 交互（Agent 初版设计稿，待用户看效果后提修改意见）

### 5.1 工具栏（按用户 mockup：顶部工具行 + 左侧常用图形竖条）

顶部工具行（画布顶部单排）：

```
[选择 V][画笔 P][矩形 R][圆形 O][箭头 A][文本 T] │ [撤销][重做] │ [清空]
```

- 属性条（仅当绘图/文本工具激活时，在顶部工具行下方显示一条细条）：颜色点 5 个（黑/红/蓝/绿/橙）+ 线宽 3 档（细/中/粗）。
- **左侧常用图形竖条**（画布左缘垂直条）：一键插入或拖出常用图形预设（矩形/圆形/箭头/直线/文本框），缩短常用形状的使用路径。
- 画布右下角：缩放比例显示（如 `100%`）+ 点击复位视图按钮。
- "清空"需要二次确认弹窗（防误触丢数据）。
- **背景网格三样式**（2026-09-21 用户确认）：点阵（默认）/ 线格 / 无网格，入口在 01 骨架预留的"白板设置"popover（该 popover 的第一个真实内容）；`gridMode` 为全局设置（不按题），持久化 `chrome.storage.local`；网格颜色随主题。实现顺序上排在核心绘图功能之后。
- 白板区为面板左栏，默认占比约 55%–60%（拖 01 的中间分隔线可调），画布保持常规画图比例。

### 5.2 快捷键与鼠标行为（第一版范围）

| 操作 | 绑定 |
|---|---|
| 选择 / 画笔 / 矩形 / 圆形 / 箭头 / 文本 | `V` / `P` / `R` / `O` / `A` / `T` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Shift+Z` |
| 删除选中元素 | `Delete` 或 `Backspace` |
| 快速文字输入 | 鼠标右键（拦截默认菜单） |
| 缩放 | 滚轮（光标为中心，范围 10%–400%） |
| 平移 | Space + 鼠标拖动 |

**快捷键/鼠标门控（2026-09-21 补充，重要交互约束）**：上述所有快捷键与 Space 平移仅在**指针悬停于画布区域**时生效，且文本编辑进行中屏蔽工具切换快捷键——避免与 LeetCode Monaco 编辑器按键冲突（用户在代码里按 Delete / Ctrl+Z / Space 时绝不能误伤画板）。实现方式：跟踪画板 hover 状态作为所有快捷键的总开关。

**主题适配（2026-09-21 补充）**：画布纸面色、网格色随主题（`--la-*` token 对应的 JS 值，theme.ts 导出）；图形颜色即 4.2 语义色，主题切换时全量重渲染自动跟随，无需迁移数据。

### 5.3 画板分层

- `背景层`：网格等静态内容，不重绘；
- `绘制层`：用户手绘内容；
- `覆盖层`：程序化生成元素（未来 AI 作图 / trace 高亮），可整体清空/重绘，不污染手绘内容。

### 5.4 选中与变换

- 使用 Konva `Transformer`，仅启用缩放手柄（`rotateEnabled: false`），保持极简。

## 6. 依赖

- 依赖的其他 spec：02-storage（持久化）、01-extension-shell（SPA 切题检测提供 problemId 广播、主题 token 体系）
- 依赖的第三方库：`konva`、`react-konva`（主版本与 React 18 匹配）、`simplify-js`（画笔抽稀）、`lz-string`（压缩）
- 键盘/鼠标交互必须与 LeetCode Monaco 编辑器隔离（见 5.2 门控约束）

## 7. 验收标准

- [ ] 能自由绘图、加箭头/矩形/圆形/文本，能拖拽、缩放、撤销/重做、清空（清空有二次确认）。
- [ ] 鼠标右键点击画板空白处直接进入文字输入，不弹默认右键菜单。
- [ ] 滚轮缩放、Space+拖动平移工作正常。
- [ ] **快捷键门控生效**：指针不在画布区域（如在 Monaco 中打字）时，Delete/Ctrl+Z/Space 等不影响画板。
- [ ] 编辑停止 1 秒后自动保存；切题/刷新后内容正确恢复（依赖 01 的 SPA 切题检测）。
- [ ] 单题画板压缩后存储 ≤ 100KB；超限时有一次性提示且不阻断保存。
- [ ] 覆盖层可被程序整体清空并批量重绘（同构 WBElement[]），不影响绘制层。
- [ ] **主题适配**：深/浅主题切换后，画布底色、网格、已有图形（语义色）均正确跟随，无"黑纸黑线"。
- [ ] 网格三样式（点阵/线格/无）可在白板设置 popover 切换并持久化。
- [ ] 常规绘图交互无明显卡顿（页内悬浮面板场景，定性验收）。

## 8. 待确认问题

暂无。UI 设计为 Agent 初版稿，用户将在看到实际效果后提出修改意见（属于迭代反馈，不是阻塞项）。

## 9. 变更记录

| 日期 | 修改内容 |
|---|---|
| 2026-09-12 | 根据总体规划文档整理出初稿 |
| 2026-09-13 | 调研并将默认技术方案从 tldraw 改为推荐 Excalidraw（备选 Fabric/Konva 自建） |
| 2026-09-15 | 最终确定画板库为 Konva + react-konva，记录选型理由 |
| 2026-09-15 | 确认全部待确认问题：UI 由 Agent 出初版设计稿（工具栏/快捷键/分层）、交互范围（右键=文字/滚轮缩放/Space 平移）、单题存储 ≤100KB、自动保存防抖 1s；AI 作图明确不做进第一版；状态改为 **Confirmed** |
| 2026-09-15 | 按用户 mockup 调整布局：画板作为统一面板左栏（顶部工具行 + 左侧常用图形竖条），默认占比 55%–60% |
| 2026-09-21 | Phase 2 启动（用户确认）：① §4 重写为**自定义元素模型**（语义色/线宽 id，替代 `stage.toJSON()`，含 LLM 程序化生成契约与校验管线，世界坐标与视图分离）；② 网格三样式（点阵/线格/无）进白板设置 popover，排在核心功能之后；③ 新增快捷键 hover 门控与主题适配约束；④ 目录修正为 `src/panel/whiteboard/`（sidepanel 已废弃）；⑤ 状态 → In Progress |
