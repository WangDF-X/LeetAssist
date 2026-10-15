import type { WBElement } from "../../model";
import type { DslStructure, DslTreeNode } from "../schema";
import { newAnchorMap, registerAnchor, type AnchorMap } from "../anchors";
import {
  labelProps,
  mkConnector,
  mkEllipse,
  type BuildCtx,
  type BuildResult,
} from "./common";

export const CIRCLE_D = 44;
export const LEVEL_GAP = 72;
export const SIBLING_GAP = 24;

interface Placed {
  id: string;
  cx: number;
  cy: number;
}

/** 通用树布局（按叶子中序紧凑排布，父结点居中于首末子之间）；边用 connector 按 id 绑定 */
export function layoutTree(
  root: DslTreeNode,
  ctx: BuildCtx,
  structId: string,
  out: WBElement[],
  anchors: AnchorMap,
): void {
  const step = CIRCLE_D + SIBLING_GAP;
  let counter = 0;

  const register = (node: DslTreeNode, cx: number, cy: number) => {
    if (!node.id) return;
    registerAnchor(
      anchors,
      { struct: structId, at: "node", id: node.id },
      {
        box: { x: cx - CIRCLE_D / 2, y: cy - CIRCLE_D / 2, w: CIRCLE_D, h: CIRCLE_D },
        center: [cx, cy],
        shape: "ellipse",
      },
    );
  };

  const place = (node: DslTreeNode, depth: number): Placed => {
    const children = node.children ?? [];
    if (children.length === 0) {
      const cx = ctx.x + CIRCLE_D / 2 + counter * step;
      counter++;
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
      register(node, cx, cy);
      return { id: el.id, cx, cy };
    }
    const placed = children.map((ch) => place(ch, depth + 1));
    const cx = (placed[0].cx + placed[placed.length - 1].cx) / 2;
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
    for (const ch of placed)
      out.push(mkConnector(ctx, el.id, ch.id, [cx, cy], [ch.cx, ch.cy], "none"));
    register(node, cx, cy);
    return { id: el.id, cx, cy };
  };

  place(root, 0);
}

/** 树：任意嵌套二叉/多叉树 */
export function buildTree(
  s: Extract<DslStructure, { kind: "tree" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  layoutTree(s.root, ctx, s.id ?? "", out, anchors);
  return { elements: out, anchors };
}
