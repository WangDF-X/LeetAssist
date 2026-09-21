// IndexedDB 唯一入口（02-storage spec §3.1）：Dexie 封装。
// 当前仅落地画板所需最小骨架（sessions 表 + ProblemSession）；
// conversations / codeSnapshots 表随 04-ai-assistant 后续版本链增加。
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

const db = new Dexie("leetassist") as Dexie & {
  sessions: EntityTable<ProblemSession, "problemId">;
};

db.version(1).stores({
  sessions: "problemId, updatedAt",
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
