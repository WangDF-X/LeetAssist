import { useCallback, useEffect, useRef, useState } from "react";
import { getProblemMetaStub } from "./problemMeta";
import {
  nextThemeMode,
  resolveTheme,
  THEME_MODE_LABEL,
  type ThemeMode,
} from "./theme";

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
interface CollapsedState {
  wb: boolean;
  agent: boolean;
}

const MIN_W = 720;
const MIN_W_SINGLE = 480; // 单栏可见时的面板最小宽度
const MIN_H = 480;
const EAR_W = 20; // 单栏收起/展开"耳朵"按钮宽度
const TOOLBAR_W = 46;
const LOGO_SIZE = 40;
const LOGO_MARGIN_RIGHT = 24;
const LOGO_MARGIN_BOTTOM = 32;
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

function effMinW(c: CollapsedState): number {
  return c.wb || c.agent ? MIN_W_SINGLE : MIN_W;
}

function clampBox(b: Box, minW: number = MIN_W): Box {
  const w = clamp(b.w, minW, window.innerWidth - 16);
  const h = clamp(b.h, MIN_H, window.innerHeight - 16);
  const x = clamp(b.x, 8, window.innerWidth - w - 8);
  const y = clamp(b.y, 8, window.innerHeight - h - 8);
  return { x, y, w, h };
}

// logo 只允许停靠在视口右边缘：x 永远由视口推导（吸附右侧），只持久化 y
function logoSnapX(): number {
  return Math.max(0, window.innerWidth - LOGO_SIZE - LOGO_MARGIN_RIGHT);
}

function clampLogoY(y: number): number {
  return clamp(y, 0, window.innerHeight - LOGO_SIZE);
}

function defaultLogoPos(): Point {
  return {
    x: logoSnapX(),
    y: Math.max(0, window.innerHeight - LOGO_SIZE - LOGO_MARGIN_BOTTOM),
  };
}

function clampLogo(p: Point): Point {
  return {
    x: clamp(p.x, 0, window.innerWidth - LOGO_SIZE),
    y: clampLogoY(p.y),
  };
}

