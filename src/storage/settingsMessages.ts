// 02 §3.6 受控设置消息契约（Content Script ↔ Service Worker）。
// 客户端只能发送本文件列出的白名单命令；不接受任意 storage key、get(null)、clear 或凭据写入。
import type { GridMode, ThemeMode } from "../panel/theme";
import type { WBBindings } from "../panel/whiteboard/bindings";

export const SETTINGS_MESSAGE_PREFIX = "settings:";
export const MSG_SETTINGS_GET_UI = "settings:get-ui";
export const MSG_SETTINGS_SET_UI = "settings:set-ui";
export const MSG_SETTINGS_GET_BINDINGS = "settings:get-bindings";

export interface PanelBoxValue {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CollapsedValue {
  wb: boolean;
  agent: boolean;
}

/** get-ui 返回的固定字段集合（白名单；绝不包含 Provider 配置或凭据） */
export interface UiSettingsSnapshot {
  panelBox?: PanelBoxValue;
  panelRatio?: number;
  logoY?: number;
  collapsed?: CollapsedValue;
  themeMode?: ThemeMode;
  gridMode?: GridMode;
}

/** 白板快捷键用户覆盖（02 §3.6 快捷键类型校验；tools 浅合并，允许只覆盖个别键） */
export type WbBindingsPatch = Partial<WBBindings>;

export type SettingsResponse<T = unknown> =
  | { ok: true; values?: T }
  | { ok: false; error: string };