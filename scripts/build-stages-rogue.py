#!/usr/bin/env python3
"""작전 도감(/stages)에 얹는 **통합전략 작전 색인** — app/data/stages-rogue{,.en,.ja}.json.

사용:
  python3 scripts/build-stages-rogue.py     # 네트워크·클뜯 불필요 (기존 산출물만 읽는다)

입력은 이미 커밋된 `app/data/rogue{1..6}.json`(+`.en`/`.ja`)뿐이다 — 그래서 이 스크립트는
**build-rogue.py 뒤에** 돌린다 (kr-big-patch 스킬 3단계). 록라 데이터가 갱신됐는데 이걸
안 돌리면 도감 색인만 옛 데이터로 남는다.

⚠ KR/EN/JA를 **한 번에** 낸다 — build-i18n.py를 따로 돌릴 필요 없다 (CLAUDE.md 규칙 자체 충족).

⚠ **stages.json에 섞지 않는다.** 그 파일은 서버 전용 소비자가 둘이다 —
  app/seo-stage.ts(상세 페이지 데이터)와 scripts/build-sitemap.mjs(generateStaticParams).
  거기에 693개를 섞으면 상세 페이지가 693×6 = 4,158파일 늘어 Cloudflare Pages의 배포당
  20,000파일 한도를 넘긴다(2026-08-15 실측: 스테이징 약 17,100 → 여유 약 2,900).
  통합전략은 **종료된 이벤트와 같은 취급** — 목록과 모달(#st-<id>)로만 본다.
  별도 파일이면 목록 탭(app/stages.tsx, 이미 lazy 청크)만 커지고 서버 쪽은 그대로다.

출력 형식은 도감이 그대로 먹는 **자기 완결형 미니 StageDoc**이다 (app/stage-data.ts).
사전 인덱스는 이 파일 안에서만 유효하고, 화면에서 mergeRogueDoc()이 본 문서 뒤에 이어 붙이며
재매핑한다.
"""
import json, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "app", "data")
LOCALES = [("ko", ""), ("en", ".en"), ("ja", ".ja")]
TOPICS = [1, 2, 3, 4, 5, 6]

# 계열 라벨 — 도감 '작전 계열' 필터에 이 한 칸이 생긴다 (i18n "통합전략"과 같은 문구)
TYPE_LABEL = {"ko": "통합전략", "en": "Integrated Strategies", "ja": "統合戦略"}
# 작전 종류 — app/rogue.tsx KIND_LABEL과 **같은 문구**를 쓴다 (두 화면이 같은 배지를 읽게)
KIND_LABEL = {
    "ko": {"normal": "작전", "emergency": "긴급 작전", "boss": "험난한 길", "event": "조우 전투",
           "special": "특수", "duel": "외나무다리", "trial": "시련", "chase": "추격전",
           "savage": "거점전", "incident": "조우 전투"},
    "en": {"normal": "Stages", "emergency": "Emergency Operation", "boss": "Dreadful Foe",
           "event": "Encounter battle", "special": "Special", "duel": "Duel", "trial": "Trial",
           "chase": "Chase", "savage": "Stronghold", "incident": "Encounter battle"},
    "ja": {"normal": "作戦", "emergency": "緊急作戦", "boss": "悪路凶敵", "event": "遭遇戦",
           "special": "特殊", "duel": "一本橋", "trial": "試練", "chase": "追撃戦",
           "savage": "拠点戦", "incident": "遭遇戦"},
}
# 구역이 없는 노드(시련·외나무다리·돌발 등 — IS5만 86개) — 구역 필터에서 한 칸으로 모은다
NO_ZONE = {"ko": "구역 무관", "en": "Any zone", "ja": "ゾーン無関係"}


