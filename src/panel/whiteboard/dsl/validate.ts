import type { DslAnnotation, DslStructure, LlmDiagram } from "./schema";

const KNOWN_KINDS = new Set<DslStructure["kind"]>([
  "array",
  "matrix",
  "map",
  "linkedList",
  "stack",
  "queue",
  "bucket",
  "barChart",
  "tree",
  "heap",
  "graph",
  "stateMachine",
]);

export interface NormalizeResult {
  diagram: LlmDiagram;
  dropped: number;
  warnings: string[];
}

/** 宽松归一化：丢弃非对象/未知 kind；为缺 id 的结构分配 s0/s1…；保留 annotations */
export function normalizeDiagram(input: unknown): NormalizeResult {
  const warnings: string[] = [];
  if (typeof input !== "object" || input === null)
    return { diagram: { structures: [] }, dropped: 0, warnings: ["输入不是对象"] };

  const raw = input as Record<string, unknown>;
  const rawStructures = Array.isArray(raw.structures)
    ? raw.structures
    : typeof raw.kind === "string"
      ? [raw] // 容忍直接传入单个结构
      : [];
  const structures: DslStructure[] = [];
  let dropped = 0;

  rawStructures.forEach((item, i) => {
    if (typeof item !== "object" || item === null) {
      dropped++;
      return;
    }
    const s = item as Record<string, unknown>;
    if (typeof s.kind !== "string" || !KNOWN_KINDS.has(s.kind as DslStructure["kind"])) {
      dropped++;
      return;
    }
    const id = typeof s.id === "string" && s.id.length > 0 ? s.id : `s${i}`;
    structures.push({ ...s, id } as DslStructure);
  });

  const annotations = Array.isArray(raw.annotations)
    ? (raw.annotations as DslAnnotation[])
    : undefined;

  return {
    diagram: {
      dslVersion: typeof raw.dslVersion === "number" ? raw.dslVersion : 1,
      caption: typeof raw.caption === "string" ? raw.caption : undefined,
      structures,
      annotations,
    },
    dropped,
    warnings,
  };
}
