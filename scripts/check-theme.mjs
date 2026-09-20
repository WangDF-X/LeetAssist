// check:theme — plan/01-extension-shell §3.7 硬规则的机器检查：
// src/ 下除 theme.ts（token 唯一来源）外，禁止出现硬编码颜色字面量
// （#hex / rgb() / rgba()）。发现即非零退出，挂在 build 前置。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const ALLOW_FILE = join("panel", "theme.ts");
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/g;
const SCAN_EXT = new Set([".ts", ".tsx", ".css"]);

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let violations = 0;
for (const file of walk(SRC)) {
  if (!SCAN_EXT.has(file.slice(file.lastIndexOf(".")))) continue;
  if (file.endsWith(ALLOW_FILE)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    COLOR_RE.lastIndex = 0;
    if (COLOR_RE.test(line)) {
      violations++;
      console.error(
        `[check:theme] ${relative(SRC, file)}:${i + 1} 硬编码颜色：${line.trim()}`,
      );
    }
  });
}

if (violations > 0) {
  console.error(
    `\n[check:theme] 发现 ${violations} 处硬编码颜色。请改用 theme.ts 中的 --la-* 设计令牌（plan/01 §3.7）。`,
  );
  process.exit(1);
}
console.log("[check:theme] OK：未发现硬编码颜色");
