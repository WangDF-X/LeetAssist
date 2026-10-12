// 数据结构图元库：预设 = 宏展开（plan/03-whiteboard §4.4 / §5.1）。
// 设计要点：
// - 不引入新元素类型：每个模板把参数翻译成现有 WBElement[]（纯函数）。
// - 结点/label 文字留空，由用户填写；颜色/线宽取调用方传入的当前"新建默认值"。
// - 组内自动连线用 connector.connects{from,to} 按 id 引用（坐标由渲染层解析）。
// - 12 个模板 × 4 组：线性 / 二维 / 层级 / 关系。标记类后置，不做。
// ⚠️ 维护约束（spec §4.4 G）：WB_PRESETS 与 §5.1 模板表、§4.4 LLM 输出契约三者同源，
//    增删模板/改参数范围与默认值/改生成尺寸等，必须同步更新 spec 对应处。
import type { WBColorId, WBWidthId } from "../theme";
import type {
  WBArrowhead,
  WBConnectorElement,
  WBElement,
  WBEllipseElement,
  WBRectElement,
  WBTextElement,
} from "./model";
import { estimateTextSize, LABEL_DEFAULT_SIZE } from "./model";

// ---------- 类型 ----------

export type WBPresetParam =
  | {
      kind: "number";
      key: string;
      label: string;
      min: number;
      max: number;
      default: number;
    }
  | { kind: "boolean"; key: string; label: string; default: boolean };

export type WBPresetGroup = "linear" | "grid" | "tree" | "relation";

export interface WBPresetBuildCtx {
  x: number; // 结构包围盒左上角（调用方随后居中到视口中心）
  y: number;
  params: Record<string, number | boolean>;
  color: WBColorId;
  width: WBWidthId;
  genId: (p?: string) => string;
}

export interface WBPreset {
  id: string;
  name: string;
  group: WBPresetGroup;
  params: WBPresetParam[]; // 空数组 = 无参数（点击直接插入，不弹窗）
  build: (ctx: WBPresetBuildCtx) => WBElement[];
}

/** 左栏分组展示名（按 order 渲染） */
export const WB_PRESET_GROUPS: Record<WBPresetGroup, string> = {
  linear: "线性",
  grid: "二维",
  tree: "层级",
  relation: "关系",
};
export const WB_PRESET_GROUP_ORDER: WBPresetGroup[] = [
  "linear",
  "grid",
  "tree",
  "relation",
];

// ---------- 尺寸常量（世界坐标，与 §4.4 几何 seam 对齐） ----------

const FONT = LABEL_DEFAULT_SIZE; // 16
const CELL = 44; // 通用方格
const LINK_CW = 40; // 链表结点：每个值一格的宽
const LINK_H = 30; // 链表结点高
const LINK_GAP_X = 44; // 链表结点间连接线长度
const LINK_ROW_GAP = 56; // 环形链表两行之间的垂直间距
const CIRCLE_D = 44; // 树/图结点圆
const STATE_D = 48; // 状态机结点圆
const LEVEL_GAP = 72; // 树/堆层间距
const SIBLING_GAP = 24; // 树/堆同层间距

