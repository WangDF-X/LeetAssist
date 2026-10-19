# 03. Whiteboard（画板）Spec

- 状态：In Progress（2026-09-21 开出 `feature/whiteboard-konva` 分支；2026-10-12 起在 `feature/metashape-lib` 做图元库）
- 关联阶段：Phase 2
- 最后更新：2026-10-19
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
- 左侧图标条提供**数据结构图元库**：12 个正交模板（序列/柱状图/链表/栈/队列/表格/键值表/桶/树/堆/图/状态机），参数化宏展开为现有元素，整体操作靠通用多选（见 §4.4、§5.1）。
- **提供"语义 DSL + 编译器"作为程序化作图的唯一入口**（§4.6）：图元库与 AI 作图都产出语义 DSL、编译为 `WBElement[]`；几何/样式全在编译器内，与 DSL 解耦。
- 覆盖层（`scene.overlay`）：编译器产物写入此处，与手绘分离、可整体清空/重绘；渲染在独立 Layer。

## 2. 明确不做

- **AI 作图功能本身不在本模块范围**（是否需要、何时做由 04 / 07 决定）：本模块只提供"语义 DSL + 编译器"这一**确定性作图入口**（§4.6）与覆盖层；AI 侧的产出与耦合见 04 / 07。
- 不做多人协作、云端同步。
- 不做画板分享链接、导出图片（除非用户后续明确要求）。
- 不引入完整白板套件（tldraw / Excalidraw 等），理由见第 3 节选型记录。
- 不追求专业绘图软件级功能完整度，只服务"刷题时快速示意"。
- **连线不做**（2026-09-22）：直角折线走线、固定端口（N/S/E/W 手动锚点）、连线互相绑定（防循环）、端点对齐辅助线。这些留待的确有需要时再评估。

## 3. 技术选型决策记录：Konva + react-konva

用户明确三条选型标准——①不拖累插件内存/性能、②便于与 LLM 协同的深度自定义、③实现难度可控——并要求在 Fabric 与 Konva 之间做最终选择。**结论：Konva（+ 官方 React 绑定 react-konva）**。

- **性能/内存**：公开 canvas 基准（slaylines/canvas-engines-comparison，8k 运动矩形，方向性参考）Chrome 下 Konva ≈23fps vs Fabric ≈9fps；Konva 多层架构（每个 Layer 独立 canvas、静态层不重绘）匹配本画板"静态绘制层 + 动态覆盖层"设计；两库包体积同量级（gzip 几十 KB 级），远小于完整白板套件。
- **LLM 协同/自定义**：场景图 `Stage > Layer > Group > Shape` 与结构化 JSON 一一映射（一个链表节点 = 一个 `Group(Rect+Text)`）；react-konva 声明式渲染让"LLM 输出 → setState → 画布更新"数据流顺畅；Fabric 命令式 API 在 React 中需手动同步易出 bug。
- **难度**：Transformer（选中/缩放）、拖拽、Tween 动画、事件冒泡、`toJSON()`/`Node.create()` 双向序列化均内置；唯一缺口是自由画笔需自写约 30 行 pointer 事件收集（官方教程有示例）。
- 不选 Fabric 的反方记录：内置画笔/选择控件省一点初始功夫，但命令式模型与 React 相冲、无官方 React 绑定、基准性能更差、捆绑用不到的 SVG/滤镜功能。

## 4. 数据结构 / 接口

### 4.1 设计原则

1. **自定义元素模型**（2026-09-21 用户决策，替代原 `stage.toJSON()` 方案）：画板数据 = 扁平元素数组，与 Konva 内部表示解耦。理由：① 主题语义色不含字面颜色；② 存储更紧凑；③ 程序化作图由语义 DSL 编译到本模型，LLM 无需了解 Konva，也不直接生成元素数组（§4.6）。
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
/** 矩形：x,y = 左上角；label = 图形内文字（居中，颜色随图形语义色，字号同文本缺省） */
interface WBRectElement extends WBElementBase {
  type: "rect";
  x: number; y: number; w: number; h: number;
  label?: string; labelSize?: number; // labelSize 缺省 16；预留字段，V1 无 UI 修改
}
/** 椭圆：x,y = 外接框左上角（与 rect 参数形态一致，降低 LLM 记忆负担） */
interface WBEllipseElement extends WBElementBase {
  type: "ellipse";
  x: number; y: number; w: number; h: number;
  label?: string; labelSize?: number;
}
/** 箭头样式：无 / 反向(起点) / 正向(终点) / 双向 */
type WBArrowhead = "none" | "start" | "end" | "both";

/** 连线（合并原 arrow + line，2026-09-22） */
interface WBConnectorElement extends WBElementBase {
  type: "connector";
  points: [number, number, number, number];   // [x0,y0,x1,y1]：自由端的字面坐标（永远存储，兼兜底）
  connects?: { from?: string; to?: string };  // 按 id 绑定图形，允许单边；目标缺失时该端回退字面值
  arrowhead: WBArrowhead;                      // 缺省 "end"
  label?: string; labelSize?: number;          // 连线中点文字（状态机/流程图分支标注）
}
/** 文本：x,y = 左上角 */
interface WBTextElement extends WBElementBase {
  type: "text";
  x: number; y: number;
  text: string;
  size?: number;         // 字号，缺省 16
}

type WBElement = WBPathElement | WBRectElement | WBEllipseElement
               | WBConnectorElement | WBTextElement;
