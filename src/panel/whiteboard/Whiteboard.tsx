// 画板画布容器（plan/03-whiteboard §5）：
// - 三层架构：背景层（网格）/ 绘制层（手绘，可交互）/ 覆盖层（程序化，留门）
// - 六工具：选择/画笔/矩形/圆形/箭头/文本；拖拽绘制、选中变换（Transformer 仅缩放）
// - 图形内文字 label：rect/ellipse 带居中文字（节点=单元素，§4.2），三入口编辑+超框自动撑大
// - 撤销/重做（快照栈 50 步）；清空二次确认；快捷键 hover 门控（§5.2）
// - 滚轮缩放（光标中心 0.1–4）；Space+拖动平移；ResizeObserver 尺寸跟随
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Stage,
  Layer,
  Line,
  Rect,
  Ellipse,
  Arrow,
  Text,
  Shape,
  Group,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import simplify from "simplify-js";
import type { ResolvedTheme, GridMode, WBColorId, WBWidthId } from "../theme";
import { WB_COLORS, WB_WIDTHS, WB_GRID_COLORS } from "../theme";
import type { WBElement, WBTextElement, WBViewState } from "./model";
import { genId, growShapeForLabel, LABEL_DEFAULT_SIZE } from "./model";
import { HistoryStack } from "./HistoryStack";
import {
  DEFAULT_BINDINGS,
  loadBindings,
  matchKey,
  type WBBindings,
} from "./bindings";
import {
  WhiteboardToolbar,
  WhiteboardAttrBar,
  type WBTool,
} from "./Toolbar";
import { TextEditor } from "./TextEditor";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const GRID_GAP = 24;
const MIN_DRAG = 3; // 世界坐标下小于该位移视为误触，不生成图形
const DRAG_DISTANCE = 3; // 元素拖动阈值：小于该屏幕位移视为"点击"（选中），避免手抖变拖动

/** 背景网格：单个 Shape + sceneFunc 直接 canvas 绘制（替代每点一个节点——
 *  缩小到 20% 时可见世界范围扩大 25 倍，节点数会爆炸到 2 万+ 卡死渲染）。
 *  间距按缩放自适应放大，屏幕密度保持恒定。 */
function GridShape({
  theme,
  gridMode,
  view,
  size,
}: {
  theme: ResolvedTheme;
  gridMode: GridMode;
  view: WBViewState;
  size: Size;
}) {
  const color = WB_GRID_COLORS[theme];
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        if (gridMode === "none") return;
        const c = ctx._context; // 原生 CanvasRenderingContext2D，直接绘制最快
        // 自适应间距：屏幕上太密（<10px）就按 2 的幂放大世界间距
        let gap = GRID_GAP;
        while (gap * view.scale < 10) gap *= 2;
        const x0 = Math.floor(-view.offsetX / view.scale / gap) * gap;
        const x1 = (size.w - view.offsetX) / view.scale + gap;
        const y0 = Math.floor(-view.offsetY / view.scale / gap) * gap;
        const y1 = (size.h - view.offsetY) / view.scale + gap;
        if (gridMode === "lines") {
          c.beginPath();
          c.strokeStyle = color;
          c.lineWidth = 1 / view.scale;
          for (let x = x0; x <= x1; x += gap) {
            c.moveTo(x, y0);
            c.lineTo(x, y1);
          }
          for (let y = y0; y <= y1; y += gap) {
            c.moveTo(x0, y);
            c.lineTo(x1, y);
          }
          c.stroke();
        } else {
          // 点阵：以间隔交点为中心的小方块（fillRect 比 arc 快）
          c.fillStyle = color;
          const r = 1.2 / view.scale;
          for (let x = x0; x <= x1; x += gap)
            for (let y = y0; y <= y1; y += gap)
              c.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }}
    />
  );
}

export interface WhiteboardProps {
  theme: ResolvedTheme;
  gridMode: GridMode;
  /** 面板拖拽移动（01 §3.4：左栏顶部工具行是拖拽区） */
  onDragPanel: (e: React.PointerEvent) => void;
}

interface Size {
  w: number;
  h: number;
}

