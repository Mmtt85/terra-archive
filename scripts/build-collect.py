#!/usr/bin/env python3
"""내 정보 '보유 스킨'·'훈장' 목록 창의 자료 (2026-10-22, 사용자 요청 "보유 스킨이랑 훈장 클릭하면 뭐 갖고 있는지").

Usage: python3 scripts/build-collect.py [--no-icons]

입력: .gamedata/{kr,en,jp}_skin_table.json · _medal_table.json (fetch-gamedata-cdn.py 기본 세트)
출력 (R2 서빙 — r2-sync DIRS "skins"·"medals"):
  public/skins/owned-index.json  — { 스킨id: {c: 오퍼id, p: 그림 이름(skin/full/<p>.webp), n: {ko,en,ja}, g: {ko,en,ja} 브랜드(없으면 비움)} }
                                    기본 복장(#1·#2, id 에 '@' 없음)은 뺀다 — 계정 profile.skinIds 와 같은 범위
  public/medals/index.json       — { groups: [{id, n:{…}}…(게임 순서)], medals: { 훈장id: {g, n:{…}, m:{…} 얻는 법, r: 등급} } }
  public/medals/desc.<ko|en|ja>.json — { 훈장id: 설명 } (상세 창을 열 때만)
  public/medals/icon/<id>.webp   — 훈장 아이콘 96px. 출처 fexli/ArknightsResource medal/<id>.png (게임 클라이언트 추출본,
                                    2026-10 기준 갱신 중). 이미 받은 건 건너뛴다. 못 받은 건 끝에 적는다 (화면은 아이콘 없이 이름만)
한·영·일 이름은 각 서버 표의 공식 번역, 없으면 한국어.
"""
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = f"{REPO}/.gamedata"
SERVERS = {"ko": "kr", "en": "en", "ja": "jp"}
ICON_BASE = "https://raw.githubusercontent.com/fexli/ArknightsResource/main/medal"


def load(srv, name):
    p = f"{G}/{srv}_{name}.json"
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


def by_locale(get):
    """{ko, en, ja} — 비었거나 한국어와 같으면 뺀다 (화면이 없으면 ko 로 물러선다)"""
    out = {}
    for loc in ("ko", "en", "ja"):
        v = get(loc)
        if v and (loc == "ko" or v != out.get("ko")):
            out[loc] = v
    return out


# ── 스킨 ─────────────────────────────────────────────────────────────────────
skin_tables = {loc: load(srv, "skin_table") for loc, srv in SERVERS.items()}
skins = {loc: t.get("charSkins", {}) for loc, t in skin_tables.items()}
# 브랜드(에포크·코랄코스트…)로 묶는다 — 컬렉션 이름(skinGroupName)으로 묶으면 209벌이 146묶음으로 쪼개졌다 (2026-10-22).
# 브랜드에 안 든 컬렉션(이벤트 보상 등)은 묶음 이름 없음 → 화면이 '기타'
brand_of = {loc: {g["skinGroupId"]: b.get("brandName") for b in (t.get("brandList") or {}).values() for g in b.get("groupList") or []}
            for loc, t in skin_tables.items()}
skin_out = {}
for sid in sorted(set().union(*[set(t) for t in skins.values()])):
    if "@" not in sid:
        continue
    base = next(t[sid] for t in (skins["ko"], skins["en"], skins["ja"]) if sid in t)
    ds = lambda loc, k: (skins[loc].get(sid, {}).get("displaySkin") or {}).get(k)
    skin_out[sid] = {
        "c": base.get("charId"),
        "p": base.get("portraitId") or sid,   # 파일 이름 그대로('#' 포함 — skin/full/char_x_epoque#47.webp)
        "n": by_locale(lambda loc: ds(loc, "skinName")),
        "g": by_locale(lambda loc: brand_of[loc].get(ds(loc, "skinGroupId") or "")),
        # 그 서버에 나온 스킨인가 — 미보유도 흐리게 보이는 목록이 계정 서버에 없는 스킨까지 늘어놓지 않게
        "v": [srv for loc, srv in SERVERS.items() if sid in skins[loc]],
    }
