#!/usr/bin/env python3
"""Build app/data/costs.json — 오퍼레이터 육성 비용(정예화·스킬·모듈) 데이터.

Usage: python3 scripts/build-costs.py <gamedata-dir>
Needs: {kr,cn}_character_table.json, {kr,cn}_uniequip_table.json,
       {kr,cn,en,jp}_item_table.json, kr_gamedata_const.json
       + 네트워크 (신규 아이템 아이콘 다운로드 시).

수록 범위 (재료파밍 탭 '육성 비용 계산기' 사용):
  - elite:     정예화 1·2 재료 + 용문폐 (gamedata_const.evolveGoldCost)
  - skills:    스킬 레벨 2~7 공용 재료 (allSkillLvlup)
  - masteries: 스킬별 특화 1~3 재료 (levelUpCostCond)
  - modules:   모듈별 1~3단계 재료 (uniequip itemCost, ORIGINAL 제외)
  용문폐(4001)는 어디에 섞여 있든 lmd 필드로 분리한다.

미실장(unreleased) 오퍼는 KR 테이블에 없으므로 CN 테이블로 폴백한다.
아이템 이름은 KR 우선(미출시 재료는 CN 이름), EN/JA는 각 로케일 item_table.
아이콘은 yuanyan3060/ArknightsGameResource의 item/<iconId>.png 를
public/items/<itemId>.png 로 내려받는다 (있으면 스킵 — build-farm.py와 동일 규칙).
"""
import json, os, re, sys, time, urllib.request

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_BASE = "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/item"

load = lambda p: json.load(open(p, encoding="utf-8"))

def chars_of(prefix):
    t = load(f"{S}/{prefix}_character_table.json")
    return t.get("chars", t)

def items_of(prefix):
    t = load(f"{S}/{prefix}_item_table.json")
    return t.get("items", t)

kr_chars = chars_of("kr"); cn_chars = chars_of("cn")
kr_uni = load(f"{S}/kr_uniequip_table.json"); cn_uni = load(f"{S}/cn_uniequip_table.json")
kr_items = items_of("kr"); cn_items = items_of("cn")
en_items = items_of("en"); jp_items = items_of("jp")
const = load(f"{S}/kr_gamedata_const.json")
EVOLVE_GOLD = const["evolveGoldCost"]  # [rarity-1][phase-1], -1 = 해당 없음
ops = load(f"{REPO}/app/data/operators.json")

def tier(r):
    return r + 1 if isinstance(r, int) else int(str(r).replace("TIER_", ""))

used_items = set()

def split_cost(cost_list):
    """게임 코스트 목록 → (lmd, [[itemId, count], …]). 용문폐(4001)는 lmd로 분리."""
    lmd = 0; items = []
    for e in cost_list or []:
        iid = e.get("id"); cnt = e.get("count", 0)
        if not iid or cnt <= 0: continue
        if iid == "4001":
            lmd += cnt
        else:
            items.append([iid, cnt]); used_items.add(iid)
    return lmd, items

result_ops = {}
for op in ops:
    cid = op["id"]
    c = kr_chars.get(cid) or cn_chars.get(cid)
    if not c: continue
    uni = kr_uni if cid in kr_chars else cn_uni
    rarity = tier(c.get("rarity"))
    entry = {}

    # 정예화 1·2
    elite = []
    for i, ph in enumerate((c.get("phases") or [])[1:], start=1):
        lmd, items = split_cost(ph.get("evolveCost"))
        gold_row = EVOLVE_GOLD[rarity - 1] if rarity - 1 < len(EVOLVE_GOLD) else []
        gold = gold_row[i - 1] if i - 1 < len(gold_row) else -1
        if gold > 0: lmd += gold
        elite.append({"lmd": lmd, "items": items})
    if elite: entry["elite"] = elite

    # 스킬 레벨 2~7 (전 스킬 공용)
    skills = []
    for lv in c.get("allSkillLvlup") or []:
        _, items = split_cost(lv.get("lvlUpCost"))
        skills.append(items)
    if skills: entry["skills"] = skills

    # 스킬별 특화 1~3
    masteries = []
    for s in c.get("skills") or []:
        sid = s.get("skillId")
        conds = s.get("levelUpCostCond") or []
        levels = []
        for cond in conds:
            _, items = split_cost(cond.get("levelUpCost"))
            levels.append(items)
        if sid and any(levels):
            masteries.append({"id": sid, "levels": levels})
    if masteries: entry["masteries"] = masteries

    # 모듈 1~3단계 (ORIGINAL 제외 — operators.json modules와 같은 필터)
    modules = []
    for eid in (uni.get("charEquip") or {}).get(cid) or []:
        eq = (uni.get("equipDict") or {}).get(eid)
        if not eq or eq.get("typeName1") == "ORIGINAL": continue
        levels = []
        for k in sorted((eq.get("itemCost") or {}).keys(), key=int):
            lmd, items = split_cost(eq["itemCost"][k])
            levels.append({"lmd": lmd, "items": items})
        if levels: modules.append({"id": eid, "levels": levels})
    if modules: entry["modules"] = modules

    if entry: result_ops[cid] = entry