```

- z 序 = 数组顺序（越靠后越在上层），无独立 z 字段。
- 每种类型"最小必填 + 语义缺省"，未知字段在加载时剥离（见 4.4）。
- **图形内文字 label（2026-09-22 用户确认）**：矩形/椭圆的可选属性（不是复合元素、不是文本绑定——"节点=单元素"，移动/撤销/存储天然一体，也是 LLM 与图元库最省事的表达）。渲染于图形中心，颜色随图形语义色，字号缺省 16（与独立文本一致；`labelSize` 为纯增量预留，V1 不开放修改）。label 提交时若超出图形，**以中心为锚自动撑大**图形至容纳（估算度量，见实现说明）。独立文本元素继续用于图形外批注，两套语义不混用。
- **连线（connector，2026-09-22 用户确认纳入 V1）**：
  - 原 `arrow` + `line` 合并为单一 `connector`；`arrowhead` 四样式（无/正向/反向/双向）覆盖"直线/单向箭头/双向箭头"；新建缺省正向 `end`。
  - `connects` 为**可选的按 id 绑定**（`from`/`to` 各自可选，允许半绑定）：绑定的端点在**渲染时**由目标图形包围盒解析 → 图形移动/缩放自动跟随；未绑定端用 `points` 字面值（自由端）。
  - **锚点自动朝向对方**（取两中心连线与包围盒边界的交点），不做固定 N/S/E/W 端口；椭圆用包围盒近似。
  - **可绑定目标 = 矩形/椭圆/文本**（不含画笔 path、不含连线本身——防循环依赖）。
  - **删除被连图形** → 该端回退字面 `points`（冻结在原地，不崩溃不消失）；**不做**连线互相绑定、直角折线走线、固定端口。
  - `label`：连线中点文字（分支"是/否"等），渲染与编辑复用图形 label 的一套机制。
  - 对程序化作图：AI 只描述 DSL 关系；builder 生成包含绑定及兜底坐标的 connector，不开放直接元素输出入口。

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

### 4.4 程序化生成 IR 契约（`WBElement[]`，编译器内部）

> 2026-10-12 定位调整：**AI / 图元库不再直接产出 `WBElement[]`**——它们产出**语义 DSL**（§4.6），由**编译器**翻译为本节的 `WBElement[]`（IR）。本节规定 IR 的形态、防御性校验与几何 seam；§4.6 规定 DSL 与编译器。

任何写入绘制层/覆盖层的 `WBElement[]` 都必须校验。以下为手绘/历史数据的防御性加载规则；新编译批次遵守下文的严格后置条件：

1. 逐元素校验 `type` 合法、必填字段存在且为有限数值、字符串字段确为字符串；
2. 数值 clamp 到合理范围（坐标 ±100000、尺寸 ≤ 100000、字号 8–72）；
3. 未知字段剥离、非法元素丢弃并计数，UI 一次性提示"N 个元素无法识别已跳过"；
4. `id` 缺失时自动生成 `ov-` 前缀 id（覆盖层）。

以上宽松容错适用于手绘/历史场景的防御性加载。**新编译批次不能靠 clamp、截断、补 ID、解绑或丢元素获得成功**：须满足 [健壮性契约](diagram-contract.md) §7 的严格后置条件，否则整图失败并保留旧图。DSL 入口校验不能由 IR sanitizer 代替。

**节点类图形的生成形态**：链表节点/流程图框等“框+文字”= 单个 rect/ellipse 带 label，不拆成松散元素。连线由 builder 生成 connects、arrowhead、可选 label 与必填兜底 points；AI 只描述 DSL 关系，不直接产出 IR。

**统一几何 seam（连线锚点与图元库共用）**：`model.ts` 导出
- `getElementBounds(el)`：rect/ellipse=自身框；text=估算；path/connector=点位包围盒；
- `estimateTextSize(text, fontSize)`：CJK ≈1em、ASCII ≈0.6em；
- `resolveConnectorPoints(conn, byId, boundsOf?)`：解析连线端点（绑定端 = 两中心连线与包围盒边界交点；自由端 = 字面值；目标缺失回退字面值）；
- `bboxBoundaryPoint(box, tx, ty, pad?)`：射线与包围盒边界交点。

label 超框撑大、连线端点解析、图元库预设尺寸都走这同一套纯函数，后续功能不回头重构元素模型。`resolveConnectorPoints` 的 `boundsOf` 可注入，用于拖动中按 Konva 节点实时几何解析（实时跟随）。

**复合结构（链表/队列/树/图等）的扩展策略**（2026-09-21 用户确认"做到时再扩，不在 V1 囤货"）：V1 元素模型不含复合类型。采用**宏展开层**——把高层结构描述翻译成现有 `WBElement[]`；"整体操作"由**通用多选（框选）**承担（§5.4），**不引入 `groupId`**。当确需"持久结构身份"（反复整体操作而不必每次重新框选）时，再加可选 `groupId`（惰性兼容、旧数据免迁移）。扩展通道三重保障：`type` 判别联合（加变体即纯增量）、校验管线丢弃未知 type 不崩溃、`schemaVersion` 兜底。

**图元库契约（预设 = 语义模板）**：数据结构图元库（§5.1 左栏）不引入新元素类型；模板先将参数转换为 DSL，再走统一校验与编译器：

```ts
type WBPresetParam =
  | { kind: "number"; key: string; label: string; min: number; max: number; default: number }
  | { kind: "boolean"; key: string; label: string; default: boolean };

interface WBPreset {
  id: string;
  name: string;
  group: "linear" | "grid" | "tree" | "relation"; // 左栏分组
  params: WBPresetParam[];   // 空数组 = 无参数（点击直接插入，不弹窗）
  toStructure(params: Record<string, number | boolean>): DslStructure;
}

