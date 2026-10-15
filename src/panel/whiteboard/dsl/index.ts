// 语义 DSL + 编译器（plan/03-whiteboard §4.6）：作图的唯一入口。
export * from "./schema";
export { compileDiagram } from "./engine";
export type { CompileOptions, CompileResult } from "./engine";
export type { AnchorMap, AnchorGeom } from "./anchors";
