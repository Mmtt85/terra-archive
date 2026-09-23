#!/usr/bin/env python3
"""이벤트 도감 — 이벤트 하나를 열면 그 이벤트의 **작전·등장 적·교환 재화·오퍼·스토리**가
한자리에 모이도록, 흩어진 산출물을 이벤트 단위로 되짚어 모은다.

## 왜 (사용자 요청 2026-09-16)

"이벤트 도감도 필요할듯. 해당 이벤트에서 등장하는 적, 맵, 아이템, 신규오퍼 한번에 모아서
볼 수 있도록." — 지금은 같은 이벤트의 정보가 네 화면에 흩어져 있다: 작전은 작전 도감,
적은 적 도감, 재화는 아이템 도감, 읽을거리는 스토리. 이벤트가 끝나면 게임에서도 사라진다.

## 왜 데이터를 미리 모아 두나 (런타임 조인이 아니라)

화면에서 조인하려면 stages(1.4MB) + items(0.65MB) + operators 를 전부 받아야 한다.
실제로 쓰는 건 이벤트당 작전 20여 개·적 15종·재화 2종뿐이라, **이벤트 단위로 접어 두면**
로케일당 300KB대로 끝난다. 적 도감·작전 도감이 서로를 링크할 때 쓰는 지연 로더
(app/dex-cross.ts)와 같은 판단이다.

## 조인 키

- 작전 ↔ 이벤트: `activity_table.zoneToActivity`(구역 → 활동 id). **이름으로 맞추지 않는다**
  — app/data/stages.json 의 `ev` 는 표시용 이름 색인이라 복각판이 원본과 같은 이름을 쓴다.
- 재화 ↔ 이벤트: `activity_table.activityItems`(활동 id → 재화 목록). 아이템 id 접두사
  정규식으로 가르면 246종 중 122종만 붙는다 (2026-09-16 실측, build-items.py 주석 참조).
- 오퍼 ↔ 이벤트: `missionData` 의 `missionGroup`(=활동 id) + `rewards` 의 `char_…`.
  **이벤트 보상 오퍼(무료 배포)만** 확정으로 알 수 있다 — 동시 배너의 신규 오퍼는 명단이
  게임 데이터에 없다(정규 배너 `dynMeta` 에 char id 가 없고, 재록 배너에만 있다).
  그래서 여기서는 보상 오퍼만 싣고 배너는 싣지 않는다 (지어내지 않는다).

사용: python3 scripts/build-events.py [gamedata-dir]
⚠ **build-stages · build-items · build-story 뒤에** 돌린다 (그 산출물을 읽는다).
"""
import json, os, re, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", os.path.join(REPO, ".gamedata"))
DATA = os.path.join(REPO, "app", "data")
LOCALES = {"ko": "kr", "en": "en", "ja": "jp"}
OUT = {"ko": "events.json", "en": "events.en.json", "ja": "events.ja.json"}

load = lambda p: json.load(open(p, encoding="utf-8"))
MAT_TIER = 3        # '파밍 가능한 상위 재료' 기준 등급 (사용자 지정 2026-09-17: T4 → T3)
day = lambda ts: time.strftime("%Y-%m-%d", time.localtime(ts)) if ts else None

acts, stage_tables = {}, {}
for loc, pre in LOCALES.items():
    p = os.path.join(G, f"{pre}_activity_table.json")
    if os.path.exists(p):
        acts[loc] = load(p)
    p = os.path.join(G, f"{pre}_stage_table.json")
    if os.path.exists(p):
        stage_tables[loc] = load(p)
if "ko" not in acts:
    sys.exit("kr_activity_table.json 이 없다")
kr_act = acts["ko"]
ZONE_TO_ACT = kr_act["zoneToActivity"]
kr_basic_all = kr_act["basicInfo"]

