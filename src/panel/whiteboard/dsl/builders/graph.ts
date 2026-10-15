import type { WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import {
  labelProps,
  mkConnector,
  mkEllipse,
  type BuildCtx,
  type BuildResult,
} from "./common";

const CIRCLE_D = 44;
const R = 90;

/** 图：结点环形布点 + 边（有向 warrowhead=end，无向 none）；支持 label/weight */
export function buildGraph(
  s: Extract<DslStructure, { kind: "graph" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  const count = s.nodes.length;
  const cx0 = ctx.x + R + CIRCLE_D / 2;
  const cy0 = ctx.y + R + CIRCLE_D / 2;

  const byId = new Map<string, { el: string; center: [number, number] }>();
  s.nodes.forEach((node, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, count);
    const cx = cx0 + R * Math.cos(ang);
    const cy = cy0 + R * Math.sin(ang);
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
  for (const e of s.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const label =
      e.label !== undefined && e.label !== null
        ? String(e.label)
        : e.weight !== undefined
          ? String(e.weight)
          : undefined;
    out.push(mkConnector(ctx, a.el, b.el, a.center, b.center, head, label));
  }
  return { elements: out, anchors };
}
