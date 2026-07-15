# Regenerate app/data/operators.json (430 ops) from KR gamedata.
# Mechanical fields rebuilt for everyone; curated accent/nicknames preserved from old data.
import json, re, sys

import os, sys
S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

load = lambda p: json.load(open(p, encoding="utf-8"))
kr = load(f"{S}/kr_character_table.json"); chars = kr.get("chars", kr)
skill_table = load(f"{S}/kr_skill_table.json")
skill_table = skill_table.get("skills", skill_table)
uniequip = load(f"{S}/kr_uniequip_table.json")
battle_equip = load(f"{S}/kr_battle_equip_table.json")
battle_equip = battle_equip.get("equips", battle_equip)
building = load(f"{S}/kr_building_data.json")
ranges = load(f"{S}/kr_range_table.json"); ranges = ranges.get("range", ranges)
team_table = load(f"{S}/kr_handbook_team_table.json")
kr_team_table = team_table
handbook = load(f"{S}/kr_handbook_info_table.json"); handbook = handbook.get("handbookDict", handbook)
# KR release order: handbook entries append in release order (no entry → -1, sinks last)
release_seq = {cid: i for i, cid in enumerate(handbook.keys())}
jp = load(f"{S}/jp_character_table.json"); jp = jp.get("chars", jp)
cn = load(f"{S}/cn_character_table.json"); cn = cn.get("chars", cn)
old_ops = {o["id"]: o for o in load(f"{REPO}/app/data/operators.json")}

# ─── 미래시(미실장) 오퍼: CN에만 있는 오퍼를 CN 테이블로 빌드해 unreleased 플래그를 달아 추가 ───
cn_tables = {
    "skill_table": load(f"{S}/cn_skill_table.json"),
    "uniequip": load(f"{S}/cn_uniequip_table.json"),
    "battle_equip": load(f"{S}/cn_battle_equip_table.json"),
    "building": load(f"{S}/cn_building_data.json"),
    "ranges": load(f"{S}/cn_range_table.json"),
    "team_table": load(f"{S}/cn_handbook_team_table.json"),
    "handbook": load(f"{S}/cn_handbook_info_table.json"),
}
cn_tables["skill_table"] = cn_tables["skill_table"].get("skills", cn_tables["skill_table"])
cn_tables["battle_equip"] = cn_tables["battle_equip"].get("equips", cn_tables["battle_equip"])
cn_tables["ranges"] = cn_tables["ranges"].get("range", cn_tables["ranges"])
cn_tables["handbook"] = cn_tables["handbook"].get("handbookDict", cn_tables["handbook"])

JOB_KO = {"PIONEER": "뱅가드", "WARRIOR": "가드", "TANK": "디펜더", "SNIPER": "스나이퍼",
          "CASTER": "캐스터", "MEDIC": "메딕", "SUPPORT": "서포터", "SPECIAL": "스페셜리스트"}
ROOM_KO = {"MANUFACTURE": "제조소", "TRADING": "무역소", "POWER": "발전소", "WORKSHOP": "가공소",
           "DORMITORY": "숙소", "MEETING": "응접실", "HIRE": "사무실", "TRAINING": "훈련실",
           "CONTROL": "제어 센터", "ELEVATOR": "엘리베이터", "CORRIDOR": "복도"}
SP_KO = {1: "자동 회복", 2: "공격 회복", 4: "피격 회복", 8: "패시브",
         "INCREASE_WITH_TIME": "자동 회복", "INCREASE_WHEN_ATTACK": "공격 회복",
         "INCREASE_WHEN_TAKEN_DAMAGE": "피격 회복", "UNCHANGED": "패시브"}
ATTR_KO = {"max_hp": "HP", "atk": "공격력", "def": "방어력", "magic_resistance": "마법 저항",
           "attack_speed": "공격 속도", "block_cnt": "저지", "cost": "코스트",
           "respawn_time": "재배치 시간"}

