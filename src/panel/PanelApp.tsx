import { useCallback, useEffect, useRef, useState } from "react";
import { getProblemMetaStub } from "./problemMeta";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Point {
  x: number;
  y: number;
}

const MIN_W = 720;
const MIN_H = 480;
const TOOLBAR_W = 46;
const LOGO_SIZE = 40;
const LOGO_URL = chrome.runtime.getURL("assets/logo.png");
const DRAG_THRESHOLD = 6;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

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
  const w = clamp(b.w, MIN_W, window.innerWidth - 16);
  const h = clamp(b.h, MIN_H, window.innerHeight - 16);
  const x = clamp(b.x, 8, window.innerWidth - w - 8);
  const y = clamp(b.y, 8, window.innerHeight - h - 8);
  return { x, y, w, h };
}

function defaultLogoPos(): Point {
  return {
    x: window.innerWidth - LOGO_SIZE - 24,
    y: window.innerHeight - LOGO_SIZE - 32,
  };
}

function clampLogo(p: Point): Point {
  return {
    x: clamp(p.x, 0, window.innerWidth - LOGO_SIZE),
    y: clamp(p.y, 0, window.innerHeight - LOGO_SIZE),
  };
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

// 弹簧缓动：优先 CSS linear() 过冲弹簧曲线，不支持时回退过冲贝塞尔
function springEasing(): string {
  const curve =
    "linear(0, 0.009, 0.035, 0.153 6.9%, 0.355 12.6%, 0.6 18.4%, 0.782 23.6%, 0.915 28.4%, 0.997 32.9%, 1.03 37.4%, 1.03 42.6%, 1.01 49.4%, 0.995 57.2%, 0.992 79%, 1)";
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
  const [logoPos, setLogoPos] = useState<Point>(defaultLogoPos);
  const panelRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLButtonElement>(null);

  const boxRef = useRef(box);
  boxRef.current = box;
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const logoPosRef = useRef(logoPos);
  logoPosRef.current = logoPos;

  const meta = getProblemMetaStub();

  useEffect(() => {
    chrome.storage.local.get(["panelBox", "panelRatio", "logoPos"], (saved) => {
      if (saved.panelBox) setBox(clampBox(saved.panelBox as Box));
      if (typeof saved.panelRatio === "number") setRatio(saved.panelRatio);
      if (saved.logoPos) setLogoPos(clampLogo(saved.logoPos as Point));
    });
  }, []);

  const persist = useCallback(() => {
    chrome.storage.local.set({
      panelBox: boxRef.current,
      panelRatio: ratioRef.current,
      logoPos: logoPosRef.current,
    });
  }, []);

  // 以 logo 为锚点设置面板的 transform-origin，展开/收起都从 logo 位置弹
  const setOriginToLogo = useCallback((el: HTMLElement) => {
    const cx = logoPosRef.current.x + LOGO_SIZE / 2 - boxRef.current.x;
    const cy = logoPosRef.current.y + LOGO_SIZE / 2 - boxRef.current.y;
    el.style.transformOrigin = `${clamp(cx, 0, boxRef.current.w)}px ${clamp(
      cy,
      0,
      boxRef.current.h,
    )}px`;
  }, []);

  // 打开动画：DOM 就绪后以弹簧曲线从 logo 锚点弹出
  useEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el) return;
    setOriginToLogo(el);
    el.animate(
      [
        { transform: "scale(0.55)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 460, easing: springEasing(), fill: "both" },
    );
  }, [open, setOriginToLogo]);

  const closePanel = useCallback(() => {
    setPopover(null);
    const el = panelRef.current;
    if (!el) {
      setOpen(false);
      return;
    }
    setOriginToLogo(el);
    const anim = el.animate(
      [
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(0.55)", opacity: 0 },
      ],
      { duration: 340, easing: "cubic-bezier(0.5, 0, 0.75, 0.5)", fill: "both" },
    );
    anim.onfinish = () => setOpen(false);
  }, [setOriginToLogo]);

  // logo：6px 阈值区分"点击展开"与"拖动换位"，拖动结束持久化位置
  const onLogoPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const logoEl = logoRef.current;
    if (logoEl) logoEl.style.animation = "none";
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...logoPosRef.current };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
      if (moved) setLogoPos(clampLogo({ x: orig.x + dx, y: orig.y + dy }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) {
        persist();
      } else {
        if (logoEl) logoEl.style.animation = "";
        setOpen(true);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (edge: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...boxRef.current };
    const move = (ev: PointerEvent) => {
      setBox(
        clampBox(applyEdge(start, edge, ev.clientX - startX, ev.clientY - startY)),
      );
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
      setRatio(clamp(startRatio + (ev.clientX - startX) / panelW, 0.3, 0.7));
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
        ref={logoRef}
        style={{ left: logoPos.x, top: logoPos.y }}
        onPointerDown={onLogoPointerDown}
        title="LeetAssist（可拖动换位，点击展开）"
      >
        <img src={LOGO_URL} alt="LeetAssist" draggable={false} />
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
          <button
            className="la-tool-btn la-collapse"
            title="收起为悬浮图标"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={closePanel}
          >
            ⌄
          </button>
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
