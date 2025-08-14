// enrichResults.js
import { buildReason } from "./reason.js";

export function indexById(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.id, r);
  return map;
}

export function mergeLlmWithDb({ llmResults = [], dbIndex, userContext }) {
  const merged = [];
  for (const r of llmResults) {
    const row = dbIndex.get(r.id);
    if (!row) continue;
    const reason =
      r.reason && !/기본 필터 일치/.test(r.reason) // LLM이 쓸만한 사유면 사용
        ? r.reason
        : buildReason({ userContext, row }); // 아니면 사람이 읽기 쉬운 사유 생성
    merged.push({
      ...row, // ✅ DB의 모든 칼럼 유지 (url 포함)
      score: typeof r.score === "number" ? r.score : null,
      matchedConditions: Array.isArray(r.matchedConditions)
        ? r.matchedConditions
        : [],
      reason,
    });
  }
  return merged;
}

// 부족하면 recallRows/최신순으로 채워 topK 보장 (DB 원행을 그대로 사용)
export function fillUpToTopK({
  current = [],
  recallRows = [],
  latestRows = [],
  topK = 3,
  userContext,
}) {
  const have = new Set(current.map((x) => x.id));
  const pushFrom = (arr) => {
    for (const row of arr) {
      if (current.length >= topK) break;
      if (have.has(row.id)) continue;
      current.push({
        ...row, // ✅ 전체 필드 유지
        score: current.length
          ? (current[current.length - 1].score ?? 5) - 0.1
          : 5,
        matchedConditions: [],
        reason: buildReason({ userContext, row }), // ✅ 자연어 사유
      });
      have.add(row.id);
    }
  };
  if (current.length < topK) pushFrom(recallRows);
  if (current.length < topK) pushFrom(latestRows);
  return current.slice(0, topK);
}
