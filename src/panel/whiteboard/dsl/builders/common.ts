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

/** 值 → 元素 label 属性（null/空 → 无 label，保持模板"空格子"外观） */
export function labelProps(v: unknown): { label?: string } {
  if (v === null || v === undefined) return {};
  const s = String(v);
  return s === "" ? {} : { label: s };
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
