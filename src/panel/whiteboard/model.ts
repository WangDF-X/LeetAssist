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
export interface WBRectElement extends WBElementBase {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface WBEllipseElement extends WBElementBase {
  type: "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
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
        out.push({ ...base, type: "rect", ...box });
        break;
      }
      case "ellipse": {
        const box = toBox(raw);
        if (!box) {
          dropped++;
          continue;
        }
        out.push({ ...base, type: "ellipse", ...box });
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
