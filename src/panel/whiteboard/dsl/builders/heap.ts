import type { WBElement } from "../../model";
import type { DslStructure, DslTreeNode, DslValue } from "../schema";
import { newAnchorMap } from "../anchors";
import { labelProps, mkRect, type BuildCtx, type BuildResult } from "./common";
import { CIRCLE_D, LEVEL_GAP, layoutTree } from "./tree";

/** 由数组表示（层序）构造完全二叉树 */
function heapToTree(values: DslValue[]): DslTreeNode {
  const nodes: DslTreeNode[] = values.map((v) => ({ value: v, children: [] }));
  for (let i = 0; i < nodes.length; i++) {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    if (l < nodes.length) nodes[i].children?.push(nodes[l]);
    if (r < nodes.length) nodes[i].children?.push(nodes[r]);
  }
  return nodes[0] ?? { children: [] };
}

/** 堆：数组表示 → 完全二叉树；可选一维数组行 */
export function buildHeap(
  s: Extract<DslStructure, { kind: "heap" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  const n = s.values.length;
  if (n === 0) return { elements: out, anchors };

  layoutTree(heapToTree(s.values), ctx, s.id ?? "", out, anchors);

  if (s.showArray) {
    const levels = Math.floor(Math.log2(n)) + 1;
    const leaves = n - Math.floor(n / 2);
    const step = CIRCLE_D + 24;
    const treeW = (leaves - 1) * step + CIRCLE_D;
    const treeCenter = ctx.x + treeW / 2;
    const C = 36;
    const startX = treeCenter - (n * C) / 2;
    const y = ctx.y + (levels - 1) * LEVEL_GAP + CIRCLE_D + 24;
    for (let i = 0; i < n; i++) {
      out.push(mkRect(ctx, startX + i * C, y, C, C, labelProps(s.values[i])));
    }
  }
  return { elements: out, anchors };
}
