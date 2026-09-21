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
  Transformer,
} from "react-konva";
import type Konva from "konva";
import simplify from "simplify-js";
import type { ResolvedTheme, GridMode, WBColorId, WBWidthId } from "../theme";
import { WB_COLORS, WB_WIDTHS, WB_GRID_COLORS } from "../theme";
import type { WBElement, WBViewState } from "./model";
import { genId } from "./model";
import { HistoryStack } from "./HistoryStack";
import {
  WhiteboardToolbar,
  WhiteboardAttrBar,
  type WBTool,
} from "./Toolbar";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const GRID_GAP = 24;
const MIN_DRAG = 3; // 世界坐标下小于该位移视为误触，不生成图形

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

/** 单个元素 → Konva 节点（语义色/线宽按主题映射，§4.2） */
function ElementNode({
  el,
  theme,
  interactive,
  nodeRef,
  onSelect,
  onDragEnd,
  onTransformEnd,
}: {
  el: WBElement;
  theme: ResolvedTheme;
  interactive: boolean;
  nodeRef: (id: string, node: Konva.Node | null) => void;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (id: string, e: Konva.KonvaEventObject<Event>) => void;
}) {
  const stroke = WB_COLORS[el.color][theme];
  const strokeWidth = WB_WIDTHS[el.width];
  const common = {
    id: el.id,
    ref: (n: Konva.Node | null) => nodeRef(el.id, n),
    draggable: interactive,
    onClick: () => interactive && onSelect(el.id),
    onTap: () => interactive && onSelect(el.id),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
      interactive && onDragEnd(el.id, e),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) =>
      interactive && onTransformEnd(el.id, e),
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
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [panning, setPanning] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [historyTick, setHistoryTick] = useState(0); // 驱动撤销/重做按钮可用态

  const historyRef = useRef(new HistoryStack());
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const spaceRef = useRef(false);
  const hoverRef = useRef(false);
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

  // ---------- 快捷键（§5.2 hover 门控） ----------

  useEffect(() => {
    const TOOL_KEYS: Record<string, WBTool> = {
      v: "select",
      p: "pen",
      r: "rect",
      o: "ellipse",
      a: "arrow",
      t: "text",
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!hoverRef.current) return; // 门控：不在画板区域不响应
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input, [contenteditable]")) return; // 文本编辑中让行

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedRef.current) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (e.code === "Space") {
        spaceRef.current = true;
        setPanning(true);
        e.preventDefault();
        return;
      }
      const t = TOOL_KEYS[e.key.toLowerCase()];
      if (t && !e.ctrlKey && !e.metaKey && !e.altKey) setTool(t);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
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
      if (t === "text") return; // 文本编辑在下一步实现
      const type = t as DraftState["type"];
      setDraft({ type, startX: w.x, startY: w.y, points: [w.x, w.y] });
    },
    [panning, toWorld],
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
        if (pts.length >= 4)
          el = { ...base, id: genId(), type: "path", points: pts };
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

  // ---------- 选中/拖拽/变换 ----------

  const onSelect = useCallback((id: string) => {
    if (toolRef.current === "select") setSelectedId(id);
  }, []);

  const onElementDragEnd = useCallback(
    (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const dx = node.x();
      const dy = node.y();
      const cur = elementsRef.current;
      const target = cur.find((el) => el.id === id);
      if (!target) return;
      let next: WBElement[];
      if (target.type === "path") {
        // path 的 Konva 节点 x/y 默认为 0，drag 后产生偏移：并入 points 再归零
        next = cur.map((el) =>
          el.id === id && el.type === "path"
            ? {
                ...el,
                points: el.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)),
              }
            : el,
        );
        node.position({ x: 0, y: 0 });
      } else {
        // rect/ellipse/arrow/line/text：Konva 节点 x/y 即语义位置（rect/ellipse 由渲染公式换算）
        next = cur.map((el) => {
          if (el.id !== id) return el;
          switch (el.type) {
            case "rect":
            case "ellipse":
              return { ...el, x: el.x + dx, y: el.y + dy };
            case "text":
              return { ...el, x: el.x + dx, y: el.y + dy };
            case "arrow":
            case "line":
              return {
                ...el,
                points: [
                  el.points[0] + dx,
                  el.points[1] + dy,
                  el.points[2] + dx,
                  el.points[3] + dy,
                ] as [number, number, number, number],
              };
            default:
              return el;
          }
        });
        node.position({ x: 0, y: 0 });
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

  // ---------- 网格 ----------

  const gridLines = useMemo(() => {
    if (gridMode === "none" || size.w === 0 || size.h === 0) return [];
    const lines: { points: number[]; key: string }[] = [];
    const x0 = Math.floor(-view.offsetX / view.scale / GRID_GAP) * GRID_GAP;
    const x1 = (size.w - view.offsetX) / view.scale + GRID_GAP;
    const y0 = Math.floor(-view.offsetY / view.scale / GRID_GAP) * GRID_GAP;
    const y1 = (size.h - view.offsetY) / view.scale + GRID_GAP;
    if (gridMode === "lines") {
      for (let x = x0; x <= x1; x += GRID_GAP)
        lines.push({ key: `v${x}`, points: [x, y0, x, y1] });
      for (let y = y0; y <= y1; y += GRID_GAP)
        lines.push({ key: `h${y}`, points: [x0, y, x1, y] });
    } else {
      for (let x = x0; x <= x1; x += GRID_GAP)
        for (let y = y0; y <= y1; y += GRID_GAP)
          lines.push({ key: `d${x},${y}`, points: [x, y, x + 0.1, y] });
    }
    return lines;
  }, [gridMode, size, view]);

  const gridColor = WB_GRID_COLORS[theme];

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

  const interactive = tool === "select" && !panning;

  return (
    <>
      <div className="la-wb-topbar la-drag" onPointerDown={onDragPanel}>
        <WhiteboardToolbar
          tool={tool}
          onToolChange={setTool}
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
          >
            <Layer listening={false}>
              {gridMode !== "none" &&
                gridLines.map((l) => (
                  <Line
                    key={l.key}
                    points={l.points}
                    stroke={gridColor}
                    strokeWidth={gridMode === "dots" ? 2 : 1}
                    lineCap="round"
                    perfectDrawEnabled={false}
                  />
                ))}
            </Layer>
            <Layer>
              {elements.map((el) => (
                <ElementNode
                  key={el.id}
                  el={el}
                  theme={theme}
                  interactive={interactive}
                  nodeRef={registerNode}
                  onSelect={onSelect}
                  onDragEnd={onElementDragEnd}
                  onTransformEnd={onElementTransformEnd}
                />
              ))}
              {draftElement && (
                <ElementNode
                  el={draftElement}
                  theme={theme}
                  interactive={false}
                  nodeRef={() => {}}
                  onSelect={() => {}}
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
