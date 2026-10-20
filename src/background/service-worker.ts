// 骨架阶段：消息路由。badge 倒计时 / 通知（05-timer）后续在此实现。
// 04 §3.1：Provider fetch/认证/SSE/权限检查后续在此实现；本文件只处理固定语义命令。
import { COMMAND_OPEN_OPTIONS_PAGE } from "../ai/uiCommands";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ ok: true });
    return false;
  }
  // 面板「模型」入口（01 §3.4/§3.6）：打开独立扩展配置页；URL 由扩展生成，不接受网页传入的任意 URL
  if (message?.type === COMMAND_OPEN_OPTIONS_PAGE) {
    // TODO(04 §3.1)：请求代理落地时统一收敛 sender/顶层 frame/字段校验
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

export {};