# ── 복각(재개방) → 원본 ─────────────────────────────────────────────────────
# ⚠ **id 로 잇지 말 것.** `act(\d+)sre → act$1side` 는 요즘 것만 맞는다 — act5sre 의 원본은
#   act5d0, act9sre 는 act9d0 이라 옛 이벤트 8건이 통째로 빗나간다 (app/home.tsx 의
#   storyOf 주석에 같은 실측이 적혀 있다). 그래서 **"(재개방)"을 뗀 한국어 이름**으로 잇는다.
RERUN_SUFFIX = re.compile(r"\s*\(재개방\)\s*$")
_ko_name = {}          # 한국어 이름 → 활동 id (복각이 아닌 것만)


def _index_names(basic):
    for aid, info in basic.items():
        nm = (info.get("name") or "").strip()
        if nm and not RERUN_SUFFIX.search(nm):
            _ko_name.setdefault(nm, aid)


def origin_of(aid):
    """복각 활동 id → 원본 활동 id. 복각이 아니거나 원본을 못 찾으면 자기 자신."""
    nm = ((kr_basic_all.get(aid) or {}).get("name") or "").strip()
    if not RERUN_SUFFIX.search(nm):
        return aid
    return _ko_name.get(RERUN_SUFFIX.sub("", nm), aid)


# ── 작전 → 이벤트 ───────────────────────────────────────────────────────────
# ⚠ 복각(재개방)하면 `zoneToActivity` 가 그 구역을 **복각 활동 쪽으로 옮긴다.** 그래서
#   원본(act40side)은 작전이 0개인 빈 껍데기가 되고 복각판(act40sre)만 23개를 갖는다
#   (사용자 지적 2026-09-17: "상경환은 재개방은 데이터가 다 나오는데 원본은 아무것도 없다").
#   작전 id 는 복각판에서도 `act40side_01` 그대로다 — **같은 작전**이라는 뜻이다.
#   그래서 둘 다에 붙인다: 원본에도, 복각판에도.
kr_stages = (stage_tables["ko"].get("stages") if "ko" in stage_tables else {}) or {}
stages_of_act = {}
for sid, v in kr_stages.items():
    aid = ZONE_TO_ACT.get(v.get("zoneId"))
    if aid:
        stages_of_act.setdefault(aid, []).append(sid)

_index_names(kr_basic_all)
# 원본 → 복각 (역방향). 복각이 여럿이면 가장 최근 것.
rerun_of = {}
for _aid, _info in sorted(kr_basic_all.items(), key=lambda kv: kv[1].get("startTime") or 0):
    _org = origin_of(_aid)
    if _org != _aid:
        rerun_of[_org] = _aid
# 복각 ↔ 원본은 같은 작전을 공유한다 (위 주석)
for aid in list(stages_of_act):
    org = origin_of(aid)
    if org != aid:
        merged = list(dict.fromkeys(stages_of_act.get(org, []) + stages_of_act[aid]))
        stages_of_act[org] = merged
        stages_of_act[aid] = merged
act_of_stage = {sid: aid for aid, sids in stages_of_act.items() for sid in sids}

# ── 재화 → 이벤트 ───────────────────────────────────────────────────────────
act_of_item = {}
for aid, items in (kr_act.get("activityItems") or {}).items():
    for iid in items or []:
        act_of_item.setdefault(iid, aid)

# ── 데뷔 오퍼 → 이벤트 ──────────────────────────────────────────────────────
# 배너로 나온 신규 오퍼는 게임 데이터가 이벤트와 묶어 주지 않는다 (build-operator-debut.py
# 머리주석 참조). 대신 **그 오퍼가 한섭 목록에 처음 올라온 날**을 장부에서 읽어, 그날
# 열린(또는 그날 진행 중이던) 이벤트에 붙인다.
# 우선순위: 시작일이 데뷔일과 같은 이벤트 > 기간이 데뷔일을 품는 이벤트 중 가장 늦게 시작한 것.
# — 배너는 이벤트 개방과 함께 열리므로 앞쪽이 거의 항상 맞는다 (2026-09-16 act51side 실측:
#   우쿠시크·지마 더 레이징 타이드·보타니 셋 다 개방일에 올라왔다).
DEBUT, CN_EVENT_OPS = {}, {}
_dp = os.path.join(DATA, "operator-debut.json")
if os.path.exists(_dp):
    _d = load(_dp)
    DEBUT = _d.get("debut") or {}
    # 미래시 이벤트의 신규 오퍼는 **중섭 데뷔**라 한섭 장부에 없다 — 따로 잡아 둔 표를 쓴다
    CN_EVENT_OPS = _d.get("cnEventOps") or {}