interface DraftState {
  type: "pen" | "rect" | "ellipse" | "arrow";
  startX: number;
  startY: number;
  points: number[]; // pen: 累积点; rect/ellipse/arrow: [x0,y0,x1,y1]
}

/** 编辑目标：独立文本 or 图形内 label（§5.4 两套编辑语义） */
type EditTarget = { kind: "text" | "label"; id: string };

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** 单个元素 → Konva 节点（语义色/线宽按主题映射，§4.2）
 *  交互模型（§5.4，2026-09-22 用户修正版）：
 *  - movable：画笔态一律不可拖；选择态仅已选中可拖；其他绘制工具=已有图形可直接拖
 *    （新建起笔由 Stage pointerdown 的 e.target 守卫让位给拖动）
 *  - selectable：选择态可点击选中；点击已选中文本进入编辑
 */
function ElementNode({
  el,
  theme,
  movable,
  selectable,
  hideLabel,
  nodeRef,
  onSelect,
  onHoverCursor,
  onDragEnd,
  onTransformEnd,
}: {
  el: WBElement;
  theme: ResolvedTheme;
  movable: boolean;
  selectable: boolean;
  /** label 编辑中：图形保留、图形内文字隐藏（textarea 覆盖其上，§5.4） */
  hideLabel: boolean;
  nodeRef: (id: string, node: Konva.Node | null) => void;
  onSelect: (id: string) => void;
  onHoverCursor: (cursor: string) => void;
  onDragEnd: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (id: string, e: Konva.KonvaEventObject<Event>) => void;
}) {
  const stroke = WB_COLORS[el.color][theme];
  const strokeWidth = WB_WIDTHS[el.width];
  const common = {
    id: el.id,
    ref: (n: Konva.Node | null) => nodeRef(el.id, n),
    draggable: movable,
    dragDistance: DRAG_DISTANCE, // 小抖动算点击（可选中），超过阈值才算拖动
    onClick: () => selectable && onSelect(el.id),
    onTap: () => selectable && onSelect(el.id),
    onMouseEnter: movable ? () => onHoverCursor("move") : undefined,
    onMouseLeave: movable ? () => onHoverCursor("") : undefined,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
      movable && onDragEnd(el.id, e),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) =>
      selectable && onTransformEnd(el.id, e),
  };
  switch (el.type) {
    case "path":
      return (
        <Line
          {...common}
          points={el.points}
          stroke={stroke}
          strokeWidth={strokeWidth}
          lineCap="round"
          lineJoin="round"
          tension={0.4}
          hitStrokeWidth={Math.max(strokeWidth, 12)}
        />
      );
    case "rect": {
      const label = !hideLabel && el.label && el.label.trim() !== "" ? el.label : null;
      return (
        <Group {...common} x={el.x} y={el.y}>
          <Rect
            width={el.w}
            height={el.h}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          {label && (
            <Text
              width={el.w}
              height={el.h}
              align="center"
              verticalAlign="middle"
              text={label}
              fontSize={el.labelSize ?? LABEL_DEFAULT_SIZE}
              fill={stroke}
              listening={false}
            />
          )}
        </Group>
      );
    }
    case "ellipse": {
      const label = !hideLabel && el.label && el.label.trim() !== "" ? el.label : null;
      return (
        <Group {...common} x={el.x} y={el.y}>
          <Ellipse
            x={el.w / 2}
            y={el.h / 2}
            radiusX={el.w / 2}
            radiusY={el.h / 2}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
          {label && (
            <Text
              width={el.w}
              height={el.h}
              align="center"
              verticalAlign="middle"
              text={label}
              fontSize={el.labelSize ?? LABEL_DEFAULT_SIZE}
              fill={stroke}
              listening={false}
            />
          )}
        </Group>
      );
    }
    case "arrow":
      return (
        <Arrow
          {...common}
          points={el.points}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill={stroke}
          pointerLength={8}
          pointerWidth={7}
          hitStrokeWidth={Math.max(strokeWidth, 12)}
        />
      );
    case "line":
      return (
        <Line
          {...common}
          points={el.points}
          stroke={stroke}
          strokeWidth={strokeWidth}
          lineCap="round"
          hitStrokeWidth={Math.max(strokeWidth, 12)}
        />
      );
    case "text":
      return (
        <Text
          {...common}
          x={el.x}
          y={el.y}
          text={el.text}
          fontSize={el.size ?? 16}
          fill={stroke}
        />
      );
  }
}

