// 撤销/重做栈（plan/03 §5.2）：快照式，上限 50 步。
// 快照 = 绘制层 elements 数组的不可变引用（元素对象永不就地修改，
// 每次编辑产生新数组），因此快照极廉价，只是数组引用。
import type { WBElement } from "./model";

const MAX_HISTORY = 50;

export class HistoryStack {
  private undoStack: WBElement[][] = [];
  private redoStack: WBElement[][] = [];

  /** 每次"提交型"编辑（落笔/删除/变换/清空）前调用，记录当前状态 */
  push(snapshot: WBElement[]): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = []; // 新编辑清空重做栈
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 传入当前状态，返回要恢复到的上一个状态；无则 null */
  undo(current: WBElement[]): WBElement[] | null {
    const prev = this.undoStack.pop();
    if (prev === undefined) return null;
    this.redoStack.push(current);
    return prev;
  }

  redo(current: WBElement[]): WBElement[] | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(current);
    return next;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
