#!/usr/bin/env python3
"""아이템 도감 — item_table 전량을 app/data/items{,.en,.ja}.json + 아이콘으로.

## 왜 (사용자 확정 2026-09-16)

게임 안 아이템은 **이름·설명(플레이버)·용도·획득처**를 전부 들고 있는데, 사이트에는
그걸 보여 주는 화면이 없었다. 재료파밍(드랍률 계산)·육성 비용 계산기·오퍼 상세가
각자 필요한 만큼만 아이템을 스쳐 갈 뿐이고, 셋을 합쳐도 95종뿐이었다.
이벤트 교환 재화는 이벤트가 끝나면 다시 볼 길이 아예 없다.
→ **아이템 자체를 보는 도감**을 따로 둔다 (`/items`).

수록 범위: **KR item_table 전량**(1,423종). 중섭에만 있는 133종은 넣지 않는다 —
미래시 대상이지만 이름이 중국어라 도감에 그대로 실을 수 없다.

## 분류 (itemType 기준, 게임의 창고 탭과는 다르게 사람이 읽을 단위로 묶었다)

  material  재료         — 정예화·스킬·모듈 재료, 작전기록, 칩
  event     이벤트 재화   — 이벤트마다 그 이벤트에서만 파밍하는 교환 재화
  resource  기초 자원     — 용문폐·합성옥·이성·명성·크레딧·오리지늄 계열
  voucher   교환권·모집권 — 인장, 헤드헌팅 권, 각종 티켓
  etc       소장품·기타   — 가구 소장 세트, 이모티콘, 훈장, 극본

## 획득처

`obtainApproach`(게임이 주는 한 줄) + **드랍 작전**을 같이 싣는다. 드랍은 item_table의
`stageDropList` 가 아니라 **app/data/stages.json 의 역색인**으로 만든다 — 그쪽은 이미
작전 도감이 쓰는 정본이고 드랍 종류(주요/추가/특별…)까지 들고 있다. 작전이 수백 개인
것(작전기록 227곳)은 앞쪽 몇 개만 싣고 나머지는 개수만 적는다.

아이콘은 **게임 CDN에서 직접 뜯는다**(cdnassets) — 에셋 미러는 며칠씩 밀린다.
공용 아이템은 `arts/items/icons/<iconId>`, 이벤트 재화는 `activity/commonassets/[uc]items/<iconId>`.

사용: python3 scripts/build-items.py [gamedata-dir]
"""
import io, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdnassets
from imgutil import save_webp

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", os.path.join(REPO, ".gamedata"))
ICON_DIR = os.path.join(REPO, "public", "items", "icon")
LOCALES = {"ko": "kr", "en": "en", "ja": "jp"}
OUT_NAME = {"ko": "items.json", "en": "items.en.json", "ja": "items.ja.json"}

load = lambda p: json.load(open(p, encoding="utf-8"))

tables = {}
for loc, prefix in LOCALES.items():
    path = os.path.join(G, f"{prefix}_item_table.json")
    if not os.path.exists(path):
        print(f"⚠ {prefix}_item_table.json 이 없다 — {loc} 는 한국어로 폴백한다")
        continue
    t = load(path)
    tables[loc] = t.get("items", t)
if "ko" not in tables:
    sys.exit("kr_item_table.json 이 없다 — 먼저 데이터를 받아야 한다")
kr = tables["ko"]

# ── 분류 ────────────────────────────────────────────────────────────────────
RESOURCE = {"GOLD", "DIAMOND", "DIAMOND_SHD", "EXP_PLAYER", "SOCIAL_PT", "HGG_SHD", "LGG_SHD",
            "CLASSIC_SHD", "RETURN_CREDIT", "AP_GAMEPLAY", "AP_BASE", "AP_SUPPLY", "AP_ITEM",
            "ET_STAGE", "TKT_TRY", "RL_COIN", "CARD_EXP", "SANDBOX_TOKEN"}
VOUCHER_EXTRA = {"ITEM_PACK", "RENAMING_CARD", "MATERIAL_ISSUE_VOUCHER", "MCARD_VOUCHER",
                 "CLASSIC_FES_PICK_TIER_5", "CLASSIC_FES_PICK_TIER_6"}


def group_of(it):
    t = it.get("itemType") or ""
    if t in ("ACTIVITY_ITEM", "ACTIVITY_POTENTIAL"):
        return "event"
    if t in RESOURCE:
        return "resource"
    if it.get("classifyType") == "MATERIAL" or t == "MATERIAL":
        return "material"
    if t.startswith("VOUCHER") or "TKT" in t or "COIN" in t or t in VOUCHER_EXTRA:
        return "voucher"
    return "etc"


# ── 이벤트 재화 → 그 이벤트 스토리 ──────────────────────────────────────────
# `act26side_token_fragmenta_rep_1` → act26side (복각판 접미사는 떼고 본다)
EV_KEY = re.compile(r"^(act\d+[a-z0-9]*|1stact)_")
story_ids = {e["id"] for e in load(os.path.join(REPO, "app", "data", "stories.json"))["events"]}


def event_of(item_id):
    m = EV_KEY.match(item_id)
    return m.group(1) if m and m.group(1) in story_ids else None


