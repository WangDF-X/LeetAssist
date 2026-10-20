// 编译器：校验 → 逐结构 build+标注（为标注预留空间）→ 图级批注 → caption → 严格 IR 后置检查。
import type { WBColorId, WBWidthId } from "../../theme";
import {
  genId as modelGenId,
  estimateTextSize,
  getElementBounds,
  isBindable,
  type WBBox,
  type WBElement,
} from "../model";
import { newAnchorMap, type AnchorMap } from "./anchors";
import { buildStructure } from "./builders";
import { resolveAnnotations } from "./annotations";
import { validateDiagram, type IndexedAnnotation } from "./validate";
import { DIAG, type CompileResult, type DiagramDiagnostic } from "./result";
import { finalizeDiagnostics } from "./diagnostics";
import { LIMITS } from "./limits";
import { COLOR_SET } from "./schema-meta";
import type { DslAnnotation } from "./schema";

const STRUCT_GAP = 40; // 结构块之间的基础间距（标注已计入块高度）

/** 编译样式；缺省与当前工具条新建默认值一致（contract §4.3 / spec §4.6）。 */
export interface CompileOptions {
  color?: WBColorId;
  width?: WBWidthId;
  genId?: (p?: string) => string;
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

function translate(el: WBElement, dx: number, dy: number): WBElement {
  switch (el.type) {
    case "rect":
    case "ellipse":
    case "text":
      return { ...el, x: el.x + dx, y: el.y + dy };
    case "path":
      return { ...el, points: el.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
    case "connector":
      return {
        ...el,
        points: [
          el.points[0] + dx,
          el.points[1] + dy,
          el.points[2] + dx,
          el.points[3] + dy,
        ],
      };
  }
}

/** 标注归属的结构 id；图级 note 返回 null */
function annotationStruct(a: DslAnnotation): string | null {
  if (a.kind === "note") return a.anchor ? a.anchor.struct : null;
  if (a.kind === "window") return a.from.struct;
  return a.anchor.struct;
}

function irError(message: string): DiagramDiagnostic {
  return { code: DIAG.INVALID_IR, severity: "error", stage: "output", path: "", message };
}

function cpLen(s: string): number {
  return [...s].length;
}

function inFontRange(size: number | undefined): boolean {
  return size === undefined || (Number.isFinite(size) && size >= LIMITS.fontMin && size <= LIMITS.fontMax);
}

const WIDTH_SET = new Set(["thin", "medium", "thick"]);
const ARROWHEAD_SET = new Set(["none", "start", "end", "both"]);

/** 严格 IR 后置检查（diagram-contract §7）：不允许 sanitize/截断/解绑后当作成功。 */
function checkIR(elements: WBElement[]): DiagramDiagnostic | null {
  if (elements.length === 0) return irError("IR 为空");
  if (elements.length > LIMITS.irElements) return irError(`IR 元素数超过 ${LIMITS.irElements}`);

  const byId = new Map<string, WBElement>();
  for (const el of elements) {
    if (typeof el.id !== "string" || el.id.trim() === "" || cpLen(el.id) > LIMITS.textField)
      return irError("IR 元素 id 非法");
    if (byId.has(el.id)) return irError("IR 元素 id 重复");
    byId.set(el.id, el);
    if (!COLOR_SET.has(el.color)) return irError("IR 颜色非法");
    if (!WIDTH_SET.has(el.width)) return irError("IR 线宽非法");

    const b = getElementBounds(el);
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) return irError("IR 几何存在非有限值");
    if (b.w < 0 || b.h < 0) return irError("IR 尺寸非法");
    if (Math.abs(b.x) > LIMITS.coord || Math.abs(b.y) > LIMITS.coord) return irError("IR 坐标越界");
    if (b.w > LIMITS.size || b.h > LIMITS.size) return irError("IR 尺寸越界");

    switch (el.type) {
      case "text":
        if (typeof el.text !== "string" || cpLen(el.text) > LIMITS.noteText)
          return irError("IR 文本缺失或超长");
        if (!inFontRange(el.size)) return irError("IR 字号越界");
        break;
      case "rect":
      case "ellipse":
        if (el.label !== undefined && (typeof el.label !== "string" || cpLen(el.label) > LIMITS.textField))
          return irError("IR label 缺失或超长");
        if (!inFontRange(el.labelSize)) return irError("IR label 字号越界");
        break;
      case "path":
        if (
          !Array.isArray(el.points) ||
          el.points.length % 2 !== 0 ||
          !el.points.every((n) => Number.isFinite(n))
        )
          return irError("IR path 点位非法");
        break;
      case "connector":
        if (
          !Array.isArray(el.points) ||
          el.points.length !== 4 ||
          !el.points.every((n) => Number.isFinite(n))
        )
          return irError("IR connector 兜底点位非法");
        if (!ARROWHEAD_SET.has(el.arrowhead)) return irError("IR arrowhead 非法");
        if (el.label !== undefined && (typeof el.label !== "string" || cpLen(el.label) > LIMITS.textField))
          return irError("IR connector label 超长");
        if (!inFontRange(el.labelSize)) return irError("IR connector label 字号越界");
        break;
    }
  }

  for (const el of elements) {
    if (el.type !== "connector" || !el.connects) continue;
    if (el.connects.from !== undefined) {
      const target = byId.get(el.connects.from);
      if (!target) return irError("connector from 目标不存在");
      if (!isBindable(target)) return irError("connector from 目标不可绑定");
    }
    if (el.connects.to !== undefined) {
      const target = byId.get(el.connects.to);
      if (!target) return irError("connector to 目标不存在");
      if (!isBindable(target)) return irError("connector to 目标不可绑定");
    }
    if (el.connects.from !== undefined && el.connects.from === el.connects.to)
      return irError("connector 不得自连");
  }

  const overall = bboxOf(elements);
  if (!overall) return irError("IR 为空");
  if (overall.w > LIMITS.size || overall.h > LIMITS.size) return irError("IR 整体尺寸越界");
  if (
    Math.abs(overall.x) > LIMITS.coord ||
    Math.abs(overall.y) > LIMITS.coord ||
    Math.abs(overall.x + overall.w) > LIMITS.coord ||
    Math.abs(overall.y + overall.h) > LIMITS.coord
  )
    return irError("IR 整体坐标越界");
  return null;
}

export function compileDiagram(input: unknown, opts: CompileOptions = {}): CompileResult {
  const genId = opts.genId ?? modelGenId;
  const color = opts.color ?? "default";
  const width = opts.width ?? "medium";
  const v = validateDiagram(input);
  if (!v.ok) {
    return { status: "error", elements: [], droppedAnnotations: 0, diagnostics: finalizeDiagnostics(v.diagnostics) };
  }

  const diags: DiagramDiagnostic[] = [...v.diagnostics];
  const dedupedAnnotationIndices: number[] = [];
  let dropped = v.droppedAnnotations;

  // 按结构分组标注；无锚点 note 为图级
  const byStruct = new Map<string, IndexedAnnotation[]>();
  const globalAnns: IndexedAnnotation[] = [];
  for (const indexed of v.validAnnotations) {
    const sid = annotationStruct(indexed.value);
    if (!sid) {
      globalAnns.push(indexed);
      continue;
    }
    const arr = byStruct.get(sid) ?? [];
    arr.push(indexed);
    byStruct.set(sid, arr);
  }

  const blocks: { elements: WBElement[]; box: WBBox }[] = [];

  for (const s of v.diagram.structures) {
    let body: WBElement[];
    let anchors: AnchorMap;
    try {
      const res = buildStructure(s, { x: 0, y: 0, color, width, genId });
      body = res.elements;
      anchors = res.anchors;
    } catch {
      return {
        status: "error",
        elements: [],
        droppedAnnotations: 0,
        diagnostics: finalizeDiagnostics([
          ...diags,
          {
            code: DIAG.BUILD_FAILED,
            severity: "error",
            stage: "layout",
            path: `/structures/${v.diagram.structures.indexOf(s)}`,
            message: "结构生成异常",
          },
        ]),
      };
    }

    const bodyBox = bboxOf(body) ?? undefined;
    const ann = resolveAnnotations(byStruct.get(s.id!) ?? [], anchors, {
      color,
      width,
      genId,
      bounds: bodyBox,
    });
    diags.push(...ann.diagnostics);
    dedupedAnnotationIndices.push(...ann.dedupedIndices);
    dropped += ann.droppedAnnotations;
    if (ann.fatal) {
      return {
        status: "error",
        elements: [],
        droppedAnnotations: 0,
        diagnostics: finalizeDiagnostics([...diags, ann.fatal]),
      };
    }

    // 结构块 = 主体 + 本结构的有效标注；先收集，随后按最大宽度居中并纵向堆叠。
    const combined = [...body, ...ann.elements];
    const box = bboxOf(combined) ?? { x: 0, y: 0, w: 0, h: 0 };
    blocks.push({ elements: combined, box });
  }

  const elements: WBElement[] = [];
  const maxW = blocks.reduce((m, b) => Math.max(m, b.box.w), 0);
  let cursorY = 0;
  for (const block of blocks) {
    const dx = (maxW - block.box.w) / 2 - block.box.x;
    const dy = cursorY - block.box.y;
    for (const el of block.elements) elements.push(translate(el, dx, dy));
    cursorY += block.box.h + STRUCT_GAP;
  }

  // 图级批注：放在全部结构块下方
  if (globalAnns.length) {
    const overall = bboxOf(elements) ?? undefined;
    const g = resolveAnnotations(globalAnns, newAnchorMap(), {
      color,
      width,
      genId,
      bounds: overall,
    });
    diags.push(...g.diagnostics);
    dedupedAnnotationIndices.push(...g.dedupedIndices);
    dropped += g.droppedAnnotations;
    if (g.fatal) {
      return {
        status: "error",
        elements: [],
        droppedAnnotations: 0,
        diagnostics: finalizeDiagnostics([...diags, g.fatal]),
      };
    }
    elements.push(...g.elements);
  }

  // 图注最后渲染
  if (v.diagram.caption) {
    const b = bboxOf(elements) ?? { x: 0, y: 0, w: 0, h: 0 };
    const size = 18;
    const s = estimateTextSize(v.diagram.caption, size);
    elements.push({
      id: genId(),
      type: "text",
      x: b.x + b.w / 2 - s.w / 2,
      y: b.y - 8 - s.h,
      text: v.diagram.caption,
      size,
      color,
      width,
    });
  }

  const irErr = checkIR(elements);
  if (irErr) {
    return {
      status: "error",
      elements: [],
      droppedAnnotations: 0,
      diagnostics: finalizeDiagnostics([...diags, irErr]),
    };
  }

  return {
    status: dropped > 0 ? "partial" : "ok",
    elements,
    droppedAnnotations: dropped,
    dedupedAnnotationIndices,
    diagnostics: finalizeDiagnostics(diags),
  };
}
