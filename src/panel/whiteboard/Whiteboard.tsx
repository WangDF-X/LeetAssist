// 画板画布容器（plan/03-whiteboard §5）：
// - 三层架构：背景层（网格）/ 绘制层（手绘，可交互）/ 覆盖层（程序化，留门）
// - 六工具：选择/画笔/矩形/圆形/箭头/文本；拖拽绘制、选中变换（Transformer 仅缩放）
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
  Transformer,
} from "react-konva";
import type Konva from "konva";
import simplify from "simplify-js";
import type { ResolvedTheme, GridMode, WBColorId, WBWidthId } from "../theme";
import { WB_COLORS, WB_WIDTHS, WB_GRID_COLORS } from "../theme";
import type { WBElement, WBTextElement, WBViewState } from "./model";
import { genId } from "./model";
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
    case "rect":
      return (
        <Rect
          {...common}
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case "ellipse":
      return (
        <Ellipse
          {...common}
          x={el.x + el.w / 2}
          y={el.y + el.h / 2}
          radiusX={el.w / 2}
          radiusY={el.h / 2}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
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
  const [editingId, setEditingId] = useState<string | null>(null); // 正在编辑文本的元素 id
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

  // 切工具时取消选中/草稿
  useEffect(() => {
    setSelectedId(null);
    setDraft(null);
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
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const redo = useCallback(() => {
    const next = historyRef.current.redo(elementsRef.current);
    if (next) {
      setElements(next);
      setSelectedId(null);
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const deleteSelected = useCallback(() => {
    const id = selectedRef.current;
    if (!id) return;
    commitElements(elementsRef.current.filter((el) => el.id !== id));
    setSelectedId(null);
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

      if (t === "select") {
        // 点空白处取消选中（点中元素由 ElementNode.onClick 处理）
        if (e.target === stage) setSelectedId(null);
        return;
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
        setEditingId(el.id);
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
    if (el) commitElements([...elementsRef.current, el]);
  }, [draft, color, width, commitElements]);

  // ---------- 文本编辑（§5.1/§5.2：双击已有文本重编、右键快速输入） ----------

  /** 双击文本元素进入编辑：非选择态生效（选择态文本与图形行为一致——只能选中/变换，
   *  与 §5.4 交互模型统一；2026-09-21 用户定） */
  const onTextDoubleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (toolRef.current === "select") return;
      const id = e.target.id();
      const el = elementsRef.current.find((x) => x.id === id);
      if (el?.type === "text") {
        setSelectedId(null);
        setEditingId(id);
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
      setEditingId(el.id);
    },
    [panning, toWorld, color, width],
  );

  const finishTextEdit = useCallback(
    (id: string, text: string, commit: boolean) => {
      setEditingId(null);
      const cur = elementsRef.current;
      const el = cur.find((x) => x.id === id);
      if (!el || el.type !== "text") return;
      const isNew = el.text === ""; // 空文本元素只可能处于"新建未提交"态
      const trimmed = text.trim();

      if (!commit || trimmed === "") {
        if (isNew) {
          // 新建未提交/空内容：静默移除（不入历史）
          setElements(cur.filter((x) => x.id !== id));
        } else if (commit && trimmed === "") {
          // 旧文本被清空：作为删除提交
          commitElements(cur.filter((x) => x.id !== id));
        }
        // else：取消编辑旧文本，无变化
        return;
      }
      // 提交非空文本（新建首次提交 / 旧文本修改统一走这里）
      commitElements(
        cur.map((x) =>
          x.id === id && x.type === "text" ? { ...x, text: trimmed } : x,
        ),
      );
    },
    [commitElements],
  );

  const onSelect = useCallback((id: string) => {
    if (toolRef.current !== "select") return;
    // 拖动结束后的 click 忽略，避免"拖完误进入文本编辑"
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    if (selectedRef.current === id) {
      // 已选中（边框已显示）再次点击：文本进入编辑；图形保持选中（无编辑动作）
      const el = elementsRef.current.find((x) => x.id === id);
      if (el?.type === "text") {
        setSelectedId(null);
        setEditingId(id);
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
        case "text": {
          // Konva 拖拽后 node.x()/y() 已经是「新位置」（原位置+位移），直接用
          next = cur.map((el) =>
            el.id === id && (el.type === "rect" || el.type === "text")
              ? { ...el, x: node.x(), y: node.y() }
              : el,
          );
          break;
        }
        case "ellipse": {
          // 渲染时节点中心 = el.x + w/2，故新位置 = node.x() - w/2
          next = cur.map((el) =>
            el.id === id && el.type === "ellipse"
              ? { ...el, x: node.x() - el.w / 2, y: node.y() - el.h / 2 }
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
          case "rect": {
            return {
              ...el,
              x: node.x(),
              y: node.y(),
              w: Math.max(1, el.w * sx),
              h: Math.max(1, el.h * sy),
            };
          }
          case "ellipse": {
            const w = Math.max(1, el.w * sx);
            const h = Math.max(1, el.h * sy);
            return { ...el, x: node.x() - w / 2, y: node.y() - h / 2, w, h };
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

  // 交互模型（§5.4，2026-09-22 用户修正版）：
  // - 画笔态：任何元素不可拖（修"画笔写字误拖已有笔画"），且起笔可落在已有图形上
  // - 其他绘制工具（矩形/圆形/箭头/文本）：已有图形可直接拖动（线条类走 12px 边缘
  //   热区、文本整块区域）；新建只在空白处按下才起笔（onPointerDown 守卫让位给拖动）
  // - 选择态：点击元素出现边框（选中）后，该元素才可拖动/缩放；再次点击文本进入编辑
  // - Space 平移中一律禁拖
  const selectable = tool === "select" && !panning;
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
                .filter((el) => el.id !== editingId) // 编辑中的文本由 textarea 呈现，节点隐藏
                .map((el) => (
                  <ElementNode
                    key={el.id}
                    el={el}
                    theme={theme}
                    movable={movableOf(el.id)}
                    selectable={selectable}
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
        {editingId &&
          (() => {
            const el = elements.find((x) => x.id === editingId);
            if (!el || el.type !== "text") return null;
            return (
              <TextEditor
                el={el}
                theme={theme}
                view={view}
                onCommit={(text) => finishTextEdit(editingId, text, true)}
                onCancel={() => finishTextEdit(editingId, "", false)}
              />
            );
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
