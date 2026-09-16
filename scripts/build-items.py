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
import io, json, os, re, shutil, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdnassets
from imgutil import save_webp

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", os.path.join(REPO, ".gamedata"))
ICON_DIR = os.path.join(REPO, "public", "items", "icon")
ITEM_DIR = os.path.join(REPO, "public", "items")      # 재료파밍·육성 계산기가 쓰는 <itemId>.webp
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


# ── 이벤트 재화 → 그 이벤트 (이름 + 스토리 링크) ────────────────────────────
#
# 정본은 **activity_table 의 `activityItems`** 다 (활동 id → 그 활동의 재화 목록).
# 처음에는 아이템 id 접두사를 정규식으로 갈랐는데 246종 중 122종밖에 못 붙였다 —
# `act11d0_token_currency` 의 복각판이 `act5sre` 소속인 식으로 id 와 활동이 어긋난다
# (2026-09-16 실측). 정식 매핑으로 갈아 **241종**에 이벤트 이름이 붙는다.
#
# 이름과 링크는 성격이 다르다:
#   · 이름(evName) — basicInfo 에 있는 활동이면 무조건 붙는다. 사용자가 알고 싶은 것은
#     "이게 어느 이벤트 재화냐"이므로 스토리 페이지가 없어도 이름은 보여야 한다.
#   · 링크(ev)     — 사이트에 그 이벤트 스토리 페이지가 있을 때만. 미니게임·보스러시·
#     복각 전용 활동은 스토리가 없어서 129종만 걸린다.
EV_KEY = re.compile(r"^(act\d+[a-z0-9]*|1stact)_")
REP = re.compile(r"_rep_\d+$")
story_ids = {e["id"] for e in load(os.path.join(REPO, "app", "data", "stories.json"))["events"]}

act_of_item = {}        # 아이템 id → 활동 id (KR 표가 정본 — 매핑은 로케일 무관)
act_name = {loc: {} for loc in LOCALES}
for loc, prefix in LOCALES.items():
    path = os.path.join(G, f"{prefix}_activity_table.json")
    if not os.path.exists(path):
        continue
    at = load(path)
    for act, info in (at.get("basicInfo") or {}).items():
        name = (info.get("name") or "").strip()
        if name:
            act_name[loc][act] = name
    if loc == "ko":
        for act, items in (at.get("activityItems") or {}).items():
            for iid in items or []:
                act_of_item.setdefault(iid, act)


def story_of(act):
    """그 활동의 스토리 페이지 id. 없으면 None."""
    if not act:
        return None
    if act in story_ids:
        return act
    # 복각 전용 활동(act41sre = act41side 재개방)은 원본 스토리로 보낸다
    m = re.match(r"^act(\d+)s?re$", act)
    return f"act{m.group(1)}side" if m and f"act{m.group(1)}side" in story_ids else None


def event_of(item_id):
    """(활동 id, 스토리 id) — 둘 다 없을 수 있다.

    스토리 쪽은 **복각판을 원본으로 되돌려** 찾는다: `act11d0_token_currency_rep_1` 은
    활동상 `act5sre`(복각) 소속이지만 읽을거리는 원본 `act11d0` 에 있다.
    """
    act = act_of_item.get(item_id)
    base = REP.sub("", item_id)
    story = story_of(act) or story_of(act_of_item.get(base))
    if not story:
        m = EV_KEY.match(base)            # 매핑에 없는 몇 종(서류철 등)을 위한 마지막 수단
        if m and m.group(1) in story_ids:
            story = m.group(1)
    if not act:
        m = EV_KEY.match(base)
        act = m.group(1) if m else None
    return act, story


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
alias_made = 0

# ⚠ 사이트의 옛 화면들은 아이콘을 **`/items/<itemId>.webp`** 로 부른다 (재료파밍 효율표·
#   육성 비용 계산기·작전 도감의 드랍 칩). 그 폴더엔 육성 재료 95장뿐이라, 이벤트 재화가
#   떨어지는 작전을 열면 **드랍 섬네일이 깨진다** (사용자 제보 2026-09-17, 실측 86종).
#   아이템 도감은 iconId 로 저장하므로(한 아이콘을 여러 아이템이 공유한다) 이름이 다르다.
#   그래서 **작전이 실제로 떨어뜨리는 아이템**에 한해 같은 그림을 itemId 이름으로도 둔다.
_st = os.path.join(REPO, "app", "data", "stages.json")
DROPPED = ({d[0] for s_ in load(_st)["stages"] for d in (s_.get("d") or [])}
           if os.path.exists(_st) else set())


def alias_for(item_id, icon_id):
    """작전 드랍 칩이 부르는 `/items/<itemId>.webp` 가 없으면 같은 그림을 그 이름으로도 둔다."""
    global alias_made
    # ⚠ itemId == iconId 여도 건너뛰면 안 된다 — 폴더가 다르다
    #   (`items/icon/X.webp` → `items/X.webp`). 처음에 이걸 건너뛰어 35종이 남았다.
    if item_id not in DROPPED:
        return
    dest = os.path.join(ITEM_DIR, f"{item_id}.webp")
    if os.path.exists(dest):
        return
    src = os.path.join(ICON_DIR, f"{icon_id}.webp")
    if os.path.exists(src):
        shutil.copyfile(src, dest)
        alias_made += 1


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
    if icon:
        alias_for(iid, icon)
    act, ev = event_of(iid) if grp == "event" else (None, None)
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
        if act:
            # 이벤트 이름은 로케일별 activity_table 에서. 없으면 한국어로 폴백한다.
            name = act_name.get(loc, {}).get(act) or act_name["ko"].get(act)
            if name:
                row["evName"] = name
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
print(f"드랍 칩용 별칭 {alias_made}장 (/items/<itemId>.webp)")
print(f"아이콘 새로 {icon_ok}장 · 기존 {icon_have}장"
      + (f" · 못 찾음 {len(icon_miss)} ({', '.join(sorted(set(icon_miss))[:5])}…)" if icon_miss else ""))