def tier(r):
    return r + 1 if isinstance(r, int) else int(str(r).replace("TIER_", ""))

def phase_no(p):
    return p if isinstance(p, int) else int(str(p).replace("PHASE_", ""))

def strip_tags(s):
    if not s: return s
    s = re.sub(r"<[@$/][^>]*>", "", s).replace("</>", "")
    s = re.sub(r"<[a-zA-Z][^>]*>", "", s)
    s = s.replace("\\n", " ").replace("\n", " ")
    return re.sub(r"\s+", " ", s).strip()

def fmt_num(v):
    if isinstance(v, float) and v.is_integer(): v = int(v)
    if isinstance(v, float): v = round(v, 2)
    return str(v)

def interpolate(desc, blackboard):
    if not desc: return desc
    bb = {}
    for e in blackboard or []:
        bb[str(e.get("key", "")).lower()] = e.get("valueStr") if e.get("valueStr") is not None else e.get("value")
    def rep(m):
        neg = m.group(1) == "-"
        key = m.group(2).lower()
        fmt = m.group(3) or ""
        if key not in bb: return ""
        v = bb[key]
        if isinstance(v, str): return v
        if neg: v = -v
        if "%" in fmt:
            v = v * 100
            v = int(round(v)) if abs(v - round(v)) < 1e-6 else round(v, 1)
            return f"{v}%"
        return fmt_num(v)
    out = re.sub(r"\{(-?)([a-zA-Z0-9_.\[\]@]+)(?::([^}]*))?\}", lambda m: rep(m), desc)
    return strip_tags(out)

def team_name(pid):
    if not pid: return None
    # KR 테이블 우선 (진영명은 미실장 오퍼라도 KR에 번역이 있는 경우가 많다), 없으면 CN 폴백
    e = kr_team_table.get(pid) or team_table.get(pid)
    return e.get("powerName") if e else None

unknown_powers = set()

def factions_of(c, cid):
    names = []
    for pid in [c.get("teamId"), c.get("groupId"), c.get("nationId")]:
        if not pid: continue
        n = team_name(pid)
        if n: names.append(n)
        else: unknown_powers.add((cid, pid))
    seen = set(); out = []
    for n in names:
        if n not in seen: seen.add(n); out.append(n)
    return out or ["소속 없음"]

def build_stats(c):
    rows = []
    for i, ph in enumerate(c.get("phases") or []):
        kf = ph["attributesKeyFrames"][-1]["data"]
        rid = ph.get("rangeId")
        grids = []
        if rid and rid in ranges:
            grids = [{"row": g["row"], "col": g["col"]} for g in ranges[rid]["grids"]]
        res = kf.get("magicResistance", 0)
        if isinstance(res, float) and res.is_integer(): res = int(res)
        bat = kf.get("baseAttackTime", 0)
        if isinstance(bat, float) and bat.is_integer(): bat = int(bat)
        rows.append({"phase": f"정예화 {i}", "level": ph.get("maxLevel"),
                     "hp": kf.get("maxHp"), "atk": kf.get("atk"), "def": kf.get("def"),
                     "res": res, "cost": kf.get("cost"), "block": kf.get("blockCnt"),
                     "redeploy": kf.get("respawnTime"), "interval": bat,
                     "rangeId": rid, "range": grids})
    return rows

def build_skills(c):
    out = []
    for s in c.get("skills") or []:
        sid = s.get("skillId")
        if not sid or sid not in skill_table: continue
        lv = skill_table[sid]["levels"][-1]
        sp = lv.get("spData") or {}
        dur = lv.get("duration")
        if dur is not None and dur <= 0: dur = None
        if isinstance(dur, float) and dur.is_integer(): dur = int(dur)
        out.append({"id": sid, "name": lv.get("name"),
                    "spType": SP_KO.get(sp.get("spType"), str(sp.get("spType"))),
                    "initialSp": sp.get("initSp"), "spCost": sp.get("spCost"),
                    "duration": dur,
                    "description": interpolate(lv.get("description"), lv.get("blackboard"))})
    return out

