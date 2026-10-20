// 程序化作图的集中资源预算（diagram-contract.md §6）。
// 修改阈值须同步文档并验证 Chrome/Edge，不在各处散落写死。
export const LIMITS = {
  payloadBytes: 128 * 1024, // 单份 DSL JSON（UTF-8）
  storageBytes: 100 * 1024, // 单题全部画板内容（elements + overlay）lz-string 压缩后软目标
  structures: 12,
  annotations: 64,
  dataUnits: 512, // 累计数据项/节点/格子
  edges: 512, // graph edges + stateMachine transitions 累计
  treeDepth: 16, // 根为第 1 层
  jsonDepth: 64, // JSON 对象/数组嵌套深度
  irElements: 4096, // 最终 IR 元素数
  diagnostics: 50, // 诊断条数上限
  textField: 200, // 值/label/name/caption/window.label/ID：Unicode 码点
  pointerLabel: 32,
  noteText: 500,
  coord: 100000,
  size: 100000,
  fontMin: 8,
  fontMax: 72,
} as const;
