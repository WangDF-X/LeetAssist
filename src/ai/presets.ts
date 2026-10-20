// 04 §3.6 预置 Provider 快捷项（URL/模型名为当前公开信息，实现时以官方文档为准；用户可改）。
import type { AiProtocol } from "./types";

export interface ProviderPreset {
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
  contextWindow: number;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    contextWindow: 131072,
  },
  {
    name: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-3-5-haiku-latest",
    contextWindow: 204800,
  },
  {
    name: "Gemini",
    protocol: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
    contextWindow: 1048576,
  },
  {
    name: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    contextWindow: 65536,
  },
  {
    name: "GLM",
    protocol: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    contextWindow: 131072,
  },
  {
    name: "Kimi",
    protocol: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-32k",
    contextWindow: 32768,
  },
  {
    name: "Qwen",
    protocol: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    contextWindow: 131072,
  },
];