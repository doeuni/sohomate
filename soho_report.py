"""
python soho_report.py --audio sample.wav \
  --client '{"name":"홍길동","email":"user@example.com","biz_type":"요식업","region":"부산","biz_age_months":24,"credit_score":750,"purpose":"운전자금"}' \
  --db db/soho.db \
  --out report.pdf
"""

import os, json, argparse, sqlite3, datetime, time, re
from typing import List, Optional
from pydantic import BaseModel, Field, ValidationError
from dotenv import load_dotenv

# ReportLab
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# OpenAI SDK
from openai import OpenAI

# ---------------- Config ----------------
load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL") or None
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")  # 요약/재정렬 기본 모델

# 한글 폰트 경로(환경변수로 오버라이드 가능)
PDF_FONT_NAME    = os.getenv("PDF_FONT_NAME", "NotoSansKR")
PDF_FONT_REGULAR = os.getenv("PDF_FONT_REGULAR", "fonts/NOTOSANSKR-REGULAR.TTF")
PDF_FONT_BOLD    = os.getenv("PDF_FONT_BOLD",    "fonts/NOTOSANSKR-BOLD.TTF")

# OpenAI 클라이언트 (글로벌 타임아웃)
client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL, timeout=60)

# 폰트 등록
pdfmetrics.registerFont(TTFont(PDF_FONT_NAME, PDF_FONT_REGULAR))
pdfmetrics.registerFont(TTFont(PDF_FONT_NAME + "-Bold", PDF_FONT_BOLD))

