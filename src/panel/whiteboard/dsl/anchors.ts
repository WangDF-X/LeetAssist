// 锚点表：布局层（builders）与标注层（annotations）之间的唯一接口。
// builder 登记"语义位置 → 几何"，标注按语义位置取几何；改布局只改 builder 内坐标，锚点 key 不变。
import type { WBBox } from "../model";
import type { DslAnchor } from "./schema";

export interface AnchorGeom {
  box: WBBox;
  center: [number, number];
  shape?: "rect" | "ellipse"; // 供 highlight 匹配形状（缺省按 rect）
  /** 语义实体身份；同一实体的多个锚点（如链表 cell 与 node）共享此 key。 */
  entityKey?: string;
}

export type AnchorMap = Map<string, AnchorGeom>;

export function newAnchorMap(): AnchorMap {
  return new Map();
}

/**
 * 锚点 key：用 JSON 元组编码，避免手写分隔符在 id 含分隔符时产生歧义。
 * 契约 §4.1 要求 key 无歧义编码字段元组。
 */
export function anchorKey(a: DslAnchor): string {
  switch (a.at) {
    case "cell":
      return JSON.stringify([a.struct, "cell", a.index]);
    case "cell2":
      return JSON.stringify([a.struct, "cell2", a.row, a.col]);
    case "node":
      return JSON.stringify([a.struct, "node", a.id]);
  }
}

/** 语义实体 key（用于同实体冲突/去重），同样使用无歧义 JSON 编码。 */
export function entityKey(structId: string, kind: string, ...parts: (string | number)[]): string {
  return JSON.stringify([structId, kind, ...parts]);
}

export function registerAnchor(
  map: AnchorMap,
  a: DslAnchor,
  geom: AnchorGeom,
): void {
  const key = anchorKey(a);
  if (map.has(key)) {
    // 契约 §4.1：重复 key 是内部错误，禁止静默覆盖。
    throw new Error(`duplicate anchor key: ${key}`);
  }
  map.set(key, geom);
}
