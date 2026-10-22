#!/usr/bin/env python3
"""만능검색용 작전 이름표 → app/data/stage-names.json (2026-10-22, 사용자 제보 "H17-4 검색했는데 아무것도 안 나온다").

app/data/stages(.en|.ja).json 에서 작전 코드·이름·구역만 뽑는다 (build-stages.py 끝에서 자동으로 부른다).
  { ids: [...], code: [...], ko: [...], en: [...], ja: [...], zone: [구역 이름(ko)…] }
만능검색 패널을 열 때 한 번 받는다(app/omni-search.tsx) — 작전 데이터 전체(1.5MB)는 받지 않는다.
"""
import json
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = f"{REPO}/app/data"
docs = {loc: json.load(open(f"{DATA}/stages{'' if loc == 'ko' else '.' + loc}.json", encoding="utf-8")) for loc in ("ko", "en", "ja")}
names = {loc: {s["id"]: s.get("name") or "" for s in d["stages"]} for loc, d in docs.items()}
zones = docs["ko"]["zones"]
out = {"ids": [], "code": [], "ko": [], "en": [], "ja": [], "zone": []}
for s in docs["ko"]["stages"]:
    sid = s["id"]
    out["ids"].append(sid)
    out["code"].append(s.get("code") or "")
    out["ko"].append(s.get("name") or "")
    for loc in ("en", "ja"):
        v = names[loc].get(sid) or ""
        out[loc].append("" if v == s.get("name") else v)   # 한국어와 같으면 비운다(용량)
    z = s.get("z")
    out["zone"].append(zones[z] if isinstance(z, int) and 0 <= z < len(zones) else "")
p = f"{DATA}/stage-names.json"
json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"stage-names.json: 작전 {len(out['ids'])}개 · {os.path.getsize(p)//1024}KB")
