// /match 전용: Recall-first (FTS 에러 회피 + LIKE 관대 + 최신순 폴백)
import { splitTerms } from "../utils.js";

export function queryCandidatesRecall(db, { region, industry, q, limit = 60 }) {
  region = (region || "").trim();
  industry = (industry || "").trim();
  q = (q || "").trim();

  const terms = splitTerms(q, 6);
  const regionLike = `%${region}%`;
  const industryLike = `%${industry}%`;

  // 1) FTS — 단일 MATCH 문자열
  if (terms.length) {
    const matchQ = terms.map((t) => `"${t}" OR ${t}*`).join(" OR ");
    let sql = `
      SELECT p.*, bm25(policies_fts) AS relevance_score
      FROM policies_fts
      JOIN policies p ON p.id = policies_fts.rowid
      WHERE policies_fts MATCH @matchQ
    `;
    const conds = [];
    if (region)
      conds.push(
        `(p.region LIKE @regionLike OR p.title LIKE @regionLike OR p.conditions LIKE @regionLike OR IFNULL(p.hashtags,'') LIKE @regionLike)`
      );
    if (industry)
      conds.push(
        `(p.industry LIKE @industryLike OR p.title LIKE @industryLike OR p.conditions LIKE @industryLike OR IFNULL(p.hashtags,'') LIKE @industryLike)`
      );
    if (conds.length) sql += " AND " + conds.join(" AND ");
    sql += ` ORDER BY relevance_score ASC, p.rowid DESC LIMIT ${limit};`;

    try {
      const rows = db.prepare(sql).all({ matchQ, regionLike, industryLike });
      console.log("[recall FTS] rows:", rows.length, "| terms:", terms);
      if (rows.length) return rows;
    } catch (e) {
      console.error("[recall FTS error]", e);
    }
  }

  // 2) LIKE — 토큰별 OR 매칭
  let likeSql = `
    SELECT p.*,
      (
        ${
          terms.length
            ? terms
                .map(
                  (_, i) => `
          (CASE WHEN p.title LIKE @t${i} THEN 3 ELSE 0 END) +
          (CASE WHEN p.conditions LIKE @t${i} THEN 2 ELSE 0 END) +
          (CASE WHEN IFNULL(p.hashtags,'') LIKE @t${i} THEN 1 ELSE 0 END)
        `
                )
                .join(" + ")
            : "0"
        }
      ) AS relevance_score
    FROM policies p
  `;
  const where = [];
  const params = {};
  if (terms.length) {
    const perTerm = terms.map(
      (_, i) => `
      (p.title LIKE @t${i} OR p.conditions LIKE @t${i} OR IFNULL(p.hashtags,'') LIKE @t${i})
    `
    );
    where.push("(" + perTerm.join(" OR ") + ")");
    terms.forEach((t, i) => (params[`t${i}`] = `%${t}%`));
  }
  if (region) {
    where.push(
      `(p.region LIKE @regionLike OR p.title LIKE @regionLike OR p.conditions LIKE @regionLike OR IFNULL(p.hashtags,'') LIKE @regionLike)`
    );
    params.regionLike = regionLike;
  }
  if (industry) {
    where.push(
      `(p.industry LIKE @industryLike OR p.title LIKE @industryLike OR p.conditions LIKE @industryLike OR IFNULL(p.hashtags,'') LIKE @industryLike)`
    );
    params.industryLike = industryLike;
  }

  if (where.length) likeSql += " WHERE " + where.join(" AND ");
  likeSql += " ORDER BY relevance_score DESC, p.rowid DESC";
  likeSql += ` LIMIT ${limit};`;

  const rows = db.prepare(likeSql).all(params);
  console.log("[recall LIKE] rows:", rows.length, "| terms:", terms);
  if (rows.length) return rows;

  // 3) 최신순 폴백
  const fb = db
    .prepare(`SELECT * FROM policies ORDER BY rowid DESC LIMIT ${limit};`)
    .all();
  console.log("[recall fallback latest] rows:", fb.length);
  return fb;
}