def build_talents(c):
    out = []
    for t in c.get("talents") or []:
        cands = [x for x in (t.get("candidates") or []) if not x.get("isHideTalent")]
        if not cands: continue
        best = cands[-1]
        if not best.get("name"): continue
        out.append({"name": best["name"],
                    "description": interpolate(best.get("description"), best.get("blackboard"))})
    return out

def build_potentials(c):
    out = []
    for i, p in enumerate(c.get("potentialRanks") or []):
        out.append({"rank": i + 2, "description": strip_tags(p.get("description"))})
    return out

def build_trait(c):
    tr = c.get("trait")
    if tr and tr.get("candidates"):
        best = tr["candidates"][-1]
        txt = best.get("overrideDescripton") or c.get("description")
        return interpolate(txt, best.get("blackboard"))
    if c.get("description"):
        return strip_tags(c.get("description"))
    sub = c.get("subProfessionId", "")
    return f"{sub} 세부 직군의 기본 특성을 따릅니다."

def module_unlock(eq):
    ph = phase_no(eq.get("unlockEvolvePhase", 0))
    lvl = eq.get("unlockLevel", 1)
    return f"정예화 {ph} · Lv.{lvl}"

def build_modules(cid):
    ids = (uniequip.get("charEquip") or {}).get(cid) or []
    mods = []
    for eid in ids:
        eq = (uniequip.get("equipDict") or {}).get(eid)
        if not eq or eq.get("typeName1") == "ORIGINAL": continue
        mtype = eq.get("typeName1", "")
        if eq.get("typeName2"): mtype += "-" + eq["typeName2"]
        levels = []
        be = battle_equip.get(eid)
        for idx, ph in enumerate((be or {}).get("phases") or []):
            stats_parts = []
            for ab in ph.get("attributeBlackboard") or []:
                k = ATTR_KO.get(ab.get("key"), ab.get("key"))
                v = ab.get("value")
                if isinstance(v, float) and v.is_integer(): v = int(v)
                sign = "+" if isinstance(v, (int, float)) and v >= 0 else ""
                stats_parts.append(f"{k} {sign}{v}")
            effects = []
            for part in ph.get("parts") or []:
                tb = (part.get("overrideTraitDataBundle") or {}).get("candidates") or []
                cands0 = [x for x in tb if x.get("requiredPotentialRank", 0) == 0]
                if cands0:
                    b = cands0[-1]
                    txt = b.get("additionalDescription") or b.get("overrideDescripton")
                    txt = interpolate(txt, b.get("blackboard"))
                    if txt: effects.append(txt)
                lb = (part.get("addOrOverrideTalentDataBundle") or {}).get("candidates") or []
                lc = [x for x in lb if x.get("requiredPotentialRank", 0) == 0]
                if lc:
                    b = lc[-1]
                    txt = interpolate(b.get("upgradeDescription") or b.get("description"), b.get("blackboard"))
                    if txt: effects.append(txt)
            dedup = []
            for e in effects:
                if e not in dedup: dedup.append(e)
            levels.append({"level": idx + 1, "stats": " · ".join(stats_parts) or None, "effects": dedup})
        mods.append({"id": eid, "name": eq.get("uniEquipName"), "type": mtype,
                     "unlock": module_unlock(eq), "levels": levels})
    return mods

def build_infra(cid):
    entry = (building.get("chars") or {}).get(cid)
    if not entry: return []
    out = []
    for bc in entry.get("buffChar") or []:
        for bd in bc.get("buffData") or []:
            buff = (building.get("buffs") or {}).get(bd.get("buffId"))
            if not buff: continue
            cond = bd.get("cond") or {}
            ph = phase_no(cond.get("phase", 0)); lvl = cond.get("level", 1)
            unlock = f"Lv.{lvl}" if ph == 0 else f"정예화 {ph}"
            out.append({"name": buff.get("buffName"), "room": ROOM_KO.get(buff.get("roomType"), buff.get("roomType")),
                        "unlock": unlock, "description": strip_tags(buff.get("description"))})
    return out

