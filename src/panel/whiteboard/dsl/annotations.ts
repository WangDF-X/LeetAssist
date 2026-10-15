// 标注解析（plan/03-whiteboard §4.6）：读锚点表，把 pointer/highlight/window/note 编译成 IR 元素。
// - 标注只给"语义位置"（第几格/哪个结点），坐标由锚点表解析 → 布局变化不影响标注。
// - 追加在结构元素之后（渲染在最上层）；纯增量，不改原元素。
// - highlight = 覆盖一个同尺寸描边图形（rect/ellipse 随锚点形状），视觉上"该处变色"。
import type { WBColorId, WBWidthId } from "../../theme";
import type {
  WBBox,
  WBConnectorElement,
  WBElement,
  WBEllipseElement,
  WBRectElement,
  WBTextElement,
} from "../model";
import { estimateTextSize, LABEL_DEFAULT_SIZE } from "../model";
import { anchorKey, type AnchorGeom, type AnchorMap } from "./anchors";
import type { DslAnnotation, DslAnchor, DslColor } from "./schema";

export interface AnnotationCtx {
  color: WBColorId;
  width: WBWidthId;
  genId: (p?: string) => string;
  bounds?: WBBox; // 结构整体包围盒（无锚点 note 定位）
}

export interface AnnotationsResult {
  elements: WBElement[];
  warnings: string[];
}

const FONT = LABEL_DEFAULT_SIZE;
const PAD = 6; // window 外扩
const POINTER_GAP = 34; // 指针文字与锚点的间距（留出数组下标行等）
const NOTE_LANE = 30; // 批注在指针下方的下一"车道"偏移
const NOTE_GAP = 10; // 无锚点批注与包围盒的间距

function geomOf(anchors: AnchorMap, a: DslAnchor): AnchorGeom | undefined {
  return anchors.get(anchorKey(a));
}

function col(a: DslColor | undefined, ctx: AnnotationCtx): WBColorId {
  return a ?? ctx.color;
}

function mkText(
  ctx: AnnotationCtx,
  x: number,
  y: number,
  text: string,
  color: WBColorId,
  size = FONT,
): WBTextElement {
  return { id: ctx.genId(), type: "text", x, y, text, size, color, width: ctx.width };
}

function mkRect(
  ctx: AnnotationCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: WBColorId,
): WBRectElement {
  return { id: ctx.genId(), type: "rect", x, y, w, h, color, width: ctx.width };
}

function mkEllipse(
  ctx: AnnotationCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: WBColorId,
): WBEllipseElement {
  return { id: ctx.genId(), type: "ellipse", x, y, w, h, color, width: ctx.width };
}

/** 自由端点箭头（不绑定元素，坐标字面值） */
function mkFreeArrow(
  ctx: AnnotationCtx,
  from: [number, number],
  to: [number, number],
  color: WBColorId,
): WBConnectorElement {
  return {
    id: ctx.genId(),
    type: "connector",
    points: [from[0], from[1], to[0], to[1]],
    arrowhead: "end",
    color,
    width: ctx.width,
  };
}

function resolvePointer(
  a: Extract<DslAnnotation, { kind: "pointer" }>,
  anchors: AnchorMap,
  ctx: AnnotationCtx,
): WBElement[] | null {
  const g = geomOf(anchors, a.anchor);
  if (!g) return null;
  const color = col(a.color, ctx);
  const s = estimateTextSize(a.label, FONT);
  const ax = g.box.x + g.box.w / 2;
  const aBottom = g.box.y + g.box.h;
  const tx = ax - s.w / 2;
  const ty = aBottom + POINTER_GAP;
  return [
    mkText(ctx, tx, ty, a.label, color),
    mkFreeArrow(ctx, [ax, ty], [ax, aBottom + 2], color),
  ];
}

function resolveHighlight(
  a: Extract<DslAnnotation, { kind: "highlight" }>,
  anchors: AnchorMap,
  ctx: AnnotationCtx,
): WBElement[] | null {
  const g = geomOf(anchors, a.anchor);
  if (!g) return null;
  const color = col(a.color, ctx);
  const el =
    g.shape === "ellipse"
      ? mkEllipse(ctx, g.box.x, g.box.y, g.box.w, g.box.h, color)
      : mkRect(ctx, g.box.x, g.box.y, g.box.w, g.box.h, color);
  return [el];
}

function resolveWindow(
  a: Extract<DslAnnotation, { kind: "window" }>,
  anchors: AnchorMap,
  ctx: AnnotationCtx,
): WBElement[] | null {
  const g1 = geomOf(anchors, a.from);
  const g2 = geomOf(anchors, a.to);
  if (!g1 || !g2) return null;
  const color = col(a.color, ctx);
  const x = Math.min(g1.box.x, g2.box.x) - PAD;
  const y = Math.min(g1.box.y, g2.box.y) - PAD;
  const x2 = Math.max(g1.box.x + g1.box.w, g2.box.x + g2.box.w) + PAD;
  const y2 = Math.max(g1.box.y + g1.box.h, g2.box.y + g2.box.h) + PAD;
  const out: WBElement[] = [mkRect(ctx, x, y, x2 - x, y2 - y, color)];
  if (a.label) {
    const s = estimateTextSize(a.label, FONT);
    out.push(mkText(ctx, (x + x2) / 2 - s.w / 2, y - s.h - 4, a.label, color));
  }
  return out;
}

function resolveNote(
  a: Extract<DslAnnotation, { kind: "note" }>,
  anchors: AnchorMap,
  ctx: AnnotationCtx,
): WBElement[] | null {
  const color = col(a.color, ctx);
  const s = estimateTextSize(a.text, FONT);
  if (a.anchor) {
    const g = geomOf(anchors, a.anchor);
    if (!g) return null;
    // 锚点下方第二车道（在指针文字之下），避免与指针/下标行重叠
    return [
      mkText(
        ctx,
        g.box.x + g.box.w / 2 - s.w / 2,
        g.box.y + g.box.h + POINTER_GAP + NOTE_LANE,
        a.text,
        color,
      ),
    ];
  }
  const b = ctx.bounds ?? { x: 0, y: 0, w: 0, h: 0 };
  // 无锚点批注放整体下方
  return [mkText(ctx, b.x, b.y + b.h + NOTE_GAP, a.text, color)];
}

export function resolveAnnotations(
  annotations: DslAnnotation[] | undefined,
  anchors: AnchorMap,
  ctx: AnnotationCtx,
): AnnotationsResult {
  const elements: WBElement[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(annotations)) return { elements, warnings };

  for (const a of annotations) {
    if (typeof a !== "object" || a === null) {
      warnings.push("标注非法，已跳过");
      continue;
    }
    let res: WBElement[] | null = null;
    switch (a.kind) {
      case "pointer":
        res = resolvePointer(a, anchors, ctx);
        if (!res) warnings.push(`pointer「${a.label}」锚点不存在，已跳过`);
        break;
      case "highlight":
        res = resolveHighlight(a, anchors, ctx);
        if (!res) warnings.push("highlight 锚点不存在，已跳过");
        break;
      case "window":
        res = resolveWindow(a, anchors, ctx);
        if (!res) warnings.push("window 锚点不存在，已跳过");
        break;
      case "note":
        res = resolveNote(a, anchors, ctx);
        if (!res) warnings.push(`note「${a.text}」锚点不存在，已跳过`);
        break;
      default:
        warnings.push("未知标注类型，已跳过");
    }
    if (res) elements.push(...res);
  }
  return { elements, warnings };
}
