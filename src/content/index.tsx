import { createRoot } from "react-dom/client";
import { PanelApp } from "../panel/PanelApp";
import { PANEL_CSS } from "../panel/styles";
import { PROBLEM_CHANGED_EVENT } from "../panel/problemMeta";
import { startRouteWatch } from "./routeWatch";

const HOST_ID = "leetassist-host";

function mount() {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  shadow.appendChild(style);
  const rootEl = document.createElement("div");
  shadow.appendChild(rootEl);
  document.documentElement.appendChild(host);
  createRoot(rootEl).render(<PanelApp />);
}

mount();
startRouteWatch(PROBLEM_CHANGED_EVENT);
