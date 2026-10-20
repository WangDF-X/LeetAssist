// 独立扩展配置页（04 §3.1/§3.8，01 §3.4）：Provider 管理 + 主机权限申请。
// 安全边界：动态 permissions.request 必须在可信页面用户手势内调用；
// 页内面板只拿无密钥摘要，不提供读取已存 Key 的接口。
// 存储层（02-storage，P0-storage）下一步接入：当前 Provider 列表为会话内存态（TODO）。

import { useEffect, useState } from "react";
import { checkBaseUrl } from "../ai/baseUrl";
import type { ProviderConfig } from "../ai/types";
import { resolveTheme, type ThemeMode } from "../panel/theme";
import { Modal } from "./Modal";
import { ProviderForm } from "./ProviderForm";
import {
  buildConfig,
  draftFromConfig,
  emptyDraft,
  type ProviderDraft,
} from "./providerDraft";
import { useHostPermission } from "./useHostPermission";

// 首次保存前弹一次确认（02 §3.5）；“只弹一次”的持久化随存储层接入，当前为会话级（TODO）
let warningConfirmed = false;

/** 主题：跟随面板 themeMode（storage.local）+ 系统偏好（01 §3.7） */
function useResolvedTheme(): void {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    chrome.storage.local.get("themeMode", (saved) => {
      const v = saved.themeMode;
      if (v === "light" || v === "dark" || v === "system") setMode(v);
    });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      const v = changes.themeMode?.newValue;
      if (v === "light" || v === "dark" || v === "system") setMode(v);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    const resolved = resolveTheme(mode, systemDark);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [mode, systemDark]);
}

type DialogState =
  | { kind: "first-save"; pattern: string; config: ProviderConfig }
  | { kind: "delete"; id: string; name: string }
  | null;

