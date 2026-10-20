// test:dsl —— 程序化作图契约的自动化用例（§9.1 的核心子集）。
// 通过 esbuild 打包后 node 运行，无需额外测试框架。
import { compileDiagram, DIAG, LIMITS } from "../src/panel/whiteboard/dsl";
import {
  anchorKey,
  newAnchorMap,
  registerAnchor,
} from "../src/panel/whiteboard/dsl/anchors";
import {
  estimateTextSize,
  sceneStorageBytes,
  WB_SCENE_SCHEMA_VERSION,
  type WBElement,
} from "../src/panel/whiteboard/model";

const style = { color: "default" as const, width: "medium" as const };
let pass = 0;
const failures: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) pass++;
  else failures.push(name);
}
function compile(input: unknown) {
  return compileDiagram(input, style);
}
function texts(els: WBElement[]) {
  return els
    .filter((e) => e.type === "text")
    .map((e) => {
      const s = estimateTextSize(e.text, e.size ?? 16);
      return { t: e.text, x: e.x, y: e.y, w: s.w, h: s.h };
    });
}
function overlaps(a: { x: number; y: number; w: number; h: number }[]): number {
  let n = 0;
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++) {
      const ox = Math.min(a[i].x + a[i].w, a[j].x + a[j].w) - Math.max(a[i].x, a[j].x);
      const oy = Math.min(a[i].y + a[i].h, a[j].y + a[j].h) - Math.max(a[i].y, a[j].y);
      if (ox > 1 && oy > 1) n++;
    }
  return n;
}
function ok(name: string, dsl: unknown): WBElement[] {
  const r = compile(dsl);
  check(`${name} ok`, r.status === "ok");
  return r.elements;
}
function err(name: string, dsl: unknown): void {
  check(`${name} error`, compile(dsl).status === "error");
}

// ---- 12 种结构正例 ----
ok("array", { dslVersion: 2, structures: [{ id: "a", kind: "array", items: [1, 2, 3], indexed: true }] });
ok("matrix", { dslVersion: 2, structures: [{ id: "m", kind: "matrix", rows: [[1, 2], [3, 4]], rowHeaders: ["r1", "r2"], colHeaders: ["c1", "c2"] }] });
ok("map", { dslVersion: 2, structures: [{ id: "h", kind: "map", entries: [{ key: "a", value: 1 }], header: true }] });
ok("linkedList", { dslVersion: 2, structures: [{ id: "l", kind: "linkedList", nodes: [{ values: [1, 2] }, { values: [3, 4] }], doubly: true, circular: true }] });
ok("stack", { dslVersion: 2, structures: [{ id: "s", kind: "stack", items: [1, 2, 3] }] });
ok("queue", { dslVersion: 2, structures: [{ id: "q", kind: "queue", items: [1, 2, 3], deque: true }] });
ok("bucket", { dslVersion: 2, structures: [{ id: "b", kind: "bucket", buckets: [[1], [2, 3]] }] });
ok("barChart", { dslVersion: 2, structures: [{ id: "bc", kind: "barChart", values: [0, 10, 5] }] });
ok("tree-binary", { dslVersion: 2, structures: [{ id: "t", kind: "tree", variant: "binary", root: { id: "r", value: 1, left: null, right: { id: "c", value: 2, left: null, right: null } } }] });
ok("tree-nary", { dslVersion: 2, structures: [{ id: "t2", kind: "tree", variant: "nary", root: { id: "r", value: 1, children: [{ id: "a", value: 2, children: [] }, { id: "b", value: 3, children: [] }] } }] });
ok("heap", { dslVersion: 2, structures: [{ id: "hp", kind: "heap", values: [5, 3, 8], showArray: true }] });
ok("graph", { dslVersion: 2, structures: [{ id: "g", kind: "graph", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }], directed: true }] });
ok("stateMachine", { dslVersion: 2, structures: [{ id: "sm", kind: "stateMachine", states: [{ id: "q0" }, { id: "q1" }], transitions: [{ from: "q0", to: "q1" }], initial: "q0", accepting: ["q1"] }] });

// ---- envelope / 版本 / 未知字段 / 裸结构 ----
err("v1", { dslVersion: 1, structures: [{ kind: "array", items: [] }] });
err("bare", { kind: "array", items: [] });
err("unknown-field", { dslVersion: 2, structures: [{ kind: "array", items: [], x: 1 }] });
err("structures-empty", { dslVersion: 2, structures: [] });
err("structures-too-many", { dslVersion: 2, structures: Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, kind: "array", items: [] })) });