// 先按边钳制尺寸（最小尺寸 + 不越出视口），再反推位置：
// 达到最小尺寸/视口边界后对侧边缘钉死，面板不会被"推着走"
function applyEdge(
  b: Box,
  edge: string,
  dx: number,
  dy: number,
  minW: number = MIN_W,
): Box {
  let { x, y, w, h } = b;
  if (edge.includes("e")) {
    w = clamp(b.w + dx, minW, Math.max(minW, window.innerWidth - 8 - b.x));
  }
  if (edge.includes("s")) {
    h = clamp(b.h + dy, MIN_H, Math.max(MIN_H, window.innerHeight - 8 - b.y));
  }
  if (edge.includes("w")) {
    const newW = clamp(b.w - dx, minW, Math.max(minW, b.x + b.w - 8));
    x = b.x + (b.w - newW);
    w = newW;
  }
  if (edge.includes("n")) {
    const newH = clamp(b.h - dy, MIN_H, Math.max(MIN_H, b.y + b.h - 8));
    y = b.y + (b.h - newH);
    h = newH;
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
  const [collapsed, setCollapsed] = useState<CollapsedState>({
    wb: false,
    agent: false,
  });
  const [popover, setPopover] = useState<ToolId | null>(null);
  const [logoPos, setLogoPos] = useState<Point>(defaultLogoPos);
  // 单栏收起/展开的宽度过渡开关（仅在切换瞬间开启，避免拖拽比例时被过渡拖慢）
  const [colAnim, setColAnim] = useState(false);
  // 主题：浅色 / 深色 / 跟随系统（默认跟随系统，持久化 themeMode）
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLButtonElement>(null);
  const colAnimTimer = useRef<number | undefined>(undefined);

  const boxRef = useRef(box);
  boxRef.current = box;
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const logoPosRef = useRef(logoPos);
  logoPosRef.current = logoPos;

  const meta = getProblemMetaStub();

  useEffect(() => {
    chrome.storage.local.get(
      ["panelBox", "panelRatio", "logoY", "collapsed", "themeMode"],
      (saved) => {
        if (saved.panelBox) setBox(clampBox(saved.panelBox as Box));
        if (typeof saved.panelRatio === "number") setRatio(saved.panelRatio);
        if (typeof saved.logoY === "number")
          setLogoPos({ x: logoSnapX(), y: clampLogoY(saved.logoY) });
        if (saved.collapsed) setCollapsed(saved.collapsed as CollapsedState);
        if (
          saved.themeMode === "light" ||
          saved.themeMode === "dark" ||
          saved.themeMode === "system"
        )
          setThemeMode(saved.themeMode);
      },
    );
  }, []);

  // 跟随系统模式：监听系统主题变化
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // 视口变化（如打开 DevTools、调整窗口）时：面板重新钳入视口，logo 重新吸附右边缘
  useEffect(() => {
    const onViewportResize = () => {
      setBox((b) => clampBox(b, effMinW(collapsedRef.current)));
      setLogoPos((p) => ({ x: logoSnapX(), y: clampLogoY(p.y) }));
    };
    window.addEventListener("resize", onViewportResize);
    return () => window.removeEventListener("resize", onViewportResize);
  }, []);

  const persist = useCallback(() => {
    chrome.storage.local.set({
      panelBox: boxRef.current,
      panelRatio: ratioRef.current,
      logoY: logoPosRef.current.y,
      collapsed: collapsedRef.current,
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

  // 关闭面板前的数据保存钩子。⚠️ 后续模块实现时必须在此挂接保存逻辑：
  // TODO(spec 03-whiteboard): 保存当前题目的画板内容到 IndexedDB（切题/关闭时）
  // TODO(spec 04-ai-assistant): 保存当前题目的对话记录（一题多对话）
  // TODO(spec 05-timer): 保存计时器运行状态
  const persistOnClose = useCallback(() => {
    persist(); // 布局状态：panelBox / panelRatio / logoY / collapsed
    // 业务数据保存占位：目前各模块未实现，暂无额外数据需要保存
  }, [persist]);

  const closePanel = useCallback(() => {
    setPopover(null);
    persistOnClose();
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
  }, [setOriginToLogo, persistOnClose]);

  // 单栏收起/展开：收起一侧另一侧占满（面板总宽不变）；二者都收起 = 直接收回 logo，下次打开恢复双栏展开
  const toggleCol = (side: "wb" | "agent") => {
    const cur = collapsedRef.current;
    const next = { ...cur, [side]: !cur[side] };
    const both = next.wb && next.agent;
    const applied: CollapsedState = both ? { wb: false, agent: false } : next;
    collapsedRef.current = applied;
    setCollapsed(applied);
    persist();
    setColAnim(true);
    window.clearTimeout(colAnimTimer.current);
    colAnimTimer.current = window.setTimeout(() => setColAnim(false), 320);
    if (both) closePanel();
  };

  // logo：6px 阈值区分"点击展开"与"拖动换位"；拖动只允许改变纵向位置，松手吸附回右边缘
  const onLogoPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const logoEl = logoRef.current;
    if (logoEl) {
      logoEl.style.animation = "none";
      logoEl.style.transition = "none"; // 拖动中跟手，不做过渡
    }
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
        // 先恢复过渡再吸附，让"滑回右边缘"有动画
        if (logoEl) logoEl.style.transition = "";
        setLogoPos((p) => ({ x: logoSnapX(), y: clampLogoY(p.y) }));
        persist();
      } else {
        if (logoEl) {
          logoEl.style.animation = "";
          logoEl.style.transition = "";
        }
        setOpen(true);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 面板拖拽移动：左栏顶部工具行 / 右栏标题栏作为拖拽区
  const startMove = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return; // 栏内按钮不触发移动
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...boxRef.current };
    const minW = effMinW(collapsedRef.current);
    const move = (ev: PointerEvent) => {
      setBox(
        clampBox(
          {
            ...start,
            x: start.x + ev.clientX - startX,
            y: start.y + ev.clientY - startY,
          },
          minW,
        ),
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

  const startResize = (edge: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...boxRef.current };
    const minW = effMinW(collapsedRef.current);
    const move = (ev: PointerEvent) => {
      setBox(
        clampBox(
          applyEdge(start, edge, ev.clientX - startX, ev.clientY - startY, minW),
          minW,
        ),
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
    if (collapsedRef.current.wb || collapsedRef.current.agent) return; // 单栏收起时比例无意义
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

  // 布局宽度：双栏按 ratio 分配；单栏收起时另一侧占满（面板总宽不变）
  const contentW = box.w - TOOLBAR_W;
  const wbWidth = collapsed.wb
    ? 0
    : collapsed.agent
      ? contentW
      : Math.max(200, Math.round(contentW * ratio));
  const agentWidth = contentW - wbWidth;

  const resolvedTheme = resolveTheme(themeMode, systemDark);
  // 循环切换 浅色 → 深色 → 跟随系统，并持久化
  const cycleTheme = () => {
    const next = nextThemeMode(themeMode);
    setThemeMode(next);
    chrome.storage.local.set({ themeMode: next });
  };

  return (
    <div className="la-root" data-theme={resolvedTheme}>
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
        <div
          className="la-col-whiteboard"
          data-anim={colAnim}
          style={{ flex: `0 0 ${wbWidth}px` }}
        >
          <div className="la-wb-topbar la-drag" onPointerDown={startMove}>
            画笔 / 写字等工具（Phase 2）
          </div>
          <div className="la-wb-body">
            <div className="la-wb-shapes">常用图形</div>
            <div className="la-wb-canvas">画板区域（Phase 2 引入 Konva）</div>
          </div>
        </div>
        <div className="la-toolbar" onPointerDown={startRatioDrag}>
          <button
            className="la-collapse"
            title="收起面板"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={closePanel}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
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
          <button
            className="la-tool-btn la-theme-btn"
            title={`主题：${THEME_MODE_LABEL[themeMode]}（点击切换）`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={cycleTheme}
          >
            {themeMode === "light" && (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <circle
                  cx="12"
                  cy="12"
                  r="4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
            {themeMode === "dark" && (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {themeMode === "system" && (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <rect
                  x="3"
                  y="4"
                  width="18"
                  height="12"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M8 20h8M12 16v4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
        </div>
        <div
          className="la-col-agent"
          data-anim={colAnim}
          style={{ flex: `0 0 ${agentWidth}px` }}
        >
          <div className="la-agent-head la-drag" onPointerDown={startMove}>
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
        {/* 单栏收起/展开"耳朵"按钮：贴在工具栏两竖边外侧、垂直居中；
            对应栏收起时贴到面板外缘，避免跑出面板 */}
        <button
          className="la-ear"
          data-anim={colAnim}
          style={{ left: Math.max(0, wbWidth - EAR_W) }}
          title={collapsed.wb ? "展开白板" : "收起白板"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => toggleCol("wb")}
        >
          {collapsed.wb ? "›" : "‹"}
        </button>
        <button
          className="la-ear"
          data-anim={colAnim}
          style={{
            left: Math.min(box.w - EAR_W, wbWidth + TOOLBAR_W),
          }}
          title={collapsed.agent ? "展开对话" : "收起对话"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => toggleCol("agent")}
        >
          {collapsed.agent ? "‹" : "›"}
        </button>
      </div>
      {popover && open && (
        <div
          className="la-popover"
          style={{ left: box.x + wbWidth + TOOLBAR_W + 8, top: box.y + 56 }}
        >
          {TOOLS.find((t) => t.id === popover)?.label} popover（占位，后续模块实现）
        </div>
      )}
    </div>
  );
}
