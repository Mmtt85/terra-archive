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

# 테마 통칭 — 사용자 지시 2026-08-16 "팬텀·미즈키·사미·살카즈·쉐이라고 하는 별칭도 괄호로".
# 정식 이름이 길어 목록에서 알아보기 어렵고("탐험가의 은빛 서리 끝자락"), 다들 통칭으로 부른다.
# 이름에 붙여 두면 필터 라벨·카드·**검색어**가 한꺼번에 통칭을 먹는다 (도감 검색이 이벤트
# 이름을 포함하므로 "사미"로 검색하면 IS3 작전이 잡힌다).
# ⚠ **KR에만 붙인다** — 이건 한국 커뮤니티 통칭이고, EN/JA의 통칭은 확인된 바가 없다.
# ⚠ 통칭이 이미 정식 이름 안에 있으면 괄호를 붙이지 않는다 — IS6 "침몰자의 블랙플로우 (블랙플로우)"는
#   군더더기다. 목록 순서는 아래 stageFilterTree가 출시순(IS1→IS6)으로 잡는다.
ALIAS_KO = {1: "팬텀", 2: "미즈키", 3: "사미", 4: "살카즈", 5: "쉐이", 6: "블랙플로우"}

# 구역 = 그 테마의 층. /rogue의 zoneBadge와 **같은 표기**를 쓴다 (app/rogue.tsx `{n}층`).
# IS5의 시비경·금석경처럼 num이 90/91인 특수 구역은 층이 아니므로 이름만 둔다.
FLOOR_MAX = 20
FLOOR_FMT = {"ko": "{n}층 {name}", "en": "F{n} {name}", "ja": "{n}層 {name}"}


