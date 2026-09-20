import { defineManifest } from "@crxjs/vite-plugin";

// 权限说明见 plan/01-extension-shell/spec.md 第 8 节
export default defineManifest({
  manifest_version: 3,
  name: "LeetAssist",
  version: "0.1.0",
  description:
    "轻量级 LeetCode 刷题辅助工具：画板、智能计时、BYOK AI 助手（仅本地，无后端）",
  permissions: ["storage", "notifications"],
  host_permissions: ["https://leetcode.cn/*"],
  optional_host_permissions: ["https://*/*"],
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://leetcode.cn/problems/*"],
      js: ["src/content/index.tsx"],
      run_at: "document_idle",
    },
  ],
  web_accessible_resources: [
    { resources: ["assets/*"], matches: ["https://leetcode.cn/*"] },
  ],
});
