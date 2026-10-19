#!/usr/bin/env python3
"""가챠(헤드헌팅) 시뮬레이터 풀 — app/data/gacha-pool.json (2026-10-12, 제안 0a84bd2f "가챠시뮬도 있으면").

게임 데이터만으로 만든다 (.gamedata/kr_character_table.json · kr_gacha_table.json — gamedata-pull 이 받아 둔 것):
  · 풀 = 획득 경로(itemObtainApproach)에 '인재 채용'이 든 3~6성 오퍼
  · 한정 = 한정 배너(gachaRuleType LIMITED)의 limitParam.limitedCharId — 표준 배너 일반 출현에서 뺀다
  · 콜라보 = 팀 rainbow(레인보우 식스)·laios(던전밥)·mujica(BanG Dream) · 도감 번호 MH(몬스터 헌터) — 역시 뺀다
  · 커널 = 커널 헤드헌팅(gachaRuleType CLASSIC·CLASSIC_DOUBLE·FESCLASSIC·CLASSIC_ATTAIN) 배너에 실린 오퍼 — 일반·한정 배너에는
    **안 나온다** (중섭이 커널 도입 때 팬텀 이전 6성·샤마르 이전 5성을 일반·한정 헤드헌팅에서 뺐다, 한섭 같음). 역시 뺀다
    (제안 75286c14, 2026-10-13 "스카디(기본)가 한정 배너에서 나온다")
  · 미실장 헤드헌팅 오퍼 = 한섭 표에 없고 중섭 획득 경로가 '招募寻访'인 3~6성 — 미래시를 켜면 픽업 후보에 든다(future)
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

COLLAB_TEAMS = {"rainbow", "laios", "mujica", "sees"}   # sees = 페르소나 3 (S.E.E.S.) — 2026-10-13 아이기스·유카리·마코토가 헤드헌팅으로 잡혔다
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

# 커널 — 커널 배너 dynMeta 의 오퍼 (한섭 + 중섭)
kernel = set()
def add_kernel(table):
    for p in table["gachaPoolClient"]:
        if p.get("gachaRuleType") in ("CLASSIC", "CLASSIC_DOUBLE", "FESCLASSIC", "CLASSIC_ATTAIN"):
            for k in ("dynMeta", "limitParam"):
                kernel.update(ids_in(p.get(k)))
add_kernel(gt)
if cn_gt_path.exists():
    add_kernel(json.loads(cn_gt_path.read_text(encoding="utf-8")))

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
    if cid in limited or cid in kernel:
        continue
    pool[r].append(cid)

# 미실장 콜라보 (중섭에만 있는 오퍼) · 미실장 헤드헌팅 오퍼
future = []
for cid, c in cn_ct.items():
    if cid in ct or not cid.startswith("char_"):
        continue
    if c.get("teamId") in COLLAB_TEAMS or (c.get("displayNumber") or "").startswith(COLLAB_NO):
        collab.append(cid)
        continue
    if (c.get("itemObtainApproach") or "").strip() == "招募寻访" and c.get("rarity") in ("TIER_3", "TIER_4", "TIER_5", "TIER_6") and cid not in kernel:
        future.append(cid)
future.sort()

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
# 이벤트 배너 — 이벤트와 함께 나온 신규 5·6성(events.json ops 'new'), 최신(미실장 포함)부터. 고르면 그 오퍼로 픽업을 채운다
# (사용자 지시 2026-10-12 "오퍼 뽑을 수 있는 이벤트 리스트를 다 만들어 줘"). 이름은 세 언어 — events.en/ja.json 의 같은 id
def load_events(suffix):
    p = ROOT / "app" / "data" / f"events{suffix}.json"
    return json.loads(p.read_text(encoding="utf-8"))["events"] if p.exists() else []
ev_ko = load_events("")
collab_set = set(collab)
names = {loc: {e["id"]: e.get("n") for e in load_events(f".{loc}")} for loc in ("en", "ja")}
events = []
for e in ev_ko:
    # 헤드헌팅으로 얻는 오퍼만 — 이벤트와 같이 데뷔해도 배포 오퍼(획득 경로 '이벤트')는 픽업이 아니다 (제안 75286c14)
    # 콜라보 헤드헌팅 오퍼도 뽑는 오퍼다 — 빠져 있어 포영창정(몬스터 헌터)·월행수상(페르소나 3)의 신규 오퍼가 플래너·시뮬레이터
    # 이벤트 배너에 안 나왔다 (사용자 지적 2026-10-19). collab 목록은 헤드헌팅 콜라보만 담는다(배포 오퍼는 위에서 '인재 채용' 경로로 걸렀고,
    # 중섭 전용은 'new'·5성 이상 조건이 이벤트 배포 오퍼(코로마루 등 1성)를 거른다)
    gachaable = lambda cid: ("인재 채용" in ((ct.get(cid) or {}).get("itemObtainApproach") or "")) or cid in future or cid in limited or cid in collab_set
    picks = [o[0] for o in e.get("ops", []) if o[3] == "new" and o[2] >= 5 and gachaable(o[0]) and o[0] not in kernel]
    if not picks:
        continue
    row = {"id": e["id"], "n": {"ko": e["n"], **{loc: names[loc].get(e["id"]) or e["n"] for loc in ("en", "ja")}}, "ops": picks}
    if e.get("fut"):
        row["fut"] = 1
        if e.get("eta"):
            row["eta"] = e["eta"]
    elif e.get("start"):
        row["start"] = e["start"]
    events.append(row)

# 가챠 플래너의 앞으로 일정 (제안 29e01609·48a95d32, 2026-10-17) — 진행 중이거나 앞으로 올 이벤트 전부(배너가 없는 이벤트도 첫 클리어
# 순오리지늄 수입이 있어 넣는다). 날짜는 한섭 기간, 미실장은 중↔한 시차 추정월(eta). 신규 헤드헌팅 오퍼(ops)와 한정 여부(lim)를 같이
today = time.strftime("%Y-%m-%d")
plan = []
for e in ev_ko:
    if not e.get("fut") and not ((e.get("end") or "") >= today):
        continue
    picks = [o[0] for o in e.get("ops", []) if o[3] == "new" and o[2] >= 5 and gachaable(o[0]) and o[0] not in kernel]
    row = {"id": e["id"], "n": {"ko": e["n"], **{loc: names[loc].get(e["id"]) or e["n"] for loc in ("en", "ja")}}}
    if e.get("fut"):
        row["fut"] = 1
        if e.get("eta"):
            row["eta"] = e["eta"]
    else:
        row["start"], row["end"] = e.get("start"), e.get("end")
    if picks:
        row["ops"] = picks
        if any(x in limited or x in collab_set for x in picks):   # 콜라보 배너도 한정 배너다
            row["lim"] = 1
        if any(x in collab_set for x in picks):   # 콜라보 배너는 매일 무료 1회가 없다 (사용자 지적 2026-10-19) — 플래너가 전용 연차를 뺀다
            row["collab"] = 1
    if e.get("prime"):
        row["prime"] = e["prime"]
    plan.append(row)

out = {
    "updated": time.strftime("%Y-%m-%d"),
    "rates": rates,
    "guarantee5": guarantee5,
    "pool": pool,
    "limited": sorted(i for i in limited if i in ct or i in cn_ct),
    "kernel": sorted(i for i in kernel if i in ct or i in cn_ct),
    "future": future,
    "collab": sorted(collab),
    "events": events,
    "plan": plan,
}
OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"확률 {rates} · 5성 보장 {guarantee5}회")
print(f"이벤트 배너 {len(events)}개 (미실장 {sum(1 for e in events if e.get('fut'))}) · 플래너 일정 {len(plan)}개")
print(f"gacha-pool.json: 6성 {len(pool['6'])} · 5성 {len(pool['5'])} · 4성 {len(pool['4'])} · 3성 {len(pool['3'])} · 한정 {len(out['limited'])} · 커널 {len(out['kernel'])} · 미실장 {len(future)} · 콜라보 {len(collab)}")