def load_topic(n, suffix):
    """로케일 파일이 없으면 KR로 폴백 — IS6(흑류수해)는 CN 선행이라 공식 EN/JA 텍스트가
    아예 없다. /rogue도 전 로케일이 rogue6.json을 공유하므로 같은 규칙을 쓴다."""
    path = os.path.join(DATA, f"rogue{n}{suffix}.json")
    if not os.path.exists(path):
        path = os.path.join(DATA, f"rogue{n}.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


mismatched = []  # 도면 파일명 ≠ 작전 id (있으면 화면이 404를 문다 — 아래에서 경고)
skipped = set()  # 테마 적 사전에 없는 스폰 변종 키 (정상 — /rogue도 같은 것을 거른다)


def build(loc, suffix):
    zone_list, zone_ix = [], {}
    ev_list, ev_ix = [], {}
    enemy_list, enemy_ix = [], {}
    enemy_names = {}
    stages = []

    def intern(v, lst, ix):
        if v not in ix:
            ix[v] = len(lst)
            lst.append(v)
        return ix[v]

    for n in TOPICS:
        d = load_topic(n, suffix)
        ev = intern(d["name"], ev_list, ev_ix)
        zone_of = {z["num"]: z["name"] for z in d.get("zones") or [] if z.get("num") is not None}
        enemy_db = d.get("enemies") or {}
        for s in d.get("stages") or []:
            zname = zone_of.get(s.get("zone")) or NO_ZONE[loc]
            rec = {
                "id": s["id"],
                "code": s.get("code") or s["id"],
                "name": s.get("name") or s["id"],
                "t": "ROGUE",
                "ev": ev,
                "z": intern(zname, zone_list, zone_ix),
                # 도면·이동 경로의 출처가 다르다는 표식 — public/rogue/map/ 과 rogue-routes.json.
                # 이미지를 public/stage/로 복사·이동하지 않는다 (2026-08-08 록라 폴더 사고:
                # 에셋과 페이지가 같은 폴더에 섞여 배포 때마다 테마 페이지가 사라졌다).
                "rg": 1,
            }
            if s.get("desc"):
                rec["desc"] = s["desc"]
            # 도면 파일명 = 작전 id (2026-08-16 실측 693/693 일치) — 그래서 플래그만 싣고
            # 화면은 id로 public/rogue/map/<id>.webp를 문다. 어긋나면 아래에서 경고한다.
            if s.get("map"):
                rec["map"] = 1
                if s["map"] != s["id"]:
                    mismatched.append(f'{s["id"]} → {s["map"]}')
            kind = KIND_LABEL[loc].get(s.get("kind")) or s.get("kind")
            if kind:
                rec["kind"] = kind
            # 등장 적 — 록라 데이터엔 스탯 강화단계가 없어 lv는 0으로 둔다 (본 도감과 같은 3열 형식).
            # ⚠ 테마 적 사전에 없는 키는 **버린다** — `enemy_2041_syjely_c`·`enemy_1056_ganwar#1`
            #   같은 내부 스폰 변종이라 이름도 초상도 없다(전체 1,031개 중 102개). /rogue도
            #   `if (!e) return null`로 같은 것을 걸러내므로(app/rogue.tsx) 두 화면이 일치한다.
            e = []
            for en in s.get("enemies") or []:
                key = en.get("key")
                info = enemy_db.get(key) if key else None
                if not info or not info.get("name"):
                    if key:
                        skipped.add(key)
                    continue
                ix = intern(key, enemy_list, enemy_ix)
                enemy_names.setdefault(key, info["name"])
                e.append([ix, en.get("cnt") or 0, 0])
            if e:
                rec["e"] = e
            stages.append(rec)

    return {
        "zones": zone_list, "events": ev_list, "items": {}, "occ": [], "kinds": [],
        "enemyIds": enemy_list,
        "types": {"ROGUE": TYPE_LABEL[loc]},
        "enemyNames": {eid: enemy_names.get(eid, eid) for eid in enemy_list},
        "stages": stages,
    }


by_loc = {loc: build(loc, suffix) for loc, suffix in LOCALES}

for loc, suffix in LOCALES:
    p = os.path.join(DATA, f"stages-rogue{suffix}.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(by_loc[loc], f, ensure_ascii=False, separators=(",", ":"))
    doc = by_loc[loc]
    print(f"  {os.path.basename(p)}: 작전 {len(doc['stages'])}개 · 테마 {len(doc['events'])} · "
          f"구역 {len(doc['zones'])} · 적 {len(doc['enemyIds'])} · {os.path.getsize(p) // 1024}KB")

if skipped:
    print(f"  이름 없는 스폰 변종 {len(skipped)}종은 등장 적에서 제외 (정상 — /rogue와 같은 규칙): "
          f"{sorted(skipped)[:3]}")

ko = by_loc["ko"]
no_map = [s["id"] for s in ko["stages"] if not s.get("map")]
if no_map:
    print(f"  ⚠ 도면 없는 작전 {len(no_map)}개 예: {no_map[:5]}", file=sys.stderr)
if mismatched:
    print(f"  ⚠ 도면 파일명이 작전 id와 다른 것 {len(set(mismatched))}개 — 도감이 404를 문다. "
          f"stageMap()에 파일명을 실어야 한다: {sorted(set(mismatched))[:5]}", file=sys.stderr)

# 미번역 감시 — EN/JA에 한글이 남아 있으면 KR 폴백이다.
# **IS6(흑류수해)는 예외** — CN 선행이라 공식 EN/JA 텍스트가 없다 (위 load_topic 주석).
HANGUL = re.compile(r"[가-힣]")
for loc in ("en", "ja"):
    left = [s["code"] for s in by_loc[loc]["stages"]
            if not s["id"].startswith("ro6_") and HANGUL.search(s["name"] or "")]
    if left:
        print(f"  ⚠ {loc}: 이름 미번역 {len(left)}개 (KR 폴백) 예: {left[:5]}", file=sys.stderr)
