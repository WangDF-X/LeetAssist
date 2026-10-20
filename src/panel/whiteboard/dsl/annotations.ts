// 标注解析（diagram-contract.md §4.3）：读锚点表，把 pointer/highlight/window/note 编译成 IR。
// - 输入已通过语义校验；锚点缺失视为内部 BUILD_FAILED（不是输入容错）。
// - 同锚点多指针水平错位；相同标注无损去重；不同色 highlight 冲突 partial。
import type { WBColorId, WBWidthId } from "../../theme";
import {
  estimateTextSize,
  LABEL_DEFAULT_SIZE,
  type WBBox,
  type WBConnectorElement,
  type WBElement,
  type WBEllipseElement,
  type WBRectElement,
  type WBTextElement,
} from "../model";
import { anchorKey, type AnchorGeom, type AnchorMap } from "./anchors";
import type { DslAnnotation, DslAnchor, DslColor } from "./schema";
import { DIAG, type DiagramDiagnostic } from "./result";
import type { IndexedAnnotation } from "./validate";

export interface AnnotationCtx {
  color: WBColorId;
  width: WBWidthId;
  genId: (p?: string) => string;
  bounds?: WBBox;
}

export interface AnnotationResolveResult {
  elements: WBElement[];
  diagnostics: DiagramDiagnostic[];
  droppedAnnotations: number;
  /** 无损去重时保留的全部原始标注索引（contract §4.3.4）。 */
  dedupedIndices: number[];
  fatal?: DiagramDiagnostic; // 内部 BUILD_FAILED
}

const FONT = LABEL_DEFAULT_SIZE;
const PAD = 6; // window 外扩
const POINTER_GAP = 34; // 指针文字与锚点间距（留出下标行）
const POINTER_SPACING = 6; // 同锚点多指针水平间距
const NOTE_LANE = 30; // 批注在指针文字下方的偏移（03 spec §4.6）
const NOTE_GAP = 10; // 图级批注与包围盒的间距
const TEXT_W = "thin" as WBWidthId;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function geomOf(anchors: AnchorMap, a: DslAnchor): AnchorGeom | undefined {
  return anchors.get(anchorKey(a));
}

