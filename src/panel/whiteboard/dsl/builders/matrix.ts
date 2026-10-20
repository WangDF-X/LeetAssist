import type { WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import { emptyMark, labelProps, mkRect, type BuildCtx, type BuildResult } from "./common";

const C = 40;

/** 表格/网格：rows×cols 方格；rowHeaders=左表头列、colHeaders=顶表头行 */
export function buildMatrix(
  s: Extract<DslStructure, { kind: "matrix" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  const dataRows = s.rows.length;
  const dataCols = s.rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (dataRows === 0) return { elements: [emptyMark(ctx)], anchors };
  const hasRowHeader = Array.isArray(s.rowHeaders);
  const hasColHeader = Array.isArray(s.colHeaders);
  const totalRows = dataRows + (hasColHeader ? 1 : 0);
  const totalCols = dataCols + (hasRowHeader ? 1 : 0);

  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const x = ctx.x + c * C;
      const y = ctx.y + r * C;
      let extra: { label?: string } = {};
      const isColHeader = hasColHeader && r === 0;
      const isRowHeader = hasRowHeader && c === 0;
      if (isColHeader && !isRowHeader) {
        extra = labelProps(s.colHeaders?.[c - (hasRowHeader ? 1 : 0)]);
      } else if (isRowHeader && !isColHeader) {
        extra = labelProps(s.rowHeaders?.[r - (hasColHeader ? 1 : 0)]);
      } else if (!isColHeader && !isRowHeader) {
        const dr = r - (hasColHeader ? 1 : 0);
        const dc = c - (hasRowHeader ? 1 : 0);
        extra = labelProps(s.rows[dr]?.[dc]);
        registerAnchor(
          anchors,
          { struct: s.id ?? "", at: "cell2", row: dr, col: dc },
          { box: { x, y, w: C, h: C }, center: [x + C / 2, y + C / 2] },
        );
      }
      out.push(mkRect(ctx, x, y, C, C, extra));
    }
  }
  return { elements: out, anchors };
}
