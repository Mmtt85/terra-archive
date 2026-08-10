#!/usr/bin/env python3
"""적 도감 데이터 빌드 — 오퍼 백과사전(/operators)의 적 버전(/enemies).

사용:
  python3 scripts/build-enemies.py                # 전부 (레벨 파일 ~2,285개 · 최초 1회 ~1분 · 캐시 179MB)
  python3 scripts/build-enemies.py --meta-only    # 등장 작전 역색인 생략 (무인 CI용)
  python3 scripts/build-enemies.py --no-images    # 초상 다운로드 생략

⚠ 이 스크립트는 **KR/EN/JA를 한 번에** 낸다. CLAUDE.md의 "KR 데이터를 재생성하면
  build-i18n.py로 EN/JA도 재생성" 규칙은 여기서 자체 충족되므로 따로 돌릴 필요가 없다.

⚠ --meta-only는 `app/data/enemy-stages*.json`을 **건드리지 않고 그대로 둔다**. 무인
  파이프라인(docs/AUTOMATION.md)은 179MB 레벨 파일을 매번 받을 수 없어 이 모드로 돈다.
  새 이벤트 스테이지의 등장 적을 반영하려면 로컬에서 인자 없이 한 번 돌려야 한다.

출력:
  app/data/enemies.json / .en.json / .ja.json        적 1,514종의 도감 본문 + 스탯
  app/data/enemy-stages.json / .en / .ja             등장 작전 역색인 (--meta-only면 유지)
  app/data/enemy-names.json                          만능검색(app/omni.ts)용 경량 색인
  public/enemy/<id>.webp                             초상 (gitignore·R2 서빙)

입력:
  .gamedata/{kr,en,jp}_enemy_handbook_table.json     도감 텍스트 (이름·설명·능력·등급)
  .gamedata/{kr,en,jp}_stage_table.json / _zone_table.json
  levels/enemydata/enemy_database.json               스탯 원본 (서버 공통 수치)
  levels/<levelId>.json                              스테이지별 등장 적·스폰 수
"""
import json, os, re, shutil, sys, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"
# 게임데이터 폴더는 다른 빌드 스크립트와 같은 규약: 첫 위치 인자 > GAMEDATA_DIR > .gamedata
_pos = [a for a in sys.argv[1:] if not a.startswith("-")]
S = _pos[0] if _pos else os.environ.get("GAMEDATA_DIR", os.path.join(REPO, ".gamedata"))
CACHE = os.path.join(REPO, ".gamedata", "levels")
# build-rogue.py가 이미 받아 둔 14MB 사본이 있으면 재사용한다 (같은 파일이다)
ROGUE_CACHE = os.path.join(REPO, ".gamedata", "rogue")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp  # noqa: E402

META_ONLY = "--meta-only" in sys.argv
NO_IMAGES = "--no-images" in sys.argv

# 로케일 ↔ 게임데이터 접두. 출력 접미는 ko="" / en=".en" / ja=".ja".
LOCALES = [("ko", "kr", ""), ("en", "en", ".en"), ("ja", "jp", ".ja")]

load = lambda p: json.load(open(p, encoding="utf-8"))

# ── build-rogue.py에서 가져온, 이미 검증된 규약들 ───────────────────────────
# (같은 원본 테이블을 읽으므로 규약이 갈리면 통합전략 적 도감과 표기가 어긋난다)

# 적 이름 교정 — 클뜯 표기가 통칭과 다른 보스 등 (사용자 확정). 재생성해도 유지된다.
ENEMY_NAME_FIX = {"캔모씨": "캔낫"}

IMMUNE_FIELDS = ["stunImmune", "silenceImmune", "sleepImmune", "frozenImmune", "levitateImmune",
                 "disarmedCombatImmune", "fearedImmune", "palsyImmune", "attractImmune", "teleportImmune"]
