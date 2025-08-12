import dotenv from "dotenv";
dotenv.config();

import Database from "better-sqlite3";

const db = new Database("db/soho.db");

console.log("🔄 FTS5 테이블 동기화 시작...");

// 1. 기존 FTS5 데이터 삭제
db.exec("DELETE FROM policies_fts");

// 2. 메인 테이블의 모든 데이터를 FTS5에 삽입
const stmt = db.prepare(`
  INSERT INTO policies_fts(rowid, title, conditions)
  SELECT id, title, conditions FROM policies
`);

const result = stmt.run();
console.log(`✅ FTS5 동기화 완료: ${result.changes}건`);

// 3. 동기화 확인
const count = db.prepare("SELECT COUNT(*) as count FROM policies_fts").get();
console.log(`📊 FTS5 테이블 데이터 수: ${count.count}건`);

db.close();
console.log("🔒 데이터베이스 연결 종료"); 