os.makedirs(f"{REPO}/public/skins", exist_ok=True)
json.dump(skin_out, open(f"{REPO}/public/skins/owned-index.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"skins/owned-index.json: {len(skin_out)}개")

# ── 훈장 ─────────────────────────────────────────────────────────────────────
medal = {loc: load(srv, "medal_table") for loc, srv in SERVERS.items()}
mlist = {loc: {m["medalId"]: m for m in (t.get("medalList") or [])} for loc, t in medal.items()}
types = medal["ko"].get("medalTypeData") or {}
groups = sorted(types.values(), key=lambda g: g.get("sortId", 0))
def sets_of(gid):
    """이벤트·원정 훈장의 세트(이벤트별 묶음, groupData) — 이벤트별 섹션 (사용자 요청 2026-10-22). 게임 표 순서 그대로"""
    sets = ((medal["ko"].get("medalTypeData") or {}).get(gid) or {}).get("groupData") or []
    loc_sets = {loc: {x["groupId"]: x for x in (((medal[loc].get("medalTypeData") or {}).get(gid) or {}).get("groupData") or [])} for loc in SERVERS}
    return [{"id": x["groupId"], "n": by_locale(lambda loc: (loc_sets[loc].get(x["groupId"]) or {}).get("groupName")), "ids": x.get("medalId") or []} for x in sets]


acts = {loc: load(srv, "activity_table").get("basicInfo", {}) for loc, srv in SERVERS.items()}


def act_name(loc, key):
    """세트 없는 이벤트 훈장의 이벤트 이름 — medal_activity_<key> → 이벤트 표(actXXX). 사이드 이벤트(10d0 → act10d5)는 같은 번호의 첫 이벤트"""
    a = acts[loc]
    for cand in (key, f"act{key}"):
        if cand in a:
            return a[cand].get("name")
    m = re.match(r"^(\d+)d\d+$", key)
    if m:
        for aid in sorted(a):
            if re.match(rf"^act{m.group(1)}d\d", aid):
                return a[aid].get("name")
    return None


def extra_sets(gid, covered):
    """게임 표 세트(groupData)에 안 든 훈장 — 기타로 두지 않고 제 이벤트·테마로 (사용자 지적 2026-10-22 "다 각각 테마가 있는 애들")"""
    rest = [mid for mid in medal_out if medal_out[mid]["g"] == gid and mid not in covered]
    by = {}
    for mid in rest:
        by.setdefault(re.sub(r"_\d+$", "", mid), []).append(mid)
    out = []
    for prefix, ids in by.items():
        key = prefix.replace("medal_activity_", "")
        first = medal_out[sorted(ids)[0]]["n"]
        rune = re.match(r"^(\d+)(rune|crisisv2)$", key)

        def nm(loc):
            if rune:   # 위기협약 시즌 — 작전명(첫 훈장 이름의 첫 낱말)
                word = (first.get(loc) or first.get("ko") or "").split(" ")[0]
                return f"{CC_NAME[loc]} · {word}" if word else CC_NAME[loc]
            return act_name(loc, key) or (first.get(loc) or first.get("ko"))
        n = by_locale(nm)
        same = next((x for x in out if x["n"].get("ko") == n.get("ko")), None)   # 같은 이벤트로 풀린 접두어끼리는 한 섹션
        if same:
            same["ids"] = sorted(same["ids"] + ids)
        else:
            out.append({"id": prefix, "n": n, "ids": sorted(ids)})
    return out


CC_NAME = {"ko": "위기협약", "en": "Contingency Contract", "ja": "危機契約"}
medal_out = {}
for mid in sorted(set().union(*[set(t) for t in mlist.values()])):
    base = next(t[mid] for t in (mlist["ko"], mlist["en"], mlist["ja"]) if mid in t)
    medal_out[mid] = {
        "g": base.get("medalType"),
        "n": by_locale(lambda loc: (mlist[loc].get(mid) or {}).get("medalName")),
        "m": by_locale(lambda loc: (mlist[loc].get(mid) or {}).get("getMethod")),
        "r": base.get("rarity"),
    }
group_out = []
for g in groups:
    item = {"id": g["medalGroupId"], "n": by_locale(lambda loc: ((medal[loc].get("medalTypeData") or {}).get(g["medalGroupId"]) or {}).get("medalName"))}
    if g["medalGroupId"] == "rogueMedal":   # 게임 이름은 '원정 훈장' — 사이트에선 '통합전략 훈장' (사용자 지시 2026-10-22)
        item["n"]["ko"] = "통합전략 훈장"
    sets = sets_of(g["medalGroupId"])
    if g["medalGroupId"] == "rogueMedal":
        # 통합전략 — 세트에 빠진 훈장(코팅판 등)은 id 의 테마 번호로 그 세트에 (medal_rogue_3_xx → medalGroupRogue03, sandbox_1 → Sandbox01)
        by_id = {x["id"]: x for x in sets}
        for mid in [m for m in medal_out if medal_out[m]["g"] == "rogueMedal" and not any(m in x["ids"] for x in sets)]:
            mm = re.match(r"^medal_(rogue|sandbox)_(\d+)_", mid)
            target = by_id.get(f"medalGroup{'Rogue' if mm and mm.group(1) == 'rogue' else 'Sandbox'}{int(mm.group(2)):02d}") if mm else None
            if target:
                target["ids"].append(mid)
    if g["medalGroupId"] == "stageMedal":
        # 에피소드 훈장은 에피소드별 (사용자 지시 2026-10-22) — 조건 스테이지(main_NN-·tough_NN-)의 가장 큰 에피소드 번호로.
        # 스테이지 조건이 없는 훈장(소생·주간 등)은 '그 밖'
        EP = {"ko": "에피소드 {n}", "en": "Episode {n}", "ja": "エピソード{n}"}
        ETC = {"ko": "그 밖", "en": "Other", "ja": "その他"}
        by_ep = {}
        for mid in [m for m in medal_out if medal_out[m]["g"] == "stageMedal"]:
            params = " ".join((mlist["ko"].get(mid) or {}).get("unlockParam") or [])
            # main_NN-·tough_NN-(하드)·hard_NN-(익스트림)·main_NN(모의 훈련 점수) 다 에피소드 번호로
            eps = [int(x) for x in re.findall(r"(?:main|tough|hard)_(\d+)(?:-|\b)", params)]
            by_ep.setdefault(max(eps) if eps else -1, []).append(mid)
        sets = [{"id": f"ep{ep}", "n": dict((ETC if ep < 0 else {k: v.format(n=ep) for k, v in EP.items()})), "ids": sorted(ids)}
                for ep, ids in sorted(by_ep.items(), key=lambda kv: (kv[0] < 0, kv[0]))]
    if g["medalGroupId"] == "activityMedal":
        sets = sets + extra_sets("activityMedal", {x for st in sets for x in st["ids"]} | {m for m in medal_out if "recalrune" in m})
    if sets:
        item["sets"] = sets
    group_out.append(item)
# 홀로그램 매트릭스(recalrune) 훈장은 따로 탭 — 게임 표에선 이벤트 훈장이지만 세트가 없어 '기타'에 섞였다 (사용자 지시 2026-10-22).
# 이벤트 훈장 바로 뒤에 둔다
RECALRUNE = {"id": "recalruneMedal", "n": {"ko": "홀로그램 매트릭스 훈장", "en": "Hologram Matrix Medals", "ja": "ホログラムマトリックス勲章"}}
for mid, m in medal_out.items():
    if "recalrune" in mid:
        m["g"] = RECALRUNE["id"]
at = next((i for i, g in enumerate(group_out) if g["id"] == "activityMedal"), len(group_out) - 1)
group_out.insert(at + 1, RECALRUNE)
os.makedirs(f"{REPO}/public/medals/icon", exist_ok=True)
json.dump({"groups": group_out, "medals": medal_out}, open(f"{REPO}/public/medals/index.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"medals/index.json: 묶음 {len(group_out)} · 훈장 {len(medal_out)}개")
# 설명은 언어별 따로 — 훈장을 누를 때만 받는다 (목록 파일에 같이 넣으니 2MB 가 됐다, 2026-10-22)
for loc in ("ko", "en", "ja"):
    desc = {mid: (mlist[loc].get(mid) or mlist["ko"].get(mid) or {}).get("description") for mid in medal_out}
    json.dump({k: v for k, v in desc.items() if v}, open(f"{REPO}/public/medals/desc.{loc}.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

if "--no-icons" in sys.argv:
    sys.exit(0)
from PIL import Image  # noqa: E402

todo = [mid for mid in medal_out if not os.path.exists(f"{REPO}/public/medals/icon/{mid}.webp")]


def fetch(mid):
    try:
        raw = urllib.request.urlopen(f"{ICON_BASE}/{urllib.parse.quote(mid)}.png", timeout=30).read()
        im = Image.open(io.BytesIO(raw)).convert("RGBA")
        im.thumbnail((96, 96), Image.LANCZOS)
        im.save(f"{REPO}/public/medals/icon/{mid}.webp", "WEBP", quality=86, method=6)
        return None
    except Exception as e:  # noqa: BLE001
        return f"{mid} ({e})"


with ThreadPoolExecutor(12) as ex:
    fails = [f for f in ex.map(fetch, todo) if f]
print(f"아이콘: 새로 {len(todo) - len(fails)}개 · 실패 {len(fails)}개")
if fails:
    print("못 받은 아이콘:", ", ".join(fails[:30]) + (" …" if len(fails) > 30 else ""))
print("→ R2 반영: node scripts/r2-sync.mjs")
