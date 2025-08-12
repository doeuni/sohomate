import "dotenv/config";
import express from "express";
import Database from "better-sqlite3";
import { reRankWithReasons } from "./rerank.js";

const app = express();
app.use(express.json());

const db = new Database("db/soho.db", { readonly: true });

// 한국어 동의어 및 형태소 분석
function enhanceSearchQuery(query) {
  if (!query) return query;

  const synonyms = {
    '창업': '창업 사업시작 사업개시',
    '사업': '사업 창업 영업',
    '지원': '지원 도움 혜택',
    '자금': '자금 돈 자본',
    '교육': '교육 훈련 학습',
    '컨설팅': '컨설팅 상담 자문',
    '마케팅': '마케팅 홍보 판촉',
    '기술': '기술 기술력 기술개발',
    '디지털': '디지털 온라인 인터넷',
    '온라인': '온라인 인터넷 디지털'
  };

  let enhancedQuery = query;
  for (const [key, value] of Object.entries(synonyms)) {
    if (query.includes(key)) {
      enhancedQuery += ' ' + value;
      break;
    }
  }

  return enhancedQuery;
}

// FTS5 쿼리 생성: 정확 + 접두어
function toFtsQuery(q = "") {
  const cleaned = (q || "").replace(/["'()*^]/g, " ").trim();
  if (!cleaned) return { exact: "", prefix: "" };
  const terms = cleaned.split(/\s+/).filter(Boolean);
  const exact = terms.map(t => `"${t}"`).join(" AND ");
  const prefix = terms.map(t => `${t}*`).join(" AND ");
  return { exact, prefix };
}

// FTS5 + LIKE fallback 검색
function queryCandidates({ region, industry, years, q }) {
  region = (region || "").trim();
  industry = (industry || "").trim();
  q = (q || "").trim();

  // 1) FTS5 검색 시도
  if (q) {
    const { exact, prefix } = toFtsQuery(q);
    const params = {
      exact: exact || '""',
      prefix: prefix || '""',
      region,
      regionLike: `%${region}%`,
      industry,
      industryLike: `%${industry}%`
    };

    let sql = `
      SELECT 
        p.*,
        bm25(policies_fts) AS relevance_score
      FROM policies_fts
      JOIN policies p ON p.id = policies_fts.rowid
      WHERE (policies_fts MATCH @exact OR policies_fts MATCH @prefix)
    `;

    const conds = [];
    if (region) {
      conds.push(`(p.region = @region OR p.title LIKE @regionLike OR p.conditions LIKE @regionLike OR p.hashtags LIKE @regionLike)`);
    }
    if (industry) {
      conds.push(`(p.industry = @industry OR p.title LIKE @industryLike OR p.conditions LIKE @industryLike OR p.hashtags LIKE @industryLike)`);
    }
    if (conds.length) sql += " AND " + conds.join(" AND ");

    sql += " ORDER BY relevance_score ASC LIMIT 50;";
    const results = db.prepare(sql).all(params);

    if (results.length > 0) {
      return results;
    }
  }

  // 2) FTS5 결과 없으면 LIKE 검색 fallback
  let likeSql = `
    SELECT 
      p.*,
      CASE 
        WHEN p.title LIKE @qLike THEN 3
        WHEN p.conditions LIKE @qLike THEN 2
        WHEN p.hashtags LIKE @qLike THEN 1
        ELSE 0
      END AS relevance_score
    FROM policies p
  `;

  const likeParams = {
    qLike: `%${q}%`,
    region,
    regionLike: `%${region}%`,
    industry,
    industryLike: `%${industry}%`
  };

  const likeConds = [];
  if (q) {
    likeConds.push(`(p.title LIKE @qLike OR p.conditions LIKE @qLike OR p.hashtags LIKE @qLike)`);
  }
  if (region) {
    likeConds.push(`(p.region = @region OR p.title LIKE @regionLike OR p.conditions LIKE @regionLike OR p.hashtags LIKE @regionLike)`);
  }
  if (industry) {
    likeConds.push(`(p.industry = @industry OR p.title LIKE @industryLike OR p.conditions LIKE @industryLike OR p.hashtags LIKE @industryLike)`);
  }
  if (likeConds.length) {
    likeSql += " WHERE " + likeConds.join(" AND ");
  }

  if (q) {
    likeSql += " ORDER BY relevance_score DESC, p.rowid DESC";
  } else {
    likeSql += " ORDER BY p.rowid DESC";
  }

  likeSql += " LIMIT 50;";
  return db.prepare(likeSql).all(likeParams);
}

// 1) 후보 조회(프론트 확인용)
app.post("/search", (req, res) => {
  const { q, ...filters } = req.body || {};
  const enhancedQuery = enhanceSearchQuery(q);
  const items = queryCandidates({ ...filters, q: enhancedQuery });
  res.json({
    items,
    originalQuery: q,
    enhancedQuery: enhancedQuery,
    searchType: q ? 'FTS5+LIKE 검색' : '필터 검색'
  });
});

// 2) 매칭 + 재정렬 + 추천 이유(JSON)
app.post("/match", async (req, res) => {
  const { q, ...filters } = req.body || {};
  const enhancedQuery = enhanceSearchQuery(q);
  const items = queryCandidates({ ...filters, q: enhancedQuery });
  const top = items.slice(0, 30);
  const ranked = await reRankWithReasons(req.body, top);
  res.json({
    ...ranked,
    originalQuery: q,
    enhancedQuery: enhancedQuery,
    searchType: q ? 'FTS5+LIKE 검색' : '필터 검색'
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ http://localhost:${port}`));
