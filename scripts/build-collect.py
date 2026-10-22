#!/usr/bin/env python3
"""내 정보 '보유 스킨'·'훈장' 목록 창의 자료 (2026-10-22, 사용자 요청 "보유 스킨이랑 훈장 클릭하면 뭐 갖고 있는지").

Usage: python3 scripts/build-collect.py [--no-icons]

입력: .gamedata/{kr,en,jp}_skin_table.json · _medal_table.json (fetch-gamedata-cdn.py 기본 세트)
출력 (R2 서빙 — r2-sync DIRS "skins"·"medals"):
  public/skins/owned-index.json  — { 스킨id: {c: 오퍼id, p: 그림 이름(skin/full/<p>.webp), n: {ko,en,ja}, g: {ko,en,ja} 브랜드(없으면 비움)} }
                                    기본 복장(#1·#2, id 에 '@' 없음)은 뺀다 — 계정 profile.skinIds 와 같은 범위
  public/medals/index.json       — { groups: [{id, n:{…}}…(게임 순서)], medals: { 훈장id: {g, n:{…}, m:{…} 얻는 법, r: 등급} } }
  public/medals/icon/<id>.webp   — 훈장 아이콘 96px. 출처 fexli/ArknightsResource medal/<id>.png (게임 클라이언트 추출본,
                                    2026-10 기준 갱신 중). 이미 받은 건 건너뛴다. 못 받은 건 끝에 적는다 (화면은 아이콘 없이 이름만)
한·영·일 이름은 각 서버 표의 공식 번역, 없으면 한국어.
"""
import io
import json
import os
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
group_out = [{"id": g["medalGroupId"], "n": by_locale(lambda loc: ((medal[loc].get("medalTypeData") or {}).get(g["medalGroupId"]) or {}).get("medalName"))}
             for g in groups]
medal_out = {}
for mid in sorted(set().union(*[set(t) for t in mlist.values()])):
    base = next(t[mid] for t in (mlist["ko"], mlist["en"], mlist["ja"]) if mid in t)
    medal_out[mid] = {
        "g": base.get("medalType"),
        "n": by_locale(lambda loc: (mlist[loc].get(mid) or {}).get("medalName")),
        "m": by_locale(lambda loc: (mlist[loc].get(mid) or {}).get("getMethod")),
        "r": base.get("rarity"),
    }
os.makedirs(f"{REPO}/public/medals/icon", exist_ok=True)
json.dump({"groups": group_out, "medals": medal_out}, open(f"{REPO}/public/medals/index.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"medals/index.json: 묶음 {len(group_out)} · 훈장 {len(medal_out)}개")

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
