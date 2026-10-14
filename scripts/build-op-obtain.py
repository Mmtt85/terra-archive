#!/usr/bin/env python3
"""오퍼 획득 경로 — app/data/op-obtain.json (2026-10-12, 제안 934ec868 "미보유 배포 오퍼의 입수 방법을 목록에서 걸러 보기").

오퍼 목록의 '획득 경로' 필터와 오퍼 상세의 '획득 경로' 줄이 쓴다. 값은 **언어와 무관한 코드**라 한 파일로 세 언어가 같이 쓴다.
  · 코드 — 한섭 character_table 의 itemObtainApproach 를 묶는다. 인재 채용 오퍼는 가챠 풀(gacha-pool.json)의 한정·콜라보로 다시 가른다
      gacha 헤드헌팅 · recruit 공개모집(헤드헌팅 풀에 없는 공채 전용) · limited 한정 헤드헌팅 · collab 콜라보 · event 이벤트 배포 · cert 증명서 교역소 · credit 크레딧 교역소
      rogue 통합전략 · main 메인 스토리 · anniv 기념 보상 · package 패키지
  · 이벤트 — 이벤트 배포 오퍼는 이벤트 데이터(events*.json)의 ops 'reward' 로 어느 이벤트인지 잇는다 (원 이벤트 = 가장 먼저 열린 것).
      사이트 개설 전 옛 이벤트는 그 기록이 없어 코드만 남는다
미실장(중섭 선행) 오퍼는 **중섭 character_table 의 획득 경로**로 채운다 (제안 75286c14, 2026-10-13 — 22명이 통째로 빠져 가챠 시뮬이
배포 오퍼 Вий 를 가려내지 못했고, 획득 경로 필터에도 안 걸렸다). 코드 표는 CODE_CN.

  python3 scripts/build-op-obtain.py      (build-events · build-gacha-pool 뒤 — 둘의 산출물을 읽는다)
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GD = Path(os.environ.get("GAMEDATA_DIR") or ROOT / ".gamedata")
DATA = ROOT / "app" / "data"

CODE = {
    "인재 채용": "gacha", "인재 채용, 인턴 임무": "gacha",
    "이벤트 획득": "event", "증명서 교역소": "cert", "크레딧 교역소": "credit",
    "통합 전략 획득": "rogue", "메인 스토리": "main", "애니버서리 보상": "anniv", "기간 한정 패키지": "package",
}

# 중섭 획득 경로 문구 → 같은 코드
CODE_CN = {
    "招募寻访": "gacha", "招募寻访、见习任务": "gacha",
    "活动获得": "event", "凭证交易所": "cert", "信用交易所": "credit",
    "集成战略获得": "rogue", "主线剧情": "main", "周年奖励": "anniv", "限时礼包": "package",
}

ct = json.loads((GD / "kr_character_table.json").read_text(encoding="utf-8"))
cn_path = GD / "cn_character_table.json"
cn_ct = json.loads(cn_path.read_text(encoding="utf-8")) if cn_path.exists() else {}
pool = json.loads((DATA / "gacha-pool.json").read_text(encoding="utf-8"))
limited, collab = set(pool.get("limited", [])), set(pool.get("collab", []))
# 게임의 '인재 채용'(招募寻访)은 헤드헌팅 + 공개모집을 한 말로 쓴다 — 헤드헌팅 풀(통상·커널·한정·콜라보) 어디에도 없고
# 공개모집 풀에만 있으면 공개모집(recruit). 종전엔 GALLUS² 같은 1성 로봇까지 '헤드헌팅'이었다 (사용자 지적 2026-10-14)
gacha_any = set(x for v in pool.get("pool", {}).values() for x in v) | set(pool.get("kernel", [])) | limited | collab
recruit_ids = {o["id"] for o in json.loads((DATA / "recruit.json").read_text(encoding="utf-8"))["ops"]}

def events(suffix):
    p = DATA / f"events{suffix}.json"
    return json.loads(p.read_text(encoding="utf-8"))["events"] if p.exists() else []
ev_ko = events("")
names = {"en": {e["id"]: e.get("n") for e in events(".en")}, "ja": {e["id"]: e.get("n") for e in events(".ja")}}

# 오퍼 → 원 이벤트 (가장 먼저 열린 것, 날짜 없는 미래 이벤트는 뒤로)
reward = {}
for e in ev_ko:
    for o in e.get("ops", []):
        if o[3] != "reward":
            continue
        cur = reward.get(o[0])
        key = e.get("start") or "9999"
        if not cur or key < cur[1]:
            reward[o[0]] = (e["id"], key)

ops, used_ev, unknown = {}, {}, {}
# 한섭 표 + 한섭에 없는 중섭 오퍼(미실장)
rows_src = [(cid, c, CODE) for cid, c in ct.items()] + [(cid, c, CODE_CN) for cid, c in cn_ct.items() if cid not in ct]
for cid, c, table in rows_src:
    if not cid.startswith("char_") or c.get("isNotObtainable"):
        continue
    raw = (c.get("itemObtainApproach") or "").strip()
    code = table.get(raw)
    if not code:
        if raw:
            unknown[raw] = unknown.get(raw, 0) + 1
        continue
    if code == "gacha":
        code = "limited" if cid in limited else "collab" if cid in collab else \
            "recruit" if cid in recruit_ids and cid not in gacha_any and cid in ct else "gacha"
    row = [code]
    if cid in reward:
        evid = reward[cid][0]
        row.append(evid)
        used_ev[evid] = True
    ops[cid] = row

ev_names = {}
for e in ev_ko:
    if e["id"] in used_ev:
        ev_names[e["id"]] = {"ko": e["n"], "en": names["en"].get(e["id"]) or e["n"], "ja": names["ja"].get(e["id"]) or e["n"]}

out = {"ops": ops, "events": ev_names}
(DATA / "op-obtain.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
by = {}
for r in ops.values():
    by[r[0]] = by.get(r[0], 0) + 1
print(f"op-obtain.json: {len(ops)}명 · {by} · 이벤트 이름 {len(ev_names)}개")
if unknown:
    print(f"⚠ 모르는 획득 경로 (코드 표에 더할 것): {unknown}")
