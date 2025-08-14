const KST_OFFSET = 9 * 60;

function parseKoreanDate(s) {
  const m = String(s || "")
    .trim()
    .match(/(20\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (!m) return null;
  const [_, y, mo, d] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, 0, -KST_OFFSET, 0)); // KST 정규화
  return isNaN(dt) ? null : dt;
}

function summarizePeriod(raw) {
  const txt = String(raw || "").trim();
  if (!txt || /상이|별도 공고|수시|상시/i.test(txt)) return "";

  // "YYYY.MM.DD~YYYY.MM.DD" 형태 파싱
  const parts = txt.split(/~|∼|~\s*|∼\s*/);
  if (parts.length >= 2) {
    const s = parseKoreanDate(parts[0]);
    const e = parseKoreanDate(parts[1]);
    if (s && e) {
      const now = new Date();
      const dday = Math.ceil((e - now) / (1000 * 60 * 60 * 24));
      const status = dday >= 0 ? `(D-${dday})` : `(마감)`;
      const fmt = (d) =>
        `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(
          2,
          "0"
        )}.${String(d.getUTCDate()).padStart(2, "0")}`;
      return `신청기간 ${fmt(s)}~${fmt(e)} ${status}`;
    }
  }
  // 단일 날짜만 있는 경우
  const one = parseKoreanDate(txt);
  if (one) {
    const now = new Date();
    const dday = Math.ceil((one - now) / (1000 * 60 * 60 * 24));
    const status = dday >= 0 ? `(D-${dday})` : `(마감)`;
    const fmt = (d) =>
      `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(
        2,
        "0"
      )}.${String(d.getUTCDate()).padStart(2, "0")}`;
    return `마감 ${fmt(one)} ${status}`;
  }
  return "";
}

function pickIndustry(row) {
  const blob = [row.industry, row.title, row.hashtags, row.conditions]
    .join(" ")
    .toLowerCase();
  if (/(it|sw|소프트웨어|정보통신|디지털|온라인)/i.test(blob))
    return "IT 스타트업";
  if (/(제조|스마트공장|설비|장비)/i.test(blob)) return "제조업";
  if (/(요식|음식|식당|프랜차이즈|카페|베이커리)/i.test(blob))
    return "요식/프랜차이즈";
  if (/(콘텐츠|영상|디자인|브랜딩|광고)/i.test(blob)) return "콘텐츠/디자인";
  if (/(수출|해외|바이어|무역)/i.test(blob)) return "수출/해외";
  return (row.industry || "").trim();
}

function pickStage(row) {
  const blob = [row.conditions, row.title].join(" ");
  if (/예비창업/.test(blob)) return "예비창업";
  const m = blob.match(/창업\s*([0-9]{1,2})\s*년\s*(이내|미만)?/);
  if (m) return `창업 ${m[1]}년 ${m[2] || "이내"}`;
  if (/초기|1~3년|1-3년|1-2년|1년차|2년차|3년차/.test(blob))
    return "초기(1~3년)";
  if (/중기|4~7년|4-7년|5년차/.test(blob)) return "중기(4~7년)";
  return "";
}

function extractTopics(row, userContext) {
  const base = [row.title, row.conditions, row.hashtags, userContext]
    .join(" ")
    .toLowerCase();
  const topics = [];
  if (/(마케팅|홍보|브랜딩|판촉|광고|바우처)/.test(base)) topics.push("마케팅");
  if (/(디지털전환|온라인전환|e-?commerce|쇼핑몰|플랫폼)/.test(base))
    topics.push("디지털 전환");
  if (/(기술개발|r&d|연구개발|테스트베드)/i.test(base)) topics.push("기술개발");
  if (/(수출|해외|바이어|전시회)/.test(base)) topics.push("해외/수출");
  if (/(컨설팅|멘토링|코칭|교육)/.test(base)) topics.push("교육/컨설팅");
  if (/(운영자금|시설|장비|임대|보증|대출|융자|이차보전)/.test(base))
    topics.push("자금/보증");
  return Array.from(new Set(topics)).slice(0, 2);
}

function fundingType(row) {
  const blob = [row.title, row.conditions, row.hashtags]
    .join(" ")
    .toLowerCase();
  if (/(보조금|무상|바우처)/.test(blob)) return "보조금/바우처";
  if (/(보증|보증서|신보|기보)/.test(blob)) return "보증 연계";
  if (/(대출|융자|이차보전)/.test(blob)) return "대출/이차보전";
  return "";
}

export function buildReason({ userContext, row }) {
  const region = (row.region || "").trim();
  const industry = pickIndustry(row);
  const stage = pickStage(row);
  const topics = extractTopics(row, userContext);
  const fund = fundingType(row);
  const period = summarizePeriod(row.period || row.aplyPd || "");

  const headParts = [];
  if (region) headParts.push(region);
  if (industry) headParts.push(industry);
  if (stage) headParts.push(stage);
  const head = headParts.join(" ");

  const bodyParts = [];
  if (topics.length) bodyParts.push(`${topics.join("·")} 지원`);
  if (fund) bodyParts.push(fund);
  const body = bodyParts.join(", ");

  let out = head ? `${head} 대상` : "조건 적합 가능성";
  if (body) out += `. ${body}`;
  if (period) out += `. ${period}`;
  return out;
}
