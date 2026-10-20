// Base URL 规则（04 §3.1/§3.8）：仅 HTTPS；拒绝内嵌用户名/密码、fragment 与含认证信息的查询参数；
// 主机权限只按 origin 申请（match pattern 不能精确到路径/端口，后台另校验完整来源）。
// 纯函数（不依赖 chrome.*），配置页与后续 Service Worker 复用同一份校验。

export type BaseUrlCheck =
  | { ok: true; url: URL; normalized: string; originPattern: string }
  | { ok: false; error: string };

const AUTH_QUERY_KEYS = new Set([
  "api_key",
  "apikey",
  "api-key",
  "key",
  "token",
  "access_token",
  "auth",
  "authorization",
]);

export function checkBaseUrl(raw: string): BaseUrlCheck {
  const input = raw.trim();
  if (!input) return { ok: false, error: "请填写 Base URL" };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: "Base URL 不是合法的 URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "Base URL 仅支持 https://（不接受 http 或其它协议）" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Base URL 不允许内嵌用户名/密码" };
  }
  if (url.hash) {
    return { ok: false, error: "Base URL 不允许包含 #fragment" };
  }
  for (const key of url.searchParams.keys()) {
    if (AUTH_QUERY_KEYS.has(key.toLowerCase())) {
      return {
        ok: false,
        error: `Base URL 的查询参数不允许携带认证信息（${key}）`,
      };
    }
  }
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  return { ok: true, url, normalized, originPattern: originPatternOf(url) };
}

/** 授权目标匹配串：仅 origin 级（04 §3.8.2：只申请用户选定目标，不申请所有主机/子域通配） */
export function originPatternOf(url: URL): string {
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${url.hostname}${port}/*`;
}