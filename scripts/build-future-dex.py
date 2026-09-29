#!/usr/bin/env python3
"""미래시(중섭 선행) 이벤트의 작전·적·재화 상세 — app/data/future-dex{,.en,.ja}.json.

사용자 제보 2026-09-29 "스테이지 데이터같은것도 다 없고 증표도 클릭해도 모달 안뜨네": 이벤트 도감의 미래시 행
(build-events.py)은 중섭 표에서 작전·등장 적·재화 **이름**만 뽑는다. 작전 도감(stages.json)·적 도감(enemies.json)·
아이템 도감(items.json)은 한섭 표로만 만들어져 거기 없는 id 를 누르면 아무 창도 안 떴다.
이 파일이 그 빈자리를 메운다 — 이벤트 창(app/events.tsx)이 본 도감에서 못 찾은 id 만 여기서 찾는다.
본 도감 목록에는 섞지 않는다 (미래시 항목은 이벤트 창 안에서만 연다).

사용:
  python3 scripts/build-future-dex.py              # 도면·초상까지 (중섭 CDN)
  python3 scripts/build-future-dex.py --no-images  # 무인 CI — 그림은 받아 둔 것만

입력: app/data/events.json 의 fut 행 (build-events.py 뒤에 돌린다) · .gamedata/cn_*·{kr,en,jp}_* 표 ·
      중섭 CDN 레벨·enemy_database · scripts/cn-translations.json (비공식 번역)
출력:
  app/data/future-dex{,.en,.ja}.json   {stages: 미니 StageDoc, items: DexItem[], enemies: Enemy[], enemyStages}
  public/stage/<작전id>.webp            중섭 도면 (R2)
  public/enemy/<적id>.webp              중섭 신규 적 초상 (R2)

번역: ① 같은 id 가 그 로케일 서버 표에 있으면 공식 문구 ② 중섭 원문이 서버 표의 다른 항목과 글자까지 같으면 그
공식 번역(작전 설명·적 능력 문구는 대개 정형 문구다) ③ scripts/cn-translations.json ④ 없으면 원문 그대로 두고
빌드 끝에 몇 건인지 알린다 (scripts/future-dex-untranslated.json 에 목록).
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_pos = [a for a in sys.argv[1:] if not a.startswith("-")]
G = _pos[0] if _pos else os.environ.get("GAMEDATA_DIR", os.path.join(REPO, ".gamedata"))
DATA = os.path.join(REPO, "app", "data")
NO_IMAGES = "--no-images" in sys.argv
LOCALES = [("ko", "kr", ""), ("en", "en", ".en"), ("ja", "jp", ".ja")]
load = lambda p: json.load(open(p, encoding="utf-8"))

# build-stages.py · build-enemies.py 와 **같은 문구**여야 한다 (같은 화면 부품이 그린다)
OCC_LABELS = {
    "ko": {"ALWAYS": "확정", "ALMOST": "거의 항상", "USUAL": "자주", "OFTEN": "보통", "SOMETIMES": "가끔"},
    "en": {"ALWAYS": "Guaranteed", "ALMOST": "Almost always", "USUAL": "Frequent", "OFTEN": "Common", "SOMETIMES": "Occasional"},
    "ja": {"ALWAYS": "確定", "ALMOST": "ほぼ確定", "USUAL": "頻繁", "OFTEN": "普通", "SOMETIMES": "たまに"},
}
DROP_LABELS = {
    "ko": {"NORMAL": "주요 드랍", "SPECIAL": "특별 드랍", "ADDITIONAL": "추가 드랍",
           "COMPLETE": "완벽 작전", "ONCE": "최초 클리어", "CONDITION_DROP": "조건 드랍"},
    "en": {"NORMAL": "Regular drop", "SPECIAL": "Special drop", "ADDITIONAL": "Extra drop",
           "COMPLETE": "3-star clear", "ONCE": "First clear", "CONDITION_DROP": "Conditional"},
    "ja": {"NORMAL": "通常ドロップ", "SPECIAL": "特殊ドロップ", "ADDITIONAL": "追加ドロップ",
           "COMPLETE": "完全作戦", "ONCE": "初回クリア", "CONDITION_DROP": "条件ドロップ"},
}
TYPE_LABEL = {"ko": "이벤트", "en": "Event", "ja": "イベント"}
IMMUNE_FIELDS = ["stunImmune", "silenceImmune", "sleepImmune", "frozenImmune", "levitateImmune",
                 "fearedImmune", "palsyImmune", "attractImmune"]
IMMUNE_LABELS = {
    "ko": ["기절", "침묵", "수면", "빙결", "공중 부양", "공포", "마비", "유도"],
    "en": ["Stun", "Silence", "Sleep", "Freeze", "Levitate", "Fear", "Paralysis", "Lure"],
    "ja": ["スタン", "沈黙", "睡眠", "凍結", "浮遊", "恐怖", "麻痺", "誘導"],
}
DAMAGE_LABELS = {
    "ko": {"PHYSIC": "물리", "MAGIC": "마법", "NO_DAMAGE": "피해 없음", "HEAL": "치유"},
    "en": {"PHYSIC": "Physical", "MAGIC": "Arts", "NO_DAMAGE": "No damage", "HEAL": "Healing"},
    "ja": {"PHYSIC": "物理", "MAGIC": "術", "NO_DAMAGE": "ダメージなし", "HEAL": "治療"},
}
WAY_LABELS = {
    "ko": {"MELEE": "근접", "RANGED": "원거리", "ALL": "근접·원거리", "NONE": "공격 없음"},
    "en": {"MELEE": "Melee", "RANGED": "Ranged", "ALL": "Melee & Ranged", "NONE": "No attack"},
    "ja": {"MELEE": "近接", "RANGED": "遠距離", "ALL": "近接・遠距離", "NONE": "攻撃なし"},
}
MOTION_LABELS = {"ko": {"WALK": "지상", "FLY": "비행"}, "en": {"WALK": "Ground", "FLY": "Flying"},
                 "ja": {"WALK": "地上", "FLY": "飛行"}}
ITEM_OBTAIN = {"ko": "이벤트 스테이지 드랍", "en": "Event stage drop", "ja": "イベントステージドロップ"}
DANGER = {"ko": "{0}차 정예화 Lv.{1}", "en": "Elite {0} Lv. {1}", "ja": "昇進{0} LV.{1}"}


def clean(s):
    if not isinstance(s, str):
        return s
    s = re.sub(r"</?[@$a-zA-Z][^>]*>|</>", "", s.replace("\r\n", "\n").replace("\\n", "\n"))
    return re.sub(r"[ \t]+", " ", s).strip() or None


def mv(field, default=None):
    if isinstance(field, dict) and "m_defined" in field:
        return field["m_value"] if field["m_defined"] else default
    return field if field is not None else default


def num(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return round(v, 3) if isinstance(v, float) else v


# ── 표 ─────────────────────────────────────────────────────────────────────
cn_stage = load(os.path.join(G, "cn_stage_table.json"))["stages"]
cn_book = load(os.path.join(G, "cn_enemy_handbook_table.json"))
cn_item = load(os.path.join(G, "cn_item_table.json"))["items"]
st_tbl, book, race_tbl, item_tbl = {}, {}, {}, {}
for loc, srv, _ in LOCALES:
    st_tbl[loc] = load(os.path.join(G, f"{srv}_stage_table.json"))["stages"]
    b = load(os.path.join(G, f"{srv}_enemy_handbook_table.json"))
    book[loc], race_tbl[loc] = b["enemyData"], b.get("raceData") or {}
    item_tbl[loc] = load(os.path.join(G, f"{srv}_item_table.json"))["items"]

# ② 공식 정형 문구 사전 — 같은 id 의 중섭 원문 ↔ 그 로케일 문구
official = {loc: {} for loc, _, _ in LOCALES}


def _pair(loc, a, b):
    a, b = clean(a), clean(b)
    if a and b:
        official[loc].setdefault(a, b)
        # 여러 줄 문구는 줄마다도 (작전 설명이 정형 문구 몇 줄을 섞어 쓴다)
        la, lb = a.split("\n"), b.split("\n")
        if len(la) == len(lb) > 1:
            for x, y in zip(la, lb):
                if x.strip() and y.strip():
                    official[loc].setdefault(x.strip(), y.strip())


for loc, _, _ in LOCALES:
    for k, v in cn_stage.items():
        if k in st_tbl[loc]:
            _pair(loc, v.get("description"), st_tbl[loc][k].get("description"))
    for k, v in cn_book["enemyData"].items():
        o = book[loc].get(k)
        if not o:
            continue
        _pair(loc, v.get("description"), o.get("description"))
        for x, y in zip(v.get("abilityList") or [], o.get("abilityList") or []):
            _pair(loc, x.get("text"), y.get("text"))
    for k, v in cn_item.items():
        o = item_tbl[loc].get(k)
        if o:
            for f in ("name", "description", "usage", "obtainApproach"):
                _pair(loc, v.get(f), o.get(f))

# cntr.Dict — 조회할 때 말줄임표(`......`/`……`)·공백 변종을 흡수한다 (scripts/cntr.py 머리말)
import cntr  # noqa: E402
CN_TR = cntr.Dict()
try:
    CN_TR = cntr.Dict({k.strip(): v for k, v in load(os.path.join(REPO, "scripts", "cn-translations.json")).items()})
except (OSError, json.JSONDecodeError):
    pass
missing = {loc: {} for loc, _, _ in LOCALES}
HAN = re.compile(r"[一-鿿]")


def _hit(cn, loc):
    return official[loc].get(cn) or (CN_TR.get(cn) or {}).get(loc)


def tr(cn, loc, ctx=""):
    """중섭 원문 → 로케일. 통째로 → (여러 줄이면) 줄마다 → 원문. 못 옮긴 건 **문구 통째로** 적어 둔다
    (사전 키도 통째 문구다 — 줄 조각으로 적으면 이미 통째로 번역된 문구를 또 번역하게 된다)."""
    cn = clean(cn)
    if not cn:
        return cn
    got = _hit(cn, loc)
    if got:
        return got
    lines = [x.strip() for x in cn.split("\n") if x.strip()]
    if len(lines) > 1:
        parts = [_hit(x, loc) for x in lines]
        if all(parts):
            return "\n".join(parts)
        if HAN.search(cn):
            missing[loc].setdefault(cn, ctx)
        return "\n".join(p or x for p, x in zip(parts, lines))
    if HAN.search(cn):
        missing[loc].setdefault(cn, ctx)
    return cn


# ── 대상: 이벤트 도감의 미래시 행 ─────────────────────────────────────────────
ev_rows = {loc: [r for r in load(os.path.join(DATA, f"events{suf}.json"))["events"] if r.get("fut")]
           for loc, _, suf in LOCALES}
fut_ids = [r["id"] for r in ev_rows["ko"]]
print(f"미래시 이벤트 {len(fut_ids)}개: {', '.join(fut_ids)}")

# ── 레벨 (중섭 CDN → 클뜯 레포 cn) ─────────────────────────────────────────────
import cdnlevels  # noqa: E402

CN_REPO = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/cn/gamedata/%s.json"
MIRROR = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"
LV_CACHE = os.path.join(G, "levels-cn")


def cn_level(level_id):
    rel = str(level_id).lower()
    d = cdnlevels.level(rel, server="cn")
    if d:
        return d
    dest = os.path.join(LV_CACHE, rel.replace("/", "__") + ".json")
    if os.path.exists(dest):
        try:
            return load(dest)
        except json.JSONDecodeError:
            os.remove(dest)
    try:
        req = urllib.request.Request(CN_REPO % f"levels/{rel}", headers={"User-Agent": "Mozilla/5.0"})
        raw = urllib.request.urlopen(req, timeout=60).read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return None
    os.makedirs(LV_CACHE, exist_ok=True)
    open(dest, "wb").write(raw)
    return json.loads(raw)


def level_enemies(lv):
    """[(적id, 스폰 수, 스탯 단계)] — build-enemies.py enemies_of 와 같은 셈."""
    counts, order, level_of = {}, [], {}
    for ref in (lv or {}).get("enemyDbRefs") or []:
        key = ref.get("id")
        if key and key not in counts:
            counts[key] = 0
            level_of[key] = ref.get("level", 0) or 0
            order.append(key)

    def tally(actions):
        for a in actions or []:
            if a.get("actionType") in (0, "SPAWN") and a.get("key"):
                counts[a["key"]] = counts.get(a["key"], 0) + (a.get("count") or 1)
    for w in (lv or {}).get("waves") or []:
        for f in w.get("fragments") or []:
            tally(f.get("actions"))
    for b in ((lv or {}).get("branches") or {}).values():
        for ph in b.get("phases") or []:
            tally(ph.get("actions"))
    return [(k, counts.get(k, 0), level_of.get(k, 0)) for k in order]


_db = cdnlevels.level("levels/enemydata/enemy_database", schema="enemy_database", server="cn")
if isinstance(_db, list):
    enemy_db = {e["Key"]: e["Value"] for e in _db if isinstance(e, dict) and "Key" in e}
else:
    enemy_db = _db or {}
print(f"중섭 enemy_database: {len(enemy_db)}종")


def stat_rows(eid, loc):
    rows = []
    for r in enemy_db.get(eid) or []:
        a = r["enemyData"].get("attributes") or {}
        rows.append({
            "l": r.get("level", 0),
            "hp": num(mv(a.get("maxHp"), 0)), "atk": num(mv(a.get("atk"), 0)),
            "def": num(mv(a.get("def"), 0)), "res": num(mv(a.get("magicResistance"), 0)),
            "aspd": num(mv(a.get("attackSpeed"), 100)), "ms": num(mv(a.get("moveSpeed"), 1)),
            "w": num(mv(a.get("massLevel"), 1)),
            "lp": num(mv(r["enemyData"].get("lifePointReduce"), 1)),
            "imm": [lb for f, lb in zip(IMMUNE_FIELDS, IMMUNE_LABELS[loc]) if mv(a.get(f), False)],
        })
    return sorted(rows, key=lambda x: x["l"])


def first_defined(eid, key):
    for r in enemy_db.get(eid) or []:
        v = mv(r["enemyData"].get(key))
        if v is not None:
            return v
    return None


# ── 작전 ───────────────────────────────────────────────────────────────────
stage_ids = {}           # 이벤트 id → [작전 id]
for r in ev_rows["ko"]:
    stage_ids[r["id"]] = [s[0] for s in r.get("stages") or []]
lv_of, lv_json = {}, {}   # 작전 → [(적, 수, 단계)] / 레벨 JSON (이동 경로·시뮬레이터가 다시 쓴다)
for aid, sids in stage_ids.items():
    for sid in sids:
        lid = (cn_stage.get(sid) or {}).get("levelId")
        lv_json[sid] = cn_level(lid) if lid else None
        lv_of[sid] = level_enemies(lv_json[sid]) if lv_json[sid] else []
print(f"작전 {len(lv_of)}개 · 레벨 못 받음 {sum(1 for v in lv_of.values() if not v)}개")

# 도감에 안 보이는 변형(작전마다 수치만 다른 숨김 보스·레벨 전용 개체)은 보이는 본체로 접는다 — 본체가 없으면 뺀다.
# 본 도감(build-enemies.py VISIBLE)과 같은 규칙이다 (scripts/enemyvariant.py, 2026-09-29 벡터 돌파 #3:
# 'Touch' 가 변형 셋으로 세 번 찍히고, 미저리 변형은 어느 도감에도 없어 눌러도 창이 안 떴다).
import enemyvariant  # noqa: E402

_vis = {}


def _db_name(eid):
    """레벨 데이터의 이름 — 도감 표에 없는 변형을 이름으로 본체에 잇는다 (enemyvariant 머리말)"""
    for r in enemy_db.get(eid) or []:
        n = mv((r.get("enemyData") or {}).get("name"))
        if n:
            return n
    return None


def canon(eid):
    if eid not in _vis:
        _vis[eid] = enemyvariant.visible(eid, cn_book["enemyData"], _db_name(eid))
    return _vis[eid]


# 본 적 도감에 이미 있는 적 — 여기엔 싣지 않고 본 도감 창을 연다 (한섭 표에 숨김으로만 있는 건 본 도감에 없다)
main_enemy = {e["id"] for e in load(os.path.join(DATA, "enemies.json"))}
variants = {}        # 본체 → 작전이 실제로 부른 id 들 (수치·특성을 본체가 못 주면 여기서 빌린다)
for rows in lv_of.values():
    for e, _, _ in rows:
        c = canon(e)
        if c:
            variants.setdefault(c, [])
            if e not in variants[c]:
                variants[c].append(e)
dropped = sorted({e for rows in lv_of.values() for e, _, _ in rows if not canon(e)})
cn_only = sorted(c for c in variants if c not in main_enemy)
print(f"중섭 신규 적 {len(cn_only)}종" + (f" · 도감에 없어 뺀 개체 {len(dropped)}: {', '.join(dropped)}" if dropped else ""))


def enemy_name(eid, loc):
    own = (book[loc].get(eid) or {}).get("name")
    if own:
        return clean(own)
    return tr((cn_book["enemyData"].get(eid) or {}).get("name") or eid, loc, f"enemy {eid}")


def item_name(iid, loc):
    own = (item_tbl[loc].get(iid) or {}).get("name")
    if own:
        return clean(own)
    return tr((cn_item.get(iid) or {}).get("name") or iid, loc, f"item {iid}")


def build(loc, suf):
    ev_names = [r["n"] for r in ev_rows[loc]]
    ev_ix = {r["id"]: i for i, r in enumerate(ev_rows[loc])}
    enemy_ids, enemy_ix, enemy_names = [], {}, {}
    # 드랍 빈도·구분은 **본 문서의 번호**를 쓴다 — 화면이 본 문서 뒤에 이어 붙여(mergeRogueDoc) 본 문서의
    # occ·kinds 로 읽기 때문이다. 아이템 도감 쪽 드랍 칸도 같은 이유로 items.json 의 번호를 쓴다.
    main_st = load(os.path.join(DATA, f"stages{suf}.json"))
    main_it = load(os.path.join(DATA, f"items{suf}.json"))
    occ, kinds = main_st["occ"], main_st["kinds"]
    drop_items = {}
    stages = []
    by_enemy = {}
    rev_rows = []

    def ix(lst, v):
        return lst.index(v) if v in lst else None

    for aid, sids in stage_ids.items():
        e_i = ev_ix[aid]
        for sid in sids:
            v = cn_stage.get(sid) or {}
            name = tr(v.get("name"), loc, f"stage {sid}") or sid
            rec = {"id": sid, "code": clean(v.get("code")) or sid, "name": name, "z": e_i, "t": "ACTIVITY",
                   "ev": e_i, "fut": 1}
            desc = tr(v.get("description"), loc, f"desc {sid}")
            if desc:
                rec["desc"] = desc
            if v.get("apCost"):
                rec["ap"] = v["apCost"]
            if v.get("dangerLevel"):
                # 권장 레벨 — 중섭 표기(`精英1 LV.20`)를 본 도감의 서버 표기로 (build-stages.py 산출물과 같은 모양)
                m = re.fullmatch(r"精英(\d+)\s*LV\.(\d+)", v["dangerLevel"].strip())
                rec["danger"] = DANGER[loc].format(*m.groups()) if m else v["dangerLevel"]
            drops = []
            for d in (v.get("stageDropInfo") or {}).get("displayDetailRewards") or []:
                if d.get("type") not in ("MATERIAL", "CARD_EXP", "ACTIVITY_ITEM"):
                    continue
                iid = d["id"]
                o = ix(occ, OCC_LABELS[loc].get(d.get("occPercent"), d.get("occPercent")))
                k = ix(kinds, DROP_LABELS[loc].get(d.get("dropType"), d.get("dropType")))
                if o is None or k is None:
                    continue
                drop_items[iid] = item_name(iid, loc)
                drops.append([iid, o, k])
            if drops:
                rec["d"] = drops
            es, e = [], []
            for raw, cnt, lvl in lv_of.get(sid) or []:
                eid = canon(raw)
                if not eid:
                    continue                # 도감에 없는 개체 — 본 도감처럼 뺀다
                if eid not in enemy_ix:
                    enemy_ix[eid] = len(enemy_ids)
                    enemy_ids.append(eid)
                    enemy_names[eid] = enemy_name(eid, loc)
                if raw == eid and eid in main_enemy:
                    st4 = 0                 # 본 도감 스탯 색인에 있다
                else:
                    # 변형이면 **그 작전이 부른 변형의 수치** — 본체와 다르다 (Touch: VEC-04·08·12 가 다 다르다)
                    rows = stat_rows(raw, loc) or stat_rows(eid, loc)
                    row = next((x for x in rows if x["l"] == lvl), rows[0] if rows else None)
                    st4 = [row["hp"], row["atk"], row["def"], row["res"]] if row else 0
                # 변형 둘이 같은 본체·같은 수치로 접히면 한 줄로 합친다 (VEC-08 의 과관류 `_2`·`_3`)
                same = next((k for k, x in enumerate(e) if x[0] == enemy_ix[eid] and x[2] == lvl and es[k] == st4), None)
                if same is not None:
                    e[same][1] += cnt
                    for b in by_enemy[eid]:
                        if b[0] == len(rev_rows) and b[2] == lvl:
                            b[1] += cnt
                            break
                    continue
                e.append([enemy_ix[eid], cnt, lvl])
                es.append(st4)
                by_enemy.setdefault(eid, []).append([len(rev_rows), cnt, lvl])
            if e:
                rec["e"] = e
                if any(es):
                    rec["es"] = es
            if os.path.exists(os.path.join(REPO, "public", "stage", f"{sid}.webp")):
                rec["map"] = 1
            if sid in sim_ids:
                rec["sim"] = 1              # 이동 경로·시뮬레이터 (future-routes.json)
            stages.append(rec)
            rev_rows.append([rec["code"], name, ev_names[e_i], TYPE_LABEL[loc], sid])

    enemies = []
    for eid in cn_only:
        hb = cn_book["enemyData"].get(eid) or {}
        # 본체가 레벨 데이터(enemy_database)에 없으면 작전이 부른 변형에서 빌린다
        src = eid if enemy_db.get(eid) else next((v for v in variants.get(eid, []) if enemy_db.get(v)), eid)
        tags = first_defined(src, "enemyTags") or []
        way, motion, rng = first_defined(src, "applyWay"), first_defined(src, "motion"), first_defined(src, "rangeRadius")
        abil = [tr(a.get("text"), loc, f"abil {eid}") for a in hb.get("abilityList") or [] if clean(a.get("text"))]
        rec = {
            "id": eid, "idx": hb.get("enemyIndex"), "name": enemy_name(eid, loc), "rank": hb.get("enemyLevel"),
            "sort": hb.get("sortId", 9999), "desc": tr(hb.get("description"), loc, f"edesc {eid}"),
            "abil": abil, "dmg": [DAMAGE_LABELS[loc].get(d, d) for d in hb.get("damageType") or []],
            "race": [clean(race_tbl[loc][t]["raceName"]) for t in tags if t in race_tbl[loc]],
            "way": WAY_LABELS[loc].get(way) if way else None,
            "motion": MOTION_LABELS[loc].get(motion) if motion else None,
            "lv": stat_rows(src, loc), "fut": 1,
        }
        if rng and rng > 0:
            rec["rng"] = num(rng)
        link = [x for x in hb.get("linkEnemies") or [] if x in enemy_ix]
        if link:
            rec["link"] = link
        enemies.append(rec)

    items = []
    for r in ev_rows[loc]:
        for it in r.get("items") or []:
            iid = it[0]
            if iid in item_tbl["ko"]:
                continue                     # 본 아이템 도감에 있다
            meta = cn_item.get(iid) or {}
            rarity = str(meta.get("rarity") or "TIER_1")
            rec = {"id": iid, "n": item_name(iid, loc), "r": int(re.sub(r"\D", "", rarity) or 1), "g": "event",
                   "s": meta.get("sortId") or 0, "evName": r["n"], "fut": 1}
            if len(it) > 2 and it[2]:
                rec["i"] = it[2]
            for f, key in (("description", "d"), ("usage", "u")):
                t = tr(meta.get(f), loc, f"{key} {iid}")
                if t:
                    rec[key] = t
            rec["o"] = tr(meta.get("obtainApproach"), loc, f"o {iid}") or ITEM_OBTAIN[loc]
            drops = [[s["id"], s["code"], main_it["occ"].index(occ[dd[1]]), main_it["kinds"].index(kinds[dd[2]])]
                     for s in stages for dd in s.get("d") or []
                     if dd[0] == iid and occ[dd[1]] in main_it["occ"] and kinds[dd[2]] in main_it["kinds"]]
            if drops:
                rec["drop"] = drops
            items.append(rec)

    # 실사 도면 위 경로 투영용 전투 카메라 — 본 도감과 같은 출처·규칙 (scripts/stagecams.py).
    # 원본(72MB)을 못 받는 날은 종전 산출물의 값을 지킨다.
    prev = os.path.join(DATA, f"future-dex{suf}.json")
    keep = {e["id"]: e["cam"] for e in load(prev)["stages"]["stages"] if "cam" in e} if os.path.exists(prev) else {}
    stagecams.attach({"stages": stages}, os.path.join(REPO, "public", "stage"),
                     {sid: (cn_stage.get(sid) or {}).get("levelId") for sid in lv_of}, keep)

    doc = {
        "stages": {"zones": ev_names, "events": ev_names, "items": drop_items, "occ": [], "kinds": [],
                   "enemyIds": enemy_ids, "types": {"ACTIVITY": TYPE_LABEL[loc]}, "enemyNames": enemy_names,
                   "stages": stages},
        "items": items,
        "enemies": enemies,
        "enemyStages": {"stages": rev_rows, "byEnemy": by_enemy},
    }
    p = os.path.join(DATA, f"future-dex{suf}.json")
    json.dump(doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  {os.path.basename(p)}: 작전 {len(stages)} · 적 {len(enemies)} · 재화 {len(items)} · "
          f"카메라 {sum(1 for x in stages if 'cam' in x)} — {os.path.getsize(p)//1024}KB")
    return enemy_names


# ── 그림 (중섭 CDN) — 빌드보다 먼저 받아야 map 플래그가 선다 ───────────────────────
if not NO_IMAGES:
    import cdnassets
    from imgutil import save_webp
    got = 0
    for sid in lv_of:
        dest = os.path.join(REPO, "public", "stage", f"{sid}.webp")
        if os.path.exists(dest):
            continue
        png = cdnassets.png_bytes(f"arts/ui/stage/mappreviews/{sid}", "cn")
        if png is None:
            # 중섭 CDN 은 끝난 이벤트의 도면을 내린다 (act50side·act53side 실측) — 에셋 미러 cn 에는 남아 있다
            # (build-stages.py 와 같은 순서: CDN → 미러)
            try:
                req = urllib.request.Request(f"{MIRROR}/arts/ui/stage/mappreviews/{sid}.png",
                                             headers={"User-Agent": "Mozilla/5.0"})
                png = urllib.request.urlopen(req, timeout=90).read()
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
                png = None
        if png:
            save_webp(png, dest, photo=True, max_px=640, method=4)
            got += 1
    print(f"도면: 새로 받음 {got}")
    got = 0
    for eid in cn_only:
        base = re.sub(r"_\d+$", "", eid)
        dest = os.path.join(REPO, "public", "enemy", f"{eid}.webp")
        if os.path.exists(dest):
            continue
        for c in dict.fromkeys([eid, base]):
            png = cdnassets.png_bytes(f"arts/enemies/{c}", "cn")
            if png is None:          # 끝난 중섭 이벤트 — 미러에서 (도면과 같은 이유)
                try:
                    req = urllib.request.Request(f"{MIRROR}/arts/enemies/{c}.png", headers={"User-Agent": "Mozilla/5.0"})
                    png = urllib.request.urlopen(req, timeout=60).read()
                except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
                    png = None
            if png:
                # 변종도 제 이름으로 한 장 — 프리렌더 <img> 는 onError 폴백이 안 먹는다 (build-enemies.py 와 같은 규약)
                save_webp(png, dest, photo=True, max_px=256, method=4)
                got += 1
                break
    print(f"초상: 새로 받음 {got}")

# ── 이동 경로·작전 시뮬레이터 — app/data/future-routes.json (사용자 지시 2026-09-29 "작전 시뮬레이터는
#    왜 없어? 그것도 적용해줘야지") ─────────────────────────────────────────────
# 본 도감 stage-routes.json 과 같은 추출기·같은 문서 형식이라 화면(app/stage-route-map.tsx)을 그대로 쓴다.
# 같은 레벨을 쓰는 두 번째 작전부터는 별칭 문자열 (본 도감 규약).
# ⚠ 경로 주인 키는 레벨의 **원래 적 키**다 — 작전 창의 적 카드는 숨김 변형을 본체로 접었으므로(위 canon)
#   경로 문서도 같이 접어야 카드 고정·선 색·시뮬 말이 한 적으로 이어진다. 스폰(sp)과 이동속도(ems)는
#   e 의 **키 순서 번호**로 가리키므로 번호까지 다시 매긴다 (VEC-08 의 과관류 `_2`·`_3` 이 한 키로 합쳐진다).
import stagecams  # noqa: E402
from routeutil import routes_of_level  # noqa: E402


def fold_routes(d):
    keys = list(d.get("e") or {})
    order, first_at, merged = [], {}, {}
    for i, k in enumerate(keys):
        c = canon(k) or k                  # 본체가 없는 개체는 원래 키 그대로 (이름은 아래 nm 이 붙인다)
        if c not in merged:
            merged[c], first_at[c] = set(), i
            order.append(c)
        merged[c] |= set(d["e"][k])
    if order == keys:
        return d
    remap = {i: order.index(canon(k) or k) for i, k in enumerate(keys)}
    d["e"] = {c: sorted(merged[c]) for c in order}
    for sp in d.get("sp") or []:
        sp[5] = remap[sp[5]]
    if d.get("ems"):
        d["ems"] = [d["ems"][first_at[c]] for c in order]
    return d


routes, first_sid = {}, {}
for sid, lv in lv_json.items():
    if not lv:
        continue
    lid = ((cn_stage.get(sid) or {}).get("levelId") or "").lower()
    if lid in first_sid:
        routes[sid] = first_sid[lid]
        continue
    d = routes_of_level(lv, enemy_db)
    if d:
        routes[sid] = fold_routes(d)
        first_sid[lid] = sid
_body = lambda v: routes.get(v) if isinstance(v, str) else v
sim_ids = {sid for sid, v in routes.items() if (_body(v) or {}).get("sp")}   # 본 도감 sim 과 같은 판정

names_of = {}
for loc, _, suf in LOCALES:
    names_of[loc] = build(loc, suf)

# 경로 주인 이름·초상(nm) — 작전의 적 카드 밖에 있는 주인(본체가 없어 뺀 개체·기믹 소환)만. 빠지면 시뮬 말풍선에
# id 가 찍히고 말이 까맣게 빈다 (scripts/routenames.py 머리주석). 이름표 = 본 적 도감 + 미래시 도감 이름.
import routenames  # noqa: E402
_names = {loc: {**{e["id"]: e["name"] for e in load(os.path.join(DATA, f"enemies{suf}.json"))}, **names_of[loc]}
          for loc, _, suf in LOCALES}
n_nm = 0
for sid, d in routes.items():
    if not isinstance(d, dict):
        continue
    known = {canon(e) for e, _, _ in lv_of.get(sid) or [] if canon(e)}
    nm = routenames.owner_names(lv_json[sid], list(d.get("e") or {}), known, enemy_db,
                                lambda pf, k: routenames.portrait([pf, k], ["enemy"]), _names)
    if nm:
        d["nm"] = nm
        n_nm += len(nm)
rp = os.path.join(DATA, "future-routes.json")
json.dump(routes, open(rp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"  future-routes.json: 경로 {sum(1 for v in routes.values() if isinstance(v, dict))} · 별칭 "
      f"{sum(1 for v in routes.values() if isinstance(v, str))} · 시뮬 {len(sim_ids)} · 경로 주인 이름 보충 {n_nm} — "
      f"{os.path.getsize(rp)//1024}KB")

rep = {loc: dict(sorted(v.items())) for loc, v in missing.items() if v}
json.dump(rep, open(os.path.join(REPO, "scripts", "future-dex-untranslated.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
for loc in rep:
    print(f"  ⚠ 미래시 도감 미번역 {loc} {len(rep[loc])}건 — scripts/cn-translations.json 에 채울 것 "
          f"(목록: scripts/future-dex-untranslated.json)")
