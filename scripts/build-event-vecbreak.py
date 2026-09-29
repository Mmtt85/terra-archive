#!/usr/bin/env python3
"""이벤트 도감 — 벡터 돌파(activity.VEC_BREAK_V2) 상세. app/event-vecbreak.tsx 가 이벤트 모달 안에서 지연 로드한다.

## 왜 (사용자 요청 2026-09-29)

"벡터돌파 말인데, 표시할 수 있는 데이터는 다 표시했으면 좋겠음" — 이벤트 도감의 공통 틀(작전·등장 적·교환 재화)
로는 벡터 돌파의 모드 구조가 안 보였다. 게임 데이터에는 이런 게 다 있다:
  · 커널 돌파 12층 — 층 번호·교관(보스) 층·교관 강화 설명·층 소개문
  · 총력전 A~D — 소개문·교관
  · 특별 전선 16개 — 개방 일정·주둔 인원 제한·얻는 전투 보급·묶음(상위 보급)
  · 전투 보급 16종 — 이름·효과·아이콘 (동시 장착 한도)
  · 돌파 마일스톤 65단계 — 누적 포인트 → 보상 (늦게 열리는 단계) · 작전별 마일스톤 포인트(완벽/일반/기간 한정)
  · 구역·해금 조건·일정 4구간·메달·게임 안내 그림
듀얼 채널 상세(build-event-duel.py · app/event-duel.tsx)와 같은 짝이다.

## 회차·언어

- 1·2회차(act1break·act2break)는 한섭·글로벌·일섭 공식 문구가 다 있다 — 그 서버 표를 그대로 쓴다.
- 3회차(act3break)는 중섭 선행(미래시)이라 중섭 표 + **비공식 번역**(scripts/cn-translations.json, 줄 단위도 찾는다).
  못 옮긴 원문은 scripts/vecbreak-untranslated.json 에 적는다 — 빌드 끝에 몇 건인지 알린다.
- 교관(bossData.enemyId)은 작전마다 수치만 다른 **숨김 변형**이라 보이는 본체로 접어 적 도감 창을 연다
  (scripts/enemyvariant.py — 이벤트 창의 등장 적과 같은 규칙).

## 입력

- .gamedata/{kr,en,jp,cn}_activity_table.json · _zone_table.json · _medal_table.json · _skin_table.json · _building_data.json
- app/data/items{,.en,.ja}.json (+ future-dex 의 미래시 재화) — 보상 이름·아이콘
- public/event/vec/…·medal/… — build-event-art.py 가 받은 그림. **있는 것만** 경로를 싣는다

사용: python3 scripts/build-event-vecbreak.py   → app/data/event-vecbreak{,.en,.ja}.json
⚠ build-event-art.py 뒤에 돌린다 (그림 경로를 파일 유무로 싣는다). 네트워크 불필요.
"""
import hashlib
import json
import os
import re
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cntr  # noqa: E402
import enemyvariant  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.join(REPO, ".gamedata")
DATA = os.path.join(REPO, "app", "data")
PUB = os.path.join(REPO, "public")
LOCS = {"ko": "kr", "en": "en", "ja": "jp"}
SUF = {"ko": "", "en": ".en", "ja": ".ja"}
KST = timezone(timedelta(hours=9))
HAN = re.compile(r"[一-鿿]")

load = lambda p: json.load(open(p, encoding="utf-8"))
opt = lambda p: load(p) if os.path.exists(p) else {}


def at(ts):
    return datetime.fromtimestamp(ts, KST).strftime("%Y-%m-%d %H:%M") if ts and ts > 0 else None


def clean(s):
    if not isinstance(s, str):
        return s
    s = re.sub(r"</?[@$a-zA-Z][^>]*>|</>", "", s.replace("\r\n", "\n").replace("\\n", "\n"))
    s = "\n".join(x.strip() for x in s.split("\n"))
    return re.sub(r"[ \t]+", " ", s).strip() or None


def pub(path):
    """public/ 아래에 있으면 루트 상대 경로(+내용 해시 — R2 30일 캐시라 같은 주소로 바꾸면 한 달 옛것), 없으면 None"""
    full = os.path.join(PUB, path.lstrip("/"))
    if not os.path.exists(full):
        return None
    # ⚠ 파일 이름을 인코딩한다 — 복장 초상은 `char_253_greyy_epoque#515` 처럼 `#` 이 들어가 주소의 조각으로 읽힌다
    return f"{urllib.parse.quote(path)}?v={hashlib.md5(open(full, 'rb').read()).hexdigest()[:8]}"


CN_TR = cntr.Dict({k.strip(): v for k, v in opt(os.path.join(REPO, "scripts", "cn-translations.json")).items()})
missing = {loc: {} for loc in LOCS}