// ---- 结构语义 ----
err("matrix-ragged", { dslVersion: 2, structures: [{ kind: "matrix", rows: [[1, 2], [3]] }] });
err("map-dup", { dslVersion: 2, structures: [{ kind: "map", entries: [{ key: 1, value: null }, { key: 1, value: null }] }] });
ok("map-null-placeholder", { dslVersion: 2, structures: [{ kind: "map", entries: [{ key: null, value: null }, { key: null, value: null }] }] });
err("linkedList-zero-values", { dslVersion: 2, structures: [{ kind: "linkedList", nodes: [{ values: [] }] }] });
err("linkedList-circular-single", { dslVersion: 2, structures: [{ kind: "linkedList", nodes: [{ values: [1] }], circular: true }] });
err("tree-mixed", { dslVersion: 2, structures: [{ kind: "tree", variant: "binary", root: { value: 1, children: [] } }] });
err("graph-parallel", { dslVersion: 2, structures: [{ kind: "graph", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "b" }], directed: true }] });
err("graph-undirected-reverse", { dslVersion: 2, structures: [{ kind: "graph", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] }] });
ok("graph-directed-reverse", { dslVersion: 2, structures: [{ kind: "graph", nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }], directed: true }] });
ok("graph-self-loop", { dslVersion: 2, structures: [{ kind: "graph", nodes: [{ id: "a" }], edges: [{ from: "a", to: "a" }], directed: true }] });
ok("sm-self-loop", { dslVersion: 2, structures: [{ kind: "stateMachine", states: [{ id: "q0" }], transitions: [{ from: "q0", to: "q0" }] }] });
ok("sm-reverse", { dslVersion: 2, structures: [{ kind: "stateMachine", states: [{ id: "q0" }, { id: "q1" }], transitions: [{ from: "q0", to: "q1" }, { from: "q1", to: "q0" }] }] });
err("sm-parallel", { dslVersion: 2, structures: [{ kind: "stateMachine", states: [{ id: "q0" }, { id: "q1" }], transitions: [{ from: "q0", to: "q1" }, { from: "q0", to: "q1" }] }] });

// ---- 标注 ----
const annotated = compile({
  dslVersion: 2,
  caption: "示例",
  structures: [{ id: "A", kind: "array", items: [1, 2, 3, 4], indexed: true }],
  annotations: [
    { kind: "window", from: { struct: "A", at: "cell", index: 0 }, to: { struct: "A", at: "cell", index: 3 }, color: "blue", label: "窗口" },
    { kind: "pointer", anchor: { struct: "A", at: "cell", index: 1 }, label: "i", color: "blue" },
    { kind: "pointer", anchor: { struct: "A", at: "cell", index: 1 }, label: "j", color: "orange" },
    { kind: "highlight", anchor: { struct: "A", at: "cell", index: 1 }, color: "green" },
    { kind: "note", anchor: { struct: "A", at: "cell", index: 1 }, text: "同指" },
  ],
});
check("annotated ok", annotated.status === "ok");
const t = texts(annotated.elements);
check("two pointers", t.filter((x) => x.t === "i" || x.t === "j").length === 2);
check("pointer lane no overlap", overlaps(t.filter((x) => x.t === "i" || x.t === "j")) === 0);
check("annotations no text overlap", overlaps(t) === 0);
check("window covers range", annotated.elements.some((e) => e.type === "rect" && e.w > 150));

const badPointer = compile({
  dslVersion: 2,
  structures: [{ id: "A", kind: "array", items: [1, 2] }],
  annotations: [{ kind: "pointer", anchor: { struct: "A", at: "cell", index: 99 }, label: "x" }],
});
check("invalid pointer partial", badPointer.status === "partial" && badPointer.droppedAnnotations === 1);
check("partial keeps body", badPointer.elements.length > 0);

const conflict = compile({
  dslVersion: 2,
  structures: [{ id: "A", kind: "array", items: [1] }],
  annotations: [
    { kind: "highlight", anchor: { struct: "A", at: "cell", index: 0 }, color: "red" },
    { kind: "highlight", anchor: { struct: "A", at: "cell", index: 0 }, color: "blue" },
  ],
});
check("highlight conflict partial", conflict.status === "partial" && conflict.droppedAnnotations === 1);

const dedup = compile({
  dslVersion: 2,
  structures: [{ id: "A", kind: "array", items: [1] }],
  annotations: [
    { kind: "pointer", anchor: { struct: "A", at: "cell", index: 0 }, label: "i" },
    { kind: "pointer", anchor: { struct: "A", at: "cell", index: 0 }, label: "i" },
  ],
});
check("dedup ok", dedup.status === "ok" && dedup.droppedAnnotations === 0);
check("dedup one pointer", texts(dedup.elements).filter((x) => x.t === "i").length === 1);
check(
  "dedup preserves source indices",
  dedup.status !== "error" && dedup.dedupedAnnotationIndices.join(",") === "1",
);

