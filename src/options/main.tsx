import { createRoot } from "react-dom/client";
import { themeVarsCss } from "../panel/theme";
import { OptionsApp } from "./OptionsApp";
import "./options.css";

// 主题 token 与面板同源（01 §3.7）：在 :root 上按 data-theme 注入变量，OptionsApp 负责切换
const styleEl = document.createElement("style");
styleEl.textContent = themeVarsCss(":root");
document.head.appendChild(styleEl);

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<OptionsApp />);