#!/usr/bin/env python3
"""작전 도감(/stages)·작전 시뮬레이터(/sim)에 얹는 **위기협약 색인** — app/data/stages-crisis{,.en,.ja}.json.

사용자 요청 2026-10-16 "위기협약 해줘" → 안 1 "지금 데이터로 만들 수 있는 것만". 통합전략·생존연산 색인
(build-stages-rogue.py · build-stages-sandbox.py)과 **같은 방식**이다 — 자기 완결형 미니 StageDoc 을 내고,
화면(app/stages-*.tsx · app/sim-launcher.tsx)이 mergeRogueDoc 으로 본 문서 뒤에 이어 붙인다.

사용:
  python3 scripts/build-stages-crisis.py              # 게임 CDN (표·레벨·도면)
  python3 scripts/build-stages-crisis.py --no-images  # 도면은 받아 둔 것만

## 무엇이 클라이언트 데이터에 있고, 무엇이 없나 (2026-10-16 조사)

- `crisis_v2_table.seasonInfoDataMap` — 시즌(#1 파이롤리시스 …) 이름·기간·코드뿐이다.
- 시즌 맵 = `levels/obt/crisis/v2/level_crisis_v2_<시즌>-<번호>` — 지형·적·웨이브는 있지만 **맵 이름이 없고,
  계약 지표(태그)도 없다** (레벨의 runes·optionalRunes 가 비어 있다). 시즌 지표·점수·위험도별 보상은 시즌이 열릴 때
  **게임 서버가 내려 준다** — 표에도 번들(crisisv2longterm·ui/[uc]crisisv2)에도 글이 없다. 지표 아이콘 그림
  (arts/ui/[uc]crisisv2/runeicon, 438장)만 있다. 그래서 시즌 맵은 '맵 N' 이름에 지형·적·경로·시뮬만 싣는다.
- `crisis_v2_table.recalRuneData` — **홀로그램 매트릭스**(투영 작전 매트릭스, 지난 작전을 지표를 걸어 다시 하는 상설 모드).
  여기는 맵마다 작전 이름·원본 작전·설명·**지표(설명·점수·필수 여부·배타 묶음)·훈장 점수**가 다 있다 → `rn` 으로 싣는다.

중섭에만 있는 시즌(#5)·매트릭스 시즌(#2)은 미래시 — 이름 뒤에 '중국 서버 선행'을 붙이고, 중국어 문구는
scripts/crisis-tl.json(중국어 원문 → {ko,en,ja})으로 옮긴다. 못 옮긴 문구는 scripts/crisis-untranslated.json 에 적는다.

⚠ stages.json 에 섞지 않는다 — 통합전략과 같은 이유(상세 페이지 파일 수 한도, build-stages-rogue.py 머리주석).
  위기협약 맵은 목록과 모달(#st-<id>)로만 본다. 도면은 본 도감과 같은 폴더(public/stage/<id>.webp, R2)에 둔다.

출력:
  app/data/stages-crisis{,.en,.ja}.json   미니 StageDoc (Stage.cc = 1)
  app/data/crisis-routes.json            이동 경로·시뮬 (stage-routes.json 과 같은 형식)
  public/stage/<id>.webp                 도면 (시즌 맵 = 인게임 미리보기, 매트릭스 = 격자 렌더)
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DATA = os.path.join(REPO, "app", "data")
STAGE_IMG = os.path.join(REPO, "public", "stage")
sys.path.insert(0, HERE)
NO_IMAGES = "--no-images" in sys.argv
LOCALES = [("ko", "kr", ""), ("en", "en", ".en"), ("ja", "jp", ".ja")]
load = lambda p: json.load(open(p, encoding="utf-8"))

import cdntables  # noqa: E402
import cdnlevels  # noqa: E402
import cdnassets  # noqa: E402
import enemyvariant  # noqa: E402
import routenames  # noqa: E402
import stagecams  # noqa: E402
from routeutil import routes_of_level, devices_of_level  # noqa: E402

# 공식 표기는 띄어 쓴 '위기 협약' (한섭 활동 일정표 "위기 협약 <정죄 작전> 이벤트 개방 중", 2026-10-16 확인)
TYPE_LABEL = {"ko": "위기 협약", "en": "Contingency Contract", "ja": "危機契約"}
SEASON_EV = {"ko": "위기 협약 {code} <{name}>", "en": "Contingency Contract {code} {name}", "ja": "危機契約{code} {name}"}
MATRIX_EV = {"ko": "홀로그램 매트릭스 #{code}", "en": "Holographic Combat Matrix #{code}", "ja": "投影作戦マトリクス #{code}"}
# 맵 이름 — 시즌 전용 곡(bgmEvent = <시즌>_main)을 쓰는 판이 메인, 지난 이벤트 곡을 쓰는 판이 로테이션이다
# (2026-10-16 레벨 49개 전수). 이름은 훈장 획득 조건 문구의 공식 표기 (kr/en/jp medal_table)
MAP_MAIN = {"v2": {"ko": "메인 실험 장소", "en": "Main Test Site", "ja": "通常試験区画"},
            "v1": {"ko": "상주 작전 지점", "en": "Permanent Operation Site", "ja": "通常作戦地域"}}
MAP_ROT = {"v2": {"ko": "로테이션 실험 장소", "en": "Rotating Test Site", "ja": "緊急試験区画"},
           "v1": {"ko": "로테이션 작전 지점", "en": "Rotating Operation Site", "ja": "緊急作戦地域"}}
# 이벤트 가이드 창의 안내 한 줄 — 시즌 지표는 데이터에 없다 (머리주석)
NOTE = {"ko": "시즌 지표(계약 태그)·위험도별 보상은 시즌 중에만 게임 서버가 내려 줘 게임 데이터에 없습니다 — 맵·등장 적·훈장 조건·일정만 싣습니다.",
        "en": "Season criteria (contract tags) and risk rewards are sent by the game server only during the season and are not in the game data — this page lists maps, enemies, medal conditions and the schedule.",
        "ja": "シーズンの指標（契約タグ）と危機等級ごとの報酬は開催中にのみゲームサーバーから配信され、ゲームデータにはありません。マップ・出現する敵・勲章の条件・日程のみ掲載しています。"}
EV_ETA = {"crisis_v2_season_5_1": "2026-12"}   # 한섭 개방 예정 (사용자 제공 일정 2026-10-16 "위기협약 #5 12/10")
FUTURE = {"ko": " (중국 서버 선행)", "en": " (CN preview)", "ja": "（中国版先行）"}
PERIOD = {"ko": "{srv} 서버 기간 {a} ~ {b}", "en": "{srv} server: {a} – {b}", "ja": "{srv}版の開催期間 {a}～{b}"}
SRV_NAME = {"ko": {"kr": "한국", "cn": "중국"}, "en": {"en": "Global", "cn": "CN"}, "ja": {"jp": "日本", "cn": "中国"}}
MATRIX_SRC = {"ko": "원본 작전: {type} {name} {code}", "en": "Original stage: {type} {name} {code}",
              "ja": "元の作戦：{type}「{name}」{code}"}
# 시즌 #5 (중섭 선행) — 공식 이름이 아직 없다. 한국어는 한자음(涤 씻을 척 · 墨 먹 묵), 영어는 병음, 일본어는 한자 그대로.
SEASON_NAME_FUT = {"crisis_v2_season_5_1": {"ko": "척묵 작전", "en": "Operation Dimo", "ja": "作戦コード「滌墨」"}}
TZ = {"kr": 9, "jp": 9, "cn": 8, "en": -7}   # 기간 표기용 — 각 서버의 공지 시간대 (글섭은 UTC-7)


def clean(s):
    """리치 텍스트 태그(<@recalrune.nag>…</>)를 벗긴다 — build-stages.py clean 과 같다."""
    if not isinstance(s, str):
        return s
    # ⚠ 글자 태그는 @·$ 로 시작하는 것과 color/size 뿐이다 — `<Patriot>` 같은 영문 적 이름 꺾쇠까지 지우면
    #   글섭 지표 문구의 주어가 사라진다 ("no longer waits", 2026-10-16)
    s = re.sub(r"<[@$][^>]*>|</>|</?(?:color|size|b|i)(?:=[^>]*)?>", "", s.replace("\r\n", "\n").replace("\\n", "\n"))
    s = re.sub(r"[ \t]+", " ", s)
    return "\n".join(ln.strip() for ln in s.split("\n")).strip() or None


def mv(field, default=None):
    if isinstance(field, dict) and "m_defined" in field:
        return field["m_value"] if field["m_defined"] else default
    return field if field is not None else default


def fill(desc, packed):
    """지표 설명의 자리표시 {max_hp:0%}·{def} 를 그 지표의 blackboard 값으로 채운다 (중섭 매트릭스 #2 가 쓴다)."""
    bb = {}
    for r in (packed or {}).get("runes") or []:
        for b in r.get("blackboard") or []:
            if b.get("key") is not None and b.get("value") is not None:
                bb.setdefault(b["key"], b["value"])

    def rep(m):
        key, fmt = m.group(1), m.group(2)
        v = bb.get(key)
        if v is None:
            return m.group(0)
        if fmt and fmt.endswith("%"):
            return f"{round(abs(v) * 100) if v < 0 and m.string[max(0, m.start() - 1):m.start()] == '-' else round(v * 100)}%"
        return str(int(v)) if float(v).is_integer() else str(round(v, 2))
    return re.sub(r"\{([A-Za-z_\[\]\.]+)(?::([0-9.]*%?))?\}", rep, desc or "")


# ── 번역 (중섭 전용 문구) ─────────────────────────────────────────────────────
TL_PATH = os.path.join(HERE, "crisis-tl.json")
TL = load(TL_PATH) if os.path.exists(TL_PATH) else {}
missing = {}
HAN = re.compile(r"[一-鿿]")


def tr(cn, loc):
    cn = clean(cn)
    if not cn:
        return cn
    got = (TL.get(cn) or {}).get(loc)
    if got:
        return got
    if HAN.search(cn):
        missing.setdefault(cn, {})
    return cn


# ── 표 ─────────────────────────────────────────────────────────────────────
tables = {}
for srv in ("kr", "en", "jp", "cn"):
    t = cdntables.table("crisis_v2_table", server=srv)
    if not t:
        sys.exit(f"✗ {srv} crisis_v2_table 을 못 받았다")
    tables[srv] = t
# v1 (2020-09 ~ 2023-10, #0 황무지 ~ #12 베이스포인트) — crisis_table. 시즌 맵은 levels/obt/rune/level_rune_<시즌+2>-NN
# (#1 → 03 … #12 → 14 — 레벨의 bgmEvent 가 rune_season_<n>_1_main 인 판으로 확인. 01·02 묶음은 시즌 곡이 없는 공용 맵이라 뺀다)
V1 = {srv: cdntables.table("crisis_table", server=srv) or {} for srv in ("kr", "en", "jp")}
ACT = {srv: cdntables.table("activity_table", server=srv) or {} for srv in ("kr", "en", "jp", "cn")}
MEDAL = {srv: cdntables.table("medal_table", server=srv) or {} for srv in ("kr", "en", "jp", "cn")}
print("시즌: " + " · ".join(f"{s['crisisV2SeasonCode']} {s['name']}" for s in tables["kr"]["seasonInfoDataMap"].values()))

# 레벨 목록 — 매니페스트에 있는 시즌 맵 레벨 (서버마다). 한섭에 있으면 한섭 판, 없으면 중섭 판.
def level_names(srv):
    mani = cdnlevels._conn(srv).manifest()
    out = set()
    for k in mani:
        m = re.match(r"^gamedata/levels/obt/(crisis/v2/level_crisis_v2_\d+-\d+|recalrune/level_recalrune_\d+-\d+|rune/level_rune_\d+-\d+)$", k)
        if m:
            out.add(m.group(1))
    return out


LV_KR, LV_CN = level_names("kr"), level_names("cn")
LEVELS = {}
for rel in sorted(LV_KR | LV_CN):
    srv = "kr" if rel in LV_KR else "cn"
    d = cdnlevels.level("obt/" + rel, server=srv)
    if d:
        LEVELS[rel] = (srv, d)
print(f"레벨 {len(LEVELS)}개 (한섭 {sum(1 for v in LEVELS.values() if v[0] == 'kr')} · 중섭만 "
      f"{sum(1 for v in LEVELS.values() if v[0] == 'cn')})")


def flat_db(raw):
    if isinstance(raw, list):
        return {e["Key"]: e["Value"] for e in raw if isinstance(e, dict) and "Key" in e}
    return raw or {}


ENEMY_DB = {srv: flat_db(cdnlevels.level("levels/enemydata/enemy_database", schema="enemy_database", server=srv))
            for srv in ("kr", "cn")}
BOOK = {srv: (cdntables.table("enemy_handbook_table", server=srv) or {}).get("enemyData") or {} for srv in ("kr", "cn")}
STATS = load(os.path.join(DATA, "enemy-stats.json"))
MAIN_NAMES = {loc: {e["id"]: e["name"] for e in load(os.path.join(DATA, f"enemies{suf}.json"))} for loc, _, suf in LOCALES}


def level_enemies(lv):
    """[(적id, 스폰 수, 스탯 단계, overwrittenData)] — build-future-dex.py level_enemies 와 같은 셈."""
    counts, order, ref_of = {}, [], {}
    for ref in (lv or {}).get("enemyDbRefs") or []:
        key = ref.get("id")
        if key and key not in counts:
            counts[key] = 0
            ref_of[key] = ref
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
    return [(k, counts.get(k, 0), ref_of[k].get("level", 0) or 0, ref_of[k].get("overwrittenData")) for k in order]


def canon(eid, srv):
    """도감에 보이는 본체 — 본 적 도감(KR 정본)에 있으면 그대로, 숨김 변형이면 본체 (enemyvariant)."""
    if eid in MAIN_NAMES["ko"]:
        return eid
    rows = ENEMY_DB[srv].get(eid) or ENEMY_DB["kr"].get(eid) or []
    nm = mv(((rows[0] or {}).get("enemyData") or {}).get("name")) if rows else None
    for book in (BOOK["kr"], BOOK[srv]):
        c = enemyvariant.visible(eid, book, nm)
        if c:
            return c
    return None


def core_stats(eid, lvl, ow, srv):
    """그 판의 코어 스탯 [hp,atk,def,res] — 적 DB 의 그 단계 + 레벨의 덮어쓰기. 색인 기본형과 같으면 0."""
    rows = ENEMY_DB[srv].get(eid) or ENEMY_DB["kr"].get(eid) or []
    row = next((r for r in rows if r.get("level", 0) == lvl), rows[0] if rows else None)
    base = (((row or {}).get("enemyData") or {}).get("attributes")) or {}
    over = ((ow or {}).get("attributes")) or {}
    keys = ("maxHp", "atk", "def", "magicResistance")
    mine = []
    for k in keys:
        v = mv(over.get(k))
        if v is None:
            v = mv(base.get(k))
        mine.append(v)
    if any(v is None for v in mine):
        return 0
    mine = [int(v) if float(v).is_integer() else round(v, 2) for v in mine]
    idx = STATS.get(eid) or []
    r = next((x for x in idx if x[0] == lvl), idx[0] if idx else None)
    if r and all(abs(a - b) < 1e-9 for a, b in zip(r[1:5], mine)):
        return 0
    return mine


def ymd(ts, srv):
    return (datetime.fromtimestamp(ts, timezone.utc) + timedelta(hours=TZ[srv])).strftime("%Y.%m.%d")


# ── 작전 목록 (로케일 무관 골격) ────────────────────────────────────────────────
seasons = sorted(tables["cn"]["seasonInfoDataMap"].values(), key=lambda s: s["startTs"])
plan = []   # {sid, rel, season, kind: "map"|"matrix", gen: "v1"|"v2", main, n, code}


def add_maps(season_id, prefix, rels, code, gen, bgm_main):
    """한 시즌의 맵 — 시즌 곡을 쓰는 판이 메인(먼저), 나머지는 로테이션 1·2·3 (파일 번호 순)"""
    main = [r for r in rels if (LEVELS[r][1].get("bgmEvent") or "") == bgm_main]
    rest = [r for r in rels if r not in main]
    for i, rel in enumerate(main + rest):
        plan.append({"sid": prefix + rel.rsplit("_", 1)[1], "rel": rel, "season": season_id, "kind": "map", "gen": gen,
                     "main": rel in main, "n": rest.index(rel) + 1 if rel in rest else 0, "multi": len(rest) > 1,
                     "code": f"{code}-{i + 1}"})


for s1 in sorted(V1["kr"].get("seasonInfo") or [], key=lambda x: x["startTs"]):
    n = int(re.search(r"season_(\d+)_", s1["seasonId"]).group(1))
    if n < 1:
        continue   # #0 황무지(베타) — 시즌 곡을 쓰는 맵이 없다
    rels = sorted(r for r in LEVELS if r.startswith(f"rune/level_rune_{n + 2:02d}-"))
    add_maps(s1["seasonId"], "level_rune_", rels, f"#{n}", "v1", f"{s1['seasonId']}_main")
for s in seasons:
    n = int(re.search(r"season_(\d+)_", s["seasonId"]).group(1))
    rels = sorted(r for r in LEVELS if r.startswith(f"crisis/v2/level_crisis_v2_{n:02d}-"))
    add_maps(s["seasonId"], "crisis_v2_", rels, s["crisisV2SeasonCode"], "v2", f"{s['seasonId']}_main")
recal_cn = tables["cn"]["recalRuneData"]["seasons"]
for rs in sorted(recal_cn.values(), key=lambda x: x["sortId"]):
    for st in rs["stages"].values():
        rel = "recalrune/" + st["levelId"].rsplit("/", 1)[1].lower()
        if rel in LEVELS:
            plan.append({"sid": st["stageId"], "rel": rel, "season": rs["seasonId"], "kind": "matrix"})


def map_name(p, loc):
    if p["main"]:
        return MAP_MAIN[p["gen"]][loc]
    return MAP_ROT[p["gen"]][loc] + (f" {p['n']}" if p["multi"] else "")


def season_meta(season_id, loc, srv):
    """(이벤트 이름, 기간 줄, 미래시 여부, 시작·끝 ts(KST 기준 한섭 — 없으면 그 판)) — 그 로케일 서버에 없으면 중섭 판으로."""
    if season_id.startswith("rune_season"):
        own = next((x for x in V1[srv].get("seasonInfo") or [] if x["seasonId"] == season_id), None)
        kr = next(x for x in V1["kr"]["seasonInfo"] if x["seasonId"] == season_id)
        meta = own or kr
        n = re.search(r"season_(\d+)_", season_id).group(1)
        ev = SEASON_EV[loc].format(code=f"#{n}", name=meta["name"])
        period = PERIOD[loc].format(srv=SRV_NAME[loc][srv], a=ymd(meta["startTs"], srv), b=ymd(meta["endTs"], srv)) if own else None
        return ev, period, False, (kr["startTs"], kr["endTs"])
    if season_id.startswith("crisis_v2"):
        own = tables[srv]["seasonInfoDataMap"].get(season_id)
        meta = own or tables["cn"]["seasonInfoDataMap"][season_id]
        kr = tables["kr"]["seasonInfoDataMap"].get(season_id)
        name = meta["name"] if own else (SEASON_NAME_FUT.get(season_id) or {}).get(loc) or tr(meta["name"], loc)
        ev = SEASON_EV[loc].format(code=meta["crisisV2SeasonCode"], name=name)
        period = PERIOD[loc].format(srv=SRV_NAME[loc][srv if own else "cn"], a=ymd(meta["startTs"], srv if own else "cn"),
                                    b=ymd(meta["endTs"], srv if own else "cn"))
        return ev, period, not own, ((kr["startTs"], kr["endTs"]) if kr else None)
    own = tables[srv]["recalRuneData"]["seasons"].get(season_id)
    meta = own or recal_cn[season_id]
    kr = tables["kr"]["recalRuneData"]["seasons"].get(season_id)
    return MATRIX_EV[loc].format(code=meta["seasonCode"]), None, not own, ((kr["startTs"], None) if kr else None)


def matrix_stage(season_id, sid, srv):
    own = (tables[srv]["recalRuneData"]["seasons"].get(season_id) or {}).get("stages", {}).get(sid)
    return own, own is None


def build(loc, srv):
    ev_list, ev_ix, enemy_ids, enemy_ix, names = [], {}, [], {}, {}
    stages = []

    def intern(v, lst, ix):
        if v not in ix:
            ix[v] = len(lst)
            lst.append(v)
        return ix[v]

    for p in plan:
        ev_name, period, fut, _ = season_meta(p["season"], loc, srv)
        ev = intern(ev_name + (FUTURE[loc] if fut else ""), ev_list, ev_ix)
        rec = {"id": p["sid"], "t": "CRISIS", "ev": ev, "z": ev, "cc": 1}
        if p["kind"] == "map":
            rec["code"] = p["code"]
            rec["name"] = map_name(p, loc)
            if period:
                rec["desc"] = period
        else:
            st, cn_only = matrix_stage(p["season"], p["sid"], srv)
            st = st or recal_cn[p["season"]]["stages"][p["sid"]]
            T = (lambda x: tr(x, loc)) if cn_only else clean
            rec["code"] = clean(st.get("levelCode")) or p["sid"]
            rec["name"] = (T(st.get("levelName")) or p["sid"]).lstrip("#")
            src = MATRIX_SRC[loc].format(type=T(st.get("sourceType")) or "", name=T(st.get("sourceName")) or "",
                                         code=rec["code"]).replace("  ", " ")
            body = T(st.get("levelDesc"))
            rec["desc"] = "\n".join(x for x in (src, body) if x)
            # 지표 — [점수, 설명, 필수(1)|0, 배타 묶음 번호|-1] · 세트 이름 · 훈장 점수 [하급, 상급]
            groups = []
            rn = []
            for r in sorted(st["runes"].values(), key=lambda x: x.get("sortId", 0)):
                pr = r.get("packedRune") or {}
                d = clean(fill(pr.get("description"), pr))
                d = T(d) if cn_only else d
                g = r.get("exclusiveGroupId")
                gi = -1
                if g:
                    if g not in groups:
                        groups.append(g)
                    gi = groups.index(g)
                rn.append([r.get("score") or 0, d or r["runeId"], 1 if r.get("essential") else 0, gi])
            rec["rn"] = {"set": T(st.get("fixedRuneSeriesName")), "medal": [st.get("juniorMedalScore"), st.get("seniorMedalScore")],
                         "r": rn}
        lv_srv, lv = LEVELS[p["rel"]]
        e, es = [], []
        seen = {}
        for key, cnt, lvl, ow in level_enemies(lv):
            c = canon(key, lv_srv)
            if not c:
                continue
            nm = MAIN_NAMES[loc].get(c) or MAIN_NAMES["ko"].get(c)
            if not nm:
                book_nm = (BOOK["cn"].get(c) or BOOK["kr"].get(c) or {}).get("name")
                nm = tr(book_nm, loc) if book_nm else None
            if not nm:
                continue
            if c in seen:          # 숨김 변형을 본체로 접으면 같은 적이 둘 — 수를 합친다
                e[seen[c]][1] += cnt
                continue
            names.setdefault(c, nm)
            seen[c] = len(e)
            e.append([intern(c, enemy_ids, enemy_ix), cnt, lvl])
            es.append(core_stats(key, lvl, ow, lv_srv))
        if e:
            rec["e"] = e
            if any(es):
                rec["es"] = es
        if os.path.exists(os.path.join(STAGE_IMG, p["sid"] + ".webp")):
            rec["map"] = 1
        if p["sid"] in SIM:
            rec["sim"] = 1
        if fut:
            rec["fut0"] = 1      # 표시용 아님 — 아래 요약 줄이 센다 (저장 전에 뺀다)
        stages.append(rec)
    return {"zones": ev_list, "events": ev_list, "items": {}, "occ": [], "kinds": [], "enemyIds": enemy_ids,
            "types": {"CRISIS": TYPE_LABEL[loc]}, "enemyNames": names, "stages": stages}


# ── 도면 — 빌드보다 먼저 받아야 map 플래그가 선다 ────────────────────────────────
if not NO_IMAGES:
    from imgutil import save_webp
    import importlib.util as _ilu
    _spec = _ilu.spec_from_file_location("build_rogue", os.path.join(HERE, "build-rogue.py"))
    _rogue = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_rogue)
    got = drawn = 0
    for p in plan:
        dest = os.path.join(STAGE_IMG, p["sid"] + ".webp")
        if os.path.exists(dest):
            continue
        png = None
        if p["kind"] == "map":
            for srv in ("kr", "cn"):
                png = cdnassets.png_bytes(f"arts/ui/stage/mappreviews/{p['sid']}", srv)
                if png:
                    break
        if png:
            save_webp(png, dest, photo=True, max_px=640, method=4)
            got += 1
        elif _rogue.render_minimap(LEVELS[p["rel"]][1], dest):   # 매트릭스 — 인게임 미리보기가 없다
            drawn += 1
    print(f"도면: 미리보기 {got} · 격자 렌더 {drawn}")