else:
    print("⚠ operator-debut.json 이 없다 — 신규 오퍼는 보상 오퍼만 싣는다")

# ── 보상 오퍼 → 이벤트 ──────────────────────────────────────────────────────
ops_of_act = {}
for m in kr_act.get("missionData") or []:
    grp = m.get("missionGroup")
    if not grp:
        continue
    for r in (m.get("rewards") or []):
        rid = str(r.get("id") or "")
        if rid.startswith("char_"):
            ops_of_act.setdefault(grp, [])
            if rid not in ops_of_act[grp]:
                ops_of_act[grp].append(rid)

# ── 로케일별 산출물 ─────────────────────────────────────────────────────────
stories = {e["id"]: e for e in load(os.path.join(DATA, "stories.json"))["events"]}
THUMB = {"ko": "thumb", "en": "thumbEn", "ja": "thumbJa"}


# 전용 가이드가 있는 활동 종류 → 그 가이드의 경로 조각 (로케일 프리픽스는 화면이 붙인다).
# 여기 없는 종류는 이벤트 모달이 맡는다.
# ⚠ 위수 협의는 **시즌마다 페이지가 따로** 있다 (/autochess/s1, /autochess/s2). 활동 id
#   `act<N>autochess` 의 N 이 곧 시즌이므로 그대로 잇는다 — 전부 /autochess 로 보내면
#   시즌 1 이벤트를 눌러도 최신 시즌이 열린다 (사용자 지적 2026-09-17).
GUIDE_OF = {"AUTOCHESS_SEASON": "autochess"}
AC_SEASON = re.compile(r"^act(\d+)autochess$")


def guide_of(aid, typ):
    seg = GUIDE_OF.get(typ or "")
    if not seg:
        return None
    m = AC_SEASON.match(aid)
    return f"{seg}/s{m.group(1)}" if seg == "autochess" and m else seg


per_loc = {}
for loc in LOCALES:
    sp = os.path.join(DATA, "stages.json" if loc == "ko" else f"stages.{loc}.json")
    ip = os.path.join(DATA, "items.json" if loc == "ko" else f"items.{loc}.json")
    op = os.path.join(DATA, "operators.json" if loc == "ko" else f"operators.{loc}.json")
    per_loc[loc] = {
        "stages": load(sp) if os.path.exists(sp) else None,
        "items": {i["id"]: i for i in load(ip)["items"]} if os.path.exists(ip) else {},
        "ops": {o["id"]: o for o in load(op)} if os.path.exists(op) else {},
    }

# 그 서버에 아직 안 열렸고 **스토리도 없는** 이벤트의 임시 이름 (AI 번역 — 그 서버가 열면 활동표가
# 대체하므로 자연 소멸). 스토리가 있는 이벤트는 build-story.py CN_PROVISIONAL_NAMES 가 맡는다.
# 없으면 한국어가 그대로 나간다 (사용자 지적 2026-09-23 "영어판은 듀얼채널 이벤트 이름이 한글").
# 듀얼 채널 경기장 이름은 한국어가 영문판을 따른다 (그린 그래스빌 = Green Grassville, 허니듀 = Honeydew).
PROVISIONAL_NAMES = {
    "act3enemyduel": {"en": "Duel Channel: Ivyvine"},     # 듀얼 채널: 아이비바인 (일섭: アイビーヴァインシティ)
}