/** 分组展示名（左栏卡片标题） */
const WB_PRESET_GROUPS = {
  linear: "线性", grid: "二维", tree: "层级", relation: "关系",
} as const;
```

- **插入**：左栏点模板 → 参数窗 → `toStructure` → 包装为 `LlmDiagram` → 校验/编译 → 成功后居中、全选、切选择态；一次插入 = 一步撤销，失败不改变场景或撤销栈。
- **整体操作**：由 §5.4 的**通用多选**提供（移动/缩放/删除），**不依赖任何组关系**；调整结构靠再框选、手动增删或重新插入。
- 自动连线复用 `connector.connects{from,to}`；单元格/结点仍是可绑定目标（`isBindable`）。
- 生成元素的 `color`/`width` 取当前工具条"新建默认值"；**结点/label 文字一律留空**由用户填写。
- **模板清单（12 个 × 4 组）**：线性（序列、柱状图、链表、栈、队列）/ 二维（表格·网格、键值表·哈希、桶）/ 层级（树、堆）/ 关系（图、状态机）。参数、默认值、尺寸见 §5.1。
- **明确不做**：坐标轴 / 数轴 / 坐标系（几何、区间类手绘）；标记类（指针/高亮/下标行）后置；"插入后改参数重建"不做（无持久结构身份，`groupId` 不引入）。

**IR 输出契约细则（2026-10-12）**

> 编译器的产物（IR）须满足以下规则；图元库与 AI（经 DSL §4.6）最终都编译到这一格式。本节与 §4.6、§5.1 图元库**同源**，须同步维护（见 G）。

**A. 硬性规则（违反会被 `sanitizeElements` 丢弃或降级）**

| # | 规则 | 违反后果 |
|---|---|---|
| A1 | 结点（rect/ellipse/text）必须带**全局唯一 `id`** | 缺 id 自动补 `ov-*`；若连线 `connects` 引用了原 id → **绑定失配**，退化为字面线 |
| A2 | 连线用 `connects{from,to}` 按 id 引用结点（可单边） | 引用不存在 → 该端回退字面 `points`；`from===to` → 整个 connects 剥离 |
| A3 | 每条 `connector` 仍**必须**给 `points:[x0,y0,x1,y1]`（兜底） | 缺 `points` → 整条被丢弃 |
| A4 | 颜色/线宽只写语义 id（`default/red/blue/green/orange`、`thin/medium/thick`） | 越界回落 `default`/`medium` |
| A5 | 坐标为世界坐标（逻辑 px），`rect`/`ellipse` 的 `x,y` 为**左上角** | 越界 clamp ±100000 |
| A6 | 尺寸 ≤100000、字号 8–72、`label` ≤200 字符 | clamp / 截断 |
| A7 | 未知字段、未知 `type` | 字段剥离 / 元素丢弃并计数 |
| A8 | `arrowhead ∈ {none,start,end,both}` | 越界回落 `end` |

推荐 JSON 骨架（结点 = 单元素带 `label`；边 = `connector` 只给 `connects` + 兜底 `points`）：

```json
[
  { "id": "n1", "type": "rect", "x": 0, "y": 0, "w": 96, "h": 44, "label": "1" },
  { "id": "n2", "type": "rect", "x": 144, "y": 0, "w": 96, "h": 44, "label": "2" },
  { "id": "e1", "type": "connector", "points": [48, 22, 192, 22],
    "connects": { "from": "n1", "to": "n2" }, "arrowhead": "end", "label": "next" }
]
```

**B. 元素模式**

| 用途 | 形态 |
|---|---|
| 结点 / 格子 / 状态 | `rect` 或 `ellipse` + `label`（值/名字，可空） |
| 边 / 指针 / 转移 | `connector` + `connects{from,to}` + `arrowhead` + 可选 `label` |
| 批注 / 下标 / 标签 | 独立 `text`（图形外，不参与连线绑定） |
| 强调线 | `path`（编译器内部使用，LLM 不直接输出） |

**C. 推荐尺寸/样式约定（与 §5.1 图元库一致 → 风格统一）**

- 方格 44×44；链表结点 = 值数 × 40 宽 × 30 高（每值一格，默认 1 格）；树/图结点圆 ⌀44（状态机 ⌀48）；字号 16。
- 树/堆：层距 72、同层距 24；水平相邻结点间距 ≥24。
- **语义色约定**（建议遵循，便于读者理解过程）：`default`=结构本体；`blue`=当前/活跃；`red`=目标/答案/失配；`green`=已完成/命中；`orange`=高亮/临时。
- 线宽：结构边 `medium`、强调 `thick`、辅助 `thin`。

**D. 过程标注配方（标记类图元后置，暂用现有元素表达）**

> 现有图形是**描边式**（无填充透明度）："高亮"一律用**颜色/描边**表达，不用半透明填充。

| 过程态 | 表达方式 |
|---|---|
| 指针（lo/hi/mid/i/j） | 目标格下方放 `text`（"i"/"j"），再 `connector`（`arrowhead:"end"`）从文本指向该格 |
| 滑动窗口 / 区间 | 窗口覆盖的格/结点 `color:"blue"`（或外围叠一个 `rect` 描边框） |
| 待处理 / 已访问 | 结点 `color:"orange"` / `color:"green"` |
| 失配 / 剪枝 | 结点或分支边 `color:"red"`，label 可加 "✗" |
| 路径 / 答案 | 组成路径的边 `color:"green"`、`width:"thick"` |
| 下标行 | 序列下方生成 n 个 `text`（0..n-1） |

**E. 分题型配方（结合真实解题过程）**

| 题型 | 结构 + 过程标注 |
|---|---|
| 数组 / 双指针 / 滑窗（1、209、3） | 一排 `rect` 格 + 下标 `text`；指针 `text`+`connector` 指向；窗口内 `color:"blue"` |
| 链表（206、141） | `rect` 结点（可多值格）+ `connector`（`arrowhead:"end"`）；连线**就近选格**（朝向目标那一侧的格子）；**双链用 `"both"` 双向箭头**（不另加反向边）；环用首尾相接的边；哨兵用 `text` |
| 二叉树 / 递归树（94、98、46） | `ellipse` 结点 + `connector`（`arrowhead:"none"`）作树边；分支可 `label`（"L"/"R"）；回溯路径 `color:"blue"` |
| DP 表（1143、72、322） | `rect` 网格 + 顶部/左侧下标 `text`；当前格 `color:"blue"`，来源格 `color:"orange"`，转移 `connector`（可 `label` 写转移式） |
| 图 / BFS / 拓扑（200、207、994） | `ellipse` 结点 + `connector`（有向 `"end"` / 无向 `"none"`）；已访问 `color:"green"`，队列中 `color:"orange"` |
| 状态机（121/309、10） | `ellipse` 状态 + `connector` 转移，转移 `label` 写触发条件；当前状态 `color:"blue"` |

**F. 落层与生命周期**

- AI DSL 完整编译后原子替换 `scene.overlay`；失败保留旧覆盖层。图元库成功编译产物插入手绘层（§5.1）；二者共用编译器但落层不同。
- 历史加载仍过本节防御性管线；新编译产物遵守严格后置检查，不以丢弃 IR 元素实现 partial。
- 覆盖层与绘制层**同构**、共用同一渲染管线 → 视觉与手插图元库一致。

**G. 维护约束（图元库 ↔ 契约 ↔ spec 同步，硬性）**

- `src/panel/whiteboard/presets.ts` 的 `WB_PRESETS`、本节 A–D、§5.1 模板表**三者同源**：任一处改动（模板增删、参数范围/默认值、生成尺寸/间距、箭头/连线样式、语义色用法）**必须同时更新其余两处**。
- 新增/修改模板时，`toStructure()` 满足 DSL 契约，编译产物满足 A/B 与健壮性契约的严格后置条件；不新增元素类型、不改渲染管线。确需扩展模型时先改 §4.2。
- 本条为流程约束（非机器检查，不同于 `check:theme`），Review 时按 `AGENTS.md` §4.5 逐条核对。

### 4.5 紧凑化与 100KB 目标

坐标取整（保留 1 位小数）、path 抽稀（simplify-js，tolerance ≈ 1.0）、语义 id 短字符串。保存时估算压缩后大小，超过 100KB 弹一次轻量提示（toast）告知"本题画板数据偏大，建议清理无用笔迹"，不阻断保存、不自动删用户数据。

### 4.6 语义 DSL 与编译器（作图的唯一入口）

> [程序化作图契约与健壮性规范](diagram-contract.md) 是本节的规范性组成部分，2026-10-19 用户接受推荐后为 Confirmed；定义 DSL v2、分区校验、标注能力、预算与验收。§10 为确认记录，不再是待确认清单。文档定义目标，不代表代码已完成。

> 本模块保持 In Progress；健壮性专项已 Confirmed。代码需按 v2 更新，已有持久化 IR 不因 DSL 升级失效；04/07 其余 UI/通信未决项不随本次确认自动定稿。

**目标与解耦承诺**：白板程序化作图收口为 **语义 DSL → 编译器 → `WBElement[]`（IR）→ 渲染**。图元库与 AI 共用这条路径；同一 DSL、编译版本与配置产生一致几何（允许随机元素 ID 不同）。视觉优化只改编译器；新增语义或修正歧义须同步版本策略、Schema 与提示词，不能以旧“冻结契约”为由保留错误语义。

```
[图元库参数] ┐
             ├─▶ DSL（语义层，稳定、版本化，dslVersion=2）
[AI 输出]    ┘        │
                       ▼  编译器（本地受控）
              Schema → 语义校验 → 默认值归一化
                       ↓
              layout+anchors → annotations → 严格 IR 检查
                      │
                      ▼
                WBElement[]（IR §4.4） ──▶ 渲染器
```

**DSL v2（语义，不含任何坐标/尺寸/颜色字面量）**：

```ts
interface LlmDiagram {
  dslVersion: 2;
  caption?: string;
  structures: DslStructure[];      // 可多个，编译器自动排布（默认纵向堆叠、居中）
  annotations?: DslAnnotation[];
}
type DslValue = string | number | null;
type ColorName = "default" | "red" | "blue" | "green" | "orange"; // 语义色
interface DslBase { id?: string; name?: string } // id 供标注引用（缺省由编译器分配 s0/s1…）；name 图上显示的结构名

type DslStructure =
  | DslBase & { kind: "array";    items: DslValue[]; indexed?: boolean }
  | DslBase & { kind: "matrix";   rows: DslValue[][]; rowHeaders?: DslValue[]; colHeaders?: DslValue[] }
  | DslBase & { kind: "map";      entries: { key: DslValue; value: DslValue }[]; header?: boolean } // 键值表/哈希
  | DslBase & { kind: "linkedList"; nodes: { id?: string; values: DslValue[] }[];          // 每结点可多值
               doubly?: boolean; circular?: boolean }
  | DslBase & { kind: "stack";    items: DslValue[] }
  | DslBase & { kind: "queue";    items: DslValue[]; deque?: boolean }
  | DslBase & { kind: "bucket";   buckets: DslValue[][] }
  | DslBase & { kind: "barChart"; values: number[]; labels?: DslValue[] }
  | DslBase & { kind: "tree"; variant: "binary"; root: DslBinaryNode | null }
  | DslBase & { kind: "tree"; variant: "nary"; root: DslNaryNode | null }
  | DslBase & { kind: "heap";     values: DslValue[]; showArray?: boolean }                 // 数组表示 → 完全二叉树
  | DslBase & { kind: "graph";    nodes: { id: string; label?: DslValue }[];
               edges: { from: string; to: string; label?: DslValue; weight?: number }[];
               directed?: boolean }
  | DslBase & { kind: "stateMachine"; states: { id: string; label?: DslValue }[];
               transitions: { from: string; to: string; label?: string }[];
               initial?: string; accepting?: string[] };

