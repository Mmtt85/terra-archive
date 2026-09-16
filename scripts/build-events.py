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

RERUN = re.compile(r"^act(\d+)s?re$")


def origin_of(aid):
    """복각 전용 활동 id → 원본 활동 id (act41sre → act41side). 아니면 자기 자신."""
    m = RERUN.match(aid)
    return f"act{m.group(1)}side" if m else aid


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
DEBUT = {}
_dp = os.path.join(DATA, "operator-debut.json")
if os.path.exists(_dp):
    DEBUT = (load(_dp).get("debut") or {})
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

rows = {loc: [] for loc in LOCALES}
kr_basic = kr_act["basicInfo"]

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
            for d in (s.get("d") or []):
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
        row = {
            "id": aid,
            "n": (li.get("name") or info.get("name") or aid).strip(),
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
        # 원본 이벤트가 목록에 있으면 그리로도 이어 준다 (사용자 지시 2026-09-17)
        if origin != aid and origin in kr_basic:
            row["origin"] = origin
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
for eid, st in stories.items():
    if not st.get("unreleased"):
        continue
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
        rows[loc].insert(0, row)      # 아직 안 나온 것이라 맨 위
n_fut = sum(1 for r in rows["ko"] if r.get("fut"))

updated = time.strftime("%Y-%m-%d")
for loc in LOCALES:
    dest = os.path.join(DATA, OUT[loc])
    json.dump({"updated": updated, "events": rows[loc]}, open(dest, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"  {OUT[loc]}  {os.path.getsize(dest) // 1024}KB")
print(f"이벤트 {len(rows['ko'])}개(미래시 {n_fut}) — 작전 {n_stage} · 등장 적 {n_enemy} · "
      f"재화 {n_item} · 오퍼 {n_op}")