# ── 이동 경로·시뮬 ───────────────────────────────────────────────────────────
routes = {}
for p in plan:
    lv_srv, lv = LEVELS[p["rel"]]
    d = routes_of_level(lv, {**ENEMY_DB["kr"], **ENEMY_DB[lv_srv]} if lv_srv != "kr" else ENEMY_DB["kr"])
    if d:
        d.update(devices_of_level(lv, p["sid"]))
        routes[p["sid"]] = d
SIM = {sid for sid, d in routes.items() if d.get("sp") and d.get("wv")}

by_loc = {loc: build(loc, srv) for loc, srv, _ in LOCALES}

# 경로 주인 이름·초상(nm) — 적 카드 밖의 주인(숨김 변형·기믹 소환)만 (routenames 머리주석)
n_nm = 0
for p in plan:
    d = routes.get(p["sid"])
    if not d:
        continue
    lv_srv, lv = LEVELS[p["rel"]]
    known = {c for c in (canon(k, lv_srv) for k, *_ in level_enemies(lv)) if c} & set(d.get("e") or {})
    nm = routenames.owner_names(lv, list(d.get("e") or {}), known, ENEMY_DB[lv_srv],
                                lambda pf, k: routenames.portrait([pf, k], ["enemy"]), MAIN_NAMES)
    if nm:
        d["nm"] = nm
        n_nm += len(nm)
