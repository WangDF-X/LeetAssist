// TODO(spec 01 §3.1): 替换为「GraphQL 优先 + DOM 兜底 + Monaco 主世界读取」的完整实现。
// 骨架阶段只提供占位数据，保证面板 UI 可以先跑起来。
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

export function getProblemMetaStub(): ProblemMeta {
  const slug =
    location.pathname.match(/\/problems\/([^/]+)/)?.[1] ?? "unknown";
  const pageTitle = document.title.replace(/\s*[-|].*$/, "").trim();
  return {
    problemId: slug,
    title: pageTitle || slug,
    difficulty: "未知",
    tags: [],
    url: location.href,
    language: "",
    code: "",
    acceptanceRate: 0,
  };
}
