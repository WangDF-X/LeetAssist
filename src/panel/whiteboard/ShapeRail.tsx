// 数据结构图元库左栏（plan/03-whiteboard §5.1）：窄图标条 + 分组卡片 + 单级滚动。
// 方案 A：分「线性/二维/层级/关系」四组，每组一张卡片；底部渐隐 + 下箭头提示可滚动。
// 悬停用自定义气泡（走 --la-* token、即时显示、可带参数提示），替代原生 title。
import { useCallback, useEffect, useRef, useState } from "react";
import type { WBPreset } from "./presets";
import { WB_PRESETS, WB_PRESET_GROUPS, WB_PRESET_GROUP_ORDER } from "./presets";
import { PresetIcon } from "./icons";

export interface ShapeRailProps {
  onPick: (preset: WBPreset) => void;
}

interface TipState {
  preset: WBPreset;
  top: number; // 相对 .la-rail 顶部的偏移（面板有 transform，fixed 会被裁剪）
}

export function ShapeRail({ onPick }: ShapeRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  const [atBottom, setAtBottom] = useState(false);
  const [tip, setTip] = useState<TipState | null>(null);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScroll(el.scrollHeight - el.clientHeight > 4);
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  }, []);

  useEffect(() => {
    update();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);

  const showTip = (preset: WBPreset, target: HTMLElement) => {
    const railRect = railRef.current?.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const top = railRect ? r.top + r.height / 2 - railRect.top : 0;
    setTip({ preset, top });
  };

  return (
    <div className="la-rail" ref={railRef} onMouseLeave={() => setTip(null)}>
      <div
        className="la-rail-scroll"
        ref={scrollRef}
        onScroll={update}
        onMouseLeave={() => setTip(null)}
      >
        {WB_PRESET_GROUP_ORDER.map((g) => {
          const items = WB_PRESETS.filter((p) => p.group === g);
          if (!items.length) return null;
          return (
            <div className="la-rail-group" key={g}>
              <div className="la-rail-group-label">{WB_PRESET_GROUPS[g]}</div>
              {items.map((p) => (
                <button
                  key={p.id}
                  className="la-rail-item"
                  onMouseEnter={(e) => showTip(p, e.currentTarget)}
                  onFocus={(e) => showTip(p, e.currentTarget)}
                  onBlur={() => setTip(null)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onPick(p)}
                >
                  <PresetIcon id={p.id} />
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {canScroll && !atBottom && (
        <div className="la-rail-fade" aria-hidden="true">
          ▾
        </div>
      )}
      {tip && (
        <div className="la-rail-tip" role="tooltip" style={{ top: tip.top }}>
          <span className="la-rail-tip-name">{tip.preset.name}</span>
          <span className="la-rail-tip-sub">
            {tip.preset.params.length
              ? tip.preset.params.map((p) => p.label).join(" · ")
              : "点击直接插入"}
          </span>
        </div>
      )}
    </div>
  );
}