IMMUNE_LABELS = {
    "ko": ["기절", "침묵", "수면", "빙결", "부양", "무장 해제", "공포", "마비", "흡인", "강제 이동"],
    "en": ["Stun", "Silence", "Sleep", "Freeze", "Levitate", "Disarm", "Fear", "Paralysis", "Pull", "Forced movement"],
    "ja": ["スタン", "沈黙", "睡眠", "凍結", "浮遊", "武装解除", "恐怖", "麻痺", "吸引", "強制移動"],
}
DAMAGE_LABELS = {
    "ko": {"PHYSIC": "물리", "MAGIC": "마법", "NO_DAMAGE": "피해 없음", "HEAL": "치유"},
    "en": {"PHYSIC": "Physical", "MAGIC": "Arts", "NO_DAMAGE": "No damage", "HEAL": "Healing"},
    "ja": {"PHYSIC": "物理", "MAGIC": "術", "NO_DAMAGE": "ダメージなし", "HEAL": "治療"},
}
# applyWay(공격 방식) / motion(이동). NONE·ALL은 게임 표기가 없어 그대로 안 쓴다.
WAY_LABELS = {
    "ko": {"MELEE": "근접", "RANGED": "원거리", "ALL": "근접·원거리", "NONE": "공격 없음"},
    "en": {"MELEE": "Melee", "RANGED": "Ranged", "ALL": "Melee & Ranged", "NONE": "No attack"},
    "ja": {"MELEE": "近接", "RANGED": "遠距離", "ALL": "近接・遠距離", "NONE": "攻撃なし"},
}
MOTION_LABELS = {
    "ko": {"WALK": "지상", "FLY": "비행"},
    "en": {"WALK": "Ground", "FLY": "Flying"},
    "ja": {"WALK": "地上", "FLY": "飛行"},
}
# 종족 태그가 없는 적이 905/1,514다 (원본에 정말로 없다 — 지어내지 않는다)
UNTAGGED = {"ko": "미분류", "en": "Unclassified", "ja": "未分類"}
# 구역 이름이 비어 있을 때의 폴백. 옛 이벤트 구역은 zone_table에 이름이 통째로 null이거나
# 행 자체가 없다(act2multi_zone1·act2break_zone3 실측) — 빈 칸을 두느니 계열명을 준다.
ZONE_TYPE_LABELS = {
    "ko": {"CLIMB_TOWER": "보안 파견", "CAMPAIGN": "섬멸 작전", "WEEKLY": "자원 확보", "DAILY": "자원 확보",
           "ACTIVITY": "이벤트", "SIDESTORY": "사이드 스토리", "MAIN": "메인 스토리", "SUB": "막간 이야기",
           "SPECIAL_STORY": "특별 작전", "GUIDE": "튜토리얼"},
    "en": {"CLIMB_TOWER": "Stationary Security Service", "CAMPAIGN": "Annihilation", "WEEKLY": "Supply", "DAILY": "Supply",
           "ACTIVITY": "Event", "SIDESTORY": "Side Story", "MAIN": "Main Theme", "SUB": "Intermezzi",
           "SPECIAL_STORY": "Special Operation", "GUIDE": "Tutorial"},
    "ja": {"CLIMB_TOWER": "保全駐在", "CAMPAIGN": "殲滅作戦", "WEEKLY": "資源調達", "DAILY": "資源調達",
           "ACTIVITY": "イベント", "SIDESTORY": "サイドストーリー", "MAIN": "メインテーマ", "SUB": "幕間",
           "SPECIAL_STORY": "特別作戦", "GUIDE": "チュートリアル"},
}


def mv(field, default=None):
    """enemy_database의 {m_defined, m_value} 언랩."""
    if isinstance(field, dict) and "m_defined" in field:
        return field["m_value"] if field["m_defined"] else default
    return field if field is not None else default


def clean(s):
    """리치 텍스트 태그(<@eb.key>…</>)를 벗긴다."""
    if not isinstance(s, str):
        return s
    s = re.sub(r"</?[@$a-zA-Z][^>]*>|</>", "", s.replace("\r\n", "\n").replace("\\n", "\n"))
    return re.sub(r"[ \t]+", " ", s).strip() or None


