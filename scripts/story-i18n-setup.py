# -*- coding: utf-8 -*-
# 스토리 요약 다국어화 1단계 — 번역 작업 스캐폴드 생성.
#
# story-summaries.json(한국어, AI 집필)은 게임 공식 번역 소스가 없어 Claude가 직접
# 번역한다. 이 스크립트는 번역을 배치·검증·병합하기 위한 작업 디렉터리를 만든다:
#   scripts/story-i18n/ko/<id>.json   — 이벤트별 한국어 원본 (사람이 읽기 좋게 들여쓰기)
#   scripts/story-i18n/glossary.en.json / glossary.ja.json
#                                     — 오퍼레이터·진영 고유명사 KO→로케일 사전
#                                       (operators.{en,ja}.json에서 추출, 표기 일관성용)
#   app/data/story-summary-ids.json   — 요약이 있는 이벤트 id 목록 (story.tsx가 존재 확인에 사용)
#   app/data/story-summaries.{en,ja}.json
#                                     — 아직 없으면 KO 복사본으로 초기화 (빌드가 깨지지 않게).
#                                       번역이 끝나면 story-i18n-merge.py가 덮어쓴다.
import json, os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load = lambda p: json.load(open(p, encoding="utf-8"))
DUMP = dict(ensure_ascii=False)

ko = load(f"{REPO}/app/data/story-summaries.json")
WORK = f"{REPO}/scripts/story-i18n"
os.makedirs(f"{WORK}/ko", exist_ok=True)
os.makedirs(f"{WORK}/en", exist_ok=True)
os.makedirs(f"{WORK}/ja", exist_ok=True)

# 1) 이벤트별 KO 원본 (들여쓰기 2칸 — 번역 서브에이전트가 읽고 대조하기 쉽게)
for eid, summary in ko.items():
    json.dump(summary, open(f"{WORK}/ko/{eid}.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

# 2) 고유명사 용어집 (오퍼 이름 + 진영 이름). 같은 id로 KO↔로케일 매칭.
kr_ops = load(f"{REPO}/app/data/operators.json")
kr_by_id = {o["id"]: o for o in kr_ops}
for loc in ("en", "ja"):
    loc_ops = load(f"{REPO}/app/data/operators.{loc}.json")
    ops_map, fac_map = {}, {}
    for lo in loc_ops:
        ko_o = kr_by_id.get(lo["id"])
        if not ko_o:
            continue
        if ko_o["name"] != lo["name"]:
            ops_map[ko_o["name"]] = lo["name"]
        for ka, la in zip(ko_o.get("factions", []), lo.get("factions", [])):
            if ka and la and ka != la:
                fac_map[ka] = la
    glossary = {"operators": ops_map, "factions": fac_map}
    json.dump(glossary, open(f"{WORK}/glossary.{loc}.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=2, sort_keys=True)
    print(f"glossary.{loc}: {len(ops_map)} ops, {len(fac_map)} factions")

# 3) 요약 id 목록 (story.tsx 모듈 레벨 존재 확인용 — 로케일 무관)
json.dump(sorted(ko.keys()), open(f"{REPO}/app/data/story-summary-ids.json", "w", encoding="utf-8"),
          ensure_ascii=False)
print(f"story-summary-ids.json: {len(ko)} ids")

# 4) 로케일 요약 파일 초기화 (없을 때만 — 재실행이 번역을 날리지 않게)
for loc in ("en", "ja"):
    out = f"{REPO}/app/data/story-summaries.{loc}.json"
    if not os.path.exists(out):
        json.dump(ko, open(out, "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
        print(f"story-summaries.{loc}.json: KO 복사본으로 초기화")
    else:
        print(f"story-summaries.{loc}.json: 이미 존재 — 유지")

print(f"\n작업 디렉터리: {WORK}/  (이벤트 {len(ko)}개)")
