import type { WBColorId, WBWidthId } from "../../theme";
import { genId as modelGenId, estimateTextSize, getElementBounds, type WBBox, type WBElement } from "../model";
import { newAnchorMap } from "./anchors";
import { buildStructure } from "./builders";
import { resolveAnnotations } from "./annotations";
import { normalizeDiagram } from "./validate";
import type { LlmDiagram } from "./schema";

const STRUCT_GAP = 48; // 多结构间的垂直间距

export interface CompileOptions {
  color: WBColorId;
  width: WBWidthId;
  genId?: (p?: string) => string;
}

export interface CompileResult {
  elements: WBElement[];
  dropped: number;
  warnings: string[];
}

function bboxOf(els: WBElement[]): WBBox | null {
  if (!els.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of els) {
    const b = getElementBounds(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 语义 DSL → WBElement[]（IR）。多结构默认纵向堆叠（x=0 对齐），整体由调用方居中。
 * 单个结构生成失败不拖垮整体：跳过并记 warning。
 */
export function compileDiagram(
  input: LlmDiagram | unknown,
  opts: CompileOptions,
): CompileResult {
  const genId = opts.genId ?? modelGenId;
  const { diagram, dropped, warnings } = normalizeDiagram(input);
  const elements: WBElement[] = [];
  const anchors = newAnchorMap();
  let cursorY = 0;

  for (const s of diagram.structures) {
    const ctx = { x: 0, y: cursorY, color: opts.color, width: opts.width, genId };
    try {
      const res = buildStructure(s, ctx);
      for (const [k, v] of res.anchors) anchors.set(k, v);
      elements.push(...res.elements);
      const box = bboxOf(res.elements);
      cursorY = box ? box.y + box.h + STRUCT_GAP : cursorY + STRUCT_GAP;
    } catch {
      warnings.push(`结构 ${s.id ?? s.kind} 生成失败，已跳过`);
    }
  }

  const bounds = bboxOf(elements) ?? undefined;
  const ann = resolveAnnotations(diagram.annotations, anchors, {
    color: opts.color,
    width: opts.width,
    genId,
    bounds,
  });
  elements.push(...ann.elements);
  warnings.push(...ann.warnings);

  // 图注最后渲染：置于"含标注"的整体包围盒上方，避免与标注/窗口标签重叠
  if (diagram.caption) {
    const b = bboxOf(elements) ?? { x: 0, y: 0, w: 0, h: 0 };
    const size = 18;
    const s = estimateTextSize(diagram.caption, size);
    elements.push({
      id: genId(),
      type: "text",
      x: b.x + b.w / 2 - s.w / 2,
      y: b.y - 8 - s.h,
      text: diagram.caption,
      size,
      color: opts.color,
      width: opts.width,
    });
  }

  return { elements, dropped, warnings };
}
