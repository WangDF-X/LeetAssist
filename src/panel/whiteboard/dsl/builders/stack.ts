import type { WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import { labelProps, mkRect, type BuildCtx, type BuildResult } from "./common";

const CW = 72;
const CH = 36;

/** 栈：n 个格子竖叠 */
export function buildStack(
  s: Extract<DslStructure, { kind: "stack" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  s.items.forEach((v, i) => {
    const y = ctx.y + i * CH;
    out.push(mkRect(ctx, ctx.x, y, CW, CH, labelProps(v)));
    registerAnchor(
      anchors,
      { struct: s.id ?? "", at: "cell", index: i },
      { box: { x: ctx.x, y, w: CW, h: CH }, center: [ctx.x + CW / 2, y + CH / 2] },
    );
  });
  return { elements: out, anchors };
}
