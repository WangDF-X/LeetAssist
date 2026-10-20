import type { WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import {
  emptyMark,
  labelProps,
  mkConnector,
  mkEllipse,
  offsetEdgeElements,
  selfLoopElements,
  type BuildCtx,
  type BuildResult,
} from "./common";

const CIRCLE_D = 44;
const RING_R = 90;
const NODE_R = CIRCLE_D / 2;

/** 图：结点环形布点 + 边（有向 arrowhead=end，无向 none）；支持 label/weight、自环与反向边 */
export function buildGraph(
  s: Extract<DslStructure, { kind: "graph" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  const count = s.nodes.length;
  if (count === 0) return { elements: [emptyMark(ctx)], anchors };
  const cx0 = ctx.x + RING_R + CIRCLE_D / 2;
  const cy0 = ctx.y + RING_R + CIRCLE_D / 2;

  const byId = new Map<string, { el: string; center: [number, number] }>();
  s.nodes.forEach((node, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, count);
    const cx = cx0 + RING_R * Math.cos(ang);
    const cy = cy0 + RING_R * Math.sin(ang);
    const el = mkEllipse(
      ctx,
      cx - CIRCLE_D / 2,
      cy - CIRCLE_D / 2,
      CIRCLE_D,
      CIRCLE_D,
      labelProps(node.label),
    );
    out.push(el);
    byId.set(node.id, { el: el.id, center: [cx, cy] });
    registerAnchor(
      anchors,
      { struct: s.id ?? "", at: "node", id: node.id },
      {
        box: { x: cx - CIRCLE_D / 2, y: cy - CIRCLE_D / 2, w: CIRCLE_D, h: CIRCLE_D },
        center: [cx, cy],
        shape: "ellipse",
      },
    );
  });

  const head = s.directed ? "end" : "none";
  const edgeSet = new Set(s.edges.map((e) => JSON.stringify([e.from, e.to])));
  for (const e of s.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) throw new Error("graph edge endpoint missing");
    const parts: string[] = [];
    if (e.label !== undefined && e.label !== null) parts.push(String(e.label));
    if (e.weight !== undefined) parts.push(String(e.weight));
    const label = parts.length ? parts.join(" · ") : undefined;

    if (e.from === e.to) {
      out.push(...selfLoopElements(ctx, a.center[0], a.center[1], NODE_R, head, label));
      continue;
    }
    if (edgeSet.has(JSON.stringify([e.to, e.from]))) {
      // 反向双边：按字典序稳定分居两侧，避免重叠
      const sign: 1 | -1 = e.from < e.to ? 1 : -1;
      out.push(...offsetEdgeElements(ctx, a.center, b.center, NODE_R, NODE_R, sign, head, label));
      continue;
    }
    out.push(mkConnector(ctx, a.el, b.el, a.center, b.center, head, label));
  }
  return { elements: out, anchors };
}
