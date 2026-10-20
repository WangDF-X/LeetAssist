import { checkBaseUrl } from "../ai/baseUrl";
import { PROVIDER_PRESETS, planPresetFill, type ProviderPreset } from "../ai/presets";
import type { ProviderDraft } from "./providerDraft";
import { useHostPermission } from "./useHostPermission";

interface ProviderFormProps {
  draft: ProviderDraft;
  error: string | null;
  onChange: (patch: Partial<ProviderDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ProviderForm({
  draft,
  error,
  onChange,
  onSave,
  onCancel,
}: ProviderFormProps) {
  const baseCheck = checkBaseUrl(draft.baseUrl);
  const pattern = baseCheck.ok ? baseCheck.originPattern : null;
  const granted = useHostPermission(pattern);

  /** 方案 A：按当前协议填对应端点；无对应端点时回退并切换协议（04 §3.6） */
  const applyPreset = (preset: ProviderPreset) => {
    const plan = planPresetFill(preset, draft.protocol);
    if (!plan) return;
    const patch: Partial<ProviderDraft> = {
      name: preset.name,
      protocol: plan.protocol,
      baseUrl: plan.baseUrl,
    };
    // 未核实默认模型/窗口时不覆盖用户已填内容
    if (plan.model !== undefined) patch.model = plan.model;
    if (plan.contextWindow !== undefined) {
      patch.contextWindow = String(plan.contextWindow);
    }
    onChange(patch);
  };

  return (
    <div className="oa-form">
      <div className="oa-presets">
        <span className="oa-presets-label">预置快速填入（按当前协议自动选端点）：</span>
        {PROVIDER_PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="oa-btn"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="oa-grid">
        <div className="oa-field">
          <label htmlFor="oa-name">名称</label>
          <input
            id="oa-name"
            value={draft.name}
            placeholder="例如 DeepSeek 主力"
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </div>
        <div className="oa-field">
          <label htmlFor="oa-protocol">协议</label>
          <select
            id="oa-protocol"
            value={draft.protocol}
            onChange={(e) =>
              onChange({ protocol: e.target.value as ProviderDraft["protocol"] })
            }
          >
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="anthropic">Anthropic（原生）</option>
          </select>
        </div>

        <div className="oa-field" data-span="2">
          <label htmlFor="oa-base">Base URL</label>
          <input
            id="oa-base"
            value={draft.baseUrl}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
          />
          {pattern ? (
            <span className="oa-hint">
              授权目标：{pattern}（只申请该主机范围，不申请所有网站）
            </span>
          ) : (
            <span className="oa-hint">
              仅支持 https://；不允许内嵌用户名/密码、#片段或查询参数中的密钥
            </span>
          )}
        </div>

        <div className="oa-field">
          <label htmlFor="oa-model">Model</label>
          <input
            id="oa-model"
            value={draft.model}
            placeholder="例如 deepseek-chat"
            spellCheck={false}
            onChange={(e) => onChange({ model: e.target.value })}
          />
        </div>
        <div className="oa-field">
          <label htmlFor="oa-key">API Key</label>
          <input
            id="oa-key"
            type="password"
            value={draft.apiKey}
            autoComplete="off"
            placeholder="sk-..."
            onChange={(e) => onChange({ apiKey: e.target.value })}
          />
        </div>

        <div className="oa-field" data-span="2">
          <div className="oa-warn">
            Key 以明文保存在本浏览器扩展本地存储，不加密、不云同步；仅在发起请求时发送到你配置的
            Provider。请勿在公共/共享设备保存真实 Key。
          </div>
        </div>

        <div className="oa-field">
          <label htmlFor="oa-ctx">上下文窗口（tokens，可选）</label>
          <input
            id="oa-ctx"
            type="number"
            min={1}
            value={draft.contextWindow}
            placeholder="例如 131072"
            onChange={(e) => onChange({ contextWindow: e.target.value })}
          />
        </div>
        <div className="oa-field">
          <label htmlFor="oa-currency">货币（用于资费显示）</label>
          <select
            id="oa-currency"
            value={draft.currency}
            onChange={(e) =>
              onChange({ currency: e.target.value as ProviderDraft["currency"] })
            }
          >
            <option value="CNY">CNY（人民币）</option>
            <option value="USD">USD（美元）</option>
          </select>
        </div>
        <div className="oa-field">
          <label htmlFor="oa-price-in">输入价格（每百万 tokens，可选）</label>
          <input
            id="oa-price-in"
            type="number"
            min={0}
            step="0.01"
            value={draft.priceInput}
            placeholder="例如 1.00"
            onChange={(e) => onChange({ priceInput: e.target.value })}
          />
        </div>
        <div className="oa-field">
          <label htmlFor="oa-price-out">输出价格（每百万 tokens，可选）</label>
          <input
            id="oa-price-out"
            type="number"
            min={0}
            step="0.01"
            value={draft.priceOutput}
            placeholder="例如 2.00"
            onChange={(e) => onChange({ priceOutput: e.target.value })}
          />
        </div>

        <div className="oa-field" data-span="2">
          <label>目标主机授权</label>
          <div className="oa-perm-row">
            <span
              className="oa-chip"
              data-state={granted ? "granted" : "required"}
            >
              {granted ? "已授权" : "未授权"}
            </span>
            <span className="oa-hint">
              {pattern ?? "填写合法 Base URL 后显示授权范围"}
            </span>
          </div>
        </div>
      </div>

      {error && <div className="oa-error">{error}</div>}

      <div className="oa-form-foot">
        <button type="button" className="oa-btn" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="oa-btn"
          data-variant="primary"
          onClick={onSave}
        >
          保存并授权
        </button>
      </div>
    </div>
  );
}