// ---------- 参数/几何 helpers ----------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function num(
  p: Record<string, number | boolean>,
  key: string,
  fallback: number,
): number {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(
  p: Record<string, number | boolean>,
  key: string,
  fallback: boolean,
): boolean {
  const v = p[key];
  return typeof v === "boolean" ? v : fallback;
}

function rect(
  ctx: WBPresetBuildCtx,
  x: number,
  y: number,
  w: number,
  h: number,
): WBRectElement {
  return {
    id: ctx.genId(),
    type: "rect",
    x,
    y,
    w,
    h,
    color: ctx.color,
    width: ctx.width,
  };
}

function ellipse(
  ctx: WBPresetBuildCtx,
  x: number,
  y: number,
  w: number,
  h: number,
): WBEllipseElement {
  return {
    id: ctx.genId(),
    type: "ellipse",
    x,
    y,
    w,
    h,
    color: ctx.color,
    width: ctx.width,
  };
}

function text(
  ctx: WBPresetBuildCtx,
  x: number,
  y: number,
  s: string,
  size = FONT,
): WBTextElement {
  return {
    id: ctx.genId(),
    type: "text",
    x,
    y,
    text: s,
    size,
    color: ctx.color,
    width: ctx.width,
  };
}

function connector(
  ctx: WBPresetBuildCtx,
  fromId: string,
  toId: string,
  from: [number, number],
  to: [number, number],
  arrowhead: WBArrowhead = "end",
): WBConnectorElement {
  const points: [number, number, number, number] = [
    from[0],
    from[1],
    to[0],
    to[1],
  ];
  return {
    id: ctx.genId(),
    type: "connector",
    points,
    connects: { from: fromId, to: toId },
    arrowhead,
    color: ctx.color,
    width: ctx.width,
  };
}

// ---------- 各模板 build ----------

/** 序列（数组/字符串/位）：n 个方格 + 可选下标行 */
function buildArray(ctx: WBPresetBuildCtx): WBElement[] {
  const n = clamp(num(ctx.params, "n", 8), 1, 32);
  const withIndex = bool(ctx.params, "withIndex", true);
  const out: WBElement[] = [];
  for (let i = 0; i < n; i++)
    out.push(rect(ctx, ctx.x + i * CELL, ctx.y, CELL, CELL));
  if (withIndex) {
    for (let i = 0; i < n; i++) {
      const s = String(i);
      const w = estimateTextSize(s, FONT).w;
      out.push(
        text(ctx, ctx.x + i * CELL + (CELL - w) / 2, ctx.y + CELL + 4, s),
      );
    }
  }
  return out;
}

/** 柱状图：n 根竖条，底对齐；可选递增高度 */
function buildBarChart(ctx: WBPresetBuildCtx): WBElement[] {
  const n = clamp(num(ctx.params, "n", 6), 1, 16);
  const ascending = bool(ctx.params, "ascending", true);
  const BW = 28;
  const GAP = 2;
  const heights = Array.from({ length: n }, (_, i) =>
    ascending ? 40 + i * 20 : 60,
  );
  const maxH = Math.max(...heights);
  const baseline = ctx.y + maxH;
  const out: WBElement[] = [];
  for (let i = 0; i < n; i++) {
    const h = heights[i];
    out.push(rect(ctx, ctx.x + i * (BW + GAP), baseline - h, BW, h));
  }
  return out;
}

/** 链表：k 个结点（每结点 fields 个值格）+ 连接线；可选双链 / 环形（矩形排布） */
function buildLinkedList(ctx: WBPresetBuildCtx): WBElement[] {
  const k = clamp(num(ctx.params, "count", 4), 1, 10);
  const fields = clamp(num(ctx.params, "fields", 1), 1, 4);
  const doubly = bool(ctx.params, "doubly", false);
  const circular = bool(ctx.params, "circular", false);
  const nw = fields * LINK_CW; // 结点宽
  const colStep = nw + LINK_GAP_X;
  const out: WBElement[] = [];

  // 结点左上角坐标：普通 = 横排；环形 = 沿矩形绕行（上排 L→R、下排 R→L）
  const pos: [number, number][] = [];
  if (!circular) {
    for (let i = 0; i < k; i++) pos.push([ctx.x + i * colStep, ctx.y]);
  } else {
    const cols = Math.ceil(k / 2);
    for (let i = 0; i < k; i++) {
      const row = i < cols ? 0 : 1;
      const col = row === 0 ? i : 2 * cols - 1 - i; // 下排右对齐、由右向左
      pos.push([ctx.x + col * colStep, ctx.y + row * (LINK_H + LINK_ROW_GAP)]);
    }
  }

  // 每个结点 = fields 个相邻值格
  const cellsOf: string[][] = [];
  const centers: [number, number][] = [];
  for (let i = 0; i < k; i++) {
    const [nx, ny] = pos[i];
    const cells: string[] = [];
    for (let f = 0; f < fields; f++) {
      const cell = rect(ctx, nx + f * LINK_CW, ny, LINK_CW, LINK_H);
      out.push(cell);
      cells.push(cell.id);
    }
    cellsOf.push(cells);
    centers.push([nx + nw / 2, ny + LINK_H / 2]);
  }

  // 环外侧判定：以整组水平中心分左右，用于"就近格"打平局时朝外取格
  const nodeMinX = Math.min(...pos.map((p) => p[0]));
  const nodeMaxX = Math.max(...pos.map((p) => p[0] + nw));
  const structCenterX = (nodeMinX + nodeMaxX) / 2;

  // 就近选格（方案 A）：取中心最靠近目标结点的那一格；距离相同时朝"环外侧"取。
  // 这样环形里方向反转的边也会选到朝向对方的格子，箭头不再斜穿/错位。
  const pickCell = (i: number, targetX: number): number => {
    const leftCellCx = pos[i][0] + LINK_CW / 2;
    const outward = centers[i][0] >= structCenterX ? 1 : -1;
    let best = 0;
    let bestD = Infinity;
    for (let f = 0; f < fields; f++) {
      const d = Math.abs(leftCellCx + f * LINK_CW - targetX);
      if (d < bestD - 1e-6) {
        bestD = d;
        best = f;
      } else if (Math.abs(d - bestD) <= 1e-6 && (outward > 0 ? f > best : f < best)) {
        best = f;
      }
    }
    return best;
  };

  // 双链：同一条连线用**双向箭头**（避免两条连线交叉、指向混乱）
  const head: WBArrowhead = doubly ? "both" : "end";
  const link = (a: number, b: number) => {
    const fi = pickCell(a, centers[b][0]);
    const ti = pickCell(b, centers[a][0]);
    out.push(
      connector(ctx, cellsOf[a][fi], cellsOf[b][ti], centers[a], centers[b], head),
    );
  };
  for (let i = 0; i < k - 1; i++) link(i, i + 1);
  if (circular && k > 1) link(k - 1, 0);
  return out;
}

/** 栈：n 个格子竖叠 */
function buildStack(ctx: WBPresetBuildCtx): WBElement[] {
  const n = clamp(num(ctx.params, "n", 5), 1, 10);
  const CW = 72;
  const CH = 36;
  const out: WBElement[] = [];
  for (let i = 0; i < n; i++)
    out.push(rect(ctx, ctx.x, ctx.y + i * CH, CW, CH));
  return out;
}

/** 队列：n 个格子横排；可选双端开口标记 */
function buildQueue(ctx: WBPresetBuildCtx): WBElement[] {
  const n = clamp(num(ctx.params, "n", 5), 1, 10);
  const deque = bool(ctx.params, "deque", false);
  const CW = 60;
  const CH = 36;
  const out: WBElement[] = [];
  for (let i = 0; i < n; i++)
    out.push(rect(ctx, ctx.x + i * CW, ctx.y, CW, CH));
  if (deque) {
    out.push(text(ctx, ctx.x - 20, ctx.y + 8, "◀"));
    out.push(text(ctx, ctx.x + n * CW + 4, ctx.y + 8, "▶"));
  }
  return out;
}

/** 表格/网格：rows×cols 方格；可选行/列表头（各加一行/一列） */
function buildGrid(ctx: WBPresetBuildCtx): WBElement[] {
  const rows = clamp(num(ctx.params, "rows", 3), 1, 12);
  const cols = clamp(num(ctx.params, "cols", 4), 1, 12);
  const rowHeader = bool(ctx.params, "rowHeader", false);
  const colHeader = bool(ctx.params, "colHeader", false);
  const C = 40;
  const totalRows = rows + (colHeader ? 1 : 0);
  const totalCols = cols + (rowHeader ? 1 : 0);
  const out: WBElement[] = [];
  for (let r = 0; r < totalRows; r++)
    for (let c = 0; c < totalCols; c++)
      out.push(rect(ctx, ctx.x + c * C, ctx.y + r * C, C, C));
  return out;
}

/** 键值表（哈希/映射）：键列 + 值列；可选表头行 */
function buildHash(ctx: WBPresetBuildCtx): WBElement[] {
  const rows = clamp(num(ctx.params, "rows", 4), 1, 12);
  const header = bool(ctx.params, "header", true);
  const KW = 72;
  const VW = 120;
  const RH = 36;
  const total = rows + (header ? 1 : 0);
  const out: WBElement[] = [];
  for (let r = 0; r < total; r++) {
    out.push(rect(ctx, ctx.x, ctx.y + r * RH, KW, RH));
    out.push(rect(ctx, ctx.x + KW, ctx.y + r * RH, VW, RH));
  }
  return out;
}

/** 桶：buckets 个竖桶，每桶 capacity 格 */
function buildBucket(ctx: WBPresetBuildCtx): WBElement[] {
  const buckets = clamp(num(ctx.params, "buckets", 5), 1, 10);
  const cap = clamp(num(ctx.params, "capacity", 3), 1, 6);
  const BW = 44;
  const CH = 30;
  const GX = 20;
  const out: WBElement[] = [];
  for (let b = 0; b < buckets; b++) {
    const bx = ctx.x + b * (BW + GX);
    for (let j = 0; j < cap; j++)
      out.push(rect(ctx, bx, ctx.y + j * CH, BW, CH));
  }
  return out;
}

/** 满 branch 叉树（按中序紧凑排布）；边用 connector 按 id 绑定 */
function buildTree(
  ctx: WBPresetBuildCtx,
  branch: number,
  levels: number,
): WBElement[] {
  const out: WBElement[] = [];
  const step = CIRCLE_D + SIBLING_GAP;
  let counter = 0;
  const place = (depth: number): { id: string; cx: number; cy: number } => {
    if (depth === levels - 1) {
      const cx = ctx.x + CIRCLE_D / 2 + counter * step;
      counter++;
      const node = ellipse(
        ctx,
        cx - CIRCLE_D / 2,
        ctx.y + depth * LEVEL_GAP,
        CIRCLE_D,
        CIRCLE_D,
      );
      out.push(node);
      return { id: node.id, cx, cy: ctx.y + depth * LEVEL_GAP + CIRCLE_D / 2 };
    }
    const children: { id: string; cx: number; cy: number }[] = [];
    for (let i = 0; i < branch; i++) children.push(place(depth + 1));
    const cx = (children[0].cx + children[children.length - 1].cx) / 2;
    const cy = ctx.y + depth * LEVEL_GAP + CIRCLE_D / 2;
    const node = ellipse(
      ctx,
      cx - CIRCLE_D / 2,
      ctx.y + depth * LEVEL_GAP,
      CIRCLE_D,
      CIRCLE_D,
    );
    out.push(node);
    for (const ch of children)
      out.push(connector(ctx, node.id, ch.id, [cx, cy], [ch.cx, ch.cy], "none"));
    return { id: node.id, cx, cy };
  };
  place(0);
  return out;
}

/** 堆：完全二叉树（= 满二叉）+ 可选一维数组表示行 */
function buildHeap(ctx: WBPresetBuildCtx): WBElement[] {
  const levels = clamp(num(ctx.params, "levels", 3), 2, 4);
  const withArray = bool(ctx.params, "withArray", false);
  const out = buildTree(ctx, 2, levels);
  if (withArray) {
    const count = Math.pow(2, levels) - 1;
    const C = 36;
    const leaves = Math.pow(2, levels - 1);
    const step = CIRCLE_D + SIBLING_GAP;
    const treeW = (leaves - 1) * step + CIRCLE_D;
    const treeCenter = ctx.x + treeW / 2;
    const arrayW = count * C;
    const startX = treeCenter - arrayW / 2;
    const y = ctx.y + (levels - 1) * LEVEL_GAP + CIRCLE_D + 24;
    for (let i = 0; i < count; i++)
      out.push(rect(ctx, startX + i * C, y, C, C));
  }
  return out;
}

/** 图：固定 4 个结点圆环，无向边（无参数） */
function buildGraph(ctx: WBPresetBuildCtx): WBElement[] {
  const count = 4;
  const R = 90;
  const cx0 = ctx.x + R + CIRCLE_D / 2;
  const cy0 = ctx.y + R + CIRCLE_D / 2;
  const out: WBElement[] = [];
  const ids: string[] = [];
  const centers: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const cx = cx0 + R * Math.cos(ang);
    const cy = cy0 + R * Math.sin(ang);
    const node = ellipse(
      ctx,
      cx - CIRCLE_D / 2,
      cy - CIRCLE_D / 2,
      CIRCLE_D,
      CIRCLE_D,
    );
    ids.push(node.id);
    centers.push([cx, cy]);
    out.push(node);
  }
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    out.push(connector(ctx, ids[i], ids[j], centers[i], centers[j], "none"));
  }
  return out;
}

