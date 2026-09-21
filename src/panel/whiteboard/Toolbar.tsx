// 顶部工具行（plan/03 §5.1）：工具切换 + 属性条（颜色/线宽）+ 撤销/重做 + 清空。
// 纯展示组件，状态由 Whiteboard 容器下传。
import type { ResolvedTheme, WBColorId, WBWidthId } from "../theme";
import { WB_COLORS } from "../theme";

export type WBTool = "select" | "pen" | "rect" | "ellipse" | "arrow" | "text";

export interface ToolbarProps {
  tool: WBTool;
  onToolChange: (t: WBTool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

const TOOLS: { id: WBTool; label: string; key: string }[] = [
  { id: "select", label: "选择", key: "V" },
  { id: "pen", label: "画笔", key: "P" },
  { id: "rect", label: "矩形", key: "R" },
  { id: "ellipse", label: "圆形", key: "O" },
  { id: "arrow", label: "箭头", key: "A" },
  { id: "text", label: "文本", key: "T" },
];

export function WhiteboardToolbar({
  tool,
  onToolChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
}: ToolbarProps) {
  return (
    <>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className="la-wb-tool"
          data-active={tool === t.id}
          title={`${t.label}（${t.key}）`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onToolChange(t.id)}
        >
          {t.label}
        </button>
      ))}
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

// 颜色/线宽属性条（仅绘图/文本工具激活时显示，§5.1）
export interface AttrBarProps {
  theme: ResolvedTheme;
  color: WBColorId;
  onColorChange: (c: WBColorId) => void;
  width: WBWidthId;
  onWidthChange: (w: WBWidthId) => void;
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

const COLOR_ORDER: WBColorId[] = ["default", "red", "blue", "green", "orange"];
const WIDTH_ORDER: WBWidthId[] = ["thin", "medium", "thick"];

export function WhiteboardAttrBar({
  theme,
  color,
  onColorChange,
  width,
  onWidthChange,
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
    </div>
  );
}
