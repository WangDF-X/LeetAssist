import { estimateTextSize, type WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import {
  emptyMark,
  FONT,
  mkRect,
  mkText,
  type BuildCtx,
  type BuildResult,
} from "./common";

const BW = 28;
const GAP = 2;

/** 柱状图：values 作为柱高（px），底对齐 */
export function buildBarChart(
  s: Extract<DslStructure, { kind: "barChart" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  // 零值保留位置，用 4px 标记表示；其余值不取整、不缩放（contract §4.2）。
  const heights = s.values.map((v) => (v === 0 ? 4 : v));
  if (heights.length === 0) return { elements: [emptyMark(ctx)], anchors };
  const maxH = Math.max(...heights);
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
    const rawLabel = s.labels?.[i];
    if (rawLabel !== null && rawLabel !== undefined && String(rawLabel).trim() !== "") {
      const text = String(rawLabel);
      const tw = estimateTextSize(text, FONT).w;
      out.push(mkText(ctx, x + (BW - tw) / 2, baseline + 4, text));
    }
  });
  return { elements: out, anchors };
}
