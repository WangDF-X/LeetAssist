// 骨架阶段：仅保留消息路由占位。
// badge 倒计时 / 通知（05-timer）、运行时权限申请（04-ai-assistant）后续在此实现。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ ok: true });
  }
  return false;
});

export {};
