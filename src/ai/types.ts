// 04 §4 权威数据结构：ProviderConfig（仅可信扩展上下文使用）与面板安全摘要 ProviderSummary。
// 02 §3.6：ProviderConfig 的权威定义在 04，02 不维护第二份字段集合。

export type AiProtocol = "openai-compatible" | "anthropic";
export type AiCurrency = "CNY" | "USD";

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  protocol: AiProtocol;
  apiKey: string; // 明文 + 常驻提醒，见 02-storage §3.5；不得交给 Content Script
  model: string;
  contextWindow?: number;
  priceInput?: number; // 每百万 tokens
  priceOutput?: number;
  currency?: AiCurrency;
}

/** 面板只接收的无密钥摘要（04 §3.8.1） */
export type ProviderSummary = Omit<ProviderConfig, "apiKey"> & {
  hasApiKey: boolean;
  /** 按当前实际权限计算，不以此代替后台 contains 检查（04 §3.8.4） */
  permissionState: "granted" | "required";
};