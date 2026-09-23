// 画板元素模型与序列化（plan/03-whiteboard §4）。
// 设计要点：
// - 数据与 Konva 解耦：扁平元素数组，语义色/线宽 id（不含字面颜色），世界坐标。
// - 覆盖层与绘制层同构（同一 WBElement 模型），LLM 程序化生成 = 写 overlay 数组。
// - 校验管线（§4.4）：所有外部输入（加载存储 / 未来 LLM 输出）都过 sanitizeElements，
//   非法元素丢弃计数、字段 clamp、未知字段剥离、缺 id 自动生成。

import type { WBColorId, WBWidthId } from "../theme";

export interface WBElementBase {
  id: string;
  color: WBColorId;
  width: WBWidthId;
}

export interface WBPathElement extends WBElementBase {
  type: "path";
  points: number[]; // [x1,y1,x2,y2,...]
}
/** 矩形：x,y = 左上角。label = 图形内文字（居中渲染，§4.2 2026-09-22） */
export interface WBRectElement extends WBElementBase {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  labelSize?: number; // 缺省 16；V1 无 UI 修改，纯增量预留
}
/** 椭圆：x,y = 外接框左上角（与 rect 参数形态一致，降低 LLM 记忆负担） */
export interface WBEllipseElement extends WBElementBase {
  type: "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  labelSize?: number;
}
export interface WBArrowElement extends WBElementBase {
  type: "arrow";
  points: [number, number, number, number];
}
export interface WBLineElement extends WBElementBase {
  type: "line";
  points: [number, number, number, number];
}
export interface WBTextElement extends WBElementBase {
  type: "text";
  x: number;
  y: number;
  text: string;
  size?: number; // 缺省 16
}

export type WBElement =
  | WBPathElement
  | WBRectElement
  | WBEllipseElement
  | WBArrowElement
  | WBLineElement
  | WBTextElement;

export type WBElementType = WBElement["type"];

export interface WBViewState {
  scale: number; // 0.1–4
  offsetX: number;
  offsetY: number;
}

export interface WhiteboardScene {
  schemaVersion: number; // 当前 1
  elements: WBElement[]; // 绘制层：用户手绘
  overlay: WBElement[]; // 覆盖层：程序化生成（未来 AI 作图 / trace）
  view: WBViewState;
}

export const WB_SCENE_SCHEMA_VERSION = 1;

const COLOR_IDS: readonly WBColorId[] = [
  "default",
  "red",
  "blue",
  "green",
  "orange",
];
const WIDTH_IDS: readonly WBWidthId[] = ["thin", "medium", "thick"];

const DEFAULT_VIEW: WBViewState = { scale: 1, offsetX: 0, offsetY: 0 };

export function createEmptyScene(): WhiteboardScene {
  return {
    schemaVersion: WB_SCENE_SCHEMA_VERSION,
    elements: [],
    overlay: [],
    view: { ...DEFAULT_VIEW },
  };
}

