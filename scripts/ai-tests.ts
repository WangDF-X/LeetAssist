// test:ai — 04 配置契约的纯逻辑用例（Base URL 规则、预置项、授权匹配串）。
// 通过 esbuild 打包后用 node 运行，与 dsl-tests 同一模式，无需额外测试框架。
import { checkBaseUrl, originPatternOf } from "../src/ai/baseUrl";
import { PROVIDER_PRESETS } from "../src/ai/presets";

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

if (failures.length > 0) {
  console.error(`[test:ai] ${failures.length} 个用例失败：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[test:ai] OK：${pass} 个用例通过`);