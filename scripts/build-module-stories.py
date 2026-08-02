#!/usr/bin/env python3
"""모듈 이야기(uniEquipDesc)를 오퍼별 JSON으로 뽑는다.

Usage: python3 scripts/build-module-stories.py [gamedata-dir]   # default: .gamedata

출처는 클뜯 `uniequip_table.json`의 `equipDict[*].uniEquipDesc` — 게임에서 모듈을
열었을 때 붙는 짧은 산문이다(탐사 일지·정비 보고서·편지 같은 형식). 모듈 472개 전부에
있고 평균 1,388자. KR·EN·JP 테이블이 각각 공식 번역이라 AI 번역을 거치지 않는다
(CN 선행 모듈만 CN 원문을 폴백으로 쓰고 scripts/cn-translations.json으로 덮는다).

⚠ 왜 operators.json에 안 넣는가: 전문이 로케일당 656KB(EN은 1.2MB)라 operators.json
(1.9MB)에 넣으면 목록 첫 로딩이 그만큼 무거워진다. 모듈 이야기는 **버튼을 눌러야**
보이는 것이라(사용자 요청 2026-08-02 "바로 보이게는 안 해도 되니까") 첫 화면에 있을
이유가 없다 — 프로필·보이스와 같은 관례로 **오퍼당 파일 1개**를 만들어
public/modules/<locale>/<id>.json에 쓰고, 버튼을 눌렀을 때만 받아온다
(R2 서빙 — scripts/r2-sync.mjs의 DIRS에 "modules"가 있어야 한다).

출력 형식:
  {"<uniEquipId>": "본문\n본문…", …}   # 모듈 id → 이야기 전문
"""
import json
import os
import re
import shutil
import sys

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = f"{REPO}/public/modules"

load = lambda p: json.load(open(p, encoding="utf-8"))

ops = load(f"{REPO}/app/data/operators.json")

# 로케일 → (테이블 접두사, 폴백 접두사). CN 선행 모듈은 로케일 테이블에 아직 없다.
LOCALES = {"ko": ("kr", "cn"), "en": ("en", "cn"), "ja": ("jp", "cn")}

MANUAL_PATH = f"{REPO}/scripts/cn-translations.json"
MANUAL = load(MANUAL_PATH) if os.path.exists(MANUAL_PATH) else {}
CJK_RE = re.compile(r"[㐀-鿿]")
untranslated = []


def clean(s):
    """게임 텍스트 정리 — 태그를 걷어내고 문단 구분은 살린다.

    원문은 줄마다 전각 공백/스페이스 4칸으로 들여쓰기돼 있다. 그대로 두면 화면에서
    삐뚤빼뚤해 보이므로 줄머리 공백만 떼고 줄바꿈은 문단 그대로 남긴다.
    """
    if not s:
        return ""
    s = re.sub(r"<[@$/][^>]*>", "", s).replace("</>", "")
    s = s.replace("\\n", "\n").replace("\r\n", "\n")
    lines = [re.sub(r"[ \t　]+", " ", ln).strip() for ln in s.split("\n")]
    out = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def localize(text, loc, mid):
    """CN 원문 한 편 → 사전에 있으면 그 로케일 번역, 없으면 원문 유지(+경고 집계)."""
    if not text:
        return text
    hit = MANUAL.get(text.strip())
    if hit and hit.get(loc):
        return hit[loc]
    if CJK_RE.search(text):
        untranslated.append((loc, mid, len(text)))
    return text


def main():
    tables = {}
    for prefix in {p for pair in LOCALES.values() for p in pair}:
        path = f"{S}/{prefix}_uniequip_table.json"
        if os.path.exists(path):
            tables[prefix] = (load(path).get("equipDict") or {})
        else:
            print(f"  ⚠ {path} 없음 — 이 접두사는 건너뜁니다")

    # ⚠ 안전장치 — 입력이 하나도 없는데 rmtree부터 하면 기존 산출물을 통째로 날린다
    #   (2026-08-01에 보이스 1,280개를 그렇게 잃었다).
    if not tables:
        print(f"uniequip_table을 하나도 못 읽었다 — 기존 산출물을 지우지 않고 중단한다 "
              f"(찾은 경로: {S}/*_uniequip_table.json)", file=sys.stderr)
        sys.exit(1)

    for locale, (main_prefix, fallback) in LOCALES.items():
        out_dir = f"{OUT_ROOT}/{locale}"
        shutil.rmtree(out_dir, ignore_errors=True)
        os.makedirs(out_dir, exist_ok=True)
        wrote = stories = fell_back = 0
        for op in ops:
            doc = {}
            for m in op.get("modules") or []:
                mid = m["id"]
                eq = (tables.get(main_prefix) or {}).get(mid)
                source = None
                if not eq or not (eq.get("uniEquipDesc") or "").strip():
                    eq = (tables.get(fallback) or {}).get(mid)
                    source = "cn"
                text = clean((eq or {}).get("uniEquipDesc"))
                if not text:
                    continue
                if source == "cn":
                    text = localize(text, locale, mid)
                    fell_back += 1
                doc[mid] = text
            if not doc:
                continue
            with open(f"{out_dir}/{op['id']}.json", "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
            wrote += 1
            stories += len(doc)
        size = sum(os.path.getsize(f"{out_dir}/{n}") for n in os.listdir(out_dir))
        print(f"{locale}: {wrote}명 · 모듈 이야기 {stories}편 · {size/1024:.0f}KB"
              f" (CN 폴백 {fell_back})")


if __name__ == "__main__":
    main()

# 미번역 CN 모듈 이야기 집계 — cn-translations.json에 채우면 사라진다
if untranslated:
    ko = [x for x in untranslated if x[0] == "ko"]
    print(f"  ⚠ 미번역 CN 모듈 이야기: {len(ko)}편 · {sum(x[2] for x in ko):,}자 "
          f"— scripts/cn-translations.json에 채울 것", file=sys.stderr)
