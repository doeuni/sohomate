
import dotenv from "dotenv";
dotenv.config();

import Database from "better-sqlite3";
const db = new Database("db/soho.db");

// 1. 메인 테이블
db.exec(`
CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY,
  title TEXT,
  region TEXT,
  industry TEXT,
  period TEXT,         -- 신청기간
  conditions TEXT,     -- 신청 조건(문장)
  url TEXT,
  hashtags TEXT,       -- 콤마 구분
  source TEXT          -- sbiz24 | bizinfo
);
`);

// 2. FTS5(전문검색) 인덱스
db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS policies_fts
USING fts5(
  title, 
  conditions
);
`);

// 3. 동기화용 트리거
db.exec(`
CREATE TRIGGER IF NOT EXISTS policies_ai AFTER INSERT ON policies BEGIN
  INSERT INTO policies_fts(rowid, title, conditions)
  VALUES (new.id, new.title, new.conditions);
END;
CREATE TRIGGER IF NOT EXISTS policies_ad AFTER DELETE ON policies BEGIN
  INSERT INTO policies_fts(policies_fts, rowid, title, conditions)
  VALUES('delete', old.id, old.title, old.conditions);
END;
CREATE TRIGGER IF NOT EXISTS policies_au AFTER UPDATE ON policies BEGIN
  INSERT INTO policies_fts(policies_fts, rowid, title, conditions)
  VALUES('delete', old.id, old.title, old.conditions);
  INSERT INTO policies_fts(rowid, title, conditions)
  VALUES (new.id, new.title, new.conditions);
END;
`);

console.log("✅ tables ready");
