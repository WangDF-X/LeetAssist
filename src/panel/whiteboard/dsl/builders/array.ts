import { estimateTextSize } from "../../model";
import type { WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import { FONT, labelProps, mkRect, mkText, type BuildCtx, type BuildResult } from "./common";

const CELL = 44;

/** 序列（数组/字符串/位）：n 个方格 + 可选下标行 */
export function buildArray(
  s: Extract<DslStructure, { kind: "array" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  const n = s.items.length;
  for (let i = 0; i < n; i++) {
    const x = ctx.x + i * CELL;
    out.push(mkRect(ctx, x, ctx.y, CELL, CELL, labelProps(s.items[i])));
    registerAnchor(
      anchors,
      { struct: s.id ?? "", at: "cell", index: i },
      { box: { x, y: ctx.y, w: CELL, h: CELL }, center: [x + CELL / 2, ctx.y + CELL / 2] },
    );
  }
  if (s.indexed) {
    for (let i = 0; i < n; i++) {
      const t = String(i);
      const w = estimateTextSize(t, FONT).w;
      out.push(mkText(ctx, ctx.x + i * CELL + (CELL - w) / 2, ctx.y + CELL + 4, t));
    }
  }
  return { elements: out, anchors };
}
