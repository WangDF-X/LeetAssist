// 画板交互绑定配置（数据驱动）。
// 背景：用户计划后续支持自定义快捷键（如"右键 = 文本工具"可改）。
// 因此所有"键/鼠标动作 → 行为"的映射集中在本文件，UI 只读配置不写死；
// 未来设置页把用户覆盖写入 chrome.storage.local 的 wbBindings 即可生效，无需改交互代码。
import type { WBTool } from "./Toolbar";

/** 单键/组合键绑定描述 */
export interface KeyBinding {
  key: string; // 匹配 KeyboardEvent.key（小写比较）或 e.code（code=true 时）
  code?: boolean; // true：按物理键位 e.code 匹配（如 Space）
  ctrl?: boolean; // 需要 Ctrl/Cmd（mac 兼容：ctrlKey || metaKey）
  shift?: boolean;
}

/** 右键行为（§5.2 当前固定为快速文本；未来可在设置中改为其他动作） */
export type ContextMenuAction = "quickText";

export interface WBBindings {
  /** 工具切换快捷键：键（小写）→ 工具 */
  tools: Record<string, WBTool>;
  undo: KeyBinding;
  redo: KeyBinding;
  /** 删除选中元素的键（多个） */
  delete: string[];
  /** 平移修饰键（按住 + 拖动），按 e.code 匹配 */
  pan: string;
  contextMenu: ContextMenuAction;
}

export const DEFAULT_BINDINGS: WBBindings = {
  tools: { v: "select", p: "pen", r: "rect", o: "ellipse", a: "arrow", t: "text" },
  undo: { key: "z", ctrl: true },
  redo: { key: "z", ctrl: true, shift: true },
  delete: ["Delete", "Backspace"],
  pan: "Space",
  contextMenu: "quickText",
};

const STORAGE_KEY = "wbBindings";

/**
 * 读取生效绑定 = 默认绑定 + 用户覆盖（用户自定义功能未做，当前恒等于默认）。
 * 工具键表做一层浅合并，允许用户只改个别键。
 */
export async function loadBindings(): Promise<WBBindings> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (saved) => {
      const user = saved[STORAGE_KEY] as Partial<WBBindings> | undefined;
      resolve({
        ...DEFAULT_BINDINGS,
        ...(user ?? {}),
        tools: { ...DEFAULT_BINDINGS.tools, ...(user?.tools ?? {}) },
      });
    });
  });
}

/** 判断键盘事件是否命中绑定（ctrl 含 mac Cmd；shift 必须精确匹配避免 Ctrl+Shift+Z 触发 Ctrl+Z） */
export function matchKey(b: KeyBinding, e: KeyboardEvent): boolean {
  const keyOk = b.code ? e.code === b.key : e.key.toLowerCase() === b.key;
  const ctrlOk = !!b.ctrl === (e.ctrlKey || e.metaKey);
  const shiftOk = !!b.shift === e.shiftKey;
  return keyOk && ctrlOk && shiftOk;
}
