// 面板样式以字符串形式注入 Shadow Root（adoptedStyleSheets 的简化版：style 标签在 shadow 内），
// 与页面样式双向隔离。正式 UI 阶段可改为构建期 CSS + adoptedStyleSheets。
export const PANEL_CSS = `
:host {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", sans-serif;
}
:host * { box-sizing: border-box; }

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
  box-shadow: 0 6px 18px rgba(60, 60, 120, 0.35);
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
  background: #f7f8fa;
  border: 1px solid #d8dce3;
  border-radius: 10px;
  box-shadow: 0 18px 50px rgba(30, 35, 60, 0.28);
  overflow: hidden;
  transform-origin: bottom right;
}
.la-panel[data-closed="true"] { display: none; }

.la-col-whiteboard {
  position: relative;
  display: flex;
  flex-direction: column;
  background: #fdfefe;
  min-width: 0;
}
.la-wb-topbar {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid #e6e9ee;
  color: #6b7280;
  font-size: 12px;
  align-items: center;
}
.la-wb-body { flex: 1; display: flex; min-height: 0; }
.la-wb-shapes {
  width: 40px;
  border-right: 1px solid #e6e9ee;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  color: #6b7280;
  font-size: 11px;
}
.la-wb-canvas {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa3af;
  font-size: 13px;
}

.la-toolbar {
  width: 46px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  background: #eef1f5;
  border-left: 1px solid #d8dce3;
  border-right: 1px solid #d8dce3;
  cursor: col-resize;
  user-select: none;
}
.la-tool-btn {
  width: 36px;
  padding: 6px 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #4b5563;
  font-size: 11px;
  cursor: pointer;
}
.la-tool-btn:hover { background: #dde3ea; }
.la-tool-btn[data-active="true"] { background: #22a7f0; color: #fff; }
.la-collapse {
  color: #22a7f0;
  font-size: 15px;
  line-height: 1;
  margin-bottom: 4px;
  border-bottom: 1px solid #d8dce3;
  border-radius: 0 0 6px 6px;
}

.la-col-agent {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #fbfcfd;
}
.la-agent-head {
  padding: 8px 12px;
  border-bottom: 1px solid #e6e9ee;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.la-agent-msgs {
  flex: 1;
  padding: 12px;
  color: #9aa3af;
  font-size: 13px;
  overflow: auto;
}
.la-agent-input {
  border-top: 1px solid #e6e9ee;
  padding: 8px 12px;
  color: #9aa3af;
  font-size: 12px;
}
.la-agent-foot {
  display: flex;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid #e6e9ee;
  color: #9aa3af;
  font-size: 12px;
}

.la-popover {
  pointer-events: auto;
  position: fixed;
  min-width: 220px;
  background: #fff;
  border: 1px solid #d8dce3;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(30, 35, 60, 0.2);
  padding: 12px;
  font-size: 12px;
  color: #4b5563;
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
