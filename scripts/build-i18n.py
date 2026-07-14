# Build localized game data for the EN/JA site locales.
#
# Usage: python3 scripts/build-i18n.py <gamedata-dir>
# Needs (per locale, prefix en_/jp_): character_table, skill_table, uniequip_table,
#   battle_equip_table, building_data, handbook_team_table, handbook_info_table,
#   gacha_table — same scratch layout as regen-operators.py.
#
# Outputs:
#   app/data/operators.en.json / operators.ja.json
#     — full operator arrays with the SAME schema as operators.json. All display
#       text is localized; engine fields (id, rarity, jobCode, concepts, seq,
#       accent, image, stat numbers, range grids) are copied from the KR base so
#       filters/sort/deep links behave identically. concepts stay as KR keys and
#       are translated in the UI dictionary (app/i18n.tsx).
#   app/data/extra-i18n.en.json / extra-i18n.ja.json
#     — { names: {charId: name}, recruitTags: {tagId: name},
#         buffs: {buffId: {name, desc}}, rooms: {roomType: name} }
#       used by the infra planner / recruit helper display overlays (the engine
#       keeps running on the KR infra.json / recruit.json).
#
# Missing text falls back to the KR value — the site must never break because a
# locale table lags behind KR.
import json, os, re, sys

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

load = lambda p: json.load(open(p, encoding="utf-8"))
kr_ops = load(f"{REPO}/app/data/operators.json")
infra = load(f"{REPO}/app/data/infra.json")

# ─── shared text helpers (same rules as regen-operators.py) ───────────────────

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

def phase_no(p):
    return p if isinstance(p, int) else int(str(p).replace("PHASE_", ""))

# ─── locale constants ─────────────────────────────────────────────────────────

L = {
    "en": {
        "out": "en",
        "job": {"PIONEER": "Vanguard", "WARRIOR": "Guard", "TANK": "Defender", "SNIPER": "Sniper",
                "CASTER": "Caster", "MEDIC": "Medic", "SUPPORT": "Supporter", "SPECIAL": "Specialist"},
        "sp": {1: "Auto Recovery", 2: "Offensive Recovery", 4: "Defensive Recovery", 8: "Passive",
               "INCREASE_WITH_TIME": "Auto Recovery", "INCREASE_WHEN_ATTACK": "Offensive Recovery",
               "INCREASE_WHEN_TAKEN_DAMAGE": "Defensive Recovery", "UNCHANGED": "Passive"},
        "attr": {"max_hp": "HP", "atk": "ATK", "def": "DEF", "magic_resistance": "Arts Resist",
                 "attack_speed": "ASPD", "block_cnt": "Block", "cost": "DP Cost",
                 "respawn_time": "Redeploy Time"},
        "position": {"근거리": "Melee", "원거리": "Ranged"},
        "phase": lambda i: f"Elite {i}",
        "mod_unlock": lambda ph, lvl: f"Elite {ph} · Lv.{lvl}",
        "infra_unlock": lambda ph, lvl: f"Lv.{lvl}" if ph == 0 else f"Elite {ph}",
        "no_faction": "No Affiliation",
        "unknown": "Unknown",
        "birth_re": re.compile(r"\[Place of Birth\]\s*([^\n\[]+)"),
        "race_re": re.compile(r"\[Race\]\s*([^\n\[]+)"),
        "trait_fallback": lambda sub: f"Follows the base trait of the {sub} archetype.",
    },
    "jp": {
        "out": "ja",
        "job": {"PIONEER": "先鋒", "WARRIOR": "前衛", "TANK": "重装", "SNIPER": "狙撃",
                "CASTER": "術師", "MEDIC": "医療", "SUPPORT": "補助", "SPECIAL": "特殊"},
        "sp": {1: "自然回復", 2: "攻撃回復", 4: "被撃回復", 8: "パッシブ",
               "INCREASE_WITH_TIME": "自然回復", "INCREASE_WHEN_ATTACK": "攻撃回復",
               "INCREASE_WHEN_TAKEN_DAMAGE": "被撃回復", "UNCHANGED": "パッシブ"},
        "attr": {"max_hp": "最大HP", "atk": "攻撃力", "def": "防御力", "magic_resistance": "術耐性",
                 "attack_speed": "攻撃速度", "block_cnt": "ブロック数", "cost": "コスト",
                 "respawn_time": "再配置時間"},
        "position": {"근거리": "近距離", "원거리": "遠距離"},
        "phase": lambda i: f"昇進{i}",
        "mod_unlock": lambda ph, lvl: f"昇進{ph} · Lv.{lvl}",
        "infra_unlock": lambda ph, lvl: f"Lv.{lvl}" if ph == 0 else f"昇進{ph}",
        "no_faction": "所属なし",
        "unknown": "不明",
        "birth_re": re.compile(r"【出身地?】\s*([^\n【]+)"),
        "race_re": re.compile(r"【種族】\s*([^\n【]+)"),
        "trait_fallback": lambda sub: f"{sub}職分の基本特性に従う。",
    },
}

