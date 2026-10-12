// 01 spec §3.5：SPA 路由变化检测。
// leetcode.cn 是单页应用；content script 运行在 isolated world，
// 无法直接挂钩页面 main world 的 history.pushState，
// 采用 popstate/hashchange + 轻量轮询（500ms）兜底，任一发现 slug 变化即广播。
// 面板内模块（画板切题恢复、对话标题更新等）监听 PROBLEM_CHANGED_EVENT。

export function currentProblemSlug(): string {
  return location.pathname.match(/\/problems\/([^/]+)/)?.[1] ?? "";
}

export function startRouteWatch(eventName: string): void {
  let last = currentProblemSlug();
  const check = () => {
    const slug = currentProblemSlug();
    if (slug === last) return;
    last = slug;
    if (!slug) return; // 离开题目页不广播（面板仍显示上一题数据即可）
    window.dispatchEvent(
      new CustomEvent(eventName, { detail: { problemId: slug } }),
    );
  };
  window.addEventListener("popstate", check);
  window.addEventListener("hashchange", check);
  window.setInterval(check, 500);
}