# ---------------- Models ----------------
class ClientProfile(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    biz_type: str = Field(..., description="업종")
    region: str = Field(..., description="지역")
    biz_age_months: int = Field(..., description="업력(개월)")
    credit_score: Optional[int] = Field(None, description="신용점수")
    purpose: Optional[str] = Field(None, description="자금 용도/요청")

class Recommendation(BaseModel):
    id: Optional[int] = None
    name: str
    limit: Optional[str] = None
    rate: Optional[str] = None
    repayment: Optional[str] = None
    conditions: List[str] = []
    documents: List[str] = []
    rationale: Optional[str] = None
    url: Optional[str] = None
    source: Optional[str] = None

class ReportBundle(BaseModel):
    client: ClientProfile
    consultedAt: str
    summary: str
    needs: List[str] = []
    risks: List[str] = []
    recommendations: List[Recommendation] = []

# ---------------- Utils ----------------
def _extract_json(text: str) -> dict | None:
    """응답에서 JSON만 안전하게 추출."""
    # 1) 바로 파싱
    try:
        return json.loads(text)
    except Exception:
        pass
    # 2) ```json ... ``` 또는 ``` ... ``` 안쪽만 추출
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.S)
    if not m:
        m = re.search(r"```\s*(\{.*?\})\s*```", text, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    # 3) 첫 중괄호~마지막 중괄호 블록 추출
    m = re.search(r"(\{.*\})", text, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return None

# ---------------- 1) STT ----------------
def transcribe_audio(audio_path: str, language: str = "ko") -> str:
    """Whisper API로 전체 파일 전사."""
    size_mb = os.path.getsize(audio_path) / 1024 / 1024
    print(f"   ▶ 파일: {audio_path} ({size_mb:.2f} MB)")
    t0 = time.time()
    with open(audio_path, "rb") as f:
        resp = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            language=language,
            response_format="text"
        )
    print(f"   ▶ STT 완료까지 {time.time()-t0:.1f}s")
    return str(resp).strip()

# ---------------- 2) 요약 ----------------
def summarize_transcript(transcript: str, profile: ClientProfile) -> dict:
    """LLM으로 상담 요약 + 니즈/리스크 JSON 생성."""
    sys = (
        "너는 중소상공인 금융상담 리포트 작성 보조야. "
        "반드시 JSON으로만 응답해. 추정 금지, 사실 기반으로 간결하게."
    )
    user = {
        "client_profile": profile.model_dump(),
        "transcript": transcript,
        "output_schema": {
            "summary": "문단 1~2개 요약",
            "needs": ["핵심 니즈 리스트"],
            "risks": ["위험요소/유의사항 리스트(없으면 비움)"]
        }
    }
    print(f"   ▶ 요약 LLM 호출… model={LLM_MODEL}")
    t0 = time.time()
    resp = client.responses.create(
        model=LLM_MODEL,
        input=[
            {"role": "system", "content": sys},
            {"role": "user", "content": json.dumps(user, ensure_ascii=False)}
        ],
    )
    print(f"   ▶ 요약 LLM 응답 {time.time()-t0:.1f}s")
    text = resp.output_text
    data = _extract_json(text)
    if not data:
        # 그래도 JSON 파싱 실패 시 최소 구조로 반환
        return {"summary": text, "needs": [], "risks": []}
    return data

# -------- 3) 정책 후보 검색 (SQLite FTS5) --------
def search_policy_candidates(db_path: Optional[str], profile: ClientProfile, free_query: Optional[str] = None, limit: int = 30):
    """FTS5 title/conditions 검색 + LIKE 보조."""
    if not db_path or not os.path.exists(db_path):
        return []
    q = (free_query or "").strip()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    params = {
        "region": profile.region,
        "regionLike": f"%{profile.region}%",
        "industry": profile.biz_type,
        "industryLike": f"%{profile.biz_type}%",
        "qLike": f"%{q}%",
        "limit": limit
    }

    rows = []
    if q:
        sql = """
        SELECT p.* FROM policies_fts
        JOIN policies p ON p.id = policies_fts.rowid
        WHERE policies_fts MATCH ?
        """
        terms = " AND ".join([t + "*" for t in q.split()])
        try:
            rows = conn.execute(sql, (terms,)).fetchall()
        except Exception:
            rows = []

    if not rows:
        like_sql = """
        SELECT p.*,
          CASE 
            WHEN p.title LIKE :qLike THEN 3
            WHEN p.conditions LIKE :qLike THEN 2
            WHEN p.hashtags LIKE :qLike THEN 1
            ELSE 0
          END AS score
        FROM policies p
        WHERE (p.title LIKE :qLike OR p.conditions LIKE :qLike OR p.hashtags LIKE :qLike)
          AND (p.region = :region OR p.title LIKE :regionLike OR p.conditions LIKE :regionLike OR p.hashtags LIKE :regionLike)
          AND (p.industry = :industry OR p.title LIKE :industryLike OR p.conditions LIKE :industryLike OR p.hashtags LIKE :industryLike)
        ORDER BY score DESC, p.id DESC
        LIMIT :limit;
        """
        rows = conn.execute(like_sql, params).fetchall()

    conn.close()
    return [dict(r) for r in rows[:limit]]

# -------- 4) LLM 재정렬/추천 사유 --------
def rerank_with_reasons(profile: ClientProfile, items: List[dict]) -> List[Recommendation]:
    if not items:
        return []
    sys = (
        "너는 KB 소호컨설팅 금융 상담 보조 에이전트다. "
        "입력 후보 중에서 최대 3개를 추천한다. "
        "각 추천에는 reason(추천 이유)과 matchedConditions(충족 조건 키워드)를 포함한다. "
        "사실 근거가 없는 항목은 제외한다. 반드시 JSON으로만 응답한다."
    )
    prompt = {
        "userContext": profile.model_dump(),
        "candidates": [
            {
                "id": it.get("id"),
                "name": it.get("title"),
                "region": it.get("region"),
                "industry": it.get("industry"),
                "period": it.get("period"),
                "conditions": it.get("conditions"),
                "url": it.get("url"),
                "source": it.get("source"),
            } for it in items
        ],
        "output_schema": {"recommendations": []}
    }
    print(f"   ▶ 재정렬 LLM 호출… model={LLM_MODEL}")
    t0 = time.time()
    resp = client.responses.create(
        model=LLM_MODEL,
        input=[
            {"role":"system","content":sys},
            {"role":"user","content":json.dumps(prompt, ensure_ascii=False)}
        ],
    )
    print(f"   ▶ 재정렬 LLM 응답 {time.time()-t0:.1f}s")
    text = resp.output_text
    data = _extract_json(text) or {"recommendations": []}

    out = []
    for r in data.get("recommendations", [])[:3]:
        out.append(Recommendation(
            id=r.get("id"),
            name=r.get("name") or r.get("title") or "추천 항목",
            limit=r.get("limit"),
            rate=r.get("rate"),
            repayment=r.get("repayment"),
            conditions=r.get("conditions") or [],
            documents=r.get("documents") or [],
            rationale=r.get("reason") or r.get("rationale"),
            url=r.get("url"),
            source=r.get("source")
        ))
    return out

# ---------------- 5) PDF 생성 ----------------
def render_pdf(bundle: ReportBundle, out_path: str):
    styles = getSampleStyleSheet()
    normal = styles["Normal"]
    title_s = styles["Title"]

    # 한글 폰트 적용
    normal.fontName = PDF_FONT_NAME
    title_s.fontName = PDF_FONT_NAME + "-Bold"

    doc = SimpleDocTemplate(out_path, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=18*mm)
    flow = []

    # 제목
    flow.append(Paragraph("상담 리포트", title_s))
    flow.append(Spacer(1, 6))

    # 고객 정보 테이블
    c = bundle.client
    client_rows = [
        ["업종", c.biz_type, "지역", c.region],
        ["업력", f"{round(c.biz_age_months/12)}년 ({c.biz_age_months}개월)", "신용점수", str(c.credit_score or "-")],
        ["이름", c.name or "-", "이메일", c.email or "-"],
        ["상담 일시", bundle.consultedAt, "용도", c.purpose or "-"]
    ]
    t = Table(client_rows, hAlign="LEFT", colWidths=[25*mm, 60*mm, 25*mm, 60*mm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), PDF_FONT_NAME),
        ("BOX",(0,0),(-1,-1),0.5,colors.black),
        ("INNERGRID",(0,0),(-1,-1),0.25,colors.grey),
        ("BACKGROUND",(0,0),(-1,0),colors.whitesmoke),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ]))
    flow.append(t)
    flow.append(Spacer(1, 10))

    # ===== 요청하신 형태로 섹션 출력 =====
    # [요약]
    flow.append(Paragraph("<b>[요약]</b>", normal))
    flow.append(Spacer(1, 2))
    flow.append(Paragraph(bundle.summary.replace("\n","<br/>"), normal))
    flow.append(Spacer(1, 8))

    # [요구사항]
    flow.append(Paragraph("<b>[요구사항]</b>", normal))
    flow.append(Spacer(1, 2))
    needs_lines = bundle.needs or []
    if needs_lines:
        flow.append(Paragraph("- " + "<br/>- ".join(needs_lines), normal))
    else:
        flow.append(Paragraph("- (없음)", normal))
    flow.append(Spacer(1, 8))

    # [위험/유의사항]
    flow.append(Paragraph("<b>[위험/유의사항]</b>", normal))
    flow.append(Spacer(1, 2))
    risks_lines = bundle.risks or []
    if risks_lines:
        flow.append(Paragraph("- " + "<br/>- ".join(risks_lines), normal))
    else:
        flow.append(Paragraph("- (없음)", normal))
    flow.append(Spacer(1, 10))
    # ===================================

    # 추천 정책 표(있을 경우)
    if bundle.recommendations:
        flow.append(Paragraph("<b>[추천 정책]</b>", normal))
        flow.append(Spacer(1, 4))
        rec_rows = [["#", "정책명", "한도/금리/상환", "조건/필요서류", "근거"]]
        for i, r in enumerate(bundle.recommendations, start=1):
            line1 = " / ".join([x for x in [r.limit, r.rate, r.repayment] if x])
            line2 = "조건: " + ", ".join(r.conditions) if r.conditions else ""
            line3 = "서류: " + ", ".join(r.documents) if r.documents else ""
            cond_doc = "<br/>".join([s for s in [line2, line3] if s])
            rec_rows.append([
                str(i),
                f'{r.name}<br/>{(r.url or "")}',
                line1 or "-",
                cond_doc or "-",
                (r.rationale or "-").replace("\n","<br/>")
            ])
        tbl = Table(rec_rows, colWidths=[10*mm, 45*mm, 45*mm, 50*mm, 40*mm])
        tbl.setStyle(TableStyle([
            ("FONTNAME", (0,0), (-1,-1), PDF_FONT_NAME),
            ("BOX",(0,0),(-1,-1),0.5,colors.black),
            ("INNERGRID",(0,0),(-1,-1),0.25,colors.grey),
            ("BACKGROUND",(0,0),(-1,0),colors.lightgrey),
            ("VALIGN",(0,0),(-1,-1),"TOP"),
        ]))
        flow.append(tbl)

    doc.build(flow)