def num(v):
    """1.0 → 1 (JSON 크기 · 표시 둘 다)."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return round(v, 3) if isinstance(v, float) else v


def fetch_level(path, cache_dir=CACHE):
    """gamedata의 levels/ 파일 — 로컬 캐시. 404(삭제된 스테이지)는 None."""
    dest = os.path.join(cache_dir, path.replace("/", "__"))
    if os.path.exists(dest):
        try:
            return load(dest)
        except json.JSONDecodeError:
            os.remove(dest)  # 중단된 다운로드 잔재
    req = urllib.request.Request(f"{GAMEDATA}/kr/gamedata/{path}", headers={"User-Agent": "Mozilla/5.0"})
    try:
        raw = urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, "wb").write(raw)
    return json.loads(raw)


# ── 1. 스탯 원본 ────────────────────────────────────────────────────────────
os.makedirs(CACHE, exist_ok=True)
_shared = os.path.join(ROGUE_CACHE, "levels__enemydata__enemy_database.json")
if os.path.exists(_shared):
    enemy_db = load(_shared)          # build-rogue.py가 이미 받아 둔 14MB — 다시 받지 않는다
else:
    enemy_db = fetch_level("levels/enemydata/enemy_database.json")
print(f"enemy_database: {len(enemy_db)}종")


def first_defined(recs, key):
    """레벨 레코드마다 m_defined가 갈린다 — 마지막만 보면 null이 된다.
    ⚠ applyWay·motion·enemyTags가 실제로 이 함정에 걸린다 (2026-08-09 실측)."""
    for r in recs:
        v = mv(r["enemyData"].get(key))
        if v is not None:
            return v
    return None


# ── 2. 적 본문 (로케일별) ───────────────────────────────────────────────────
kr_book = load(f"{S}/kr_enemy_handbook_table.json")
# 도감에 노출되는 적만 — hideInHandbook은 게임 안에서도 안 보이는 내부용 더미다
VISIBLE = [k for k, v in kr_book["enemyData"].items() if not v.get("hideInHandbook")]
print(f"도감 노출 적: {len(VISIBLE)}종 (전체 {len(kr_book['enemyData'])})")

books, races = {}, {}
for loc, pre, _ in LOCALES:
    b = load(f"{S}/{pre}_enemy_handbook_table.json")
    books[loc] = b["enemyData"]
    races[loc] = b.get("raceData") or {}


def build_enemies(loc):
    book, race = books[loc], races[loc]
    imm_label = IMMUNE_LABELS[loc]
    out = []
    for eid in VISIBLE:
        hb = book.get(eid) or kr_book["enemyData"][eid]   # 로케일 테이블에 없으면 KR 폴백
        recs = enemy_db.get(eid) or []
        tags = first_defined(recs, "enemyTags") or []
        way = first_defined(recs, "applyWay")
        motion = first_defined(recs, "motion")
        rng = first_defined(recs, "rangeRadius")
        levels = []
        for r in recs:
            a = r["enemyData"].get("attributes") or {}
            levels.append({
                "l": r.get("level", 0),
                "hp": num(mv(a.get("maxHp"), 0)), "atk": num(mv(a.get("atk"), 0)),
                "def": num(mv(a.get("def"), 0)), "res": num(mv(a.get("magicResistance"), 0)),
                "aspd": num(mv(a.get("attackSpeed"), 100)), "ms": num(mv(a.get("moveSpeed"), 1)),
                # 중량 기본값 1 — build-rogue.py와 같은 규약이어야 한다. 같은 적이 통합전략
                # 적 도감과 여기 양쪽에 나오는데 값이 어긋나면 안 된다.
                "w": num(mv(a.get("massLevel"), 1)),
                "lp": num(mv(r["enemyData"].get("lifePointReduce"), 1)),
                "imm": [lb for f, lb in zip(IMMUNE_FIELDS, imm_label) if mv(a.get(f), False)],
            })
        levels.sort(key=lambda x: x["l"])
        name = clean(hb.get("name")) or eid
        name = ENEMY_NAME_FIX.get(name, name)
        abil = [clean(a.get("text")) for a in (hb.get("abilityList") or []) if clean(a.get("text"))]
        if not abil and hb.get("ability"):
            abil = [clean(hb["ability"])]
        e = {
            "id": eid,
            "idx": hb.get("enemyIndex"),
            "name": name,
            "rank": hb.get("enemyLevel"),                         # NORMAL / ELITE / BOSS
            "sort": hb.get("sortId", 9999),
            "desc": clean(hb.get("description")),
            "abil": abil,
            "dmg": [DAMAGE_LABELS[loc].get(d, d) for d in (hb.get("damageType") or [])],
            "race": [clean(race[t]["raceName"]) for t in tags if t in race],
            "way": WAY_LABELS[loc].get(way) if way else None,
            "motion": MOTION_LABELS[loc].get(motion) if motion else None,
            "lv": levels,
        }
        # 사거리 0/-1은 "근접이라 사거리 개념 없음" — 키를 아예 안 넣어 파일을 줄인다
        if rng and rng > 0:
            e["rng"] = num(rng)
        # 연계 소환 적 — 도감에 있는 것만 (내부 더미로 이어지는 참조가 섞여 있다)
        link = [x for x in (hb.get("linkEnemies") or []) if x in set(VISIBLE)]
        if link:
            e["link"] = link
        out.append(e)
    out.sort(key=lambda x: (x["sort"], x["id"]))
    return out


by_loc = {loc: build_enemies(loc) for loc, _, _ in LOCALES}
DATA = os.path.join(REPO, "app", "data")
for loc, _, suf in LOCALES:
    p = os.path.join(DATA, f"enemies{suf}.json")
    json.dump(by_loc[loc], open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  {os.path.basename(p)}: {len(by_loc[loc])}종 {os.path.getsize(p)//1024}KB")

# 만능검색용 경량 색인 — app/omni.ts가 1MB 본문을 끌어오지 않게 이름만 따로 낸다.
# 3개 로케일 이름을 한 파일에 담는다 (검색은 로케일 무관하게 다 잡히는 편이 낫다).
names = {"ids": [e["id"] for e in by_loc["ko"]],
         "idx": [e["idx"] for e in by_loc["ko"]],
         "rank": [e["rank"] for e in by_loc["ko"]],
         "ko": [e["name"] for e in by_loc["ko"]],
         "en": [e["name"] for e in by_loc["en"]],
         "ja": [e["name"] for e in by_loc["ja"]]}
p = os.path.join(DATA, "enemy-names.json")
json.dump(names, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"  enemy-names.json: {os.path.getsize(p)//1024}KB")

# 작전 상세의 적 칩용 경량 스탯 색인 — 통전 전투노드처럼 HP·공격·방어·마저를 보여준다
# (사용자 요청 2026-08-10 "적 얼굴만 덜렁 나오지 말고 스탯 이정도는"). 수치는 로케일
# 무관이라 한 파일. 1MB enemies.json을 작전 도감 청크에 끌어오지 않기 위한 별도 산출.
# 형식: { 적id: [[단계, hp, atk, def, res] …] } — 단계 값이 희소할 수 있어 명시한다.
stats = {e["id"]: [[l["l"], l["hp"], l["atk"], l["def"], l["res"]] for l in e["lv"]] for e in by_loc["ko"]}
p = os.path.join(DATA, "enemy-stats.json")
json.dump(stats, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"  enemy-stats.json: {os.path.getsize(p)//1024}KB")

# 미번역 감시 — EN/JA에 한글이 남아 있으면 그 적은 KR 폴백이다 (CN 선행 적 등)
HANGUL = re.compile(r"[가-힣]")
for loc in ("en", "ja"):
    left = [e["id"] for e in by_loc[loc] if HANGUL.search(e["name"] or "")]
    if left:
        print(f"  ⚠ {loc}: 이름 미번역 {len(left)}종 (KR 폴백) 예: {left[:5]}")

# ── 3. 등장 작전 역색인 ─────────────────────────────────────────────────────
# stageType GUIDE(튜토리얼)만 뺀다. 종료된 이벤트도 남긴다 — 복각으로 돌아오고,
# "이 적을 어디서 봤더라"의 답이 되는 건 대개 옛 이벤트다.
SKIP_TYPES = {"GUIDE"}

# 고난(diffGroup TOUGH) 작전의 코드 접미 — 일반판과 코드·이름이 같아 이걸 붙여야 행이
# 갈라진다 (안 붙이면 (코드,이름,구역) 접기에서 일반판과 합쳐져 고난 적 구성이 뭉개진다 —
# 2026-08-10 사용자 지적 "고난 환경에서는 적 스탯도 다 달라질텐데").
# ⚠ scripts/build-stages.py의 TOUGH_SUFFIX와 **글자 하나까지 같아야 한다** — 조인 키다.
# 명칭 근거: KR '고난'(사용자 확정) · EN 'Adverse Environment'(wiki.gg) ·
# JP '厄難奮戦環境'(4Gamer·AppBank 공식 보도, 2022-10 10장 공개).
TOUGH_SUFFIX = {"ko": "고난", "en": "Adverse", "ja": "厄難"}

if META_ONLY:
    print("등장 작전 역색인: --meta-only — 기존 enemy-stages*.json 유지")
else:
    stage_tables = {loc: load(f"{S}/{pre}_stage_table.json")["stages"] for loc, pre, _ in LOCALES}
    zone_tables = {loc: load(f"{S}/{pre}_zone_table.json")["zones"] for loc, pre, _ in LOCALES}

    # KR을 정본으로 스테이지 목록을 정하고, 표시 텍스트만 로케일별로 갈아끼운다.
    # ⚠ 긴급 작전(stageId 접미 `#f#`)은 일반판과 **code·levelId가 완전히 같다** — 그대로
    #   두면 "0-1"이 두 줄씩 나온다 (실측 822행 중복). (code, levelId)로 접고 일반판을 남긴다.
    seen_pair = {}
    for sid, st in stage_tables["ko"].items():
        if st.get("stageType") in SKIP_TYPES or not st.get("levelId"):
            continue
        key = (st.get("code") or sid, st["levelId"].lower())
        prev = seen_pair.get(key)
        if prev is None or (st.get("difficulty") == "NORMAL" and prev[2].get("difficulty") != "NORMAL"):
            seen_pair[key] = (sid, st["levelId"].lower(), st)

    # 표시 순서: 메인 → 막간·기록 → 섬멸 → 자원 → 보안 파견 → 이벤트, 그 안에서 코드 자연순.
    # rows를 이 순서로 쌓으므로 적별 등장 목록도 자동으로 같은 순서가 된다.
    TYPE_ORDER = {"MAIN": 0, "SUB": 1, "SPECIAL_STORY": 2, "CAMPAIGN": 3, "DAILY": 4, "CLIMB_TOWER": 5}
    def natural(code):
        return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", code or "")]
    stages = sorted(seen_pair.values(),
                    key=lambda x: (TYPE_ORDER.get(x[2].get("stageType"), 9), natural(x[2].get("code") or x[0])))
    level_ids = sorted({lv for _, lv, _ in stages})
    print(f"등장 작전: 스테이지 {len(stages)}개 / 고유 레벨 파일 {len(level_ids)}개")

    def enemies_of(level_id):
        lv = fetch_level(f"levels/{level_id}.json")
        if not lv:
            return None
        counts = {}
        order = []
        level_of = {}   # 그 스테이지가 쓰는 스탯 변형 (0=기본형, 1~=강화판)
        for ref in lv.get("enemyDbRefs") or []:
            key = ref.get("id")
            if key and key not in counts:
                counts[key] = 0
                level_of[key] = ref.get("level", 0) or 0
                order.append(key)

        def tally(actions):
            for a in actions or []:
                if a.get("actionType") in (0, "SPAWN") and a.get("key"):
                    counts[a["key"]] = counts.get(a["key"], 0) + (a.get("count") or 1)
        for w in lv.get("waves") or []:
            for f in w.get("fragments") or []:
                tally(f.get("actions"))
        for b in (lv.get("branches") or {}).values():
            for ph in b.get("phases") or []:
                tally(ph.get("actions"))
        return [(k, counts.get(k, 0), level_of.get(k, 0)) for k in order]

    done = [0]
    def work(lid):
        r = enemies_of(lid)
        done[0] += 1
        if done[0] % 400 == 0:
            print(f"    …{done[0]}/{len(level_ids)}")
        return lid, r
    with ThreadPoolExecutor(12) as ex:
        level_enemies = dict(ex.map(work, level_ids))
    missing = [k for k, v in level_enemies.items() if v is None]
    if missing:
        print(f"  레벨 파일 없음 {len(missing)}개 (삭제된 스테이지 — 정상) 예: {missing[:3]}")

    # ── 환경 배수 (app/data/stage-env.json) ─────────────────────────────────
    # 고난·긴급의 적 스탯 강화는 적 레벨 변형(★)이 아니라 레벨 파일의 **룬**이다
    # (2026-08-10 실측: 고난 85/85 전부, 긴급도 최빈값 ×1.2). 키가 두 세대다 —
    # 신형 enemy_attribute_mul(6장 이후·고난) + 구형 ebuff_attribute(0~5장 긴급 등,
    # 값 의미는 같은 배수. 한쪽만 뽑으면 옛 챕터 긴급이 통째로 빠진다 — 실측으로 발각).
    # 사용자 지적 "고난·긴급에서는 스탯이 다 강화돼서 나온다"가 이것. 여기(레벨 파일을 이미 읽는 곳)서
    # 뽑아 별도 파일로 내고 build-stages.py가 레코드에 복사한다 — CI(--no-images)는 레벨
    # 캐시가 없으므로 이 파일이 커밋돼 있어야 한다 (--meta-only는 건드리지 않음, 아래 주의).
    # 형식: {"adverse"|"challenge": { 스테이지id: [[hp,atk,def,res 배수, 대상적id들|0] …] }}
    #   adverse = 고난 판 자체(FOUR_STAR·ALL 마스크) · challenge = 일반판의 긴급 모드(FOUR_STAR).
    def rune_muls(level_id, masks):
        lv = fetch_level(f"levels/{level_id}.json")
        out = []
        for r in (lv or {}).get("runes") or []:
            if not isinstance(r, dict) or r.get("key") not in ("enemy_attribute_mul", "ebuff_attribute"):
                continue
            if r.get("difficultyMask") not in masks:
                continue
            bb = {b.get("key"): b.get("value") if b.get("valueStr") is None else b.get("valueStr")
                  for b in r.get("blackboard") or [] if isinstance(b, dict)}
            row = [bb.get("max_hp", 1), bb.get("atk", 1), bb.get("def", 1), bb.get("magic_resistance", 1),
                   bb.get("enemy") or 0]
            if any(isinstance(x, (int, float)) and x != 1 for x in row[:4]):
                out.append(row)
        return out

    env = {"adverse": {}, "challenge": {}}
    for sid, lid, kst in stages:
        if kst.get("diffGroup") == "TOUGH":
            m = rune_muls(lid, ("FOUR_STAR", "ALL"))
            if m:
                env["adverse"][sid] = m
        if f"{sid}#f#" in stage_tables["ko"]:
            m = rune_muls(lid, ("FOUR_STAR",))
            if m:
                env["challenge"][sid] = m
    p = os.path.join(DATA, "stage-env.json")
    json.dump(env, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  stage-env.json: 고난 {len(env['adverse'])} · 긴급 {len(env['challenge'])} — {os.path.getsize(p)//1024}KB")

    # ── 적 이동 경로 (app/data/stage-routes.json) — 사용자 요청 2026-08-10 ──────
    # 레벨 파일의 routes(시작→MOVE 체크포인트→끝, 타일 좌표) + waves의 SPAWN이 적↔경로를
    # 잇는다. 3D 실사 도면엔 좌표를 못 얹으므로(원근 렌더·카메라값 없음) 격자 도면을
    # SVG로 그려 그 위에 표시한다 (app/stage-route-map.tsx). 격자 방향은 render_minimap과
    # 같은 row 0 = 위 — 실사 미리보기와 육안 대조로 확인된 규약이다.
    # 로케일 무관 1벌. 클라이언트는 상세에서 '이동 경로' 탭을 눌렀을 때만 지연 로드한다.
    def routes_of(level_id):
        lv = fetch_level(f"levels/{level_id}.json")
        if not lv:
            return None
        md = lv.get("mapData") or {}
        grid = md.get("map") or []
        tdefs = md.get("tiles") or []
        if isinstance(grid, dict):   # 신형 {row_size, column_size, matrix_data} (render_minimap과 동일 처리)
            flat = grid.get("matrix_data") or []
            cn = grid.get("column_size") or 0
            grid = [flat[i:i + cn] for i in range(0, len(flat), cn)] if cn else []
        if not grid or not tdefs:
            return None

        def tchar(t):
            key = t.get("tileKey") or ""
            if key in ("tile_start", "tile_flystart"):
                return "s"           # 적 출현 (게임 표기 빨강)
            if key == "tile_end":
                return "e"           # 방어 목표 (게임 표기 파랑)
            if key == "tile_hole":
                return "h"
            if key == "tile_forbidden":
                return "f"
            if t.get("heightType") in (1, "HIGHLAND"):
                return "w"           # 고지대
            return "r"               # 지상
        g = ["".join(tchar(tdefs[c]) if 0 <= c < len(tdefs) else "f" for c in row) for row in grid]

        rts, fly = [], []
        for rt in lv.get("routes") or []:
            # ⚠ 자리를 지워선 안 된다 — waves가 routeIndex 번호로 가리킨다. 못 그리면 null.
            if not isinstance(rt, dict) or rt.get("motionMode") not in ("WALK", "FLY"):
                rts.append(None); fly.append(0)
                continue
            pts = ([rt.get("startPosition")]
                   + [cp.get("position") for cp in rt.get("checkpoints") or []
                      if isinstance(cp, dict) and cp.get("type") == "MOVE"]
                   + [rt.get("endPosition")])
            poly = [[p["col"], p["row"]] for p in pts if isinstance(p, dict)]
            rts.append(poly if len(poly) >= 2 else None)
            fly.append(1 if rt.get("motionMode") == "FLY" else 0)

        eroutes = {}
        def walk(actions):
            for a in actions or []:
                if a.get("actionType") in (0, "SPAWN") and a.get("key") and a.get("routeIndex") is not None:
                    eroutes.setdefault(a["key"], set()).add(a["routeIndex"])
        for w in lv.get("waves") or []:
            for fg in w.get("fragments") or []:
                walk(fg.get("actions"))
        for b in (lv.get("branches") or {}).values():
            for ph in b.get("phases") or []:
                walk(ph.get("actions"))
        er = {k: sorted(i for i in v if 0 <= i < len(rts) and rts[i]) for k, v in eroutes.items()}
        er = {k: v for k, v in er.items() if v}
        if not any(rts):
            return None
        return {"h": len(g), "w": len(g[0]), "g": g, "r": rts, "f": fly, "e": er}

    rcache = {}
    routes_doc = {}
    for sid, lid, kst in stages:
        if lid not in rcache:
            rcache[lid] = routes_of(lid)
        if rcache[lid]:
            routes_doc[sid] = rcache[lid]
    p = os.path.join(DATA, "stage-routes.json")
    json.dump(routes_doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  stage-routes.json: 경로 보유 작전 {len(routes_doc)} — {os.path.getsize(p)//1024}KB")


    # ── 메인 스토리 챕터 (2026-08-09 사용자 리포트로 발각) ──────────────────────
    # ⚠ zoneNameFirst를 무조건 챕터 라벨로 쓰면 안 된다. 15·16장(act2mainss/act3mainss)은
    #   first가 **영어 제목**이고 3개 언어에서 값이 똑같다("Dissociative Recombination").
    #   그래서 "로케일마다 다른가"로 판정한다 — 진짜 챕터 라벨은 ko '에피소드 3' ·
    #   en 'Episode 3' · ja '第三章'로 갈리지만, 영어 제목은 어느 로케일에서든 같다.
    CHAPTER_RE = re.compile(r"EPISODE\s*(\d+)", re.I)


    def _chapter_label(loc, n):
        """15·16장은 세 로케일 모두 first가 미번역이라 'EPISODE 15'가 그대로 노출됐다
        (사용자 지적 2026-08-10) — 기존 챕터들과 같은 표기로 합성한다.
        ⚠ build-stages.py에도 같은 함수가 있다 — zone_name처럼 글자까지 같아야 한다."""
        if loc == "ko":
            return f"에피소드 {n}"
        if loc == "ja":                  # ja는 한자 수사다: 第十五章 (第15章이 아니다)
            d = "一二三四五六七八九"
            tens, ones = divmod(n, 10)
            num = ("" if tens < 2 else d[tens - 1]) + ("十" if tens else "") + (d[ones - 1] if ones else "")
            return f"第{num}章"
        return f"Episode {n}"


    def _localized_first(zid):
        """zoneNameFirst가 로케일마다 다르면(=진짜 챕터 라벨) True."""
        vals = {clean((zone_tables[loc].get(zid) or {}).get("zoneNameFirst")) for loc in ("ko", "en", "ja")}
        vals.discard(None)
        return len(vals) > 1
    
    
    def chapter_of(zid):
        """메인 스토리 챕터 번호. 정렬용 — 코드가 'R8-1'·'JT8-1'이라 코드순으로는
        8장이 통째로 맨 뒤로 밀린다 (사용자 리포트). 15·16장은 zoneId가 act2mainss_zone1이라
        zoneId 파싱만으로도 안 된다 — zoneNameThird의 'EPISODE 15'가 유일하게 믿을 값이다."""
        z = zone_tables["ko"].get(zid) or {}
        m = CHAPTER_RE.search(z.get("zoneNameThird") or "")
        if m:
            return int(m.group(1))
        m = re.fullmatch(r"main_(\d+)", zid or "")
        return int(m.group(1)) if m else None

    def zone_name(loc, zid, stype):
        """⚠ build-stages.py의 zone_name과 **글자 하나까지 같아야 한다** — 두 도감이
        (코드, 이름, 구역)으로 서로의 색인을 되짚는다. 한쪽만 고쳤다가 조인이
        2,038 → 1,538로 깨진 적이 있다 (2026-08-09)."""
        z = zone_tables[loc].get(zid) or {}
        second = clean(z.get("zoneNameSecond"))
        third = clean(z.get("zoneNameThird"))
        # 메인 스토리는 챕터 표기를 앞에 붙인다 (사용자 요청). 로케일마다 다른 first가
        # 진짜 챕터 라벨이고(에피소드 3 / Episode 3 / 第三章), 아니면 third('EPISODE 15')를 쓴다.
        head = clean(z.get("zoneNameFirst")) if _localized_first(zid) else None
        if not head and third:
            m = CHAPTER_RE.search(third)
            if m:
                head = _chapter_label(loc, int(m.group(1)))
        if head and second and head != second:
            return f"{head} · {second}"
        n = second or head or third
        return n or ZONE_TYPE_LABELS[loc].get(z.get("type") or stype) or ZONE_TYPE_LABELS[loc].get(stype) or ""

    visible = set(VISIBLE)
    for loc, _, suf in LOCALES:
        table = stage_tables[loc]
        rows, row_of, by_enemy = [], {}, {}
        for sid, lid, kst in stages:
            ents = level_enemies.get(lid)
            if not ents:
                continue
            ents = [e for e in ents if e[0] in visible]
            if not ents:
                continue
            st = table.get(sid) or kst
            code = clean(st.get("code")) or sid
            if kst.get("diffGroup") == "TOUGH":
                code = f"{code} ({TOUGH_SUFFIX[loc]})"
            row = [code, clean(st.get("name")) or "",
                   zone_name(loc, st.get("zoneId") or kst.get("zoneId"), kst.get("stageType")),
                   kst.get("stageType"),
                   # 작전 도감으로 넘어가는 열쇠. 상세 라우트가 없는 이벤트 작전도 있으므로
                   # 화면에서는 목록 + 해시(#st-<id>)로 연다 (app/stage-detail.tsx 참조).
                   sid]
            # 화면에 똑같이 보이는 작전은 한 줄로 접는다 — 복각 상설판처럼 levelId만 다르고
            # 코드·이름·구역이 같은 스테이지가 196쌍 있다 (실측). 스폰 수는 큰 쪽을 남긴다.
            # ⚠ 접는 기준에 stageId를 넣으면 안 된다 — 넣는 순간 안 접혀 중복이 되살아난다
            #   (2026-08-09 실측 1,800 → 1,996행). id는 링크용으로 싣기만 한다(첫 것 채택).
            key = tuple(row[:4])
            idx = row_of.get(key)
            if idx is None:
                idx = row_of[key] = len(rows)
                rows.append(row)
            for k, c, el in ents:
                lst = by_enemy.setdefault(k, [])
                # [작전번호, 스폰수, 스탯레벨] — 뒤 칸은 0이면 통째로 생략해 파일을 줄인다
                row_e = [idx, c, el] if el else ([idx, c] if c else [idx])
                prev = next((x for x in lst if x[0] == idx), None)
                if prev is None:
                    lst.append(row_e)
                elif c > (prev[1] if len(prev) > 1 else 0):
                    prev[:] = row_e
        p = os.path.join(DATA, f"enemy-stages{suf}.json")
        json.dump({"stages": rows, "byEnemy": by_enemy}, open(p, "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))
        print(f"  {os.path.basename(p)}: 작전 {len(rows)} · 적 {len(by_enemy)}종 {os.path.getsize(p)//1024}KB")

# ── 4. 초상 ─────────────────────────────────────────────────────────────────
# arts/enemies/<id>.png. 변종(_2 등)은 원본 id 초상으로 폴백한다 (build-rogue.py와 같은 규약).
# ⚠ 통합전략용 public/rogue/enemy/ 는 건드리지 않는다 — 경로를 옮기면 배포 도중
#   록라 적 이미지가 404가 난다. 이미 받아 둔 파일은 복사해 재다운로드만 아낀다.
if NO_IMAGES:
    print("초상: --no-images — 건너뜀")
else:
    dest_dir = os.path.join(REPO, "public", "enemy")
    rogue_dir = os.path.join(REPO, "public", "rogue", "enemy")
    os.makedirs(dest_dir, exist_ok=True)

    def candidates(eid):
        base = re.sub(r"_\d+$", "", eid)
        return [eid] if base == eid else [eid, base]

    copied, jobs = 0, []
    for eid in VISIBLE:
        cands = candidates(eid)
        if any(os.path.exists(os.path.join(dest_dir, c + ".webp")) for c in cands):
            continue
        src = next((c for c in cands if os.path.exists(os.path.join(rogue_dir, c + ".webp"))), None)
        if src:
            shutil.copyfile(os.path.join(rogue_dir, src + ".webp"), os.path.join(dest_dir, src + ".webp"))
            copied += 1
        else:
            jobs.append((eid, cands))

    def one(job):
        eid, cands = job
        for c in cands:
            try:
                req = urllib.request.Request(ASSETS + "/arts/enemies/" + c + ".png",
                                             headers={"User-Agent": "Mozilla/5.0"})
                png = urllib.request.urlopen(req, timeout=60).read()
                # photo=True·method=4 — imgutil 주석 참고: 대량 변환에서 method 6은 장당
                # 수 초가 걸리는데 결과 크기는 사실상 같다
                save_webp(png, os.path.join(dest_dir, c + ".webp"), photo=True, max_px=256, method=4)
                return None
            except Exception:
                continue
        return eid
    fails = []
    if jobs:
        with ThreadPoolExecutor(12) as ex:
            fails = [f for f in ex.map(one, jobs) if f]
    # ⚠ 변종(_2 등)은 원본 초상을 **변종 이름으로도 복사**해 둔다 (실측 439종).
    #   런타임 onError 폴백은 프리렌더된 <img>에서 무력하다 — 하이드레이션 전에 에러가
    #   나면 핸들러가 아직 없어서, 상세 페이지의 적 초상이 깨져 보였다 (2026-08-09).
    #   빌드에서 파일을 만들어 두면 폴백 자체가 필요 없어진다 (+수 MB, R2 서빙).
    aliased = 0
    for eid in VISIBLE:
        own = os.path.join(dest_dir, eid + ".webp")
        if os.path.exists(own):
            continue
        base = re.sub(r"_\d+$", "", eid)
        bp = os.path.join(dest_dir, base + ".webp")
        if base != eid and os.path.exists(bp):
            shutil.copyfile(bp, own)
            aliased += 1
    have = sum(1 for eid in VISIBLE if os.path.exists(os.path.join(dest_dir, eid + ".webp")))
    print(f"초상: 복사 {copied} · 신규 {len(jobs) - len(fails)} · 실패 {len(fails)} · 변종 별칭 {aliased} → 보유 {have}/{len(VISIBLE)}")
    if fails:
        print(f"  ⚠ 초상 없음 (원본 에셋 부재): {fails[:8]}")

print("완료 — app/data/enemies*.json")
