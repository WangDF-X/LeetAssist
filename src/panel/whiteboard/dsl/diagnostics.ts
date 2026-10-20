// 诊断统一排序与截断（diagram-contract.md §5.2、§6）。
// 排序：阶段 → JSON Pointer → 错误码；保留输入顺序作为稳定 tie-breaker。
import { LIMITS } from "./limits";
import { DIAG, type DiagramDiagnostic, type DiagnosticStage } from "./result";

const STAGE_ORDER: Record<DiagnosticStage, number> = {
  schema: 0,
  semantic: 1,
  normalize: 2,
  layout: 3,
  annotation: 4,
  output: 5,
};

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/** 按文档要求稳定排序；不修改输入。 */
export function sortDiagnostics(diags: readonly DiagramDiagnostic[]): DiagramDiagnostic[] {
  return diags
    .map((diagnostic, index) => ({ diagnostic, index }))
    .sort((a, b) => {
      const stage = STAGE_ORDER[a.diagnostic.stage] - STAGE_ORDER[b.diagnostic.stage];
      if (stage !== 0) return stage;
      const path = cmp(a.diagnostic.path, b.diagnostic.path);
      if (path !== 0) return path;
      const code = cmp(a.diagnostic.code, b.diagnostic.code);
      if (code !== 0) return code;
      return a.index - b.index;
    })
    .map((x) => x.diagnostic);
}

/**
 * 排序 + 按集中上限截断。
 * 截断时优先保留 error（至少一条），再按稳定顺序保留 warning；被省略条数写入摘要。
 */
export function finalizeDiagnostics(diags: readonly DiagramDiagnostic[]): DiagramDiagnostic[] {
  // 允许在 validate 与 engine 各调用一次：先移除上一轮生成的省略摘要，避免重复。
  const input = diags.filter(
    (d) =>
      !(
        d.code === DIAG.LIMIT_EXCEEDED &&
        d.stage === "output" &&
        d.path === "" &&
        d.message.startsWith("诊断过多")
      ),
  );
  const sorted = sortDiagnostics(input);
  if (sorted.length <= LIMITS.diagnostics) return sorted;

  const budget = LIMITS.diagnostics - 1;
  const errors = sorted.filter((d) => d.severity === "error");
  const warnings = sorted.filter((d) => d.severity === "warning");
  const keep = new Set<DiagramDiagnostic>();
  for (const d of errors.slice(0, budget)) keep.add(d);
  for (const d of warnings.slice(0, Math.max(0, budget - keep.size))) keep.add(d);

  const kept = sorted.filter((d) => keep.has(d));
  const omitted = sorted.length - kept.length;
  kept.push({
    code: DIAG.LIMIT_EXCEEDED,
    severity: "warning",
    stage: "output",
    path: "",
    message: `诊断过多，已省略其余 ${omitted} 条`,
  });
  return kept;
}
