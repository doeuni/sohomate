import { enhanceSearchQuery } from "./utils.js";
import { queryCandidatesStrict } from "./search/queryStrict.js";
import { queryCandidatesRecall } from "./match/queryRecall.js";
import { mapDbRowsToCandidates } from "./match/mapCandidates.js";
import { reRankWithReasons } from "./match/rerank.js";
import {
  indexById,
  mergeLlmWithDb,
  fillUpToTopK,
} from "./match/enrichResults.js";

export function attachRoutes(app, db) {
  // 헬스체크
  app.get("/health", (_, res) => res.json({ ok: true }));

  app.get("/debug/db", (req, res) => {
    try {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all();
      const cnt = db.prepare(`SELECT COUNT(*) AS c FROM policies`).get().c;
      const sample = db.prepare(`SELECT * FROM policies LIMIT 1`).get();
      res.json({
        tables: tables.map((t) => t.name),
        policiesCount: cnt,
        sampleKeys: sample ? Object.keys(sample) : [],
        sample,
      });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // /search
  app.post("/search", (req, res) => {
    try {
      const { q, ...filters } = req.body || {};
      const enhanced = enhanceSearchQuery(q);
      const items = queryCandidatesStrict(db, { ...filters, q: enhanced });
      return res.json({
        items,
        originalQuery: q,
        enhancedQuery: enhanced,
        searchType: q ? "FTS5+LIKE (STRICT)" : "필터 검색",
      });
    } catch (e) {
      console.error("[/search] error:", e);
      return res.status(500).json({ ok: false, error: "search failed" });
    }
  });

  // /match → RECALL-FIRST + LLM + 폴백
  app.post("/match", async (req, res) => {
    try {
      const { q, region, industry, userContext, topK = 3 } = req.body || {};
      if (!userContext)
        return res.status(400).json({ error: "userContext is required." });

      // 1) 후보 넓게 수집
      const recallRows = queryCandidatesRecall(db, {
        region,
        industry,
        q,
        limit: 80,
      });
      if (!recallRows.length) {
        const fb = db
          .prepare(`SELECT * FROM policies ORDER BY rowid DESC LIMIT ?;`)
          .all(topK);
        const filled = fillUpToTopK({
          current: [],
          recallRows: [],
          latestRows: fb,
          topK,
          userContext,
        });
        return res.json({
          ok: true,
          count: filled.length,
          results: filled,
          originalQuery: q,
          searchType: "Latest fallback",
        });
      }

      // 2) LLM 재정렬
      const candidates = mapDbRowsToCandidates(recallRows).slice(0, 40);
      const ranked = await reRankWithReasons({
        userContext,
        items: candidates,
        topK,
      });

      // 3) LLM 결과 ↔ DB 조인
      const dbIdx = indexById(recallRows);
      let merged = mergeLlmWithDb({
        llmResults: ranked?.results || [],
        dbIndex: dbIdx,
        userContext,
      });

      // 4) 항상 topK 보장
      if (merged.length < topK) {
        const latest = db
          .prepare(`SELECT * FROM policies ORDER BY rowid DESC LIMIT ?;`)
          .all(topK * 2);
        merged = fillUpToTopK({
          current: merged,
          recallRows,
          latestRows: latest,
          topK,
          userContext,
        });
      }

      return res.json({
        ok: true,
        count: merged.length,
        results: merged,
        originalQuery: q,
        searchType: "Recall-first + LLM",
      });
    } catch (err) {
      console.error("[/match] error:", err?.message || err);
      // 최후 폴백
      const latest = db
        .prepare(`SELECT * FROM policies ORDER BY rowid DESC LIMIT 3;`)
        .all();
      const filled = fillUpToTopK({
        current: [],
        recallRows: [],
        latestRows: latest,
        topK: 3,
        userContext: req.body?.userContext || "",
      });
      return res.status(200).json({
        ok: true,
        count: filled.length,
        results: filled,
        note: "LLM/검색 오류 폴백",
      });
    }
  });
}
