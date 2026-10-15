import type { DslStructure } from "../schema";
import type { BuildCtx, BuildResult } from "./common";
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

/** 按 kind 分派到对应 builder */
export function buildStructure(s: DslStructure, ctx: BuildCtx): BuildResult {
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
