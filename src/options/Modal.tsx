import type { ReactNode } from "react";

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="oa-modal-mask" onClick={onClose}>
      <div
        className="oa-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="oa-modal-title">{title}</div>
        <div className="oa-modal-body">{children}</div>
      </div>
    </div>
  );
}