def build_handbook(cid):
    e = handbook.get(cid)
    birth = race = None
    if e:
        for sta in e.get("storyTextAudio") or []:
            for st in sta.get("stories") or []:
                t = st.get("storyText", "")
                # KR: [출신지]/[종족], CN(미실장 오퍼): 【出身地】/【种族】
                m1 = re.search(r"[\[【](?:출신지?|出身地)[\]】]\s*([^\n\[【]+)", t)
                m2 = re.search(r"[\[【](?:종족|种族)[\]】]\s*([^\n\[【]+)", t)
                if m1 and not birth: birth = m1.group(1).strip()
                if m2 and not race: race = m2.group(1).strip()
            if birth or race: break
    return birth or "불명", race or "불명"

def build_aliases(cid, c):
    name = c.get("name")
    suffix = cid.split("_", 2)[-1]
    cand = [c.get("appellation"), c.get("displayNumber"),
            (jp.get(cid) or {}).get("name"), (cn.get(cid) or {}).get("name"), suffix]
    old = old_ops.get(cid)
    if old:
        mech_old = {c.get("appellation"), c.get("displayNumber"), (jp.get(cid) or {}).get("name"),
                    (cn.get(cid) or {}).get("name"), suffix, (c.get("appellation") or "").lower()}
        extras = [a for a in old.get("aliases", []) if a not in mech_old and a != name]
        cand += extras
    out = []
    for a in cand:
        if a and a != name and a not in out: out.append(a)
    return out

NEW_ACCENTS = {
    "char_1022_flwr2": "#6f9a6c", "char_1043_leizi2": "#7b68b5", "char_1044_hsgma2": "#4e8e83",
    "char_1045_svash2": "#6f8fa8", "char_1046_sbell2": "#7d93b8", "char_1047_halo2": "#55628f",
    "char_394_hadiya": "#a8804d", "char_4051_akkord": "#8a6f9e", "char_4056_titi": "#63a08f",
    "char_4166_varkis": "#b05a4a", "char_4182_oblvns": "#5c5470", "char_4183_mortis": "#6b7f6a",
    "char_4184_dolris": "#5f7fa0", "char_4185_amoris": "#b06a8c", "char_4186_tmoris": "#6d6fa3",
    "char_4195_radian": "#5f86a8", "char_4196_reckpr": "#9c8455", "char_4199_makiri": "#55698f",
    "char_4202_haruka": "#b07685", "char_4203_kichi": "#7a8f5f", "char_4204_mantra": "#9a5f74",
    "char_4207_branch": "#8f7a4e", "char_4208_wintim": "#6c95ab", "char_4211_snhunt": "#5d87a0",
    "char_4212_nasti": "#7d6f95", "char_4213_skybx": "#5a8bc0", "char_4214_cairn": "#6e8a75",
    "char_616_pithst": "#7f7f89", "char_617_sharp2": "#a0654e",
}