export function Whiteboard({ theme, gridMode, onDragPanel }: WhiteboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodesRef = useRef(new Map<string, Konva.Node>());

  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [elements, setElements] = useState<WBElement[]>([]);
  const [view, setView] = useState<WBViewState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [tool, setTool] = useState<WBTool>("pen");
  const [color, setColor] = useState<WBColorId>("default");
  const [width, setWidth] = useState<WBWidthId>("medium");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null); // 正在编辑的文本/label 目标
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [panning, setPanning] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [historyTick, setHistoryTick] = useState(0); // 驱动撤销/重做按钮可用态

  const historyRef = useRef(new HistoryStack());
  // 交互绑定（快捷键/右键行为）：默认 + 用户覆盖（bindings.ts，自定义功能后续做）
  const [bindings, setBindings] = useState<WBBindings>(DEFAULT_BINDINGS);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  useEffect(() => {
    loadBindings().then(setBindings);
  }, []);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const spaceRef = useRef(false);
  const hoverRef = useRef(false);
  const justDraggedRef = useRef(false); // 刚完成拖动：用于忽略紧随的 click
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  // ---------- 基础设施 ----------

  const registerNode = useCallback((id: string, node: Konva.Node | null) => {
    if (node) nodesRef.current.set(id, node);
    else nodesRef.current.delete(id);
  }, []);

  // Transformer 跟随选中元素（§5.4：仅缩放手柄）
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? nodesRef.current.get(selectedId) : null;
    tr.nodes(node ? [node] : []);
  }, [selectedId, elements]);

  // 切工具时取消选中/草稿/编辑
  useEffect(() => {
    setSelectedId(null);
    setDraft(null);
    setEditing(null);
  }, [tool]);

  // 容器尺寸跟随（布局尺寸 contentRect，避免开场动画 transform 干扰）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = (w: number, h: number) =>
      setSize({ w: Math.max(0, Math.floor(w)), h: Math.max(0, Math.floor(h)) });
    apply(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) apply(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- 提交型编辑（写历史） ----------

  const commitElements = useCallback((next: WBElement[]) => {
    historyRef.current.push(elementsRef.current);
    setElements(next);
    setHistoryTick((t) => t + 1);
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.undo(elementsRef.current);
    if (prev) {
      setElements(prev);
      setSelectedId(null);
      setEditing(null);
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const redo = useCallback(() => {
    const next = historyRef.current.redo(elementsRef.current);
    if (next) {
      setElements(next);
      setSelectedId(null);
      setEditing(null);
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const deleteSelected = useCallback(() => {
    const id = selectedRef.current;
    if (!id) return;
    commitElements(elementsRef.current.filter((el) => el.id !== id));
    setSelectedId(null);
    setEditing(null);
  }, [commitElements]);

  // ---------- 快捷键（§5.2 hover 门控；绑定来自 bindings.ts 配置，不写死） ----------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!hoverRef.current) return; // 门控：不在画板区域不响应
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input, [contenteditable]")) return; // 文本编辑中让行
      const b = bindingsRef.current;

      if (matchKey(b.redo, e)) {
        e.preventDefault();
        redo();
        return;
      }
      if (matchKey(b.undo, e)) {
        e.preventDefault();
        undo();
        return;
      }
      if (b.delete.includes(e.key)) {
        if (selectedRef.current) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (e.code === b.pan) {
        spaceRef.current = true;
        setPanning(true);
        e.preventDefault();
        return;
      }
      const t = b.tools[e.key.toLowerCase()];
      if (t && !e.ctrlKey && !e.metaKey && !e.altKey) setTool(t);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === bindingsRef.current.pan) {
        spaceRef.current = false;
        setPanning(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [undo, redo, deleteSelected]);

  // ---------- 视图（缩放/平移） ----------

  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    setView((v) => {
      const scaleBy = 1.08;
      const next = clampScale(
        e.evt.deltaY < 0 ? v.scale * scaleBy : v.scale / scaleBy,
      );
      const worldX = (pointer.x - v.offsetX) / v.scale;
      const worldY = (pointer.y - v.offsetY) / v.scale;
      return {
        scale: next,
        offsetX: pointer.x - worldX * next,
        offsetY: pointer.y - worldY * next,
      };
    });
  }, []);

  const onStageDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (e.target !== stageRef.current) return; // 元素拖拽走 onDragEnd
      setView((v) => ({ ...v, offsetX: e.target.x(), offsetY: e.target.y() }));
    },
    [],
  );

  const resetView = useCallback(() => {
    setView({ scale: 1, offsetX: 0, offsetY: 0 });
  }, []);

  // 屏幕坐标 → 世界坐标
  const toWorld = useCallback((p: { x: number; y: number }) => {
    return {
      x: (p.x - view.offsetX) / view.scale,
      y: (p.y - view.offsetY) / view.scale,
    };
  }, [view]);

  // ---------- 绘制交互 ----------

  const onPointerDown = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      if (panning || e.evt.button !== 0) return;
      justDraggedRef.current = false; // 新一次按下：清除拖动守卫
      const stage = stageRef.current;
      const pointer = stage?.getPointerPosition();
      if (!pointer) return;
      const w = toWorld(pointer);
      const t = toolRef.current;

      // 点空白处清除选中（所有工具通用；绘制工具随后照常起笔新建）
      if (e.target === stage) setSelectedId(null);

      if (t === "select") {
        return; // 点中元素由 ElementNode.onClick 处理
      }
      if (t === "text") {
        // 文本工具：点击处创建文本元素并立即进入编辑（§5.1）
        // 注意：先不入历史，等文本提交时再 commitElements（取消/空文本则静默移除）
        if (e.target !== stage) return; // 点在已有元素上不新建（让位给拖动/双击编辑）
        const el: WBTextElement = {
          id: genId(),
          type: "text",
          color,
          width,
          x: w.x,
          y: w.y,
          text: "",
        };
        setElements([...elementsRef.current, el]);
        setEditing({ kind: "text", id: el.id });
        return;
      }
      const type = t as DraftState["type"];
      // 画笔：一律起笔——即使起点落在已有笔画上（画笔态元素不可拖，无让位问题）
      // 矩形/圆形/箭头：点中已有元素（非 Stage）时不起笔，让位给该元素的直接拖动
      // （图形走边缘热区、文本走整块区域；从空白处按下才画新图形，§5.4 分工具规则）
      if (type !== "pen" && e.target !== stage) return;
      setDraft({ type, startX: w.x, startY: w.y, points: [w.x, w.y] });
    },
    [panning, toWorld, color, width],
  );

  const onPointerMove = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      if (!draft) return;
      const pointer = stageRef.current?.getPointerPosition();
      if (!pointer) return;
      const w = toWorld(pointer);
      setDraft((d) => {
        if (!d) return d;
        if (d.type === "pen") {
          // 画笔：累积点（距离过近则跳过，减小数据量）
          const n = d.points.length;
          const lx = d.points[n - 2];
          const ly = d.points[n - 1];
          if (Math.hypot(w.x - lx, w.y - ly) < 1.5) return d;
          return { ...d, points: [...d.points, w.x, w.y] };
        }
        return { ...d, points: [d.startX, d.startY, w.x, w.y] };
      });
      void e;
    },
    [draft, toWorld],
  );

  const onPointerUp = useCallback(() => {
    if (!draft) return;
    const base = { color, width };
    let el: WBElement | null = null;
    if (draft.type === "pen") {
      if (draft.points.length >= 4) {
        // 入库前 simplify-js 抽稀（§4.5）
        const pairs = [];
        for (let i = 0; i < draft.points.length; i += 2)
          pairs.push({ x: draft.points[i], y: draft.points[i + 1] });
        const simplified = simplify(pairs, 1.0, false);
        const pts = simplified.flatMap((p) => [p.x, p.y]);
        // 最小路径过滤：双击/误触产生的极小笔迹（包围盒 < 2px）不落库
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          minX = Math.min(minX, pts[i]);
          maxX = Math.max(maxX, pts[i]);
          minY = Math.min(minY, pts[i + 1]);
          maxY = Math.max(maxY, pts[i + 1]);
        }
        const bigEnough =
          pts.length >= 4 && Math.max(maxX - minX, maxY - minY) >= 2;
        if (bigEnough) el = { ...base, id: genId(), type: "path", points: pts };
      }
    } else {
      const [x0, y0, x1, y1] = draft.points;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      if (Math.max(dx, dy) >= MIN_DRAG) {
        if (draft.type === "rect")
          el = {
            ...base,
            id: genId(),
            type: "rect",
            x: Math.min(x0, x1),
            y: Math.min(y0, y1),
            w: dx,
            h: dy,
          };
        else if (draft.type === "ellipse")
          el = {
            ...base,
            id: genId(),
            type: "ellipse",
            x: Math.min(x0, x1),
            y: Math.min(y0, y1),
            w: dx,
            h: dy,
          };
        else if (draft.type === "arrow")
          el = {
            ...base,
            id: genId(),
            type: "arrow",
            points: [x0, y0, x1, y1],
          };
      }
    }
    setDraft(null);
    if (el) {
      commitElements([...elementsRef.current, el]);
      // 新画完矩形/椭圆自动进入 label 编辑（§5.2/§5.4；Esc 或空提交则跳过，图形保留）
      if (el.type === "rect" || el.type === "ellipse")
        setEditing({ kind: "label", id: el.id });
    }
  }, [draft, color, width, commitElements]);

  // ---------- 文本编辑（§5.1/§5.2：双击已有文本重编、右键快速输入） ----------

  /** 双击进入编辑：非选择态生效。文本→改文字；矩形/椭圆→改 label（§5.4）。
   *  选择态文本/图形走"点击→边框→再点"路径，与此一致。2026-09-22 扩展到 label） */
  const onTextDoubleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (toolRef.current === "select") return;
      // rect/ellipse 渲染为 Group：命中节点是无 id 子图形，向上找带 id 的祖先
      let node: Konva.Node | null = e.target;
      while (node && !node.id()) node = node.getParent() as Konva.Node | null;
      const id = node?.id();
      if (!id) return;
      const el = elementsRef.current.find((x) => x.id === id);
      if (!el) return;
      if (el.type === "text") {
        setSelectedId(null);
        setEditing({ kind: "text", id });
      } else if (el.type === "rect" || el.type === "ellipse") {
        setSelectedId(null);
        setEditing({ kind: "label", id });
      }
    },
    [],
  );

  /** 右键（画布任意工具状态下）：拦截默认菜单，在点击处快速输入文本（§5.2）
   *  行为来自 bindings.contextMenu 配置（未来可在设置中改为其他动作） */
  const onContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      if (panning) return;
      if (bindingsRef.current.contextMenu !== "quickText") return;
      const pointer = stageRef.current?.getPointerPosition();
      if (!pointer) return;
      const w = toWorld(pointer);
      const el: WBTextElement = {
        id: genId(),
        type: "text",
        color,
        width,
        x: w.x,
        y: w.y,
        text: "",
      };
      setElements([...elementsRef.current, el]); // 提交时才入历史
      setEditing({ kind: "text", id: el.id });
    },
    [panning, toWorld, color, width],
  );

  /** 编辑完成（§5.4 两套语义）：
   *  - 独立文本：空提交=删除元素（新建未提交则静默移除不入历史）；
   *  - 图形 label：空提交=仅移除 label 不删图形；非空提交自动撑大容纳（§4.2） */
  const finishEdit = useCallback(
    (target: EditTarget, text: string, commit: boolean) => {
      setEditing(null);
      const cur = elementsRef.current;
      const el = cur.find((x) => x.id === target.id);
      if (!el) return;
      const trimmed = text.trim();

      if (target.kind === "text") {
        if (el.type !== "text") return;
        const isNew = el.text === ""; // 空文本元素只可能处于"新建未提交"态
        if (!commit || trimmed === "") {
          if (isNew) {
            // 新建未提交/空内容：静默移除（不入历史）
            setElements(cur.filter((x) => x.id !== el.id));
          } else if (commit && trimmed === "") {
            // 旧文本被清空：作为删除提交
            commitElements(cur.filter((x) => x.id !== el.id));
          }
          // else：取消编辑旧文本，无变化
          return;
        }
        // 提交非空文本（新建首次提交 / 旧文本修改统一走这里）
        commitElements(
          cur.map((x) =>
            x.id === el.id && x.type === "text" ? { ...x, text: trimmed } : x,
          ),
        );
        return;
      }

      // kind === "label"
      if (el.type !== "rect" && el.type !== "ellipse") return;
      if (!commit || trimmed === "") {
        // 取消：无变化；空提交：只移除 label，不删图形
        if (commit && trimmed === "" && el.label)
          commitElements(
            cur.map((x) =>
              x.id === el.id && (x.type === "rect" || x.type === "ellipse")
                ? { ...x, label: undefined }
                : x,
            ),
          );
        return;
      }
      commitElements(
        cur.map((x) =>
          x.id === el.id && (x.type === "rect" || x.type === "ellipse")
            ? growShapeForLabel({ ...x, label: trimmed }, trimmed)
            : x,
        ),
      );
    },
    [commitElements],
  );

  const onSelect = useCallback((id: string) => {
    if (toolRef.current === "pen") return; // 画笔态不选中（避免与起笔冲突）
    // 拖动结束后的 click 忽略，避免"拖完误改选中/误进入编辑"
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    // 仅选择态：已选中（边框已显示）再次点击 → 进入编辑（§5.4）
    // 绘制态编辑走双击，这里一律只做"选中"（供 Delete 删除）
    if (toolRef.current === "select" && selectedRef.current === id) {
      const el = elementsRef.current.find((x) => x.id === id);
      if (!el) return;
      if (el.type === "text") {
        setSelectedId(null);
        setEditing({ kind: "text", id });
      } else if (el.type === "rect" || el.type === "ellipse") {
        setEditing({ kind: "label", id }); // 保持选中，编辑框覆盖在图形中心
      }
      return;
    }
    setSelectedId(id);
  }, []);

  const onElementDragEnd = useCallback(
    (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
      justDraggedRef.current = true; // 忽略拖动结束后可能触发的 click
      const node = e.target;
      const cur = elementsRef.current;
      const target = cur.find((el) => el.id === id);
      if (!target) return;
      let next: WBElement[];
      switch (target.type) {
        case "rect":
        case "ellipse":
        case "text": {
          // rect/ellipse 渲染为 Group（原点在左上角 el.x/el.y）、text 同为左上角，
          // Konva 拖拽后 node.x()/y() 即新位置，直接用（ellipse 不再中心偏移）
          next = cur.map((el) =>
            el.id === id &&
            (el.type === "rect" || el.type === "ellipse" || el.type === "text")
              ? { ...el, x: node.x(), y: node.y() }
              : el,
          );
          break;
        }
        default: {
          // path/arrow/line：节点原点在 (0,0)，x/y 即位移量，并入 points 后归零
          const dx = node.x();
          const dy = node.y();
          next = cur.map((el) => {
            if (el.id !== id) return el;
            if (el.type === "path")
              return {
                ...el,
                points: el.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)),
              };
            if (el.type === "arrow" || el.type === "line")
              return {
                ...el,
                points: [
                  el.points[0] + dx,
                  el.points[1] + dy,
                  el.points[2] + dx,
                  el.points[3] + dy,
                ] as [number, number, number, number],
              };
            return el;
          });
          node.position({ x: 0, y: 0 });
        }
      }
      commitElements(next);
    },
    [commitElements],
  );

  const onElementTransformEnd = useCallback(
    (id: string, _e: Konva.KonvaEventObject<Event>) => {
      const node = nodesRef.current.get(id);
      const target = elementsRef.current.find((el) => el.id === id);
      if (!node || !target) return;
      const sx = node.scaleX();
      const sy = node.scaleY();
      if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;

      const next = elementsRef.current.map((el): WBElement => {
        if (el.id !== id) return el;
        switch (el.type) {
          case "rect":
          case "ellipse": {
            // Group 原点=左上角，缩放直接乘 w/h（label 子节点尺寸随组缩放，提交后归一）
            return {
              ...el,
              x: node.x(),
              y: node.y(),
              w: Math.max(1, el.w * sx),
              h: Math.max(1, el.h * sy),
            };
          }
          case "path": {
            return {
              ...el,
              points: el.points.map((v, i) =>
                i % 2 === 0 ? node.x() + v * sx : node.y() + v * sy,
              ),
            };
          }
          case "arrow":
          case "line": {
            return {
              ...el,
              points: [
                node.x() + el.points[0] * sx,
                node.y() + el.points[1] * sy,
                node.x() + el.points[2] * sx,
                node.y() + el.points[3] * sy,
              ] as [number, number, number, number],
            };
          }
          case "text": {
            return {
              ...el,
              x: node.x(),
              y: node.y(),
              size: Math.max(8, Math.round((el.size ?? 16) * sy)),
            };
          }
        }
      });
      node.scale({ x: 1, y: 1 });
      commitElements(next);
    },
    [commitElements],
  );

  // 草稿预览元素
  const draftElement: WBElement | null = useMemo(() => {
    if (!draft) return null;
    const base = { id: "__draft__", color, width };
    if (draft.type === "pen")
      return { ...base, type: "path", points: draft.points };
    const [x0, y0, x1, y1] =
      draft.points.length === 4
        ? draft.points
        : [draft.startX, draft.startY, draft.startX, draft.startY];
    if (draft.type === "rect")
      return {
        ...base,
        type: "rect",
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      };
    if (draft.type === "ellipse")
      return {
        ...base,
        type: "ellipse",
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        w: Math.abs(x1 - x0),
        h: Math.abs(y1 - y0),
      };
    return { ...base, type: "arrow", points: [x0, y0, x1, y1] };
  }, [draft, color, width]);

  // 工具 → 快捷键反推表（tooltip 用；绑定可配置，提示随动）
  const toolKeys = useMemo(() => {
    const out: Partial<Record<WBTool, string>> = {};
    for (const [key, t] of Object.entries(bindings.tools)) out[t] = key;
    return out;
  }, [bindings.tools]);

  // 交互模型（§5.4，2026-09-22 用户定稿）：
  // - 画笔态：任何元素不可拖、不可选（修"画笔写字误拖已有笔画"），起笔可落在已有图形上
  // - 其他工具（矩形/圆形/箭头/文本/选择）：单击图形即选中（出边框），选中后可拖动/拖手柄缩放；
  //   绘制工具在空白处按下仍起笔新建，命中已有图形则让位给选中/拖动
  // - 编辑：选择态"点击→边框→再点"进入；绘制态双击进入（§5.2）
  // - Space 平移中一律禁拖/禁选
  const selectable = tool !== "pen" && !panning;
  const movableOf = (id: string) =>
    panning || tool === "pen"
      ? false
      : tool === "select"
        ? id === selectedId
        : true;

  // 元素 hover 光标反馈（仅"已选中、可拖动"时显示 move）
  const onHoverCursor = useCallback((cursor: string) => {
    const container = stageRef.current?.container();
    if (container) container.style.cursor = cursor;
  }, []);

  // 工具/选中态变化时复位光标，避免取消选中后残留 move 光标
  useEffect(() => {
    onHoverCursor("");
  }, [tool, selectedId, onHoverCursor]);

  return (
    <>
      <div className="la-wb-topbar la-drag" onPointerDown={onDragPanel}>
        <WhiteboardToolbar
          tool={tool}
          onToolChange={setTool}
          toolKeys={toolKeys}
          canUndo={historyTick >= 0 && historyRef.current.canUndo()}
          canRedo={historyTick >= 0 && historyRef.current.canRedo()}
          onUndo={undo}
          onRedo={redo}
          onClear={() => setConfirmClear(true)}
        />
      </div>
      {(tool === "pen" ||
        tool === "rect" ||
        tool === "ellipse" ||
        tool === "arrow" ||
        tool === "text") && (
        <WhiteboardAttrBar
          theme={theme}
          color={color}
          onColorChange={setColor}
          width={width}
          onWidthChange={setWidth}
        />
      )}
      <div className="la-wb-body">
        <div className="la-wb-shapes">常用图形</div>
        <div
          ref={containerRef}
          className="la-wb-stage"
          onMouseEnter={() => (hoverRef.current = true)}
          onMouseLeave={() => {
            hoverRef.current = false;
            spaceRef.current = false;
            setPanning(false);
          }}
          data-panning={panning}
          data-tool={tool}
        >
        {size.w > 0 && size.h > 0 && (
          <Stage
            ref={stageRef}
            width={size.w}
            height={size.h}
            scaleX={view.scale}
            scaleY={view.scale}
            x={view.offsetX}
            y={view.offsetY}
            draggable={panning}
            onWheel={onWheel}
            onDragEnd={onStageDragEnd}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onContextMenu={onContextMenu}
            onDblClick={onTextDoubleClick}
          >
            <Layer listening={false}>
              <GridShape
                theme={theme}
                gridMode={gridMode}
                view={view}
                size={size}
              />
            </Layer>
            <Layer>
              {elements
                .filter(
                  (el) =>
                    // 编辑中的独立文本由 textarea 呈现，隐藏节点；label 编辑保留图形
                    !(editing?.kind === "text" && el.id === editing.id),
                )
                .map((el) => (
                  <ElementNode
                    key={el.id}
                    el={el}
                    theme={theme}
                    movable={movableOf(el.id)}
                    selectable={selectable}
                    hideLabel={!!editing && editing.kind === "label" && editing.id === el.id}
                    nodeRef={registerNode}
                    onSelect={onSelect}
                    onHoverCursor={onHoverCursor}
                    onDragEnd={onElementDragEnd}
                    onTransformEnd={onElementTransformEnd}
                  />
                ))}
              {draftElement && (
                <ElementNode
                  el={draftElement}
                  theme={theme}
                  movable={false}
                  selectable={false}
                  hideLabel={false}
                  nodeRef={() => {}}
                  onSelect={() => {}}
                  onHoverCursor={() => {}}
                  onDragEnd={() => {}}
                  onTransformEnd={() => {}}
                />
              )}
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                flipEnabled={false}
                ignoreStroke
              />
            </Layer>
            <Layer listening={false}>{/* 覆盖层：留门（AI 作图 / trace） */}</Layer>
          </Stage>
        )}
        <button
          className="la-wb-zoomreset"
          title="复位视图（100%）"
          onClick={resetView}
        >
          {Math.round(view.scale * 100)}%
        </button>
        {editing &&
          (() => {
            const el = elements.find((x) => x.id === editing.id);
            if (!el) return null;
            // 独立文本
            if (editing.kind === "text" && el.type === "text")
              return (
                <TextEditor
                  key={"t-" + el.id}
                  theme={theme}
                  view={view}
                  x={el.x}
                  y={el.y}
                  fontSize={el.size ?? 16}
                  colorId={el.color}
                  initial={el.text}
                  onCommit={(text) => finishEdit(editing, text, true)}
                  onCancel={() => finishEdit(editing, "", false)}
                />
              );
            // 图形内 label（居中于框内）
            if (editing.kind === "label" && (el.type === "rect" || el.type === "ellipse"))
              return (
                <TextEditor
                  key={"l-" + el.id}
                  theme={theme}
                  view={view}
                  x={el.x}
                  y={el.y}
                  box={{ w: el.w, h: el.h }}
                  fontSize={el.labelSize ?? LABEL_DEFAULT_SIZE}
                  colorId={el.color}
                  initial={el.label ?? ""}
                  onCommit={(text) => finishEdit(editing, text, true)}
                  onCancel={() => finishEdit(editing, "", false)}
                />
              );
            return null;
          })()}
        {confirmClear && (
          <div className="la-wb-confirm">
            <span>清空当前画布？此操作可用撤销恢复。</span>
            <button
              className="la-wb-tool la-wb-danger"
              onClick={() => {
                commitElements([]);
                setConfirmClear(false);
              }}
            >
              确认清空
            </button>
            <button className="la-wb-tool" onClick={() => setConfirmClear(false)}>
              取消
            </button>
          </div>
        )}
        </div>
      </div>
    </>
  );
}
