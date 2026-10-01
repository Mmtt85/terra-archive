#!/usr/bin/env python3
"""이벤트 상세 더 보기 — 이벤트 창에 **일정·미션·훈장·가구·신뢰도 보너스**를 더 싣는다.

## 왜 (사용자 요청 2026-10-01)

"사이드스토리 미니스토리 기타 전부다... 이벤트 데이터 전부 다 최대한 보여줄 수 있도록 하고싶은데 가능한한 이벤트 관련
모든 정보 한번 표시해줘봐" → "미실장 이벤트들도 다 동일하게 해 줘". 이벤트 창은 작전·적·재화·상위 재료·오퍼만 보여 줬다.
활동 표엔 더 있다:

  일정      basicInfo 시작·종료·**교환소 마감**(rewardEndTime) + actThemes.timeNodes (후반부 개방 같은 단계 일정)
  미션      missionData(missionGroup = 이벤트 id) — 목표와 보상 (재화·가구·재료·오퍼 …)
  훈장      basicInfo.medalGroupId → medal_table 훈장 세트 (이름·설명·획득 조건) / 세트가 없으면 ungroupedMedalIds
  가구      미션 보상의 FURN → building_data 가구 + 그 테마(이벤트 가구 세트 이름·설명)
  신뢰도    activity[…][id].favorUpList — 이벤트 기간 신뢰도 보너스 오퍼
  스토리    그 이벤트의 스토리(전문 화 목록 [작전 코드, 구분]) — 작전 카드에서 그 화를 리더기로 바로 연다
            (사용자 요청 2026-10-01 "17-1같은경우는 스토리인데, 이것도 다 스토리 리더랑 전문보기 AI 요약 모든이벤트에").
            스토리 id 는 이벤트 행의 sid/id, 없으면 메인 사이드(actNmainss)는 작전 코드의 장 번호로 main_<N>.

⚠ 교환소 품목은 **없다** — basicInfo.templateShopId 만 있고 품목표는 서버가 쥐고 있다 (build-events.py 주석과 같다).
⚠ 듀얼 채널·벡터 돌파는 자기 상세(app/event-duel.tsx·event-vecbreak.tsx)가 훈장·일정을 이미 보여 주므로 뺀다.

## 미실장(중섭 선행) 이벤트

중섭 표에서 같은 항목을 뽑고 세 언어로 옮긴다. 옮기는 순서:
  ① 공식 짝 — 같은 id 가 한·영·일 표에도 있으면 그 문구 (한섭에 이미 나온 가구·재료·훈장 문구 …)
  ② 미션 틀 — 한섭 이벤트 미션의 중·한·영·일 짝에서 작전 코드·숫자를 자리표시로 바꾼 틀을 배워 적용
     ("通关{0}" → "{0} 클리어" / "Clear {0}" / "{0}をクリア", "以3星评价完成{0}" → "3★ 평가로 {0} 클리어" …)
  ③ scripts/cn-translations.json (비공식 번역, 줄 단위로도 찾는다)
못 옮긴 원문은 scripts/event-extra-untranslated.json 에 남는다 — cn-translation-fill 흐름으로 채운다(세 언어 0건까지).
일정은 **중국 서버 날짜**다 — 화면이 '중국 서버 일정'이라고 적는다(sched.cn).

목록 파일(events.json)을 키우지 않으려고 따로 둔다 — **이벤트마다 한 파일**(app/data/event-extra/<로케일>/<id>.json,
평균 6KB)이고 이벤트 창이 그 이벤트 것만 받는다 (app/event-extra.tsx 의 import.meta.glob). 한 파일로 묶으면 로케일당
800KB 라 창 하나 열 때 다 받게 된다.
그림(훈장 아이콘 public/event/medal/, 가구 아이콘 public/event/furni/)은 build-event-art.py --extra 가 받는다.

사용: python3 scripts/build-event-extra.py    (build-events.py 뒤 — 그 목록의 이벤트 id 를 읽는다)
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cntr  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, ".gamedata")
DATA = os.path.join(REPO, "app", "data")
LOCALES = {"ko": "kr", "en": "en", "ja": "jp"}
OP_FILE = {"ko": "operators.json", "en": "operators.en.json", "ja": "operators.ja.json"}
OUT_DIR = os.path.join(DATA, "event-extra")      # <로케일>/<이벤트 id>.json — 이벤트 하나 열 때 그것만 받는다
MISSING = os.path.join(REPO, "scripts", "event-extra-untranslated.json")
KST = timezone(timedelta(hours=9))
load = lambda p: json.load(open(p, encoding="utf-8"))
TAG = re.compile(r"<[@$][^>]*>|</>")
HAN = re.compile(r"[一-鿿]")
TOKEN = re.compile(r"[A-Z]{1,4}(?:-[A-Z]{1,3})*-\d+|\d+")   # 미션 틀의 자리표시 — 작전 코드(PA-1·PA-EX-3)·숫자


def clean(s):
    return TAG.sub("", (s or "").replace("\\n", "\n")).strip()


def when(ts):
    """KST 'YYYY-MM-DD HH:MM' — 이벤트 도감 날짜와 같은 시계 (build-events.py KST 주석)"""
    return datetime.fromtimestamp(ts, KST).strftime("%Y-%m-%d %H:%M") if ts else None


def tables(srv):
    act = load(os.path.join(G, f"{srv}_activity_table.json"))
    medal = load(os.path.join(G, f"{srv}_medal_table.json"))
    bld = load(os.path.join(G, f"{srv}_building_data.json"))["customData"]
    detail, missions = {}, {}
    for typ in (act.get("activity") or {}).values():
        for aid, d in (typ or {}).items():
            if isinstance(d, dict):
                detail.setdefault(aid, d)
    for m in act.get("missionData") or []:
        missions.setdefault(m.get("missionGroup"), []).append(m)
    return {
        "act": act, "basic": act.get("basicInfo") or {}, "detail": detail, "missions": missions,
        "medal": {m["medalId"]: m for m in medal.get("medalList") or []},
        "groups": {g["groupId"]: g for t in (medal.get("medalTypeData") or {}).values() for g in (t.get("groupData") or [])},
        "themes": bld.get("themes") or {}, "furn": bld.get("furnitures") or {},
        "items": load(os.path.join(G, f"{srv}_item_table.json"))["items"],
        "chars": load(os.path.join(G, f"{srv}_character_table.json")),
        "skins": load(os.path.join(G, f"{srv}_skin_table.json")).get("charSkins") or {},
    }


def build_event(aid, T, tx, name_of, skip):
    """이벤트 하나 → 기록. T = 그 서버 표, tx(문구, 맥락) = 옮기기, name_of(종류, id, 원문 이름) = 보상 이름.
    skip = 듀얼·벡터 돌파(훈장·일정은 자기 상세에)."""
    info = T["basic"].get(aid) or {}
    if not info:
        return None
    rec = {}
    if not skip:
        sched = {"s": when(info.get("startTime")), "e": when(info.get("endTime"))}
        if info.get("rewardEndTime") and info.get("rewardEndTime") != info.get("endTime"):
            sched["r"] = when(info["rewardEndTime"])
        nodes = [[when(n.get("ts")), tx(n.get("title"), f"node {aid}")]
                 for th in T["act"].get("actThemes") or [] if th.get("funcId") == aid
                 for n in th.get("timeNodes") or [] if n.get("title")]
        if nodes:
            sched["n"] = nodes
        if sched["s"]:
            rec["sched"] = sched

    def reward(r):
        """보상 하나 → [종류, id, 이름, 개수, 아이콘?] — 이름을 못 찾으면 None (지어내지 않는다)"""
        kind, rid, n = r.get("type"), str(r.get("id") or ""), r.get("count") or 1
        if kind == "FURN":
            f = T["furn"].get(rid) or {}
            nm = name_of("furn", rid, f.get("name"))
            return ["furn", rid, nm, n] if nm else None
        if kind == "CHAR":
            nm = name_of("char", rid, (T["chars"].get(rid) or {}).get("name"))
            return ["char", rid, nm, n] if nm else None
        if kind == "CHAR_SKIN":
            nm = name_of("skin", rid, ((T["skins"].get(rid) or {}).get("displaySkin") or {}).get("skinName"))
            return ["skin", rid, nm, n] if nm else None
        it = T["items"].get(rid) or {}
        nm = name_of("item", rid, it.get("name"))
        return ["item", rid, nm, n, it.get("iconId") or ""] if nm else None

    ms = sorted(T["missions"].get(aid) or [], key=lambda m: (m.get("sortId") or 0, m.get("id")))
    mlist = []
    for m in ms:
        desc = tx(m.get("description"), f"mission {m.get('id')}")
        if desc:
            mlist.append([desc, [x for x in (reward(r) for r in m.get("rewards") or []) if x]])
    if mlist:
        rec["missions"] = mlist
    fids = []
    for m in ms:
        for r in m.get("rewards") or []:
            if r.get("type") == "FURN" and r.get("id") not in fids and T["furn"].get(r.get("id")):
                fids.append(r["id"])
    if fids:
        th_id = next((T["furn"][f].get("themeId") for f in fids if T["furn"][f].get("themeId")), None)
        th = T["themes"].get(th_id) or {}
        rec["furn"] = {"list": [[f, name_of("furn", f, T["furn"][f].get("name")), T["furn"][f].get("rarity") or 0] for f in fids]}
        if th.get("name"):
            rec["furn"]["theme"] = [tx(th["name"], f"theme {th_id}"), tx(th.get("desc"), f"theme {th_id}")]
    if not skip:
        g = T["groups"].get(info.get("medalGroupId") or "")
        mrows = []
        for mid in (g or {}).get("medalId") or info.get("ungroupedMedalIds") or []:
            md = T["medal"].get(mid)
            if md and md.get("medalName"):
                mrows.append([mid, tx(md["medalName"], f"medal {mid}"), md.get("rarity") or "",
                              tx(md.get("getMethod"), f"medal {mid}"), tx(md.get("description"), f"medal {mid}"),
                              1 if md.get("isHidden") else 0])
        if mrows:
            rec["medals"] = {"list": mrows}
            if g and g.get("groupName"):
                rec["medals"]["set"] = [tx(g["groupName"], f"medal-set {aid}"), tx(g.get("groupDesc"), f"medal-set {aid}")]
    fav = [c for c in ((T["detail"].get(aid) or {}).get("favorUpList") or {}) if name_of("char", c, (T["chars"].get(c) or {}).get("name"))]
    if fav:
        rec["favor"] = [[c, name_of("char", c, T["chars"][c].get("name"))] for c in fav]
    return rec or None


SCRIPT_IDS = {loc: set(load(os.path.join(DATA, f"story-script-ids{'' if loc == 'ko' else '.' + loc}.json")))
              for loc in LOCALES}
SUMMARY_IDS = set(load(os.path.join(DATA, "story-summaries.json")))
SCENE_IDS = set(load(os.path.join(DATA, "story-scene-ids.json")))


def story_of(row, loc):
    """이벤트 행 → {id, eps:[[작전 코드, 구분], …](전문 화 순서 그대로 — 리더기의 화 번호), sum?, scene?} | None.
    리더기는 로케일 전문이 없으면 한국어 전문을 읽는다(app/story.tsx scriptLoc) — 화 목록도 같은 파일에서 뽑는다."""
    cands = [row.get("sid"), row["id"]]
    chap = [m.group(1) for s in row.get("stages") or [] for m in [re.match(r"^(\d+)-\d+$", s[1])] if m]
    if chap:
        cands.append("main_" + max(set(chap), key=chap.count))
    sid = next((c for c in cands if c and (c in SCRIPT_IDS["ko"] or c in SUMMARY_IDS)), None)
    if not sid:
        return None
    out = {"id": sid}
    if sid in SCRIPT_IDS["ko"]:
        path = os.path.join(REPO, "public", "story", "script",
                            *([loc] if loc != "ko" and sid in SCRIPT_IDS[loc] else []), f"{sid}.json")
        try:
            out["eps"] = [[e.get("code") or "", e.get("tag") or ""] for e in load(path)["eps"]]
        except (OSError, KeyError, ValueError):
            pass
    if sid in SUMMARY_IDS:
        out["sum"] = 1
    if sid in SCENE_IDS:
        out["scene"] = 1
    return out


rows = load(os.path.join(DATA, "events.json"))["events"]
row_by = {r["id"]: r for r in rows}
ids = [r["id"] for r in rows if not r.get("fut")]
fut_ids = [r["id"] for r in rows if r.get("fut")]
special = {r["id"] for r in rows if r.get("vb") or r.get("duel")}
TB = {loc: tables(srv) for loc, srv in LOCALES.items()}
CN = tables("cn")
CN_TR = cntr.load(os.path.join(REPO, "scripts", "cn-translations.json"))

# ── 미실장 번역 재료 ─────────────────────────────────────────────────────────
# ① 공식 짝 — 같은 id 의 중섭 문구 ↔ 그 로케일 문구
official = {loc: {} for loc in LOCALES}
# ② 미션 틀 — 자리표시 틀끼리
templates = {loc: {} for loc in LOCALES}


def _pair(loc, a, b):
    a, b = clean(a), clean(b)
    if a and b and HAN.search(a):
        official[loc].setdefault(a, b)


def _template(s):
    toks = TOKEN.findall(s)
    t = s
    for i, tk in enumerate(toks):
        t = t.replace(tk, "{%d}" % i, 1)
    return t, toks


for loc, T in TB.items():
    for mid, m in CN["medal"].items():
        o = T["medal"].get(mid)
        if o:
            for f in ("medalName", "getMethod", "description"):
                _pair(loc, m.get(f), o.get(f))
    for gid, g in CN["groups"].items():
        o = T["groups"].get(gid)
        if o:
            _pair(loc, g.get("groupName"), o.get("groupName"))
            _pair(loc, g.get("groupDesc"), o.get("groupDesc"))
    for tid, th in CN["themes"].items():
        o = T["themes"].get(tid)
        if o:
            _pair(loc, th.get("name"), o.get("name"))
            _pair(loc, th.get("desc"), o.get("desc"))
    loc_ms = {m["id"]: m for ms in T["missions"].values() for m in ms}
    for ms in CN["missions"].values():
        for m in ms:
            o = loc_ms.get(m["id"])
            if not o:
                continue
            a, b = clean(m.get("description")), clean(o.get("description"))
            _pair(loc, a, b)
            ta, toks = _template(a)
            if toks:
                tb = b
                for i, tk in enumerate(toks):
                    if tk not in tb:
                        break
                    tb = tb.replace(tk, "{%d}" % i, 1)
                else:
                    templates[loc].setdefault(ta, tb)

missing = {loc: {} for loc in LOCALES}


def make_tx(loc):
    def tx(cn, ctx):
        cn = clean(cn)
        if not cn or not HAN.search(cn):
            return cn
        got = official[loc].get(cn) or (CN_TR.get(cn) or {}).get(loc)
        if got:
            return got
        t, toks = _template(cn)
        if toks and t in templates[loc]:
            out = templates[loc][t]
            for i, tk in enumerate(toks):
                out = out.replace("{%d}" % i, tk)
            return out
        lines = [x.strip() for x in cn.split("\n") if x.strip()]
        if len(lines) > 1:
            parts = [official[loc].get(x) or (CN_TR.get(x) or {}).get(loc) for x in lines]
            if all(parts):
                return "\n".join(parts)
        missing[loc].setdefault(cn, ctx)
        return cn
    return tx


def make_name_of(loc, T, tx, fut):
    ops = {o["id"]: o["name"] for o in load(os.path.join(DATA, OP_FILE[loc]))}

    def name_of(kind, rid, cn_name):
        if not fut:
            return clean(cn_name) or None          # 한섭 이벤트 — 그 서버 표의 이름 그대로
        if kind == "char":
            return ops.get(rid) or (tx(cn_name, f"char {rid}") if cn_name else None)
        own = {"furn": (T["furn"].get(rid) or {}).get("name"),
               "item": (T["items"].get(rid) or {}).get("name"),
               "skin": ((T["skins"].get(rid) or {}).get("displaySkin") or {}).get("skinName")}.get(kind)
        return clean(own) if own else (tx(cn_name, f"{kind} {rid}") if cn_name else None)
    return name_of


for loc, T in TB.items():
    out = {}
    for aid in ids:
        rec = build_event(aid, T, lambda s, ctx: clean(s), make_name_of(loc, T, None, False), aid in special) or {}
        st = story_of(row_by[aid], loc)
        if st:
            rec["story"] = st
        if rec:
            out[aid] = rec
    tx = make_tx(loc)
    name_of = make_name_of(loc, T, tx, True)
    for aid in fut_ids:
        rec = build_event(aid, CN, tx, name_of, aid in special) or {}
        st = story_of(row_by[aid], loc)
        if st:
            rec["story"] = st
        if rec:
            if rec.get("sched"):
                rec["sched"]["cn"] = 1            # 중국 서버 날짜 — 화면이 그렇게 적는다
            out[aid] = rec
    d = os.path.join(OUT_DIR, loc)
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):                      # 사라진 이벤트 파일은 지운다
        if f.endswith(".json") and f[:-5] not in out:
            os.remove(os.path.join(d, f))
    total = 0
    for aid, rec in out.items():
        p = os.path.join(d, f"{aid}.json")
        txt = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
        total += len(txt.encode("utf-8"))
        if not os.path.exists(p) or open(p, encoding="utf-8").read() != txt:
            open(p, "w", encoding="utf-8").write(txt)
    n = lambda k: sum(1 for v in out.values() if k in v)
    print(f"  event-extra/{loc}: 이벤트 {len(out)}(미실장 {sum(1 for a in out if a in fut_ids)}) — 일정 {n('sched')} · "
          f"미션 {n('missions')} · 훈장 {n('medals')} · 가구 {n('furn')} · 신뢰도 {n('favor')} · 스토리 {n('story')} — 합 {total // 1024}KB")

json.dump(missing, open(MISSING, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for loc in LOCALES:
    if missing[loc]:
        print(f"  ⚠ 미실장 이벤트 상세 미번역 {loc} {len(missing[loc])}건 — scripts/cn-translations.json 에 채울 것 "
              f"(목록: scripts/event-extra-untranslated.json)")