def load_topic(n, suffix):
    """로케일 파일이 없으면 KR로 폴백 — IS6(블랙플로우)는 CN 선행이라 공식 EN/JA 텍스트가
    아예 없다. /rogue도 전 로케일이 rogue6.json을 공유하므로 같은 규칙을 쓴다."""
    path = os.path.join(DATA, f"rogue{n}{suffix}.json")
    if not os.path.exists(path):
        path = os.path.join(DATA, f"rogue{n}.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# 시뮬레이트 가능 여부 — 작전 시뮬레이터(/sim)가 통합전략 작전도 찾게 (사용자 요청 2026-09-23).
# 본 도감의 sim-stages.json 과 같은 판정: 경로 데이터에 스폰(sp)·웨이브(wv)가 있으면 된다.
_ROUTES = json.load(open(os.path.join(DATA, "rogue-routes.json"), encoding="utf-8"))


def _can_sim(sid):
    r = _ROUTES.get(sid)
    if isinstance(r, str):
        r = _ROUTES.get(r)
    return bool(r and r.get("sp") and r.get("wv"))


# 적 코어 스탯 — 작전 도감 칸은 적 도감 스탯 색인(enemy-stats.json)의 기본형 수치를 쓰는데, 통합전략
# 레벨 파일은 적 수치를 자주 덮어쓴다(overwrittenData) — 1,601종 중 313종이 색인과 다르다 (2026-09-23
# 실측: 산성 원석충 공격 색인 180 ↔ 팬텀 100). 색인과 다른 적만 레코드가 직접 들고 간다 — 생존연산과
# 같은 `es` 규약(e와 같은 순서, 0 = 색인 값 그대로). /rogue 전투 노드 모달의 칸과 같은 수치가 나온다.
_STATS = json.load(open(os.path.join(DATA, "enemy-stats.json"), encoding="utf-8"))


def _own_stats(key, info):
    """테마 수치 [hp, atk, def, res] — 색인 기본형과 같으면 0 (색인에 없는 적은 늘 싣는다)."""
    mine = [info.get("hp"), info.get("atk"), info.get("def"), info.get("res")]
    if any(v is None for v in mine):
        return 0
    rows = _STATS.get(key) or []
    row = next((r for r in rows if r[0] == 0), rows[0] if rows else None)
    if row and all(abs(a - b) < 1e-9 for a, b in zip(row[1:5], mine)):
        return 0
    return mine


mismatched = []  # 도면 파일명 ≠ 작전 id (있으면 화면이 404를 문다 — 아래에서 경고)
skipped = set()  # 테마 적 사전에 없는 스폰 변종 키 (정상 — /rogue도 같은 것을 거른다)


def build(loc, suffix):
    zone_list, zone_ix = [], {}
    ev_list, ev_ix = [], {}
    enemy_list, enemy_ix = [], {}
    enemy_names = {}
    theme_img = {}   # 적 키 → 테마 초상 파일 이름 (rogueN.json 의 img — build-rogue.py 가 받은 것)
    stages = []

    def intern(v, lst, ix):
        if v not in ix:
            ix[v] = len(lst)
            lst.append(v)
        return ix[v]

    for n in TOPICS:
        d = load_topic(n, suffix)
        alias = ALIAS_KO.get(n) if loc == "ko" else None
        if alias and alias in d["name"]:
            alias = None       # 이름에 이미 들어 있으면 괄호는 군더더기 (IS6 블랙플로우)
        ev = intern(f'{d["name"]} ({alias})' if alias else d["name"], ev_list, ev_ix)
        zone_of = {}
        for z in d.get("zones") or []:
            num = z.get("num")
            if num is None:
                continue
            zone_of[num] = (FLOOR_FMT[loc].format(n=num, name=z["name"])
                            if num <= FLOOR_MAX else z["name"])
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
            if _can_sim(s["id"]):
                rec["sim"] = 1
            kind = KIND_LABEL[loc].get(s.get("kind")) or s.get("kind")
            if kind:
                rec["kind"] = kind
            # 등장 적 — 록라 데이터엔 스탯 강화단계가 없어 lv는 0으로 둔다 (본 도감과 같은 3열 형식).
            # ⚠ 테마 적 사전에 없는 키는 **버린다** — `enemy_2041_syjely_c`·`enemy_1056_ganwar#1`
            #   같은 그 판 전용 변종이라 테마 사전에 이름·초상이 없다(전체 1,031개 중 102개). /rogue도
            #   `if (!e) return null`로 같은 것을 걸러내므로(app/rogue.tsx) 두 화면이 일치한다.
            #   경로·시뮬 말풍선의 이름·초상은 경로 문서의 nm 이 채운다 (scripts/routenames.py, 2026-09-23).
            e, es = [], []
            for en in s.get("enemies") or []:
                key = en.get("key")
                info = enemy_db.get(key) if key else None
                if not info or not info.get("name"):
                    if key:
                        skipped.add(key)
                    continue
                ix = intern(key, enemy_list, enemy_ix)
                enemy_names.setdefault(key, info["name"])
                if info.get("img"):
                    theme_img.setdefault(key, info["img"])
                e.append([ix, en.get("cnt") or 0, 0])
                es.append(_own_stats(key, info))
            if e:
                rec["e"] = e
                if any(es):
                    rec["es"] = es
            stages.append(rec)

    # 초상 — 작전 도감 칸·시뮬 말은 적 도감 초상(public/enemy/<id>.webp)을 무는데, 통합전략 전용 적
    # 41종은 거기 없고 테마 초상(public/rogue/enemy/<img>.webp)만 있어 까맣게 비었다 (2026-09-23 실측 —
    # 쉐이 한 종이 178작전). 적 도감 초상이 없는 적만 테마 초상 경로를 덮어쓴다 (생존연산 enemyImg 와 같은 규약).
    enemy_img = {}
    for eid in enemy_list:
        base = re.sub(r"_\d+$", "", eid)
        if any(os.path.exists(os.path.join(REPO, "public", "enemy", f"{c}.webp")) for c in (eid, base)):
            continue
        img = theme_img.get(eid)
        if img and os.path.exists(os.path.join(REPO, "public", "rogue", "enemy", f"{img}.webp")):
            enemy_img[eid] = f"/rogue/enemy/{img}.webp"
    return {
        "zones": zone_list, "events": ev_list, "items": {}, "occ": [], "kinds": [],
        "enemyIds": enemy_list,
        "types": {"ROGUE": TYPE_LABEL[loc]},
        "enemyNames": {eid: enemy_names.get(eid, eid) for eid in enemy_list},
        **({"enemyImg": enemy_img} if enemy_img else {}),
        "stages": stages,
    }


by_loc = {loc: build(loc, suffix) for loc, suffix in LOCALES}

# 실사 도면 위 경로 투영용 전투 카메라 (2026-09-23) — 출처·근거는 scripts/stagecams.py 머리주석.
# 록라 도면(public/rogue/map)도 같은 인게임 미리보기라 같은 규칙으로 붙는다.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stagecams  # noqa: E402
for loc, suffix in LOCALES:
    _prev = os.path.join(DATA, f"stages-rogue{suffix}.json")
    _keep = {e["id"]: e["cam"] for e in json.load(open(_prev, encoding="utf-8"))["stages"] if "cam" in e} \
        if os.path.exists(_prev) else {}
    stagecams.attach(by_loc[loc], os.path.join(REPO, "public", "rogue", "map"), keep=_keep)
stagecams.write_rogue_cams(by_loc["ko"])   # /rogue 모달용 (카메라는 로케일 무관)

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
# **IS6(블랙플로우)는 예외** — CN 선행이라 공식 EN/JA 텍스트가 없다 (위 load_topic 주석).
HANGUL = re.compile(r"[가-힣]")
for loc in ("en", "ja"):
    left = [s["code"] for s in by_loc[loc]["stages"]
            if not s["id"].startswith("ro6_") and HANGUL.search(s["name"] or "")]
    if left:
        print(f"  ⚠ {loc}: 이름 미번역 {len(left)}개 (KR 폴백) 예: {left[:5]}", file=sys.stderr)
