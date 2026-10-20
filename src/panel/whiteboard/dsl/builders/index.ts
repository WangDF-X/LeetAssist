import { estimateTextSize } from "../../model";
import type { DslStructure } from "../schema";
import { FONT, mkText, type BuildCtx, type BuildResult } from "./common";
import { buildArray } from "./array";
import { buildBarChart } from "./barChart";
import { buildStack } from "./stack";
import { buildQueue } from "./queue";
import { buildMatrix } from "./matrix";
import { buildMap } from "./map";
import { buildBucket } from "./bucket";
import { buildLinkedList } from "./linkedList";
import { buildTree } from "./tree";
import { buildHeap } from "./heap";
import { buildGraph } from "./graph";
import { buildStateMachine } from "./stateMachine";

export type { BuildCtx, BuildResult } from "./common";
export { FONT } from "./common";

const TITLE_GAP = 8;

/** 按 kind 分派到对应 builder（不含结构标题）。 */
function dispatch(s: DslStructure, ctx: BuildCtx): BuildResult {
  switch (s.kind) {
    case "array":
      return buildArray(s, ctx);
    case "matrix":
      return buildMatrix(s, ctx);
    case "map":
      return buildMap(s, ctx);
    case "linkedList":
      return buildLinkedList(s, ctx);
    case "stack":
      return buildStack(s, ctx);
    case "queue":
      return buildQueue(s, ctx);
    case "bucket":
      return buildBucket(s, ctx);
    case "barChart":
      return buildBarChart(s, ctx);
    case "tree":
      return buildTree(s, ctx);
    case "heap":
      return buildHeap(s, ctx);
    case "graph":
      return buildGraph(s, ctx);
    case "stateMachine":
      return buildStateMachine(s, ctx);
  }
}

/**
 * 结构标题（contract §4.3.1 structure.name）：
 * 标题占一行，主体整体下移；锚点随 ctx.y 平移，不需要额外修正。
 */
export function buildStructure(s: DslStructure, ctx: BuildCtx): BuildResult {
  const name = typeof s.name === "string" && s.name.trim() !== "" ? s.name : undefined;
  if (!name) return dispatch(s, ctx);
  const size = estimateTextSize(name, FONT);
  const title = mkText(ctx, ctx.x, ctx.y, name);
  const body = dispatch(s, { ...ctx, y: ctx.y + size.h + TITLE_GAP });
  return { elements: [title, ...body.elements], anchors: body.anchors };
}
