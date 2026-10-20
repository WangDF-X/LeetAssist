import type { WBElement } from "../../model";
import type { DslBinaryNode, DslStructure, DslValue } from "../schema";
import { newAnchorMap, registerAnchor, type AnchorMap } from "../anchors";
import { emptyMark, labelProps, mkConnector, mkEllipse, mkRect, type BuildCtx, type BuildResult } from "./common";

const CIRCLE_D = 44;
const LEVEL_GAP = 72;
const STEP = CIRCLE_D + 24;

interface Placed {
  id: string;
  cx: number;
  cy: number;
}

/** 由数组表示（层序）构造完全二叉树，节点 id 固定 h0/h1… */
function heapToTree(values: DslValue[]): DslBinaryNode | null {
  if (values.length === 0) return null;
  const nodes: DslBinaryNode[] = values.map((v, i) => ({ id: `h${i}`, value: v }));
  for (let i = 0; i < nodes.length; i++) {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    if (l < nodes.length) nodes[i].left = nodes[l];
    if (r < nodes.length) nodes[i].right = nodes[r];
  }
  return nodes[0];
}

/** 完全二叉树金字塔布局（父居中于子），节点登记 h* 锚点 */
function layoutComplete(
  root: DslBinaryNode,
  ctx: BuildCtx,
  structId: string,
  out: WBElement[],
  anchors: AnchorMap,
): void {
  const counter = { v: 0 };
  const place = (node: DslBinaryNode, depth: number): Placed => {
    const kids: Placed[] = [];
    if (node.left) kids.push(place(node.left, depth + 1));
    if (node.right) kids.push(place(node.right, depth + 1));
    const cx =
      kids.length === 0
        ? ctx.x + CIRCLE_D / 2 + counter.v++ * STEP
        : (kids[0].cx + kids[kids.length - 1].cx) / 2;
    const cy = ctx.y + depth * LEVEL_GAP + CIRCLE_D / 2;
    const el = mkEllipse(
      ctx,
      cx - CIRCLE_D / 2,
      ctx.y + depth * LEVEL_GAP,
      CIRCLE_D,
      CIRCLE_D,
      labelProps(node.value),
    );
    out.push(el);
    if (node.id)
      registerAnchor(
        anchors,
        { struct: structId, at: "node", id: node.id },
        {
          box: { x: cx - CIRCLE_D / 2, y: cy - CIRCLE_D / 2, w: CIRCLE_D, h: CIRCLE_D },
          center: [cx, cy],
          shape: "ellipse",
        },
      );
    for (const k of kids)
      out.push(mkConnector(ctx, el.id, k.id, [cx, cy], [k.cx, k.cy], "none"));
    return { id: el.id, cx, cy };
  };
  place(root, 0);
}

/** 堆：数组表示 → 完全二叉树；showArray 时另画一维数组行并登记 cell 锚点 */
export function buildHeap(
  s: Extract<DslStructure, { kind: "heap" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  const n = s.values.length;
  if (n === 0) return { elements: [emptyMark(ctx)], anchors };

  const root = heapToTree(s.values);
  if (root) layoutComplete(root, ctx, s.id ?? "", out, anchors);

  if (s.showArray) {
    const levels = Math.floor(Math.log2(n)) + 1;
    const leaves = n - Math.floor(n / 2);
    const treeW = (leaves - 1) * STEP + CIRCLE_D;
    const treeCenter = ctx.x + treeW / 2;
    const C = 36;
    const startX = treeCenter - (n * C) / 2;
    const y = ctx.y + (levels - 1) * LEVEL_GAP + CIRCLE_D + 24;
    for (let i = 0; i < n; i++) {
      const x = startX + i * C;
      out.push(mkRect(ctx, x, y, C, C, labelProps(s.values[i])));
      registerAnchor(
        anchors,
        { struct: s.id ?? "", at: "cell", index: i },
        { box: { x, y, w: C, h: C }, center: [x + C / 2, y + C / 2] },
      );
    }
  }
  return { elements: out, anchors };
}
