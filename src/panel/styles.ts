// 面板样式以字符串形式注入 Shadow Root（adoptedStyleSheets 的简化版：style 标签在 shadow 内），
// 与页面样式双向隔离。正式 UI 阶段可改为构建期 CSS + adoptedStyleSheets。
// 颜色规则（plan/01 §3.7）：只允许 var(--la-*)，禁止硬编码颜色；token 定义见 theme.ts。
import { THEME_VARS_CSS } from "./theme";

export const PANEL_CSS = `
${THEME_VARS_CSS}

:host {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", sans-serif;
}
:host * { box-sizing: border-box; }

.la-root { display: contents; }

.la-logo {
  pointer-events: auto;
  position: fixed;
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 50%;
  border: none;
  cursor: grab;
  background: transparent;
  overflow: hidden;
  box-shadow: var(--la-shadow-logo);
  animation: la-float 3s ease-in-out infinite;
  /* transform 回弹 + left 过渡（拖动松手后吸附右边缘） */
  transition:
    transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
    left 0.18s ease-out;
  user-select: none;
}
.la-logo:hover { transform: scale(1.08) rotate(6deg); }
.la-logo:active { cursor: grabbing; transform: scale(0.94); }
.la-logo[data-hidden="true"] { display: none; }
.la-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
@keyframes la-float {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -3px; }
}

.la-panel {
  pointer-events: auto;
  position: fixed;
  display: flex;
  background: var(--la-bg);
  border: 1px solid var(--la-border);
  border-radius: 10px;
  box-shadow: var(--la-shadow-panel);
  overflow: hidden;
  transform-origin: bottom right;
  color: var(--la-text);
}
.la-panel[data-closed="true"] { display: none; }

.la-col-whiteboard {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--la-surface);
  min-width: 0;
}
.la-wb-topbar {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--la-border-soft);
  color: var(--la-text-dim);
  font-size: 12px;
  align-items: center;
}
.la-wb-body { flex: 1; display: flex; min-height: 0; }
.la-wb-shapes {
  width: 40px;
  border-right: 1px solid var(--la-border-soft);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  color: var(--la-text-dim);
  font-size: 11px;
}
.la-wb-canvas {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--la-text-faint);
  font-size: 13px;
}
/* Konva 画布容器：填满 wb-body 剩余空间，背景随主题 */
.la-wb-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--la-surface);
  overflow: hidden;
}
.la-wb-stage[data-panning="true"] { cursor: grab; }
.la-wb-stage[data-panning="true"]:active { cursor: grabbing; }
.la-wb-zoomreset {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 3px 8px;
  border: 1px solid var(--la-border);
  border-radius: 6px;
  background: var(--la-surface);
  color: var(--la-text-dim);
  font-size: 11px;
  cursor: pointer;
  z-index: 2;
}
.la-wb-zoomreset:hover { background: var(--la-hover); }

/* 画板工具行按钮 */
.la-wb-tool {
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--la-text-dim);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.la-wb-tool:hover:not(:disabled) { background: var(--la-hover); }
.la-wb-tool:disabled { opacity: 0.4; cursor: default; }
.la-wb-tool[data-active="true"] {
  background: var(--la-accent);
  color: var(--la-on-accent);
}
.la-wb-danger:hover:not(:disabled) {
  background: var(--la-danger);
  color: var(--la-on-accent);
}
.la-wb-sep {
  width: 1px;
  align-self: stretch;
  margin: 2px 2px;
  background: var(--la-border-soft);
}
/* 属性条：颜色点 + 线宽 */
.la-wb-attrbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--la-border-soft);
}
.la-wb-color {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.la-wb-color[data-active="true"] {
  border-color: var(--la-accent);
  box-shadow: 0 0 0 2px var(--la-surface);
}
.la-wb-width {
  padding: 2px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--la-text-dim);
  font-size: 11px;
  cursor: pointer;
}
.la-wb-width:hover { background: var(--la-hover); }
.la-wb-width[data-active="true"] {
  background: var(--la-accent);
  color: var(--la-on-accent);
}
/* 清空二次确认条 */
.la-wb-confirm {
  position: absolute;
  left: 50%;
  bottom: 40px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--la-border);
  border-radius: 8px;
  background: var(--la-surface);
  box-shadow: var(--la-shadow-pop);
  color: var(--la-text);
  font-size: 12px;
  z-index: 4;
  white-space: nowrap;
}
/* 工具光标 */
.la-wb-stage[data-tool="pen"],
.la-wb-stage[data-tool="rect"],
.la-wb-stage[data-tool="ellipse"],
.la-wb-stage[data-tool="connector"],
.la-wb-stage[data-tool="text"] { cursor: crosshair; }
/* 文本编辑覆盖层（Konva textarea 方案） */
.la-wb-texteditor {
  position: absolute;
  margin: 0;
  padding: 2px 4px;
  border: 1px dashed var(--la-accent);
  border-radius: 4px;
  background: var(--la-surface);
  outline: none;
  font-family: inherit;
  line-height: 1.3;
  resize: none;
  overflow: hidden;
  z-index: 5;
  min-width: 80px;
  box-shadow: var(--la-shadow-ear);
}

.la-toolbar {
  width: 46px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  background: var(--la-toolbar-bg);
  border-left: 1px solid var(--la-border);
  border-right: 1px solid var(--la-border);
  cursor: col-resize;
  user-select: none;
}
.la-tool-btn {
  width: 36px;
  padding: 6px 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--la-text-dim);
  font-size: 11px;
  cursor: pointer;
}
.la-tool-btn:hover { background: var(--la-hover); }
.la-tool-btn[data-active="true"] {
  background: var(--la-accent);
  color: var(--la-on-accent);
}
/* 主题切换按钮：压底（margin-top:auto），图标为当前模式 */
.la-theme-btn {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.la-theme-btn svg { display: block; }
/* 一键收起为悬浮图标：工具栏顶部通栏按钮，窗口式 X 图案，hover 变红 */
.la-collapse {
  width: 100%;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: var(--la-hover);
  color: var(--la-text-dim);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: -8px 0 2px; /* 抵消工具栏 padding-top，通栏贴顶 */
  transition: background 0.15s ease, color 0.15s ease;
}
.la-collapse:hover { background: var(--la-danger); color: var(--la-on-accent); }
.la-collapse:active {
  background: var(--la-danger-strong);
  color: var(--la-on-accent);
}
/* 单栏收起/展开"耳朵"按钮：绝对定位贴在工具栏竖边外侧，垂直居中 */
.la-ear {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 52px;
  padding: 0;
  border: 1px solid var(--la-border);
  border-radius: 6px;
  background: var(--la-surface);
  box-shadow: var(--la-shadow-ear);
  color: var(--la-text-dim);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  z-index: 3;
}
.la-ear:hover { background: var(--la-hover); color: var(--la-accent); }
/* 跟随栏宽过渡（仅切换瞬间由 data-anim 开启） */
.la-ear[data-anim="true"] {
  transition: left 0.28s cubic-bezier(0.34, 1.3, 0.64, 1);
}
/* 收起/展开时的栏宽过渡（仅切换瞬间由 data-anim 开启） */
.la-col-whiteboard[data-anim="true"],
.la-col-agent[data-anim="true"] {
  transition: flex-basis 0.28s cubic-bezier(0.34, 1.3, 0.64, 1);
}
.la-col-whiteboard,
.la-col-agent {
  overflow: hidden;
}

.la-col-agent {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--la-surface);
}
.la-agent-head {
  padding: 8px 12px;
  border-bottom: 1px solid var(--la-border-soft);
  font-size: 13px;
  font-weight: 600;
  color: var(--la-text);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.la-agent-msgs {
  flex: 1;
  padding: 12px;
  color: var(--la-text-faint);
  font-size: 13px;
  overflow: auto;
}
.la-agent-input {
  border-top: 1px solid var(--la-border-soft);
  padding: 8px 12px;
  color: var(--la-text-faint);
  font-size: 12px;
}
.la-agent-foot {
  display: flex;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--la-border-soft);
  color: var(--la-text-faint);
  font-size: 12px;
}

.la-popover {
  pointer-events: auto;
  position: fixed;
  min-width: 220px;
  background: var(--la-surface);
  border: 1px solid var(--la-border);
  border-radius: 8px;
  box-shadow: var(--la-shadow-pop);
  padding: 12px;
  font-size: 12px;
  color: var(--la-text-dim);
}

/* 面板拖拽区（左栏顶部工具行 / 右栏标题栏） */
.la-drag { cursor: move; user-select: none; }

.la-handle { position: absolute; }
.la-handle-n { top: 0; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.la-handle-s { bottom: 0; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.la-handle-e { right: 0; top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }
.la-handle-w { left: 0; top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }
.la-handle-ne { top: 0; right: 0; width: 12px; height: 12px; cursor: nesw-resize; }
.la-handle-nw { top: 0; left: 0; width: 12px; height: 12px; cursor: nwse-resize; }
.la-handle-se { bottom: 0; right: 0; width: 12px; height: 12px; cursor: nwse-resize; }
.la-handle-sw { bottom: 0; left: 0; width: 12px; height: 12px; cursor: nesw-resize; }
`;
