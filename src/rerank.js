import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * user: { region, industry, years, creditScore, purpose }
 * items: [{ id,title,region,industry,period,conditions,url,hashtags,source }, ...]
 */
export async function reRankWithReasons(user, items) {
  const sys = `너는 KB 소호컨설팅 금융 상담 보조 에이전트다.
- 반드시 JSON으로만 응답한다.
- 입력 후보 중에서 최대 3개를 추천한다.
- 각 추천에는 reason(추천 이유)과 matchedConditions(충족 조건 키워드)를 포함한다.
- 후보에 근거가 없으면 만들지 말고 제외한다.`;

  const prompt = {
    userContext: user,
    candidates: items.map(it => ({
      id: it.id,
      title: it.title,
      region: it.region,
      industry: it.industry,
      period: it.period,
      conditions: it.conditions,
      url: it.url
    }))
  };

  const resp = await client.responses.create({
    model: "gpt-5",
    input: [
      { role: "system", content: sys },
      { role: "user", content: JSON.stringify(prompt) }
    ],
    response_format: { type: "json_object" },
    temperature: 0.2
  });

  // 응답 예: { recommendations:[{id, score, reason, matchedConditions:[]}, ...], excluded:[...]}
  const text = resp.output[0].content[0].text;
  return JSON.parse(text);
}
