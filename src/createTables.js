import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";

import Database from "better-sqlite3";
// 데이터베이스 파일 경로 정의
const dbDir = path.join(process.cwd(), "db");
const dbFile = path.join(dbDir, "soho.db");

// 디렉터리가 없으면 생성
if (!fs.existsSync(dbDir)) {
  console.log(`Directory ${dbDir} does not exist. Creating...`);
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbFile);
console.log(`SQLite database opened at ${dbFile}`);

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
