// 编译结果与结构化诊断（diagram-contract.md §5.2）。
import type { WBElement } from "../model";

export type DiagnosticSeverity = "error" | "warning";
export type DiagnosticStage =
  | "schema"
  | "semantic"
  | "normalize"
  | "layout"
  | "annotation"
  | "output";

export interface DiagramDiagnostic {
  code: string; // 稳定错误码
  severity: DiagnosticSeverity;
  stage: DiagnosticStage;
  path: string; // JSON Pointer，根为 ""
  message: string; // 简明、安全
  annotationIndex?: number; // 原始 annotations 索引
}

export type DiagramStatus = "ok" | "partial" | "error";

export type CompileResult =
  | {
      status: "ok" | "partial";
      elements: WBElement[];
      droppedAnnotations: number;
      /** 无损去重时保留的全部原始 annotations 索引（不进入 IR）。 */
      dedupedAnnotationIndices: number[];
      diagnostics: DiagramDiagnostic[];
    }
  | {
      status: "error";
      elements: [];
      droppedAnnotations: 0;
      diagnostics: DiagramDiagnostic[];
    };

export const DIAG = {
  INVALID_ENVELOPE: "INVALID_ENVELOPE",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  INVALID_FIELD: "INVALID_FIELD",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  DUPLICATE_ID: "DUPLICATE_ID",
  UNKNOWN_REFERENCE: "UNKNOWN_REFERENCE",
  INVALID_ANCHOR: "INVALID_ANCHOR",
  INDEX_OUT_OF_RANGE: "INDEX_OUT_OF_RANGE",
  UNSUPPORTED_SEMANTICS: "UNSUPPORTED_SEMANTICS",
  ANNOTATION_CONFLICT: "ANNOTATION_CONFLICT",
  LAYOUT_OVERLAP: "LAYOUT_OVERLAP",
  BUILD_FAILED: "BUILD_FAILED",
  INVALID_IR: "INVALID_IR",
} as const;