let idCounter = 0;
/** 简单唯一 id（手绘无前缀；覆盖层程序化元素用 ov- 前缀，见 §4.4） */
export function genId(prefix = ""): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.floor(
    Math.random() * 1e6,
  ).toString(36)}`;
}

// ---------- 校验管线（§4.4） ----------

const MAX_COORD = 100000;
const MAX_SIZE = 100000;
const MIN_FONT = 8;
const MAX_FONT = 72;
const MAX_POINTS = 4000; // 单条 path 点位上限（抽稀后仍异常庞大则截断）

function num(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clampNum(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function clampCoord(n: number): number {
  return clampNum(n, -MAX_COORD, MAX_COORD);
}

function clampSize(n: number): number {
  return clampNum(n, 0, MAX_SIZE);
}

function toColorId(v: unknown): WBColorId {
  return COLOR_IDS.includes(v as WBColorId) ? (v as WBColorId) : "default";
}

function toWidthId(v: unknown): WBWidthId {
  return WIDTH_IDS.includes(v as WBWidthId) ? (v as WBWidthId) : "medium";
}

function baseOf(
  raw: Record<string, unknown>,
  overlay: boolean,
): WBElementBase {
  return {
    id:
      typeof raw.id === "string" && raw.id.length > 0
        ? raw.id.slice(0, 64)
        : genId(overlay ? "ov-" : ""),
    color: toColorId(raw.color),
    width: toWidthId(raw.width),
  };
}

function toPointArray(v: unknown, fixed?: number): number[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length % 2 !== 0) return null;
  if (fixed !== undefined && v.length !== fixed) return null;
  if (!v.every(num)) return null;
  return v.slice(0, MAX_POINTS * 2).map(clampCoord);
}

function toBox(raw: Record<string, unknown>) {
  if (!num(raw.x) || !num(raw.y) || !num(raw.w) || !num(raw.h)) return null;
  return {
    x: clampCoord(raw.x),
    y: clampCoord(raw.y),
    w: clampSize(raw.w),
    h: clampSize(raw.h),
  };
}

const MAX_LABEL_LEN = 200;

/** label 清洗（§4.2 2026-09-22）：非字符串剥离字段不丢元素；空/纯空白视为无 label */
function toLabelProps(raw: Record<string, unknown>): {
  label?: string;
  labelSize?: number;
} {
  if (typeof raw.label !== "string") return {};
  const label = raw.label.slice(0, MAX_LABEL_LEN);
  if (label.trim() === "") return {};
  const size = num(raw.labelSize)
    ? clampNum(Math.round(raw.labelSize), MIN_FONT, MAX_FONT)
    : undefined;
  return { label, ...(size !== undefined && { labelSize: size }) };
}

/**
 * 校验并清洗一组外部元素（§4.4）。
 * @returns elements 合法元素（z 序保持输入顺序）；dropped 被丢弃的数量
 */
export function sanitizeElements(
  input: unknown,
  opts: { overlay?: boolean } = {},
): { elements: WBElement[]; dropped: number } {
  if (!Array.isArray(input)) return { elements: [], dropped: input ? 1 : 0 };
  const overlay = opts.overlay ?? false;
  const out: WBElement[] = [];
  let dropped = 0;

  for (const item of input) {
    if (typeof item !== "object" || item === null) {
      dropped++;
      continue;
    }
    const raw = item as Record<string, unknown>;
    const base = baseOf(raw, overlay);
    switch (raw.type) {
      case "path": {
        const points = toPointArray(raw.points);
        if (!points || points.length < 4) {
          dropped++;
          continue;
        }
        out.push({ ...base, type: "path", points });
        break;
      }
      case "rect": {
        const box = toBox(raw);
        if (!box) {
          dropped++;
          continue;
        }
        out.push({ ...base, type: "rect", ...box, ...toLabelProps(raw) });
        break;
      }
      case "ellipse": {
        const box = toBox(raw);
        if (!box) {
          dropped++;
          continue;
        }
        out.push({ ...base, type: "ellipse", ...box, ...toLabelProps(raw) });
        break;
      }
      case "arrow": {
        const points = toPointArray(raw.points, 4);
        if (!points) {
          dropped++;
          continue;
        }
        out.push({
          ...base,
          type: "arrow",
          points: points as [number, number, number, number],
        });
        break;
      }
      case "line": {
        const points = toPointArray(raw.points, 4);
        if (!points) {
          dropped++;
          continue;
        }
        out.push({
          ...base,
          type: "line",
          points: points as [number, number, number, number],
        });
        break;
      }
      case "text": {
        if (!num(raw.x) || !num(raw.y) || typeof raw.text !== "string") {
          dropped++;
          continue;
        }
        out.push({
          ...base,
          type: "text",
          x: clampCoord(raw.x),
          y: clampCoord(raw.y),
          text: raw.text.slice(0, 2000),
          size: num(raw.size)
            ? clampNum(Math.round(raw.size), MIN_FONT, MAX_FONT)
            : 16,
        });
        break;
      }
      default:
        dropped++; // 未知 type：丢弃不崩溃（§4.4 扩展通道）
    }
  }
  return { elements: out, dropped };
}

function toViewState(v: unknown): WBViewState {
  if (typeof v !== "object" || v === null) return { ...DEFAULT_VIEW };
  const raw = v as Record<string, unknown>;
  return {
    scale: num(raw.scale) ? clampNum(raw.scale, 0.1, 4) : 1,
    offsetX: num(raw.offsetX) ? clampCoord(raw.offsetX) : 0,
    offsetY: num(raw.offsetY) ? clampCoord(raw.offsetY) : 0,
  };
}

export interface SanitizedScene {
  scene: WhiteboardScene;
  dropped: number;
}

/** 校验并清洗整个场景（加载存储时调用一次） */
export function sanitizeScene(input: unknown): SanitizedScene {
  if (typeof input !== "object" || input === null)
    return { scene: createEmptyScene(), dropped: 0 };
  const raw = input as Record<string, unknown>;
  const els = sanitizeElements(raw.elements);
  const ovs = sanitizeElements(raw.overlay, { overlay: true });
  return {
    scene: {
      schemaVersion: WB_SCENE_SCHEMA_VERSION,
      elements: els.elements,
      overlay: ovs.elements,
      view: toViewState(raw.view),
    },
    dropped: els.dropped + ovs.dropped,
  };
}

/** 序列化：坐标保留 1 位小数（§4.5 紧凑化） */
export function serializeScene(scene: WhiteboardScene): string {
  return JSON.stringify(scene, (_key, value: unknown) =>
    typeof value === "number"
      ? Math.round(value * 10) / 10
      : value,
  );
}

/** 反序列化：parse 失败返回 null，成功后过校验管线 */
export function deserializeScene(json: string): SanitizedScene | null {
  try {
    return sanitizeScene(JSON.parse(json));
  } catch {
    return null;
  }
}

// ---------- 几何 helpers（§4.4 统一 seam） ----------
// 消费方：label 超框撑大（本轮）、连线端点锚（connector 轮）、图元库预设尺寸（下一轮）。
// 全部为纯函数，估算度量即可（不做字体精确测量），后续功能不得回头改元素模型。

export const LABEL_DEFAULT_SIZE = 16; // label 缺省字号：与独立文本缺省一致
export const LABEL_PADDING = 8; // 文字与图形边缘的最小留白（世界 px，单边）

/** 文本尺寸估算：CJK/全角约 1em、其余约 0.6em；高度 = 行数 × 1.35em */
export function estimateTextSize(
  text: string,
  fontSize: number,
): { w: number; h: number } {
  const lines = text.length > 0 ? text.split("\n") : [""];
  let maxW = 0;
  for (const line of lines) {
    let w = 0;
    for (const ch of line)
      w += (ch.codePointAt(0) ?? 0) > 0x2e7f ? fontSize : fontSize * 0.6;
    if (w > maxW) maxW = w;
  }
  return { w: Math.ceil(maxW), h: Math.ceil(lines.length * fontSize * 1.35) };
}

export interface WBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function pointsBounds(points: number[]): WBBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 元素包围盒（世界坐标，不含线宽膨胀）。
 * 连线端点解析、图元对齐等一切"这个图形占多大地方"的问题都从这里取。
 */
export function getElementBounds(el: WBElement): WBBox {
  switch (el.type) {
    case "rect":
    case "ellipse":
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case "text": {
      const s = estimateTextSize(el.text, el.size ?? 16);
      return { x: el.x, y: el.y, w: s.w, h: s.h };
    }
    case "path":
      return pointsBounds(el.points);
    case "arrow":
    case "line": {
      const [x0, y0, x1, y1] = el.points;
      return {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      };
    }
  }
}

/**
 * label 超框撑大（§4.2）：以中心为锚放大 rect/ellipse 直到容纳文字估算尺寸 + padding。
 * 椭圆按内接矩形折算（系数 1.45 ≈ √2）。无需变化时原样返回（引用不变）。
 */
export function growShapeForLabel<T extends WBRectElement | WBEllipseElement>(
  el: T,
  label: string,
): T {
  const size = el.labelSize ?? LABEL_DEFAULT_SIZE;
  const t = estimateTextSize(label, size);
  const f = el.type === "ellipse" ? 1.45 : 1;
  const minW = t.w * f + LABEL_PADDING * 2;
  const minH = t.h * f + LABEL_PADDING * 2;
  if (el.w >= minW && el.h >= minH) return el;
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const w = Math.max(el.w, minW);
  const h = Math.max(el.h, minH);
  return { ...el, x: cx - w / 2, y: cy - h / 2, w, h };
}
