# SOHOMATE

## 🚀 프로젝트 소개

“직원을 위한, KB를 위한 서비스” 

직원들의 상담 과정을 AI가 도와주며

직원은 더 가치 있는 상담에 집중하고, 사장님은 더 빠르고 풍부한 도움을 받을 수 있도록 합니다.

### ✨ 주요 기능

- **FTS5 전문검색**: SQLite FTS5를 활용한 고성능 검색
- **한국어 동의어 검색**: 창업=사업시작, 지원=도움 등
- **LLM 기반 재정렬**: OpenAI를 활용한 지능형 매칭

## 🛠️ 설치 및 실행

### 1. 의존성 설치

```bash
npm install
```

### 2. 환경변수 설정

`.env` 파일을 생성하고 다음 내용을 설정하세요:

```bash
# OpenAI API 설정
OPENAI_API_KEY=your_openai_api_key_here

# 서버 설정
PORT=3000
NODE_ENV=development
```

### 3. 데이터베이스 초기화

```bash
# 테이블 생성
node src/createTables.js

# 데이터 로드
node src/loadData.js

# FTS5 동기화
node src/finalFTS.js
```

### 4. 서버 실행

```bash
node src/server.js
```

## 📊 API 엔드포인트

### `POST /search (쿼리 파라미터로 요청)`

정책 검색 (FTS5 + LIKE fallback)

**요청 예시:**

```json
{
  "q": "창업",
  "region": "서울",
  "industry": "IT"
}
```

**응답 예시:**

```json
{
  "items": [...],
  "originalQuery": "창업",
  "enhancedQuery": "창업 창업 사업시작 사업개시",
  "searchType": "FTS5+LIKE 검색"
}
```

### `POST /match (JSON 바디로 요청)`

LLM 기반 재정렬 및 추천 이유

**요청 예시:**

```json
{
  "q": "창업 마케팅",
  "region": "서울",
  "industry": "IT",
  "userContext": "서울 IT 스타트업 창업 1년차, 홍보 부족으로 매출이 정체되어 있어요. 자금 지원과 마케팅 도움 필요해요.",
  "topK": 1
}
```

**응답 예시:**

```json
{
  "ok": true,
  "count": 3,
  "results" : [...],
  "originalQuery": "창업 마케팅",
  "searchType": "Recall-first + LLM"
}
```

## 🏗️ 기술 스택

- **Backend**: Node.js, Express
- **Database**: SQLite + FTS5 (Full-Text Search)
- **AI**: OpenAI GPT API
- **Search Engine**: FTS5 전문검색 + BM25 점수

## 🔒 보안

- `.env` 파일은 `.gitignore`에 포함되어 Git에 업로드되지 않습니다
- 민감한 API 키는 환경변수로 관리됩니다

## 📝 라이선스

ISC License
