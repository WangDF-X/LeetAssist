/** 单指针窗口手势：正常松手与取消分开，所有出口先清理再通知调用方。 */
export function trackPointerGesture(
  pointerId: number,
  move: (event: PointerEvent) => void,
  finish: (cancelled: boolean) => void,
): () => void {
  let active = true;
  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  const end = (cancelled: boolean) => {
    if (!active) return;
    active = false;
    cleanup();
    finish(cancelled);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId === pointerId) move(e);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === pointerId) end(false);
  };
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) end(true);
  };
  const onBlur = () => end(true);
  const onVisibility = () => {
    if (document.hidden) end(true);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  // 卸载只清理，不触发已卸载组件的状态更新。
  return () => {
    active = false;
    cleanup();
  };
}
