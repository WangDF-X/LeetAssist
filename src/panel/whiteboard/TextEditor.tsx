// 文本编辑覆盖层（plan/03 §5.1/§5.4）：Konva 官方做法——编辑时覆盖一个 HTML textarea
// （DOM 在 Shadow Root 内，样式走 token），失焦提交、Esc 取消、Ctrl+Enter 提交。
// 两种形态：
// - 独立文本：左上角锚定、随内容自适应尺寸；
// - 图形 label（§4.2 2026-09-22）：给 box（图形世界尺寸）时在框内水平垂直居中，
//   宽度受内框约束，颜色/字号与将要渲染的 label 一致。
import { useEffect, useRef, useState } from "react";
import type { ResolvedTheme, WBColorId } from "../theme";
import { WB_COLORS } from "../theme";
import { LABEL_PADDING } from "./model";

export interface TextEditorProps {
  theme: ResolvedTheme;
  view: { scale: number; offsetX: number; offsetY: number };
  /** 世界坐标：独立文本 = 左上角；label = 图形左上角（配合 box 居中） */
  x: number;
  y: number;
  fontSize: number;
  colorId: WBColorId;
  /** 存在 = label 编辑模式：在该 w×h（世界尺寸）图形内居中 */
  box?: { w: number; h: number };
  initial: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

export function TextEditor({
  theme,
  view,
  x,
  y,
  fontSize,
  colorId,
  box,
  initial,
  onCommit,
  onCancel,
}: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  const doneRef = useRef(false);

  const autoSize = (ta: HTMLTextAreaElement) => {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
    if (!box) {
      ta.style.width = "auto";
      ta.style.width = `${Math.max(80, ta.scrollWidth + 8)}px`;
    }
  };

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    autoSize(ta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (commit: boolean, text: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit(text);
    else onCancel();
  };

  const { scale, offsetX, offsetY } = view;
  const style: React.CSSProperties = box
    ? {
        left: (x + box.w / 2) * scale + offsetX,
        top: (y + box.h / 2) * scale + offsetY,
        transform: "translate(-50%, -50%)",
        width: Math.max(60, (box.w - LABEL_PADDING * 2) * scale),
        textAlign: "center",
        fontSize: fontSize * scale,
        color: WB_COLORS[colorId][theme],
      }
    : {
        left: x * scale + offsetX,
        top: y * scale + offsetY,
        fontSize: fontSize * scale,
        color: WB_COLORS[colorId][theme],
      };

  return (
    <textarea
      ref={ref}
      className="la-wb-texteditor"
      style={style}
      value={value}
      placeholder={box ? "输入图形文字" : "输入文本"}
      onChange={(e) => {
        setValue(e.target.value);
        autoSize(e.target);
      }}
      onBlur={() => finish(true, value)}
      onKeyDown={(e) => {
        e.stopPropagation(); // 编辑中不触发画板快捷键（§5.2 门控）
        if (e.key === "Escape") finish(false, value);
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(true, value);
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