# curated display overrides from the deployed prototype (baked into data now)
CURATED = {
    "첸": {"code": "CH'EN", "reason": "공격 회복 스킬과 아군의 공격·피격 회복 SP를 보조하는 재능", "accent": "#dc5a45"},
    "총웨": {"code": "CHONGYUE", "reason": "공격으로 SP를 채워 스킬을 누적 강화하는 핵심 딜러", "accent": "#d5963e"},
    "시": {"code": "DUSK", "reason": "프리링을 소환해 저지선과 화력을 함께 구성", "accent": "#6f72b8"},
    "링": {"code": "LING", "reason": "여러 형태의 소환수로 전장을 단독 설계", "accent": "#6576a9"},
    "스카디": {"code": "SKADI", "reason": "어비설 헌터 진영 강화와 단일 대상 압박", "accent": "#44799d"},
    "글래디아": {"code": "GLADIIA", "reason": "어비설 헌터에게 체력 회복과 피해 감소를 제공", "accent": "#7c4f79"},
    "스펙터 디 언체인드": {"code": "SPECTER", "reason": "대역과 모듈을 통해 어비설 덱의 생존·화력 축 담당", "accent": "#865a75"},
    "안드레아나": {"code": "ANDREANA", "reason": "어비설 헌터의 공격 속도를 높이는 장거리 딜러", "accent": "#745e8b"},
    "블레미샤인": {"code": "BLEMISHINE", "reason": "수면 상태의 적을 공격할 수 있고 피격 회복 스킬을 지원", "accent": "#c79e47"},
    "에라토": {"code": "ERATO", "reason": "수면 부여 후 잠든 적을 우선 공격하는 연계 딜러", "accent": "#b37f50"},
    "블랙나이트": {"code": "BLACKNIGHT", "reason": "소환수 주변에 범위 수면을 걸어 흐름을 끊음", "accent": "#62758e"},
    "카프카": {"code": "KAFKA", "reason": "배치 즉시 주변 적을 재워 안전한 딜 타이밍을 생성", "accent": "#6b8c68"},
    "아르케토": {"code": "ARCHETTO", "reason": "스나이퍼의 공격 회복 스킬 SP를 주기적으로 충전", "accent": "#b98b43"},
    "스테인리스": {"code": "STAINLESS", "reason": "장치를 타격해 공격 회복 SP와 스킬 발동을 가속", "accent": "#b07645"},
    "리스캄": {"code": "LISKARM", "reason": "공격받을 때 인접 아군에게 SP를 공급", "accent": "#4f6c92"},
    "와파린": {"code": "WARFARIN", "reason": "공격 범위 내 적 처치 시 무작위 아군에게 SP 공급", "accent": "#a34652"},
    "그노시스": {"code": "GNOSIS", "reason": "냉기 중첩과 빙결로 취약 효과를 만드는 핵심 제어", "accent": "#5b7c99"},
    "오로라": {"code": "AURORA", "reason": "빙결된 적을 상대로 강력한 단발 피해를 가함", "accent": "#6291a5"},
}

sub_dict = uniequip.get("subProfDict") or {}
cn_sub_dict = cn_tables["uniequip"].get("subProfDict") or {}
def sub_name(spid):
    e = sub_dict.get(spid) or cn_sub_dict.get(spid)
    return e.get("subProfessionName") if e else spid

def build_op(cid, c):
    name = c.get("name")
    stats = build_stats(c)
    birth, race = build_handbook(cid)
    old = old_ops.get(cid)
    op = {
        "id": cid,
        "name": name,
        "code": c.get("appellation") or name,
        "rarity": tier(c.get("rarity")),
        "job": JOB_KO.get(c.get("profession"), c.get("profession")),
        "jobCode": c.get("profession"),
        "subProfession": sub_name(c.get("subProfessionId")),
        "position": "근거리" if c.get("position") == "MELEE" else "원거리",
        # 게임 데이터에 빈 문자열 태그가 섞인 사례 있음 (예비 오퍼레이터·하디야)
        "combatTags": [t for t in (c.get("tagList") or []) if t and t.strip()],
        "faction": None,  # set below
        "factions": factions_of(c, cid),
        "birthplace": birth,
        "race": race,
        "concepts": [],  # retagged in tag pass
        "aliases": build_aliases(cid, c),
        "reason": strip_tags(c.get("itemUsage")) or (old or {}).get("reason") or "",
        "trait": build_trait(c),
        "talents": build_talents(c),
        "stats": stats,
        "skills": build_skills(c),
        "potentials": build_potentials(c),
        "modules": build_modules(cid),
        "infrastructure": build_infra(cid),
        "seq": release_seq.get(cid, -1),
        "accent": (old or {}).get("accent") or NEW_ACCENTS.get(cid) or "#6b7a86",
        "image": f"/avatars/{cid}.png",  # local copy; run scripts/download-avatars.py for new ops
    }
    cur = CURATED.get(name)
    if cur:
        op["code"] = cur["code"]; op["reason"] = cur["reason"]; op["accent"] = cur["accent"]
    op["faction"] = op["factions"][0]
    return op

