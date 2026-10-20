import type { WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import { emptyMark, labelProps, mkRect, type BuildCtx, type BuildResult } from "./common";

const KW = 72;
const VW = 120;
const RH = 36;

/** 键值表（哈希/映射）：键列 + 值列；可选表头行 */
export function buildMap(
  s: Extract<DslStructure, { kind: "map" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  const header = !!s.header;
  if (s.entries.length === 0) return { elements: [emptyMark(ctx)], anchors };
  const total = s.entries.length + (header ? 1 : 0);
  for (let r = 0; r < total; r++) {
    const y = ctx.y + r * RH;
    const isHeader = header && r === 0;
    const e = isHeader ? undefined : s.entries[r - (header ? 1 : 0)];
    out.push(mkRect(ctx, ctx.x, y, KW, RH, isHeader ? {} : labelProps(e?.key)));
    out.push(mkRect(ctx, ctx.x + KW, y, VW, RH, isHeader ? {} : labelProps(e?.value)));
    if (!isHeader) {
      const dr = r - (header ? 1 : 0);
      registerAnchor(
        anchors,
        { struct: s.id ?? "", at: "cell2", row: dr, col: 0 },
        { box: { x: ctx.x, y, w: KW, h: RH }, center: [ctx.x + KW / 2, y + RH / 2] },
      );
      registerAnchor(
        anchors,
        { struct: s.id ?? "", at: "cell2", row: dr, col: 1 },
        {
          box: { x: ctx.x + KW, y, w: VW, h: RH },
          center: [ctx.x + KW + VW / 2, y + RH / 2],
        },
      );
    }
  }
  return { elements: out, anchors };
}
