// 数据结构图元库：预设 = 语义 DSL 生成器（plan/03-whiteboard §4.6 / §5.1）。
// - 每个模板把"参数"翻译成一个 **空值 DSL 结构**（semantic），几何/尺寸由编译器 builders 决定。
// - 结点/label 文字留空（值 = null），由用户或 AI 填写。
// - 12 个模板 × 4 组：线性 / 二维 / 层级 / 关系。
// ⚠️ 维护约束（spec §4.4 G / §4.6）：WB_PRESETS 与 §5.1 模板表、§4.6 DSL 契约、dsl/builders 同源，
//    增删模板/改参数范围与默认值/改结构字段，必须同步更新 spec 与 builders。
import type { DslStructure, DslTreeNode } from "./dsl/schema";

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

export interface WBPreset {
  id: string;
  name: string;
  group: WBPresetGroup;
  params: WBPresetParam[]; // 空数组 = 无参数（点击直接插入，不弹窗）
  /** 参数 → 空值语义结构（由编译器 buildStructure 展开为元素） */
  toStructure: (params: Record<string, number | boolean>) => DslStructure;
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

// ---------- 参数 helpers ----------

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

function fill(n: number): null[] {
  return Array.from({ length: n }, () => null);
}

/** 满 branch 叉、levels 层的树（值留空） */
function fullTree(branch: number, levels: number): DslTreeNode {
  const build = (depth: number): DslTreeNode => ({
    value: null,
    children:
      depth >= levels - 1
        ? []
        : Array.from({ length: branch }, () => build(depth + 1)),
  });
  return build(0);
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
    toStructure: (p) => ({
      kind: "array",
      items: fill(clamp(num(p, "n", 8), 1, 32)),
      indexed: bool(p, "withIndex", true),
    }),
  },
  {
    id: "bar",
    name: "柱状图",
    group: "linear",
    params: [
      { kind: "number", key: "n", label: "柱数", min: 1, max: 16, default: 6 },
      { kind: "boolean", key: "ascending", label: "高度递增", default: true },
    ],
    toStructure: (p) => {
      const n = clamp(num(p, "n", 6), 1, 16);
      const asc = bool(p, "ascending", true);
      return {
        kind: "barChart",
        values: Array.from({ length: n }, (_, i) => (asc ? 40 + i * 20 : 60)),
      };
    },
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
    toStructure: (p) => {
      const count = clamp(num(p, "count", 4), 1, 10);
      const fields = clamp(num(p, "fields", 1), 1, 4);
      return {
        kind: "linkedList",
        nodes: Array.from({ length: count }, () => ({ values: fill(fields) })),
        doubly: bool(p, "doubly", false),
        circular: bool(p, "circular", false),
      };
    },
  },
  {
    id: "stack",
    name: "栈",
    group: "linear",
    params: [
      { kind: "number", key: "n", label: "格数", min: 1, max: 10, default: 5 },
    ],
    toStructure: (p) => ({
      kind: "stack",
      items: fill(clamp(num(p, "n", 5), 1, 10)),
    }),
  },
  {
    id: "queue",
    name: "队列",
    group: "linear",
    params: [
      { kind: "number", key: "n", label: "格数", min: 1, max: 10, default: 5 },
      { kind: "boolean", key: "deque", label: "双端", default: false },
    ],
    toStructure: (p) => ({
      kind: "queue",
      items: fill(clamp(num(p, "n", 5), 1, 10)),
      deque: bool(p, "deque", false),
    }),
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
    toStructure: (p) => {
      const rows = clamp(num(p, "rows", 3), 1, 12);
      const cols = clamp(num(p, "cols", 4), 1, 12);
      return {
        kind: "matrix",
        rows: Array.from({ length: rows }, () => fill(cols)),
        ...(bool(p, "rowHeader", false) ? { rowHeaders: fill(rows) } : {}),
        ...(bool(p, "colHeader", false) ? { colHeaders: fill(cols) } : {}),
      };
    },
  },
  {
    id: "hash",
    name: "键值表",
    group: "grid",
    params: [
      { kind: "number", key: "rows", label: "行", min: 1, max: 12, default: 4 },
      { kind: "boolean", key: "header", label: "表头", default: true },
    ],
    toStructure: (p) => ({
      kind: "map",
      entries: Array.from({ length: clamp(num(p, "rows", 4), 1, 12) }, () => ({
        key: null,
        value: null,
      })),
      header: bool(p, "header", true),
    }),
  },
  {
    id: "bucket",
    name: "桶",
    group: "grid",
    params: [
      { kind: "number", key: "buckets", label: "桶数", min: 1, max: 10, default: 5 },
      { kind: "number", key: "capacity", label: "容量", min: 1, max: 6, default: 3 },
    ],
    toStructure: (p) => ({
      kind: "bucket",
      buckets: Array.from({ length: clamp(num(p, "buckets", 5), 1, 10) }, () =>
        fill(clamp(num(p, "capacity", 3), 1, 6)),
      ),
    }),
  },
  {
    id: "tree",
    name: "树",
    group: "tree",
    params: [
      { kind: "number", key: "levels", label: "层数", min: 1, max: 4, default: 3 },
      { kind: "number", key: "branch", label: "分支数", min: 2, max: 4, default: 2 },
    ],
    toStructure: (p) => ({
      kind: "tree",
      root: fullTree(
        clamp(num(p, "branch", 2), 2, 4),
        clamp(num(p, "levels", 3), 1, 4),
      ),
    }),
  },
  {
    id: "heap",
    name: "堆",
    group: "tree",
    params: [
      { kind: "number", key: "levels", label: "层数", min: 2, max: 4, default: 3 },
      { kind: "boolean", key: "withArray", label: "数组行", default: false },
    ],
    toStructure: (p) => {
      const levels = clamp(num(p, "levels", 3), 2, 4);
      return {
        kind: "heap",
        values: fill(Math.pow(2, levels) - 1),
        showArray: bool(p, "withArray", false),
      };
    },
  },
  {
    id: "graph",
    name: "图",
    group: "relation",
    params: [],
    toStructure: () => ({
      kind: "graph",
      nodes: [0, 1, 2, 3].map((i) => ({ id: `n${i}` })),
      edges: [0, 1, 2, 3].map((i) => ({ from: `n${i}`, to: `n${(i + 1) % 4}` })),
      directed: false,
    }),
  },
  {
    id: "statemachine",
    name: "状态机",
    group: "relation",
    params: [
      { kind: "number", key: "states", label: "状态数", min: 2, max: 6, default: 4 },
    ],
    toStructure: (p) => {
      const s = clamp(num(p, "states", 4), 2, 6);
      return {
        kind: "stateMachine",
        states: Array.from({ length: s }, (_, i) => ({ id: `q${i}` })),
        transitions: Array.from({ length: s - 1 }, (_, i) => ({
          from: `q${i}`,
          to: `q${i + 1}`,
        })),
      };
    },
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
