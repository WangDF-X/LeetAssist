import type { WBElement } from "../../model";
import type { DslStructure } from "../schema";
import { newAnchorMap, registerAnchor } from "../anchors";
import {
  emptyMark,
  labelProps,
  mkConnector,
  mkEllipse,
  mkFreeConnector,
  offsetEdgeElements,
  selfLoopElements,
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
  if (s.states.length === 0) return { elements: [emptyMark(ctx)], anchors };

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

  const R = STATE_D / 2;
  const transitionSet = new Set(s.transitions.map((t) => JSON.stringify([t.from, t.to])));

  // 初态：左侧进入箭头；终态：外圈双圆（contract §4.2 初态/终态语义）。
  const initial = s.initial ? byId.get(s.initial) : undefined;
  if (initial)
    out.push(
      mkFreeConnector(
        ctx,
        [initial.center[0] - R - 30, initial.center[1]],
        [initial.center[0] - R - 2, initial.center[1]],
        "end",
      ),
    );
  for (const id of new Set(s.accepting ?? [])) {
    const st = byId.get(id);
    if (!st) continue;
    out.push(
      mkEllipse(
        ctx,
        st.center[0] - R - 4,
        st.center[1] - R - 4,
        STATE_D + 8,
        STATE_D + 8,
      ),
    );
  }

  for (const tr of s.transitions) {
    const a = byId.get(tr.from);
    const b = byId.get(tr.to);
    if (!a || !b) throw new Error("stateMachine transition endpoint missing");
    if (tr.from === tr.to) {
      out.push(...selfLoopElements(ctx, a.center[0], a.center[1], R, "end", tr.label));
      continue;
    }
    if (transitionSet.has(JSON.stringify([tr.to, tr.from]))) {
      const sign: 1 | -1 = tr.from < tr.to ? 1 : -1;
      out.push(...offsetEdgeElements(ctx, a.center, b.center, R, R, sign, "end", tr.label));
      continue;
    }
    out.push(mkConnector(ctx, a.el, b.el, a.center, b.center, "end", tr.label));
  }
  return { elements: out, anchors };
}
