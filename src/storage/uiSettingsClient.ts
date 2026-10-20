// 02 §3.6 Content Script 侧受控设置客户端：只发白名单命令，不接触 storage.local。
// 调用失败（后台未响应/校验拒绝）返回 null/false，调用方保留默认值或忽略本次写入。
import {
  MSG_SETTINGS_GET_BINDINGS,
  MSG_SETTINGS_GET_UI,
  MSG_SETTINGS_SET_UI,
  type SettingsResponse,
  type UiSettingsSnapshot,
  type WbBindingsPatch,
} from "./settingsMessages";

async function send<T>(message: {
  type: string;
  patch?: unknown;
}): Promise<SettingsResponse<T> | null> {
  try {
    const resp = (await chrome.runtime.sendMessage(message)) as
      | SettingsResponse<T>
      | undefined;
    return resp ?? null;
  } catch {
    return null;
  }
}

/** 读取布局/主题等固定字段（失败返回 null，调用方保留默认值） */
export async function fetchUiSettings(): Promise<UiSettingsSnapshot | null> {
  const resp = await send<UiSettingsSnapshot>({ type: MSG_SETTINGS_GET_UI });
  if (!resp || !resp.ok) return null;
  return resp.values ?? null;
}

/** 写入白名单字段（后台做类型/范围校验）；成功返回 true */
export async function pushUiSettings(
  patch: Record<string, unknown>,
): Promise<boolean> {
  const resp = await send<undefined>({ type: MSG_SETTINGS_SET_UI, patch });
  return resp !== null && resp.ok;
}

/** 读取白板快捷键用户覆盖（无覆盖或数据非法返回 null） */
export async function fetchWbBindings(): Promise<WbBindingsPatch | null> {
  const resp = await send<WbBindingsPatch>({ type: MSG_SETTINGS_GET_BINDINGS });
  if (!resp || !resp.ok) return null;
  return resp.values ?? null;
}