# ---------------- CLI ----------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True, help="전사할 음성 파일 경로 (wav/mp3/webm 등)")
    parser.add_argument("--client", required=True, help="고객 JSON (예: '{\"biz_type\":\"요식업\",\"region\":\"부산\",\"biz_age_months\":24}')")
    parser.add_argument("--db", default=None, help="(선택) 정책 SQLite DB 경로. 없으면 추천 단계 생략")
    parser.add_argument("--query", default=None, help="(선택) 정책 검색어. 없으면 요약/용도 기반")
    parser.add_argument("--out", default="report.pdf", help="PDF 저장 경로")
    args = parser.parse_args()

    try:
        profile = ClientProfile.model_validate_json(args.client)
    except ValidationError as e:
        print("❌ client JSON 유효성 오류:", e)
        return

    print("① STT 진행 중…")
    transcript = transcribe_audio(args.audio)
    print(f"   전사 완료. 길이={len(transcript)}자")

    print("② 요약 생성 중…")
    sum_json = summarize_transcript(transcript, profile)
    summary = sum_json.get("summary","").strip()
    needs = sum_json.get("needs",[]) or []
    risks = sum_json.get("risks",[]) or []

    free_query = args.query or " ".join([profile.biz_type, profile.region, (profile.purpose or "")]).strip()

    print("③ (선택) 정책 후보 검색…")
    items = search_policy_candidates(args.db, profile, free_query) if args.db else []
    if items:
        print(f"   후보 {len(items)}건 → LLM 재정렬")
        recs = rerank_with_reasons(profile, items)
    else:
        print("   정책DB 없음/후보 없음 → 추천 생략")
        recs = []

    bundle = ReportBundle(
        client=profile,
        consultedAt=datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        summary=summary,
        needs=needs,
        risks=risks,
        recommendations=recs
    )

    print(f"④ PDF 생성 → {args.out}")
    render_pdf(bundle, args.out)
    print("✅ 완료!")

if __name__ == "__main__":
    main()