# ─── 아이템 사전 + 아이콘 ─────────────────────────────────────────────────────
# 재료 상세 모달용으로 설명(description)·용도(usage)·가공소 조합식(craft)도 함께 수록한다.
kr_building = load(f"{S}/kr_building_data.json")
cn_building = load(f"{S}/cn_building_data.json")
formulas = {}  # itemId → formula (KR 우선, 미출시 재료는 CN)
for src in [cn_building, kr_building]:
    for f in (src.get("workshopFormulas") or {}).values():
        formulas[f.get("itemId")] = f

# 용문폐(4001)는 lmd로 분리되지만 모달·합계 표시는 아이템 사전을 참조하므로 항상 포함
used_items.add("4001")
# 재료 상세 모달은 효율표(farm.json)의 재료에도 뜨므로 그 목록도 사전에 합친다
try:
    farm = load(f"{REPO}/app/data/farm.json")
    for it in farm.get("items") or []:
        used_items.add(it["id"])
except FileNotFoundError:
    pass

def loc_field(iid, field):
    out = {"ko": ((kr_items.get(iid) or cn_items.get(iid) or {}).get(field))}
    en = (en_items.get(iid) or {}).get(field)
    ja = (jp_items.get(iid) or {}).get(field)
    if en: out["en"] = en
    if ja: out["ja"] = ja
    return out if out["ko"] else None

CJK = re.compile(r"[一-鿿]")
def is_unreleased_item(iid):
    # KR 미출시(중국 선행) 재료 = KR item_table에 번역이 없어 중국어 원문이 그대로 들어온 것.
    # 한국 정식 명칭은 한글 또는 라틴 코드명(RMA70-12 등)이라 한자(CJK)를 쓰지 않으므로,
    # ko 이름에 한자가 있으면 미번역=미실장으로 본다 (RMA70·D32 같은 코드명 오탐 방지).
    krn = (kr_items.get(iid) or {}).get("name")
    if not krn:
        return iid in cn_items  # KR엔 아예 없고 CN에만 있으면 미실장
    return bool(CJK.search(krn))

os.makedirs(f"{REPO}/public/items", exist_ok=True)
items_out = {}
missing_icons = []
for iid in sorted(used_items):
    kr = kr_items.get(iid); cn = cn_items.get(iid)
    base = kr or cn
    if not base:
        print("WARN: unknown item", iid, file=sys.stderr); continue
    entry = {"name": loc_field(iid, "name"), "rarity": tier(base.get("rarity")),
             "sortId": base.get("sortId", 0), "image": f"/items/{iid}.png"}
    desc = loc_field(iid, "description")
    usage = loc_field(iid, "usage")
    if desc: entry["desc"] = desc
    if usage: entry["usage"] = usage
    if is_unreleased_item(iid): entry["unreleased"] = True
    f = formulas.get(iid)
    if f:
        gold = f.get("goldCost") or 0
        craft = [[c.get("id"), c.get("count", 0)] for c in (f.get("costs") or []) if c.get("id")]
        if craft:
            entry["craft"] = craft
            if gold > 0: entry["craftGold"] = gold
            # 조합 재료도 아이템 사전에 있어야 모달에서 이름·아이콘이 나온다
            for cid2, _ in craft: used_items.add(cid2)
    items_out[iid] = entry
    dst = f"{REPO}/public/items/{iid}.png"
    if not os.path.exists(dst):
        missing_icons.append((iid, base.get("iconId") or iid))

# craft로 새로 추가된 재료(예: 조합 하위 재료가 비용에 직접 안 쓰이는 경우) 사전 보충
for iid in sorted(used_items):
    if iid in items_out: continue
    base = kr_items.get(iid) or cn_items.get(iid)
    if not base: continue
    entry = {"name": loc_field(iid, "name"), "rarity": tier(base.get("rarity")),
             "sortId": base.get("sortId", 0), "image": f"/items/{iid}.png"}
    desc = loc_field(iid, "description"); usage = loc_field(iid, "usage")
    if desc: entry["desc"] = desc
    if usage: entry["usage"] = usage
    if is_unreleased_item(iid): entry["unreleased"] = True
    items_out[iid] = entry
    dst = f"{REPO}/public/items/{iid}.png"
    if not os.path.exists(dst):
        missing_icons.append((iid, base.get("iconId") or iid))

for iid, icon in missing_icons:
    url = f"{ICON_BASE}/{urllib.parse.quote(icon)}.png"
    dst = f"{REPO}/public/items/{iid}.png"
    try:
        urllib.request.urlretrieve(url, dst)
        print("icon ok", iid, icon)
    except Exception as e:
        print("icon FAIL", iid, icon, e, file=sys.stderr)
    time.sleep(0.2)

out = {"updated": time.strftime("%Y-%m-%d"), "items": items_out, "ops": result_ops}
path = f"{REPO}/app/data/costs.json"
json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"costs.json: {len(result_ops)} ops, {len(items_out)} items, "
      f"{os.path.getsize(path)//1024}KB, new icons {len(missing_icons)}")
