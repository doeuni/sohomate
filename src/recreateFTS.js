import dotenv from "dotenv";
dotenv.config();

import Database from "better-sqlite3";

const db = new Database("db/soho.db");

console.log("🔄 FTS5 테이블 재생성 시작...");

// 1. 기존 FTS5 테이블 삭제
db.exec("DROP TABLE IF EXISTS policies_fts");

// 2. FTS5 테이블 재생성
db.exec(`
CREATE VIRTUAL TABLE policies_fts
USING fts5(
  title, 
  conditions, 
  content='policies', 
  content_rowid='id'
);
`);

// 3. 메인 테이블의 모든 데이터를 FTS5에 삽입
const stmt = db.prepare(`
  INSERT INTO policies_fts(rowid, title, conditions)
  SELECT id, title, conditions FROM policies
`);

const result = stmt.run();
console.log(`✅ FTS5 재생성 완료: ${result.changes}건`);

// 4. 동기화 확인
const count = db.prepare("SELECT COUNT(*) as count FROM policies_fts").get();
console.log(`📊 FTS5 테이블 데이터 수: ${count.count}건`);

// 5. FTS5 구조 확인
const structure = db.prepare("PRAGMA table_info(policies_fts)").all();
console.log(`🏗️ FTS5 테이블 구조:`, structure);

db.close();
console.log("🔒 데이터베이스 연결 종료"); 