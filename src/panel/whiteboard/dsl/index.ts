// 语义 DSL + 编译器（plan/03-whiteboard §4.6 / diagram-contract.md）：作图的唯一入口。
export * from "./schema";
export { compileDiagram } from "./engine";
export type { CompileOptions } from "./engine";
export { DIAG } from "./result";
export type { CompileResult, DiagramDiagnostic, DiagramStatus } from "./result";
export { LIMITS } from "./limits";
export type { AnchorMap, AnchorGeom } from "./anchors";