// 局部 note 非法 → partial（不降级图级），不是 error：
check(
  "note-local-invalid partial",
  compile({ dslVersion: 2, structures: [{ id: "A", kind: "array", items: [1] }], annotations: [{ kind: "note", anchor: { struct: "A", at: "cell", index: 9 }, text: "x" }] }).status === "partial",
);

// ---- 树左右语义 / 栈底 / heap 锚点 ----
const tree = compile({ dslVersion: 2, structures: [{ id: "T", kind: "tree", variant: "binary", root: { id: "r", value: 1, left: null, right: { id: "c", value: 2, left: null, right: null } } }] });
const er = tree.elements.find((e) => e.type === "ellipse" && e.label === "1");
const ec = tree.elements.find((e) => e.type === "ellipse" && e.label === "2");
check("binary right child to the right", !!er && !!ec && ec.x > er.x);

const stack = compile({ dslVersion: 2, structures: [{ kind: "stack", items: [10, 20, 30] }] });
const s10 = stack.elements.find((e) => e.type === "rect" && e.label === "10");
const s30 = stack.elements.find((e) => e.type === "rect" && e.label === "30");
check("stack item0 at bottom", !!s10 && !!s30 && s10.y > s30.y);

const heap = compile({ dslVersion: 2, structures: [{ id: "H", kind: "heap", values: [5, 3, 8], showArray: true }], annotations: [{ kind: "pointer", anchor: { struct: "H", at: "node", id: "h0" }, label: "root" }, { kind: "highlight", anchor: { struct: "H", at: "cell", index: 2 }, color: "orange" }] });
check("heap anchors ok", heap.status === "ok");

// ---- 空态 ----
const empty = compile({ dslVersion: 2, structures: [{ id: "E", kind: "array", items: [], name: "a" }] });
check("empty mark", empty.status === "ok" && texts(empty.elements).some((x) => x.t.includes("∅")));

// ---- 预算 ----
err("data-budget", { dslVersion: 2, structures: [{ kind: "array", items: Array.from({ length: 513 }, () => null) }] });
err("annotation-budget", {
  dslVersion: 2,
  structures: [{ id: "A", kind: "array", items: [1] }],
  annotations: Array.from({ length: 65 }, () => ({ kind: "note", text: "x" })),
});

// ---- v2 语义补齐：name / window label / bar labels / 状态机初态终态 ----
const named = compile({
  dslVersion: 2,
  structures: [{ id: "A", kind: "array", items: [1], name: "数组" }],
  annotations: [
    {
      kind: "window",
      from: { struct: "A", at: "cell", index: 0 },
      to: { struct: "A", at: "cell", index: 0 },
      label: "窗口",
    },
  ],
});
check("structure name rendered", texts(named.elements).some((x) => x.t === "数组"));
check("window label rendered", texts(named.elements).some((x) => x.t === "窗口"));

const bars = compile({
  dslVersion: 2,
  structures: [{ id: "B", kind: "barChart", values: [0, 10], labels: ["a", "b"] }],
});
check("bar labels rendered", texts(bars.elements).some((x) => x.t === "a") && texts(bars.elements).some((x) => x.t === "b"));

const machine = compile({
  dslVersion: 2,
  structures: [
    {
      id: "S",
      kind: "stateMachine",
      states: [{ id: "q0" }, { id: "q1" }],
      transitions: [{ from: "q0", to: "q1" }],
      initial: "q0",
      accepting: ["q1"],
    },
  ],
});
check("accepting ring rendered", machine.elements.filter((e) => e.type === "ellipse").length === 3);
check(
  "initial arrow rendered",
  machine.elements.filter((e) => e.type === "connector" && !e.connects).length === 1,
);

// ---- 锚点 key / 同一实体冲突 ----
check(
  "anchor key unambiguous",
  anchorKey({ struct: "a|node", at: "node", id: "x" }) !==
    anchorKey({ struct: "a", at: "node", id: "node|x" }),
);
let duplicateAnchorRejected = false;
try {
  const m = newAnchorMap();
  const geom = { box: { x: 0, y: 0, w: 1, h: 1 }, center: [0, 0] as [number, number] };
  registerAnchor(m, { struct: "a", at: "cell", index: 0 }, geom);
  registerAnchor(m, { struct: "a", at: "cell", index: 0 }, geom);
} catch {
  duplicateAnchorRejected = true;
}
check("duplicate anchor key rejected", duplicateAnchorRejected);