# 공식 짝 — 지난 회차(한섭·글로벌·일섭에 이미 나온 회차)의 **중섭 원문 ↔ 그 서버 문구**. 3회차 메달 설명·구역 이름·
# 해금 조건·규칙 문구 상당수가 2회차 중섭 원문과 글자까지 같다 (build-future-dex.py 의 정형 문구 짝과 같은 발상).
OFFICIAL = {loc: {} for loc in LOCS}


def _pair(loc, a, b):
    a, b = clean(a), clean(b)
    if not a or not b:
        return
    OFFICIAL[loc].setdefault(a, b)
    la, lb = a.split("\n"), b.split("\n")
    if len(la) == len(lb) > 1:
        for x, y in zip(la, lb):
            if x and y:
                OFFICIAL[loc].setdefault(x, y)


def _walk_pairs(loc, a, b):
    """같은 자리의 문자열끼리 짝짓는다 (dict·list 를 나란히 내려간다)"""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in a:
            if k in b:
                _walk_pairs(loc, a[k], b[k])
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for x, y in zip(a, b):
            _walk_pairs(loc, x, y)
    elif isinstance(a, str) and isinstance(b, str) and HAN.search(a):
        _pair(loc, a, b)


def tr(cn, loc, ctx):
    """중섭 원문 → 로케일 (공식 짝 → 번역 사전, 통째로 → 줄마다 → 원문). 못 옮긴 건 통째로 적어 둔다."""
    cn = clean(cn)
    if not cn:
        return cn
    hit = lambda x: OFFICIAL[loc].get(x) or (CN_TR.get(x) or {}).get(loc)
    got = hit(cn)
    if got:
        return got
    lines = [x for x in cn.split("\n") if x]
    if len(lines) > 1:
        parts = [hit(x) for x in lines]
        if all(parts):
            return "\n".join(parts)
        if HAN.search(cn):
            missing[loc].setdefault(cn, ctx)
        return "\n".join(p or x for p, x in zip(parts, lines))
    if HAN.search(cn):
        missing[loc].setdefault(cn, ctx)
    return cn