result = []
for cid, c in chars.items():
    if not cid.startswith("char_"): continue
    # 획득 불가 게스트 오퍼 중 모듈 데이터가 들어있는 항목은 스토리용 가짜 데이터
    # (6성판 샤프·피스·튤립·미저리·스톰아이·메커니스트·로드·샤프·라이디언 char_6xx 계열).
    # 모듈 없는 획득 불가 오퍼(5성 A팀 등)는 실사용 가능하므로 유지.
    if c.get("isNotObtainable") and build_modules(cid): continue
    result.append(build_op(cid, c))

# ─── 미래시(미실장) 오퍼 2차 패스 — CN 테이블로 스위칭 후 CN 전용 오퍼를 빌드 ────────────
# 이름은 한국어 표기가 없으므로 영문 코드네임(appellation)을 쓰고, 중국어 원명은
# aliases에 들어간다(build_aliases의 cn 테이블 참조). 검색용 한국어 통칭은 FUTURE_ALIASES.
FUTURE_ALIASES = {
    "char_4228_closur": ["클로저"],
    "char_1050_chen3": ["첸"],
    "char_1052_kalts2": ["켈시"],
    "char_1051_headb2": ["지마"],
    "char_1048_orchd2": ["오키드", "몬헌"],
    "char_1049_catap2": ["캐터펄트", "몬헌"],
    "char_2027_wang": ["왕"],
}
# ── 미실장 오퍼 한국어화: KR·CN 양쪽에 다 있는 오퍼로 CN→KR 공통 어휘 사전을 만든다 ──
# 출신지·종족·전투 태그는 양 서버 공통 어휘(용문·용·컬럼비아·광역 등)라, 두 서버에 모두
# 존재하는 오퍼에서 같은 필드의 KR값과 CN값을 짝지어 다수결 사전을 구축하면 미실장 오퍼도
# 한국어로 표기할 수 있다 (스킬·재능 같은 자유 서술은 KR 소스가 없어 원문 유지).
from collections import Counter, defaultdict
def parse_profile(hb, cid):
    e = hb.get(cid); birth = race = None
    for sta in (e or {}).get("storyTextAudio") or []:
        for st in sta.get("stories") or []:
            txt = st.get("storyText", "")
            m1 = re.search(r"[\[【](?:출신지?|出身地)[\]】]\s*([^\n\[【]+)", txt)
            m2 = re.search(r"[\[【](?:종족|种族)[\]】]\s*([^\n\[【]+)", txt)
            if m1 and not birth: birth = m1.group(1).strip()
            if m2 and not race: race = m2.group(1).strip()
        if birth or race: break
    return birth, race

kr_handbook = handbook  # 상단에서 load한 KR handbook (아직 CN으로 안 바뀜)
cn_handbook = cn_tables["handbook"]
birth_votes = defaultdict(Counter); race_votes = defaultdict(Counter); tag_votes = defaultdict(Counter)
for cid in set(chars) & set(cn):
    kb, kr_race = parse_profile(kr_handbook, cid)
    cb, cn_race = parse_profile(cn_handbook, cid)
    if kb and cb: birth_votes[cb][kb] += 1
    if kr_race and cn_race: race_votes[cn_race][kr_race] += 1
    kt = [t for t in (chars[cid].get("tagList") or []) if t and t.strip()]
    ct = [t for t in (cn[cid].get("tagList") or []) if t and t.strip()]
    if len(kt) == len(ct):
        for c_tag, k_tag in zip(ct, kt): tag_votes[c_tag][k_tag] += 1