def _loc_name(loc, info_loc, sname, aid):
    """그 로케일 이름 — 활동표 > 스토리 목록 > 임시 이름 > 한국어 순. 활동표에 있더라도
    **한국어와 같으면** 아직 번역이 안 들어온 것이므로 스토리 목록 쪽을 본다 (실측)."""
    kr_nm = ((kr_basic_all.get(aid) or {}).get("name") or "").strip()
    nm = ((info_loc or {}).get("name") or "").strip()
    if loc != "ko" and (not nm or nm == kr_nm):
        nm = (sname.get(loc) or "").strip() or (PROVISIONAL_NAMES.get(aid) or {}).get(loc) or nm
    return (nm or kr_nm or aid).strip()


rows = {loc: [] for loc in LOCALES}
kr_basic = kr_act["basicInfo"]
# 드랍 종류 번호 — '주요 드랍' 자리. 세 로케일의 kinds 배열은 같은 순서라(실측) 번호가
# 그대로 통한다. 그래도 한국어 표기로 찾아 둔다 — 순서가 틀어지면 여기서 바로 드러난다.
_ko_kinds = ((per_loc["ko"]["stages"] or {}).get("kinds")) or []
MAIN_KIND = _ko_kinds.index("주요 드랍") if "주요 드랍" in _ko_kinds else 0

# 데뷔일 → 이벤트 id (위 우선순위 규칙). 한 번만 계산해 둔다.
# ⚠ 같은 날 **로그인 보상·체크인 활동**이 같이 열린다 (2026-07-16 「용문 복권방 로그인
#   이벤트」가 사세행과 같은 날). 그런 활동에 신규 오퍼가 붙으면 엉뚱하므로, 후보 중
#   **작전이 있는 활동**(=진짜 콘텐츠 이벤트)을 먼저 고른다.
_with_stage = set(act_of_stage.values())
_windows = sorted(((day(v.get("startTime")), day(v.get("endTime")), k)
                   for k, v in kr_basic.items() if v.get("startTime")), key=lambda x: x[0] or "")


def _best(cands):
    """작전이 있는 활동 우선, 그중 가장 늦게 시작한 것."""
    real = [k for k in cands if k in _with_stage]
    return (real or cands)[-1]


debut_of_act = {}
for cid, d in DEBUT.items():
    same = [k for st, en, k in _windows if st == d]
    if not same:
        same = [k for st, en, k in _windows if st and st <= d and (not en or d <= en)]
    if same:
        debut_of_act.setdefault(_best(same), []).append(cid)
n_stage = n_enemy = n_item = n_op = 0

