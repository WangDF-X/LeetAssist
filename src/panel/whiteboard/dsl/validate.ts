// DSL v2 分区校验与归一化（diagram-contract.md §3–§4、§6）。
// 主体/envelope 错误 → 整图拒绝；单条标注非法 → 该条丢弃并记 warning。
import type {
  DslAnnotation,
  DslAnchor,
  DslBinaryNode,
  DslColor,
  DslNaryNode,
  DslStructure,
  DslStructureKind,
  DslValue,
  LlmDiagram,
} from "./schema";
import { DSL_VERSION } from "./schema";
import { LIMITS } from "./limits";
import { DIAG, type DiagramDiagnostic } from "./result";
import {
  ANNOTATION_ALLOWED,
  COLOR_SET,
  ENVELOPE_KEYS,
  KIND_SET,
  STRUCT_ALLOWED,
} from "./schema-meta";

// ---------- 基础判断 ----------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isNonNegInt(v: unknown): v is number {
  return isNum(v) && Number.isInteger(v) && v >= 0;
}
function cpLen(s: string): number {
  return [...s].length;
}
function isBlank(s: string): boolean {
  return s.trim() === "";
}
function isDslValue(v: unknown): v is DslValue {
  return v === null || typeof v === "string" || isNum(v);
}
function isColor(v: unknown): v is DslColor {
  return typeof v === "string" && COLOR_SET.has(v);
}

// ---------- 诊断 ----------

function push(
  diags: DiagramDiagnostic[],
  code: string,
  severity: "error" | "warning",
  stage: DiagramDiagnostic["stage"],
  path: string,
  message: string,
  annotationIndex?: number,
): void {
  diags.push({
    code,
    severity,
    stage,
    path,
    message,
    ...(annotationIndex !== undefined ? { annotationIndex } : {}),
  });
}

function errorCount(diags: DiagramDiagnostic[]): number {
  return diags.reduce((n, d) => n + (d.severity === "error" ? 1 : 0), 0);
}
function warningCount(diags: DiagramDiagnostic[]): number {
  return diags.reduce((n, d) => n + (d.severity === "warning" ? 1 : 0), 0);
}

// ---------- 能力表（供标注校验） ----------

export interface Capability {
  kind: DslStructureKind;
  canCell(index: number): boolean;
  canCell2(row: number, col: number): boolean;
  canNode(id: string): boolean;
  windowKind: "cell" | "cell2" | null;
}

function collectTreeIds(
  root: DslBinaryNode | DslNaryNode | null,
  variant: "binary" | "nary",
  out: Set<string>,
): void {
  if (!root) return;
  if (root.id) out.add(root.id);
  if (variant === "binary") {
    const b = root as DslBinaryNode;
    if (b.left) collectTreeIds(b.left, "binary", out);
    if (b.right) collectTreeIds(b.right, "binary", out);
  } else {
    for (const c of (root as DslNaryNode).children ?? []) collectTreeIds(c, "nary", out);
  }
}

export function capabilityOf(s: DslStructure): Capability {
  const no = () => false;
  switch (s.kind) {
    case "array":
      return { kind: s.kind, canCell: (i) => i < s.items.length, canCell2: no, canNode: no, windowKind: "cell" };
    case "matrix": {
      const cols = s.rows[0]?.length ?? 0;
      return {
        kind: s.kind,
        canCell: no,
        canCell2: (r, c) => r < s.rows.length && c < cols,
        canNode: no,
        windowKind: "cell2",
      };
    }
    case "map":
      return {
        kind: s.kind,
        canCell: no,
        canCell2: (r, c) => r < s.entries.length && (c === 0 || c === 1),
        canNode: no,
        windowKind: null,
      };
    case "linkedList": {
      const ids = new Set(s.nodes.map((n) => n.id).filter((x): x is string => !!x));
      return { kind: s.kind, canCell: (i) => i < s.nodes.length, canCell2: no, canNode: (id) => ids.has(id), windowKind: null };
    }
    case "stack":
    case "queue":
      return { kind: s.kind, canCell: (i) => i < s.items.length, canCell2: no, canNode: no, windowKind: null };
    case "bucket":
      return {
        kind: s.kind,
        canCell: no,
        canCell2: (row, col) => col < s.buckets.length && row < (s.buckets[col]?.length ?? 0),
        canNode: no,
        windowKind: null,
      };
    case "barChart":
      return { kind: s.kind, canCell: (i) => i < s.values.length, canCell2: no, canNode: no, windowKind: null };
    case "tree": {
      const ids = new Set<string>();
      collectTreeIds(s.root, s.variant, ids);
      return { kind: s.kind, canCell: no, canCell2: no, canNode: (id) => ids.has(id), windowKind: null };
    }
    case "heap": {
      const n = s.values.length;
      return {
        kind: s.kind,
        canCell: (i) => !!s.showArray && i < n,
        canCell2: no,
        canNode: (id) => /^h\d+$/.test(id) && Number(id.slice(1)) < n,
        windowKind: null,
      };
    }
    case "graph": {
      const ids = new Set(s.nodes.map((n) => n.id));
      return { kind: s.kind, canCell: no, canCell2: no, canNode: (id) => ids.has(id), windowKind: null };
    }
    case "stateMachine": {
      const ids = new Set(s.states.map((x) => x.id));
      return { kind: s.kind, canCell: no, canCell2: no, canNode: (id) => ids.has(id), windowKind: null };
    }
  }
}

