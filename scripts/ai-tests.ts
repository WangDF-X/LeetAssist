// test:ai — 04 配置契约与 02 受控设置的纯逻辑用例（Base URL 规则、预置项、授权匹配串、
// 题目描述/约束抽取、UI 设置白名单校验）。
// 通过 esbuild 打包后用 node 运行，与 dsl-tests 同一模式，无需额外测试框架。
import { checkBaseUrl, originPatternOf } from "../src/ai/baseUrl";
import {
  grantedPatternsForHost,
  listOrphanGrantedHosts,
  patternHost,
  planHostPermissionCleanup,
} from "../src/ai/hostPermissions";
import { PROVIDER_PRESETS } from "../src/ai/presets";
import type { ProviderConfig } from "../src/ai/types";
import { htmlToText, splitProblemContent } from "../src/ai/problemContext";
import {
  isWbBindingsPatchValue,
  validateUiPatch,
} from "../src/storage/settings";

let pass = 0;
const failures: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) pass++;
  else failures.push(name);
}

check("https 合法", checkBaseUrl("https://api.example.com/v1").ok);
check("http 拒绝", !checkBaseUrl("http://api.example.com").ok);
check("空值拒绝", !checkBaseUrl("   ").ok);
check("无协议拒绝", !checkBaseUrl("api.example.com").ok);
check("内嵌用户名/密码拒绝", !checkBaseUrl("https://user:pass@api.example.com").ok);
check("内嵌用户名拒绝", !checkBaseUrl("https://user@api.example.com").ok);
check("fragment 拒绝", !checkBaseUrl("https://api.example.com/v1#x").ok);
check("api_key 查询参数拒绝", !checkBaseUrl("https://api.example.com/v1?api_key=abc").ok);
check("access_token 查询参数拒绝", !checkBaseUrl("https://api.example.com/v1?access_token=abc").ok);
check("非认证查询参数允许", checkBaseUrl("https://api.example.com/v1?api-version=2024-02-01").ok);

const norm = checkBaseUrl("https://api.openai.com/v1/");
check("规范化去尾斜杠", norm.ok && norm.normalized === "https://api.openai.com/v1");

const root = checkBaseUrl("https://api.deepseek.com");
check("根路径规范化", root.ok && root.normalized === "https://api.deepseek.com");
check("默认端口 pattern", root.ok && root.originPattern === "https://api.deepseek.com/*");

const port = checkBaseUrl("https://api.example.com:8443/v1");
check("非默认端口 pattern", port.ok && port.originPattern === "https://api.example.com:8443/*");
check("路径不进入 pattern", port.ok && !port.originPattern.includes("/v1"));

for (const p of PROVIDER_PRESETS) {
  check(`预置 ${p.name} Base URL 合法`, checkBaseUrl(p.baseUrl).ok);
}

check(
  "originPatternOf 可直接复用",
  originPatternOf(new URL("https://api.anthropic.com")) === "https://api.anthropic.com/*",
);

// ---- 题目描述/约束抽取（04 §3.3 上下文快照） ----

check("HTML 去标签", htmlToText("<p>给定 <code>nums</code></p>") === "给定 nums");
check(
  "实体解码在去标签之后",
  htmlToText("<li><code>2 &lt;= n &lt;= 10^4</code></li>") === "2 <= n <= 10^4",
);
check("块级标签转换行", htmlToText("<p>a</p><p>b</p>") === "a\nb");

const cn = splitProblemContent(
  "<p>描述部分</p><p><strong>提示：</strong></p><ul><li>1 &lt;= n</li><li>n &lt;= 100</li></ul>",
);
check(
  "中文提示拆分",
  cn.description === "描述部分" &&
    cn.constraints.includes("1 <= n") &&
    cn.constraints.includes("n <= 100"),
);

const en = splitProblemContent(
  "<p>desc</p><p><strong>Constraints:</strong></p><ul><li>1 &lt;= n</li></ul>",
);
check("英文 Constraints 拆分", en.description === "desc" && en.constraints.includes("1 <= n"));

const noMark = splitProblemContent("<p>只有描述</p>");
check("无提示标记时约束为空", noMark.constraints === "" && noMark.description === "只有描述");

// ---- 受控设置校验（02 §3.6 白名单 + 类型/范围） ----

