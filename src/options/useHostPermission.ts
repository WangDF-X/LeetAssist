// 目标主机授权状态（04 §3.8.4）：每次重新 contains 查询，不缓存历史授权结果；
// 权限增删事件（含浏览器侧撤权）实时刷新。
import { useEffect, useState } from "react";

// @types/chrome 0.0.287 的 PermissionsAddedEvent/PermissionsRemovedEvent 类型缺少 removeListener
// （浏览器实际 API 存在），补一个最小接口，避免 effect 反复注册造成监听泄漏。
interface PermEvent {
  addListener(cb: () => void): void;
  removeListener(cb: () => void): void;
}
const onAdded = chrome.permissions.onAdded as unknown as PermEvent;
const onRemoved = chrome.permissions.onRemoved as unknown as PermEvent;

export function useHostPermission(pattern: string | null): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (!pattern) {
      setGranted(false);
      return;
    }
    let alive = true;
    const refresh = () => {
      chrome.permissions
        .contains({ origins: [pattern] })
        .then((v) => {
          if (alive) setGranted(v);
        })
        .catch(() => {
          if (alive) setGranted(false);
        });
    };
    refresh();
    onAdded.addListener(refresh);
    onRemoved.addListener(refresh);
    return () => {
      alive = false;
      onAdded.removeListener(refresh);
      onRemoved.removeListener(refresh);
    };
  }, [pattern]);
  return granted;
}