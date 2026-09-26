// 顶部工具行（plan/03 §5.1）：工具切换 + 属性条（颜色/线宽）+ 撤销/重做 + 清空。
// 纯展示组件，状态由 Whiteboard 容器下传。
import type { ResolvedTheme, WBColorId, WBWidthId } from "../theme";
import { WB_COLORS } from "../theme";
import type { WBArrowhead } from "./model";

export type WBTool = "select" | "pen" | "rect" | "ellipse" | "connector" | "text";

export interface ToolbarProps {
  tool: WBTool;
  onToolChange: (t: WBTool) => void;
  /** 工具 → 快捷键提示（由 bindings.tools 反推，配置可改则提示随动） */
  toolKeys: Partial<Record<WBTool, string>>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

const TOOLS: { id: WBTool; label: string }[] = [
  { id: "select", label: "选择" },
  { id: "pen", label: "画笔" },
  { id: "rect", label: "矩形" },
  { id: "ellipse", label: "圆形" },
  { id: "connector", label: "连线" },
  { id: "text", label: "文本" },
];

export function WhiteboardToolbar({
  tool,
  onToolChange,
  toolKeys,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
}: ToolbarProps) {
  return (
    <>
      {TOOLS.map((t) => {
        const key = toolKeys[t.id];
        return (
          <button
            key={t.id}
            className="la-wb-tool"
            data-active={tool === t.id}
            title={key ? `${t.label}（${key.toUpperCase()}）` : t.label}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onToolChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
      <span className="la-wb-sep" />
      <button
        className="la-wb-tool"
        disabled={!canUndo}
        title="撤销（Ctrl+Z）"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onUndo}
      >
        撤销
      </button>
      <button
        className="la-wb-tool"
        disabled={!canRedo}
        title="重做（Ctrl+Shift+Z）"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onRedo}
      >
        重做
      </button>
      <span className="la-wb-sep" />
      <button
        className="la-wb-tool la-wb-danger"
        title="清空画布"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClear}
      >
        清空
      </button>
    </>
  );
}

// 颜色/线宽属性条（绘图/文本/连线工具激活，或选中连线时显示，§5.1）
export interface AttrBarProps {
  theme: ResolvedTheme;
  color: WBColorId;
  onColorChange: (c: WBColorId) => void;
  width: WBWidthId;
  onWidthChange: (w: WBWidthId) => void;
  /** 连线工具激活或选中连线时，追加箭头样式选择器 */
  showArrowhead: boolean;
  arrowhead: WBArrowhead;
  onArrowheadChange: (a: WBArrowhead) => void;
}

const COLOR_LABEL: Record<WBColorId, string> = {
  default: "默认（随主题）",
  red: "红",
  blue: "蓝",
  green: "绿",
  orange: "橙",
};

const WIDTH_LABEL: Record<WBWidthId, string> = {
  thin: "细",
  medium: "中",
  thick: "粗",
};

const ARROWHEAD_LABEL: Record<WBArrowhead, string> = {
  none: "无箭头",
  start: "反向箭头（起点）",
  end: "正向箭头（终点）",
  both: "双向箭头",
};

const ARROWHEAD_TEXT: Record<WBArrowhead, string> = {
  none: "无",
  start: "←",
  end: "→",
  both: "↔",
};

const COLOR_ORDER: WBColorId[] = ["default", "red", "blue", "green", "orange"];
const WIDTH_ORDER: WBWidthId[] = ["thin", "medium", "thick"];
const ARROWHEAD_ORDER: WBArrowhead[] = ["none", "end", "start", "both"];

export function WhiteboardAttrBar({
  theme,
  color,
  onColorChange,
  width,
  onWidthChange,
  showArrowhead,
  arrowhead,
  onArrowheadChange,
}: AttrBarProps) {
  return (
    <div className="la-wb-attrbar" onPointerDown={(e) => e.stopPropagation()}>
      {COLOR_ORDER.map((c) => (
        <button
          key={c}
          className="la-wb-color"
          data-active={color === c}
          title={COLOR_LABEL[c]}
          style={{ background: WB_COLORS[c][theme] }}
          onClick={() => onColorChange(c)}
        />
      ))}
      <span className="la-wb-sep" />
      {WIDTH_ORDER.map((w) => (
        <button
          key={w}
          className="la-wb-width"
          data-active={width === w}
          title={WIDTH_LABEL[w]}
          onClick={() => onWidthChange(w)}
        >
          {WIDTH_LABEL[w]}
        </button>
      ))}
      {showArrowhead && (
        <>
          <span className="la-wb-sep" />
          {ARROWHEAD_ORDER.map((a) => (
            <button
              key={a}
              className="la-wb-width"
              data-active={arrowhead === a}
              title={ARROWHEAD_LABEL[a]}
              onClick={() => onArrowheadChange(a)}
            >
              {ARROWHEAD_TEXT[a]}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
