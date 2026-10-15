import type { WBArrowhead, WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import {
  labelProps,
  mkConnector,
  mkRect,
  type BuildCtx,
  type BuildResult,
} from "./common";

const LINK_CW = 40;
const LINK_H = 30;
const LINK_GAP_X = 44;
const LINK_ROW_GAP = 56;

/** 链表：k 个结点（每结点多值格）+ 连接线；双链/环形；环形沿矩形绕行、就近选格绑定 */
export function buildLinkedList(
  s: Extract<DslStructure, { kind: "linkedList" }>,
  ctx: BuildCtx,
): BuildResult {
  const nodes = s.nodes;
  const k = nodes.length;
  const fields = Math.max(
    1,
    nodes.reduce((m, n) => Math.max(m, n.values.length), 0),
  );
  const doubly = !!s.doubly;
  const circular = !!s.circular;
  const nw = fields * LINK_CW;
  const colStep = nw + LINK_GAP_X;
  const out: WBElement[] = [];
  const anchors = newAnchorMap();

  const pos: [number, number][] = [];
  if (!circular) {
    for (let i = 0; i < k; i++) pos.push([ctx.x + i * colStep, ctx.y]);
  } else {
    const cols = Math.ceil(k / 2);
    for (let i = 0; i < k; i++) {
      const row = i < cols ? 0 : 1;
      const col = row === 0 ? i : 2 * cols - 1 - i;
      pos.push([ctx.x + col * colStep, ctx.y + row * (LINK_H + LINK_ROW_GAP)]);
    }
  }

  const cellsOf: string[][] = [];
  const centers: [number, number][] = [];
  for (let i = 0; i < k; i++) {
    const [nx, ny] = pos[i];
    const cells: string[] = [];
    for (let f = 0; f < fields; f++) {
      const cell = mkRect(
        ctx,
        nx + f * LINK_CW,
        ny,
        LINK_CW,
        LINK_H,
        labelProps(nodes[i]?.values[f]),
      );
      out.push(cell);
      cells.push(cell.id);
    }
    cellsOf.push(cells);
    centers.push([nx + nw / 2, ny + LINK_H / 2]);
    const geom = {
      box: { x: nx, y: ny, w: nw, h: LINK_H },
      center: [nx + nw / 2, ny + LINK_H / 2] as [number, number],
    };
    registerAnchor(anchors, { struct: s.id ?? "", at: "cell", index: i }, geom);
    const nodeId = nodes[i]?.id;
    if (nodeId)
      registerAnchor(anchors, { struct: s.id ?? "", at: "node", id: nodeId }, geom);
  }

  const nodeMinX = pos.length ? Math.min(...pos.map((p) => p[0])) : ctx.x;
  const nodeMaxX = pos.length ? Math.max(...pos.map((p) => p[0] + nw)) : ctx.x;
  const structCenterX = (nodeMinX + nodeMaxX) / 2;

  const pickCell = (i: number, targetX: number): number => {
    const leftCellCx = pos[i][0] + LINK_CW / 2;
    const outward = centers[i][0] >= structCenterX ? 1 : -1;
    let best = 0;
    let bestD = Infinity;
    for (let f = 0; f < fields; f++) {
      const d = Math.abs(leftCellCx + f * LINK_CW - targetX);
      if (d < bestD - 1e-6) {
        bestD = d;
        best = f;
      } else if (Math.abs(d - bestD) <= 1e-6 && (outward > 0 ? f > best : f < best)) {
        best = f;
      }
    }
    return best;
  };

  const head: WBArrowhead = doubly ? "both" : "end";
  const link = (a: number, b: number) => {
    const fi = pickCell(a, centers[b][0]);
    const ti = pickCell(b, centers[a][0]);
    out.push(
      mkConnector(ctx, cellsOf[a][fi], cellsOf[b][ti], centers[a], centers[b], head),
    );
  };
  for (let i = 0; i < k - 1; i++) link(i, i + 1);
  if (circular && k > 1) link(k - 1, 0);
  return { elements: out, anchors };
}
