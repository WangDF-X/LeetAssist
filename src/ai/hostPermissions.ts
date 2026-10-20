// 04 §3.8.6：删除 Provider 后的可选主机授权回收决策（纯逻辑，配置页与测试共用）。
// 规则：只回收该 Provider origin 的授权；leetcode.cn 基础权限不动；
// 仍被其他 Provider 共用（同一 origin 匹配串）则保留。
import { checkBaseUrl } from "./baseUrl";
import type { ProviderConfig } from "./types";

export const LEETCODE_BASE_PATTERN = "https://leetcode.cn/*";

export type HostPermissionDecision =
  | { action: "skip"; reason: "no-pattern" | "base-permission" | "shared" }
  | { action: "remove"; pattern: string };

export function planHostPermissionCleanup(
  deletedPattern: string | null,
  remainingProviders: ProviderConfig[],
): HostPermissionDecision {
  if (!deletedPattern) return { action: "skip", reason: "no-pattern" };
  if (deletedPattern === LEETCODE_BASE_PATTERN) {
    return { action: "skip", reason: "base-permission" };
  }
  const shared = remainingProviders.some((p) => {
    const c = checkBaseUrl(p.baseUrl);
    return c.ok && c.originPattern === deletedPattern;
  });
  return shared
    ? { action: "skip", reason: "shared" }
    : { action: "remove", pattern: deletedPattern };
}

export type HostPermissionChangeDecision =
  | HostPermissionDecision
  | { action: "skip"; reason: "unchanged" };

/** 编辑 Provider 更换主机后的回收决策（04 §3.8.6）：
 *  remainingProviders 必须是“新配置已保存之后”的列表（编辑后的 Provider 已指向新主机），
 *  旧主机是否仍被共用沿用删除路径同一套判断。 */
export function planHostPermissionChange(
  oldPattern: string | null,
  newPattern: string,
  remainingProviders: ProviderConfig[],
): HostPermissionChangeDecision {
  if (!oldPattern) return { action: "skip", reason: "no-pattern" };
  if (oldPattern === newPattern) return { action: "skip", reason: "unchanged" };
  return planHostPermissionCleanup(oldPattern, remainingProviders);
}

// 取 match pattern / origin 的主机（含端口）；含通配符的主机（https://* 等）返回 null
export function patternHost(pattern: string): string | null {
  const stripped = pattern.replace(/\*+$/, "");
  let url: URL;
  try {
    url = new URL(stripped);
  } catch {
    return null;
  }
  if (!url.host || url.host.includes("*")) return null;
  return url.host;
}

/** 从浏览器实际授予的 origins 中筛出目标主机对应的 pattern（04 §3.8.6 精确回收用） */
export function grantedPatternsForHost(
  grantedOrigins: string[],
  targetPattern: string,
): string[] {
  const host = patternHost(targetPattern);
  if (!host) return [];
  return grantedOrigins.filter((p) => patternHost(p) === host);
}

/** 列出“已授予但没有任何 Provider 在使用”的可选主机授权（04 §3.8.6 兜底清理用）。
 *  只处理能解析出具体主机的 pattern；leetcode.cn 基础站点与通配 pattern 一律跳过。 */
export function listOrphanGrantedHosts(
  grantedOrigins: string[],
  providers: ProviderConfig[],
): string[] {
  const usedHosts = new Set<string>();
  for (const p of providers) {
    const c = checkBaseUrl(p.baseUrl);
    const host = c.ok ? patternHost(c.originPattern) : null;
    if (host) usedHosts.add(host);
  }
  const orphans: string[] = [];
  for (const origin of grantedOrigins) {
    const host = patternHost(origin);
    if (!host) continue; // 通配/非主机 pattern 不处理
    if (host === "leetcode.cn") continue; // 基础站点权限不动（01 §8）
    if (usedHosts.has(host)) continue;
    if (!orphans.includes(origin)) orphans.push(origin);
  }
  return orphans;
}