// 04 §3.6 预置 Provider 快捷项（URL/模型名为官方文档公开信息，实现时以官方文档为准；用户可改）。
// 方案 A（2026-10-21 用户确认）：每个服务一个预置，按表单当前协议选择端点；
// 服务缺少该协议端点时回退到可用端点并切换协议。
// 默认模型/上下文窗口仅在官方文档可核实时预填（缺省项填充时保留用户已填内容）。
import type { AiProtocol } from "./types";

export interface ProviderPresetEndpoint {
  baseUrl: string;
  /** 官方文档可核实的默认模型；缺省表示未核实 */
  model?: string;
  /** 上下文窗口（tokens）；缺省表示未核实 */
  contextWindow?: number;
}

export interface ProviderPreset {
  name: string;
  openai?: ProviderPresetEndpoint;
  anthropic?: ProviderPresetEndpoint;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: "OpenCode Go",
    openai: {
      baseUrl: "https://opencode.ai/inference/go/openai/v1",
      model: "kimi-k2.7-code",
      contextWindow: 262144,
    },
    anthropic: {
      baseUrl: "https://opencode.ai/inference/go/anthropic/v1",
      model: "claude-haiku-5-5",
    },
  },
  {
    name: "百炼 Coding（国际站）",
    openai: { baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1" },
    anthropic: { baseUrl: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic" },
  },
  {
    name: "GLM Coding Plan",
    openai: {
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      model: "glm-5.3",
      contextWindow: 1000000,
    },
    anthropic: {
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      model: "glm-5.3",
      contextWindow: 1000000,
    },
  },
  {
    name: "Kimi Code",
    openai: {
      baseUrl: "https://api.kimi.com/coding/v1",
      model: "kimi-k3",
      contextWindow: 1000000,
    },
    anthropic: {
      baseUrl: "https://api.kimi.com/coding",
      model: "kimi-k3",
      contextWindow: 1000000,
    },
  },
  {
    name: "Command Code GOAT",
    openai: { baseUrl: "https://api.commandcode.ai/provider/v1" },
  },
  {
    name: "MiniMax Token Plan",
    openai: {
      baseUrl: "https://token-plan-cn.minimaxi.com/v1",
      model: "MiniMax-M3.1-Flash",
      contextWindow: 524288,
    },
    anthropic: {
      baseUrl: "https://token-plan-cn.minimaxi.com/anthropic",
      model: "MiniMax-M3.1-Flash",
      contextWindow: 524288,
    },
  },
  {
    name: "小米 MiMo Token Plan",
    openai: {
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      model: "MiMo-V2.6-Pro",
      contextWindow: 1048576,
    },
    anthropic: {
      baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
      model: "MiMo-V2.6-Pro",
      contextWindow: 1048576,
    },
  },
  {
    name: "腾讯云 Coding Plan",
    openai: { baseUrl: "https://api.lkeap.cloud.tencent.com/plan/v3" },
    anthropic: { baseUrl: "https://api.lkeap.cloud.tencent.com/plan/anthropic" },
  },
  {
    name: "火山引擎 Coding Plan",
    openai: { baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3" },
    anthropic: { baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v1" },
  },
  {
    name: "DeepSeek API",
    openai: {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-flash",
      contextWindow: 1000000,
    },
    anthropic: {
      baseUrl: "https://api.deepseek.com/anthropic",
      model: "deepseek-flash",
      contextWindow: 1000000,
    },
  },
  {
    name: "OpenCode Zen",
    openai: { baseUrl: "https://opencode.ai/zen/v1" },
  },
];

export interface PresetFillPlan {
  protocol: AiProtocol;
  baseUrl: string;
  model?: string;
  contextWindow?: number;
}

/** 按当前协议选择预置端点；无对应端点时回退到可用端点并切换协议（04 §3.6 方案 A） */
export function planPresetFill(
  preset: ProviderPreset,
  currentProtocol: AiProtocol,
): PresetFillPlan | null {
  const useAnthropic =
    currentProtocol === "anthropic" ? Boolean(preset.anthropic) : !preset.openai;
  const variant = useAnthropic ? preset.anthropic : preset.openai;
  if (!variant) return null;
  return {
    protocol: useAnthropic ? "anthropic" : "openai-compatible",
    baseUrl: variant.baseUrl,
    model: variant.model,
    contextWindow: variant.contextWindow,
  };
}