BIRTH_CN2KR = {k: v.most_common(1)[0][0] for k, v in birth_votes.items()}
RACE_CN2KR = {k: v.most_common(1)[0][0] for k, v in race_votes.items()}
TAG_CN2KR = {k: v.most_common(1)[0][0] for k, v in tag_votes.items()}

skill_table = cn_tables["skill_table"]; uniequip = cn_tables["uniequip"]
battle_equip = cn_tables["battle_equip"]; building = cn_tables["building"]
ranges = cn_tables["ranges"]; team_table = cn_tables["team_table"]; handbook = cn_tables["handbook"]
# 출시순(seq): KR 전체 뒤에 CN 도감 순서대로 이어 붙인다 → '출시순 최신'에 미래시가 맨 앞
cn_seq = {c2: i for i, c2 in enumerate(cn_tables["handbook"].keys())}
release_seq = {cid: 100000 + cn_seq.get(cid, 99999) for cid in cn if cid not in chars}
unreleased_count = 0
for cid, c in cn.items():
    if not cid.startswith("char_") or cid in chars: continue
    if c.get("isNotObtainable") and build_modules(cid): continue
    op = build_op(cid, c)
    op["name"] = c.get("appellation") or c.get("name")
    op["aliases"] = [a for a in [c.get("name")] + op["aliases"] + FUTURE_ALIASES.get(cid, [])
                     if a and a != op["name"]]
    op["aliases"] = list(dict.fromkeys(op["aliases"]))
    # 공통 어휘 사전으로 한국어화 (없으면 원문 유지)
    op["birthplace"] = BIRTH_CN2KR.get(op["birthplace"], op["birthplace"])
    op["race"] = RACE_CN2KR.get(op["race"], op["race"])
    op["combatTags"] = [TAG_CN2KR.get(t, t) for t in op["combatTags"]]
    op["unreleased"] = True
    result.append(op)
    unreleased_count += 1
print("unreleased (CN-only) ops:", unreleased_count,
      "| dict sizes birth/race/tag:", len(BIRTH_CN2KR), len(RACE_CN2KR), len(TAG_CN2KR))

# 동명 중복 정리 (사용자 확정 2026-07): 같은 이름이 여럿이면 입수 가능 버전 우선,
# 전부 입수 불가면 먼저 나온(char 번호 낮은) 쪽만 남긴다 — 샬렘은 진짜(char_4025)만,
# 예비 인원 3성/4성 쌍은 3성(r시리즈)만. 이름 안 겹치는 입수 불가 유닛은 그대로 둔다.
def char_no(cid):
    try: return int(cid.split("_")[1])
    except (IndexError, ValueError): return 10**9
by_name = {}
for o in result: by_name.setdefault(o["name"], []).append(o)
deduped = []
for name, group in by_name.items():
    group.sort(key=lambda o: (bool(chars.get(o["id"], {}).get("isNotObtainable")), char_no(o["id"])))
    if len(group) > 1:
        print("dedup:", name, "→ keep", group[0]["id"], "drop", [g["id"] for g in group[1:]])
    deduped.append(group[0])
result = deduped

# stable order: rarity asc, then name (matches deployed robots-first look)
result.sort(key=lambda o: (o["rarity"], o["name"]))
json.dump(result, open(f"{S}/operators-regen.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("regenerated:", len(result))
print("unknown power ids:", sorted(unknown_powers))
new = [o for o in result if o["id"] not in old_ops]
print("new ops:", len(new))
missing_reason = [o["name"] for o in result if not o["reason"]]
print("missing reason:", missing_reason[:10])
