// 锚点表：布局层（builders）与标注层（annotations）之间的唯一接口。
// builder 登记"语义位置 → 几何"，标注按语义位置取几何；改布局只改 builder 内坐标，锚点 key 不变。
import type { WBBox } from "../model";
import type { DslAnchor } from "./schema";

export interface AnchorGeom {
  box: WBBox;
  center: [number, number];
  shape?: "rect" | "ellipse"; // 供 highlight 匹配形状（缺省按 rect）
}

export type AnchorMap = Map<string, AnchorGeom>;

export function newAnchorMap(): AnchorMap {
  return new Map();
}

export function anchorKey(a: DslAnchor): string {
  switch (a.at) {
    case "cell":
      return `${a.struct}|cell|${a.index}`;
    case "cell2":
      return `${a.struct}|cell2|${a.row}|${a.col}`;
    case "node":
      return `${a.struct}|node|${a.id}`;
    case "gap":
      return `${a.struct}|gap|${a.index}`;
  }
}

export function registerAnchor(
  map: AnchorMap,
  a: DslAnchor,
  geom: AnchorGeom,
): void {
  map.set(anchorKey(a), geom);
}
