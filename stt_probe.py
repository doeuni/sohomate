# stt_probe.py
import os, time
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), timeout=30)  # 30초 타임아웃

with open("sample.wav","rb") as f:
    print("⏳ Whisper 호출중…(timeout=30s)")
    t0=time.time()
    r = client.audio.transcriptions.create(model="whisper-1", file=f, response_format="text")
    dt = time.time()-t0
    print(f"✅ 완료 {dt:.1f}s, 미리보기:", str(r)[:120])
