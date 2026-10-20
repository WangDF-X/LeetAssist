// 配置页表单草稿与保存组装（价格/窗口用字符串以允许留空，保存时再解析）。
import { checkBaseUrl } from "../ai/baseUrl";
import type { AiProtocol, AiCurrency, ProviderConfig } from "../ai/types";

export interface ProviderDraft {
  id?: string;
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  contextWindow: string;
  priceInput: string;
  priceOutput: string;
  currency: AiCurrency;
}

export function emptyDraft(): ProviderDraft {
  return {
    name: "",
    protocol: "openai-compatible",
    baseUrl: "",
    model: "",
    apiKey: "",
    contextWindow: "",
    priceInput: "",
    priceOutput: "",
    currency: "CNY",
  };
}

export function draftFromConfig(p: ProviderConfig): ProviderDraft {
  return {
    id: p.id,
    name: p.name,
    protocol: p.protocol,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: p.apiKey,
    contextWindow: p.contextWindow != null ? String(p.contextWindow) : "",
    priceInput: p.priceInput != null ? String(p.priceInput) : "",
    priceOutput: p.priceOutput != null ? String(p.priceOutput) : "",
    currency: p.currency ?? "CNY",
  };
}

export type BuildResult =
  | { ok: true; config: ProviderConfig; pattern: string }
  | { ok: false; error: string };

function parseOptionalNumber(
  raw: string,
  label: string,
): { ok: true; value?: number } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) return { ok: true };
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0) {
    return { ok: false, error: `${label}需要填写非负数字` };
  }
  return { ok: true, value: v };
}

export function buildConfig(d: ProviderDraft): BuildResult {
  const check = checkBaseUrl(d.baseUrl);
  if (!check.ok) return check;
  const name = d.name.trim();
  if (!name) return { ok: false, error: "请填写名称" };
  const model = d.model.trim();
  if (!model) return { ok: false, error: "请填写 Model" };
  const apiKey = d.apiKey.trim();
  if (!apiKey) return { ok: false, error: "请填写 API Key" };

  const ctx = parseOptionalNumber(d.contextWindow, "上下文窗口");
  if (!ctx.ok) return ctx;
  const priceIn = parseOptionalNumber(d.priceInput, "输入价格");
  if (!priceIn.ok) return priceIn;
  const priceOut = parseOptionalNumber(d.priceOutput, "输出价格");
  if (!priceOut.ok) return priceOut;

  return {
    ok: true,
    pattern: check.originPattern,
    config: {
      id: d.id ?? crypto.randomUUID(),
      name,
      protocol: d.protocol,
      baseUrl: check.normalized,
      apiKey,
      model,
      contextWindow: ctx.value,
      priceInput: priceIn.value,
      priceOutput: priceOut.value,
      currency: d.currency,
    },
  };
}