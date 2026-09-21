// 题目信息获取（spec 01 §3.1 第一层：GraphQL 优先）。
// 教训（详见 record/problem-in-develop.md）：不要依赖 document.title / DOM 副作用——
// SPA 切题时 LeetCode 何时更新 DOM 取决于网络与框架内部实现（曾出现"慢一题"现象）。
// 改为按 slug 直接打 leetcode.cn 同源 GraphQL：数据源头，与 DOM 时序、网络快慢解耦。
// TODO(spec 01 §3.1)：代码内容/语言仍需 Monaco 主世界注入读取；DOM 兜底选择器未实现。

/** SPA 切题广播事件名（content/routeWatch.ts 派发，面板各模块监听） */
export const PROBLEM_CHANGED_EVENT = "leetassist:problem-changed";

export interface ProblemMeta {
  problemId: string;
  title: string;
  difficulty: "简单" | "中等" | "困难" | "未知";
  tags: string[];
  url: string;
  language: string;
  code: string;
  acceptanceRate: number;
}

const GRAPHQL_URL = "https://leetcode.cn/graphql/";

const QUESTION_QUERY = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    translatedTitle
    difficulty
    acRate
    topicTags { name translatedName }
  }
}`;

const DIFFICULTY_MAP: Record<string, ProblemMeta["difficulty"]> = {
  Easy: "简单",
  Medium: "中等",
  Hard: "困难",
};

interface QuestionData {
  questionFrontendId: string;
  title: string;
  translatedTitle: string | null;
  difficulty: string;
  acRate: number | null;
  topicTags: { name: string; translatedName: string | null }[] | null;
}

export function slugFromLocation(): string {
  return location.pathname.match(/\/problems\/([^/]+)/)?.[1] ?? "unknown";
}

/** 即时兜底：只凭 URL 即可构造（切题瞬间先显示 slug，GraphQL 返回后替换） */
export function fallbackMeta(slug: string): ProblemMeta {
  return {
    problemId: slug,
    title: slug,
    difficulty: "未知",
    tags: [],
    url: `${location.origin}/problems/${slug}/`,
    language: "",
    code: "",
    acceptanceRate: 0,
  };
}

export function getProblemMetaStub(): ProblemMeta {
  return fallbackMeta(slugFromLocation());
}

const cache = new Map<string, ProblemMeta>();

/**
 * 按 slug 从 leetcode.cn GraphQL 拉取题目信息（同源请求，无需额外权限）。
 * 成功返回完整 ProblemMeta 并缓存；失败返回 null（调用方保留兜底显示）。
 */
export async function fetchProblemMeta(
  slug: string,
): Promise<ProblemMeta | null> {
  const cached = cache.get(slug);
  if (cached) return cached;
  try {
    const resp = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "questionData",
        query: QUESTION_QUERY,
        variables: { titleSlug: slug },
      }),
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      data?: { question?: QuestionData | null };
    };
    const q = json.data?.question;
    if (!q) return null;
    const meta: ProblemMeta = {
      problemId: slug,
      title: `${q.questionFrontendId}. ${q.translatedTitle || q.title}`,
      difficulty: DIFFICULTY_MAP[q.difficulty] ?? "未知",
      tags: (q.topicTags ?? []).map((t) => t.translatedName || t.name),
      url: `${location.origin}/problems/${slug}/`,
      language: "",
      code: "",
      acceptanceRate: typeof q.acRate === "number" ? q.acRate / 100 : 0,
    };
    cache.set(slug, meta);
    return meta;
  } catch {
    return null;
  }
}
