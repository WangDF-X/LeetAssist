// builder 共用：构建上下文、元素工厂、通用常量。
import type { WBColorId, WBWidthId } from "../../../theme";
import type {
  WBArrowhead,
  WBConnectorElement,
  WBElement,
  WBEllipseElement,
  WBRectElement,
  WBTextElement,
} from "../../model";
import { LABEL_DEFAULT_SIZE } from "../../model";
import type { AnchorMap } from "../anchors";

export interface BuildCtx {
  x: number; // 结构左上角（世界坐标）
  y: number;
  color: WBColorId;
  width: WBWidthId;
  genId: (p?: string) => string;
}

export interface BuildResult {
  elements: WBElement[];
  anchors: AnchorMap;
}

export const FONT = LABEL_DEFAULT_SIZE; // 16

/** 值 → 元素 label 属性（null/空白 → 无 label，与 IR sanitizer 保持一致） */
export function labelProps(v: unknown): { label?: string } {
  if (v === null || v === undefined) return {};
  const s = String(v);
  return s.trim() === "" ? {} : { label: s };
}

export function mkRect(
  ctx: BuildCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: { label?: string; labelSize?: number } = {},
): WBRectElement {
  return {
    id: ctx.genId(),
    type: "rect",
    x,
    y,
    w,
    h,
    color: ctx.color,
    width: ctx.width,
    ...extra,
  };
}

export function mkEllipse(
  ctx: BuildCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: { label?: string; labelSize?: number } = {},
): WBEllipseElement {
  return {
    id: ctx.genId(),
    type: "ellipse",
    x,
    y,
    w,
    h,
    color: ctx.color,
    width: ctx.width,
    ...extra,
  };
}

export function mkText(
  ctx: BuildCtx,
  x: number,
  y: number,
  s: string,
  size = FONT,
): WBTextElement {
  return {
    id: ctx.genId(),
    type: "text",
    x,
    y,
    text: s,
    size,
    color: ctx.color,
    width: ctx.width,
  };
}

export function mkConnector(
  ctx: BuildCtx,
  fromId: string,
  toId: string,
  from: [number, number],
  to: [number, number],
  arrowhead: WBArrowhead = "end",
  label?: string,
): WBConnectorElement {
  const points: [number, number, number, number] = [
    from[0],
    from[1],
    to[0],
    to[1],
  ];
  return {
    id: ctx.genId(),
    type: "connector",
    points,
    connects: { from: fromId, to: toId },
    arrowhead,
    ...(label ? { label } : {}),
    color: ctx.color,
    width: ctx.width,
  };
}

/** 空结构的 ∅ 标记；结构 name 由 buildStructure 统一作为标题渲染。 */
export function emptyMark(ctx: BuildCtx): WBTextElement {
  return mkText(ctx, ctx.x, ctx.y, "∅");
}

/** 自由端点连线（不绑定元素；用于自环/偏移边等静态画法） */
export function mkFreeConnector(
  ctx: BuildCtx,
  from: [number, number],
  to: [number, number],
  arrowhead: WBArrowhead = "end",
  label?: string,
): WBConnectorElement {
  return {
    id: ctx.genId(),
    type: "connector",
    points: [from[0], from[1], to[0], to[1]],
    arrowhead,
    ...(label ? { label } : {}),
    color: ctx.color,
    width: ctx.width,
  };
}

/** 自环：结点右缘 → 右上顶点 → 结点顶缘（静态近似，不跟随结点移动） */
export function selfLoopElements(
  ctx: BuildCtx,
  cx: number,
  cy: number,
  r: number,
  arrowhead: WBArrowhead,
  label?: string,
): WBElement[] {
  const top: [number, number] = [cx, cy - r];
  const right: [number, number] = [cx + r, cy];
  const apex: [number, number] = [cx + r + 34, cy - r - 34];
  const out: WBElement[] = [
    mkFreeConnector(ctx, right, apex, "none"),
    mkFreeConnector(ctx, apex, top, arrowhead),
  ];
  if (label) out.push(mkText(ctx, apex[0] + 6, apex[1] - 6, label));
  return out;
}

/** 反向双边：两条平行偏移的直线（按 sign 分居两侧），避免重叠；静态近似 */
export function offsetEdgeElements(
  ctx: BuildCtx,
  a: [number, number],
  b: [number, number],
  rA: number,
  rB: number,
  sign: 1 | -1,
  arrowhead: WBArrowhead,
  label?: string,
): WBElement[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const off = 10 * sign;
  const start: [number, number] = [a[0] + ux * (rA + 2) + px * off, a[1] + uy * (rA + 2) + py * off];
  const end: [number, number] = [b[0] - ux * (rB + 2) + px * off, b[1] - uy * (rB + 2) + py * off];
  return [mkFreeConnector(ctx, start, end, arrowhead, label)];
}