// ---------- 通用字段校验 ----------

function checkKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  diags: DiagramDiagnostic[],
  severity: "error" | "warning" = "error",
  stage: DiagramDiagnostic["stage"] = "schema",
  annotationIndex?: number,
): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      push(diags, DIAG.UNKNOWN_FIELD, severity, stage, `${path}/${k}`, `未知字段 ${k}`, annotationIndex);
    }
  }
}

function checkBase(
  raw: Record<string, unknown>,
  path: string,
  diags: DiagramDiagnostic[],
): { id?: string; name?: string } {
  const out: { id?: string; name?: string } = {};
  if (raw.id !== undefined) {
    if (typeof raw.id !== "string" || isBlank(raw.id) || cpLen(raw.id) > LIMITS.textField) {
      push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/id`, "id 非法");
    } else out.id = raw.id;
  }
  if (raw.name !== undefined) {
    if (typeof raw.name !== "string" || cpLen(raw.name) > LIMITS.textField) {
      push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/name`, "name 非法");
    } else out.name = raw.name;
  }
  return out;
}

function checkValue(v: unknown, path: string, diags: DiagramDiagnostic[]): v is DslValue {
  if (!isDslValue(v)) {
    push(diags, DIAG.INVALID_FIELD, "error", "schema", path, "值必须为 string/有限 number/null");
    return false;
  }
  if (typeof v === "string" && cpLen(v) > LIMITS.textField) {
    push(diags, DIAG.LIMIT_EXCEEDED, "error", "schema", path, "文本超过 200 码点");
    return false;
  }
  return true;
}

function checkValueArray(v: unknown, path: string, diags: DiagramDiagnostic[]): v is DslValue[] {
  if (!Array.isArray(v)) {
    push(diags, DIAG.INVALID_FIELD, "error", "schema", path, "必须为数组");
    return false;
  }
  for (let i = 0; i < v.length; i++) checkValue(v[i], `${path}/${i}`, diags);
  return true;
}

// ---------- 树 ----------

