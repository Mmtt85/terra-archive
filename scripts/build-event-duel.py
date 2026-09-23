#!/usr/bin/env python3
"""이벤트 도감 — 듀얼 채널(activity.ENEMY_DUEL) 상세. app/event-duel.tsx 가 이벤트 모달 안에서 지연 로드한다.

## 왜 (사용자 요청 2026-09-23)

"방금 다운받은 이벤트에서 표시할 수 있는 모든 데이터를 다 가독성좋게 최대한 보여줬으면" — 듀얼 채널은
작전이 VS-1 하나뿐이고 등장 적이 **고정돼 있지 않다**(라운드마다 풀에서 양쪽 팀을 뽑는다). 그래서 이벤트
도감의 공통 틀(작전·등장 적·교환 재화)로는 거의 빈 모달이었다. 게임 데이터에는 이런 게 다 있다:
모드 3종(혼자 즐기기·선물 대결·예측 대결)·보상 프로그램 50단계·선수 명단(원본 적 + 듀얼 전용 이름·수치)·
라운드 구성·순위 추가 보상·일일 활약·진행 단계 공지·팁·관객 NPC·정산 코멘트·메달.

## 선수 명단 — 가장 손이 많이 가는 곳

- 명단 = poolData(대진 풀 가중치). enemyData 는 **지난 회차 선수까지** 들고 있어서(3회차 110종 중 29종은
  이번 풀에 없다) 명단으로 쓰면 안 나오는 선수가 섞인다.
- 듀얼 선수는 전용 id(enemy_5028_dqlime_2)다. **적 도감에 없다**(도감 비노출). 이름·수치는 게임 CDN 의
  enemy_database 에 있다 — 이름이 원본과 다른 게 대부분이다(3회차 84종 중 71종: '훌쩍벌레' = 산성 원석충 α),
  수치도 신규 선수는 대개 조정돼 있다(쉐이 형상 HP 55,000 → 130,000).
- 이름은 서버마다 다르다 → 일·글섭 DB 를 따로 본다. 그 서버에 아직 없는 회차면 원본 적의 그 언어 이름으로
  대신한다(한국어 별명을 영어 화면에 내보내지 않는다). 수치는 서버 공통이라 한섭 것을 쓴다.
- 풀에는 있는데 DB 에 없는 선수가 있다(3회차 2종 — 공지 "9/29 새로운 선수가 듀얼에 합류!"). 지어내지 않고
  수만 센다(unk). 모든 풀 가중치가 0 인 선수는 idle 로 표시한다(지금은 대진에 안 뽑힌다).

## 입력

- .gamedata/{kr,jp,en}_activity_table.json — 그 서버에 회차가 없으면 한국어 블록으로 폴백(fb=1)
- .gamedata/{kr,jp,en}_medal_table.json · _building_data.json — 메달·가구 (fetch-gamedata-cdn.py 기본 세트)
- 게임 CDN enemy_database (cdnlevels, 서버별) · app/data/enemies{,.en,.ja}.json(원본 이름·수치)
- app/data/items{,.en,.ja}.json — 보상 이름·아이콘
- public/event/… — build-event-art.py 가 받은 그림. **있는 것만** 경로를 싣는다

사용: python3 scripts/build-event-duel.py   → app/data/event-duel{,.en,.ja}.json
⚠ build-event-art.py 뒤에 돌린다. 네트워크(CDN enemy_database) 필요 — 로컬 전용(kr-big-patch §3).
"""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdnlevels  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.join(REPO, ".gamedata")
DATA = os.path.join(REPO, "app", "data")
PUB = os.path.join(REPO, "public")
LOCS = {"ko": "kr", "en": "en", "ja": "jp"}
SUF = {"ko": "", "en": ".en", "ja": ".ja"}
KST = timezone(timedelta(hours=9))

