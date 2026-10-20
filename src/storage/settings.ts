// 02 §3.5–3.6：storage.local 可信访问级别 + 受控设置读写（可信侧，SW / 配置页使用）。
// 硬规则：
// - 保存/删除凭据前必须成功 setAccessLevel(TRUSTED_CONTEXTS)，失败明确报错，不降级为可读 Key；
// - Content Script 只能通过白名单消息（handleSettingsMessage）访问已知字段，并做类型/范围校验；
// - 本模块顶层无副作用：Content Script 只共享消息常量与类型（见 uiSettingsClient.ts）。
import type { AiProtocol, ProviderConfig } from "../ai/types";
import type { WBTool } from "../panel/whiteboard/Toolbar";
import {
  MSG_SETTINGS_GET_BINDINGS,
  MSG_SETTINGS_GET_UI,
  MSG_SETTINGS_SET_UI,
  type SettingsResponse,
  type UiSettingsSnapshot,
  type WbBindingsPatch,
} from "./settingsMessages";

const PROVIDERS_KEY = "providers";
const KEY_NOTICE_KEY = "keyNoticeConfirmed";
const BINDINGS_KEY = "wbBindings";

const UI_KEYS = [
  "panelBox",
  "panelRatio",
  "logoY",
  "collapsed",
  "themeMode",
  "gridMode",
] as const;

// ---------- 可信访问级别 ----------

let trustedReady: Promise<boolean> | null = null;

/** 初始化 storage.local 可信访问级别；失败后可重试（不缓存失败结果） */
export function ensureTrustedLocal(): Promise<boolean> {
  if (!trustedReady) {
    trustedReady = chrome.storage.local
      .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
      .then(() => true)
      .catch(() => {
        trustedReady = null;
        return false;
      });
  }
  return trustedReady;
}

// ---------- 基础读写 ----------

function getLocal(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (saved) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(saved as Record<string, unknown>);
    });
  });
}

function setLocal(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

// ---------- 校验（02 §3.6：只允许已知字段 + 类型/范围校验） ----------

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function isPanelBoxValue(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  const okNum = (x: unknown) =>
    typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e5;
  return (
    okNum(b.x) &&
    okNum(b.y) &&
    typeof b.w === "number" &&
    Number.isFinite(b.w) &&
    b.w > 0 &&
    b.w <= 1e5 &&
    typeof b.h === "number" &&
    Number.isFinite(b.h) &&
    b.h > 0 &&
    b.h <= 1e5
  );
}

function isCollapsedValue(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.wb === "boolean" && typeof c.agent === "boolean";
}

const WB_TOOLS = new Set<WBTool>([
  "select",
  "pen",
  "rect",
  "ellipse",
  "connector",
  "text",
]);

const WB_BINDING_FIELDS = new Set([
  "tools",
  "undo",
  "redo",
  "delete",
  "copy",
  "paste",
  "duplicate",
  "pan",
  "contextMenu",
]);

function isKeyBindingValue(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.key === "string" &&
    b.key.length > 0 &&
    b.key.length <= 32 &&
    (b.code === undefined || typeof b.code === "boolean") &&
    (b.ctrl === undefined || typeof b.ctrl === "boolean") &&
    (b.shift === undefined || typeof b.shift === "boolean")
  );
}

export function isWbBindingsPatchValue(v: unknown): v is WbBindingsPatch {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!WB_BINDING_FIELDS.has(key)) return false;
  }
  if (o.tools !== undefined) {
    if (typeof o.tools !== "object" || o.tools === null) return false;
    for (const tool of Object.values(o.tools as Record<string, unknown>)) {
      if (!WB_TOOLS.has(tool as WBTool)) return false;
    }
  }
  for (const k of ["undo", "redo", "copy", "paste", "duplicate"]) {
    if (o[k] !== undefined && !isKeyBindingValue(o[k])) return false;
  }
  if (
    o.delete !== undefined &&
    (!Array.isArray(o.delete) ||
      o.delete.some((x) => typeof x !== "string" || x.length === 0))
  ) {
    return false;
  }
  if (o.pan !== undefined && (typeof o.pan !== "string" || o.pan.length === 0)) {
    return false;
  }
  if (o.contextMenu !== undefined && o.contextMenu !== "quickText") return false;
  return true;
}

const UI_SETTING_VALIDATORS: Record<string, (v: unknown) => boolean> = {
  panelBox: isPanelBoxValue,
  panelRatio: (v) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0.3 && v <= 0.7,
  logoY: isFiniteNonNegative,
  collapsed: isCollapsedValue,
  themeMode: (v) => v === "light" || v === "dark" || v === "system",
  gridMode: (v) => v === "dots" || v === "lines" || v === "none",
  wbBindings: isWbBindingsPatchValue,
};

export function validateUiPatch(
  patch: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return { ok: false, error: "设置 patch 必须是对象" };
  }
  const entries = Object.entries(patch as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: "设置 patch 为空" };
  for (const [key, value] of entries) {
    const validator = UI_SETTING_VALIDATORS[key];
    if (!validator) return { ok: false, error: `不允许的设置字段：${key}` };
    if (!validator(value)) return { ok: false, error: `设置字段格式非法：${key}` };
  }
  return { ok: true, value: patch as Record<string, unknown> };
}

// ---------- UI 设置（白名单字段） ----------