for aid, info in sorted(kr_basic.items(), key=lambda kv: -(kv[1].get("startTime") or 0)):
    ko_doc = per_loc["ko"]["stages"]
    have = set(stages_of_act.get(aid) or [])
    sids = [s["id"] for s in (ko_doc["stages"] if ko_doc else []) if s["id"] in have]
    item_ids = [i for i, a in act_of_item.items() if a == aid and i in per_loc["ko"]["items"]]
    reward_ids = [o for o in ops_of_act.get(aid, []) if o in per_loc["ko"]["ops"]]
    # 보상 오퍼가 먼저, 그 다음 그 이벤트와 함께 데뷔한 배너 오퍼 (중복 제거)
    debut_ids = [o for o in debut_of_act.get(aid, [])
                 if o in per_loc["ko"]["ops"] and o not in reward_ids]
    op_ids = reward_ids + debut_ids
    # 볼 것이 하나도 없는 활동(로그인 보상·체크인 등)은 도감에 넣지 않는다.
    # ⚠ **작전도 스토리도 없는 활동**도 뺀다 — 「한정 포인트 미션」·「협동 목표」처럼 다른
    #   이벤트에 얹히는 임무 껍데기라(16개), 재화 한 줄만 달랑 든 카드가 목록을 어지럽힌다.
    if not sids and aid not in stories and origin_of(aid) not in stories:
        continue
    for loc in LOCALES:
        doc = per_loc[loc]["stages"]
        by_id = {s["id"]: s for s in (doc["stages"] if doc else [])}
        # enemyIds 는 배열(작전의 e[0] 이 가리키는 번호표), enemyNames 는 {id: 이름} 사전이다
        loc_items = per_loc[loc]["items"]
        enames = (doc.get("enemyNames") if doc else None) or {}
        eids = (doc.get("enemyIds") if doc else None) or []
        stages, seen_enemy, mats = [], {}, {}
        for sid in sids:
            s = by_id.get(sid)
            if not s:
                continue
            stages.append([sid, s["code"], s["name"]])
            for e in (s.get("e") or []):
                ix = e[0]
                if 0 <= ix < len(eids) and eids[ix] not in seen_enemy:
                    seen_enemy[eids[ix]] = enames.get(eids[ix], eids[ix])
            # 이 맵에서 파밍되는 **상위 재료**(MAT_TIER 이상) — 사용자 요청 2026-09-17.
            # 처음엔 T4 이상이었는데 근래 사이드 스토리는 맵에서 T3까지만 나오고(추가 드랍이
            # 없다) T4는 상점 교환으로 옮겨 가, 21/153 이벤트에만 붙었다 → T3으로 내렸다.
            # ⚠ 이벤트 상점(교환소)에서 재화로 바꾸는 재료는 여기 없다. 상점 품목표가
            #   클라이언트 데이터에 없기 때문이다(서버가 쥐고 있다) — 맵 드랍만 싣는다.
            # ⚠ **주요 드랍만** 싣는다 (사용자 지시 2026-09-17). 추가·특별 드랍이나 완벽
            #   작전 보상까지 세면 "여기서 파밍된다"는 뜻이 흐려진다 — 가끔 떨어지는 것들이다.
            for d in (s.get("d") or []):
                if d[2] != MAIN_KIND:
                    continue
                it = loc_items.get(d[0])
                if it and it.get("g") == "material" and (it.get("r") or 0) >= MAT_TIER:
                    mats.setdefault(d[0], set()).add(s["code"])
        loc_ops = per_loc[loc]["ops"]
        items = [[i, (loc_items.get(i) or {}).get("n", i)]
                 + ([(loc_items[i]["i"])] if (loc_items.get(i) or {}).get("i") else [])
                 for i in sorted(item_ids)]
        ops = [[o, loc_ops[o]["name"], loc_ops[o]["rarity"],
                "reward" if o in reward_ids else "new"]
               for o in op_ids if o in loc_ops]
        li = (acts.get(loc, kr_act).get("basicInfo") or {}).get(aid) or info
        st = stories.get(aid)
        # ⚠ 그 로케일 활동표에 아직 없는 이벤트는 이름이 **한국어로 떨어진다** — 글로벌·일본
        #   서버는 한섭보다 늦어서 신규 이벤트가 그렇다 (사용자 제보 2026-09-17: "영문판에
        #   사람들우리들 이벤트가 한글로 돼 있다"). 스토리 목록은 세 언어 이름을 들고 있으므로
        #   그쪽을 먼저 본다. 복각판은 자기 항목이 없어 원본 이름으로 잇는다.
        sname = ((st or stories.get(origin_of(aid)) or {}).get("name") or {})
        row = {
            "id": aid,
            "n": (_loc_name(loc, li, sname, aid)),
            "type": info.get("displayType") or info.get("type"),
            "start": day(info.get("startTime")),
            "end": day(info.get("endTime")),
        }
        # 사이트에 전용 가이드가 있는 모드(위수 협의 등)는 **그 가이드로 보낸다** —
        # 일반 이벤트 모달보다 그쪽이 훨씬 많은 걸 담고 있다 (사용자 지시 2026-09-16:
        # "위수협의는 그냥 위수협의 페이지로 넘어가버리면 됨").
        guide = guide_of(aid, info.get("type"))
        if guide:
            row["guide"] = guide
        # 복각 전용 활동(act41sre)은 **자기 스토리 항목이 없다** — 읽을거리도 썸네일도
        # 원본(act41side) 것이다. 안 그러면 카드 절반이 빈 칸이 되고 스토리 버튼도 안 뜬다
        # (사용자 지시 2026-09-17: "재개방이벤트들도 원본 이벤트 스토리 버튼을 달아줘").
        origin = origin_of(aid)
        src = st or stories.get(origin)
        if src:
            row["story"] = 1
            if not st:
                row["sid"] = origin        # 스토리 링크는 원본 id 로 건다
            thumb = src.get(THUMB[loc]) or src.get("thumb")
            if thumb:
                row["thumb"] = thumb
        # 스토리가 없는 이벤트(듀얼 채널·위수 협의·벡터 돌파 …)는 **게임 홈 화면의 테마 그림**으로 메운다
        # (사용자 요청 2026-09-23 "듀얼채널 섬네일 없어? 있을거 같은데"). scripts/build-event-art.py 가 CDN 에서
        # 받아 둔 것 — 그 서버 언어판이 있으면 그걸, 없으면 한국어판. ⚠ 지금 걸린 이벤트 것만 CDN 에 있어서
        # 지난 이벤트는 그 스크립트를 돌렸던 때 받아 둔 파일에 기댄다(지우지 않는다).
        if "thumb" not in row:
            for rel in ([f"/event/{loc}/{aid}.webp"] if loc != "ko" else []) + [f"/event/{aid}.webp"]:
                if os.path.exists(os.path.join(REPO, "public", rel.lstrip("/"))):
                    row["thumb"] = rel
                    break
        # 듀얼 채널 — 모달이 상세(모드·보상 프로그램·선수 명단 …)를 따로 받는다: app/data/event-duel*.json
        # (scripts/build-event-duel.py). 공통 틀만으로는 작전 하나·재화 하나뿐인 빈 모달이었다 (사용자 요청 2026-09-23).
        if info.get("type") == "ENEMY_DUEL":
            row["duel"] = 1
        # 원본 ↔ 복각을 서로 이어 준다 (사용자 지시 2026-09-17)
        if origin != aid and origin in kr_basic:
            row["origin"] = origin
        elif aid in rerun_of:
            row["rerun"] = rerun_of[aid]
        if stages:
            row["stages"] = stages
        if seen_enemy:
            row["enemies"] = [[k, v] for k, v in seen_enemy.items()]
        if items:
            row["items"] = items
        if mats:
            # 등급 높은 것 먼저, 같으면 이름순. 작전 코드는 사람이 읽는 순서로.
            row["mats"] = [[i, loc_items[i]["n"], loc_items[i].get("i") or "",
                            loc_items[i]["r"], sorted(mats[i])]
                           for i in sorted(mats, key=lambda x: (-(loc_items[x]["r"]), loc_items[x]["n"]))]
        if ops:
            row["ops"] = ops
        rows[loc].append(row)
        if loc == "ko":
            n_stage += len(stages); n_enemy += len(seen_enemy); n_item += len(items); n_op += len(ops)

