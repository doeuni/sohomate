import dotenv from "dotenv";
dotenv.config();

import Database from "better-sqlite3";

const db = new Database("db/soho.db");

console.log("🔄 FTS5 테이블 완전 재생성 시작...");

// 1. 기존 FTS5 테이블 완전 삭제
db.exec("DROP TABLE IF EXISTS policies_fts");

// 2. FTS5 테이블 새로 생성 (간단한 구조)
db.exec(`
CREATE VIRTUAL TABLE policies_fts
USING fts5(title, conditions);
`);

console.log("✅ FTS5 테이블 생성 완료");

// 3. 데이터 삽입
const stmt = db.prepare(`
  INSERT INTO policies_fts(title, conditions)
  SELECT title, conditions FROM policies
`);

const result = stmt.run();
console.log(`✅ 데이터 삽입 완료: ${result.changes}건`);

// 4. FTS5 테스트
try {
  const testResult = db.prepare('SELECT * FROM policies_fts WHERE policies_fts MATCH "소상공인" LIMIT 3').all();
  console.log(`✅ FTS5 검색 테스트 성공: ${testResult.length}건`);
} catch (e) {
  console.log(`❌ FTS5 검색 테스트 실패: ${e.message}`);
}

// 5. 구조 확인
const structure = db.prepare("PRAGMA table_info(policies_fts)").all();
console.log(`🏗️ FTS5 테이블 구조:`, structure);

db.close();
console.log("🔒 데이터베이스 연결 종료"); 