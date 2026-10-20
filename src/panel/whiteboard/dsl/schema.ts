// 语义 DSL v2（plan/03-whiteboard §4.6 + diagram-contract.md）。
// - 只描述"画什么"（结构/值/标注），不含坐标/尺寸/颜色字面量。
// - 由编译器（validate + builders + engine）翻译为 WBElement[]（IR）。
// - 图元库与 AI 都产出本 DSL。
import type { WBColorId } from "../../theme";

export const DSL_VERSION = 2;

export type DslValue = string | number | null;
export type DslColor = WBColorId;

interface DslBase {
  id?: string; // 供标注引用；缺省由编译器分配 s0/s1…
  name?: string;
}

export interface DslBinaryNode {
  id?: string;
  value: DslValue; // v2：必填（可为 null）
  left?: DslBinaryNode | null;
  right?: DslBinaryNode | null;
}

export interface DslNaryNode {
  id?: string;
  value: DslValue;
  /** v2：允许 null 表示缺位；null 不生成节点/边，也不是 value=null 的真实节点。 */
  children?: (DslNaryNode | null)[];
}

export type DslStructure =
  | (DslBase & { kind: "array"; items: DslValue[]; indexed?: boolean })
  | (DslBase & {
      kind: "matrix";
      rows: DslValue[][];
      rowHeaders?: DslValue[];
      colHeaders?: DslValue[];
    })
  | (DslBase & {
      kind: "map";
      entries: { key: DslValue; value: DslValue }[];
      header?: boolean;
    })
  | (DslBase & {
      kind: "linkedList";
      nodes: { id?: string; values: DslValue[] }[];
      doubly?: boolean;
      circular?: boolean;
    })
  | (DslBase & { kind: "stack"; items: DslValue[] })
  | (DslBase & { kind: "queue"; items: DslValue[]; deque?: boolean })
  | (DslBase & { kind: "bucket"; buckets: DslValue[][] })
  | (DslBase & { kind: "barChart"; values: number[]; labels?: DslValue[] })
  | (DslBase & { kind: "tree"; variant: "binary"; root: DslBinaryNode | null })
  | (DslBase & { kind: "tree"; variant: "nary"; root: DslNaryNode | null })
  | (DslBase & { kind: "heap"; values: DslValue[]; showArray?: boolean })
  | (DslBase & {
      kind: "graph";
      nodes: { id: string; label?: DslValue }[];
      edges: { from: string; to: string; label?: DslValue; weight?: number }[];
      directed?: boolean;
    })
  | (DslBase & {
      kind: "stateMachine";
      states: { id: string; label?: DslValue }[];
      transitions: { from: string; to: string; label?: string }[];
      initial?: string;
      accepting?: string[];
    });

export type DslStructureKind = DslStructure["kind"];
export type DslTreeStructure = Extract<DslStructure, { kind: "tree" }>;

/** 标注锚点：语义位置（第几格 / 哪个结点），不含坐标；v2 不开放 gap */
export type DslAnchor =
  | { struct: string; at: "cell"; index: number }
  | { struct: string; at: "cell2"; row: number; col: number }
  | { struct: string; at: "node"; id: string };

export type DslAnnotation =
  | { kind: "pointer"; anchor: DslAnchor; label: string; color?: DslColor }
  | { kind: "highlight"; anchor: DslAnchor; color?: DslColor }
  | {
      kind: "window";
      from: DslAnchor;
      to: DslAnchor;
      label?: string;
      color?: DslColor;
    }
  | { kind: "note"; anchor?: DslAnchor; text: string; color?: DslColor };

export interface LlmDiagram {
  dslVersion: 2;
  caption?: string;
  structures: DslStructure[];
  annotations?: DslAnnotation[];
}
