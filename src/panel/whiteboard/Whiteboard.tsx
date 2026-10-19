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
  Circle,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import simplify from "simplify-js";
import type { ResolvedTheme, GridMode, WBColorId, WBWidthId } from "../theme";
import {
  WB_COLORS,
  WB_WIDTHS,
  WB_GRID_COLORS,
  WB_CANVAS_BG,
} from "../theme";
import type {
  WBArrowhead,
  WBBox,
  WBConnectorElement,
  WBElement,
  WBTextElement,
  WBViewState,
} from "./model";
import {
  genId,
  growShapeForLabel,
  LABEL_DEFAULT_SIZE,
  getElementBounds,
  estimateTextSize,
  isBindable,
  resolveConnectorPoints,
  bboxBoundaryPoint,
} from "./model";
import { HistoryStack } from "./HistoryStack";
import {
  DEFAULT_BINDINGS,
  loadBindings,
  matchKey,
  shouldIgnoreShortcut,
  type WBBindings,
} from "./bindings";
import {
  WhiteboardToolbar,
  WhiteboardAttrBar,
  type WBTool,
} from "./Toolbar";
import { TextEditor } from "./TextEditor";
import { ShapeRail } from "./ShapeRail";
import { ParamDialog } from "./ParamDialog";
import type { WBPreset } from "./presets";
import { compileDiagram } from "./dsl";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const GRID_GAP = 24;
const MIN_DRAG = 3; // 世界坐标下小于该位移视为误触，不生成图形
const DRAG_DISTANCE = 3; // 元素拖动阈值：小于该屏幕位移视为"点击"（选中），避免手抖变拖动
const HANDLE_R = 5; // 连线端点手柄半径（屏幕 px，除 view.scale 保持视觉恒定）
const BIND_MARGIN = 14; // 连线绑定命中容差（世界 px）：不必严格落在图形内，靠近边缘即可绑定

/** 归一化矩形（两角点 → 左上 + 宽高） */
function normRect(x0: number, y0: number, x1: number, y1: number) {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

/** 矩形相交（用于框选命中） */
function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

/** 从命中的 Konva 节点向上找到带 id 的祖先（rect/ellipse 是 Group 包子节点，命中点无 id） */
function nodeIdOf(node: Konva.Node | null): string {
  let n: Konva.Node | null = node;
  while (n && !n.id()) n = n.getParent() as Konva.Node | null;
  return n?.id() ?? "";
}

/** 按位移平移一个元素的几何（rect/ellipse/text 改 x/y；path/connector 改 points） */
function translateElement(el: WBElement, dx: number, dy: number): WBElement {
  switch (el.type) {
    case "rect":
    case "ellipse":
    case "text":
      return { ...el, x: el.x + dx, y: el.y + dy };
    case "path":
      return {
        ...el,
        points: el.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)),
      };
    case "connector":
      return {
        ...el,
        points: [
          el.points[0] + dx,
          el.points[1] + dy,
          el.points[2] + dx,
          el.points[3] + dy,
        ] as [number, number, number, number],
      };
  }
}

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
  type: "pen" | "rect" | "ellipse" | "connector";
  startX: number;
  startY: number;
  points: number[]; // pen: 累积点; rect/ellipse/connector: [x0,y0,x1,y1]
  fromId?: string; // connector：起点绑定的图形 id（undefined = 自由起点）
}

/** 编辑目标：独立文本 or 图形/连线 label（§5.4 编辑语义） */
type EditTarget = { kind: "text" | "label"; id: string };

