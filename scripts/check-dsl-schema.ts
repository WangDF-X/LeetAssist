// check:dsl —— 校验可执行 JSON Schema 与本地校验元数据一致（同一事实来源）。
import schema from "../src/panel/whiteboard/dsl/llm-diagram.schema.json";
import { DSL_VERSION } from "../src/panel/whiteboard/dsl/schema";
import { LIMITS } from "../src/panel/whiteboard/dsl/limits";
import {
  ANNOTATION_ALLOWED,
  COLORS,
  ENVELOPE_KEYS,
  KINDS,
  STRUCT_ALLOWED,
} from "../src/panel/whiteboard/dsl/schema-meta";

/* eslint-disable @typescript-eslint/no-explicit-any */
const s = schema as any;
let errors = 0;

function sameList(name: string, actual: string[] | undefined, expected: string[]): void {
  const a = [...(actual ?? [])].sort().join(",");
  const b = [...expected].sort().join(",");
  if (a !== b) {
    errors++;
    console.error(`[check:dsl] ${name}\n  schema: ${a}\n  meta:   ${b}`);
  }
}

function sameNumber(name: string, actual: unknown, expected: number): void {
  if (actual !== expected) {
    errors++;
    console.error(`[check:dsl] ${name}\n  schema: ${String(actual)}\n  meta:   ${expected}`);
  }
}

const STRUCT_REQUIRED: Record<string, string[]> = {
  array: ["kind", "items"],
  matrix: ["kind", "rows"],
  map: ["kind", "entries"],
  linkedList: ["kind", "nodes"],
  stack: ["kind", "items"],
  queue: ["kind", "items"],
  bucket: ["kind", "buckets"],
  barChart: ["kind", "values"],
  tree: ["kind", "variant", "root"],
  heap: ["kind", "values"],
  graph: ["kind", "nodes", "edges"],
  stateMachine: ["kind", "states", "transitions"],
};

const ANNOTATION_REQUIRED: Record<string, string[]> = {
  pointer: ["kind", "anchor", "label"],
  highlight: ["kind", "anchor"],
  window: ["kind", "from", "to"],
  note: ["kind", "text"],
};

sameList("envelope keys", Object.keys(s.properties), [...ENVELOPE_KEYS]);
if (s.properties.dslVersion.const !== DSL_VERSION) {
  errors++;
  console.error(`[check:dsl] dslVersion: schema=${s.properties.dslVersion.const} meta=${DSL_VERSION}`);
}

const structureBlocks: any[] = s.$defs.structure.oneOf;
sameList(
  "structure kinds",
  Array.from(new Set(structureBlocks.map((b) => b.properties.kind.const))),
  KINDS,
);
for (const block of structureBlocks) {
  const kind = block.properties.kind.const as string;
  sameList(
    `structure ${kind} fields`,
    Object.keys(block.properties),
    ["id", "name", "kind", ...(STRUCT_ALLOWED as Record<string, string[]>)[kind]],
  );
  sameList(`structure ${kind} required`, block.required ?? [], STRUCT_REQUIRED[kind] ?? []);
}

const annBlocks: any[] = s.$defs.annotation.oneOf;
sameList(
  "annotation kinds",
  Array.from(new Set(annBlocks.map((b) => b.properties.kind.const))),
  Object.keys(ANNOTATION_ALLOWED),
);
for (const block of annBlocks) {
  const kind = block.properties.kind.const as string;
  sameList(`annotation ${kind} fields`, Object.keys(block.properties), ANNOTATION_ALLOWED[kind]);
  sameList(`annotation ${kind} required`, block.required ?? [], ANNOTATION_REQUIRED[kind] ?? []);
}

// 数值上限与颜色枚举同源检查（diagram-contract §6）
sameList("color enum", s.$defs.color.enum, [...COLORS]);
sameNumber("structures.maxItems", s.properties.structures.maxItems, LIMITS.structures);
sameNumber("annotations.maxItems", s.properties.annotations.maxItems, LIMITS.annotations);
sameNumber("caption.maxLength", s.properties.caption.maxLength, LIMITS.textField);
sameNumber("id.maxLength", s.$defs.id.maxLength, LIMITS.textField);
sameNumber("value string.maxLength", s.$defs.value.oneOf[0].maxLength, LIMITS.textField);

const annBlock = (kind: string) =>
  annBlocks.find((b) => b.properties.kind.const === kind);
sameNumber(
  "pointer.label.maxLength",
  annBlock("pointer")?.properties.label.maxLength,
  LIMITS.pointerLabel,
);
sameNumber(
  "window.label.maxLength",
  annBlock("window")?.properties.label.maxLength,
  LIMITS.textField,
);
sameNumber("note.text.maxLength", annBlock("note")?.properties.text.maxLength, LIMITS.noteText);

const smBlock = structureBlocks.find((b) => b.properties.kind.const === "stateMachine");
sameNumber(
  "transition.label.maxLength",
  smBlock?.properties.transitions.items.properties.label.maxLength,
  LIMITS.textField,
);

// 嵌套必填字段与本地校验保持一致
sameList("binaryNode required", s.$defs.binaryNode.required, ["value"]);
sameList("naryNode required", s.$defs.naryNode.required, ["value"]);
const mapBlock = structureBlocks.find((b) => b.properties.kind.const === "map");
sameList("map entry required", mapBlock?.properties.entries.items.required, ["key", "value"]);
const graphBlock = structureBlocks.find((b) => b.properties.kind.const === "graph");
sameList("graph node required", graphBlock?.properties.nodes.items.required, ["id"]);
sameList("graph edge required", graphBlock?.properties.edges.items.required, ["from", "to"]);
sameList("stateMachine state required", smBlock?.properties.states.items.required, ["id"]);
sameList("stateMachine transition required", smBlock?.properties.transitions.items.required, ["from", "to"]);

if (errors > 0) {
  console.error(`\n[check:dsl] 发现 ${errors} 处不一致`);
  process.exit(1);
}
console.log("[check:dsl] OK：JSON Schema 与校验元数据一致");
