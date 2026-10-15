import type { WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import { mkRect, type BuildCtx, type BuildResult } from "./common";

const BW = 28;
const GAP = 2;

/** 柱状图：values 作为柱高（px），底对齐 */
export function buildBarChart(
  s: Extract<DslStructure, { kind: "barChart" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  const heights = s.values.map((v) => Math.max(4, Math.round(v)));
  const maxH = heights.length ? Math.max(...heights) : 0;
  const baseline = ctx.y + maxH;
  heights.forEach((h, i) => {
    const x = ctx.x + i * (BW + GAP);
    const y = baseline - h;
    out.push(mkRect(ctx, x, y, BW, h));
    registerAnchor(
      anchors,
      { struct: s.id ?? "", at: "cell", index: i },
      { box: { x, y, w: BW, h }, center: [x + BW / 2, y + h / 2] },
    );
  });
  return { elements: out, anchors };
}
