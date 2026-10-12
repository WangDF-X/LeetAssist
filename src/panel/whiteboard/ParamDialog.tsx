// 图元库参数弹窗（plan/03-whiteboard §5.1）：画板居中的参数窗。
// - 数字参数用可加减数字框（含 min/max）；二值用开关。
// - 确认时按参数定义 clamp，避免越界值。
// - 渲染在画布容器内、绝对定位居中；指针事件不冒泡到画布。
import { useEffect, useRef, useState } from "react";
import type { WBPreset, WBPresetParam } from "./presets";
import { defaultParams } from "./presets";

export interface ParamDialogProps {
  preset: WBPreset;
  onConfirm: (params: Record<string, number | boolean>) => void;
  onCancel: () => void;
}

function clampV(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

function NumberField({
  param,
  value,
  onChange,
}: {
  param: Extract<WBPresetParam, { kind: "number" }>;
  value: number;
  onChange: (v: number) => void;
}) {
  const [raw, setRaw] = useState(String(value));
  // 外部值变化（+/- 按钮、clamp）时同步显示
  useEffect(() => {
    setRaw(String(value));
  }, [value]);

  return (
    <div className="la-param-row">
      <span className="la-param-label">{param.label}</span>
      <div className="la-param-stepper">
        <button
          type="button"
          className="la-param-step"
          aria-label={`减少${param.label}`}
          disabled={value <= param.min}
          onClick={() => onChange(clampV(value - 1, param.min, param.max))}
        >
          −
        </button>
        <input
          className="la-param-num"
          type="text"
          inputMode="numeric"
          value={raw}
          onChange={(e) => {
            const t = e.target.value;
            if (!/^\d*$/.test(t)) return;
            setRaw(t);
            if (t !== "") onChange(Number(t)); // 输入中不 clamp，blur/生成时再 clamp
          }}
          onBlur={() => {
            const n = raw === "" ? value : Number(raw);
            onChange(clampV(n, param.min, param.max));
          }}
        />
        <button
          type="button"
          className="la-param-step"
          aria-label={`增加${param.label}`}
          disabled={value >= param.max}
          onClick={() => onChange(clampV(value + 1, param.min, param.max))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function ParamDialog({ preset, onConfirm, onCancel }: ParamDialogProps) {
  const [params, setParams] = useState<Record<string, number | boolean>>(() =>
    defaultParams(preset),
  );
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const setField = (key: string, v: number | boolean) =>
    setParams((p) => ({ ...p, [key]: v }));

  const emit = () => {
    const cleaned: Record<string, number | boolean> = {};
    for (const p of preset.params) {
      if (p.kind === "number") {
        const raw = params[p.key];
        const n = typeof raw === "number" && Number.isFinite(raw) ? raw : p.default;
        cleaned[p.key] = clampV(n, p.min, p.max);
      } else {
        cleaned[p.key] = params[p.key] === true;
      }
    }
    onConfirm(cleaned);
  };

  return (
    <div
      className="la-param-overlay"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter") {
          e.preventDefault();
          emit();
        }
      }}
    >
      <div
        className="la-param-card"
        role="dialog"
        aria-label={`${preset.name} 参数`}
        tabIndex={-1}
        ref={cardRef}
      >
        <div className="la-param-title">{preset.name}</div>
        <div className="la-param-body">
          {preset.params.map((p) =>
            p.kind === "number" ? (
              <NumberField
                key={p.key}
                param={p}
                value={
                  typeof params[p.key] === "number"
                    ? (params[p.key] as number)
                    : p.default
                }
                onChange={(v) => setField(p.key, v)}
              />
            ) : (
              <div className="la-param-row" key={p.key}>
                <span className="la-param-label">{p.label}</span>
                <button
                  type="button"
                  className="la-param-toggle"
                  data-active={params[p.key] === true}
                  aria-pressed={params[p.key] === true}
                  onClick={() => setField(p.key, !(params[p.key] === true))}
                >
                  <span className="la-param-knob" />
                </button>
              </div>
            ),
          )}
        </div>
        <div className="la-param-actions">
          <button type="button" className="la-param-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="la-param-btn la-param-btn-primary"
            onClick={emit}
          >
            生成
          </button>
        </div>
      </div>
    </div>
  );
}
