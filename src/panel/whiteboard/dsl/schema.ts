// 语义 DSL（plan/03-whiteboard §4.6）：作图的唯一入口契约。
// - 只描述"画什么"（结构/值/标注），不含任何坐标/尺寸/颜色字面量。
// - 由编译器（engine + builders）翻译为 WBElement[]（IR）。
// - 图元库（左栏模板）与 AI 都产出本 DSL。
import type { WBColorId } from "../../theme";

export const DSL_VERSION = 1;

export type DslValue = string | number | null;
export type DslColor = WBColorId;

interface DslBase {
  id?: string; // 供标注引用；缺省由编译器分配
  name?: string; // 图上显示的结构名/变量名
}

export interface DslTreeNode {
  id?: string;
  value?: DslValue;
  children?: DslTreeNode[];
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
  | (DslBase & { kind: "tree"; variant?: "binary" | "nary"; root: DslTreeNode })
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

/** 标注锚点：语义位置（第几格 / 哪个结点），不含坐标 */
export type DslAnchor =
  | { struct: string; at: "cell"; index: number }
  | { struct: string; at: "cell2"; row: number; col: number }
  | { struct: string; at: "node"; id: string }
  | { struct: string; at: "gap"; index: number };

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
  dslVersion?: number;
  caption?: string;
  structures: DslStructure[];
  annotations?: DslAnnotation[];
}
