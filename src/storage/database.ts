// IndexedDB 唯一入口（02-storage spec §3.1）：Dexie 封装。
// v1：画板所需最小骨架（sessions 表 + ProblemSession）；
// v2：04 §3.3 对话/代码快照表（结构见 02 §4，P4 会话持久化使用）。
import Dexie, { type EntityTable } from "dexie";

export const SESSION_SCHEMA_VERSION = 1;

export interface ProblemSession {
  schemaVersion: number; // 数据结构版本，惰性兼容读取（02 spec §3.2）
  problemId: string;
  title: string;
  url: string;

  code: string;
  language: string;

  timer: {
    recommended: number; // 分钟
    elapsed: number; // 秒
  };

  whiteboard: unknown; // WhiteboardScene（03 spec §4），画板模块自管序列化/校验
  aiMessages: unknown[]; // 04-ai-assistant 结构待定，先占位
  trace: unknown[]; // 06-trace 结构待定，先占位

  createdAt: string; // ISO 8601
  updatedAt: string;
}

/** 新题的默认空会话；非画板字段一律给惰性兼容默认值 */
export function createEmptySession(
  problemId: string,
  title = "",
  url = "",
): ProblemSession {
  const now = new Date().toISOString();
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    problemId,
    title,
    url,
    code: "",
    language: "",
    timer: { recommended: 0, elapsed: 0 },
    whiteboard: null,
    aiMessages: [],
    trace: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 一个题目下的一个对话（02 §4，字段与 04 §3.3 对齐；contextSnapshot 每对话只存一份） */
export interface Conversation {
  id: string;
  problemId: string;
  title: string; // 直接读网页：题号+题目+难度
  contextSnapshot: unknown; // 题目描述/约束快照（04 §3.3，去重载体）
  messages: unknown[]; // ConversationMessage[]，结构见 04 §4
  createdAt: string;
  updatedAt: string;
}

/** @code 代码附件快照（02 §4；消息内引用 id，同一份代码不重复存） */
export interface CodeSnapshot {
  id: string;
  problemId: string;
  language: string;
  code: string;
  createdAt: string;
}

const db = new Dexie("leetassist") as Dexie & {
  sessions: EntityTable<ProblemSession, "problemId">;
  conversations: EntityTable<Conversation, "id">;
  codeSnapshots: EntityTable<CodeSnapshot, "id">;
};

db.version(1).stores({
  sessions: "problemId, updatedAt",
});

// v2 只声明新增表（Dexie 版本链增量合并，旧表不受影响）
db.version(2).stores({
  conversations: "id, problemId, updatedAt",
  codeSnapshots: "id, problemId",
});

/** 读取会话：缺失字段用默认值兜底（惰性兼容，02 spec §3.2）；无记录返回 null */
export async function getSession(
  problemId: string,
): Promise<ProblemSession | null> {
  const raw = await db.sessions.get(problemId);
  if (!raw) return null;
  return { ...createEmptySession(problemId), ...raw };
}

/** 覆盖式写回整个会话（updatedAt 自动刷新） */
export async function putSession(session: ProblemSession): Promise<void> {
  await db.sessions.put({ ...session, updatedAt: new Date().toISOString() });
}

export { db };
