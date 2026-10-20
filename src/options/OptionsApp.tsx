// 独立扩展配置页（04 §3.1/§3.8，01 §3.4）：Provider 管理 + 主机权限申请。
// 安全边界：动态 permissions.request 必须在可信页面用户手势内调用；
// 页内面板只拿无密钥摘要，不提供读取已存 Key 的接口。
// 持久化：Provider/首次提醒标记走 02 §3.5 可信存储（本页为可信上下文，直接调用 settings.ts）。

import { useEffect, useState } from "react";
import { checkBaseUrl } from "../ai/baseUrl";
import {
  grantedPatternsForHost,
  listOrphanGrantedHosts,
  planHostPermissionCleanup,
} from "../ai/hostPermissions";
import type { ProviderConfig } from "../ai/types";
import { resolveTheme, type ThemeMode } from "../panel/theme";
import {
  deleteProvider,
  isKeyNoticeConfirmed,
  listProviders,
  markKeyNoticeConfirmed,
  saveProvider,
} from "../storage/settings";
import { Modal } from "./Modal";
import { ProviderForm } from "./ProviderForm";
import {
  buildConfig,
  draftFromConfig,
  emptyDraft,
  type ProviderDraft,
} from "./providerDraft";
import { useHostPermission } from "./useHostPermission";

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
  | { kind: "cleanup"; hosts: string[] }
  | null;

/** 删除 Provider 后清理不再被使用的主机授权（04 §3.8.6），并返回可展示的结果说明：
 *  该环节不允许静默失败——回收失败/未授予/共用保留都要能看见。
 *  实现：用 permissions.getAll() 反查浏览器实际授予的 pattern 再精确移除，
 *  避免请求 pattern 与授予表示形式不一致时 remove 无效。 */
async function cleanupHostPermission(pattern: string | null): Promise<string> {
  try {
    const rest = await listProviders();
    const decision = planHostPermissionCleanup(pattern, rest);
    if (decision.action === "skip") {
      if (decision.reason === "shared") {
        return "主机授权保留（仍被其他 Provider 共用）";
      }
      return "";
    }
    const granted = grantedPatternsForHost(
      (await chrome.permissions.getAll()).origins ?? [],
      decision.pattern,
    );
    if (granted.length === 0) {
      return `主机授权 ${decision.pattern} 未处于已授予状态，无需回收`;
    }
    const failed: string[] = [];
    for (const p of granted) {
      try {
        await chrome.permissions.remove({ origins: [p] });
      } catch {
        // 单个 pattern 失败不中断；最终以复查结果为准
        failed.push(p);
      }
    }
    // 以浏览器当前权限为准复查（remove 返回值在部分浏览器上可能与实际状态不一致）
    const remaining = grantedPatternsForHost(
      (await chrome.permissions.getAll()).origins ?? [],
      decision.pattern,
    );
    if (remaining.length === 0) return `已回收主机授权 ${granted.join("、")}`;
    const reason =
      failed.length > 0
        ? `（remove 调用异常：${failed.join("、")}）`
        : "（remove 已调用但浏览器未生效）";
    return `主机授权仍处于已授予状态：${remaining.join("、")}${reason}，可在扩展管理页手动移除`;
  } catch (e) {
    return `主机授权回收失败：${String(e)}`;
  }
}

/** 回收“孤儿”站点授权（不再被任何 Provider 使用，多来自更早版本删除失败/崩溃残留）；
 *  完成后用 getAll 复查并返回结果说明。 */
async function cleanupOrphanPermissions(hosts: string[]): Promise<string> {
  const failed: string[] = [];
  for (const p of hosts) {
    try {
      await chrome.permissions.remove({ origins: [p] });
    } catch {
      failed.push(p);
    }
  }
  const remaining = listOrphanGrantedHosts(
    (await chrome.permissions.getAll()).origins ?? [],
    await listProviders(),
  ).filter((h) => hosts.includes(h));
  if (remaining.length === 0) return `已回收未使用授权 ${hosts.join("、")}`;
  const reason =
    failed.length > 0
      ? `（remove 调用异常：${failed.join("、")}）`
      : "（remove 已调用但浏览器未生效）";
  return `仍有授权未回收：${remaining.join("、")}${reason}，可在扩展管理页手动移除`;
}