function parseTree(
  root: unknown,
  variant: "binary" | "nary",
  path: string,
  diags: DiagramDiagnostic[],
  ids: Set<string>,
  depth: number,
): void {
  if (root === null) return;
  if (!isObj(root)) {
    push(diags, DIAG.INVALID_FIELD, "error", "schema", path, "root/节点必须为对象或 null");
    return;
  }
  if (depth > LIMITS.treeDepth) {
    push(diags, DIAG.LIMIT_EXCEEDED, "error", "schema", path, "树深度超过 16");
    return;
  }
  const allowed = new Set(
    variant === "binary" ? ["id", "value", "left", "right"] : ["id", "value", "children"],
  );
  checkKeys(root, allowed, path, diags);
  const base = checkBase(root, path, diags);
  if (base.id) {
    if (ids.has(base.id)) push(diags, DIAG.DUPLICATE_ID, "error", "semantic", `${path}/id`, "节点 id 重复");
    else ids.add(base.id);
  }
  if (!("value" in root)) push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/value`, "value 必填");
  else checkValue(root.value, `${path}/value`, diags);

  if (variant === "binary") {
    if ("children" in root) push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/children`, "binary 节点不得有 children");
    if (root.left !== undefined && root.left !== null) parseTree(root.left, "binary", `${path}/left`, diags, ids, depth + 1);
    if (root.right !== undefined && root.right !== null) parseTree(root.right, "binary", `${path}/right`, diags, ids, depth + 1);
    return;
  }
  if ("left" in root || "right" in root) push(diags, DIAG.INVALID_FIELD, "error", "schema", path, "nary 节点不得有 left/right");
  if (root.children !== undefined) {
    if (!Array.isArray(root.children)) {
      push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/children`, "children 必须为数组");
    } else {
      // v2：children 允许 null，表示缺位；null 不生成节点/边，也不是 value=null 的真实节点。
      root.children.forEach((c, i) => {
        if (c === null) return;
        parseTree(c, "nary", `${path}/children/${i}`, diags, ids, depth + 1);
      });
    }
  }
}

// ---------- 结构 ----------

function parseStructure(raw: unknown, index: number, diags: DiagramDiagnostic[]): DslStructure | null {
  const path = `/structures/${index}`;
  if (!isObj(raw)) {
    push(diags, DIAG.INVALID_FIELD, "error", "schema", path, "结构必须为对象");
    return null;
  }
  if (typeof raw.kind !== "string" || !KIND_SET.has(raw.kind)) {
    push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/kind`, "未知 kind");
    return null;
  }
  const kind = raw.kind as DslStructureKind;
  checkKeys(raw, new Set(["id", "name", "kind", ...STRUCT_ALLOWED[kind]]), path, diags);
  const base = checkBase(raw, path, diags);
  const before = errorCount(diags);
  const failed = () => errorCount(diags) > before;

  let s: DslStructure | null = null;
  switch (kind) {
    case "array": {
      checkValueArray(raw.items, `${path}/items`, diags);
      if (raw.indexed !== undefined && typeof raw.indexed !== "boolean")
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/indexed`, "indexed 必须为布尔");
      s = {
        ...base,
        kind,
        items: Array.isArray(raw.items) ? (raw.items as DslValue[]) : [],
        indexed: raw.indexed === true,
      };
      break;
    }
    case "matrix": {
      if (!Array.isArray(raw.rows) || !raw.rows.every(Array.isArray)) {
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/rows`, "rows 必须为二维数组");
        break;
      }
      const rows = raw.rows as unknown[][];
      const cols = rows[0]?.length ?? 0;
      rows.forEach((r, ri) => {
        if (r.length !== cols) push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/rows/${ri}`, "各行必须等长");
        r.forEach((v, ci) => checkValue(v, `${path}/rows/${ri}/${ci}`, diags));
      });
      if (rows.length > 0 && cols === 0)
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/rows`, "非空 rows 不允许零列");
      if (raw.rowHeaders !== undefined) {
        if (!Array.isArray(raw.rowHeaders) || raw.rowHeaders.length !== rows.length)
          push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/rowHeaders`, "行表头长度必须等于行数");
        else checkValueArray(raw.rowHeaders, `${path}/rowHeaders`, diags);
      }
      if (raw.colHeaders !== undefined) {
        if (!Array.isArray(raw.colHeaders) || raw.colHeaders.length !== cols)
          push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/colHeaders`, "列表头长度必须等于列数");
        else checkValueArray(raw.colHeaders, `${path}/colHeaders`, diags);
      }
      s = {
        ...base,
        kind,
        rows: rows as DslValue[][],
        ...(raw.rowHeaders !== undefined ? { rowHeaders: raw.rowHeaders as DslValue[] } : {}),
        ...(raw.colHeaders !== undefined ? { colHeaders: raw.colHeaders as DslValue[] } : {}),
      };
      break;
    }
    case "map": {
      if (!Array.isArray(raw.entries)) {
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/entries`, "entries 必须为数组");
        break;
      }
      const seen = new Set<string>();
      raw.entries.forEach((e, ei) => {
        const p = `${path}/entries/${ei}`;
        if (!isObj(e)) {
          push(diags, DIAG.INVALID_FIELD, "error", "schema", p, "entry 必须为对象");
          return;
        }
        checkKeys(e, new Set(["key", "value"]), p, diags);
        if (!("key" in e)) push(diags, DIAG.INVALID_FIELD, "error", "schema", `${p}/key`, "key 必填");
        else checkValue(e.key, `${p}/key`, diags);
        if (!("value" in e)) push(diags, DIAG.INVALID_FIELD, "error", "schema", `${p}/value`, "value 必填");
        else checkValue(e.value, `${p}/value`, diags);
        // 非 null 键禁止重复；null 视为"尚未填写的占位"（图元库空模板），允许多个
        if ("key" in e && isDslValue(e.key) && e.key !== null) {
          const k = `${typeof e.key}:${String(e.key)}`;
          if (seen.has(k)) push(diags, DIAG.INVALID_FIELD, "error", "semantic", `${p}/key`, "键重复");
          seen.add(k);
        }
      });
      if (raw.header !== undefined && typeof raw.header !== "boolean")
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/header`, "header 必须为布尔");
      s = {
        ...base,
        kind,
        entries: raw.entries as { key: DslValue; value: DslValue }[],
        header: raw.header === true,
      };
      break;
    }
    case "linkedList": {
      if (!Array.isArray(raw.nodes)) {
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/nodes`, "nodes 必须为数组");
        break;
      }
      const ids = new Set<string>();
      raw.nodes.forEach((nd, ni) => {
        const p = `${path}/nodes/${ni}`;
        if (!isObj(nd)) {
          push(diags, DIAG.INVALID_FIELD, "error", "schema", p, "结点必须为对象");
          return;
        }
        checkKeys(nd, new Set(["id", "values"]), p, diags);
        if (nd.id !== undefined) {
          if (typeof nd.id !== "string" || isBlank(nd.id) || cpLen(nd.id) > LIMITS.textField)
            push(diags, DIAG.INVALID_FIELD, "error", "schema", `${p}/id`, "node id 非法");
          else if (ids.has(nd.id)) push(diags, DIAG.DUPLICATE_ID, "error", "semantic", `${p}/id`, "node id 重复");
          else ids.add(nd.id);
        }
        if (!Array.isArray(nd.values)) {
          push(diags, DIAG.INVALID_FIELD, "error", "schema", `${p}/values`, "values 必填且为数组");
        } else {
          if (nd.values.length < 1 || nd.values.length > 4)
            push(diags, DIAG.INVALID_FIELD, "error", "schema", `${p}/values`, "每结点 values 必须 1–4 项");
          nd.values.forEach((v, vi) => checkValue(v, `${p}/values/${vi}`, diags));
        }
      });
      if (raw.doubly !== undefined && typeof raw.doubly !== "boolean")
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/doubly`, "doubly 必须为布尔");
      if (raw.circular !== undefined && typeof raw.circular !== "boolean")
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/circular`, "circular 必须为布尔");
      if (raw.circular === true && raw.nodes.length === 1)
        push(diags, DIAG.UNSUPPORTED_SEMANTICS, "error", "semantic", `${path}/circular`, "单节点环形链表不支持");
      s = {
        ...base,
        kind,
        nodes: raw.nodes as { id?: string; values: DslValue[] }[],
        doubly: raw.doubly === true,
        circular: raw.circular === true,
      };
      break;
    }
    case "stack":
    case "queue": {
      checkValueArray(raw.items, `${path}/items`, diags);
      if (kind === "queue" && raw.deque !== undefined && typeof raw.deque !== "boolean")
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/deque`, "deque 必须为布尔");
      s =
        kind === "queue"
          ? { ...base, kind, items: Array.isArray(raw.items) ? (raw.items as DslValue[]) : [], deque: raw.deque === true }
          : { ...base, kind, items: Array.isArray(raw.items) ? (raw.items as DslValue[]) : [] };
      break;
    }
    case "bucket": {
      if (!Array.isArray(raw.buckets) || !raw.buckets.every(Array.isArray)) {
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/buckets`, "buckets 必须为二维数组");
        break;
      }
      (raw.buckets as unknown[][]).forEach((b, bi) =>
        b.forEach((v, vi) => checkValue(v, `${path}/buckets/${bi}/${vi}`, diags)),
      );
      s = { ...base, kind, buckets: raw.buckets as DslValue[][] };
      break;
    }
    case "barChart": {
      if (!Array.isArray(raw.values) || !raw.values.every((v) => isNum(v) && v >= 0)) {
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/values`, "values 必须为非负有限数数组");
        break;
      }
      if (raw.labels !== undefined) {
        if (!Array.isArray(raw.labels) || raw.labels.length !== raw.values.length)
          push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/labels`, "labels 长度必须等于 values");
        else checkValueArray(raw.labels, `${path}/labels`, diags);
      }
      s = {
        ...base,
        kind,
        values: raw.values as number[],
        ...(raw.labels !== undefined ? { labels: raw.labels as DslValue[] } : {}),
      };
      break;
    }
    case "tree": {
      if (raw.variant !== "binary" && raw.variant !== "nary") {
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/variant`, "variant 必填 binary/nary");
        break;
      }
      const ids = new Set<string>();
      parseTree(raw.root, raw.variant, `${path}/root`, diags, ids, 1);
      s = { ...base, kind, variant: raw.variant, root: (raw.root ?? null) as never };
      break;
    }
    case "heap": {
      checkValueArray(raw.values, `${path}/values`, diags);
      if (raw.showArray !== undefined && typeof raw.showArray !== "boolean")
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/showArray`, "showArray 必须为布尔");
      s = {
        ...base,
        kind,
        values: Array.isArray(raw.values) ? (raw.values as DslValue[]) : [],
        showArray: raw.showArray === true,
      };
      break;
    }
    case "graph": {
      if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/nodes`, "nodes/edges 必须为数组");
        break;
      }
      const ids = new Set<string>();
      raw.nodes.forEach((nd, ni) => {
        const p = `${path}/nodes/${ni}`;
        if (!isObj(nd) || typeof nd.id !== "string" || isBlank(nd.id) || cpLen(nd.id) > LIMITS.textField) {
          push(diags, DIAG.INVALID_FIELD, "error", "schema", p, "node 必须有非空 id");
          return;
        }
        checkKeys(nd, new Set(["id", "label"]), p, diags);
        if (nd.label !== undefined) checkValue(nd.label, `${p}/label`, diags);
        if (ids.has(nd.id)) push(diags, DIAG.DUPLICATE_ID, "error", "semantic", `${p}/id`, "node id 重复");
        ids.add(nd.id);
      });
      const directed = raw.directed === true;
      const exact = new Set<string>();
      const undirected = new Set<string>();
      raw.edges.forEach((e, ei) => {
        const p = `${path}/edges/${ei}`;
        if (!isObj(e) || typeof e.from !== "string" || typeof e.to !== "string") {
          push(diags, DIAG.INVALID_FIELD, "error", "schema", p, "edge 必须有 from/to");
          return;
        }
        checkKeys(e, new Set(["from", "to", "label", "weight"]), p, diags);
        if (e.label !== undefined) checkValue(e.label, `${p}/label`, diags);
        if (e.weight !== undefined && !isNum(e.weight))
          push(diags, DIAG.INVALID_FIELD, "error", "schema", `${p}/weight`, "weight 必须为有限数");
        if (e.label !== undefined && e.label !== null && e.weight !== undefined) {
          // builder 会显示 "label · weight"；提前保证组合后的 IR label 不超过 200 码点。
          const composed = `${String(e.label)} · ${String(e.weight)}`;
          if (cpLen(composed) > LIMITS.textField)
            push(diags, DIAG.LIMIT_EXCEEDED, "error", "schema", `${p}/label`, "label 与 weight 组合后超过 200 码点");
        }
        if (!ids.has(e.from) || !ids.has(e.to))
          push(diags, DIAG.UNKNOWN_REFERENCE, "error", "semantic", p, "edge 端点不存在");
        // 允许自环与（有向）反向边；仅拒绝同方向重复。
        const exactKey = `${e.from}|${e.to}`;
        if (exact.has(exactKey)) push(diags, DIAG.UNSUPPORTED_SEMANTICS, "error", "semantic", p, "重复边（同方向）");
        exact.add(exactKey);
        if (!directed) {
          const key = [String(e.from), String(e.to)].sort().join("|");
          if (undirected.has(key)) push(diags, DIAG.UNSUPPORTED_SEMANTICS, "error", "semantic", p, "无向图重复边");
          undirected.add(key);
        }
      });
      if (raw.directed !== undefined && typeof raw.directed !== "boolean")
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/directed`, "directed 必须为布尔");
      s = {
        ...base,
        kind,
        nodes: raw.nodes as { id: string; label?: DslValue }[],
        edges: raw.edges as { from: string; to: string; label?: DslValue; weight?: number }[],
        directed: raw.directed === true,
      };
      break;
    }
    case "stateMachine": {
      if (!Array.isArray(raw.states) || !Array.isArray(raw.transitions)) {
        push(diags, DIAG.INVALID_FIELD, "error", "schema", `${path}/states`, "states/transitions 必须为数组");
        break;
      }
      const ids = new Set<string>();
      raw.states.forEach((st, si) => {
        const p = `${path}/states/${si}`;
        if (!isObj(st) || typeof st.id !== "string" || isBlank(st.id) || cpLen(st.id) > LIMITS.textField) {
          push(diags, DIAG.INVALID_FIELD, "error", "schema", p, "state 必须有非空 id");
          return;
        }
        checkKeys(st, new Set(["id", "label"]), p, diags);
        if (st.label !== undefined) checkValue(st.label, `${p}/label`, diags);
        if (ids.has(st.id)) push(diags, DIAG.DUPLICATE_ID, "error", "semantic", `${p}/id`, "state id 重复");
        ids.add(st.id);
      });
      const exact = new Set<string>();
      raw.transitions.forEach((tr, ti) => {
        const p = `${path}/transitions/${ti}`;
        if (!isObj(tr) || typeof tr.from !== "string" || typeof tr.to !== "string") {
          push(diags, DIAG.INVALID_FIELD, "error", "schema", p, "transition 必须有 from/to");
          return;
        }
        checkKeys(tr, new Set(["from", "to", "label"]), p, diags);
        if (tr.label !== undefined && (typeof tr.label !== "string" || cpLen(tr.label) > LIMITS.textField))
          push(diags, DIAG.INVALID_FIELD, "error", "schema", `${p}/label`, "label 必须为 ≤200 码点字符串");
        if (!ids.has(tr.from) || !ids.has(tr.to))
          push(diags, DIAG.UNKNOWN_REFERENCE, "error", "semantic", p, "transition 端点不存在");
        // 允许自环与反向转移；仅拒绝同方向重复。
        const exactKey = `${tr.from}|${tr.to}`;
        if (exact.has(exactKey)) push(diags, DIAG.UNSUPPORTED_SEMANTICS, "error", "semantic", p, "重复转移（同方向）");
        exact.add(exactKey);
      });
      if (raw.initial !== undefined) {
        if (typeof raw.initial !== "string" || !ids.has(raw.initial))
          push(diags, DIAG.UNKNOWN_REFERENCE, "error", "semantic", `${path}/initial`, "initial 引用不存在");
      }
      if (raw.accepting !== undefined) {
        if (!Array.isArray(raw.accepting) || raw.accepting.some((x) => typeof x !== "string" || !ids.has(x)))
          push(diags, DIAG.UNKNOWN_REFERENCE, "error", "semantic", `${path}/accepting`, "accepting 引用非法");
        else if (new Set(raw.accepting).size !== raw.accepting.length)
          push(diags, DIAG.INVALID_FIELD, "error", "semantic", `${path}/accepting`, "accepting 不得重复");
      }
      s = {
        ...base,
        kind,
        states: raw.states as { id: string; label?: DslValue }[],
        transitions: raw.transitions as { from: string; to: string; label?: string }[],
        ...(raw.initial !== undefined ? { initial: raw.initial as string } : {}),
        ...(raw.accepting !== undefined ? { accepting: raw.accepting as string[] } : {}),
      };
      break;
    }
  }

  if (failed() || !s) return null;
  return s;
}

// ---------- 计数 ----------

function countTreeNodes(root: DslBinaryNode | DslNaryNode | null, variant: "binary" | "nary"): number {
  if (!root) return 0;
  if (variant === "binary") {
    const b = root as DslBinaryNode;
    return 1 + countTreeNodes(b.left ?? null, "binary") + countTreeNodes(b.right ?? null, "binary");
  }
  const n = root as DslNaryNode;
  return 1 + (n.children ?? []).reduce((a, c) => a + countTreeNodes(c, "nary"), 0);
}

function countUnits(s: DslStructure): { units: number; edges: number } {
  switch (s.kind) {
    case "array":
    case "stack":
    case "queue":
      return { units: s.items.length, edges: 0 };
    case "heap":
    case "barChart":
      return { units: s.values.length, edges: 0 };
    case "matrix":
      return { units: s.rows.length * (s.rows[0]?.length ?? 0), edges: 0 };
    case "map":
      return { units: s.entries.length * 2, edges: 0 };
    case "linkedList":
      // 512 显式边预算只统计 graph/stateMachine；链表隐式边计入最终 IR 预算。
      return {
        units: s.nodes.reduce((a, n) => a + 1 + n.values.length, 0),
        edges: 0,
      };
    case "bucket":
      return { units: s.buckets.length + s.buckets.reduce((a, b) => a + b.length, 0), edges: 0 };
    case "tree": {
      const n = countTreeNodes(s.root, s.variant);
      return { units: n, edges: 0 };
    }
    case "graph":
      return { units: s.nodes.length, edges: s.edges.length };
    case "stateMachine":
      return { units: s.states.length, edges: s.transitions.length };
  }
}

// ---------- 标注 ----------

type ValidAnchor = DslAnchor & { _wk: "cell" | "cell2" | "node" };

function validateAnchor(
  raw: unknown,
  caps: Map<string, Capability>,
  path: string,
  diags: DiagramDiagnostic[],
  annotationIndex: number,
): ValidAnchor | null {
  if (!isObj(raw)) {
    push(diags, DIAG.INVALID_ANCHOR, "warning", "annotation", path, "anchor 必须为对象", annotationIndex);
    return null;
  }
  if (typeof raw.struct !== "string" || !caps.has(raw.struct)) {
    push(diags, DIAG.UNKNOWN_REFERENCE, "warning", "annotation", `${path}/struct`, "引用的结构不存在", annotationIndex);
    return null;
  }
  const cap = caps.get(raw.struct)!;
  if (raw.at === "cell") {
    checkKeys(raw, new Set(["struct", "at", "index"]), path, diags, "warning", "annotation", annotationIndex);
    if (!isNonNegInt(raw.index)) {
      push(diags, DIAG.INVALID_ANCHOR, "warning", "annotation", `${path}/index`, "index 必须为非负整数", annotationIndex);
      return null;
    }
    if (!cap.canCell(raw.index)) {
      push(diags, DIAG.INDEX_OUT_OF_RANGE, "warning", "annotation", path, "cell index 越界或不支持", annotationIndex);
      return null;
    }
    return { struct: raw.struct, at: "cell", index: raw.index, _wk: "cell" };
  }
  if (raw.at === "cell2") {
    checkKeys(raw, new Set(["struct", "at", "row", "col"]), path, diags, "warning", "annotation", annotationIndex);
    if (!isNonNegInt(raw.row) || !isNonNegInt(raw.col)) {
      push(diags, DIAG.INVALID_ANCHOR, "warning", "annotation", path, "row/col 必须为非负整数", annotationIndex);
      return null;
    }
    if (!cap.canCell2(raw.row, raw.col)) {
      push(diags, DIAG.INDEX_OUT_OF_RANGE, "warning", "annotation", path, "cell2 越界或不支持", annotationIndex);
      return null;
    }
    return { struct: raw.struct, at: "cell2", row: raw.row, col: raw.col, _wk: "cell2" };
  }
  if (raw.at === "node") {
    checkKeys(raw, new Set(["struct", "at", "id"]), path, diags, "warning", "annotation", annotationIndex);
    if (typeof raw.id !== "string" || isBlank(raw.id)) {
      push(diags, DIAG.INVALID_ANCHOR, "warning", "annotation", `${path}/id`, "node id 非法", annotationIndex);
      return null;
    }
    if (!cap.canNode(raw.id)) {
      push(diags, DIAG.INDEX_OUT_OF_RANGE, "warning", "annotation", path, "node id 不存在或不支持", annotationIndex);
      return null;
    }
    return { struct: raw.struct, at: "node", id: raw.id, _wk: "node" };
  }
  push(diags, DIAG.INVALID_ANCHOR, "warning", "annotation", `${path}/at`, "未知锚点类型", annotationIndex);
  return null;
}

function validateAnnotation(
  raw: unknown,
  index: number,
  caps: Map<string, Capability>,
  diags: DiagramDiagnostic[],
): DslAnnotation | null {
  const path = `/annotations/${index}`;
  const before = warningCount(diags);
  const dropped = () => warningCount(diags) > before;
  const warn = (code: string, p: string, msg: string) =>
    push(diags, code, "warning", "annotation", p, msg, index);

  if (!isObj(raw) || typeof raw.kind !== "string" || !ANNOTATION_ALLOWED[raw.kind]) {
    warn(DIAG.INVALID_ANCHOR, path, "未知或缺少 kind");
    return null;
  }
  const kind = raw.kind as DslAnnotation["kind"];
  checkKeys(raw, new Set(ANNOTATION_ALLOWED[kind]), path, diags, "warning", "annotation", index);
  if (raw.color !== undefined && !isColor(raw.color)) warn(DIAG.INVALID_FIELD, `${path}/color`, "color 非法");

  if (kind === "pointer" || kind === "highlight") {
    const anchor = validateAnchor(raw.anchor, caps, `${path}/anchor`, diags, index);
    if (!anchor) return null;
    if (dropped()) return null;
    if (kind === "highlight")
      return { kind, anchor, ...(isColor(raw.color) ? { color: raw.color } : {}) };
    if (
      typeof raw.label !== "string" ||
      isBlank(raw.label) ||
      raw.label.includes("\n") ||
      raw.label.includes("\r") ||
      cpLen(raw.label) > LIMITS.pointerLabel
    ) {
      warn(DIAG.INVALID_FIELD, `${path}/label`, "pointer.label 非法（≤32 码点、单行、非空）");
      return null;
    }
    return {
      kind,
      anchor,
      label: raw.label,
      ...(isColor(raw.color) ? { color: raw.color } : {}),
    };
  }

  if (kind === "window") {
    const a = validateAnchor(raw.from, caps, `${path}/from`, diags, index);
    const b = validateAnchor(raw.to, caps, `${path}/to`, diags, index);
    if (!a || !b) return null;
    if (a.struct !== b.struct || a.at !== b.at) {
      warn(DIAG.UNSUPPORTED_SEMANTICS, path, "window 两端必须同结构同锚点类型");
      return null;
    }
    if (caps.get(a.struct)!.windowKind === null) {
      warn(DIAG.UNSUPPORTED_SEMANTICS, path, "该结构不支持 window");
      return null;
    }
    if (a.at === "cell" && b.at === "cell" && a.index > b.index)
      warn(DIAG.INDEX_OUT_OF_RANGE, path, "window 范围反向");
    if (a.at === "cell2" && b.at === "cell2" && (a.row > b.row || a.col > b.col))
      warn(DIAG.INDEX_OUT_OF_RANGE, path, "window 范围反向");
    if (raw.label !== undefined) {
      if (typeof raw.label !== "string" || isBlank(raw.label) || cpLen(raw.label) > LIMITS.textField)
        warn(DIAG.INVALID_FIELD, `${path}/label`, "window.label 非法");
    }
    if (dropped()) return null;
    return {
      kind,
      from: a,
      to: b,
      ...(typeof raw.label === "string" ? { label: raw.label } : {}),
      ...(isColor(raw.color) ? { color: raw.color } : {}),
    };
  }

  if (typeof raw.text !== "string" || isBlank(raw.text) || cpLen(raw.text) > LIMITS.noteText) {
    warn(DIAG.INVALID_FIELD, `${path}/text`, "note.text 非法（≤500 码点、非空）");
    return null;
  }
  let anchor: DslAnchor | undefined;
  if (raw.anchor !== undefined) {
    const a = validateAnchor(raw.anchor, caps, `${path}/anchor`, diags, index);
    if (!a) return null;
    anchor = a;
  }
  if (dropped()) return null;
  return {
    kind,
    ...(anchor ? { anchor } : {}),
    text: raw.text,
    ...(isColor(raw.color) ? { color: raw.color } : {}),
  };
}

// ---------- 入口 ----------

/** 校验后的标注 + 原始 annotations 索引（诊断/07 回传必须使用原索引）。 */
export interface IndexedAnnotation {
  value: DslAnnotation;
  index: number;
}

export interface ValidateSuccess {
  ok: true;
  diagram: LlmDiagram;
  validAnnotations: IndexedAnnotation[];
  droppedAnnotations: number;
  diagnostics: DiagramDiagnostic[];
}
export interface ValidateFailure {
  ok: false;
  diagnostics: DiagramDiagnostic[];
}
export type ValidateOutcome = ValidateSuccess | ValidateFailure;

function jsonDepth(v: unknown, depth = 1): number {
  if (depth > LIMITS.jsonDepth + 1) return depth;
  if (Array.isArray(v)) {
    let m = depth;
    for (const x of v) m = Math.max(m, jsonDepth(x, depth + 1));
    return m;
  }
  if (isObj(v)) {
    let m = depth;
    for (const k of Object.keys(v)) m = Math.max(m, jsonDepth(v[k], depth + 1));
    return m;
  }
  return depth;
}

export function validateDiagram(input: unknown): ValidateOutcome {
  const diags: DiagramDiagnostic[] = [];
  const fail = (): ValidateFailure => ({ ok: false, diagnostics: diags });

  if (!isObj(input)) {
    push(diags, DIAG.INVALID_ENVELOPE, "error", "schema", "", "输入必须为对象");
    return fail();
  }
  checkKeys(input, ENVELOPE_KEYS, "", diags);
  if (input.dslVersion !== DSL_VERSION) {
    push(diags, DIAG.UNSUPPORTED_VERSION, "error", "schema", "/dslVersion", `dslVersion 必须为 ${DSL_VERSION}`);
    return fail();
  }
  if (!Array.isArray(input.structures)) {
    push(diags, DIAG.INVALID_ENVELOPE, "error", "schema", "/structures", "structures 必须为数组");
    return fail();
  }
  if (input.structures.length < 1 || input.structures.length > LIMITS.structures) {
    push(diags, DIAG.LIMIT_EXCEEDED, "error", "schema", "/structures", `structures 数量须 1–${LIMITS.structures}`);
    return fail();
  }
  if (input.caption !== undefined) {
    if (typeof input.caption !== "string" || cpLen(input.caption) > LIMITS.textField)
      push(diags, DIAG.INVALID_FIELD, "error", "schema", "/caption", "caption 非法");
  }
  if (input.annotations !== undefined && !Array.isArray(input.annotations)) {
    push(diags, DIAG.INVALID_ENVELOPE, "error", "schema", "/annotations", "annotations 必须为数组");
    return fail();
  }
  const anns: unknown[] = Array.isArray(input.annotations) ? input.annotations : [];
  if (anns.length > LIMITS.annotations)
    push(diags, DIAG.LIMIT_EXCEEDED, "error", "schema", "/annotations", `annotations 不得超过 ${LIMITS.annotations}`);

  try {
    const str = JSON.stringify(input);
    if (new TextEncoder().encode(str).length > LIMITS.payloadBytes)
      push(diags, DIAG.LIMIT_EXCEEDED, "error", "schema", "", "载荷超过 128 KiB");
  } catch {
    push(diags, DIAG.INVALID_ENVELOPE, "error", "schema", "", "载荷不可序列化（含环引用）");
  }
  if (jsonDepth(input) > LIMITS.jsonDepth)
    push(diags, DIAG.LIMIT_EXCEEDED, "error", "schema", "", "JSON 嵌套深度超过 64");

  const parsed: DslStructure[] = [];
  input.structures.forEach((raw, i) => {
    const s = parseStructure(raw, i, diags);
    if (s) parsed.push(s);
  });
  if (errorCount(diags) > 0) return fail();

  // 结构 id：显式唯一；缺省 s0/s1… 且与显式冲突则拒绝
  const used = new Set<string>();
  parsed.forEach((s, i) => {
    if (!s.id) return;
    if (used.has(s.id)) push(diags, DIAG.DUPLICATE_ID, "error", "semantic", `/structures/${i}/id`, "结构 id 重复");
    used.add(s.id);
  });
  const resolved = parsed.map((s, i) => {
    if (s.id) return s;
    const candidate = `s${i}`;
    if (used.has(candidate)) {
      // contract §3.4：缺省 ID 与显式 ID 冲突时拒绝整图，不自动改名。
      push(diags, DIAG.DUPLICATE_ID, "error", "semantic", `/structures/${i}/id`, "缺省结构 ID 与显式 ID 冲突");
      return s;
    }
    used.add(candidate);
    return { ...s, id: candidate } as DslStructure;
  });
  if (errorCount(diags) > 0) return fail();

  let units = 0;
  let edges = 0;
  resolved.forEach((s, i) => {
    const c = countUnits(s);
    units += c.units;
    edges += c.edges;
    if (c.units > LIMITS.dataUnits)
      push(diags, DIAG.LIMIT_EXCEEDED, "error", "semantic", `/structures/${i}`, "结构数据量超预算");
  });
  if (units > LIMITS.dataUnits)
    push(diags, DIAG.LIMIT_EXCEEDED, "error", "semantic", "/structures", "累计数据量超过 512");
  if (edges > LIMITS.edges)
    push(diags, DIAG.LIMIT_EXCEEDED, "error", "semantic", "/structures", "累计边数超过 512");
  if (errorCount(diags) > 0) return fail();

  const caps = new Map<string, Capability>();
  for (const s of resolved) caps.set(s.id!, capabilityOf(s));

  const validAnnotations: IndexedAnnotation[] = [];
  let droppedAnnotations = 0;
  anns.forEach((raw, i) => {
    const a = validateAnnotation(raw, i, caps, diags);
    if (a) validAnnotations.push({ value: a, index: i });
    else droppedAnnotations++;
  });
  if (errorCount(diags) > 0) return fail();

  const diagram: LlmDiagram = {
    dslVersion: DSL_VERSION,
    ...(input.caption !== undefined ? { caption: input.caption as string } : {}),
    structures: resolved,
    annotations: validAnnotations.map((a) => a.value),
  };

  return {
    ok: true,
    diagram,
    validAnnotations,
    droppedAnnotations,
    diagnostics: diags,
  };
}