rp = os.path.join(DATA, "crisis-routes.json")
json.dump(routes, open(rp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"  crisis-routes.json: 경로 {len(routes)} · 시뮬 {len(SIM)} · 경로 주인 이름 보충 {n_nm} — {os.path.getsize(rp) // 1024}KB")

# 실사 도면 위 경로 투영용 전투 카메라 — 본 도감과 같은 출처·규칙 (scripts/stagecams.py)
LV_DIR = {"crisis": "Crisis/v2/", "recalrune": "Recalrune/", "rune": "Rune/"}
level_of = {p["sid"]: "Obt/" + LV_DIR[p["rel"].split("/", 1)[0]] + p["rel"].rsplit("/", 1)[1] for p in plan}
for loc, _, suf in LOCALES:
    prev = os.path.join(DATA, f"stages-crisis{suf}.json")
    keep = {e["id"]: e["cam"] for e in load(prev)["stages"] if "cam" in e} if os.path.exists(prev) else {}
    stagecams.attach(by_loc[loc], STAGE_IMG, level_of, keep, grid_of=lambda sid: (routes.get(sid) or {}).get("g"))

for loc, _, suf in LOCALES:
    doc = by_loc[loc]
    n_fut = sum(1 for s in doc["stages"] if s.pop("fut0", None))
    p = os.path.join(DATA, f"stages-crisis{suf}.json")
    json.dump(doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    st = doc["stages"]
    print(f"  {os.path.basename(p)}: 작전 {len(st)} (미래시 {n_fut}) · 시즌 {len(doc['events'])} · 도면 "
          f"{sum(1 for s in st if s.get('map'))} · 카메라 {sum(1 for s in st if s.get('cam'))} · 시뮬 "
          f"{sum(1 for s in st if s.get('sim'))} · 적 {len(doc['enemyIds'])} · {os.path.getsize(p) // 1024}KB")

# ── 이벤트 가이드 — 시즌 하나 = 이벤트 카드 하나 (사용자 지시 2026-10-16 "이벤트 가이드에 들어가야 하는 거 아님?") ─────
# app/data/events-crisis{,.en,.ja}.json — 이벤트 도감 행(EventRow)과 같은 모양. 화면(app/events-*.tsx)이 events.json 에 이어 붙인다.
# 추가 탭(일정·훈장)은 이벤트 도감과 같은 자리(app/data/event-extra/<로케일>/<시즌 id>.json)에 둔다 — build-event-extra.py 가
# 이 목록의 id 는 지우지 않는다. 훈장 그림은 build-event-art.py --extra 가 그 파일을 읽어 받는다.
KST = timezone(timedelta(hours=9))
when = lambda ts: datetime.fromtimestamp(ts, KST).strftime("%Y-%m-%d %H:%M") if ts else None
day = lambda ts: datetime.fromtimestamp(ts, KST).strftime("%Y-%m-%d") if ts else None
THUMB_DIR = os.path.join(REPO, "public", "event", "crisis")
SER = {"rune": "cc1", "cris": "cc2", "reca": "hm"}
season_ids = list(dict.fromkeys(p["season"] for p in plan))


def thumb_path(sid):
    """시즌 그림 — 위기 협약은 **그 시즌 메인 맵의 실사 도면**(public/stage, 512px). 상점 시즌 배경(shopseasonback)은 111px 라
    카드에서 깨지고, 시즌 키 비주얼은 아틀라스 한 장(crisisv2longterm)에 다른 조각과 섞여 있어 시즌마다 자를 자리가 다르다
    (2026-10-16 실측). 홀로그램 매트릭스는 세로 시즌 그림(seasonpics, 288×540)이 있어 그것을 public/event/crisis 에."""
    if not sid.startswith("recalRune"):
        main = next((p for p in plan if p["season"] == sid and p.get("main")), None) or next((p for p in plan if p["season"] == sid), None)
        return f"/stage/{main['sid']}.webp" if main and os.path.exists(os.path.join(STAGE_IMG, main["sid"] + ".webp")) else None
    low = sid.lower()
    dest = os.path.join(THUMB_DIR, sid + ".webp")
    if not os.path.exists(dest) and not NO_IMAGES:
        from imgutil import save_webp
        for srv in ("kr", "cn"):
            png = cdnassets.png_bytes(f"arts/ui/recalrune/seasonpics/{low}/{low}", srv)
            if png:
                os.makedirs(THUMB_DIR, exist_ok=True)
                save_webp(png, dest, photo=True, max_px=640, method=4)
                break
    return f"/event/crisis/{sid}.webp" if os.path.exists(dest) else None


THUMBS = {sid: thumb_path(sid) for sid in season_ids}


def medal_ids(sid, srv):
    """시즌의 훈장 — 위기 협약은 시즌 훈장 세트, 매트릭스는 대표 훈장 + 작전마다 하급·상급 (세트가 없다)"""
    groups = {g["groupId"]: g for t in (MEDAL[srv].get("medalTypeData") or {}).values() for g in (t.get("groupData") or [])}
    if sid.startswith("rune_season"):
        meta = next((x for x in V1["kr"]["seasonInfo"] if x["seasonId"] == sid), {})
        g = groups.get(meta.get("medalGroupId") or "")
        return (g or {}).get("medalId") or [], g
    if sid.startswith("crisis_v2"):
        meta = tables[srv]["seasonInfoDataMap"].get(sid) or tables["cn"]["seasonInfoDataMap"][sid]
        g = groups.get(meta.get("medalGroupId") or "")
        return (g or {}).get("medalId") or [], g
    meta = tables[srv]["recalRuneData"]["seasons"].get(sid) or recal_cn[sid]
    ids = [meta.get("mainMedalId")] + [m for st in meta["stages"].values() for m in (st.get("juniorMedalId"), st.get("seniorMedalId"))]
    return [m for m in ids if m], None


def extra_of(sid, loc, srv, fut):
    msrv = "cn" if fut else srv
    ml = {m["medalId"]: m for m in MEDAL[msrv].get("medalList") or []}
    T = (lambda x: tr(x, loc)) if fut else clean
    ids, g = medal_ids(sid, msrv)
    rows = []
    for mid in ids:
        md = ml.get(mid)
        if md and md.get("medalName"):
            adv = ml.get(md.get("advancedMedal") or "") or {}
            rows.append([mid, T(md["medalName"]) or mid, md.get("rarity") or "", T(md.get("getMethod")) or "",
                         T(md.get("description")) or "", 1 if md.get("isHidden") else 0] + ([T(adv.get("getMethod")) or "?"] if adv else []))
    rec = {}
    if rows:
        rec["medals"] = {"list": rows}
        if g and g.get("groupName"):
            rec["medals"]["set"] = [T(g["groupName"]) or "", T(g.get("groupDesc")) or ""]
    # 일정 — 활동 일정표(actThemes)의 그 시즌 줄. 시각은 한섭(KST), 문구는 그 로케일 서버 표 (없으면 한섭)
    theme = {t["funcId"]: t for t in ACT["cn" if fut else "kr"].get("actThemes") or [] if t.get("funcId")}.get(sid)
    loc_theme = {t["funcId"]: t for t in ACT["cn" if fut else srv].get("actThemes") or [] if t.get("funcId")}.get(sid) or theme
    if theme:
        nodes = theme.get("timeNodes") or []
        titles = [n.get("title") for n in (loc_theme.get("timeNodes") or [])]
        sch = {"s": when(theme.get("startTs")), "e": when(theme.get("endTs"))}
        n = [[when(x["ts"]), T(titles[i] if i < len(titles) and titles[i] else x.get("title")) or ""] for i, x in enumerate(nodes)]
        if n:
            sch["n"] = n
        if fut:
            sch["cn"] = 1
        rec["sched"] = sch
    elif sid.startswith("rune_season"):
        # v1 #1~#5 는 일정표에 줄이 없다 — 시즌 시작·끝만
        meta = next((x for x in V1["kr"]["seasonInfo"] if x["seasonId"] == sid), None)
        if meta:
            rec["sched"] = {"s": when(meta["startTs"]), "e": when(meta["endTs"])}
    return rec or None


ev_docs = {}
for loc, srv, suf in LOCALES:
    doc = by_loc[loc]
    rows = []
    for sid in season_ids:
        ev_name, _, fut, kr_ts = season_meta(sid, loc, srv)
        mine = [p for p in plan if p["season"] == sid]
        st_by = {x["id"]: x for x in doc["stages"]}
        row = {"id": sid, "n": ev_name, "type": "CRISIS"}
        if kr_ts and not fut:
            row["start"], row["end"] = day(kr_ts[0]), day(kr_ts[1])
        else:
            row["start"] = row["end"] = None
            row["fut"] = 1
            if EV_ETA.get(sid):
                row["eta"] = EV_ETA[sid]
        if THUMBS.get(sid):
            row["thumb"] = THUMBS[sid]
        row["stages"] = [[p["sid"], st_by[p["sid"]]["code"], st_by[p["sid"]]["name"]] for p in mine]
        en_seen = {}
        for p in mine:
            for i, *_ in st_by[p["sid"]].get("e") or []:
                eid = doc["enemyIds"][i]
                en_seen.setdefault(eid, doc["enemyNames"].get(eid, eid))
        if en_seen:
            row["enemies"] = [[k, v] for k, v in en_seen.items()]
        row["ser"] = SER[sid[:4]]
        if not sid.startswith("recalRune"):
            row["note"] = NOTE[loc]
        rows.append(row)
        ex = extra_of(sid, loc, srv, fut)
        xd = os.path.join(DATA, "event-extra", loc)
        os.makedirs(xd, exist_ok=True)
        xp = os.path.join(xd, f"{sid}.json")
        if ex:
            json.dump(ex, open(xp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        elif os.path.exists(xp):
            os.remove(xp)
    # 최신이 위 — 이벤트 도감 목록(events.json)과 같은 순서
    rows.sort(key=lambda r: r.get("start") or "9999", reverse=True)
    ev_docs[loc] = rows
    ep = os.path.join(DATA, f"events-crisis{suf}.json")
    json.dump({"events": rows}, open(ep, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  {os.path.basename(ep)}: 시즌 {len(rows)} (미실장 {sum(1 for r in rows if r.get('fut'))}) · 그림 "
          f"{sum(1 for r in rows if r.get('thumb'))} · {os.path.getsize(ep) // 1024}KB")

up = os.path.join(HERE, "crisis-untranslated.json")
json.dump(dict(sorted(missing.items())), open(up, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
if missing:
    print(f"  ⚠ 미번역 중국어 {len(missing)}건 — scripts/crisis-tl.json 에 채울 것 (목록: scripts/crisis-untranslated.json)")
