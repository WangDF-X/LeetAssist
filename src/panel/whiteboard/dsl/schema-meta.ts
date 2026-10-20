// DSL 形式规则的元数据（与 llm-diagram.schema.json 同源，由 check:dsl 校验一致性）。
import type { DslStructureKind } from "./schema";

export const KINDS: DslStructureKind[] = [
  "array",
  "matrix",
  "map",
  "linkedList",
  "stack",
  "queue",
  "bucket",
  "barChart",
  "tree",
  "heap",
  "graph",
  "stateMachine",
];
export const KIND_SET: Set<string> = new Set(KINDS);

export const COLORS = ["default", "red", "blue", "green", "orange"] as const;
export const COLOR_SET: Set<string> = new Set(COLORS);

export const ENVELOPE_KEYS: Set<string> = new Set([
  "dslVersion",
  "caption",
  "structures",
  "annotations",
]);

export const STRUCT_ALLOWED: Record<DslStructureKind, string[]> = {
  array: ["items", "indexed"],
  matrix: ["rows", "rowHeaders", "colHeaders"],
  map: ["entries", "header"],
  linkedList: ["nodes", "doubly", "circular"],
  stack: ["items"],
  queue: ["items", "deque"],
  bucket: ["buckets"],
  barChart: ["values", "labels"],
  tree: ["variant", "root"],
  heap: ["values", "showArray"],
  graph: ["nodes", "edges", "directed"],
  stateMachine: ["states", "transitions", "initial", "accepting"],
};

export const ANNOTATION_ALLOWED: Record<string, string[]> = {
  pointer: ["kind", "anchor", "label", "color"],
  highlight: ["kind", "anchor", "color"],
  window: ["kind", "from", "to", "label", "color"],
  note: ["kind", "anchor", "text", "color"],
};