const llConflict = compile({
  dslVersion: 2,
  structures: [{ id: "L", kind: "linkedList", nodes: [{ id: "n0", values: [1] }] }],
  annotations: [
    { kind: "highlight", anchor: { struct: "L", at: "cell", index: 0 }, color: "red" },
    { kind: "highlight", anchor: { struct: "L", at: "node", id: "n0" }, color: "blue" },
  ],
});
check(
  "linkedList cell/node conflict partial",
  llConflict.status === "partial" && llConflict.droppedAnnotations === 1,
);
check(
  "conflict keeps original annotation index",
  llConflict.diagnostics.some(
    (d) => d.code === DIAG.ANNOTATION_CONFLICT && d.annotationIndex === 1,
  ),
);

const secondStructConflict = compile({
  dslVersion: 2,
  structures: [
    { id: "A", kind: "array", items: [1] },
    { id: "B", kind: "array", items: [2] },
  ],
  annotations: [
    { kind: "pointer", anchor: { struct: "A", at: "cell", index: 0 }, label: "i" },
    { kind: "pointer", anchor: { struct: "A", at: "cell", index: 0 }, label: "j" },
    { kind: "highlight", anchor: { struct: "B", at: "cell", index: 0 }, color: "red" },
    { kind: "highlight", anchor: { struct: "B", at: "cell", index: 0 }, color: "blue" },
  ],
});
check(
  "second structure conflict uses global annotation index",
  secondStructConflict.diagnostics.some(
    (d) => d.code === DIAG.ANNOTATION_CONFLICT && d.annotationIndex === 3,
  ),
);

// ---- 默认 ID 冲突 / 多叉树 null 子结点 / 诊断上限 ----
err("default-id-conflict", {
  dslVersion: 2,
  structures: [
    { id: "s1", kind: "array", items: [] },
    { kind: "array", items: [] },
  ],
});

const naryNull = compile({
  dslVersion: 2,
  structures: [
    {
      id: "T",
      kind: "tree",
      variant: "nary",
      root: { id: "r", value: 1, children: [null, { id: "a", value: 2, children: [] }] },
    },
  ],
});
check("nary null child ok", naryNull.status === "ok");
check(
  "nary null child not rendered as node",
  naryNull.elements.filter((e) => e.type === "ellipse").length === 2,
);

const manyWarnings = compile({
  dslVersion: 2,
  structures: [{ id: "A", kind: "array", items: [1] }],
  annotations: Array.from({ length: 64 }, (_, i) => ({
    kind: "pointer",
    anchor: { struct: "A", at: "cell", index: 0 },
    label: `p${i}`,
    color: "purple",
  })),
});
check("diagnostics capped", manyWarnings.diagnostics.length === LIMITS.diagnostics);
check(
  "diagnostics omission summary",
  manyWarnings.diagnostics.some((d) => d.code === DIAG.LIMIT_EXCEEDED && d.stage === "output"),
);

// ---- 严格 IR / 存储预算接线 ----
const duplicateIr = compileDiagram(
  { dslVersion: 2, structures: [{ kind: "array", items: [1, 2] }] },
  { genId: () => "dup" },
);
check(
  "duplicate IR id rejected",
  duplicateIr.status === "error" && duplicateIr.diagnostics.some((d) => d.code === DIAG.INVALID_IR),
);

const bigDiagram = compile({
  dslVersion: 2,
  structures: Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    kind: "array" as const,
    items: Array.from({ length: 42 }, () => null),
  })),
});
check("512 data units compile ok", bigDiagram.status === "ok");
const bigScene = {
  schemaVersion: WB_SCENE_SCHEMA_VERSION,
  elements: [],
  overlay: bigDiagram.elements,
  view: { scale: 1, offsetX: 0, offsetY: 0 },
};
check(
  "compiled IR fits 100KB scene budget",
  sceneStorageBytes(bigScene) <= LIMITS.storageBytes,
);

const crowded = compile({
  dslVersion: 2,
  structures: [{ id: "A", kind: "array", items: [1, 2] }],
  annotations: [
    { kind: "pointer", anchor: { struct: "A", at: "cell", index: 0 }, label: "leftleft" },
    { kind: "pointer", anchor: { struct: "A", at: "cell", index: 1 }, label: "rightright" },
  ],
});
check("layout overlap warning", crowded.diagnostics.some((d) => d.code === DIAG.LAYOUT_OVERLAP));
check("layout warning keeps ok", crowded.status === "ok" && crowded.droppedAnnotations === 0);

// ---- 输出 ----
if (failures.length) {
  console.error(`test:dsl FAILED (${failures.length}):\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
console.log(`test:dsl OK（${pass} checks）`);
