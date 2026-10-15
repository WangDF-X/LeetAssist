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

const STATE_D = 48;

/** 状态机：状态圆横排 + 转移边（带箭头、可带触发条件 label） */
export function buildStateMachine(
  s: Extract<DslStructure, { kind: "stateMachine" }>,
  ctx: BuildCtx,
): BuildResult {
  const out: WBElement[] = [];
  const anchors = newAnchorMap();
  const step = STATE_D + 80;

  const byId = new Map<string, { el: string; center: [number, number] }>();
  s.states.forEach((st, i) => {
    const cx = ctx.x + STATE_D / 2 + i * step;
    const cy = ctx.y + STATE_D / 2;
    const el = mkEllipse(
      ctx,
      cx - STATE_D / 2,
      cy - STATE_D / 2,
      STATE_D,
      STATE_D,
      labelProps(st.label),
    );
    out.push(el);
    byId.set(st.id, { el: el.id, center: [cx, cy] });
    registerAnchor(
      anchors,
      { struct: s.id ?? "", at: "node", id: st.id },
      {
        box: { x: cx - STATE_D / 2, y: cy - STATE_D / 2, w: STATE_D, h: STATE_D },
        center: [cx, cy],
        shape: "ellipse",
      },
    );
  });

  for (const tr of s.transitions) {
    const a = byId.get(tr.from);
    const b = byId.get(tr.to);
    if (!a || !b) continue;
    out.push(mkConnector(ctx, a.el, b.el, a.center, b.center, "end", tr.label));
  }
  return { elements: out, anchors };
}
