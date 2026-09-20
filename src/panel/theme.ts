// 设计令牌（Design Tokens）唯一来源，规则见 plan/01-extension-shell/spec.md §3.7：
// 1. 组件/样式中只允许 var(--la-*)，禁止硬编码颜色字面量；
// 2. 新增 token 时在 LIGHT / DARK 两块中成对补充；
// 3. 品牌色板：accent #22a7f0 / violet #8b5cf6 / amber #fbbf24 / danger #e5484d。
// check:theme 脚本会扫描本文件以外的颜色字面量并使构建失败。

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const LIGHT_VARS = `
  --la-bg: #f7f8fa;
  --la-surface: #ffffff;
  --la-toolbar-bg: #eef1f5;
  --la-border: #d8dce3;
  --la-border-soft: #e6e9ee;
  --la-text: #374151;
  --la-text-dim: #6b7280;
  --la-text-faint: #9aa3af;
  --la-hover: #dde3ea;
  --la-accent: #22a7f0;
  --la-accent-strong: #1b95d9;
  --la-on-accent: #ffffff;
  --la-violet: #8b5cf6;
  --la-amber: #fbbf24;
  --la-danger: #e5484d;
  --la-danger-strong: #d13438;
  --la-shadow-panel: 0 18px 50px rgba(30, 35, 60, 0.28);
  --la-shadow-pop: 0 10px 30px rgba(30, 35, 60, 0.2);
  --la-shadow-ear: 0 2px 8px rgba(30, 35, 60, 0.15);
  --la-shadow-logo: 0 6px 18px rgba(60, 60, 120, 0.35);
`;

const DARK_VARS = `
  --la-bg: #1e2128;
  --la-surface: #262932;
  --la-toolbar-bg: #22252d;
  --la-border: #3a3e4a;
  --la-border-soft: #2e323d;
  --la-text: #e5e7eb;
  --la-text-dim: #9aa3af;
  --la-text-faint: #6b7280;
  --la-hover: #31353f;
  --la-accent: #22a7f0;
  --la-accent-strong: #3cb5f5;
  --la-on-accent: #ffffff;
  --la-violet: #8b5cf6;
  --la-amber: #fbbf24;
  --la-danger: #e5484d;
  --la-danger-strong: #d13438;
  --la-shadow-panel: 0 18px 50px rgba(0, 0, 0, 0.55);
  --la-shadow-pop: 0 10px 30px rgba(0, 0, 0, 0.45);
  --la-shadow-ear: 0 2px 8px rgba(0, 0, 0, 0.4);
  --la-shadow-logo: 0 6px 18px rgba(0, 0, 0, 0.5);
`;

// 注入在 Shadow Root 内：.la-root（PanelApp 根节点）上按 data-theme 声明变量，
// 所有后代选择器直接 var() 引用
export const THEME_VARS_CSS = `
.la-root[data-theme="light"] {${LIGHT_VARS}}
.la-root[data-theme="dark"] {${DARK_VARS}}
`;

export function resolveTheme(
  mode: ThemeMode,
  systemDark: boolean,
): ResolvedTheme {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

export const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"];

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const i = THEME_MODES.indexOf(mode);
  return THEME_MODES[(i + 1) % THEME_MODES.length];
}

export const THEME_MODE_LABEL: Record<ThemeMode, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};
