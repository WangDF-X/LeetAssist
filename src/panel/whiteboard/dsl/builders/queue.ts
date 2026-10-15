import type { WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import { labelProps, mkRect, mkText, type BuildCtx, type BuildResult } from "./common";

const CW = 60;
const CH = 36;

/** 队列：n 个格子横排；可选双端开口标记 */
export function buildQueue(
  s: Extract<DslStructure, { kind: "queue" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  const n = s.items.length;
  s.items.forEach((v, i) => {
    const x = ctx.x + i * CW;
    out.push(mkRect(ctx, x, ctx.y, CW, CH, labelProps(v)));
    registerAnchor(
      anchors,
      { struct: s.id ?? "", at: "cell", index: i },
      { box: { x, y: ctx.y, w: CW, h: CH }, center: [x + CW / 2, ctx.y + CH / 2] },
    );
  });
  if (s.deque) {
    out.push(mkText(ctx, ctx.x - 20, ctx.y + 8, "◀"));
    out.push(mkText(ctx, ctx.x + n * CW + 4, ctx.y + 8, "▶"));
  }
  return { elements: out, anchors };
}
