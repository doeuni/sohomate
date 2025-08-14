// /search 전용
export function queryCandidatesStrict(db, { region, industry, q }) {
  region = (region || "").trim();
  industry = (industry || "").trim();
  q = (q || "").trim();

  // 1) FTS (정확/접두)
  if (q) {
    const cleaned = (q || "").replace(/["'()*^]/g, " ").trim();
    const terms = cleaned.split(/\s+/).filter(Boolean);
    const exact = terms.map((t) => `"${t}"`).join(" AND ");
    const prefix = terms.map((t) => `${t}*`).join(" AND ");

    const params = {
      exact: exact || '""',
      prefix: prefix || '""',
      region,
      regionLike: `%${region}%`,
      industry,
      industryLike: `%${industry}%`,
    };

    // FTS MATCH는 가상테이블 컨텍스트에서만 허용 → 단일 MATCH 문자열로 단순화 권장
    let sql = `
        SELECT p.*, bm25(policies_fts) AS relevance_score
        FROM policies_fts
        JOIN policies p ON p.id = policies_fts.rowid
        WHERE (policies_fts MATCH @exact OR policies_fts MATCH @prefix)
      `;
    const conds = [];
    if (region)
      conds.push(
        `(p.region = @region OR p.title LIKE @regionLike OR p.conditions LIKE @regionLike OR IFNULL(p.hashtags,'') LIKE @regionLike)`
      );
    if (industry)
      conds.push(
        `(p.industry = @industry OR p.title LIKE @industryLike OR p.conditions LIKE @industryLike OR IFNULL(p.hashtags,'') LIKE @industryLike)`
      );
    if (conds.length) sql += " AND " + conds.join(" AND ");
    sql += " ORDER BY relevance_score ASC LIMIT 50;";

    try {
      const rows = db.prepare(sql).all(params);
      if (rows.length) return rows;
    } catch (e) {
      console.error("[/search FTS error]", e);
    }
  }

  // 2) LIKE 폴백
  let likeSql = `
      SELECT p.*,
        CASE 
          WHEN p.title LIKE @qLike THEN 3
          WHEN p.conditions LIKE @qLike THEN 2
          WHEN IFNULL(p.hashtags,'') LIKE @qLike THEN 1
          ELSE 0
        END AS relevance_score
      FROM policies p
    `;
  const likeParams = {
    qLike: `%${q}%`,
    region,
    regionLike: `%${region}%`,
    industry,
    industryLike: `%${industry}%`,
  };
  const likeConds = [];
  if (q)
    likeConds.push(
      `(p.title LIKE @qLike OR p.conditions LIKE @qLike OR IFNULL(p.hashtags,'') LIKE @qLike)`
    );
  if (region)
    likeConds.push(
      `(p.region = @region OR p.title LIKE @regionLike OR p.conditions LIKE @regionLike OR IFNULL(p.hashtags,'') LIKE @regionLike)`
    );
  if (industry)
    likeConds.push(
      `(p.industry = @industry OR p.title LIKE @industryLike OR p.conditions LIKE @industryLike OR IFNULL(p.hashtags,'') LIKE @industryLike)`
    );
  if (likeConds.length) likeSql += " WHERE " + likeConds.join(" AND ");
  likeSql += q
    ? " ORDER BY relevance_score DESC, p.rowid DESC"
    : " ORDER BY p.rowid DESC";
  likeSql += " LIMIT 50;";
  return db.prepare(likeSql).all(likeParams);
}