export function OptionsApp() {
  useResolvedTheme();
  // Provider 列表与首次提醒标记来自可信存储（02 §3.5–3.6）
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [noticeConfirmed, setNoticeConfirmed] = useState(false);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  // 已授予但无 Provider 使用的站点授权（04 §3.8.6 兜底清理入口）
  const [orphans, setOrphans] = useState<string[]>([]);

  /** 用浏览器实际权限重算孤儿授权（providers 变化或回收后调用） */
  const refreshOrphans = (list: ProviderConfig[]) => {
    chrome.permissions.getAll().then(
      (p) => setOrphans(listOrphanGrantedHosts(p.origins ?? [], list)),
      () => setOrphans([]),
    );
  };

  useEffect(() => {
    let alive = true;
    listProviders().then(
      (list) => {
        if (alive) setProviders(list);
      },
      (e) => {
        if (alive) setError(`读取 Provider 失败：${String(e)}`);
      },
    );
    isKeyNoticeConfirmed().then((v) => {
      if (alive) setNoticeConfirmed(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Provider 变化后用实际权限重算孤儿授权（删除清理失败/更早版本残留也能兜底发现）
  useEffect(() => {
    let alive = true;
    chrome.permissions.getAll().then(
      (p) => {
        if (alive) setOrphans(listOrphanGrantedHosts(p.origins ?? [], providers));
      },
      () => {
        if (alive) setOrphans([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [providers]);

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
        // 授权成功后持久化（02 §3.5：可信访问级别初始化在 saveProvider 内保证）
        saveProvider(config).then(
          () => {
            setProviders((list) =>
              list.some((p) => p.id === config.id)
                ? list.map((p) => (p.id === config.id ? config : p))
                : [...list, config],
            );
            setDraft(null);
            setError(null);
            setStatus(`已保存并授权 ${pattern}`);
          },
          (e) => setError(`保存失败：${String(e)}`),
        );
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
    // 首次保存凭据前弹一次确认（02 §3.5，持久化标记）
    if (!noticeConfirmed) {
      setDialog({ kind: "first-save", pattern: built.pattern, config: built.config });
      return;
    }
    requestAndCommit(built.config, built.pattern);
  };

  const onFirstSaveConfirm = () => {
    if (dialog?.kind !== "first-save") return;
    const { config, pattern } = dialog;
    setDialog(null);
    if (!noticeConfirmed) {
      setNoticeConfirmed(true);
      void markKeyNoticeConfirmed(); // 不阻塞用户手势链
    }
    requestAndCommit(config, pattern); // 仍在同一用户手势链内同步发起
  };

  const onDeleteConfirm = () => {
    if (dialog?.kind !== "delete") return;
    const { id, name } = dialog;
    const target = providers.find((p) => p.id === id);
    const check = target ? checkBaseUrl(target.baseUrl) : null;
    const pattern = check && check.ok ? check.originPattern : null;
    setDialog(null);
    deleteProvider(id).then(
      () => {
        setProviders((list) => list.filter((p) => p.id !== id));
        // 04 §3.8.6：回收不再共用的主机授权；结果显式反馈（不允许静默失败）
        void cleanupHostPermission(pattern).then((note) =>
          setStatus(note ? `已删除「${name}」；${note}` : `已删除「${name}」`),
        );
      },
      (e) => setError(`删除失败：${String(e)}`),
    );
  };

  const onCleanupConfirm = () => {
    if (dialog?.kind !== "cleanup") return;
    const hosts = dialog.hosts;
    setDialog(null);
    void cleanupOrphanPermissions(hosts).then((note) => {
      setStatus(note);
      refreshOrphans(providers);
    });
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

        {orphans.length > 0 && (
          <div className="oa-orphans">
            <span>
              发现 {orphans.length} 个不再被任何 Provider 使用的站点授权：
              {orphans.join("、")}
            </span>
            <button
              className="oa-btn"
              data-variant="danger"
              onClick={() => setDialog({ kind: "cleanup", hosts: orphans })}
            >
              清理
            </button>
          </div>
        )}

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
{dialog?.kind === "cleanup" && (
        <Modal title="清理未使用的主机授权" onClose={() => setDialog(null)}>
          <p>
            以下站点授权不再被任何 Provider 使用（通常来自更早版本删除失败等残留），是否回收？
          </p>
          <ul>
            {dialog.hosts.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <div className="oa-modal-foot">
            <button className="oa-btn" onClick={() => setDialog(null)}>
              取消
            </button>
            <button
              className="oa-btn"
              data-variant="danger"
              onClick={onCleanupConfirm}
            >
              回收
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