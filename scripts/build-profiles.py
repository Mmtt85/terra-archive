#!/usr/bin/env python3
"""오퍼레이터 프로필(아카이브 파일) 텍스트를 오퍼별 JSON으로 뽑는다.

Usage: python3 scripts/build-profiles.py [gamedata-dir]   # default: .gamedata

출처는 클뜯 `handbook_info_table.json`의 `handbookDict[*].storyTextAudio` —
게임 내 오퍼레이터 기록실의 '기본정보 / 종합검진 / 프로필 / 임상 진단 분석 /
파일 자료 N / 승진 기록' 문서 전문이다. KR·EN·JP 테이블이 각각 공식 번역이라
AI 번역을 거치지 않는다 (미실장 오퍼만 CN을 폴백으로 쓴다).

⚠ 왜 operators.json에 안 넣는가: 전문을 합치면 4.5MB로 operators.json(1.7MB)의
약 3배다. operators.json은 목록 화면에 통째로 실리므로 넣으면 첫 로딩이 무거워진다.
그래서 **오퍼당 파일 1개**(평균 ~11KB)로 쪼개 public/profiles/<locale>/<id>.json에
쓰고, 상세 모달을 열 때만 그 한 장을 받아온다(R2 서빙 — scripts/r2-sync.mjs).

출력 형식 (배열, 게임 내 문서 순서):
  [{ "title": "기본정보", "text": "...", "unlock": null },
   { "title": "임상 진단 분석", "text": "...", "unlock": {"type": "FAVOR", "param": "25"} }]
  unlock: null = 즉시 열람(DIRECT). FAVOR=신뢰도, AWAKE=승진(param "2;1" = 정예화2 1단계).
"""
import json
import os
import re
import shutil
import sys

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = f"{REPO}/public/profiles"

load = lambda p: json.load(open(p, encoding="utf-8"))

# 사이트에 수록된 오퍼만 — 클뜯엔 NPC·적 핸드북도 섞여 있다
ops = [o["id"] for o in load(f"{REPO}/app/data/operators.json")]

# 로케일 → (핸드북 테이블 접두사, 폴백 접두사). 미실장 오퍼는 로케일 테이블에 아직
# 없으므로 CN 원문으로 폴백한다 (사이트가 빈 화면이 되는 것보다 낫다 — 모달이 원문
# 표기임을 안내한다).
LOCALES = {"ko": ("kr", "cn"), "en": ("en", "cn"), "ja": ("jp", "cn")}


def clean(s):
    """게임 텍스트 태그 정리 — <color>·<@…> 류를 걷어내고 줄바꿈은 살린다."""
    if not s:
        return ""
    s = re.sub(r"<[@$/][^>]*>", "", s).replace("</>", "")
    s = re.sub(r"</?[a-zA-Z][^>]*>", "", s)
    s = s.replace("\\n", "\n").replace("\r\n", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return "\n".join(line.strip() for line in s.split("\n")).strip()


def sections(entry):
    out = []
    for sta in entry.get("storyTextAudio") or []:
        title = (sta.get("storyTitle") or "").strip()
        for st in sta.get("stories") or []:
            text = clean(st.get("storyText"))
            if not text:
                continue
            kind = st.get("unLockType")
            param = st.get("unLockParam")
            out.append({
                "title": title,
                "text": text,
                # DIRECT(즉시)·빈 조건은 null로 접어 파일을 가볍게 한다
                "unlock": None if kind in (None, "", "DIRECT") else {"type": kind, "param": param},
            })
    return out


written = {}
for loc, (prefix, fallback) in LOCALES.items():
    table = load(f"{S}/{prefix}_handbook_info_table.json")
    table = table.get("handbookDict", table)
    fb = load(f"{S}/{fallback}_handbook_info_table.json")
    fb = fb.get("handbookDict", fb)

    out_dir = f"{OUT_ROOT}/{loc}"
    shutil.rmtree(out_dir, ignore_errors=True)  # 삭제된 오퍼의 잔재 정리
    os.makedirs(out_dir, exist_ok=True)

    n = fallbacks = 0
    for cid in ops:
        entry = table.get(cid)
        used_fallback = False
        if not entry:
            entry = fb.get(cid)
            used_fallback = bool(entry)
        if not entry:
            continue
        secs = sections(entry)
        if not secs:
            continue
        payload = {"id": cid, "sections": secs}
        if used_fallback:
            payload["source"] = "cn"  # 미실장 — 모달이 '중국 서버 원문' 안내를 띄운다
        with open(f"{out_dir}/{cid}.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        n += 1
        fallbacks += used_fallback
    written[loc] = (n, fallbacks)

total = sum(
    os.path.getsize(os.path.join(dp, fn))
    for loc in LOCALES for dp, _, fns in os.walk(f"{OUT_ROOT}/{loc}") for fn in fns
)
for loc, (n, fb) in written.items():
    print(f"profiles/{loc}: {n}명" + (f" (CN 원문 폴백 {fb}명)" if fb else ""))
print(f"합계 {sum(n for n, _ in written.values())}개 파일 · {total / 1024 / 1024:.1f} MB"
      f" · 평균 {total / max(1, sum(n for n, _ in written.values())) / 1024:.1f} KB")
print("→ R2 반영: node scripts/r2-sync.mjs")