/** 正在拖动的连线端点（端点重绑定，§5.4） */
interface EndpointDrag {
  connectorId: string;
  end: "from" | "to";
  x: number;
  y: number;
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
  hideLabel,
  resolved,
  nodeRef,
  onSelect,
  onHoverCursor,
  onTransform,
  onTransformEnd,
}: {
  el: WBElement;
  theme: ResolvedTheme;
  movable: boolean;
  selectable: boolean;
  /** label 编辑中：图形保留、图形内文字隐藏（textarea 覆盖其上，§5.4） */
  hideLabel: boolean;
  /** 连线：解析后的端点（绑定端由目标图形包围盒算出）；缺省用 el.points */
  resolved?: [number, number, number, number];
  nodeRef: (id: string, node: Konva.Node | null) => void;
  onSelect: (id: string, e?: Konva.KonvaEventObject<MouseEvent>) => void;
  onHoverCursor: (cursor: string) => void;
  onTransform?: (id: string, e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (id: string, e: Konva.KonvaEventObject<Event>) => void;
}) {
  const stroke = WB_COLORS[el.color][theme];
  const strokeWidth = WB_WIDTHS[el.width];
  const common = {
    id: el.id,
    ref: (n: Konva.Node | null) => nodeRef(el.id, n),
    // 不使用 Konva 原生拖拽：整体移动统一走舞台级自定义手势（数据驱动），
    // 避免与 Transformer 自带的代理拖拽(_proxyDrag)打架导致选中框闪烁
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) =>
      selectable && onSelect(el.id, e),
    onTap: (e: Konva.KonvaEventObject<MouseEvent>) =>
      selectable && onSelect(el.id, e),
    onMouseEnter: movable ? () => onHoverCursor("move") : undefined,
    onMouseLeave: movable ? () => onHoverCursor("") : undefined,
    onTransform: (e: Konva.KonvaEventObject<Event>) =>
      selectable && onTransform?.(el.id, e),
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
    case "connector": {
      const pts = resolved ?? el.points;
      const size = el.labelSize ?? LABEL_DEFAULT_SIZE;
      const label =
        !hideLabel && el.label && el.label.trim() !== "" ? el.label : null;
      const m = label ? estimateTextSize(label, size) : null;
      const midX = (pts[0] + pts[2]) / 2;
      const midY = (pts[1] + pts[3]) / 2;
      // 线 + 标签底 + 标签文字包进一个可拖 Group：拖动时三者一起走
      // （ref/id 挂在 Group 上——它才是可拖/整体移动的单元；内层 Arrow 用 name 定位）
      return (
        <Group
          id={el.id}
          ref={(n: Konva.Node | null) => nodeRef(el.id, n)}
          onClick={(e: Konva.KonvaEventObject<MouseEvent>) =>
            selectable && onSelect(el.id, e)
          }
          onTap={(e: Konva.KonvaEventObject<MouseEvent>) =>
            selectable && onSelect(el.id, e)
          }
          onMouseEnter={movable ? () => onHoverCursor("move") : undefined}
          onMouseLeave={movable ? () => onHoverCursor("") : undefined}
        >
          <Arrow
            name="wb-conn-line"
            points={pts}
            stroke={stroke}
            strokeWidth={strokeWidth}
            fill={stroke}
            pointerLength={8}
            pointerWidth={7}
            pointerAtBeginning={
              el.arrowhead === "start" || el.arrowhead === "both"
            }
            pointerAtEnding={el.arrowhead === "end" || el.arrowhead === "both"}
            hitStrokeWidth={Math.max(strokeWidth, 12)}
          />
          {label && m && (
            <>
              {/* 标签底：用纸面色盖住穿过文字的连线，等价于"文字处断开连线"，保证可读 */}
              <Rect
                name="wb-conn-mask"
                x={midX - m.w / 2 - 3}
                y={midY - m.h / 2 - 1}
                width={m.w + 6}
                height={m.h + 2}
                cornerRadius={3}
                fill={WB_CANVAS_BG[theme]}
                listening={false}
              />
              <Text
                name="wb-conn-label"
                x={midX - m.w / 2}
                y={midY - m.h / 2}
                width={m.w}
                height={m.h}
                align="center"
                verticalAlign="middle"
                text={label}
                fontSize={size}
                fill={stroke}
                listening={false}
              />
            </>
          )}
        </Group>
      );
    }
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

/** [DEV-only] 带标注的示例 DSL，用于可视化预览标注效果（正式版删除） */
const DEV_DEMO_DSL = {
  dslVersion: 1,
  caption: "示例：数组双指针 + 树结点高亮",
  structures: [
    { id: "A", kind: "array", items: [1, 3, 5, 7], indexed: true },
    {
      id: "T",
      kind: "tree",
      root: {
        id: "r",
        value: 1,
        children: [
          { id: "l", value: 2, children: [] },
          { id: "rr", value: 3, children: [] },
        ],
      },
    },
  ],
  annotations: [
    { kind: "window", from: { struct: "A", at: "cell", index: 0 }, to: { struct: "A", at: "cell", index: 3 }, color: "blue", label: "窗口" },
    { kind: "pointer", anchor: { struct: "A", at: "cell", index: 0 }, label: "lo", color: "blue" },
    { kind: "pointer", anchor: { struct: "A", at: "cell", index: 3 }, label: "hi", color: "red" },
    { kind: "highlight", anchor: { struct: "A", at: "cell", index: 2 }, color: "orange" },
    { kind: "note", anchor: { struct: "A", at: "cell", index: 2 }, text: "当前考察", color: "green" },
    { kind: "highlight", anchor: { struct: "T", at: "node", id: "l" }, color: "green" },
  ],
};

export function Whiteboard({ theme, gridMode, onDragPanel }: WhiteboardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodesRef = useRef(new Map<string, Konva.Node>());
  const epNodesRef = useRef<{ from?: Konva.Circle; to?: Konva.Circle }>({}); // 选中连线的端点手柄节点

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
  const [arrowhead, setArrowhead] = useState<WBArrowhead>("end");
  const [selectedIds, setSelectedIds] = useState<string[]>([]); // 多选集合（§5.4）
  const [editing, setEditing] = useState<EditTarget | null>(null); // 正在编辑的文本/label 目标
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    additive: boolean;
  } | null>(null); // 框选橡皮筋（世界坐标）
  const [snapTargetId, setSnapTargetId] = useState<string | null>(null); // 连线吸附高亮
  const [epDrag, setEpDrag] = useState<EndpointDrag | null>(null); // 端点重绑定拖动
  const [draggingId, setDraggingId] = useState<string | null>(null); // 正在被拖动的元素（拖动中隐藏端点手柄）
  const [panning, setPanning] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [presetDialog, setPresetDialog] = useState<WBPreset | null>(null); // 图元库参数窗（§5.1）
  const [historyTick, setHistoryTick] = useState(0); // 驱动撤销/重做按钮可用态

  const historyRef = useRef(new HistoryStack());
  const clipboardRef = useRef<WBElement[]>([]); // 复制/剪切板（内存）
  // 整体移动手势（舞台级自定义，不走 Konva 原生拖拽）：
  // 记录被移动集合的原始几何 + 拖动前整份元素 + 起点，用于"数据驱动平移"与一次撤销
  const moveRef = useRef<{
    ids: string[];
    orig: Map<string, WBElement>;
    before: WBElement[];
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
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
  const activePointerRef = useRef<number | null>(null);
  const hoverRef = useRef(false);
  const justDraggedRef = useRef(false); // 刚完成拖动：用于忽略紧随的 click
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const presetDialogRef = useRef<WBPreset | null>(presetDialog);
  presetDialogRef.current = presetDialog;

  // ---------- 基础设施 ----------

  const registerNode = useCallback((id: string, node: Konva.Node | null) => {
    if (node) nodesRef.current.set(id, node);
    else nodesRef.current.delete(id);
  }, []);

  // 元素 id 索引 + 连线端点解析（绑定端跟随目标图形）
  const byId = useMemo(() => {
    const m = new Map<string, WBElement>();
    for (const el of elements) m.set(el.id, el);
    return m;
  }, [elements]);

  const connectorPoints = useMemo(() => {
    const m = new Map<string, [number, number, number, number]>();
    for (const el of elements)
      if (el.type === "connector") m.set(el.id, resolveConnectorPoints(el, byId));
    return m;
  }, [elements, byId]);

  // 选中的元素集合 / 单选元素（用于编辑、端点手柄）
  const selectedEls = useMemo(
    () => selectedIds.map((id) => byId.get(id)).filter((e): e is WBElement => !!e),
    [selectedIds, byId],
  );
  const selectedEl = selectedEls.length === 1 ? selectedEls[0] : null;
  const editingConnector =
    selectedEl?.type === "connector" ? selectedEl : null;

  /** 命中检测：世界坐标点落在哪个可绑定图形内（矩形/椭圆/文本，按包围盒 + 容差；取最上层） */
  const findBindableAt = useCallback(
    (wx: number, wy: number, excludeId?: string): string | null => {
      const els = elementsRef.current;
      const m = BIND_MARGIN;
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i];
        if (el.id === excludeId || !isBindable(el)) continue;
        const b = getElementBounds(el);
        if (
          wx >= b.x - m &&
          wx <= b.x + b.w + m &&
          wy >= b.y - m &&
          wy <= b.y + b.h + m
        )
          return el.id;
      }
      return null;
    },
    [],
  );

  /** 拖动/缩放图形时，命令式实时更新绑定到它的连线端点（不走 state；松手后以数据重渲染） */
  const updateConnectedConnectors = useCallback((shapeId: string) => {
    const els = elementsRef.current;
    const map = new Map<string, WBElement>();
    for (const e of els) map.set(e.id, e);
    const boundsOf = (el: WBElement): WBBox => {
      const node = nodesRef.current.get(el.id);
      const layer = node?.getLayer();
      if (node && layer) {
        const r = node.getClientRect({ relativeTo: layer, skipStroke: true });
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      return getElementBounds(el);
    };
    for (const el of els) {
      if (el.type !== "connector") continue;
      if (el.connects?.from !== shapeId && el.connects?.to !== shapeId) continue;
      const pts = resolveConnectorPoints(el, map, boundsOf);
      // nodesRef 存的是连线的 Group（可拖单元）；内层 Arrow 用 name 定位
      const group = nodesRef.current.get(el.id) as Konva.Group | undefined;
      const arrow = group?.findOne(".wb-conn-line") as Konva.Arrow | undefined;
      arrow?.points(pts);
      // 同步标签底/文字到新中点（与渲染同一算法，保证拖动中文字也跟随连线）
      const labelNode = group?.findOne(".wb-conn-label") as
        | Konva.Text
        | undefined;
      if (labelNode) {
        const w = labelNode.width();
        const h = labelNode.height();
        const midX = (pts[0] + pts[2]) / 2;
        const midY = (pts[1] + pts[3]) / 2;
        labelNode.x(midX - w / 2);
        labelNode.y(midY - h / 2);
        const maskNode = group?.findOne(".wb-conn-mask") as
          | Konva.Rect
          | undefined;
        if (maskNode) {
          maskNode.x(midX - w / 2 - 3);
          maskNode.y(midY - h / 2 - 1);
        }
      }
      // 若这条连线显示了端点手柄（存在手柄节点），手柄也要跟随
      // （用"节点是否存在"判断，不依赖选中态：重绑后连线保持选中，手柄必须同步）
      epNodesRef.current.from?.position({ x: pts[0], y: pts[1] });
      epNodesRef.current.to?.position({ x: pts[2], y: pts[3] });
    }
  }, []);

  // Transformer 跟随选中集合（§5.4：连线不出缩放手柄；多选时整体缩放）
  // 仅在"选中集合变化"时重设 nodes，其余情况只 forceUpdate——避免每帧 detach/attach 造成选中框闪烁
  const trIdsRef = useRef<string[]>([]);
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const ids = selectedIds.filter(
      (id) => byId.get(id)?.type !== "connector" && nodesRef.current.get(id),
    );
    const prev = trIdsRef.current;
    const same =
      ids.length === prev.length && ids.every((x, i) => x === prev[i]);
    if (same) {
      tr.forceUpdate(); // 节点几何变化（数据驱动移动/缩放）→ 刷新选中框
    } else {
      trIdsRef.current = ids;
      tr.nodes(ids.map((id) => nodesRef.current.get(id)!));
    }
  }, [selectedIds, elements, byId]);

  // 切工具时取消选中/草稿/编辑/连线临时态
  useEffect(() => {
    setSelectedIds([]);
    setDraft(null);
    setEditing(null);
    setSnapTargetId(null);
    setEpDrag(null);
    setMarquee(null);
    moveRef.current = null;
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
      setSelectedIds([]);
      setEditing(null);
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const redo = useCallback(() => {
    const next = historyRef.current.redo(elementsRef.current);
    if (next) {
      setElements(next);
      setSelectedIds([]);
      setEditing(null);
      setHistoryTick((t) => t + 1);
    }
  }, []);

  const deleteSelected = useCallback(() => {
    const ids = selectedRef.current;
    if (!ids.length) return;
    const idSet = new Set(ids);
    const cur = elementsRef.current;
    const map = new Map<string, WBElement>();
    for (const e of cur) map.set(e.id, e);
    // 删除前先"冻结"指向被删图形的连线端点：把该端写死为当前解析坐标，避免删除后回退字面值导致跳变
    const next = cur
      .filter((el) => !idSet.has(el.id))
      .map((el): WBElement => {
        if (el.type !== "connector") return el;
        const from = el.connects?.from;
        const to = el.connects?.to;
        const delFrom = from ? idSet.has(from) : false;
        const delTo = to ? idSet.has(to) : false;
        if (!delFrom && !delTo) return el;
        const pts = resolveConnectorPoints(el, map);
        const connects = { ...(el.connects ?? {}) };
        if (delFrom) delete connects.from;
        if (delTo) delete connects.to;
        const frozen: WBConnectorElement = { ...el, points: pts };
        if (!connects.from && !connects.to) delete frozen.connects;
        else frozen.connects = connects;
        return frozen;
      });
    commitElements(next);
    setSelectedIds([]);
    setEditing(null);
  }, [commitElements]);

  // ---------- 复制 / 粘贴 / 克隆（Office 风格，2026-09-22；单个与多选通用） ----------

  const copySelection = useCallback(() => {
    const ids = new Set(selectedRef.current);
    if (!ids.size) return;
    clipboardRef.current = elementsRef.current
      .filter((e) => ids.has(e.id))
      .map((e) => ({ ...e }));
  }, []);

  /** 克隆一组元素：新 id、整体偏移；连线按 idMap 重映射（两端都在集合内才保留绑定） */
  const cloneElements = useCallback(
    (src: WBElement[], offset: number): WBElement[] => {
      const idMap = new Map<string, string>();
      for (const e of src) idMap.set(e.id, genId());
      return src.map((e): WBElement => {
        const id = idMap.get(e.id)!;
        if (e.type === "rect" || e.type === "ellipse" || e.type === "text")
          return { ...e, id, x: e.x + offset, y: e.y + offset };
        if (e.type === "path")
          return { ...e, id, points: e.points.map((v) => v + offset) };
        const points: [number, number, number, number] = [
          e.points[0] + offset,
          e.points[1] + offset,
          e.points[2] + offset,
          e.points[3] + offset,
        ];
        const next: WBConnectorElement = { ...e, id, points };
        const nc: { from?: string; to?: string } = {};
        if (e.connects?.from && idMap.has(e.connects.from))
          nc.from = idMap.get(e.connects.from);
        if (e.connects?.to && idMap.has(e.connects.to))
          nc.to = idMap.get(e.connects.to);
        if (nc.from || nc.to) next.connects = nc;
        else delete next.connects;
        return next;
      });
    },
    [],
  );

  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip.length) return;
    const clones = cloneElements(clip, 24);
    commitElements([...elementsRef.current, ...clones]);
    setSelectedIds(clones.map((c) => c.id));
  }, [cloneElements, commitElements]);

  const duplicateSelection = useCallback(() => {
    const ids = new Set(selectedRef.current);
    if (!ids.size) return;
    const src = elementsRef.current.filter((e) => ids.has(e.id));
    const clones = cloneElements(src, 24);
    commitElements([...elementsRef.current, ...clones]);
    setSelectedIds(clones.map((c) => c.id));
  }, [cloneElements, commitElements]);

  // ---------- 图元库插入（§5.1）----------

  /** 把一组已编译元素平移到视口中心 → 追加 → 自动全选 → 切选择态（一步撤销） */
  const placeElements = useCallback(
    (built: WBElement[]) => {
      if (!built.length) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const el of built) {
        const b = getElementBounds(el);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      const centerX = (size.w / 2 - view.offsetX) / view.scale;
      const centerY = (size.h / 2 - view.offsetY) / view.scale;
      const dx = centerX - (minX + maxX) / 2;
      const dy = centerY - (minY + maxY) / 2;
      const placed = built.map((el) => translateElement(el, dx, dy));
      commitElements([...elementsRef.current, ...placed]);
      setSelectedIds(placed.map((el) => el.id));
      setTool("select");
    },
    [size.w, size.h, view, commitElements],
  );

  /** 图元库插入：构造空值 DSL 结构 → 编译器展开（§4.6，与 AI 同一路径） */
  const insertPreset = useCallback(
    (preset: WBPreset, params: Record<string, number | boolean>) => {
      const { elements: built } = compileDiagram(
        { dslVersion: 1, structures: [preset.toStructure(params)] },
        { color, width, genId },
      );
      placeElements(built);
    },
    [color, width, placeElements],
  );

  /** [DEV-only] 插入一段带标注的示例 DSL，用于可视化预览（正式版删除） */
  const insertDemoDiagram = useCallback(() => {
    const { elements: built, warnings } = compileDiagram(DEV_DEMO_DSL, {
      color,
      width,
      genId,
    });
    if (warnings.length) console.warn("[DEV demo] warnings:", warnings);
    placeElements(built);
  }, [color, width, placeElements]);

  const handlePickPreset = useCallback(
    (preset: WBPreset) => {
      if (preset.params.length === 0) insertPreset(preset, {});
      else setPresetDialog(preset);
    },
    [insertPreset],
  );

  // ---------- 快捷键（§5.2 hover 门控；绑定来自 bindings.ts 配置，不写死） ----------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!hoverRef.current) return; // 门控：不在画板区域不响应
      if (presetDialogRef.current) return; // 参数窗打开时不响应画板快捷键
      if (shouldIgnoreShortcut(e)) return; // Shadow DOM 编辑控件、输入法和已处理事件让行
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
        if (selectedRef.current.length) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }
      if (matchKey(b.copy, e)) {
        e.preventDefault();
        copySelection();
        return;
      }
      if (matchKey(b.paste, e)) {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (matchKey(b.duplicate, e)) {
        e.preventDefault();
        duplicateSelection();
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
        const stage = stageRef.current;
        if (stage?.isDragging()) {
          stage.stopDrag();
          setView((v) => ({ ...v, offsetX: stage.x(), offsetY: stage.y() }));
        }
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
  }, [undo, redo, deleteSelected, copySelection, pasteClipboard, duplicateSelection]);

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
      const shift = e.evt.shiftKey;

      // 框选：选择态，或 Shift+拖动（任意工具态）在空白处拉橡皮筋
      if (e.target === stage && (t === "select" || shift)) {
        if (!shift) setSelectedIds([]);
        setMarquee({ x0: w.x, y0: w.y, x1: w.x, y1: w.y, additive: shift });
        return;
      }

      // 命中已有元素：开始"整体移动"手势（舞台级自定义、数据驱动；不用 Konva 原生拖拽）
      const movableTool = t !== "pen" && t !== "connector";
      if (e.target !== stage && movableTool) {
        const hitId = nodeIdOf(e.target);
        const inSel = !!hitId && selectedRef.current.includes(hitId);
        if (hitId && (t !== "select" || inSel)) {
          const cur = elementsRef.current;
          const ids = inSel ? [...selectedRef.current] : [hitId];
          const orig = new Map<string, WBElement>();
          for (const sid of ids) {
            const el = cur.find((x) => x.id === sid);
            if (el) orig.set(sid, el);
          }
          moveRef.current = {
            ids,
            orig,
            before: cur,
            startX: w.x,
            startY: w.y,
            moved: false,
          };
          return;
        }
      }

      if (t === "select") {
        return; // 点中未选中元素/空白：交给 click 选中
      }

      // 绘制工具：点空白清除选中，随后起笔
      if (e.target === stage) setSelectedIds([]);

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
      if (t === "connector") {
        // 连线：命中可绑定图形 = 起点绑定；落空白 = 自由起点
        const fromId = findBindableAt(w.x, w.y) ?? undefined;
        setDraft({
          type: "connector",
          startX: w.x,
          startY: w.y,
          points: [w.x, w.y],
          fromId,
        });
        return;
      }
      const type = t as DraftState["type"];
      // 画笔：一律起笔——即使起点落在已有笔画上（画笔态元素不可拖，无让位问题）
      // 矩形/圆形：点中已有元素（非 Stage）时不起笔，让位给该元素的直接拖动
      if (type !== "pen" && e.target !== stage) return;
      setDraft({ type, startX: w.x, startY: w.y, points: [w.x, w.y] });
    },
    [panning, toWorld, color, width, findBindableAt],
  );

  const onPointerMove = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      const pointer = stageRef.current?.getPointerPosition();
      if (!pointer) return;
      const w = toWorld(pointer);

      // 框选：更新橡皮筋
      if (marquee) {
        setMarquee((m) => (m ? { ...m, x1: w.x, y1: w.y } : m));
        return;
      }

      // 整体移动手势：按"原始几何 + 位移"数据驱动平移整组
      const mv = moveRef.current;
      if (mv) {
        const dx = w.x - mv.startX;
        const dy = w.y - mv.startY;
        if (!mv.moved && Math.hypot(dx, dy) < DRAG_DISTANCE) return; // 未超阈值：先不动
        mv.moved = true;
        setDraggingId(mv.ids[0]);
        const cur = elementsRef.current;
        setElements(
          cur.map((el) => {
            const o = mv.orig.get(el.id);
            return o ? translateElement(o, dx, dy) : el;
          }),
        );
        return;
      }

      // 端点重绑定拖动：更新手柄位置 + 吸附高亮（排除对端已绑定的图形）
      if (epDrag) {
        setEpDrag((d) => (d ? { ...d, x: w.x, y: w.y } : d));
        const conn = elementsRef.current.find(
          (x) => x.id === epDrag.connectorId,
        );
        const other =
          conn?.type === "connector"
            ? epDrag.end === "from"
              ? conn.connects?.to
              : conn.connects?.from
            : undefined;
        setSnapTargetId(findBindableAt(w.x, w.y, other));
        return;
      }

      if (!draft) return;
      if (draft.type === "connector")
        setSnapTargetId(findBindableAt(w.x, w.y, draft.fromId));
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
    [draft, epDrag, marquee, toWorld, findBindableAt],
  );

  const onPointerUp = useCallback((event: Konva.KonvaEventObject<PointerEvent>) => {
    // Konva 对 pointercancel 也可能补发 pointerup，不能把取消当作正常提交。
    if (event.evt.type === "pointercancel" || event.evt.type === "touchcancel") return;
    // 框选收尾
    if (marquee) {
      const m = marquee;
      setMarquee(null);
      const rect = normRect(m.x0, m.y0, m.x1, m.y1);
      if (rect.w > 3 || rect.h > 3) {
        const hit = elementsRef.current
          .filter((el) => rectsIntersect(rect, getElementBounds(el)))
          .map((el) => el.id);
        setSelectedIds((prev) => {
          const set = new Set<string>(m.additive ? prev : []);
          for (const hid of hit) set.add(hid);
          return [...set];
        });
      }
      return;
    }

    // 整体移动收尾：整组已在移动中写入数据，这里只补一次历史（整体移动 = 一次撤销）
    const mv = moveRef.current;
    if (mv) {
      moveRef.current = null;
      setDraggingId(null);
      if (mv.moved) {
        justDraggedRef.current = true; // 忽略紧随的 click（避免移动后误改选中/误编辑）
        historyRef.current.push(mv.before);
        setHistoryTick((t) => t + 1);
      }
      return;
    }

    // 端点重绑定收尾（优先于起笔）
    if (epDrag) {
      const d = epDrag;
      setEpDrag(null);
      setSnapTargetId(null);
      justDraggedRef.current = true; // 忽略紧随的 click：保持连线选中，避免误选到目标图形
      const cur = elementsRef.current;
      const conn = cur.find((x) => x.id === d.connectorId);
      if (!conn || conn.type !== "connector") return;
      const other = d.end === "from" ? conn.connects?.to : conn.connects?.from;
      const targetId = findBindableAt(d.x, d.y, other) ?? undefined;
      const connects: { from?: string; to?: string } = {
        ...(conn.connects ?? {}),
      };
      if (d.end === "from") {
        if (targetId) connects.from = targetId;
        else delete connects.from;
      } else {
        if (targetId) connects.to = targetId;
        else delete connects.to;
      }
      const points = [...conn.points] as [number, number, number, number];
      if (!targetId) {
        // 自由端才更新字面坐标（绑定端的字面值不参与渲染）
        if (d.end === "from") {
          points[0] = d.x;
          points[1] = d.y;
        } else {
          points[2] = d.x;
          points[3] = d.y;
        }
      }
      const nextConn: WBConnectorElement = { ...conn, points };
      if (!connects.from && !connects.to) delete nextConn.connects;
      else nextConn.connects = connects;
      const same =
        JSON.stringify(nextConn.connects ?? null) ===
          JSON.stringify(conn.connects ?? null) &&
        points.every((v, i) => v === conn.points[i]);
      if (same) return; // 无变化不写历史
      commitElements(cur.map((x) => (x.id === conn.id ? nextConn : x)));
      return;
    }

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
    } else if (draft.type === "connector") {
      const [x0, y0, x1, y1] =
        draft.points.length === 4
          ? (draft.points as [number, number, number, number])
          : ([draft.startX, draft.startY, draft.startX, draft.startY] as [
              number,
              number,
              number,
              number,
            ]);
      const fromId = draft.fromId;
      const toId = findBindableAt(x1, y1, fromId) ?? undefined;
      const dist = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      // 统一 MIN_DRAG 门槛：纯点击（未拖动）不生成退化连线
      if (dist >= MIN_DRAG) {
        if (!fromId && !toId) {
          el = {
            ...base,
            id: genId(),
            type: "connector",
            points: [x0, y0, x1, y1],
            arrowhead,
          };
        } else {
          const connects: { from?: string; to?: string } = {};
          if (fromId) connects.from = fromId;
          if (toId) connects.to = toId;
          el = {
            ...base,
            id: genId(),
            type: "connector",
            points: [x0, y0, x1, y1],
            connects,
            arrowhead,
          };
        }
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
      }
    }
    setDraft(null);
    setSnapTargetId(null);
    if (el) {
      commitElements([...elementsRef.current, el]);
      // 新画完矩形/椭圆自动进入 label 编辑（§5.2/§5.4；Esc 或空提交则跳过，图形保留）
      if (el.type === "rect" || el.type === "ellipse")
        setEditing({ kind: "label", id: el.id });
    }
  }, [
    draft,
    epDrag,
    marquee,
    color,
    width,
    arrowhead,
    commitElements,
    findBindableAt,
  ]);

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
        setSelectedIds([]);
        setEditing({ kind: "text", id });
      } else if (
        el.type === "rect" ||
        el.type === "ellipse" ||
        el.type === "connector"
      ) {
        setSelectedIds([]);
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

      // kind === "label"（图形内文字 / 连线中点文字）
      const isShape = el.type === "rect" || el.type === "ellipse";
      const isConn = el.type === "connector";
      if (!isShape && !isConn) return;
      if (!commit || trimmed === "") {
        // 取消：无变化；空提交：只移除 label，不删元素
        if (commit && trimmed === "" && el.label)
          commitElements(
            cur.map((x) => {
              if (x.id !== el.id) return x;
              if (
                x.type === "rect" ||
                x.type === "ellipse" ||
                x.type === "connector"
              )
                return { ...x, label: undefined };
              return x;
            }),
          );
        return;
      }
      commitElements(
        cur.map((x) => {
          if (x.id !== el.id) return x;
          if (x.type === "rect" || x.type === "ellipse")
            return growShapeForLabel({ ...x, label: trimmed }, trimmed);
          if (x.type === "connector") return { ...x, label: trimmed };
          return x;
        }),
      );
    },
    [commitElements],
  );

  const onSelect = useCallback(
    (id: string, e?: Konva.KonvaEventObject<MouseEvent>) => {
      if (toolRef.current === "pen") return; // 画笔态不选中（避免与起笔冲突）
      // 拖动结束后的 click 忽略，避免"拖完误改选中/误进入编辑"
      if (justDraggedRef.current) {
        justDraggedRef.current = false;
        return;
      }
      const additive = !!(
        e &&
        (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)
      );
      const cur = selectedRef.current;
      if (additive) {
        setSelectedIds(
          cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
        );
        return;
      }
      // 已在此选中集合中
      if (cur.includes(id)) {
        // 多选时点击其一 → 收缩为"仅此元素"
        if (cur.length > 1) {
          setSelectedIds([id]);
          return;
        }
        // 单选：选择态"再点"进入编辑（绘制态编辑走双击）
        if (toolRef.current === "select") {
          const el = elementsRef.current.find((x) => x.id === id);
          if (!el) return;
          if (el.type === "text") {
            setSelectedIds([]);
            setEditing({ kind: "text", id });
          } else if (
            el.type === "rect" ||
            el.type === "ellipse" ||
            el.type === "connector"
          ) {
            setEditing({ kind: "label", id }); // 保持选中
          }
        }
        return;
      }
      setSelectedIds([id]);
    },
    [],
  );

  /** 缩放中：同上（Transformer 每帧触发 transform） */
  const onElementTransform = useCallback(
    (id: string) => {
      updateConnectedConnectors(id);
    },
    [updateConnectedConnectors],
  );

  /** 缩放收尾（挂在 Transformer 上，整组一次性提交，避免每个节点各写一次历史） */
  const onSelectionTransformEnd = useCallback(() => {
    const cur = elementsRef.current;
    const entries: { id: string; node: Konva.Node; sx: number; sy: number }[] =
      [];
    for (const id of selectedRef.current) {
      const node = nodesRef.current.get(id);
      const el = cur.find((x) => x.id === id);
      if (!node || !el || el.type === "connector") continue;
      const sx = node.scaleX();
      const sy = node.scaleY();
      if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) continue;
      entries.push({ id, node, sx, sy });
    }
    if (!entries.length) return;
    const byIdMap = new Map(entries.map((e) => [e.id, e]));
    const next = cur.map((el): WBElement => {
      const e = byIdMap.get(el.id);
      if (!e) return el;
      const { node, sx, sy } = e;
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
        case "text": {
          return {
            ...el,
            x: node.x(),
            y: node.y(),
            size: Math.max(8, Math.round((el.size ?? 16) * sy)),
          };
        }
        default:
          return el;
      }
    });
    for (const e of entries) {
      e.node.scale({ x: 1, y: 1 });
      const el = cur.find((x) => x.id === e.id);
      // path 的 x/y 是临时位移（已并入 points），必须归零；rect/ellipse/text 的 x/y 即元素坐标
      if (el?.type === "path") e.node.position({ x: 0, y: 0 });
    }
    commitElements(next);
  }, [commitElements]);

  // 中断不是正常 pointerup：不提交草稿或端点预览，已实时写入的移动只记一次历史。
  const interruptGesture = useCallback(() => {
    activePointerRef.current = null;
    spaceRef.current = false;
    hoverRef.current = false;
    setPanning(false);
    const stage = stageRef.current;
    if (stage?.isDragging()) {
      stage.stopDrag();
      setView((v) => ({ ...v, offsetX: stage.x(), offsetY: stage.y() }));
    }
    const transformer = trRef.current;
    if (transformer?.isTransforming()) {
      // Konva stopTransform 同步发 transformend，由既有回调提交且归一化节点。
      transformer.stopTransform();
    }
    const mv = moveRef.current;
    moveRef.current = null;
    if (mv?.moved) {
      historyRef.current.push(mv.before);
      setHistoryTick((t) => t + 1);
    }
    justDraggedRef.current = false; // 取消不会产生需要吞掉的正常 click
    setDraggingId(null);
    setDraft(null);
    setEpDrag(null);
    setSnapTargetId(null);
    setMarquee(null);
    if (containerRef.current) containerRef.current.style.cursor = "";
  }, []);

  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      if (activePointerRef.current !== e.pointerId) return;
      activePointerRef.current = null;
      // 画布内正常松手由 Konva 提交；画布外只保留实时变更、丢弃预览。
      const canvas = stageRef.current?.content;
      if (!canvas || !e.composedPath().includes(canvas)) interruptGesture();
    };
    const onCancel = (e: PointerEvent) => {
      if (activePointerRef.current === e.pointerId) interruptGesture();
    };
    const onVisibility = () => {
      if (document.hidden) interruptGesture();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", interruptGesture);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", interruptGesture);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [interruptGesture]);

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
    // connector（两点式；起点已绑定图形时吸附到其边缘）
    let sx = draft.startX;
    let sy = draft.startY;
    if (draft.fromId) {
      const fromEl = byId.get(draft.fromId);
      if (fromEl)
        [sx, sy] = bboxBoundaryPoint(getElementBounds(fromEl), x1, y1, 2);
    }
    return {
      ...base,
      type: "connector",
      points: [sx, sy, x1, y1],
      arrowhead,
    };
  }, [draft, color, width, arrowhead, byId]);

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
  const movableOf = (id: string) => {
    // 画笔态不拖；连线态一律不拖（拖拽 = 从图形拉出连线，二者语义冲突）
    if (panning || tool === "pen" || tool === "connector") return false;
    const el = byId.get(id);
    // 绑定端由图形决定位置，连线整体不可拖（自由端用端点手柄调整）
    if (el?.type === "connector" && (el.connects?.from || el.connects?.to))
      return false;
    return tool === "select" ? selectedIds.includes(id) : true;
  };

  // 属性条：常驻。选中集合时直接作用于全部选中；未选中时设置"新建默认值"
  const applyColor = (c: WBColorId) => {
    setColor(c);
    const ids = selectedRef.current;
    if (ids.length)
      commitElements(
        elementsRef.current.map((el) =>
          ids.includes(el.id) ? { ...el, color: c } : el,
        ),
      );
  };
  const applyWidth = (w: WBWidthId) => {
    setWidth(w);
    const ids = selectedRef.current;
    if (ids.length)
      commitElements(
        elementsRef.current.map((el) =>
          ids.includes(el.id) ? { ...el, width: w } : el,
        ),
      );
  };
  const applyArrowhead = (a: WBArrowhead) => {
    setArrowhead(a);
    const ids = selectedRef.current;
    if (ids.length)
      commitElements(
        elementsRef.current.map((el) =>
          el.type === "connector" && ids.includes(el.id)
            ? { ...el, arrowhead: a }
            : el,
        ),
      );
  };

  // 元素 hover 光标反馈（仅"已选中、可拖动"时显示 move）
  const onHoverCursor = useCallback((cursor: string) => {
    const container = stageRef.current?.container();
    if (container) container.style.cursor = cursor;
  }, []);

  // 工具/选中态变化时复位光标，避免取消选中后残留 move 光标
  useEffect(() => {
    onHoverCursor("");
  }, [tool, selectedIds, onHoverCursor]);

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
      {/* 属性条常驻：选中元素作用于它，未选中设置默认值；连线时显示箭头样式 */}
      <WhiteboardAttrBar
        theme={theme}
        color={selectedEl ? selectedEl.color : color}
        onColorChange={applyColor}
        width={selectedEl ? selectedEl.width : width}
        onWidthChange={applyWidth}
        showArrowhead={tool === "connector" || selectedEl?.type === "connector"}
        arrowhead={
          selectedEl?.type === "connector" ? selectedEl.arrowhead : arrowhead
        }
        onArrowheadChange={applyArrowhead}
      />
      <div className="la-wb-body">
        <ShapeRail onPick={handlePickPreset} />
        <div
          ref={containerRef}
          className="la-wb-stage"
          onPointerDownCapture={(e) => {
            if (e.button === 0 && e.target instanceof HTMLCanvasElement) {
              activePointerRef.current = e.pointerId;
              hoverRef.current = true;
              justDraggedRef.current = false;
            }
          }}
          onPointerMove={() => {
            // 返回窗口后无需移出再移入才能恢复 hover 快捷键。
            hoverRef.current = true;
          }}
          onMouseEnter={() => (hoverRef.current = true)}
          onMouseLeave={() => {
            hoverRef.current = false;
            spaceRef.current = false;
            const stage = stageRef.current;
            if (stage?.isDragging()) {
              stage.stopDrag();
              setView((v) => ({ ...v, offsetX: stage.x(), offsetY: stage.y() }));
            }
            setPanning(false);
            setMarquee(null); // 指针移出画布：中止框选，避免残留
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
                    resolved={
                      el.type === "connector"
                        ? connectorPoints.get(el.id)
                        : undefined
                    }
                    nodeRef={registerNode}
                    onSelect={onSelect}
                    onHoverCursor={onHoverCursor}
                    onTransform={onElementTransform}
                    onTransformEnd={() => {}} // 缩放提交统一在 Transformer.onTransformEnd，避免每节点各写历史
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
                  onTransformEnd={() => {}}
                />
              )}
              {/* 框选橡皮筋（超过阈值才显示，避免"轻点"也画框） */}
              {marquee &&
                (() => {
                  const r = normRect(
                    marquee.x0,
                    marquee.y0,
                    marquee.x1,
                    marquee.y1,
                  );
                  if (r.w <= 3 && r.h <= 3) return null;
                  return (
                    <Rect
                      x={r.x}
                      y={r.y}
                      width={r.w}
                      height={r.h}
                      fill={WB_COLORS.blue[theme]}
                      opacity={0.08}
                      stroke={WB_COLORS.blue[theme]}
                      strokeWidth={1 / view.scale}
                      dash={[4 / view.scale, 3 / view.scale]}
                      listening={false}
                    />
                  );
                })()}
              {/* 连线吸附高亮 */}
              {snapTargetId &&
                (() => {
                  const el = byId.get(snapTargetId);
                  if (!el) return null;
                  const b = getElementBounds(el);
                  const pad = 4;
                  return (
                    <Rect
                      x={b.x - pad}
                      y={b.y - pad}
                      width={b.w + pad * 2}
                      height={b.h + pad * 2}
                      stroke={WB_COLORS.blue[theme]}
                      strokeWidth={1.5 / view.scale}
                      dash={[6 / view.scale, 4 / view.scale]}
                      listening={false}
                    />
                  );
                })()}
              {/* 端点重绑定幽灵线 */}
              {epDrag &&
                (() => {
                  const conn = byId.get(epDrag.connectorId);
                  if (!conn || conn.type !== "connector") return null;
                  const pts = connectorPoints.get(conn.id) ?? conn.points;
                  const fixed: [number, number] =
                    epDrag.end === "from" ? [pts[2], pts[3]] : [pts[0], pts[1]];
                  const seg: [number, number, number, number] =
                    epDrag.end === "from"
                      ? [epDrag.x, epDrag.y, fixed[0], fixed[1]]
                      : [fixed[0], fixed[1], epDrag.x, epDrag.y];
                  return (
                    <Line
                      points={seg}
                      stroke={WB_COLORS[conn.color][theme]}
                      strokeWidth={WB_WIDTHS[conn.width]}
                      dash={[6 / view.scale, 4 / view.scale]}
                      listening={false}
                    />
                  );
                })()}
              {/* 连线端点手柄（选中连线时；拖动该连线期间隐藏，避免留在原地） */}
              {editingConnector &&
                selectable &&
                draggingId !== editingConnector.id &&
                (() => {
                  const pts =
                    connectorPoints.get(editingConnector.id) ??
                    editingConnector.points;
                  const ends: { end: "from" | "to"; x: number; y: number }[] = [
                    { end: "from", x: pts[0], y: pts[1] },
                    { end: "to", x: pts[2], y: pts[3] },
                  ];
                  return ends.map((h) => {
                    const active =
                      epDrag &&
                      epDrag.connectorId === editingConnector.id &&
                      epDrag.end === h.end;
                    return (
                      <Circle
                        key={h.end}
                        ref={(n: Konva.Circle | null) => {
                          if (n) epNodesRef.current[h.end] = n;
                          else delete epNodesRef.current[h.end];
                        }}
                        x={active ? epDrag.x : h.x}
                        y={active ? epDrag.y : h.y}
                        radius={HANDLE_R / view.scale}
                        fill={WB_COLORS[editingConnector.color][theme]}
                        stroke={WB_CANVAS_BG[theme]}
                        strokeWidth={1.5 / view.scale}
                        onPointerDown={(e) => {
                          e.cancelBubble = true;
                          setEpDrag({
                            connectorId: editingConnector.id,
                            end: h.end,
                            x: h.x,
                            y: h.y,
                          });
                        }}
                      />
                    );
                  });
                })()}
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                flipEnabled={false}
                ignoreStroke
                onTransformEnd={onSelectionTransformEnd}
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
        {/* [临时] 标注预览按钮（浮动，避免被工具栏裁掉）；P3 接上 AI 路径后删除 */}
        <button
          className="la-dev-demo"
          title="插入带标注的示例 DSL（临时预览）"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={insertDemoDiagram}
        >
          [DEV] 示例标注
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
            // 连线中点 label
            if (editing.kind === "label" && el.type === "connector") {
              const pts = connectorPoints.get(el.id) ?? el.points;
              const size = el.labelSize ?? LABEL_DEFAULT_SIZE;
              const est = estimateTextSize(el.label ?? "", size);
              const boxW = Math.max(60, est.w + 16);
              const boxH = Math.max(24, est.h + 8);
              return (
                <TextEditor
                  key={"cl-" + el.id}
                  theme={theme}
                  view={view}
                  x={(pts[0] + pts[2]) / 2 - boxW / 2}
                  y={(pts[1] + pts[3]) / 2 - boxH / 2}
                  box={{ w: boxW, h: boxH }}
                  fontSize={size}
                  colorId={el.color}
                  initial={el.label ?? ""}
                  onCommit={(text) => finishEdit(editing, text, true)}
                  onCancel={() => finishEdit(editing, "", false)}
                />
              );
            }
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
        {presetDialog && (
          <ParamDialog
            preset={presetDialog}
            onConfirm={(params) => {
              insertPreset(presetDialog, params);
              setPresetDialog(null);
            }}
            onCancel={() => setPresetDialog(null)}
          />
        )}
        </div>
      </div>
    </>
  );
}
