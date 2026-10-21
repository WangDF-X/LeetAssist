import { checkBaseUrl } from "../ai/baseUrl";
import {
  PROVIDER_PRESETS,
  planPresetFill,
  planProtocolSwitch,
  type ProviderPreset,
} from "../ai/presets";
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

  /** 协议切换联动：Base URL 命中预置端点时自动切到新协议端点（04 §3.6） */
  const onProtocolChange = (next: ProviderDraft["protocol"]) => {
    const plan = planProtocolSwitch(
      PROVIDER_PRESETS,
      draft.protocol,
      next,
      draft.baseUrl,
      draft.model,
      draft.contextWindow,
    );
    const patch: Partial<ProviderDraft> = { protocol: next };
    if (plan?.baseUrl !== undefined) patch.baseUrl = plan.baseUrl;
    if (plan?.model !== undefined) patch.model = plan.model;
    if (plan?.contextWindow !== undefined) patch.contextWindow = plan.contextWindow;
    onChange(patch);
  };

  return (
    <div className="oa-form">
      <div className="oa-presets-panel">
        <div className="oa-presets-head">
          <span className="oa-presets-label">预置快速填入</span>
          <span className="oa-presets-note">
            按当前协议自动选端点；官方文档未核实的模型留空待填
          </span>
        </div>
        <div className="oa-presets-chips">
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
      </div>

      <section className="oa-form-block">
        <div className="oa-block-head">
          <span className="oa-block-title">连接信息</span>
          <span className="oa-block-note">必填</span>
        </div>
        <div className="oa-grid">
          <div className="oa-field">
            <label htmlFor="oa-name">
              名称<span className="oa-req">*</span>
            </label>
            <input
              id="oa-name"
              value={draft.name}
              placeholder="例如 DeepSeek 主力"
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </div>
          <div className="oa-field">
            <label htmlFor="oa-protocol">
              协议<span className="oa-req">*</span>
            </label>
            <select
              id="oa-protocol"
              value={draft.protocol}
              onChange={(e) =>
                onProtocolChange(e.target.value as ProviderDraft["protocol"])
              }
            >
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic（原生）</option>
            </select>
          </div>

          <div className="oa-field" data-span="2">
            <label htmlFor="oa-base">
              Base URL<span className="oa-req">*</span>
            </label>
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
            <label htmlFor="oa-model">
              Model<span className="oa-req">*</span>
            </label>
            <input
              id="oa-model"
              value={draft.model}
              placeholder="例如 deepseek-chat"
              spellCheck={false}
              onChange={(e) => onChange({ model: e.target.value })}
            />
          </div>
          <div className="oa-field">
            <label htmlFor="oa-key">
              API Key<span className="oa-req">*</span>
            </label>
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
      </section>

      <section className="oa-form-block">
        <div className="oa-block-head">
          <span className="oa-block-title">可选配置</span>
          <span className="oa-block-note">
            不填也能保存，仅影响上下文占用与资费展示
          </span>
        </div>
        <div className="oa-grid">
          <div className="oa-field">
            <label htmlFor="oa-ctx">上下文窗口（tokens）</label>
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
            <label htmlFor="oa-price-in">输入价格（每百万 tokens）</label>
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
            <label htmlFor="oa-price-out">输出价格（每百万 tokens）</label>
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
          <div className="oa-field">
            <label htmlFor="oa-price-cache">缓存命中价格（每百万 tokens）</label>
            <input
              id="oa-price-cache"
              type="number"
              min={0}
              step="0.01"
              value={draft.priceCacheInput}
              placeholder="例如 0.10"
              onChange={(e) => onChange({ priceCacheInput: e.target.value })}
            />
          </div>
        </div>
      </section>

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