# LeetAssist

轻量级 LeetCode（leetcode.cn）刷题辅助 Chrome 扩展：画板 / 智能计时 / BYOK AI 助手。完全本地、无后端。

- 产品与流程规则：见 `AGENTS.md`
- 功能规格文档：见 `plan/`（每个模块一个 spec，状态机 Draft → Confirmed → In Progress → Done）

## 开发

```bash
npm install
npm run dev      # CRXJS dev server（带 HMR），按终端提示加载扩展
npm run build    # 产出 dist/
npm run typecheck
```

加载方式：`chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选择 `dist/` 目录。然后打开任意 leetcode.cn 题目页，右下角会出现悬浮 logo，点击展开面板。

## 技术栈

Chrome Extension MV3 + React + TypeScript + Vite + @crxjs/vite-plugin。
主 UI 为页内悬浮面板（content script 注入 + Shadow DOM 样式隔离），见 `plan/01-extension-shell/spec.md`。
