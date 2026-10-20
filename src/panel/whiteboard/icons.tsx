// 数据结构图元库图标：内联 SVG（24×24，currentColor，随主题），不引图标库。
// plan/03-whiteboard §5.1：图标随主题、走 token。
import type { ReactNode } from "react";

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  // 序列：一格四分 + 下标点
  array: (
    <Glyph>
      <rect x="2" y="6" width="5" height="8" rx="0.5" />
      <rect x="7" y="6" width="5" height="8" rx="0.5" />
      <rect x="12" y="6" width="5" height="8" rx="0.5" />
      <rect x="17" y="6" width="5" height="8" rx="0.5" />
      <circle cx="4.5" cy="19" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="19" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="19" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="19.5" cy="19" r="0.9" fill="currentColor" stroke="none" />
    </Glyph>
  ),
  // 柱状图：递增竖条
  bar: (
    <Glyph>
      <rect x="3" y="14" width="3.6" height="6" rx="0.5" />
      <rect x="8.5" y="11" width="3.6" height="9" rx="0.5" />
      <rect x="14" y="8" width="3.6" height="12" rx="0.5" />
      <rect x="19.5" y="5" width="3.6" height="15" rx="0.5" />
    </Glyph>
  ),
  // 链表：两框 + 箭头
  linkedlist: (
    <Glyph>
      <rect x="2" y="8" width="7" height="8" rx="1" />
      <rect x="15" y="8" width="7" height="8" rx="1" />
      <line x1="9.5" y1="12" x2="14" y2="12" />
      <path d="M12.4 10.2 L14.4 12 L12.4 13.8" />
    </Glyph>
  ),
  // 栈：竖叠、上开口
  stack: (
    <Glyph>
      <path d="M5 3 V18 a2 2 0 0 0 2 2 h10 a2 2 0 0 0 2-2 V3" />
      <line x1="5" y1="7.5" x2="19" y2="7.5" />
      <line x1="5" y1="12" x2="19" y2="12" />
      <line x1="5" y1="16" x2="19" y2="16" />
    </Glyph>
  ),
  // 队列：横排三格
  queue: (
    <Glyph>
      <rect x="2" y="8" width="6" height="8" rx="0.5" />
      <rect x="9" y="8" width="6" height="8" rx="0.5" />
      <rect x="16" y="8" width="6" height="8" rx="0.5" />
    </Glyph>
  ),
  // 表格：3×3 网格
  grid: (
    <Glyph>
      <rect x="3" y="3" width="18" height="18" rx="1.5" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </Glyph>
  ),
  // 键值表：两列 + 表头
  hash: (
    <Glyph>
      <rect x="2" y="5" width="20" height="14" rx="1.5" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="11" y1="5" x2="11" y2="19" />
    </Glyph>
  ),
  // 桶：三个并排容器
  bucket: (
    <Glyph>
      <path d="M3 6 V18 a2 2 0 0 0 2 2 a2 2 0 0 0 2-2 V6" />
      <path d="M10 6 V18 a2 2 0 0 0 2 2 a2 2 0 0 0 2-2 V6" />
      <path d="M17 6 V18 a2 2 0 0 0 2 2 a2 2 0 0 0 2-2 V6" />
    </Glyph>
  ),
  // 树：一父两子
  tree: (
    <Glyph>
      <circle cx="12" cy="6" r="2.6" />
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <line x1="10.6" y1="8.2" x2="7.1" y2="15.6" />
      <line x1="13.4" y1="8.2" x2="16.9" y2="15.6" />
    </Glyph>
  ),
  // 堆：金字塔三层结点
  heap: (
    <Glyph>
      <circle cx="12" cy="4.5" r="2" />
      <circle cx="7.5" cy="12" r="2" />
      <circle cx="16.5" cy="12" r="2" />
      <circle cx="4.5" cy="19.5" r="2" />
      <circle cx="10" cy="19.5" r="2" />
      <circle cx="14" cy="19.5" r="2" />
      <circle cx="19.5" cy="19.5" r="2" />
    </Glyph>
  ),
  // 图：四结点环
  graph: (
    <Glyph>
      <circle cx="12" cy="4" r="2.4" />
      <circle cx="20" cy="12" r="2.4" />
      <circle cx="12" cy="20" r="2.4" />
      <circle cx="4" cy="12" r="2.4" />
      <line x1="13.8" y1="5.4" x2="18.2" y2="10.6" />
      <line x1="18.2" y1="13.4" x2="13.8" y2="18.6" />
      <line x1="10.2" y1="18.6" x2="5.8" y2="13.4" />
      <line x1="5.8" y1="10.6" x2="10.2" y2="5.4" />
    </Glyph>
  ),
  // 状态机：两圆 + 有向边
  statemachine: (
    <Glyph>
      <circle cx="5.5" cy="12" r="3.2" />
      <circle cx="18.5" cy="12" r="3.2" />
      <line x1="8.7" y1="12" x2="15" y2="12" />
      <path d="M13.2 10.1 L15.3 12 L13.2 13.9" />
    </Glyph>
  ),
};

export function PresetIcon({ id }: { id: string }) {
  return <>{ICONS[id] ?? null}</>;
}