function colorOf(a: DslColor | undefined, ctx: AnnotationCtx): WBColorId {
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
  return { id: ctx.genId(), type: "text", x, y, text, size, color, width: TEXT_W };
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

function mkArrow(
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

function unionBox(boxes: WBBox[]): WBBox {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

/** 锚点对应的语义实体 key；链表 cell 与 node 等同一实体共享 entityKey。 */
function entityKeyOf(anchors: AnchorMap, a: DslAnchor): string {
  return geomOf(anchors, a)?.entityKey ?? anchorKey(a);
}

function coveredAnchors(a: Extract<DslAnnotation, { kind: "window" }>): DslAnchor[] {
  const out: DslAnchor[] = [];
  if (a.from.at === "cell" && a.to.at === "cell") {
    for (let i = a.from.index; i <= a.to.index; i++) out.push({ struct: a.from.struct, at: "cell", index: i });
  } else if (a.from.at === "cell2" && a.to.at === "cell2") {
    for (let r = a.from.row; r <= a.to.row; r++)
      for (let c = a.from.col; c <= a.to.col; c++)
        out.push({ struct: a.from.struct, at: "cell2", row: r, col: c });
  }
  return out;
}

function signature(
  a: DslAnnotation,
  ctx: AnnotationCtx,
  anchors: AnchorMap,
): string {
  const color = colorOf(a.color, ctx);
  switch (a.kind) {
    case "pointer":
      return JSON.stringify(["p", entityKeyOf(anchors, a.anchor), a.label, color]);
    case "highlight":
      return JSON.stringify(["h", entityKeyOf(anchors, a.anchor), color]);
    case "window":
      return JSON.stringify([
        "w",
        entityKeyOf(anchors, a.from),
        entityKeyOf(anchors, a.to),
        a.label ?? "",
        color,
      ]);
    case "note":
      return JSON.stringify([
        "n",
        a.anchor ? entityKeyOf(anchors, a.anchor) : null,
        a.text,
        color,
      ]);
  }
}

export function resolveAnnotations(
  annotations: IndexedAnnotation[] | undefined,
  anchors: AnchorMap,
  ctx: AnnotationCtx,
): AnnotationResolveResult {
  const elements: WBElement[] = [];
  const diagnostics: DiagramDiagnostic[] = [];
  const dedupedIndices: number[] = [];
  let droppedAnnotations = 0;
  let fatal: DiagramDiagnostic | undefined;

  const fail = (path: string, message: string, index?: number): void => {
    fatal ??= {
      code: DIAG.BUILD_FAILED,
      severity: "error",
      stage: "annotation",
      path,
      message,
      ...(index !== undefined ? { annotationIndex: index } : {}),
    };
  };

  const list = Array.isArray(annotations) ? annotations : [];

  // 去重 + 冲突检测（语义实体已由校验保证合法）
  const seen = new Map<string, number[]>();
  const highlightColor = new Map<string, string>();
  const kept: IndexedAnnotation[] = [];
  for (const entry of list) {
    const a = entry.value;
    const sig = signature(a, ctx, anchors);
    const prevIndices = seen.get(sig);
    if (prevIndices) {
      // 无损去重：不计 dropped，但保留全部来源索引。
      prevIndices.push(entry.index);
      dedupedIndices.push(entry.index);
      continue;
    }
    seen.set(sig, [entry.index]);
    if (a.kind === "highlight") {
      const key = entityKeyOf(anchors, a.anchor);
      const color = colorOf(a.color, ctx);
      const prev = highlightColor.get(key);
      if (prev !== undefined && prev !== color) {
        droppedAnnotations++;
        diagnostics.push({
          code: DIAG.ANNOTATION_CONFLICT,
          severity: "warning",
          stage: "annotation",
          path: `/annotations/${entry.index}`,
          message: "同一实体存在不同颜色的 highlight，保留先出现者",
          annotationIndex: entry.index,
        });
        continue;
      }
      highlightColor.set(key, color);
    }
    kept.push(entry);
  }

  // 1) 高亮 / 范围框
  for (const entry of kept) {
    const a = entry.value;
    if (a.kind === "highlight") {
      const g = geomOf(anchors, a.anchor);
      if (!g) {
        fail(`/annotations/${entry.index}/anchor`, "合法 highlight 锚点未被 builder 登记", entry.index);
        continue;
      }
      const color = colorOf(a.color, ctx);
      elements.push(
        g.shape === "ellipse"
          ? mkEllipse(ctx, g.box.x, g.box.y, g.box.w, g.box.h, color)
          : mkRect(ctx, g.box.x, g.box.y, g.box.w, g.box.h, color),
      );
    } else if (a.kind === "window") {
      const covered = coveredAnchors(a);
      const geoms = covered.map((an) => geomOf(anchors, an));
      if (geoms.some((g) => !g)) {
        fail(`/annotations/${entry.index}`, "合法 window 覆盖的实体未被 builder 全部登记", entry.index);
        continue;
      }
      const b = unionBox(geoms.map((g) => g!.box));
      const color = colorOf(a.color, ctx);
      elements.push(mkRect(ctx, b.x - PAD, b.y - PAD, b.w + PAD * 2, b.h + PAD * 2, color));
      if (a.label) {
        const size = estimateTextSize(a.label, FONT);
        elements.push(
          mkText(ctx, b.x + (b.w - size.w) / 2, b.y - PAD - size.h - 2, a.label, color),
        );
      }
    }
  }

  // 2) 指针：同一实体（含链表 cell/node）水平错位，不合并 label、不改指向。
  const pointerGroups = new Map<
    string,
    { geom: AnchorGeom; items: Extract<DslAnnotation, { kind: "pointer" }>[] }
  >();
  for (const entry of kept) {
    const a = entry.value;
    if (a.kind !== "pointer") continue;
    const key = entityKeyOf(anchors, a.anchor);
    const g = geomOf(anchors, a.anchor);
    if (!g) {
      fail(`/annotations/${entry.index}/anchor`, "合法 pointer 锚点未被 builder 登记", entry.index);
      continue;
    }
    const group = pointerGroups.get(key);
    if (group) group.items.push(a);
    else pointerGroups.set(key, { geom: g, items: [a] });
  }
  for (const { geom: g, items: group } of pointerGroups.values()) {
    const widths = group.map((p) => estimateTextSize(p.label, FONT).w);
    const total = widths.reduce((a, b) => a + b, 0) + POINTER_SPACING * (group.length - 1);
    let cursor = g.box.x + g.box.w / 2 - total / 2;
    group.forEach((p, i) => {
      const color = colorOf(p.color, ctx);
      const w = widths[i];
      const cx = cursor + w / 2;
      const textTop = g.box.y + g.box.h + POINTER_GAP;
      elements.push(mkText(ctx, cursor, textTop, p.label, color));
      const targetX = clamp(cx, g.box.x + 4, g.box.x + g.box.w - 4);
      elements.push(mkArrow(ctx, [cx, textTop], [targetX, g.box.y + g.box.h + 2], color));
      cursor += w + POINTER_SPACING;
    });
  }

  // 3) 批注（有锚点：指针下方第二车道；无锚点：整体下方）
  const noteLane = new Map<string, number>();
  for (const entry of kept) {
    const a = entry.value;
    if (a.kind !== "note") continue;
    const color = colorOf(a.color, ctx);
    if (a.anchor) {
      const g = geomOf(anchors, a.anchor);
      if (!g) {
        fail(`/annotations/${entry.index}/anchor`, "合法 note 锚点未被 builder 登记", entry.index);
        continue;
      }
      const key = entityKeyOf(anchors, a.anchor);
      const n = noteLane.get(key) ?? 0;
      noteLane.set(key, n + 1);
      const s = estimateTextSize(a.text, FONT);
      const x = g.box.x + g.box.w / 2 - s.w / 2;
      const y = g.box.y + g.box.h + POINTER_GAP + NOTE_LANE + n * (s.h + 4);
      elements.push(mkText(ctx, x, y, a.text, color));
    } else {
      const b = ctx.bounds ?? { x: 0, y: 0, w: 0, h: 0 };
      const n = noteLane.get("-") ?? 0;
      noteLane.set("-", n + 1);
      const s = estimateTextSize(a.text, FONT);
      const y = b.y + b.h + NOTE_GAP + n * (s.h + 4);
      elements.push(mkText(ctx, b.x, y, a.text, color));
    }
  }

  // 合法标注仅视觉拥挤时给 LAYOUT_OVERLAP warning；不增加 dropped、不改变 ok。
  const textBoxes = elements
    .filter((el): el is WBTextElement => el.type === "text")
    .map((el) => ({ x: el.x, y: el.y, ...estimateTextSize(el.text, el.size ?? FONT) }));
  let overlapped = false;
  for (let i = 0; i < textBoxes.length && !overlapped; i++) {
    for (let j = i + 1; j < textBoxes.length; j++) {
      const a = textBoxes[i];
      const b = textBoxes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) {
        overlapped = true;
        break;
      }
    }
  }
  if (overlapped)
    diagnostics.push({
      code: DIAG.LAYOUT_OVERLAP,
      severity: "warning",
      stage: "layout",
      path: "",
      message: "标注文字存在重叠，布局可能拥挤",
    });

  return {
    elements,
    diagnostics,
    droppedAnnotations,
    dedupedIndices,
    ...(fatal ? { fatal } : {}),
  };
}
