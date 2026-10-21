import { createRoot } from "react-dom/client";
import { resolveTheme, themeVarsCss } from "../panel/theme";
import { OptionsApp } from "./OptionsApp";
import "./options.css";

// 主题 token 与面板同源（01 §3.7）：在 :root 上按 data-theme 注入变量。
const styleEl = document.createElement("style");
styleEl.textContent = themeVarsCss(":root");
document.head.appendChild(styleEl);

function applyTheme(resolved: "light" | "dark"): void {
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/** 首屏先按系统偏好着色，读取面板 themeMode 后再校正，避免深色下闪白。
 *  之后的实时跟随由 OptionsApp 的 useResolvedTheme 负责（storage.onChanged）。 */
async function boot(): Promise<void> {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  applyTheme(mq.matches ? "dark" : "light");
  try {
    const saved = await new Promise<Record<string, unknown>>((resolve) => {
      chrome.storage.local.get("themeMode", (v) => resolve(v));
    });
    const mode = saved.themeMode;
    if (mode === "light" || mode === "dark" || mode === "system") {
      applyTheme(resolveTheme(mode, mq.matches));
    }
  } catch {
    // 读取失败时保留系统偏好着色，OptionsApp 内部会再次尝试
  }
  const rootEl = document.getElementById("root");
  if (rootEl) createRoot(rootEl).render(<OptionsApp />);
}

void boot();