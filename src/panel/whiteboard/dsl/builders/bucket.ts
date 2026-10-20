import type { WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import { emptyMark, labelProps, mkRect, type BuildCtx, type BuildResult } from "./common";

const BW = 44;
const CH = 30;
const GX = 20;

/** 桶：buckets 个竖桶，每桶若干格 */
export function buildBucket(
  s: Extract<DslStructure, { kind: "bucket" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  if (s.buckets.length === 0) return { elements: [emptyMark(ctx)], anchors };
  s.buckets.forEach((cells, b) => {
    const bx = ctx.x + b * (BW + GX);
    cells.forEach((v, j) => {
      const y = ctx.y + j * CH;
      out.push(mkRect(ctx, bx, y, BW, CH, labelProps(v)));
      registerAnchor(
        anchors,
        { struct: s.id ?? "", at: "cell2", row: j, col: b },
        { box: { x: bx, y, w: BW, h: CH }, center: [bx + BW / 2, y + CH / 2] },
      );
    });
  });
  return { elements: out, anchors };
}
