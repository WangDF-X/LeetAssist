// 文本编辑覆盖层（plan/03 §5.1 文本工具）：Konva 官方做法——
// 编辑时在文本位置覆盖一个 HTML textarea（DOM 在 Shadow Root 内，样式走 token），
// 失焦提交、Esc 取消、Ctrl+Enter 提交；位置和字号跟随视图缩放。
import { useEffect, useRef, useState } from "react";
import type { ResolvedTheme } from "../theme";
import { WB_COLORS } from "../theme";
import type { WBTextElement, WBViewState } from "./model";

export interface TextEditorProps {
  el: WBTextElement;
  theme: ResolvedTheme;
  view: WBViewState;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

export function TextEditor({
  el,
  theme,
  view,
  onCommit,
  onCancel,
}: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(el.text);
  const doneRef = useRef(false);

  const autoSize = (ta: HTMLTextAreaElement) => {
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
    ta.style.width = "auto";
    ta.style.width = `${Math.max(80, ta.scrollWidth + 8)}px`;
  };

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    autoSize(ta);
  }, []);

  const finish = (commit: boolean, text: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit(text);
    else onCancel();
  };

  return (
    <textarea
      ref={ref}
      className="la-wb-texteditor"
      style={{
        left: el.x * view.scale + view.offsetX,
        top: el.y * view.scale + view.offsetY,
        fontSize: (el.size ?? 16) * view.scale,
        color: WB_COLORS[el.color][theme],
      }}
      value={value}
      placeholder="输入文本"
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
