export function enhanceSearchQuery(query) {
  if (!query) return query;
  const synonyms = {
    창업: "창업 사업시작 사업개시",
    사업: "사업 창업 영업",
    지원: "지원 도움 혜택",
    자금: "자금 돈 자본",
    교육: "교육 훈련 학습",
    컨설팅: "컨설팅 상담 자문",
    마케팅: "마케팅 홍보 판촉",
    기술: "기술 기술력 기술개발",
    디지털: "디지털 온라인 인터넷",
    온라인: "온라인 인터넷 디지털",
  };
  let enhanced = query;
  for (const [k, v] of Object.entries(synonyms)) {
    if (query.includes(k)) {
      enhanced += " " + v;
      break;
    }
  }
  return enhanced;
}

export function splitTerms(q = "", max = 6) {
  return (q || "")
    .replace(/["'()*^]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max);
}