def main():
    tables = {s: {n: opt(os.path.join(G, f"{s}_{n}.json")) for n in
                  ("activity_table", "zone_table", "medal_table", "skin_table", "building_data")}
              for s in ("kr", "en", "jp", "cn")}
    cn_book = opt(os.path.join(G, "cn_enemy_handbook_table.json")).get("enemyData") or {}
    # 공식 짝 채우기 — 지난 회차의 활동 자료·메달·구역 이름을 서버마다 중섭 판과 나란히
    cn_vec_all = ((tables["cn"]["activity_table"].get("activity") or {}).get("VEC_BREAK_V2") or {})
    cn_medals = {m["medalId"]: m for m in tables["cn"]["medal_table"].get("medalList") or []}
    cn_zones = tables["cn"]["zone_table"].get("zones") or {}
    for loc, srv in LOCS.items():
        own_vec = ((tables[srv]["activity_table"].get("activity") or {}).get("VEC_BREAK_V2") or {})
        for aid, d in own_vec.items():
            if aid in cn_vec_all:
                _walk_pairs(loc, cn_vec_all[aid], d)
        for m in tables[srv]["medal_table"].get("medalList") or []:
            if "break" in m["medalId"] and m["medalId"] in cn_medals:
                _walk_pairs(loc, cn_medals[m["medalId"]], m)
        for zid, z in (tables[srv]["zone_table"].get("zones") or {}).items():
            if "break" in zid and zid in cn_zones:
                _walk_pairs(loc, cn_zones[zid], z)
    kr_vec = ((tables["kr"]["activity_table"].get("activity") or {}).get("VEC_BREAK_V2") or {})
    out_all = {}
    for loc, srv in LOCS.items():
        items = {i["id"]: i for i in load(os.path.join(DATA, f"items{SUF[loc]}.json"))["items"]}
        for i in list(items.values()):
            for a in i.get("alt") or []:
                items.setdefault(a, i)
        fut_items = {i["id"]: i for i in (opt(os.path.join(DATA, f"future-dex{SUF[loc]}.json")).get("items") or [])}
        own = ((tables[srv]["activity_table"].get("activity") or {}).get("VEC_BREAK_V2") or {})
        cn_vec = ((tables["cn"]["activity_table"].get("activity") or {}).get("VEC_BREAK_V2") or {})
        # 회차 → (자료, 출처 서버). 한섭에 없는 회차(미래시)만 중섭에서.
        rounds = {aid: (d, srv) for aid, d in own.items()}
        for aid, d in cn_vec.items():
            if aid not in rounds and aid not in kr_vec:
                rounds[aid] = (d, "cn")
        out = {}
        for aid, (d, src) in sorted(rounds.items()):
            T = tables[src]
            fut = src == "cn"
            txt = (lambda s, ctx: tr(s, loc, f"{aid} {ctx}")) if fut else (lambda s, ctx: clean(s))
            basic = (T["activity_table"].get("basicInfo") or {}).get(aid) or {}
            const = d.get("constData") or {}
            zones_t = (T["zone_table"].get("zones") or {})
            book = cn_book

            def boss_of(b, ctx):
                if not b or not b.get("enemyId"):
                    return None
                raw = b["enemyId"]
                eid = enemyvariant.visible(raw, book) or raw
                ic = b.get("iconId")
                return {"e": eid, "n": txt(b.get("name"), f"boss {ctx}"), "d": txt(b.get("desc"), f"bossdesc {ctx}"),
                        "lv": b.get("level"), "i": pub(f"/event/vec/boss/{ic.lower()}.webp") if ic else None}

            rew = d.get("stageRewardDict") or {}

            def pts(sid):
                r = rew.get(sid) or {}
                lim = r.get("limitReward") or None
                row = [r.get("completeRewardCnt"), r.get("normalRewardCnt")]
                if lim:
                    row.append([at(lim.get("startTs")), at(lim.get("endTs")), lim.get("rewardCnt")])
                return row

            off = []
            for sid, st in sorted((d.get("offenseStageDict") or {}).items(), key=lambda kv: int(kv[1].get("level") or 0)):
                off.append({"s": sid, "lv": int(st.get("level") or 0),
                            "b": 1 if "boss" in (st.get("levelLayout") or "") else 0,
                            "t": txt(st.get("storyDesc"), f"story {sid}"), "boss": boss_of(st.get("bossData"), sid),
                            "p": pts(sid)})
            hard = []
            for sid, st in sorted((d.get("hardStageDict") or {}).items(), key=lambda kv: kv[1].get("orderType") or ""):
                hard.append({"s": sid, "o": st.get("orderType"), "t": txt(st.get("storyDesc"), f"story {sid}"),
                             "boss": boss_of(st.get("bossData"), sid), "p": pts(sid)})
            buffs = {}
            for bid, b in (d.get("battleBuffDict") or {}).items():
                ic = b.get("iconId")
                buffs[bid] = [txt(b.get("name"), f"buff {bid}"), txt(b.get("desc"), f"buffdesc {bid}"),
                              pub(f"/event/vec/buff/{ic.lower()}.webp") if ic else None]
            basic_d = d.get("defenseBasicDict") or {}
            det = d.get("defenseDetailDict") or {}
            dfn = []
            for sid, st in sorted(basic_d.items(), key=lambda kv: kv[1].get("sortId") or 0):
                x = det.get(sid) or {}
                ic = x.get("bossIconId")
                dfn.append({"s": sid, "g": st.get("groupId"), "open": at(st.get("startTs")),
                            "lim": x.get("defenseCharLimit"), "buff": x.get("buffId"),
                            "i": pub(f"/event/vec/def/{ic.lower()}.webp") if ic else None, "p": pts(sid)})
            groups = [[g.get("groupId"), g.get("orderedStageList") or []]
                      for g in sorted((d.get("defenseGroupDict") or {}).values(), key=lambda g: g.get("sortId") or 0)]
            zones = []
            for zid, z in sorted((d.get("zoneDict") or {}).items()):
                zt = zones_t.get(zid) or {}
                zones.append([zid, txt(zt.get("zoneNameSecond") or zt.get("zoneNameFirst"), f"zone {zid}"),
                              txt(z.get("stageLockHint"), f"lock {zid}")])
            sched = [[at(b.get("startTs")), at((b.get("endTs") or 0))] for b in d.get("scheduleBlockList") or []]

            # 돌파 마일스톤 — 보상 이름·그림. 복장은 사이트의 복장 초상(public/skin/portrait), 가구는 build-event-art 가 받은 것
            skins = (T["skin_table"].get("charSkins") or {})
            skins_loc = (tables[srv]["skin_table"].get("charSkins") or {})
            furns = ((T["building_data"].get("customData") or {}).get("furnitures") or {})
            furns_loc = ((tables[srv]["building_data"].get("customData") or {}).get("furnitures") or {})
            start = basic.get("startTime") or 0
            rows = []
            for ms in d.get("milestoneList") or []:
                r = ms.get("reward") or {}
                kind, rid = r.get("type"), r.get("id")
                name = icon = None
                if kind == "CHAR_SKIN":
                    sk = skins_loc.get(rid) or skins.get(rid) or {}
                    ds = sk.get("displaySkin") or {}
                    name = clean(ds.get("skinName")) if rid in skins_loc else txt(ds.get("skinName"), f"skin {rid}")
                    pid = sk.get("portraitId")
                    # 사이트의 복장 초상(build-skins) → 없으면 build-event-art 가 받은 것 (미래시 회차의 새 복장)
                    icon = (pub(f"/skin/portrait/{pid}.webp") or pub(f"/event/skin/{pid}.webp")) if pid else None
                elif kind == "FURN":
                    f = furns_loc.get(rid) or furns.get(rid) or {}
                    name = clean(f.get("name")) if rid in furns_loc else txt(f.get("name"), f"furn {rid}")
                    icon = pub(f"/event/furni/{rid}.webp")
                elif kind == "PLAYER_AVATAR":
                    icon = pub(f"/event/avatar/{rid}.webp")
                else:
                    it = items.get(rid) or fut_items.get(rid) or {}
                    name = it.get("n")
                    icon = f"/items/icon/{it['i']}.webp" if it.get("i") else None
                avail = ms.get("availTime") or 0
                rows.append([ms.get("orderId"), ms.get("tokenNum"), kind, rid, r.get("count"), name, icon,
                             at(avail) if avail > start else None])
            pt_id = const.get("milestoneItemId") or ""
            pt = items.get(pt_id) or fut_items.get(pt_id) or {}
            mile = {"name": txt(const.get("milestoneName"), "milestoneName") or pt.get("n"),
                    "item": [pt_id, pt.get("n"), f"/items/icon/{pt['i']}.webp" if pt.get("i") else None],
                    "rows": rows}

            medals = []
            mt = T["medal_table"].get("medalList") or []
            mt_loc = {m["medalId"]: m for m in (tables[srv]["medal_table"].get("medalList") or [])}
            for m in sorted((m for m in mt if m["medalId"].startswith(f"medal_activity_{aid}_")), key=lambda m: m["medalId"]):
                mid = m["medalId"]
                ml = mt_loc.get(mid) if not fut else None
                f = (lambda k: clean(ml.get(k))) if ml else (lambda k: txt(m.get(k), f"medal {mid} {k}"))
                medals.append([mid, f("medalName"), m.get("rarity"), f("getMethod"), f("description"),
                               pub(f"/event/medal/{mid.lower()}.webp")])

            gl = {"ko": "ko", "en": "en", "ja": "ja"}[loc]
            guide = [p for part in ("offense", "defense") for i in range(1, 10)
                     for p in [pub(f"/event/vec/guide/{gl}/{part}_{i}.webp")] if p]
            if not guide:
                guide = [p for part in ("offense", "defense") for i in range(1, 10)
                         for p in [pub(f"/event/vec/guide/ko/{part}_{i}.webp")] if p]

            rec = {
                "sub": txt(const.get("subTitleName"), "subTitle"), "color": const.get("themeColor"),
                "period": [at(basic.get("startTime")), at(basic.get("endTime")), at(basic.get("rewardEndTime"))],
                "zones": zones, "sched": sched,
                "rule": {"buffMax": const.get("defenseEquipBuffLimit"), "def": txt(const.get("defenseDesc"), "defenseDesc"),
                         "boss": txt(const.get("bossDescTitle"), "bossDescTitle")},
                "off": off, "hard": hard, "def": dfn, "groups": groups, "buffs": buffs,
                "mile": mile, "medals": medals, "guide": guide,
            }
            if fut:
                rec["tr"] = 1
            out[aid] = rec
        p = os.path.join(DATA, f"event-vecbreak{SUF[loc]}.json")
        json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"  {os.path.basename(p)}: " + " · ".join(
            f"{a}(돌파 {len(r['off'])}·총력 {len(r['hard'])}·특별 {len(r['def'])}·보급 {len(r['buffs'])}·"
            f"마일스톤 {len(r['mile']['rows'])}·메달 {len(r['medals'])}·안내 {len(r['guide'])})"
            for a, r in out.items()) + f" — {os.path.getsize(p)//1024}KB")
        out_all[loc] = out
    rep = {loc: dict(sorted(v.items())) for loc, v in missing.items() if v}
    json.dump(rep, open(os.path.join(REPO, "scripts", "vecbreak-untranslated.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    for loc in rep:
        print(f"  ⚠ 벡터 돌파 미번역 {loc} {len(rep[loc])}건 — scripts/cn-translations.json 에 채울 것 "
              f"(목록: scripts/vecbreak-untranslated.json)")


if __name__ == "__main__":
    main()
