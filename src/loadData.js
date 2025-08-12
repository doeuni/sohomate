import "dotenv/config";
import fs from "fs";
import { parse } from "csv-parse";
import Database from "better-sqlite3";

// 추론 사전 (필요시 추가)
const REGIONS = ["서울","부산","대구","인천","광주","대전","울산","세종",
  "경기","강원","충북","충남","전북","전남","경북","경남","제주","전북특별자치도","경기도","전라남도","전라북도"];
const INDUSTRIES = ["요식업","음식점","식음료","제조업","도소매","숙박","관광","문화",
  "IT","정보통신","교육","헬스케어","물류","프랜차이즈","농업","수산","라이브커머스"];

function inferRegion(text) {
  if (!text) return "";
  return REGIONS.find(r => text.includes(r)) || "";
}
function inferIndustry(text) {
  if (!text) return "";
  const hit = INDUSTRIES.find(w => text.includes(w));
  return hit || "";
}

// "['금융','전북',...]" -> "금융,전북,..." 로 변환
function parseHashtags(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  const inside = s.replace(/^\[\s*/, "").replace(/\]\s*$/, "");
  const parts = inside.split(",").map(t => t.replace(/^['"\s]+|['"\s]+$/g,"").trim()).filter(Boolean);
  return parts.join(",");
}

const db = new Database("db/soho.db");
const insert = db.prepare(`
  INSERT INTO policies (title, region, industry, period, conditions, url, hashtags, source)
  VALUES (@title, @region, @industry, @period, @conditions, @url, @hashtags, @source)
`);

async function loadCSV() {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream("data/소상공인24_지원사업리스트.csv")
      .pipe(parse({ columns: true, trim: true }))
      .on("data", (r) => {
        const title = r["공고명"] || "";
        const period = r["신청기간"] || "";
        const hashtagsRaw = r["해시태그"] || "";
        const hashtags = parseHashtags(hashtagsRaw);
        const url = r["url"] || "";

        // conditions는 실제 있는 컬럼들로 조합
        const conditions = [
          r["지원대상"],     // 예: 소상공인/중소기업
          r["사업유형"],     // 예: 유관기관지원사업
          r["주관기관"]      // 예: 전북특별자치도
        ].filter(Boolean).join(" | ");

        // 제목 + 해시태그 + 조건에서 지역/업종 추론
        const textPool = [title, hashtags, conditions].join(" ");
        const region = inferRegion(textPool);
        const industry = inferIndustry(textPool);

        rows.push({
          title,
          region,
          industry,
          period,
          conditions,
          url,
          hashtags,
          source: "sbiz24"
        });
      })
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function main() {
  const csvRows = await loadCSV();
  console.log(`📥 CSV 로드: ${csvRows.length}건`);

  const tx = db.transaction((list) => list.forEach((row) => insert.run(row)));
  tx(csvRows);

  const cnt = db.prepare("SELECT COUNT(*) AS c FROM policies").get().c;
  console.log(`✅ DB 적재 완료: ${cnt}건`);
}
main();
