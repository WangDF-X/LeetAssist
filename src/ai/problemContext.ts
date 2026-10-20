// 04 §3.3 上下文快照：题目描述 / 约束抽取（P3 上下文组装消费，每对话只存一份）。
// 与 ProblemMeta 同源（leetcode.cn 同源 GraphQL，01 §3.1 数据源优先），只取
// translatedContent/content 的 HTML 做纯文本抽取；解析失败返回 null，不静默出错题。
// 注意：页面结构/文案若与假设出入，按 AGENTS.md 回改 01/04 spec（记录实测结果）。
import { GRAPHQL_URL } from "../panel/problemMeta";

export interface ProblemContextSnapshot {
  description: string;
  constraints: string;
}

const CONTENT_QUERY = `query questionContent($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    translatedContent
    content
  }
}`;

/** HTML → 纯文本：块级标签转换行、去标签后再解码实体（避免把代码里的 &lt; 当标签删除） */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|pre|div|li|h[1-6]|tr|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 从题面文本中切分「描述」与「约束」；无提示标记时约束为空、整段作为描述 */
export function splitProblemContent(html: string): ProblemContextSnapshot {
  const text = htmlToText(html);
  const marker = text.match(/(?:提示[：:]|Constraints[：:])/);
  if (!marker || marker.index == null) {
    return { description: text, constraints: "" };
  }
  return {
    description: text.slice(0, marker.index).trim(),
    constraints: text.slice(marker.index + marker[0].length).trim(),
  };
}

const cache = new Map<string, ProblemContextSnapshot>();

/** 按 slug 拉取上下文快照；成功缓存，失败返回 null（调用方保留已有内容） */
export async function fetchProblemContext(
  slug: string,
): Promise<ProblemContextSnapshot | null> {
  const cached = cache.get(slug);
  if (cached) return cached;
  try {
    const resp = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "questionContent",
        query: CONTENT_QUERY,
        variables: { titleSlug: slug },
      }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      data?: {
        question?: {
          translatedContent?: string | null;
          content?: string | null;
        } | null;
      };
    };
    const q = json.data?.question;
    if (!q) return null;
    const html = q.translatedContent || q.content || "";
    if (!html) return null;
    const snapshot = splitProblemContent(html);
    cache.set(slug, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}