# ── 미래시(중섭 선행) 이벤트 ────────────────────────────────────────────────
# 사용자 요청 2026-09-17 "미래시 이벤트들도 넣어줘".
# 한섭 activity_table 에는 당연히 없다. 스토리 파이프라인이 이미 중섭 선행 이벤트를
# `unreleased`+`eta` 로 싣고 있으므로(app/data/stories.json) 그걸 그대로 가져온다.
# ⚠ 작전·등장 적·재화는 **싣지 않는다** — 중섭 activity/stage 표를 받지 않기 때문이다
#   (fetch-gamedata-cdn.py: 중섭은 미래시 전용이라 14표만 받는다). 이름·개방 예정·
#   스토리 링크까지만 주고, 나머지는 한섭에 열릴 때 저절로 채워진다.
# ⚠ 화면에서는 `.fut-dim` 이 붙어 흑백이 되고, 미래시 토글이 꺼져 있으면 눌리지 않는다
#   (app/future-tip.tsx 의 위임 리스너가 클래스만 보고 알아서 막는다).
# 중섭 표 — 있으면 미래시 이벤트의 속살(작전·등장 적·교환 재화·보상 오퍼)을 채운다.
# ⚠ 전부 **중국어 원문**이다. 사이트 규칙대로 흑백(.fut-dim) + 미래시 토글 뒤에 둔다.
cn_act = cn_stage = cn_item = cn_enemy = None
try:
    cn_act = load(os.path.join(G, "cn_activity_table.json"))
    cn_stage = load(os.path.join(G, "cn_stage_table.json"))["stages"]
    cn_item = load(os.path.join(G, "cn_item_table.json"))["items"]
    cn_enemy = (load(os.path.join(G, "cn_enemy_handbook_table.json")).get("enemyData") or {})
