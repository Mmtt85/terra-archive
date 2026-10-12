#!/usr/bin/env python3
"""가챠(헤드헌팅) 시뮬레이터 풀 — app/data/gacha-pool.json (2026-10-12, 제안 0a84bd2f "가챠시뮬도 있으면").

게임 데이터만으로 만든다 (.gamedata/kr_character_table.json · kr_gacha_table.json — gamedata-pull 이 받아 둔 것):
  · 풀 = 획득 경로(itemObtainApproach)에 '인재 채용'이 든 3~6성 오퍼
  · 한정 = 한정 배너(gachaRuleType LIMITED)의 limitParam.limitedCharId — 표준 배너 일반 출현에서 뺀다
  · 콜라보 = 팀 rainbow(레인보우 식스)·laios(던전밥)·mujica(BanG Dream) · 도감 번호 MH(몬스터 헌터) — 역시 뺀다
  · 미래시 — 중섭(cn_gacha_table·cn_character_table)의 한정·콜라보도 같이 싣는다. 미래시를 켜면 미실장 오퍼를 픽업에
    넣어 앞으로 올 배너를 미리 돌려 보는데, 그때 미실장 한정이 표준 배너 후보에 섞이지 않게 (사용자 지시 2026-10-12)
⚠ 픽업 오퍼는 게임 데이터에 없다 (일반·한정 배너 픽업은 공지로만 나온다) — 시뮬레이터에서 사용자가 고른다.

  python3 scripts/build-gacha-pool.py
"""
import base64
import os
import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GD = Path(os.environ.get("GAMEDATA_DIR") or ROOT / ".gamedata")
OUT = ROOT / "app" / "data" / "gacha-pool.json"

COLLAB_TEAMS = {"rainbow", "laios", "mujica"}
COLLAB_NO = ("MH",)   # 도감 번호 접두 — 몬스터 헌터는 팀 표식이 없다

ct = json.loads((GD / "kr_character_table.json").read_text(encoding="utf-8"))
gt = json.loads((GD / "kr_gacha_table.json").read_text(encoding="utf-8"))


def ids_in(param):
    b = (param or {}).get("base64") if isinstance(param, dict) else None
    return [m.decode() for m in re.findall(rb"char_[0-9a-z_]+", base64.b64decode(b))] if b else []


limited = set()
for pool in gt["gachaPoolClient"]:
    if pool.get("gachaRuleType") == "LIMITED":
        limited.update(ids_in(pool.get("limitParam")))
# 미래시 — 중섭 표가 있으면 (gamedata-pull 이 받는다. 없으면 한섭만으로)
cn_gt_path, cn_ct_path = GD / "cn_gacha_table.json", GD / "cn_character_table.json"
cn_ct = json.loads(cn_ct_path.read_text(encoding="utf-8")) if cn_ct_path.exists() else {}
if cn_gt_path.exists():
    for pool in json.loads(cn_gt_path.read_text(encoding="utf-8"))["gachaPoolClient"]:
        if pool.get("gachaRuleType") == "LIMITED":
            limited.update(ids_in(pool.get("limitParam")))

pool = {"6": [], "5": [], "4": [], "3": []}
collab = []
for cid, c in ct.items():
    if not cid.startswith("char_") or c.get("isNotObtainable"):
        continue
    if "인재 채용" not in (c.get("itemObtainApproach") or ""):
        continue
    r = {"TIER_3": "3", "TIER_4": "4", "TIER_5": "5", "TIER_6": "6"}.get(c.get("rarity"))
    if not r:
        continue
    is_collab = c.get("teamId") in COLLAB_TEAMS or (c.get("displayNumber") or "").startswith(COLLAB_NO)
    if is_collab:
        collab.append(cid)
        continue
    if cid in limited:
        continue
    pool[r].append(cid)

# 미실장 콜라보 (중섭에만 있는 오퍼)
for cid, c in cn_ct.items():
    if cid in ct or not cid.startswith("char_"):
        continue
    if c.get("teamId") in COLLAB_TEAMS or (c.get("displayNumber") or "").startswith(COLLAB_NO):
        collab.append(cid)

for k in pool:
    pool[k].sort()

# 확률·보장 — **게임 데이터에서 읽는다** (사용자 지시 2026-10-12 "외부 사이트가 아니라 게임 내 확률 데이터로")
#  · 성급별 기본 확률: 배너 상세 안내 문구의 '★★★★★★(2%)' 줄 (신규 배너 gachaPoolDetail 에 실려 있다)
#  · 첫 N회 5성 이상 보장: 배너의 guarantee5Count (guarantee5Avail=1 인 배너)
#  ⚠ 6성 천장(50회 이후 +2%)·픽업 비율(50%·한정 70%)은 게임 표에 없다 — 게임이 서버에서 받아 보여 주는 배너 공지라
#    app/gacha.tsx 에 상수로 두고 출처를 밝힌다
rates = {}
for np in gt.get("newbeeGachaPoolClient", []):
    for stars, pct in re.findall(r"(★{3,6})\((\d+(?:\.\d+)?)%\)", np.get("gachaPoolDetail") or ""):
        rates.setdefault(str(len(stars)), float(pct) / 100)
assert set(rates) >= {"3", "4", "5", "6"}, f"성급별 확률을 못 읽었다: {rates}"
g5 = [p.get("guarantee5Count") for p in gt["gachaPoolClient"] if p.get("guarantee5Avail") and p.get("guarantee5Count")]
guarantee5 = max(set(g5), key=g5.count) if g5 else 0
out = {
    "updated": time.strftime("%Y-%m-%d"),
    "rates": rates,
    "guarantee5": guarantee5,
    "pool": pool,
    "limited": sorted(i for i in limited if i in ct or i in cn_ct),
    "collab": sorted(collab),
}
OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"확률 {rates} · 5성 보장 {guarantee5}회")
print(f"gacha-pool.json: 6성 {len(pool['6'])} · 5성 {len(pool['5'])} · 4성 {len(pool['4'])} · 3성 {len(pool['3'])} · 한정 {len(out['limited'])} · 콜라보 {len(collab)}")
