#!/usr/bin/env python3
"""DPS 계산기 데이터 — app/data/dps.json (2026-10-17, 제안 e8bcebb4 "オペレーターのスキル仕様でのDPSがほしい").

게임 데이터만으로 만든다 (.gamedata/kr_* — gamedata-pull 이 받아 둔 것. 한섭에 없는 오퍼는 cn_* 로 미래시):
  · ph  = 정예화 단계마다 [최대 레벨, 1레벨 공격력, 최대 레벨 공격력, 기본 공격 간격(초), 공격 속도]
  · fav = 신뢰도 최대 때 공격력·공격 속도 보너스 [atk, aspd]
  · pot = 잠재 단계(2~6)마다 오르는 [atk, aspd] — 비용·재배치 같은 건 뺀다
  · eq  = 모듈 id → 단계(1~3)마다 [atk, aspd] (모듈 스탯만. 특성·재능을 바꾸는 효과는 계산기가 아직 안 다룬다)
  · sk  = 스킬마다 { id, t: 0 수동 · 1 자동 · 2 패시브, am: 탄약형이면 1, lv: [레벨(1~10)마다 {d: 지속(초), sp: [충전 방식, 필요 SP, 초기 SP], bb: {계수}}] }
          충전 방식: 0 시간 · 1 공격 · 2 피격 · 3 없음(패시브)
  · tb  = 특성 계수(trait blackboard) — 사냥꾼 공격 배율 같은 것
  · 스킬 tx = 한 번 공격의 타수, ap = 공격 한 번에 쓰는 탄약 — 계수에 없고 공식 스킬 설명에만 있는 것 (첸 더 홀룽데이 S3
    "공격이 2회 대미지 · 공격당 탄약 2발씩"). 계수에 times 가 있으면 그쪽이 이긴다
이름·스킬 설명·모듈 이름은 오퍼 도감 데이터(operators*.json)에서 언어별로 가져다 쓴다 — 여기는 숫자만이라 3개 언어 공용이다.

  python3 scripts/build-dps.py
"""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GD = Path(os.environ.get("GAMEDATA_DIR") or ROOT / ".gamedata")
OUT = ROOT / "app" / "data" / "dps.json"
# 스킬 보정 규칙 — 계수만으로는 틀리는 스킬 (타수·발동 피해·피해 유형 등). 형식은 app/dps-calc.ts SkillFx.
# scripts/dps-overrides.json 하나 + scripts/dps-overrides/*.json (전수조사 묶음) — 같은 스킬이면 뒤가 이긴다
OVR_FILES = [ROOT / "scripts" / "dps-overrides.json", *sorted((ROOT / "scripts" / "dps-overrides").glob("*.json"))]


def load(name):
    p = GD / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


SP_TYPE = {"INCREASE_WITH_TIME": 0, "INCREASE_WHEN_ATTACK": 1, "INCREASE_WHEN_TAKEN_DAMAGE": 2, 8: 3}
SK_TYPE = {"MANUAL": 0, "AUTO": 1, "PASSIVE": 2}
# 공식 스킬 설명의 타수·탄약 소모 — "추가로 1회 공격"(조건부)은 일부러 안 잡는다
TIMES_RE = [re.compile(p) for p in (r"연속으로 (\d)회 공격", r"(\d)회 연속 공격", r"공격이 (\d)회 대미지", r"(\d)연 사격", r"连续攻击(\d)次", r"攻击造成(\d)次伤害")]
AMMO_RE = [re.compile(p) for p in (r"공격당 탄약 (\d+)발", r"공격할 때마다 탄약 (\d+)발 소모", r"每次攻击消耗(\d+)发")]   # 엑시아 더 뉴 커버넌트 S3 "공격할 때마다 탄약 5발 소모" (전수조사 2026-10-17)


# 공격 간격 계수가 양수인데 설명이 '공격 딜레이 … 감소'면 기본 간격에 곱하는 배율이다 — 앤젤리나 S2 1.9초 × 0.15, 에벤홀츠 S1 3.0 × 0.17
# (전수조사 2026-10-17). '증가'면 종전대로 기본 간격 × (1 + 값). bt = "set"
BT_SET_RE = re.compile(r"공격 (?:딜레이|간격)[^,.\n]{0,20}?감소|攻击间隔[^，。]{0,10}?缩短")


