import "dotenv/config";
import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import { attachRoutes } from "./routes.js";

function sanity(db) {
  try {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all();
    console.log(
      "[DB] tables:",
      tables.map((t) => t.name)
    );
    const cnt = db.prepare(`SELECT COUNT(*) AS c FROM policies`).get().c;
    console.log("[DB] policies row count:", cnt);
  } catch (e) {
    console.error("[DB] sanity check failed:", e);
  }
}

export function startServer({ dbPath = "db/soho.db", port = 3000 } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // DB 연결
  const db = new Database(dbPath, { readonly: true });
  sanity(db);

  // 라우트 연결
  attachRoutes(app, db);

  // 서버 시작
  app.listen(port, () => console.log(`✅ http://localhost:${port}`));
  return app;
}

// 직접 실행
if (process.argv[1] === new URL(import.meta.url).pathname) {
  startServer();
}