except (OSError, KeyError):
    print("⚠ 중섭 표가 없다 — 미래시 이벤트는 이름·개방 예정만 싣는다")


def cn_icon(icon_id):
    """중섭 전용 재화 아이콘을 받아 둔다 (아이템 도감과 같은 폴더·이름)."""
    if not icon_id:
        return ""
    dest = os.path.join(REPO, "public", "items", "icon", f"{icon_id}.webp")
    if os.path.exists(dest):
        return icon_id
    try:
        import cdnassets
        from imgutil import save_webp
        for server in ("cn", "kr"):
            im = cdnassets.image_named(icon_id, server)
            if im is not None:
                import io as _io
                buf = _io.BytesIO(); im.save(buf, "PNG")
                save_webp(buf.getvalue(), dest, max_px=128, method=4, try_lossless=False)
                return icon_id
    except Exception as e:  # noqa: BLE001
        print(f"  ⚠ 미래시 아이콘 실패({icon_id}): {str(e)[:50]}")
    return ""


CN_REPO = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/cn/gamedata/%s.json"
_cn_lv_cache = os.path.join(G, "levels-cn")


def cn_repo_level(level_id):
    """중섭 CDN에 없는 레벨(이미 끝난 중섭 이벤트)은 클뜯 레포 cn 브랜치에서.
    ⚠ 중섭 CDN은 한섭과 마찬가지로 **끝난 이벤트의 레벨을 내린다** (act50side·act53side
      실측). 그런데 레포엔 남아 있어서, 미래시 이벤트의 등장 적은 이쪽이 유일한 출처다."""
    import urllib.error, urllib.request
    rel = str(level_id).lower()
    dest = os.path.join(_cn_lv_cache, rel.replace("/", "__") + ".json")
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
    os.makedirs(_cn_lv_cache, exist_ok=True)
    open(dest, "wb").write(raw)
    return json.loads(raw)


def cn_event_body(aid):
    """중섭 표에서 그 이벤트의 작전·등장 적·재화·보상 오퍼를 뽑는다."""
    if not cn_act or not cn_stage:
        return {}
    z2a = cn_act.get("zoneToActivity") or {}
    sids = [k for k, v in cn_stage.items() if z2a.get(v.get("zoneId")) == aid]
    # ⚠ 같은 작전이 난이도별로 두 벌씩 들어 있다 (`act50side_ex01` 과 `act50side_ex01#f#`,
    #   difficulty NORMAL/FOUR_STAR). 코드가 같아 목록에 TD-EX-1 이 두 번 찍힌다
    #   (2026-09-17 실측). 한섭 쪽은 build-stages 가 접미를 붙여 가르지만 여기선 미래시
    #   맛보기라 **표준판만** 싣는다.
    sids = [k for k in sids if "#" not in k]
    sids.sort(key=lambda k: (cn_stage[k].get("sortId") or 0, k))
    stages, seen = [], {}
    import cdnlevels
    for k in sids:
        v = cn_stage[k]
        stages.append([k, (v.get("code") or k), (v.get("name") or "")])
        lid = v.get("levelId")
        if not lid:
            continue
        d = cdnlevels.level(str(lid).lower(), server="cn") or cn_repo_level(lid)
        for ref in ((d or {}).get("enemyDbRefs") or []):
            rid = ref.get("id")
            if rid and rid not in seen:
                seen[rid] = ((cn_enemy or {}).get(rid) or {}).get("name") or rid
    items = []
    for iid in ((cn_act.get("activityItems") or {}).get(aid) or []):
        meta = (cn_item or {}).get(iid) or {}
        nm = (meta.get("name") or "").strip()
        if not nm:
            continue
        ic = cn_icon(meta.get("iconId") or "")
        items.append([iid, nm] + ([ic] if ic else []))
    ops = []
    for m in (cn_act.get("missionData") or []):
        if m.get("missionGroup") != aid:
            continue
        for r in (m.get("rewards") or []):
            rid = str(r.get("id") or "")
            if rid.startswith("char_") and rid not in [o[0] for o in ops]:
                ops.append([rid, rid, 0, "reward"])
    # 그 이벤트와 함께 중섭에 데뷔한 오퍼 (build-operator-debut.py --cn-events)
    for rid in CN_EVENT_OPS.get(aid, []):
        if rid not in [o[0] for o in ops]:
            ops.append([rid, rid, 0, "new"])
    out = {}
    if stages:
        out["stages"] = stages
    if seen:
        out["enemies"] = [[k, v] for k, v in seen.items()]
    if items:
        out["items"] = items
    if ops:
        out["ops"] = ops
    return out