export async function readUiSettings(): Promise<UiSettingsSnapshot> {
  const saved = await getLocal([...UI_KEYS]);
  return {
    panelBox: isPanelBoxValue(saved.panelBox)
      ? (saved.panelBox as UiSettingsSnapshot["panelBox"])
      : undefined,
    panelRatio: UI_SETTING_VALIDATORS.panelRatio(saved.panelRatio)
      ? (saved.panelRatio as number)
      : undefined,
    logoY: isFiniteNonNegative(saved.logoY) ? saved.logoY : undefined,
    collapsed: isCollapsedValue(saved.collapsed)
      ? (saved.collapsed as UiSettingsSnapshot["collapsed"])
      : undefined,
    themeMode:
      saved.themeMode === "light" ||
      saved.themeMode === "dark" ||
      saved.themeMode === "system"
        ? saved.themeMode
        : undefined,
    gridMode:
      saved.gridMode === "dots" ||
      saved.gridMode === "lines" ||
      saved.gridMode === "none"
        ? saved.gridMode
        : undefined,
  };
}

export async function writeUiSettings(
  patch: Record<string, unknown>,
): Promise<void> {
  await setLocal(patch);
}

async function readWbBindings(): Promise<WbBindingsPatch | null> {
  const saved = await getLocal([BINDINGS_KEY]);
  const v = saved[BINDINGS_KEY];
  return isWbBindingsPatchValue(v) ? v : null;
}

// ---------- 消息处理（Service Worker 调用） ----------

/** 只信任本扩展、leetcode.cn 题目页主 frame 的 Content Script（02 §3.6） */
export function isTrustedContentSender(
  sender: chrome.runtime.MessageSender,
): boolean {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.frameId !== 0) return false;
  const url = sender.tab?.url ?? "";
  return /^https:\/\/leetcode\.cn\/problems\//.test(url);
}

export async function handleSettingsMessage(
  message: { type?: unknown; patch?: unknown },
  sender: chrome.runtime.MessageSender,
): Promise<SettingsResponse> {
  if (!isTrustedContentSender(sender)) {
    return { ok: false, error: "未授权的消息发送者" };
  }
  if (message.type === MSG_SETTINGS_GET_UI) {
    return { ok: true, values: await readUiSettings() };
  }
  if (message.type === MSG_SETTINGS_GET_BINDINGS) {
    return { ok: true, values: await readWbBindings() };
  }
  if (message.type === MSG_SETTINGS_SET_UI) {
    const check = validateUiPatch(message.patch);
    if (!check.ok) return { ok: false, error: check.error };
    await writeUiSettings(check.value);
    return { ok: true };
  }
  return { ok: false, error: `未知的设置命令：${String(message.type)}` };
}

// ---------- Provider 持久化（仅可信上下文调用；04 §4 / 02 §3.5） ----------

const PROTOCOLS = new Set<AiProtocol>(["openai-compatible", "anthropic"]);

function isOptionalNumber(v: unknown): boolean {
  return v === undefined || isFiniteNonNegative(v);
}

function isProviderConfigValue(v: unknown): v is ProviderConfig {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    p.id.length > 0 &&
    typeof p.name === "string" &&
    typeof p.baseUrl === "string" &&
    p.baseUrl.length > 0 &&
    PROTOCOLS.has(p.protocol as AiProtocol) &&
    typeof p.apiKey === "string" &&
    typeof p.model === "string" &&
    p.model.length > 0 &&
    isOptionalNumber(p.contextWindow) &&
    isOptionalNumber(p.priceInput) &&
    isOptionalNumber(p.priceOutput) &&
    (p.currency === undefined || p.currency === "CNY" || p.currency === "USD")
  );
}

/** 读取全部 Provider（含 Key；仅可信上下文）；非法记录被过滤，不阻塞读取 */
export async function listProviders(): Promise<ProviderConfig[]> {
  const saved = await getLocal([PROVIDERS_KEY]);
  const raw = saved[PROVIDERS_KEY];
  return Array.isArray(raw) ? raw.filter(isProviderConfigValue) : [];
}

export async function getProvider(id: string): Promise<ProviderConfig | null> {
  const list = await listProviders();
  return list.find((p) => p.id === id) ?? null;
}

/** 新增或覆盖 Provider；保存凭据前必须成功初始化可信访问级别（02 §3.5，失败明确报错） */
export async function saveProvider(config: ProviderConfig): Promise<void> {
  if (!(await ensureTrustedLocal())) {
    throw new Error("可信存储初始化失败：凭据未保存（02 §3.5）");
  }
  if (!isProviderConfigValue(config)) throw new Error("Provider 配置字段非法");
  const list = await listProviders();
  const next = list.some((p) => p.id === config.id)
    ? list.map((p) => (p.id === config.id ? config : p))
    : [...list, config];
  await setLocal({ [PROVIDERS_KEY]: next });
}

/** 删除 Provider（连同其 Key）；删除前同样要求可信访问级别已就绪 */
export async function deleteProvider(id: string): Promise<void> {
  if (!(await ensureTrustedLocal())) {
    throw new Error("可信存储初始化失败：未执行删除（02 §3.5）");
  }
  const list = await listProviders();
  await setLocal({ [PROVIDERS_KEY]: list.filter((p) => p.id !== id) });
}

// ---------- 首次保存凭据提醒（02 §3.5：只弹一次，之后常驻文字说明即可） ----------

export async function isKeyNoticeConfirmed(): Promise<boolean> {
  const saved = await getLocal([KEY_NOTICE_KEY]);
  return saved[KEY_NOTICE_KEY] === true;
}

export async function markKeyNoticeConfirmed(): Promise<void> {
  await setLocal({ [KEY_NOTICE_KEY]: true });
}