check("UI 设置：合法 patch 通过", validateUiPatch({ themeMode: "dark" }).ok);
check("UI 设置：拒绝未知字段", !validateUiPatch({ providerKey: "x" }).ok);
check("UI 设置：拒绝非法 themeMode", !validateUiPatch({ themeMode: "blue" }).ok);
check("UI 设置：ratio 越界拒绝", !validateUiPatch({ panelRatio: 0.9 }).ok);
check(
  "UI 设置：panelBox 校验通过",
  validateUiPatch({ panelBox: { x: 1, y: 2, w: 800, h: 600 } }).ok,
);
check("UI 设置：panelBox 缺字段拒绝", !validateUiPatch({ panelBox: { x: 1, y: 2 } }).ok);
check("UI 设置：空 patch 拒绝", !validateUiPatch({}).ok);
check(
  "bindings：合法覆盖通过",
  isWbBindingsPatchValue({ tools: { v: "select" }, undo: { key: "z", ctrl: true } }),
);
check("bindings：未知工具拒绝", !isWbBindingsPatchValue({ tools: { v: "laser" } }));
check("bindings：未知字段拒绝", !isWbBindingsPatchValue({ foo: 1 }));

// ---- 删除 Provider 的主机授权回收决策（04 §3.8.6） ----

function provider(id: string, baseUrl: string): ProviderConfig {
  return {
    id,
    name: id,
    baseUrl,
    protocol: "openai-compatible",
    apiKey: "sk-test",
    model: "m",
  };
}

const keepShared = planHostPermissionCleanup("https://h.example/*", [
  provider("b", "https://h.example/v1"),
]);
check(
  "回收决策：同 host 共用则保留",
  keepShared.action === "skip" && keepShared.reason === "shared",
);

const removeLast = planHostPermissionCleanup("https://h.example/*", [
  provider("c", "https://other.example"),
]);
check(
  "回收决策：无共用则回收",
  removeLast.action === "remove" && removeLast.pattern === "https://h.example/*",
);

const emptyRest = planHostPermissionCleanup("https://h.example/*", []);
check("回收决策：删最后一个也回收", emptyRest.action === "remove");

check(
  "回收决策：leetcode.cn 基础权限跳过",
  (() => {
    const d = planHostPermissionCleanup("https://leetcode.cn/*", []);
    return d.action === "skip" && d.reason === "base-permission";
  })(),
);

check(
  "回收决策：pattern 为空跳过",
  (() => {
    const d = planHostPermissionCleanup(null, []);
    return d.action === "skip" && d.reason === "no-pattern";
  })(),
);

const pathDiff = planHostPermissionCleanup("https://h.example/*", [
  provider("d", "https://h.example/other/path"),
]);
check(
  "回收决策：同 host 不同路径仍算共用",
  pathDiff.action === "skip" && pathDiff.reason === "shared",
);

// ---- 已授予 pattern 反查（精确回收） ----

check("patternHost：标准 pattern", patternHost("https://api.example.com/*") === "api.example.com");
check(
  "patternHost：带端口",
  patternHost("https://api.example.com:8443/*") === "api.example.com:8443",
);
check("patternHost：origin 形式", patternHost("https://api.example.com/") === "api.example.com");
check("patternHost：通配主机返回 null", patternHost("https://*/*") === null);

const grantedExact = grantedPatternsForHost(
  ["https://a.example/*", "https://b.example/*"],
  "https://a.example/*",
);
check("反查：只命中目标主机", grantedExact.length === 1 && grantedExact[0] === "https://a.example/*");

const grantedForm = grantedPatternsForHost(
  ["https://a.example/"],
  "https://a.example/*",
);
check(
  "反查：不同表示形式（origin vs /*）也能命中",
  grantedForm.length === 1 && grantedForm[0] === "https://a.example/",
);

check(
  "反查：端口不同不算命中",
  grantedPatternsForHost(["https://a.example:8443/*"], "https://a.example/*").length === 0,
);
check(
  "反查：全站点通配不误删",
  grantedPatternsForHost(["https://*/*"], "https://a.example/*").length === 0,
);

// ---- 孤儿授权清理（04 §3.8.6 兜底） ----

check(
  "孤儿：无 Provider 使用则列出",
  (() => {
    const o = listOrphanGrantedHosts(
      ["https://orphan.example/*"],
      [provider("a", "https://used.example")],
    );
    return o.length === 1 && o[0] === "https://orphan.example/*";
  })(),
);
check(
  "孤儿：使用中不列出",
  listOrphanGrantedHosts(
    ["https://used.example/*"],
    [provider("a", "https://used.example/v1")],
  ).length === 0,
);
check(
  "孤儿：leetcode.cn 基础权限跳过",
  listOrphanGrantedHosts(["https://leetcode.cn/*", "https://leetcode.cn/problems/*"], [])
    .length === 0,
);
check(
  "孤儿：通配 pattern 跳过",
  listOrphanGrantedHosts(["https://*/*"], []).length === 0,
);
check(
  "孤儿：端口不同视为不同主机",
  (() => {
    const o = listOrphanGrantedHosts(
      ["https://a.example:8443/*"],
      [provider("a", "https://a.example")],
    );
    return o.length === 1;
  })(),
);

if (failures.length > 0) {
  console.error(`[test:ai] ${failures.length} 个用例失败：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[test:ai] OK：${pass} 个用例通过`);