export function OptionsApp() {
  useResolvedTheme();
  // TODO(02 §3.5/§3.6, P0-storage)：接入可信 local 后替换内存列表；
  // 当前仅用于打通配置页 UI 与主机授权流程（用户 2026-10-20 指示存储后置）
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const startAdd = () => {
    setDraft(emptyDraft());
    setError(null);
    setStatus(null);
  };
  const startEdit = (p: ProviderConfig) => {
    setDraft(draftFromConfig(p));
    setError(null);
    setStatus(null);
  };
  const cancelEdit = () => {
    setDraft(null);
    setError(null);
  };

  /** 同步发起 permissions.request：必须保持用户手势调用链，不经多层异步转发（04 §3.8.3） */
  const requestAndCommit = (config: ProviderConfig, pattern: string) => {
    const onGranted = (granted: boolean) => {
      if (granted) {
        setProviders((list) =>
          list.some((p) => p.id === config.id)
            ? list.map((p) => (p.id === config.id ? config : p))
            : [...list, config],
        );
        setDraft(null);
        setError(null);
        setStatus(`已保存并授权 ${pattern}`);
      } else {
        // 拒绝：配置草稿保留在表单中并显示未授权，不发任何请求（04 §3.8.3）
        setError(`未授权 ${pattern}；配置草稿已保留，修正后可再次“保存并授权”。`);
      }
    };
    const onFailed = (e: unknown) => setError(`权限申请失败：${String(e)}`);
    try {
      chrome.permissions.request({ origins: [pattern] }).then(onGranted, onFailed);
    } catch (e) {
      onFailed(e);
    }
  };

  const onSave = () => {
    if (!draft) return;
    const built = buildConfig(draft);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    if (!warningConfirmed) {
      setDialog({ kind: "first-save", pattern: built.pattern, config: built.config });
      return;
    }
    requestAndCommit(built.config, built.pattern);
  };

  const onFirstSaveConfirm = () => {
    if (dialog?.kind !== "first-save") return;
    warningConfirmed = true;
    const { config, pattern } = dialog;
    setDialog(null);
    requestAndCommit(config, pattern); // 仍在同一用户手势链内同步发起
  };

  const onDeleteConfirm = () => {
    if (dialog?.kind !== "delete") return;
    const id = dialog.id;
    setProviders((list) => list.filter((p) => p.id !== id));
    setDialog(null);
    // TODO(04 §3.8.6, 存储接入后)：仅当不再有其他 Provider 共用该主机授权时 permissions.remove
  };

  return (
    <div className="oa-container">
      <header className="oa-header">
        <h1>LeetAssist 设置</h1>
        <p>BYOK：Provider 与 API Key 只保存在本浏览器扩展本地存储，无云端同步。</p>
      </header>

      <section className="oa-section">
        <div className="oa-section-head">
          <h2>AI Provider</h2>
          {!draft && (
            <button className="oa-btn" data-variant="primary" onClick={startAdd}>
              添加 Provider
            </button>
          )}
        </div>
        <div className="oa-devnote">
          开发中：Provider 持久化（02-storage）下一步接入，当前列表仅本页面会话内生效；主机授权即时生效。
        </div>

        {draft ? (
          <ProviderForm
            draft={draft}
            error={error}
            onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
            onSave={onSave}
            onCancel={cancelEdit}
          />
        ) : providers.length === 0 ? (
          <div className="oa-empty">
            还没有 Provider。点击「添加 Provider」，或用预置快速填入后「保存并授权」。
          </div>
        ) : (
          <div className="oa-list">
            {providers.map((p) => (
              <ProviderRow
                key={p.id}
                provider={p}
                onEdit={() => startEdit(p)}
                onDelete={() =>
                  setDialog({ kind: "delete", id: p.id, name: p.name })
                }
              />
            ))}
          </div>
        )}
        {status && <div className="oa-status">{status}</div>}
      </section>

      {dialog?.kind === "first-save" && (
        <Modal title="保存前请确认" onClose={() => setDialog(null)}>
          <p>
            API Key 将以明文保存在本浏览器扩展本地存储，不加密、不云同步；仅在发起请求时发送到你配置的
            Provider（本次授权范围：{dialog.pattern}）。请勿在公共/共享设备保存真实 Key。
          </p>
          <div className="oa-modal-foot">
            <button className="oa-btn" onClick={() => setDialog(null)}>
              取消
            </button>
            <button
              className="oa-btn"
              data-variant="primary"
              onClick={onFirstSaveConfirm}
            >
              我已了解，保存并授权
            </button>
          </div>
        </Modal>
      )}

      {dialog?.kind === "delete" && (
        <Modal title="删除 Provider" onClose={() => setDialog(null)}>
          <p>确定删除「{dialog.name}」？其 API Key 将一并从本地删除。</p>
          <div className="oa-modal-foot">
            <button className="oa-btn" onClick={() => setDialog(null)}>
              取消
            </button>
            <button
              className="oa-btn"
              data-variant="danger"
              onClick={onDeleteConfirm}
            >
              删除
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ProviderRow({
  provider,
  onEdit,
  onDelete,
}: {
  provider: ProviderConfig;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const check = checkBaseUrl(provider.baseUrl);
  const pattern = check.ok ? check.originPattern : null;
  const granted = useHostPermission(pattern);
  return (
    <div className="oa-card">
      <div className="oa-card-main">
        <div className="oa-card-title">
          <span>{provider.name}</span>
          <span className="oa-chip">
            {provider.protocol === "anthropic" ? "Anthropic" : "OpenAI-compatible"}
          </span>
          <span className="oa-chip" data-state={granted ? "granted" : "required"}>
            {granted ? "已授权" : "未授权"}
          </span>
        </div>
        <div className="oa-card-sub">
          {provider.model} · {pattern ?? provider.baseUrl}
        </div>
      </div>
      <button className="oa-btn" onClick={onEdit}>
        编辑
      </button>
      <button className="oa-btn" data-variant="danger" onClick={onDelete}>
        删除
      </button>
    </div>
  );
}