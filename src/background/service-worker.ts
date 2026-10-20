// 骨架阶段：消息路由。badge 倒计时 / 通知（05-timer）后续在此实现。
// 04 §3.1：Provider fetch/认证/SSE/权限检查后续在此实现；本文件只处理固定语义命令。
import { COMMAND_OPEN_OPTIONS_PAGE } from "../ai/uiCommands";
import { ensureTrustedLocal, handleSettingsMessage } from "../storage/settings";
import { SETTINGS_MESSAGE_PREFIX } from "../storage/settingsMessages";

// 02 §3.6：事件监听顶层注册，尽早初始化可信访问级别；每次操作仍会等待初始化（不依赖 SW 常驻）
void ensureTrustedLocal();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ ok: true });
    return false;
  }
  // 面板「模型」入口（01 §3.4/§3.6）：打开独立扩展配置页；URL 由扩展生成，不接受网页传入的任意 URL
  if (message?.type === COMMAND_OPEN_OPTIONS_PAGE) {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  // 受控设置读写（02 §3.6）：仅白名单字段，sender 在 settings 内校验
  if (
    typeof message?.type === "string" &&
    message.type.startsWith(SETTINGS_MESSAGE_PREFIX)
  ) {
    handleSettingsMessage(message, sender).then(sendResponse, (e) =>
      sendResponse({ ok: false, error: String(e) }),
    );
    return true; // 异步响应
  }
  return false;
});

export {};