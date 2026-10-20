// 01 §3.6 短消息骨架（04 部分）：面板 → Service Worker 的语义命令。
// 只接受固定命令类型，不传任意 URL / 存储字段 / 凭据（04 §3.1）。

export const COMMAND_OPEN_OPTIONS_PAGE = "open-options-page";

/** 面板「模型」入口：请后台打开独立扩展配置页（页面 URL 由扩展生成） */
export function requestOpenOptionsPage(): void {
  chrome.runtime.sendMessage({ type: COMMAND_OPEN_OPTIONS_PAGE }).catch(() => {
    // 后台未响应/已销毁：静默失败，不阻塞面板交互
  });
}