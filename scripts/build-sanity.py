# 재료·자원의 이성(AP) 환산 단가 생성 — app/data/sanity.json
#
# Usage:
#   python3 scripts/build-sanity.py
#
# 육성 추천(planner-invest.ts)의 "예상 회수 N일"이 쓰는 정본 단가다. 화면에 근거를
# 그대로 밝히므로(사용자 지시 2026-08-05: "무슨 근거로 나왔는지 정확하게 적어주기만
# 하면 됨") 추정이 아니라 데이터에서 나온 값만 싣고, 못 구한 항목은 0으로 남겨
# "환산 제외"로 표시되게 한다.
#
# 환산 사슬:
#   ① 파밍 가능 재료 — app/data/farm.json 의 최저 이성 스테이지 (펭귄 물류 실측 드랍률)
#   ② 칩·칩셋 — 주간 PR-A~D (1개 확정 드랍, stage_table의 apCost)
#   ③ 제작 전용 재료 — building_data의 가공소·제조소 레시피를 재귀 분해해
#      하위 재료 이성 + 용문폐 이성. 부산물 확률(extraOutcomeRate)만큼 산출을 늘려 나눈다
#   ④ 용문폐·작전기록 — 전용 파밍처의 고정 드랍 (CE-6 / LS-6)
import json, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.join(REPO, ".gamedata")

def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

bd = load(f"{G}/kr_building_data.json")
itbl = load(f"{G}/kr_item_table.json")
stages = load(f"{G}/kr_stage_table.json")["stages"]
farm = {i["id"]: i for i in load(f"{REPO}/app/data/farm.json")["items"]}
NAMES = {k: (v.get("name") or k) for k, v in itbl["items"].items()}
EXP_ITEMS = {k: v["gainExp"] for k, v in itbl.get("expItems", {}).items()}

# ── ④ 자원 파밍처 (고정 드랍) ────────────────────────────────────────────────
# 수량은 게임 내 고정 보상이지만 stage_table엔 종류만 있고 개수가 없어 여기 명시한다.
# 이성은 stage_table의 apCost에서 읽어 실제 데이터와 어긋나지 않게 한다.
def ap_of(code):
    for sid, s in stages.items():
        if s.get("code") == code and "tough" not in sid:
            return s.get("apCost")
    return None

LMD_STAGE, LMD_DROP = "CE-6", 10000   # 용문폐 스테이지 만렙 (고정)
EXP_STAGE, EXP_DROP = "LS-6", 7500    # 작전기록 스테이지 만렙 (고급3+중급1.5 상당)
LMD_AP, EXP_AP = ap_of(LMD_STAGE), ap_of(EXP_STAGE)
if not LMD_AP or not EXP_AP:
    sys.exit(f"파밍 스테이지를 찾지 못함: {LMD_STAGE}={LMD_AP} {EXP_STAGE}={EXP_AP}")
GOLD_LMD = 500                        # 순금 1개 → 용문폐 (무역소 용문 상법 주문)
LMD_PER_AP = LMD_DROP / LMD_AP
EXP_PER_AP = EXP_DROP / EXP_AP

# ── ② 칩·칩셋 — 주간 PR 스테이지 (표시 보상 첫 항목이 그 직군 칩, 1개 확정) ──
chip_ap = {}
for sid, s in stages.items():
    code = s.get("code") or ""
    if not code.startswith("PR-") or "tough" in sid:
        continue
    ap = s.get("apCost")
    for d in (s.get("stageDropInfo") or {}).get("displayDetailRewards", []):
        if d.get("dropType") == "NORMAL" and str(d.get("id", "")).startswith("3"):
            chip_ap.setdefault(d["id"], float(ap))

# ── ③ 제작 레시피 (가공소 + 제조소 F_ASC=듀얼칩) ─────────────────────────────
recipe = {}
for f in bd["manufactFormulas"].values():
    if f.get("formulaType") == "F_ASC":  # 듀얼칩: 칩셋2 + 촉매1 (costPoint 1로 미미)
        recipe.setdefault(f["itemId"], {
            "count": f.get("count", 1), "gold": 0,
            "costs": [(c["id"], c["count"]) for c in (f.get("costs") or [])], "extra": 0.0})
for f in bd["workshopFormulas"].values():
    recipe.setdefault(f["itemId"], {
        "count": f.get("count", 1), "gold": f.get("goldCost", 0),
        "costs": [(c["id"], c["count"]) for c in (f.get("costs") or [])],
        "extra": f.get("extraOutcomeRate") or 0.0})

memo, source = {}, {}
def sanity(iid, depth=0):
    """재료 1개의 이성 가치. 0 = 환산 불가(교환 전용 촉매·미출시 재료)."""
    if iid in memo:
        return memo[iid]
    if iid in EXP_ITEMS:
        memo[iid], source[iid] = EXP_ITEMS[iid] / EXP_PER_AP, "exp"
        return memo[iid]
    if iid == "4001":  # 용문폐
        memo[iid], source[iid] = 1 / LMD_PER_AP, "lmd"
        return memo[iid]
    if iid in chip_ap:
        memo[iid], source[iid] = chip_ap[iid], "chip"
        return memo[iid]
    ent = farm.get(iid)
    if ent and ent.get("stages"):
        memo[iid], source[iid] = min(s["sanity"] for s in ent["stages"]), "farm"
        return memo[iid]
    r = recipe.get(iid)
    if r and depth < 8:
        total = r["gold"] / LMD_PER_AP
        for cid, ct in r["costs"]:
            total += sanity(cid, depth + 1) * ct
        yielded = r["count"] * (1 + r["extra"])
        memo[iid], source[iid] = (total / yielded if yielded else 0.0), "craft"
        return memo[iid]
    memo[iid], source[iid] = 0.0, "none"
    return 0.0

# ── 육성에 실제로 쓰이는 재료만 수록 (costs.json의 정예화 재료) ───────────────
costs = load(f"{REPO}/app/data/costs.json")
need = set()
for op in costs["ops"].values():
    for phase in (op.get("elite") or []):
        if phase:
            for iid, _ in phase["items"]:
                need.add(iid)

items = {}
for iid in sorted(need):
    v = sanity(iid)
    if v > 0:
        items[iid] = round(v, 1)

out = {
    "_comment": "재료 이성(AP) 환산 단가 — scripts/build-sanity.py 생성. 육성 추천 회수일 계산의 정본.",
    "lmdPerAp": round(LMD_PER_AP, 2),
    "expPerAp": round(EXP_PER_AP, 2),
    # 무역소 주문 보상만은 게임 테이블에 없어 통용값을 쓴다 (유일한 추정 상수 — 화면에 명시)
    "goldLmd": GOLD_LMD,
    "basis": {"lmd": {"stage": LMD_STAGE, "ap": LMD_AP, "drop": LMD_DROP},
              "exp": {"stage": EXP_STAGE, "ap": EXP_AP, "drop": EXP_DROP}},
    "items": items,
}
dest = os.path.join(REPO, "app", "data", "sanity.json")
json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

miss = sorted(i for i in need if memo.get(i, 0) == 0)
by_src = {}
for i in items:
    by_src[source[i]] = by_src.get(source[i], 0) + 1
print(f"sanity.json: 재료 {len(items)}종 (출처 {by_src}) · 1이성 = {LMD_PER_AP:.1f} 용문폐 / {EXP_PER_AP:.1f} EXP")
if miss:
    print(f"  ⚠ 환산 불가 {len(miss)}종 (교환 전용·미출시): " + ", ".join(f"{NAMES.get(i, i)}({i})" for i in miss))
