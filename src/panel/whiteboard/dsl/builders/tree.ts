import type { WBElement } from "../../model";
import type { DslBinaryNode, DslNaryNode, DslStructure } from "../schema";
import { newAnchorMap, registerAnchor, type AnchorMap } from "../anchors";
import {
  emptyMark,
  labelProps,
  mkConnector,
  mkEllipse,
  type BuildCtx,
  type BuildResult,
} from "./common";

export const CIRCLE_D = 44;
export const LEVEL_GAP = 72;
export const SIBLING_GAP = 24;
const STEP = CIRCLE_D + SIBLING_GAP;

interface Placed {
  id: string;
  cx: number;
  cy: number;
}

function registerNode(
  anchors: AnchorMap,
  structId: string,
  nodeId: string | undefined,
  cx: number,
  cy: number,
): void {
  if (!nodeId) return;
  registerAnchor(
    anchors,
    { struct: structId, at: "node", id: nodeId },
    {
      box: { x: cx - CIRCLE_D / 2, y: cy - CIRCLE_D / 2, w: CIRCLE_D, h: CIRCLE_D },
      center: [cx, cy],
      shape: "ellipse",
    },
  );
}

/**
 * 二叉布局：中序 + 缺位占槽，保留左右语义（仅右孩子时不居中）。
 */
export function layoutBinaryTree(
  root: DslBinaryNode,
  ctx: BuildCtx,
  structId: string,
  out: WBElement[],
  anchors: AnchorMap,
): void {
  const counter = { v: 0 };
  const place = (node: DslBinaryNode, depth: number): Placed => {
    const hasL = !!node.left;
    const hasR = !!node.right;
    let left: Placed | null = null;
    if (hasL) left = place(node.left!, depth + 1);
    else if (hasR) counter.v += 1; // 仅右孩子：左侧占位，父结点靠左
    const cx = ctx.x + CIRCLE_D / 2 + counter.v * STEP;
    counter.v += 1;
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
    registerNode(anchors, structId, node.id, cx, cy);
    let right: Placed | null = null;
    if (hasR) right = place(node.right!, depth + 1);
    else if (hasL) counter.v += 1; // 仅左孩子：右侧占位，父结点靠右
    if (left) out.push(mkConnector(ctx, el.id, left.id, [cx, cy], [left.cx, left.cy], "none"));
    if (right) out.push(mkConnector(ctx, el.id, right.id, [cx, cy], [right.cx, right.cy], "none"));
    return { id: el.id, cx, cy };
  };
  place(root, 0);
}

/** 多叉布局：叶子中序紧凑，父居中于首末子之间 */
export function layoutNaryTree(
  root: DslNaryNode,
  ctx: BuildCtx,
  structId: string,
  out: WBElement[],
  anchors: AnchorMap,
): void {
  const counter = { v: 0 };
  const place = (node: DslNaryNode, depth: number): Placed => {
    const children = (node.children ?? [])
      .filter((c): c is DslNaryNode => c !== null)
      .map((c) => place(c, depth + 1));
    const cx =
      children.length === 0
        ? ctx.x + CIRCLE_D / 2 + counter.v++ * STEP
        : (children[0].cx + children[children.length - 1].cx) / 2;
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
    registerNode(anchors, structId, node.id, cx, cy);
    for (const c of children)
      out.push(mkConnector(ctx, el.id, c.id, [cx, cy], [c.cx, c.cy], "none"));
    return { id: el.id, cx, cy };
  };
  place(root, 0);
}

/** 树：binary 用 left/right，nary 用 children；root 可为 null（空树） */
export function buildTree(
  s: Extract<DslStructure, { kind: "tree" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  if (!s.root) return { elements: [emptyMark(ctx)], anchors };
  if (s.variant === "binary") layoutBinaryTree(s.root, ctx, s.id ?? "", out, anchors);
  else layoutNaryTree(s.root, ctx, s.id ?? "", out, anchors);
  return { elements: out, anchors };
}