# 대진 풀 — 게임 이름을 짧은 키로. 화면 이름은 app/event-duel.tsx 의 POOL_LABEL(i18n)이 단다.
POOL_KEY = {"poolNormal": "normal", "poolGiantBoss": "giant", "poolAntiGiantBoss": "antigiant",
            "poolBoss": "boss", "poolNoSurpriseEnemy": "nosurprise", "poolSmallEnemy": "small",
            "poolMusic": "music"}
# 모드 묶음 — 매칭·단체방은 같은 모드의 입장 방식이라 카드 하나로 합친다 (라운드·규칙이 같다, 아래에서 검사)
GROUP_ORDER = ["solo", "gift", "stand"]
STAT_KEYS = ("hp", "atk", "def", "res")

load = lambda p: json.load(open(p, encoding="utf-8"))


def at(ts):
    return datetime.fromtimestamp(ts, KST).strftime("%Y-%m-%d %H:%M") if ts and ts > 0 else None


def clean(s):
    """리치 텍스트 태그(<color=…>·<@…>)를 벗긴다 — build-enemies.py 와 같은 규칙."""
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


def pub(path):
    """public/ 아래에 있으면 루트 상대 경로(+내용 해시), 없으면 None (그림이 없는 지난 회차).
    ⚠ R2 그림은 **30일 캐시**(r2-sync.mjs: max-age=2592000)라 같은 주소로 그림을 바꾸면 한 달 동안 옛것이 뜬다
      — 안내 그림을 정사각형 → 16:9 로 되돌렸을 때 실제로 그랬다 (2026-09-23). 내용 해시를 붙여 주소를 바꾼다."""
    full = os.path.join(PUB, path.lstrip("/"))
    if not os.path.exists(full):
        return None
    return f"{path}?v={hashlib.md5(open(full, 'rb').read()).hexdigest()[:8]}"


def enemy_db(server):
    raw = cdnlevels.level("levels/enemydata/enemy_database", server=server, schema="enemy_database")
    if isinstance(raw, list):
        return {e["Key"]: e["Value"] for e in raw if isinstance(e, dict) and "Key" in e}
    return raw if isinstance(raw, dict) else {}


def group_of(m):
    if not m.get("isMultiPlayer"):
        return "solo"
    return "gift" if m.get("modeType") == "OPERATION" else "stand"