# ── 드랍 작전 역색인 (app/data/stages.json) ──────────────────────────────────
# occ/kinds 의 표기는 로케일별 stages 파일에 들어 있으므로 **인덱스만** 싣는다.
DROP_CAP = 24   # 작전기록류는 227곳에서 떨어진다 — 앞쪽만 싣고 나머지는 개수로
stage_docs = {}
for loc in LOCALES:
    p = os.path.join(REPO, "app", "data", "stages.json" if loc == "ko" else f"stages.{loc}.json")
    if os.path.exists(p):
        stage_docs[loc] = load(p)
drops = {}          # itemId -> [[stageId, code, occIdx, kindIdx], …]
if "ko" in stage_docs:
    for st in stage_docs["ko"]["stages"]:
        for entry in st.get("d") or []:
            drops.setdefault(entry[0], []).append([st["id"], st["code"], entry[1], entry[2]])
    # occ 인덱스는 표기 배열의 자리 순서일 뿐 확률 순이 아니다 — 한국어 표기로 순위를 매긴다.
    OCC_RANK = {"확정": 0, "거의 항상": 1, "자주": 2, "보통": 3, "가끔": 4}
    rank = {i: OCC_RANK.get(n, 9) for i, n in enumerate(stage_docs["ko"].get("occ") or [])}
    for lst in drops.values():
        lst.sort(key=lambda d: (rank.get(d[2], 9), d[1]))

# 재료파밍 도우미에 효율표가 있는 재료 — 상세에서 그쪽으로 보낸다
farm_path = os.path.join(REPO, "app", "data", "farm.json")
farm_ids = {i["id"] for i in load(farm_path)["items"]} if os.path.exists(farm_path) else set()

# ── 아이콘 ──────────────────────────────────────────────────────────────────
os.makedirs(ICON_DIR, exist_ok=True)
icon_ok, icon_have, icon_miss = 0, 0, []


def fetch_icon(icon_id):
    """CDN에서 아이콘 한 장. 이미 받아 뒀으면 건너뛴다. 성공하면 True.

    ⚠ 경로를 나열하지 않고 **파일명으로 매니페스트를 뒤진다** — iconId 는 폴더 열 군데에
    흩어져 있다(cdnassets.find_path 주석). 후보를 손으로 적으면 886장이 조용히 빠졌다
    (2026-09-16 첫 실행 실측). 한섭에 없으면 중섭 매니페스트도 본다."""
    global icon_ok, icon_have
    dest = os.path.join(ICON_DIR, f"{icon_id}.webp")
    if os.path.exists(dest):
        icon_have += 1
        return True
    for server in ("kr", "cn"):
        im = cdnassets.image_named(icon_id, server)
        if im is not None:
            buf = io.BytesIO(); im.save(buf, "PNG")
            # method=4·무손실 시도 없음 — 1,300장짜리라 기본값(method=6)이면 몇 시간 걸린다
            save_webp(buf.getvalue(), dest, max_px=128, method=4, try_lossless=False)
            icon_ok += 1
            return True
    icon_miss.append(icon_id)
    return False


# ── 조립 ────────────────────────────────────────────────────────────────────
tier = lambda r: int(str(r).replace("TIER_", "") or 1)
rows = {loc: [] for loc in LOCALES}
order = sorted(kr.values(), key=lambda i: (i.get("sortId") if isinstance(i.get("sortId"), int) else 0, i["itemId"]))

for base in order:
    iid = base["itemId"]
    grp = group_of(base)
    icon = base.get("iconId") or ""
    if icon and not fetch_icon(icon):
        icon = ""
    ev = event_of(iid) if grp == "event" else None
    dl = drops.get(iid) or []
    common = {
        "id": iid,
        "r": tier(base.get("rarity")),
        "g": grp,
        "s": base.get("sortId") if isinstance(base.get("sortId"), int) else 0,
    }
    if icon:
        common["i"] = icon
    if ev:
        common["ev"] = ev
    if iid in farm_ids:
        common["farm"] = 1
    if dl:
        common["drop"] = dl[:DROP_CAP]
        if len(dl) > DROP_CAP:
            common["dropMore"] = len(dl) - DROP_CAP
    for b in base.get("buildingProductList") or []:
        common["b"] = b.get("roomType")
        break
    for loc in LOCALES:
        src = base if loc == "ko" else (tables.get(loc, {}).get(iid) or base)
        row = dict(common)
        row["n"] = src.get("name") or base.get("name") or iid
        for key, field in (("d", "description"), ("u", "usage"), ("o", "obtainApproach")):
            v = (src.get(field) or "").strip()
            if v:
                row[key] = v
        # 로케일별 작전 코드는 같다 (코드는 번역 대상이 아니다) — drop 은 공용 그대로 둔다
        rows[loc].append(row)

updated = __import__("datetime").date.today().isoformat()
for loc in LOCALES:
    dest = os.path.join(REPO, "app", "data", OUT_NAME[loc])
    doc = stage_docs.get(loc) or stage_docs.get("ko") or {}
    json.dump({"updated": updated, "occ": doc.get("occ") or [], "kinds": doc.get("kinds") or [],
               "items": rows[loc]}, open(dest, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"  {OUT_NAME[loc]}  {os.path.getsize(dest) // 1024}KB")

import collections
gc = collections.Counter(r["g"] for r in rows["ko"])
print(f"아이템 {len(rows['ko'])}종 — " + " · ".join(f"{k} {v}" for k, v in gc.most_common()))
print(f"아이콘 새로 {icon_ok}장 · 기존 {icon_have}장"
      + (f" · 못 찾음 {len(icon_miss)} ({', '.join(sorted(set(icon_miss))[:5])}…)" if icon_miss else ""))