/** 状态机：s 个状态圆横排 + 相邻转移边（带箭头） */
function buildStateMachine(ctx: WBPresetBuildCtx): WBElement[] {
  const s = clamp(num(ctx.params, "states", 4), 2, 6);
  const step = STATE_D + 80;
  const out: WBElement[] = [];
  const ids: string[] = [];
  const centers: [number, number][] = [];
  for (let i = 0; i < s; i++) {
    const cx = ctx.x + STATE_D / 2 + i * step;
    const cy = ctx.y + STATE_D / 2;
    const node = ellipse(
      ctx,
      cx - STATE_D / 2,
      cy - STATE_D / 2,
      STATE_D,
      STATE_D,
    );
    ids.push(node.id);
    centers.push([cx, cy]);
    out.push(node);
  }
  for (let i = 0; i < s - 1; i++)
    out.push(connector(ctx, ids[i], ids[i + 1], centers[i], centers[i + 1], "end"));
  return out;
}

// ---------- 预设清单 ----------

export const WB_PRESETS: WBPreset[] = [
  {
    id: "array",
    name: "序列",
    group: "linear",
    params: [
      { kind: "number", key: "n", label: "格数", min: 1, max: 32, default: 8 },
      { kind: "boolean", key: "withIndex", label: "下标", default: true },
    ],
    build: buildArray,
  },
  {
    id: "bar",
    name: "柱状图",
    group: "linear",
    params: [
      { kind: "number", key: "n", label: "柱数", min: 1, max: 16, default: 6 },
      { kind: "boolean", key: "ascending", label: "高度递增", default: true },
    ],
    build: buildBarChart,
  },
  {
    id: "linkedlist",
    name: "链表",
    group: "linear",
    params: [
      { kind: "number", key: "count", label: "结点数", min: 1, max: 10, default: 4 },
      { kind: "number", key: "fields", label: "每结点值数", min: 1, max: 4, default: 1 },
      { kind: "boolean", key: "doubly", label: "双链", default: false },
      { kind: "boolean", key: "circular", label: "环形", default: false },
    ],
    build: buildLinkedList,
  },
  {
    id: "stack",
    name: "栈",
    group: "linear",
    params: [
      { kind: "number", key: "n", label: "格数", min: 1, max: 10, default: 5 },
    ],
    build: buildStack,
  },
  {
    id: "queue",
    name: "队列",
    group: "linear",
    params: [
      { kind: "number", key: "n", label: "格数", min: 1, max: 10, default: 5 },
      { kind: "boolean", key: "deque", label: "双端", default: false },
    ],
    build: buildQueue,
  },
  {
    id: "grid",
    name: "表格",
    group: "grid",
    params: [
      { kind: "number", key: "rows", label: "行", min: 1, max: 12, default: 3 },
      { kind: "number", key: "cols", label: "列", min: 1, max: 12, default: 4 },
      { kind: "boolean", key: "rowHeader", label: "行表头", default: false },
      { kind: "boolean", key: "colHeader", label: "列表头", default: false },
    ],
    build: buildGrid,
  },
  {
    id: "hash",
    name: "键值表",
    group: "grid",
    params: [
      { kind: "number", key: "rows", label: "行", min: 1, max: 12, default: 4 },
      { kind: "boolean", key: "header", label: "表头", default: true },
    ],
    build: buildHash,
  },
  {
    id: "bucket",
    name: "桶",
    group: "grid",
    params: [
      { kind: "number", key: "buckets", label: "桶数", min: 1, max: 10, default: 5 },
      { kind: "number", key: "capacity", label: "容量", min: 1, max: 6, default: 3 },
    ],
    build: buildBucket,
  },
  {
    id: "tree",
    name: "树",
    group: "tree",
    params: [
      { kind: "number", key: "levels", label: "层数", min: 1, max: 4, default: 3 },
      { kind: "number", key: "branch", label: "分支数", min: 2, max: 4, default: 2 },
    ],
    build: (ctx) =>
      buildTree(
        ctx,
        clamp(num(ctx.params, "branch", 2), 2, 4),
        clamp(num(ctx.params, "levels", 3), 1, 4),
      ),
  },
  {
    id: "heap",
    name: "堆",
    group: "tree",
    params: [
      { kind: "number", key: "levels", label: "层数", min: 2, max: 4, default: 3 },
      { kind: "boolean", key: "withArray", label: "数组行", default: false },
    ],
    build: buildHeap,
  },
  {
    id: "graph",
    name: "图",
    group: "relation",
    params: [],
    build: buildGraph,
  },
  {
    id: "statemachine",
    name: "状态机",
    group: "relation",
    params: [
      { kind: "number", key: "states", label: "状态数", min: 2, max: 6, default: 4 },
    ],
    build: buildStateMachine,
  },
];

/** 由预设参数定义生成初始参数表 */
export function defaultParams(
  preset: WBPreset,
): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const p of preset.params) out[p.key] = p.default;
  return out;
}