def main():
    acts = {srv: load(os.path.join(G, f"{srv}_activity_table.json")) for srv in set(LOCS.values())}
    medals = {}
    furns = {}
    for srv in set(LOCS.values()):
        p = os.path.join(G, f"{srv}_medal_table.json")
        medals[srv] = {m["medalId"]: m for m in load(p).get("medalList", [])} if os.path.exists(p) else {}
        p = os.path.join(G, f"{srv}_building_data.json")
        furns[srv] = (load(p).get("customData") or {}).get("furnitures", {}) if os.path.exists(p) else {}
    kr = acts["kr"]
    kr_duel = kr["activity"].get("ENEMY_DUEL") or {}
    if not kr_duel:
        sys.exit("kr activity_table 에 ENEMY_DUEL 이 없다")

    dbs = {srv: enemy_db(srv) for srv in ("kr", "jp", "en")}
    if not dbs["kr"]:
        sys.exit("CDN enemy_database(kr)를 못 받았다 — UnityPy·flatc 확인")
    print("enemy_database: " + " · ".join(f"{s} {len(d)}종" for s, d in dbs.items()))

    # 회차 순서(시작 시각) — '신규 선수'는 앞 회차들의 풀에 없던 선수다
    order = sorted(kr_duel, key=lambda a: kr["basicInfo"].get(a, {}).get("startTime") or 0)

    for loc, srv in LOCS.items():
        items = {i["id"]: i for i in load(os.path.join(DATA, f"items{SUF[loc]}.json"))["items"]}
        dex = {e["id"]: e for e in load(os.path.join(DATA, f"enemies{SUF[loc]}.json"))}
        kr_dex = {e["id"]: e for e in load(os.path.join(DATA, "enemies.json"))} if loc != "ko" else dex
        loc_duel = acts[srv]["activity"].get("ENEMY_DUEL") or {}
        out = {}
        for idx, aid in enumerate(order):
            fb = aid not in loc_duel
            d = kr_duel[aid] if fb else loc_duel[aid]
            kd = kr_duel[aid]             # 수치·구조는 한섭 것 (서버 공통)
            info = kr["basicInfo"].get(aid) or {}
            const = d.get("constData") or {}
            modes = d.get("modeData") or {}

            # ── 모드 ──────────────────────────────────────────────────────
            groups = {}
            for m in sorted(modes.values(), key=lambda m: (m.get("pageId") or 0, m.get("innerSortId") or 0)):
                groups.setdefault(group_of(m), []).append(m)
            mode_out, rounds_out = [], {}
            for g in GROUP_ORDER:
                ms = groups.get(g)
                if not ms:
                    continue
                rep = next((m for m in ms if not m.get("isRoom")), ms[0])
                pre = modes.get(rep.get("preposedMode") or "")
                pic = rep.get("entryPicId")
                row = {
                    "key": g, "type": rep.get("modeType"),
                    "name": clean(rep.get("modeShortName") or rep.get("modeName")),
                    "en": clean(rep.get("modeEnName")),
                    "target": clean(rep.get("modeTarget")), "desc": clean(rep.get("modeDesc")),
                    "max": rep.get("maxPlayer"),
                    "match": 1 if any(m.get("isMultiPlayer") and not m.get("isRoom") for m in ms) else 0,
                    "room": 1 if any(m.get("isRoom") for m in ms) else 0,
                    "ch": clean(rep.get("modeAvatarName")), "sub": clean(rep.get("modeAvatarText")),
                }
                if pic:
                    p = pub(f"/event/duel/{aid}/{pic.lower()}.webp")
                    if p:
                        row["pic"] = p
                if pre and const.get("modeCondLockText"):
                    row["cond"] = clean(const["modeCondLockText"].replace("{0}", clean(pre.get("modeShortName") or pre.get("modeName")) or ""))
                kc = kr_duel[aid].get("constData") or {}
                if g == "stand":
                    row.update(rounds=kc.get("modeStandRoundNumber"), sel=kc.get("modeStandSelectTime"),
                               last=kc.get("modeStandSelectTimeLast"), shield=kc.get("modeStandShieldTurn"))
                else:
                    row.update(rounds=kc.get("modeOperationRoundNumber"), init=kc.get("modeOperationInitialScore"),
                               sel=kc.get("modeSoloOperationSelectTime") if g == "solo" else kc.get("modeOperationSelectTime"))
                    if g == "gift":
                        row["last"] = kc.get("modeOperationSelectTimeLast")
                es = (kd.get("extraScoreData") or {}).get(rep.get("modeId")) or {}
                if es.get("data"):
                    row["rank"] = [[x.get("rankMin"), x.get("rankMax"), x.get("tokenNum")] for x in es["data"]]
                mode_out.append(row)
                # 라운드 — 대표 모드 것. 같은 묶음의 다른 모드(단체방)가 다르면 알린다(지금까지 같았다)
                def rows_of(mid):
                    rs = sorted((r for r in (kd.get("roundData") or {}).values() if r.get("modeId") == mid),
                                key=lambda r: r.get("round") or 0)
                    return [[r.get("round"), r.get("enemySideMinLeft"), r.get("enemySideMaxLeft"),
                             r.get("enemySideMinRight"), r.get("enemySideMaxRight"),
                             POOL_KEY.get(r.get("enemyPoolLeft"), r.get("enemyPoolLeft")),
                             POOL_KEY.get(r.get("enemyPoolRight"), r.get("enemyPoolRight")),
                             1 if r.get("canSkip") else 0, 1 if r.get("canAllIn") else 0,
                             r.get("guessTime") or 0] for r in rs]
                rr = rows_of(rep.get("modeId"))
                for m in ms:
                    if m is not rep and rows_of(m.get("modeId")) != rr and loc == "ko":
                        print(f"  ⚠ {aid}: {m.get('modeId')} 라운드가 {rep.get('modeId')} 와 다르다 — 대표 것만 싣는다")
                if rr:
                    rounds_out[g] = rr
            mode_of = {m.get("modeId"): group_of(m) for m in modes.values()}

            # ── 보상 프로그램 ────────────────────────────────────────────
            start = info.get("startTime") or 0
            furn_loc = furns.get(srv) or {}
            mile_rows, furn_info = [], {}
            for ms in kd.get("milestoneList") or []:
                r = ms.get("reward") or {}
                kind, rid = r.get("type"), r.get("id")
                name = icon = None
                if kind == "FURN":
                    f = furn_loc.get(rid) or furns["kr"].get(rid) or {}
                    name = clean(f.get("name"))
                    icon = pub(f"/event/furni/{rid}.webp")
                    furn_info[rid] = [name, clean(f.get("description")), f.get("comfort")]
                elif kind == "PLAYER_AVATAR":
                    icon = pub(f"/event/avatar/{rid}.webp")      # 이름은 표에 없다 — 화면이 '프로필'로 단다
                else:
                    it = items.get(rid) or {}
                    name = it.get("n")
                    icon = f"/items/icon/{it['i']}.webp" if it.get("i") else None
                avail = ms.get("availTime") or 0
                mile_rows.append([ms.get("orderId"), ms.get("tokenNum"), kind, rid, r.get("count"), name, icon,
                                  at(avail) if avail > start else None])
            pt = items.get(const.get("milestoneItemId") or kd.get("constData", {}).get("milestoneItemId") or "") or {}
            mile = {
                "name": clean(const.get("milestonePlanName")),
                "item": [clean(const.get("milestoneName")) or pt.get("n"),
                         f"/items/icon/{pt['i']}.webp" if pt.get("i") else None],
                "hl": clean(const.get("milestoneItemName")), "hlText": clean(const.get("milestoneItemText")),
                "rows": mile_rows,
            }
            if furn_info:
                mile["furn"] = furn_info

            # ── 선수 명단 ────────────────────────────────────────────────
            used = set()
            for rs in rounds_out.values():
                for r in rs:
                    used.update((r[5], r[6]))
            prev = set()
            for pa in order[:idx]:
                prev |= set((kr_duel[pa].get("poolData") or {}).keys())
            roster, unk = [], 0
            kdb, ldb = dbs["kr"], dbs.get(srv) or {}
            for eid, pool in (kd.get("poolData") or {}).items():
                recs = kdb.get(eid)
                if not recs:
                    unk += 1
                    continue
                ed = recs[0].get("enemyData") or {}
                a = ed.get("attributes") or {}
                orig = ((kd.get("enemyData") or {}).get(eid) or {}).get("originalEnemyId")
                tag = ((kd.get("enemyData") or {}).get(eid) or {}).get("tagType")
                lrec = (ldb.get(eid) or [{}])[0].get("enemyData") or {}
                name = clean(mv(lrec.get("name"))) if loc != "ko" else clean(mv(ed.get("name")))
                oname = (dex.get(orig) or {}).get("name") if orig else None
                if not name:
                    name = oname or clean(mv(ed.get("name"))) or eid
                e = {"id": eid, "n": name}
                if orig:
                    e["o"] = orig
                    if oname and oname != name:
                        e["on"] = oname
                e.update({
                    "hp": num(mv(a.get("maxHp"), 0)), "atk": num(mv(a.get("atk"), 0)),
                    "def": num(mv(a.get("def"), 0)), "res": num(mv(a.get("magicResistance"), 0)),
                    "aspd": num(mv(a.get("attackSpeed"), 100)), "ms": num(mv(a.get("moveSpeed"), 1)),
                    "w": num(mv(a.get("massLevel"), 1)), "lp": num(mv(ed.get("lifePointReduce"), 1)),
                })
                base = ((kr_dex.get(orig) or {}).get("lv") or [None])[0] if orig else None
                if base:
                    diff = [k for k in STAT_KEYS if float(base.get(k) or 0) != float(e[k] or 0)]
                    if diff:
                        e["d"] = diff
                pools = [POOL_KEY.get(k, k) for k, v in pool.items() if k != "enemyId" and v]
                e["p"] = [p for p in pools if p in used]
                if not any(v for k, v in pool.items() if k != "enemyId"):
                    e["idle"] = 1
                if prev and eid not in prev:
                    e["new"] = 1
                if tag == "tag_multi":
                    e["multi"] = 1
                roster.append(e)

            # ── 그 밖 ────────────────────────────────────────────────────
            npc = [[pub(f"/event/duel/{aid}/npc/{n.get('avatarId')}.webp"), clean(n.get("name")) or "",
                    n.get("specialStrategy") if n.get("specialStrategy") not in (None, "DEFAULT") else None]
                   for n in (d.get("npcData") or {}).values()]
            tips = [[clean(x.get("txt")), sorted({mode_of.get(m) for m in (x.get("modeIds") or []) if mode_of.get(m)},
                                                   key=GROUP_ORDER.index)]
                    for x in d.get("tipsData") or [] if clean(x.get("txt"))]
            comments = []
            for typ, cs in (d.get("commentData") or {}).items():
                for c in sorted(cs.values(), key=lambda c: c.get("priority") or 0):
                    if clean(c.get("commentText")):
                        comments.append([typ, clean(c["commentText"])])
            med = []
            for mid in info.get("ungroupedMedalIds") or []:
                m = medals.get(srv, {}).get(mid) or medals["kr"].get(mid)
                if m:
                    med.append([mid, clean(m.get("medalName")), m.get("rarity"), clean(m.get("getMethod")),
                                clean(m.get("description")), pub(f"/event/medal/{mid}.webp")])
            gl = {"ko": "ko", "en": "en", "ja": "ja"}[loc]
            guide = [p for p in (pub(f"/event/duel/guide/{gl}/entry_{i}.webp") for i in range(1, 10)) if p]
            if not guide:
                guide = [p for p in (pub(f"/event/duel/guide/ko/entry_{i}.webp") for i in range(1, 10)) if p]

            ev = {
                "until": at(info.get("rewardEndTime")),
                "info": {k: clean(const.get(v)) for k, v in
                         (("bgm", "entryMusicName"), ("arena", "entryTabText"), ("match", "matchTabText")) if clean(const.get(v))},
                "phases": [[at(x.get("startTs")), at(x.get("endTs")), clean(x.get("announceText")),
                            1 if x.get("showNew") else 0] for x in d.get("announceData") or []],
                "modes": mode_out, "rounds": rounds_out,
                "daily": {"name": clean(const.get("dailyMissionName")), "desc": clean(const.get("dailyMissionDesc"))},
                "mile": mile, "roster": roster, "npc": npc, "tips": tips, "comments": comments, "medals": med,
                "guide": guide,
            }
            if unk:
                ev["unk"] = unk
            if fb:
                ev["fb"] = 1
            out[aid] = ev
            if loc == "ko":
                print(f"  {aid}: 모드 {len(mode_out)} · 보상 {len(mile_rows)}단계 · 선수 {len(roster)}"
                      f"(신규 {sum(1 for e in roster if e.get('new'))}, 미수록 {unk}) · NPC {len(npc)} · 팁 {len(tips)}"
                      f" · 메달 {len(med)} · 안내 {len(guide)}장")
        path = os.path.join(DATA, f"event-duel{SUF[loc]}.json")
        json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"→ {os.path.relpath(path, REPO)} ({os.path.getsize(path) // 1024} KB)"
              + (f" · 한국어 폴백 {sum(1 for v in out.values() if v.get('fb'))}회차" if loc != "ko" else ""))


if __name__ == "__main__":
    main()
