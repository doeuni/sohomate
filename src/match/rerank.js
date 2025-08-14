import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function reRankWithReasons({ userContext, items, topK = 3 }) {
  if (!userContext) throw new Error("userContext is required");
  const candidates = items.slice(0, 40);

  const system = `
너는 KB 소호 컨설팅 보조 에이전트다.
- JSON으로만 응답한다.
- 최대 ${topK}개 추천.
- 각 항목: id, score(0~10), reason(한두 문장), matchedConditions(문자열 배열), url.
- 근거 없으면 추천하지 않는다. 확정 표현 금지.
`;

  const payload = { userContext, candidates };

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
      max_tokens: 800,
    });

    const content = completion.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);

    const results = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.results)
      ? parsed.results
      : [];

    const normalized = results
      .slice(0, topK)
      .map((r) => ({
        id: r.id ?? null,
        score: typeof r.score === "number" ? r.score : null,
        reason: r.reason ?? "",
        matchedConditions: Array.isArray(r.matchedConditions)
          ? r.matchedConditions
          : [],
        url: r.url ?? null,
      }))
      .filter((x) => x.id);

    if (!normalized.length) {
      // LLM 빈 응답 폴백
      return {
        results: candidates.slice(0, topK).map((c, i) => ({
          id: c.id,
          score: 5 - i * 0.1,
          reason: "기본 필터 일치(LLM 폴백). 상세 검토 필요.",
          matchedConditions: [],
          url: c.url,
        })),
      };
    }
    return { results: normalized };
  } catch (err) {
    console.error("[reRankWithReasons] error", err?.message || err);
    // 최후 폴백
    return {
      results: candidates.slice(0, topK).map((c, i) => ({
        id: c.id,
        score: 5 - i * 0.1,
        reason: "기본 필터 일치(LLM 폴백). 상세 검토 필요.",
        matchedConditions: [],
        url: c.url,
      })),
    };
  }
}