interface DslBinaryNode { id?: string; value: DslValue; left?: DslBinaryNode | null; right?: DslBinaryNode | null }
interface DslNaryNode { id?: string; value: DslValue; children?: DslNaryNode[] }
```

**标注（过程态）——锚到语义位置，不锚坐标**（解耦命门）：

> 标注的职责、能力表、已确认的范围/冲突/层序规则见 [健壮性契约 §4.3](diagram-contract.md#43-标注专项约定)。window 仅数组 cell 闭区间、矩阵 cell2 闭矩形；其他锚点能力依该表，不任意组合。

```ts
type DslAnchor =
  | { struct: string; at: "cell";  index: number }          // 一维第 index 格
  | { struct: string; at: "cell2"; row: number; col: number } // 二维格
  | { struct: string; at: "node";  id: string };           // 链表/树/堆/图/状态机结点；v2 不开放 gap

type DslAnnotation =
  | { kind: "pointer";   anchor: DslAnchor; label: string; color?: ColorName }
  | { kind: "highlight"; anchor: DslAnchor; color?: ColorName }
  | { kind: "window";    from: DslAnchor; to: DslAnchor; label?: string; color?: ColorName }
  | { kind: "note";      anchor?: DslAnchor; text: string; color?: ColorName };
```

**标注解析的默认策略**（DSL 只给语义位置，摆放由编译器决定；2026-10-12 P2 定稿）：

- `pointer`：在锚点 box **正下方居中**（间距 `POINTER_GAP=34`，留出数组下标行等）放 `text`，并生成一条**自由端点 `connector`**（`arrowhead:"end"`）从文字指向锚点底边；
- `highlight`：在锚点 box 上**覆盖一个同尺寸描边图形**（锚点为椭圆则用 `ellipse`，否则 `rect`）——视觉上"该处变色"，**不修改原元素**、无需元素 id；
- `window`：先按已确认范围规则解析目标实体，再对**全部目标的最终 box**取包围盒并外扩 PAD=6；有 label 时置于框上方。只有在布局与范围允许时才可用两端 box 简化，不能漏掉中间项；具体范围能力见补充规范 §4.3/§10。
- `note`：有锚点 → 锚点 box **下方第二车道**（指针文字再下 `NOTE_LANE=30`）；无锚点 → 整体包围盒**下方**；
- `caption`（图级）：**最后渲染**，置于"含标注"的整体包围盒**上方居中**（字号 18）——保证不与窗口标签/批注挤在一处；
- 摆放策略是**启发式车道**（避让数组下标行、把 pointer/note/caption 分层）；**并不能保证任意复杂组合都不重叠**，后续可加通用避让；
- 颜色缺省取当前新建默认色；单条标注字段/锚点非法 → 整条跳过、记结构化诊断并报告 partial；内部编译异常不适用此容错，须整图 error。

**编译器流水线**：
1. 预算预检 → Schema 分区校验 → 语义校验；主体错误立即 error，不调用 builder；非法标注按条隔离。
2. 仅补已定义默认值，生成可信内部类型；builder 产完整主体元素及锚点，拒绝重复 ID/key。
3. 在暂存区编译有效标注；内部异常整图失败，不伪装成标注输入错误。
4. 汇总布局、严格 IR 后置检查 → 返回 `CompileResult`（补充规范 §5.2）；partial 仅表示非法标注被跳过。
5. 调用方校验题目/请求生命周期，居中后的批次复查几何边界后一次提交；error 保留旧图，不改视口或撤销栈。

**锚点表是布局层与标注层之间的唯一接口**：改 builder 的几何（尺寸/间距/朝向）只改 builder 内坐标，锚点 key 不变 → 所有标注自动落对位置。

**与图元库的统一（方案甲）**：`presets.ts` 的布局**下沉**到 `dsl/builders/`；左栏模板参数只负责"填一个空值 DSL 结构"，插入 = `compileDiagram`。DSL 的 12 个 `kind` 与左栏 12 模板一一对应。`WBPreset` 保留 UI 元数据（id/name/group/params），其 `build` 改为 `toStructure(params) → DslStructure`。

**模块划分**（`src/panel/whiteboard/dsl/`）：

```
schema.ts       # 公开类型/版本，与可执行 JSON Schema 保持同源
validate.ts     # 分区结构校验、语义引用、范围/预算、默认值归一化
anchors.ts      # 锚点类型 + 注册表
engine.ts       # 排布 + 编译编排
builders/*.ts   # 12 结构：array/matrix/map/linkedList/tree/heap/graph/stack/queue/bucket/barChart/stateMachine
annotations.ts  # pointer/highlight/window/note 解析
index.ts        # compileDiagram(unknown) -> CompileResult（补充规范 §5.2）
```

**落层**：编译器纯计算、不修改场景。AI 成功结果原子替换 `scene.overlay`，图元库成功结果插入 `scene.elements`；失败不提交。覆盖层独立 Konva Layer（`listening=false`），共用 view 变换；显式清空与失败是不同操作。

**扩展性（对应"改图不动 LLM"）**：

| 动作 | 改动位置 | 动 DSL/提示词？ |
|---|---|---|
| 改结构尺寸/间距/朝向/箭头样式 | `builders/*` 或样式常量 | 否 |
| 改标注视觉 | `annotations.ts` | 否 |
| 新增结构 | 加 DSL `kind` + builder + 提示词一句 | 是（罕见） |
| 新增标注 | 加 `DslAnnotation` + 解析器 + 提示词一句 | 是（罕见） |

**维护约束**：DSL `kind` 集合、`builders/*`、§5.1 模板表三者同源；改动同步（并入 §4.4 G）。

## 5. UI / 交互（Agent 初版设计稿，待用户看效果后提修改意见）

### 5.1 工具栏（按用户 mockup：顶部工具行 + 左侧常用图形竖条）

顶部工具行（画布顶部单排）：

```
[选择 V][画笔 P][矩形 R][圆形 O][连线 A][文本 T] │ [撤销][重做] │ [清空]
```

- 属性条**常驻**（顶部工具行下方细条）：颜色点 5 个（黑/红/蓝/绿/橙）+ 线宽 3 档（细/中/粗）；**选中任意元素时，颜色/线宽直接作用于它**，未选中时设置"新建默认值"；**连线工具激活或选中连线时，追加箭头样式选择器**（无/→/←/↔）。常驻是为了避免切换工具时工具栏忽隐忽现的突兀感（2026-09-22 用户反馈）。
- **左侧图标条 → 数据结构图元库**（2026-10-12 定稿，详见 `record/meta-ds-method.md`）：面向刷题快速搭建"数据结构 + 过程"草图。
  - **形态（方案 A，用户定）**：窄图标条（宽 52px），**分组卡片 + 单级滚动**：分「线性 / 二维 / 层级 / 关系」四组，每组一张卡片（小标题 + 图标）；图标悬停显示 tooltip（模板名）；容器底部**渐隐遮罩 + 下箭头**提示可滚动（滚到底隐藏）；滚动条主题化细条。UI 走 `--la-*` token，须美观。
  - **图标**：内联 SVG（24×24，`currentColor`，随主题），不引图标库。
  - **模板参数**（数字参数用**可加减数字框**含 min/max；二值用开关；图**无参数直接插入**）：

    | 组 | 模板 | 数字参数（默认；范围） | 开关（默认） |
    |---|---|---|---|
    | 线性 | 序列 | 格数 8（1–32） | 下标 开 |
    | 线性 | 柱状图 | 柱数 6（1–16） | 高度递增 开 |
    | 线性 | 链表 | 结点数 4（1–10）/ 每结点值数 1（1–4） | 双链 关 / 环形 关 |
    | 线性 | 栈 | 格数 5（1–10） | — |
    | 线性 | 队列 | 格数 5（1–10） | 双端 关 |
    | 二维 | 表格/网格 | 行 3、列 4（各 1–12） | 行表头 关 / 列表头 关 |
    | 二维 | 键值表（哈希） | 行 4（1–12） | 表头 开 |
    | 二维 | 桶 | 桶数 5（1–10）/ 容量 3（1–6） | — |
    | 层级 | 树 | 层数 3（1–4）/ 分支数 2（2–4） | — |
    | 层级 | 堆 | 层数 3（2–4） | 数组行 关 |
    | 关系 | 图 | （固定 4 圆环，无参数） | — |
    | 关系 | 状态机 | 状态数 4（2–6） | — |

  - **生成尺寸/间距**（世界坐标，§4.4 几何 seam）：通用方格 44；链表结点 = 值数×40 宽 × 30 高（每值一格）；树/图结点圆 ⌀44（状态机 ⌀48）；字号 16；树/堆层距 72、同层距 24。
  - **链表细节**：结点可含多个值格（参数"每结点值数"，默认 1）；**连线按"就近格"绑定**——选中心最靠近目标结点的那一格，距离相同时取"环外侧"格（使环形里方向反转的边也朝向对方，箭头不斜穿）；**环形时结点沿矩形绕行排布**（上排 L→R、下排 R→L）；**双链用同一条连线的双向箭头（`arrowhead:"both"`）**，不再另加反向连线。
  - **插入流程**：点图标 →（有参数）**画板居中参数窗** → **构造一个空值 DSL 结构**（§4.6）→ `compileDiagram` → 定位视口中心 → 自动全选 → 切选择态 → 一步撤销。
  - **实现**：模板参数只用于"填 DSL 结构"（`WBPreset.build` → `toStructure`）；几何尺寸/间距全部由 `dsl/builders/*` 决定（§4.6）。不引入新元素类型（§4.4 IR 契约）；"整体操作"（移动/缩放/删除）由 §5.4 的**通用多选**承担，不引入 `groupId`。
- 画布右下角：缩放比例显示（如 `100%`）+ 点击复位视图按钮。
- "清空"需要二次确认弹窗（防误触丢数据）。
- **背景网格三样式**（2026-09-21 用户确认）：点阵（默认）/ 线格 / 无网格，入口在 01 骨架预留的"白板设置"popover（该 popover 的第一个真实内容）；`gridMode` 为全局设置（不按题），持久化 `chrome.storage.local`；网格颜色随主题。实现顺序上排在核心绘图功能之后。
- 白板区为面板左栏，默认占比约 55%–60%（拖 01 的中间分隔线可调），画布保持常规画图比例。

### 5.2 快捷键与鼠标行为（第一版范围）

| 操作 | 绑定 |
|---|---|
| 选择 / 画笔 / 矩形 / 圆形 / 连线 / 文本 | `V` / `P` / `R` / `O` / `A` / `T` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Shift+Z` |
| 框选多选 | 选择态空白拖动；`Shift` + 拖动（任意工具态）；`Shift`/`Ctrl` + 点击 加选/减选（2026-09-22） |
| 删除选中元素 | `Delete` 或 `Backspace`（作用于整个选中集合；选中不限于选择态：**除画笔外任意工具单击图形即选中**） |
| 复制 / 粘贴 / 克隆 | `Ctrl+C` / `Ctrl+V` / `Ctrl+D`（Office 风格；单个与多选通用，2026-09-22） |
| 快速文字输入 | 鼠标右键（拦截默认菜单） |
| 缩放 | 滚轮（光标为中心，范围 10%–400%） |
| 平移 | Space + 鼠标拖动 |

**快捷键/鼠标门控（2026-09-21 补充，重要交互约束）**：上述所有快捷键与 Space 平移仅在**指针悬停于画布区域**时生效，且文本编辑进行中屏蔽工具切换快捷键——避免与 LeetCode Monaco 编辑器按键冲突（用户在代码里按 Delete / Ctrl+Z / Space 时绝不能误伤画板）。实现方式：跟踪画板 hover 状态作为所有快捷键的总开关。

- **Shadow DOM 与输入法门控**：window 级 keydown 使用 composedPath 检查真实路径；input/textarea/select 与实际可编辑 contenteditable 区域内不触发画板命令，不能仅依赖被重定向后的 event.target。已 defaultPrevented、isComposing 或输入法兼容键码 229 的事件让行。keyup 仍可复位已按下的 Space，不因编辑门控卡住状态。Chrome/Edge 分别验证输入控件、Monaco 与中文输入法，正常画布快捷键保持有效。

**文本编辑入口（2026-09-21 用户定；2026-09-22 扩展到图形 label）**：非选择态**双击**文本/矩形/椭圆进入编辑；选择态"点击出现边框后再点击"进入编辑（见 §5.4）；**新画完矩形/椭圆自动进入 label 编辑**（Esc/点外部空提交 = 跳过，图形保留）；右键快速输入保持有效（仍是独立文本）。

**绑定可配置预留（2026-09-21 用户提）**：所有"键/鼠标动作 → 行为"映射集中在 `whiteboard/bindings.ts`（默认绑定 + `chrome.storage.local` 的 `wbBindings` 用户覆盖，工具键 tooltip 从配置反推），为后续"用户自定义快捷键/右键行为"设置页留口，新增时无需改交互代码。

**主题适配（2026-09-21 补充）**：画布纸面色、网格色随主题（`--la-*` token 对应的 JS 值，theme.ts 导出）；图形颜色即 4.2 语义色，主题切换时全量重渲染自动跟随，无需迁移数据。

### 5.3 画板分层

- `背景层`：网格等静态内容，不重绘；
- `绘制层`：用户手绘内容；
- `覆盖层`：程序化生成元素（未来 AI 作图 / trace 高亮），可整体清空/重绘，不污染手绘内容。

### 5.4 选中与变换

- 使用 Konva `Transformer`（`rotateEnabled: false`）；**选中即显示边框 + 缩放手柄，绘制态与选择态表现一致**。
- **选中与拖动交互模型**（2026-09-22 用户定稿）：
  - **画笔态**：任何元素**不可拖、不可选**（修"画笔写字误拖已有笔画"），且起笔允许落在已有图形上（画笔不检查命中目标）；
  - **其他工具（矩形/圆形/文本/选择）**：① 单击图形 → **选中**（出现边框 + 缩放手柄）；② 选中后可**拖动**、可拖**手柄缩放**；绘制工具在**空白处**按下仍**起笔新建**，命中已有图形则让位给选中/拖动（`e.target !== stage` 守卫仅绘制工具保留）；
  - **连线工具特殊**：连线态下元素**不可直接拖动**（拖拽语义 = 从图形拉出连线，与"拖动图形"冲突）；仍可单击选中、按 `Delete` 删除、改箭头样式；需要移动图形时用选择态/其他绘制工具（与 draw.io 的连接工具一致）。
  - **删除**：任意非画笔工具下单击选中后，直接按 `Delete`/`Backspace` 删除（**不必切到选择态**）；
  - **编辑入口**：选择态"点击→边框→**再点**"进入编辑；绘制态**双击**进入编辑（见下方）；绘制态第二次单击**只重新选中**、不进入编辑；
  - **拖动阈值**：元素拖动设 `dragDistance = 3px`——小幅抖动视为"点击"（用于选中），超过阈值才算拖动，避免"点不中"；
  - Space 平移中一律禁拖/禁选（平移优先）；
  - 拖动结束后紧随的 click 被忽略（`justDragged` 守卫）。
- **文本/label 编辑入口**：选择态"点击→边框→再点"进入编辑（文本=改文字；矩形/椭圆=改 label；**连线=改连线标签**）；绘制态**双击**文本/带文字的图形/连线进入编辑；新画完矩形/椭圆自动进入 label 编辑（右键快速输入始终可用，创建独立文本，见 §5.2）。label 编辑中图形保持显示、原文字隐藏（textarea 覆盖在图形中心；连线标签则覆盖在连线中点）；**提交空内容只移除 label，不删元素**（与独立文本"空=删除"语义不同）。
- **连线的创建与端点重绑定**（2026-09-22 用户定稿，V1）：
  - **创建**（连线工具）：从图形上按下拖到另一个图形松开 = 绑定连线（两端绑定）；落在空白 = 该端自由（半绑定）；两端都自由 = 自由连线（等同于原直线/箭头能力）。拖动中命中可绑定图形时给**吸附高亮**提示。
  - **选中连线**：**不出 Transformer 缩放手柄**（端点由所连图形决定，缩放无意义），改为显示**两个端点圆手柄**。
  - **端点重绑定**：拖端点手柄 → 命中另一图形松开 = 改接该端；落在空白 = 脱开为自由端；`from === to`（自连）忽略。拖动中同样有吸附高亮与幽灵线预览。
  - **实时跟随**：拖动/缩放图形时，绑定到它的连线在拖动过程中**实时跟随**（命令式更新 Konva 节点，不走 React state），松手后以数据为准重渲染。
  - 绑定目标的判定按**包围盒命中**（矩形/椭圆/文本），不看描边热区。
- **多选（框选）与整体操作（2026-09-22 确认）**：选中状态由"单个"扩展为"集合"。
  - **框选**：**选择态**下空白拖动拉橡皮筋；**`Shift`+拖动**在**任意工具态**也可框选（绘制态不冲突）。选中与橡皮筋相交的元素。
  - **加选/减选**：`Shift`/`Ctrl`+点击 切换某元素；框选默认**替换**当前选中（`Shift`+拖动为累加）；无修饰键点击已选元素 = 收缩为"仅此元素"。
  - **整体移动**：拖动选中集合中任一元素 = 整体平移（**舞台级自定义手势 + 数据驱动**：按"原始几何 + 位移"重算整组写回数据，绑定连线随之重解析；拖动中实时、松手一次提交 = 一步撤销）。**不使用 Konva 原生拖拽**（其 Transformer 自带"代理拖拽"会与数据驱动移动抢节点、导致选中框闪烁）。
  - **整体缩放**：Konva `Transformer` 挂多个节点，缩放**整组一次性提交**；`Transformer` 仅在**选中集合变化**时重设 `nodes`，几何变化用 `forceUpdate()` 刷新框（避免每帧 detach/attach 抖动）。
  - **整体删除 / 复制 / 粘贴 / 克隆**：`Delete` 删全部；`Ctrl+C`/`Ctrl+V`/`Ctrl+D` 复制/粘贴/克隆（Office 风格，单个与多选通用；克隆时连线按新 id 重映射，两端都在集合内才保留绑定）。
  - **单选编辑语义不变**：恰好选中一个时，选择态"再点"仍进入文本/label 编辑；多选时不触发编辑。连线端点手柄仅在**恰好选中一条连线**时显示，`Transformer` 不挂连线。

## 6. 依赖

- 依赖的其他 spec：02-storage（持久化）、01-extension-shell（SPA 切题检测提供 problemId 广播、主题 token 体系）
- 依赖的第三方库：`konva`、`react-konva`（主版本与 React 18 匹配）、`simplify-js`（画笔抽稀）、`lz-string`（压缩）
- 键盘/鼠标交互必须与 LeetCode Monaco 编辑器隔离（见 5.2 门控约束）

## 7. 验收标准

- [ ] 能自由绘图、加连线/矩形/圆形/文本，能拖拽、缩放、撤销/重做、清空（清空有二次确认）。
- [ ] 鼠标右键点击画板空白处直接进入文字输入，不弹默认右键菜单。
- [ ] 滚轮缩放、Space+拖动平移工作正常。
- [ ] **快捷键门控生效**：指针不在画布区域（如在 Monaco 中打字）时，Delete/Ctrl+Z/Space 等不影响画板。
- [ ] 编辑停止 1 秒后自动保存；切题/刷新后内容正确恢复（依赖 01 的 SPA 切题检测）。
- [ ] 单题画板压缩后存储 ≤ 100KB；超限时有一次性提示且不阻断保存。
- [ ] 覆盖层可被程序整体清空并批量重绘（同构 WBElement[]），不影响绘制层。
- [ ] **主题适配**：深/浅主题切换后，画布底色、网格、已有图形（语义色）均正确跟随，无"黑纸黑线"。
- [ ] 网格三样式（点阵/线格/无）可在白板设置 popover 切换并持久化。
- [ ] **图形内文字**：新画矩形/椭圆自动进入 label 编辑；双击/选择态再点可重编辑；文字居中、颜色随图形、移动图形文字跟随；label 超框时图形自动撑大；提交空内容只删 label 不删图形；拖动图形仍从边缘/文字热区起。
- [ ] **绘制态可选中删除**：除画笔外任意工具单击图形即选中（出边框+缩放手柄，与选择态一致），直接 `Delete` 删除；小幅抖动仍算点击（`dragDistance=3`）。
- [ ] **连线**：从图形拖到图形建立绑定连线；移动/缩放所连图形时连线端点自动跟随；箭头四样式（无/正向/反向/双向）可设；选中连线出两个端点手柄，拖端点可改接到别的图形或脱开为自由端；连线中点可写标签（双击/选择态再点编辑）；删除被连图形后连线冻结在原位不崩溃；半绑定与自由连线可用。
- [ ] **多选（框选）与整体操作**：选择态空白拖动框选；`Shift`+拖动任意工具态可框选；`Shift`+点击加选/减选；拖动任一选中元素整体平移；缩放手柄整体缩放（一次性提交）；`Delete` 删全部；`Ctrl+C/V/D` 复制/粘贴/克隆（单个与多选通用）；属性条颜色/线宽作用于全部；绘制态不受影响；恰好选中一个时"再点编辑"仍有效。
- [ ] **数据结构图元库**（12 模板 × 4 组）：左栏窄图标条点模板 → 有参数者弹**画板居中参数窗**（数字步进框 + 开关）→ **构造空值 DSL 结构并编译**为元素并**自动全部选中**、**切到选择态**、**定位视口中心**；图（固定 4 圆环）无参数直接插入；可立即拖动整体摆位或再框选/手动增删；一次插入 = 一步撤销；结点文字留空；不引入复合类型/`groupId`；主题/连线跟随一致；左栏分组卡片、可滚动且有滚动提示、图标随主题。
- [ ] **语义 DSL + 编译器**（§4.6）：`compileDiagram(dsl)` 能把 12 种结构的 DSL 确定性编译为 `WBElement[]`（IR 满足 §4.4）；两种输入（图元库空值结构 / 含值+标注的 DSL）产出一致风格；**标注锚到语义位置**——改变 builder 的尺寸/间距/朝向后，指针/窗口/高亮仍正确落位（无需改 DSL）。
- [ ] **图元库与 DSL 统一（方案甲）**：左栏插入与 `compileDiagram` 走同一编译器，重构后**视觉与既有实现一致**（无回归）。
- [ ] 常规绘图交互无明显卡顿（页内悬浮面板场景，定性验收）。
- [ ] **健壮性契约**：[补充规范](diagram-contract.md) §9.1 自动化矩阵通过：主体非法拒绝、非法标注按条 partial、结构化诊断、资源有界、内部异常受控、IR 严格后置检查、失败保留旧图及过期请求不回写。
- [ ] Schema/类型/提示词/示例统一为 v2；图元库走同一入口；新产物不以删边、截断、补 ID 或 sanitize 降级成功；旧 v1 载荷明确拒绝、既有 IR 场景正常恢复。
- [ ] **标注专项验收**：能力表/锚点一致；合法引用缺锚点为内部失败；范围按全部实体计算；多指针、局部/图级 note、标题避让、冲突与布局诊断按补充规范 §4.3 测试。

## 8. 待确认问题

多选（框选 + 整体操作，含复制/粘贴/克隆）已实现（见 §5.2/§5.4/§9）。

1. ~~**数据结构图元库落地细节**~~ → 2026-10-12 已全部确认：模板清单收敛为 **12 个 × 4 组**（去掉"基础结点"——矩形/圆形工具已覆盖；去掉坐标轴/坐标系——手绘），每个模板的参数/默认值/尺寸见 §5.1；插入锚点 = **视口中心**；数字参数用范围数字框、二值用开关；图无参数直接插入。实现细节见 `record/meta-ds-method.md`。
2. **标记类图元**（指针/高亮/下标等小标注）：已确认**后置**，本轮不做。
3. 其他多选增强（`Ctrl+A` 全选、`Esc` 取消选中、对齐/分布）暂不做，需要时再加。
4. ~~DSL 协议细节~~ → 2026-10-19 已按推荐确认，见 [契约 §10 确认记录](diagram-contract.md#10-协议细节确认记录)。

## 9. 变更记录

| 日期 | 修改内容 |
|---|---|
| 2026-10-19 | 快捷键门控修复：通过 composedPath 识别 Shadow DOM 内编辑控件，输入法组合及已处理事件让行；保留 Space keyup 复位，增加 Chrome/Edge 手工验证路径 |
| 2026-10-19 | 用户接受推荐方案，专项 Confirmed；主 spec 同步 DSL v2、binary left/right、必填 variant、空树与无 gap 的锚点联合、确认记录及验收 |
| 2026-10-15 | 补充标注专项规范入口及验收，明确 window 几何依据完整语义范围而非任意两端点 box；新建议的能力/组合规则保持待确认 |
| 2026-10-15 | 用户确认健壮性策略；新增 diagram-contract.md 作为 §4.6 规范性补充，定义分区校验、主体严格/标注容错、结构化结果、预算、IR 后置检查、原子提交和测试；同步图元库 toStructure 接口与落层说明；未讨论语义单列待确认 |
| 2026-09-12 | 根据总体规划文档整理出初稿 |
| 2026-09-13 | 调研并将默认技术方案从 tldraw 改为推荐 Excalidraw（备选 Fabric/Konva 自建） |
| 2026-09-15 | 最终确定画板库为 Konva + react-konva，记录选型理由 |
| 2026-09-15 | 确认全部待确认问题：UI 由 Agent 出初版设计稿（工具栏/快捷键/分层）、交互范围（右键=文字/滚轮缩放/Space 平移）、单题存储 ≤100KB、自动保存防抖 1s；AI 作图明确不做进第一版；状态改为 **Confirmed** |
| 2026-09-15 | 按用户 mockup 调整布局：画板作为统一面板左栏（顶部工具行 + 左侧常用图形竖条），默认占比 55%–60% |
| 2026-09-21 | Phase 2 启动（用户确认）：① §4 重写为**自定义元素模型**（语义色/线宽 id，替代 `stage.toJSON()`，含 LLM 程序化生成契约与校验管线，世界坐标与视图分离）；② 网格三样式（点阵/线格/无）进白板设置 popover，排在核心功能之后；③ 新增快捷键 hover 门控与主题适配约束；④ 目录修正为 `src/panel/whiteboard/`（sidepanel 已废弃）；⑤ 状态 → In Progress |
| 2026-09-21 | §5.4 交互模型定稿：非选择态边缘拖动、选择态仅选中+变换；网格渲染改单 Shape sceneFunc 直绘 canvas（修"缩到 20% 变卡"：原每点一节点的方案在小缩放比下节点数爆炸）；修复拖拽坐标换算错误（Konva 拖拽后节点位置已是新位置，误当位移量二次叠加导致反向/跑偏） |
| 2026-09-21 | 文本编辑入口定为"非选择态双击"（选择态文本与图形行为一致）；交互绑定集中到 bindings.ts（用户自定义快捷键/右键行为的预留，用户提出） |
| 2026-09-21 | §5.4 交互模型定稿：绘制态完全禁拖（修画笔误拖笔画）；选择态"点击出边框→可拖动/缩放→再点文本进入编辑"，加 justDragged 守卫防拖后误编辑 |
| 2026-09-21 | 修复"画笔无法在已有笔画上起笔"：绘制工具取消 `e.target !== stage` 守卫（该守卫是旧拖动模型的遗留，绘制态禁拖后已无必要，反而被 12px hit 热区误伤）；文本工具保留守卫；画笔增加最小路径过滤防双击杂点（详见 record/problem-in-develop.md） |
| 2026-09-22 | §5.4 拖动模型修正（上一条的过界回归）：禁拖仅限**画笔态**；矩形/圆形/箭头/文本态恢复"按住已有图形直接拖动"（边缘热区/整块），且这些工具新建只在空白处起笔（守卫按工具区分保留）；movable 改分工具判定，Space 平移中一律禁拖 |
| 2026-09-22 | 新增**图形内文字 label**（§4.2/§4.4/§5.2/§5.4）：rect/ellipse 可选 `label`（+缺省字号 16 的 `labelSize` 预留字段），节点=单元素；三编辑入口（画完自动/双击/选择态再点），空提交仅删 label，超框自动撑大；§4.4 补 `getElementBounds`/`estimateTextSize` 统一几何 seam（为连线锚点、图元库预留，避免日后重构） |
| 2026-09-22 | §5.4 选中模型放宽：**除画笔外任意工具单击图形即选中**（出边框+缩放手柄，绘制态与选择态一致），可直接 `Delete` 删除，免去"切选择态才能删"；绘制态编辑仍走双击、第二次单击只重新选中；元素拖动加 `dragDistance=3px` 阈值（小抖动算点击）；点空白清除选中改为全工具通用 |
| 2026-09-22 | 修复"缩放 path/arrow/line 导致图形位置漂移"：`onElementTransformEnd` 已把变换位移并入绝对 points，却漏了把节点位移归零（`onElementDragEnd` 有归零、transform 漏），重渲染时 points 与残留位移叠加 → 整体偏移；补 `node.position({x:0,y:0})`（rect/ellipse/text 的 x/y 即元素坐标，不归零）。详见 record/problem-in-develop.md |
| 2026-09-22 | 新增**连线 connector**（§4.2/§4.4/§5.1/§5.4）：`arrow`+`line` 合并为 `connector`（`points` 自由端字面值 + 可选 `connects{from,to}` 按 id 绑定 + `arrowhead` 四样式 + `label` 中点标签）；锚点自动朝向对方（`resolveConnectorPoints`/`bboxBoundaryPoint` 纯函数复用几何 seam）；可绑定目标=矩形/椭圆/文本；绑定端渲染时解析、图形移动实时跟随；选中连线改为两个端点手柄（不出 Transformer），拖端点可改接/脱开；创建=连线工具拖拽（绑定/半绑定/自由）+ 吸附高亮；本机无持久化数据故无迁移，sanitize 兼容映射旧 `arrow`/`line` 词汇 |
| 2026-09-22 | 连线验收修复（用户反馈 4 项）：① 箭头四样式失灵——Konva 属性名应为 `pointerAtEnding`（误写 `pointerAtEnd` 被静默忽略，终点箭头恒为默认 true）；② 删除被连图形导致端点跳变——删除前把指向它的端点**冻结**为当前解析坐标再解绑；③ 绑定命中加 `BIND_MARGIN=14` 容差（不必严格落在图形内）；④ 属性条改**常驻**且选中任意元素时颜色/线宽直接作用于它（消除切换工具时工具栏忽隐忽现） |
| 2026-09-22 | 连线标签可读性：标签下加**纸面色底**（`WB_CANVAS_BG`，与画布 `--la-surface` 一致）盖住穿过的连线，等价于"有文字处断开连线" |
| 2026-09-22 | 修复"拖动连线时标签/端点手柄不跟随"：连线视觉（线+标签底+标签文字）包进一个可拖 `Group` 一起移动（ref 仍在内层 Arrow 上供命令式改 points）；拖动该连线期间隐藏端点手柄，松手后在新区位恢复 |
| 2026-09-22 | 修复"移动被连图形时连线标签不跟随"：实时跟随时除更新 Arrow `points` 外，同步命令式更新标签底/文字到新中点（`updateConnectedConnectors`），与拖动连线的跟随逻辑保持一致 |
| 2026-09-22 | 补齐"移动被连图形时端点手柄不跟随"：选中连线显示的端点手柄注册节点，实时跟随时命令式同步到新端点坐标（此前只跟了线/标签，漏了手柄） |
| 2026-09-22 | 修复端点重绑定后的连锁问题：① 重绑松手后紧跟的 click 会误落到目标图形、把选中切走（表现为目标图形出现 Transformer 边框、连线失去选中）——重绑结束置 `justDragged` 守卫忽略该 click；② 手柄跟随改为"手柄节点存在即更新"，不再依赖选中判定 |
| 2026-09-22 | **规划数据结构图元库**（§4.4 契约 + §5.1 左栏 + §7 验收 + §8 待确认）：类型收敛为"正交模板 × 参数 × 标记"（节点/序列/表格/链/树/图/容器/过程元图元/标记/轴）；V1 采用"**起点模板 + 智能续接**"，全部宏展开为现有元素、不引入复合类型；整体移动/增删行列留作阶段二（`groupId`）。详见 `record/meta-ds-method.md` |
| 2026-09-22 | **图元库方案再修订（用户改变想法）**：放弃"结构组 + 改参数重建"（撤回 `groupId`/`scene.groups` 与结构菜单），改用**通用"框选多选 + 整体操作"**——选择态空白拖动框选、`Shift` 加选、整体移动/缩放/删除；图元库仍为"9 模板 + 插入参数弹窗 + 插入后自动全选"，**数据模型零改动**（§4.2/§4.3/§4.4 回退，§5.1/§5.4 更新）。剩余 4 个小问题见 §8 |
| 2026-09-22 | **实现多选与整体操作**（§5.2/§5.4）：选择模型 `selectedId` → `selectedIds` 集合；框选（选择态空白拖动 + `Shift`+拖动任意工具态）+ 橡皮筋渲染；`Shift`/`Ctrl`+点击加选；整体移动（拖动中命令式同步整组 + 松手一次提交）；整体缩放（`Transformer` 多节点，**整组一次性提交**，避免每节点各写历史）；`Delete` 删整组；`Ctrl+C/V/D` 复制/粘贴/克隆（含连线按新 id 重映射）；属性条作用于整组；单选"再点编辑"与端点手柄语义保持。全键盘绑定进 `bindings.ts` |
| 2026-10-12 | **数据结构图元库定稿**（§4.4 契约 + §5.1 左栏 + §7 + §8）：模板收敛为 **12 个 × 4 组**（线性/二维/层级/关系），去掉"基础结点"（矩形/圆形工具已覆盖）与坐标轴/坐标系（手绘）；左栏为**窄图标条 + 分组卡片 + 单级滚动**（底部渐隐+下箭头提示），内联 SVG 图标随主题；插入流程 = 画板居中参数窗 → 定位视口中心 → 自动全选 → 切选择态 → 一步撤销；数字参数用范围步进框、二值用开关、图无参数直接插入；结点文字留空；数据模型零改动（无 `groupId`） |
| 2026-10-12 | 左栏悬停改**自定义气泡**（即时、走 token、显示参数提示），替代原生 title；§4.4 新增 **LLM 程序化输出契约细则**（A 硬性规则 / B 元素模式 / C 尺寸样式约定 / D 过程标注配方 / E 分题型配方 / F 落层 / **G 维护约束：图元库↔契约↔spec 三者同步**）；§5.1 左栏实现同步 |
| 2026-10-12 | **链表图元改进**（§5.1/§4.4 C）：结点尺寸缩小为"每值一格 40×30"（原 96×44）；新增参数**每结点值数**（1–4，默认 1），结点=多个相邻值格；连线绑定"来源结点末格→目标结点首格"使锚点落在整个结点边缘；**环形链表改为沿矩形绕行排布**（上排 L→R、下排 R→L），消除收尾箭头横穿中间的问题 |
| 2026-10-12 | 链表**双链箭头修正**：去掉"正向箭头 + 反向箭头"两条连线（多值结点时交叉混乱），改为**同一条连线用双向箭头** `arrowhead:"both"`（末格→下一结点首格）；§5.1/§4.4 E 同步 |
| 2026-10-12 | 链表**连线绑定改"就近格"（方案 A）**：绑定端不再固定首/末格，而取**中心最靠近目标结点**的格子，平局时取"环外侧"格 → 环形里方向反转的边也朝向对方，箭头不再斜穿（§5.1/§4.4 E 同步） |
| 2026-10-12 | **引入语义 DSL + 编译器（§4.6）**：确立"程序化作图唯一入口 = DSL → 编译器 → `WBElement[]`(IR) → 渲染"；§4.4 由"LLM 输出契约"改为**编译器内部 IR 契约**（AI/图元库不再直接产元素，改产 DSL）；**方案甲**：图元库布局下沉到 `dsl/builders/`，左栏插入 = 构造空值 DSL 结构并编译；新增锚点表（布局层↔标注层唯一接口）与 4 种标注（pointer/highlight/window/note）；§1/§5.1/§7 同步。AI 侧的产出与耦合见 04 / 07 |
| 2026-10-12 | **P1 落地**（`src/panel/whiteboard/dsl/`）：`schema/anchors/validate/engine/annotations + builders/*`（12 结构）编译管线；`presets.ts` 改为 `toStructure()` 产出空值 DSL，`Whiteboard` 左栏插入改走 `compileDiagram`；与原实现**视觉一致**。schema 补 `id?`、`map.header`、`heap.showArray`；`typecheck`/`build` 通过 |
| 2026-10-12 | **P2 落地**（`dsl/annotations.ts`）：实现 pointer/highlight/window/note 解析——pointer=文字+自由箭头（锚点下方）、highlight=覆盖描边图形（随锚点形状 rect/ellipse）、window=并集外扩框、note=锚点上方/包围盒左上、caption=包围盒上方；锚点缺失跳过并 warning。`AnchorGeom` 增 `shape`；§4.6 补"标注默认策略"；临时脚本验证通过、`typecheck`/`build` 通过 |