for eid, st in stories.items():
    if not st.get("unreleased"):
        continue
    body = cn_event_body(eid)
    for loc in LOCALES:
        nm = st.get("name") or {}
        row = {
            "id": eid,
            "n": (nm.get(loc) or nm.get("ko") or eid).strip(),
            "type": "SIDESTORY",
            "start": None,
            "end": None,
            "story": 1,
            "fut": 1,
        }
        if st.get("eta"):
            row["eta"] = st["eta"]
        thumb = st.get(THUMB[loc]) or st.get("thumb")
        if thumb:
            row["thumb"] = thumb
        # 보상 오퍼 이름은 사이트 오퍼 목록(미실장 포함)에서 — 없으면 id 그대로
        loc_ops = per_loc[loc]["ops"]
        body_loc = dict(body)
        if body.get("ops"):
            body_loc["ops"] = [[o[0], (loc_ops.get(o[0]) or {}).get("name", o[0]),
                                (loc_ops.get(o[0]) or {}).get("rarity", 0), o[3]]
                               for o in body["ops"]]
        row.update(body_loc)
        rows[loc].insert(0, row)      # 아직 안 나온 것이라 맨 위
n_fut = sum(1 for r in rows["ko"] if r.get("fut"))

updated = time.strftime("%Y-%m-%d")
for loc in LOCALES:
    dest = os.path.join(DATA, OUT[loc])
    json.dump({"updated": updated, "events": rows[loc]}, open(dest, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"  {OUT[loc]}  {os.path.getsize(dest) // 1024}KB")
# 헤더가 "진행중 이벤트" 칩을 띄울지 판단하려면 **id 목록만** 있으면 된다. 본문(로케일당
# 350KB)은 지연 청크라 헤더에서 못 보므로, 가벼운 색인을 따로 낸다 (2026-09-17).
ids_path = os.path.join(DATA, "event-ids.json")
# 칩 이름도 같이 싣는다 — 워커가 주는 이름은 한국어뿐이라, 스토리 목록에 없는 이벤트(듀얼 채널 등)는
# EN·JA 헤더에 한국어로 떴다 (사용자 지적 2026-09-23). 스토리 있는 이벤트는 셸이 스토리 목록에서 찾는다.
loc_names = {loc: {r["id"]: r["n"] for r in rows[loc]} for loc in ("en", "ja")}
names = {aid: [loc_names["en"].get(aid), loc_names["ja"].get(aid)]
         for aid in sorted(r["id"] for r in rows["ko"]) if aid not in stories}
json.dump({"updated": updated, "ids": sorted(r["id"] for r in rows["ko"]), "names": names},
          open(ids_path, "w", encoding="utf-8"), ensure_ascii=False)
print(f"  event-ids.json  {os.path.getsize(ids_path) // 1024}KB")
print(f"이벤트 {len(rows['ko'])}개(미래시 {n_fut}) — 작전 {n_stage} · 등장 적 {n_enemy} · "
      f"재화 {n_item} · 오퍼 {n_op}")