def from_desc(desc):
    out = {}
    plain = re.sub(r"<[^>]*>", "", desc or "")   # <@ba.vup>…</> 꾸밈 태그를 걷어 낸 문장
    if BT_SET_RE.search(plain):
        out["bt"] = "set"
    for r in TIMES_RE:
        m = r.search(plain)
        if m:
            out["tx"] = int(m.group(1))
            break
    for r in AMMO_RE:
        m = r.search(plain)
        if m:
            out["ap"] = int(m.group(1))
            break
    return out


def num(v):
    v = float(v)
    return int(v) if v == int(v) else round(v, 4)


def build(server_tables, ids):
    ct, st, bt, ut = server_tables
    out = {}
    for cid in ids:
        o = ct.get(cid)
        if not o:
            continue
        ph = []
        for p in o["phases"]:
            kf = p["attributesKeyFrames"]
            a, b = kf[0]["data"], kf[-1]["data"]
            ph.append([p["maxLevel"], num(a["atk"]), num(b["atk"]), num(b["baseAttackTime"]), num(b["attackSpeed"])])
        fav = [0, 0]
        if o.get("favorKeyFrames"):
            d = o["favorKeyFrames"][-1]["data"]
            fav = [num(d.get("atk", 0)), num(d.get("attackSpeed", 0))]
        pot = []
        for r in o.get("potentialRanks") or []:
            atk = aspd = 0
            for m in (((r.get("buff") or {}).get("attributes") or {}).get("attributeModifiers") or []):
                if m["attributeType"] == "ATK":
                    atk += m["value"]
                elif m["attributeType"] == "ATTACK_SPEED":
                    aspd += m["value"]
            pot.append([num(atk), num(aspd)])
        sk = []
        for s in o.get("skills") or []:
            sid = s.get("skillId")
            if not sid or sid not in st:
                continue
            lv = []
            for L in st[sid]["levels"]:
                spd = L["spData"]
                lv.append({
                    "d": num(L["duration"]),
                    "sp": [SP_TYPE.get(spd["spType"], 3), num(spd["spCost"]), num(spd["initSp"])],
                    "bb": {b["key"]: num(b["value"]) for b in L["blackboard"] if b.get("value") is not None},
                })
            L0 = st[sid]["levels"][-1]
            sk.append({"id": sid, "t": SK_TYPE.get(L0["skillType"], 0), "am": 1 if L0.get("durationType") == "AMMO" else 0, "lv": lv,
                       **from_desc(L0.get("description"))})
        eq = {}
        for eid in (ut.get("charEquip") or {}).get(cid) or []:
            if eid not in bt:
                continue   # 기본 장비(001) — 스탯 없음
            st_ = []
            for p in bt[eid]["phases"]:
                bb = {a["key"]: a["value"] for a in p["attributeBlackboard"]}
                st_.append([num(bb.get("atk", 0)), num(bb.get("attack_speed", 0))])
            eq[eid] = st_
        tb = {}
        if o.get("trait"):
            tb = {b["key"]: num(b["value"]) for b in o["trait"]["candidates"][-1]["blackboard"] if b.get("value") is not None}
        out[cid] = {"sub": o["subProfessionId"], "prof": o["profession"], "ph": ph, "fav": fav, "pot": pot, "sk": sk, "eq": eq, "tb": tb}
    return out


def main():
    ops = json.loads((ROOT / "app" / "data" / "operators.json").read_text(encoding="utf-8"))
    ids = [o["id"] for o in ops]
    kr = (load("kr_character_table.json"), load("kr_skill_table.json"), load("kr_battle_equip_table.json"), load("kr_uniequip_table.json"))
    cn = (load("cn_character_table.json"), load("cn_skill_table.json"), load("cn_battle_equip_table.json"), load("cn_uniequip_table.json"))
    data = build(kr, ids)
    # 한섭에 없는 오퍼(미실장, 중섭 선행)는 중섭 표로
    data.update(build(cn, [i for i in ids if i not in data]))
    ovr = {}
    for f in OVR_FILES:
        if f.exists():
            ovr.update({k: v for k, v in json.loads(f.read_text(encoding="utf-8")).items() if not k.startswith("_")})
    hit = 0
    for o in data.values():
        for s in o["sk"]:
            if s["id"] in ovr:
                s["fx"] = ovr[s["id"]]
                hit += 1
    miss = set(ovr) - {s["id"] for o in data.values() for s in o["sk"]}
    if miss:
        print(f"  ⚠ 보정 규칙의 스킬 id 가 데이터에 없음: {sorted(miss)[:10]}")
    OUT.write_text(json.dumps({"ops": data}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  dps.json: 오퍼 {len(data)} · 스킬 {sum(len(v['sk']) for v in data.values())} · 보정 {hit} · {OUT.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