def build_locale(prefix):
    C = L[prefix]
    chars = load(f"{S}/{prefix}_character_table.json"); chars = chars.get("chars", chars)
    skill_table = load(f"{S}/{prefix}_skill_table.json"); skill_table = skill_table.get("skills", skill_table)
    uniequip = load(f"{S}/{prefix}_uniequip_table.json")
    battle_equip = load(f"{S}/{prefix}_battle_equip_table.json"); battle_equip = battle_equip.get("equips", battle_equip)
    building = load(f"{S}/{prefix}_building_data.json")
    team_table = load(f"{S}/{prefix}_handbook_team_table.json")
    handbook = load(f"{S}/{prefix}_handbook_info_table.json"); handbook = handbook.get("handbookDict", handbook)
    gacha = load(f"{S}/{prefix}_gacha_table.json")
    sub_dict = uniequip.get("subProfDict") or {}
    equip_dict = uniequip.get("equipDict") or {}
    room_names = {rid: (room.get("name") or rid) for rid, room in (building.get("rooms") or {}).items()}

    def sub_name(spid):
        e = sub_dict.get(spid)
        return (e.get("subProfessionName") if e else None) or spid

    def team_name(pid):
        if not pid: return None
        e = team_table.get(pid)
        return e.get("powerName") if e else None

    def factions_of(c):
        names = []
        for pid in [c.get("teamId"), c.get("groupId"), c.get("nationId")]:
            if not pid: continue
            n = team_name(pid)
            if n: names.append(n)
        seen = set(); out = []
        for n in names:
            if n not in seen: seen.add(n); out.append(n)
        return out or [C["no_faction"]]

    def build_handbook(cid):
        e = handbook.get(cid)
        birth = race = None
        if e:
            for sta in e.get("storyTextAudio") or []:
                for st in sta.get("stories") or []:
                    t = st.get("storyText", "")
                    m1 = C["birth_re"].search(t)
                    m2 = C["race_re"].search(t)
                    if m1 and not birth: birth = m1.group(1).strip()
                    if m2 and not race: race = m2.group(1).strip()
                if birth or race: break
        return birth or C["unknown"], race or C["unknown"]

    def build_trait(c):
        tr = c.get("trait")
        if tr and tr.get("candidates"):
            best = tr["candidates"][-1]
            txt = best.get("overrideDescripton") or c.get("description")
            return interpolate(txt, best.get("blackboard"))
        if c.get("description"):
            return strip_tags(c.get("description"))
        return C["trait_fallback"](sub_name(c.get("subProfessionId", "")))

    def build_skills(c, kr_skills):
        out = []
        kr_by_id = {s["id"]: s for s in kr_skills}
        for s in c.get("skills") or []:
            sid = s.get("skillId")
            if not sid or sid not in kr_by_id: continue
            base = dict(kr_by_id[sid])
            lv = (skill_table.get(sid) or {}).get("levels") or []
            if lv:
                lv = lv[-1]
                sp = lv.get("spData") or {}
                base["name"] = lv.get("name") or base["name"]
                base["spType"] = C["sp"].get(sp.get("spType"), base["spType"])
                desc = interpolate(lv.get("description"), lv.get("blackboard"))
                if desc: base["description"] = desc
            out.append(base)
        # keep KR order/entries even if a locale drops one (shouldn't happen)
        return out if len(out) == len(kr_skills) else kr_skills

    def build_talents(c, kr_talents):
        out = []
        for t in c.get("talents") or []:
            cands = [x for x in (t.get("candidates") or []) if not x.get("isHideTalent")]
            if not cands: continue
            best = cands[-1]
            if not best.get("name"): continue
            out.append({"name": best["name"],
                        "description": interpolate(best.get("description"), best.get("blackboard"))})
        return out if len(out) == len(kr_talents) else kr_talents

    def build_potentials(c, kr_pot):
        out = []
        for i, p in enumerate(c.get("potentialRanks") or []):
            out.append({"rank": i + 2, "description": strip_tags(p.get("description"))})
        return out if len(out) == len(kr_pot) else kr_pot

    def build_modules(cid, kr_modules):
        out = []
        for kr_mod in kr_modules:
            eid = kr_mod["id"]
            eq = equip_dict.get(eid)
            mod = dict(kr_mod)
            if eq:
                mod["name"] = eq.get("uniEquipName") or mod["name"]
                mod["unlock"] = C["mod_unlock"](phase_no(eq.get("unlockEvolvePhase", 0)), eq.get("unlockLevel", 1))
            be = battle_equip.get(eid)
            levels = []
            for idx, kr_level in enumerate(kr_mod.get("levels") or []):
                level = dict(kr_level)
                ph = ((be or {}).get("phases") or [None] * (idx + 1))[idx] if be and idx < len((be or {}).get("phases") or []) else None
                if ph:
                    stats_parts = []
                    for ab in ph.get("attributeBlackboard") or []:
                        k = C["attr"].get(ab.get("key"), ab.get("key"))
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
                    level["stats"] = " · ".join(stats_parts) or None
                    level["effects"] = dedup
                levels.append(level)
            mod["levels"] = levels
            out.append(mod)
        return out

    def build_infra_texts(cid, kr_infra):
        entry = (building.get("chars") or {}).get(cid)
        rows = []
        if entry:
            for bc in entry.get("buffChar") or []:
                for bd in bc.get("buffData") or []:
                    buff = (building.get("buffs") or {}).get(bd.get("buffId"))
                    if not buff: continue
                    cond = bd.get("cond") or {}
                    ph = phase_no(cond.get("phase", 0)); lvl = cond.get("level", 1)
                    rows.append({"name": buff.get("buffName"),
                                 "room": room_names.get(buff.get("roomType"), buff.get("roomType")),
                                 "unlock": C["infra_unlock"](ph, lvl),
                                 "description": strip_tags(buff.get("description"))})
        # KR infra rows are built by the exact same iteration → align by index
        return rows if len(rows) == len(kr_infra) else kr_infra

    ops_out = []
    names = {}
    for op in kr_ops:
        cid = op["id"]
        c = chars.get(cid)
        if not c:
            ops_out.append(op)  # locale table lags — keep KR entry wholesale
            names[cid] = op["name"]
            continue
        name = c.get("name") or op["name"]
        names[cid] = name
        birth, race = build_handbook(cid)
        factions = factions_of(c)
        aliases = [a for a in [op["name"], *op.get("aliases", [])] if a and a != name]
        seen = set(); aliases = [a for a in aliases if not (a in seen or seen.add(a))]
        tags = [t for t in (c.get("tagList") or []) if t and t.strip()]
        loc = {
            **op,
            "name": name,
            "job": C["job"].get(c.get("profession"), op["job"]),
            "subProfession": sub_name(c.get("subProfessionId")),
            "position": C["position"].get(op["position"], op["position"]),
            "combatTags": tags if len(tags) == len(op["combatTags"]) else op["combatTags"],
            "faction": factions[0],
            "factions": factions,
            "birthplace": birth,
            "race": race,
            "aliases": aliases,
            "reason": strip_tags(c.get("itemUsage")) or op.get("reason") or "",
            "trait": build_trait(c) or op["trait"],
            "talents": build_talents(c, op["talents"]),
            "stats": [{**s, "phase": C["phase"](i)} for i, s in enumerate(op["stats"])],
            "skills": build_skills(c, op["skills"]),
            "potentials": build_potentials(c, op["potentials"]),
            "modules": build_modules(cid, op["modules"]),
            "infrastructure": build_infra_texts(cid, op["infrastructure"]),
        }
        ops_out.append(loc)

    out_suffix = C["out"]
    json.dump(ops_out, open(f"{REPO}/app/data/operators.{out_suffix}.json", "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))

    # ── extra overlay: infra planner + recruit helper ──────────────────────────
    buffs_out = {}
    for iop in infra["ops"]:
        for sk in iop["skills"]:
            for s in [sk, *sk.get("tiers", [])]:  # 하위 정예화 단계(tiers)의 buffId도 오버레이에 포함
                bid = s.get("buffId")
                if not bid or bid in buffs_out: continue
                buff = (building.get("buffs") or {}).get(bid)
                if buff:
                    buffs_out[bid] = {"name": buff.get("buffName"), "desc": strip_tags(buff.get("description"))}
    recruit_tags = {str(t["tagId"]): t["tagName"] for t in gacha.get("gachaTags") or []}
    rooms_out = {rid: room_names.get(rid, rid) for rid in infra["rooms"].keys()}
    extra = {"names": names, "recruitTags": recruit_tags, "buffs": buffs_out, "rooms": rooms_out}
    json.dump(extra, open(f"{REPO}/app/data/extra-i18n.{out_suffix}.json", "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"{prefix}: {len(ops_out)} ops, {len(buffs_out)} infra buffs, {len(recruit_tags)} recruit tags → operators.{out_suffix}.json / extra-i18n.{out_suffix}.json")

for prefix in ("en", "jp"):
    build_locale(prefix)
