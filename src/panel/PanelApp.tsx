import { useCallback, useEffect, useRef, useState } from "react";
import { getProblemMetaStub } from "./problemMeta";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_W = 720;
const MIN_H = 480;
const TOOLBAR_W = 46;

function defaultBox(): Box {
  const w = Math.min(1100, window.innerWidth - 80);
  const h = Math.min(720, window.innerHeight - 80);
  return {
    x: window.innerWidth - w - 24,
    y: Math.max(16, (window.innerHeight - h) / 2),
    w,
    h,
  };
}

function clampBox(b: Box): Box {
  const w = Math.min(Math.max(b.w, MIN_W), window.innerWidth - 16);
  const h = Math.min(Math.max(b.h, MIN_H), window.innerHeight - 16);
  const x = Math.min(Math.max(b.x, 8), window.innerWidth - w - 8);
  const y = Math.min(Math.max(b.y, 8), window.innerHeight - h - 8);
  return { x, y, w, h };
}

function applyEdge(b: Box, edge: string, dx: number, dy: number): Box {
  let { x, y, w, h } = b;
  if (edge.includes("e")) w = b.w + dx;
  if (edge.includes("s")) h = b.h + dy;
  if (edge.includes("w")) {
    x = b.x + dx;
    w = b.w - dx;
  }
  if (edge.includes("n")) {
    y = b.y + dy;
    h = b.h - dy;
  }
  return { x, y, w, h };
}

// 弹簧缓动：优先用 CSS linear() 弹簧曲线，不支持时回退过冲贝塞尔
function springEasing(): string {
  const curve =
    "linear(0, 0.008, 0.031 2.1%, 0.129 4.8%, 0.552 12.2%, 0.706 15.5%, 0.801 18.9%, 0.865 22.2%, 0.907 25.6%, 0.931 29%, 0.944 32.4%, 0.952 36.2%, 0.957 40.5%, 0.958 46.6%, 0.956 55.3%, 0.957 69.2%, 1)";
  return CSS.supports("animation-timing-function", "linear(0, 1)")
    ? curve
    : "cubic-bezier(0.34, 1.56, 0.64, 1)";
}

type ToolId = "timer" | "data" | "whiteboard" | "model";
const TOOLS: { id: ToolId; label: string }[] = [
  { id: "timer", label: "计时" },
  { id: "data", label: "数据" },
  { id: "whiteboard", label: "白板" },
  { id: "model", label: "模型" },
];

export function PanelApp() {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<Box>(defaultBox);
  const [ratio, setRatio] = useState(0.58);
  const [popover, setPopover] = useState<ToolId | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const boxRef = useRef(box);
  boxRef.current = box;
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  const meta = getProblemMetaStub();

  useEffect(() => {
    chrome.storage.local.get(["panelBox", "panelRatio"], (saved) => {
      if (saved.panelBox) setBox(clampBox(saved.panelBox as Box));
      if (typeof saved.panelRatio === "number") setRatio(saved.panelRatio);
    });
  }, []);

  const persist = useCallback(() => {
    chrome.storage.local.set({
      panelBox: boxRef.current,
      panelRatio: ratioRef.current,
    });
  }, []);

  const toggle = useCallback(() => {
    setPopover(null);
    if (!open) {
      setOpen(true);
      requestAnimationFrame(() => {
        panelRef.current?.animate(
          [
            { transform: "scale(0.6)", opacity: 0 },
            { transform: "scale(1)", opacity: 1 },
          ],
          { duration: 420, easing: springEasing() },
        );
      });
    } else {
      const anim = panelRef.current?.animate(
        [
          { transform: "scale(1)", opacity: 1 },
          { transform: "scale(0.6)", opacity: 0 },
        ],
        { duration: 320, easing: "cubic-bezier(0.4, 0, 0.7, 1)" },
      );
      if (anim) anim.onfinish = () => setOpen(false);
      else setOpen(false);
    }
  }, [open]);

  const startResize = (edge: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...boxRef.current };
    const move = (ev: PointerEvent) => {
      setBox(clampBox(applyEdge(start, edge, ev.clientX - startX, ev.clientY - startY)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      persist();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startRatioDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startRatio = ratioRef.current;
    const panelW = boxRef.current.w;
    const move = (ev: PointerEvent) => {
      const next = Math.min(
        0.7,
        Math.max(0.3, startRatio + (ev.clientX - startX) / panelW),
      );
      setRatio(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      persist();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const wbWidth = Math.max(200, Math.round((box.w - TOOLBAR_W) * ratio));

  return (
    <>
      <button
        className="la-logo"
        data-hidden={open}
        onClick={toggle}
        title="LeetAssist"
      >
        LA
      </button>
      <div
        ref={panelRef}
        className="la-panel"
        data-closed={!open}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      >
        <div className="la-col-whiteboard" style={{ flex: `0 0 ${wbWidth}px` }}>
          <div className="la-wb-topbar">画笔 / 写字等工具（Phase 2）</div>
          <div className="la-wb-body">
            <div className="la-wb-shapes">常用图形</div>
            <div className="la-wb-canvas">画板区域（Phase 2 引入 Konva）</div>
          </div>
        </div>
        <div className="la-toolbar" onPointerDown={startRatioDrag}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className="la-tool-btn"
              data-active={popover === t.id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setPopover((p) => (p === t.id ? null : t.id))}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="la-col-agent">
          <div className="la-agent-head">
            <span>
              {meta.title} · {meta.difficulty}
            </span>
            <span>历史≡</span>
          </div>
          <div className="la-agent-msgs">Agent 消息流（Phase 3）</div>
          <div className="la-agent-input">输入框（支持 @code，Phase 3）</div>
          <div className="la-agent-foot">
            <span>选择模型</span>
            <span>◯ 上下文/资费</span>
            <span>模式</span>
          </div>
        </div>
        {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map((edge) => (
          <div
            key={edge}
            className={`la-handle la-handle-${edge}`}
            onPointerDown={startResize(edge)}
          />
        ))}
      </div>
      {popover && open && (
        <div
          className="la-popover"
          style={{ left: box.x + wbWidth + TOOLBAR_W + 8, top: box.y + 56 }}
        >
          {TOOLS.find((t) => t.id === popover)?.label} popover（占位，后续模块实现）
        </div>
      )}
    </>
  );
}
