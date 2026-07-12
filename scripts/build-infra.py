# Build app/data/infra.json — structured RIIC data for the base planner.
# Usage: python3 scripts/build-infra.py <gamedata-dir>
import json, os, re, sys

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

load = lambda p: json.load(open(p, encoding="utf-8"))
building = load(f"{S}/kr_building_data.json")
kr = load(f"{S}/kr_character_table.json"); chars = kr.get("chars", kr)
operators = load(f"{REPO}/app/data/operators.json")
ops_by_id = {o["id"]: o for o in operators}

ROOM_KO = {"MANUFACTURE": "제조소", "TRADING": "무역소", "POWER": "발전소", "WORKSHOP": "가공소",
           "DORMITORY": "숙소", "MEETING": "응접실", "HIRE": "사무실", "TRAINING": "훈련실",
           "CONTROL": "제어 센터"}

def strip_tags(s):
    if not s: return ""
    s = re.sub(r"<[@$/][^>]*>", "", s).replace("</>", "")
    s = re.sub(r"<[a-zA-Z][^>]*>", "", s)
    return re.sub(r"\s+", " ", s).strip()

# room specs at max level (phases[-1])
rooms_out = {}
for rid, room in (building.get("rooms") or {}).items():
    if rid not in ROOM_KO: continue
    ph = (room.get("phases") or [{}])[-1]
    rooms_out[rid] = {
        "name": ROOM_KO[rid],
        "slots": ph.get("maxStationedNum", 1),
        "electricity": ph.get("electricity", 0),
        "maxCount": room.get("maxCount", 1),
    }

# all KR operator names for partner detection (longest first so 스카디 doesn't
# swallow 스카디 더 커럽팅 하트)
names = sorted({c["name"] for cid, c in chars.items() if cid.startswith("char_")}, key=len, reverse=True)
name_to_id = {}
for cid, c in chars.items():
    if cid.startswith("char_"): name_to_id.setdefault(c["name"], cid)

# matches "+30%" and "30% 상승" / "30% 추가 상승"
PCT = r"(?:\+\s*(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%(?:\s*추가)?\s*상승)"

def parse_metric(room, text):
    """Return (kind, value) — the op's headline contribution in this room."""
    def best(pattern):
        vals = []
        for m in re.finditer(pattern, text):
            g = [g for g in m.groups() if g]
            if g: vals.append(float(g[-1]))
        return max(vals) if vals else None
    if room == "MANUFACTURE":
        # automation (위디·유넥티스): zeroes operator-provided efficiency,
        # scales with power-plant count (3 in the 243 layout)
        m = re.search(r"생산력이 전부 0이 되고[^%]*?발전소 하나당[^+%\d]{0,20}\+\s*(\d+(?:\.\d+)?)\s*%", text)
        if m: return "automation", float(m.group(1))  # per plant; planner multiplies
        v = best(r"생산력[^+%\d]{0,24}" + PCT)
        if v: return "output", v
    if room == "TRADING":
        m = re.search(r"자신을 제외한 작업 중인 오퍼레이터 1명당[^+%\d]{0,20}\+\s*(\d+(?:\.\d+)?)\s*%", text)
        if m: return "percoworker", float(m.group(1))
        v = best(r"(?:오더 수주 효율|주문 획득 효율)[^+%\d]{0,24}" + PCT)
        if v: return "output", v
        # order-quality effects, converted to a rough efficiency-equivalent %.
        # payout skills (테킬라 용문폐 보너스, 프로바이조 위약 배상) scale with
        # quality-probability crew in the same post — handled in the planner
        m = re.search(r"용문폐 수익 \+\s*(\d+)", text)
        if m: return "payout", round(float(m.group(1)) / 20)
        m = re.search(r"위약 오더인 경우, 순금 납품 수가 추가로 \+\s*(\d+)", text)
        if m: return "payout_v", float(m.group(1)) * 10  # violation-order loop (프로바이조)
        if re.search(r"고품질 귀금속 오더의 출현 확률이 상승", text): return "quality", 15
        if re.search(r"고품질 귀금속 오더의 출현 확률이 소폭 상승", text): return "quality", 10
        if re.search(r"오더 수주 상한|주문 상한|최대 주문", text): return "capacity", 0
    if room == "POWER":
        if re.search(r"발전소 \+1개로 간주", text): return "plantbonus", 1
        v = best(r"(?:무인기|드론)[^+%\d]{0,20}회복[^+%\d]{0,14}" + PCT)
        if v: return "output", v
    if room == "MEETING":
        v = best(r"단서 (?:수집|검색) 속도(?:가)?[^%\d]{0,16}" + PCT)
        cap = re.search(r"최대 (\d+(?:\.\d+)?)%까지", text)
        if cap: v = max(v or 0, float(cap.group(1)))
        if v:
            if re.search(r"자신만 업무 중", text): return "solo", v
            if re.search(r"단서 공유 상태에서", text): return "shared", v
            return "output", v
    if room == "HIRE":
        v = best(r"(?:인맥 레퍼런스|연락).{0,16}(?:누적 |획득 )?속도[^+%\d]{0,18}" + PCT)
        if v: return "output", v
    if room == "WORKSHOP":
        v = best(r"부산물[^%\d]{0,26}" + PCT)
        if v: return "output", v
    if room == "TRAINING":
        v = best(r"(?:훈련|특화)[^%\d]{0,22}속도[^%\d]{0,16}" + PCT)
        if v: return "output", v
    if room == "DORMITORY":
        m = re.findall(r"컨디션 회복[^+]{0,10}\+\s*(\d+(?:\.\d+)?)", text)
        if m: return "morale", max(float(x) for x in m)
    if room == "CONTROL":
        # facility-wide auras — only the highest of a kind applies per base,
        # ranked 제조소 > 무역소 > 인맥 레퍼런스 > 단서 by the planner
        v = best(r"제조소의 생산력[^+%\d]{0,10}" + PCT)
        if v: return "ctrl_mfg", v
        v = best(r"무역소의 오더 수주 효율[^+%\d]{0,10}" + PCT)
        if v: return "ctrl_trade", v
        v = best(r"인맥 레퍼런스[^%\d]{0,24}" + PCT)
        if v: return "ctrl_hire", v
        v = best(r"단서 수집 (?:속도|성향)[^%\d]{0,20}" + PCT)
        if v: return "ctrl_clue", v
        if re.search(r"단서 수집 성향 효과가 (소폭 )?상승", text): return "ctrl_clue", 5
        m = re.findall(r"컨디션 (?:회복|소모)[^+\-]{0,14}([+\-]\s*\d+(?:\.\d+)?)", text)
        if m: return "morale", max(float(x.replace(" ", "")) for x in m)
    # generic percent fallback
    v = best(PCT)
    if v: return "misc", v
    return "misc", 0

TOKENS = ["속세의 화식", "감지 정보", "무성의 공명", "생각의 사슬", "정보 저장", "주술 결정", "마물 요리"]

def parse_tokens(text, room):
    """Cross-facility point systems: generators (+N) and consumers (N점당 +V)."""
    gen, use = [], []
    for token in TOKENS:
        for m in re.finditer(re.escape(token) + r"\s*(\d+(?:\.\d+)?)(?:점|개)당[^%\d]{0,34}?([+\-]?\d+(?:\.\d+)?)\s*(%?)", text):
            per, val, pct = float(m.group(1)), float(m.group(2)), m.group(3) == "%"
            use.append({"token": token, "per": per, "value": val, "percent": pct})
        for m in re.finditer(re.escape(token) + r"\s*\+(\d+)", text):
            amount = float(m.group(1))
            per_member = None
            cap = re.search(r"1명당[^(]{0,40}\(최대 (\d+)명\)", text)
            per_dorm_member = re.search(r"숙소 (?:내|안)에? ?(?:배치된 )?오퍼레이터 1명당", text)
            if cap and "1명당" in text:
                base = amount
                amount *= float(cap.group(1))
                fm = re.search(r"배치된 ([가-힣]+) 오퍼레이터 1명당", text)
                if fm:
                    per_member = {"per": base, "cap": float(cap.group(1)), "match": fm.group(1)}
            elif per_dorm_member:
                # own dorm holds 5; a facility skill counting all dorms sees ~20
                amount *= 5 if room == "DORMITORY" else 20
            elif re.search(r"모집 인원마다", text):
                amount *= 4  # office holds up to 4 recruitment slots
            elif re.search(r"오퍼레이터가 1명 증가할 때마다", text):
                amount *= 4  # e.g. Ash: per teammate in the control center
            entry_gen = {"token": token, "estimate": amount}
            if per_member: entry_gen["perMember"] = per_member
            gen.append(entry_gen)
    # dorm level grants (센시: 숙소 레벨 1당 마물 요리 1개 제공 → Lv5 = 5개)
    for token in TOKENS:
        m = re.search(r"레벨(?: ?1)?당 " + re.escape(token) + r" ?(\d+)개", text)
        if m: gen.append({"token": token, "estimate": float(m.group(1)) * 5})
    # dorm stack systems (아이리스 꿈나라, 체르니 소절): Lv5 dorm grants 5 stacks
    stack = re.search(r"레벨(?: ?1)?당 ([가-힣]+) ?(\d*)스택", text)
    conv = re.search(r"([가-힣]+) (\d+)스택당 (" + "|".join(map(re.escape, TOKENS)) + r") (\d+)점으로 전환", text)
    return gen, use, stack, conv

def parse_morale_drain(text):
    m = re.findall(r"시간당 컨디션 소모[^+\-]{0,8}([+\-])\s*(\d+(?:\.\d+)?)", text)
    delta = 0.0
    for sign, val in m:
        delta += float(val) * (1 if sign == "+" else -1)
    return delta

def find_partners(text, self_name):
    found = []
    scan = text
    for n in names:
        if n == self_name or len(n) < 2: continue
        # avoid substring hits inside other words (e.g. '레이' in '오퍼레이터'):
        # the name must not be glued to a preceding Hangul syllable
        if re.search(r"(?<![가-힣])" + re.escape(n), scan):
            found.append(name_to_id[n])
            scan = scan.replace(n, "§")
    return found

infra_ops = []
for o in operators:
    skills = []
    raw = chars.get(o["id"], {})
    slots_b = ((building.get("chars") or {}).get(o["id"]) or {}).get("buffChar") or []
    slot_entries = []
    for slot in slots_b:
        data = slot.get("buffData") or []
        if not data: continue
        final = data[-1]  # highest unlock stage replaces the earlier ones
        bf = (building.get("buffs") or {}).get(final["buffId"])
        if not bf: continue
        cond = final.get("cond") or {}
        ph = cond.get("phase", 0)
        ph = ph if isinstance(ph, int) else int(str(ph).replace("PHASE_", ""))
        unlock = f"Lv.{cond.get('level', 1)}" if ph == 0 else f"정예화 {ph}"
        slot_entries.append({"name": bf.get("buffName"), "room": bf.get("roomType"),
                             "unlock": unlock, "description": strip_tags(bf.get("description"))})
    for entry in slot_entries:
        room = entry["room"]
        if room not in ROOM_KO: continue
        text = entry["description"]
        kind, value = parse_metric(room, text)
        override = re.search(r"효율이 전부 0이 되고[^+]{0,20}\+\s*(\d+(?:\.\d+)?)\s*%", text)
        if override:
            kind, value = "override", float(override.group(1))
        product = "any"
        if room == "MANUFACTURE":
            if re.search(r"순금|금괴|귀금속", text): product = "gold"
            elif re.search(r"작전 ?기록", text): product = "exp"
            elif "오리지늄" in text: product = "shard"
        gen, use, stack_grant, stack_conv = parse_tokens(text, room)
        # faction-conditional control skills: "용문근위국 오퍼레이터와 함께
        # 제어 센터에 배치 시" (gate) / "미노스 오퍼레이터 1명당 +v% (최대 c%)"
        req_faction = None
        m = re.search(r"([가-힣A-Za-z·]{2,14}) 오퍼레이터와 함께", text)
        if m: req_faction = m.group(1)
        per_faction = per_scope = per_cap = None
        m = re.search(r"([가-힣A-Za-z·]{2,14}) 오퍼레이터(?:가)? 1명(?:당| 증가할 때마다)", text)
        if m and m.group(1) not in ("작업 중인",):
            per_faction = m.group(1)
            per_scope = "room" if re.search(r"제어 센터 내", text) else "base"
            c = re.search(r"최대 \+?(\d+(?:\.\d+)?)%", text)
            per_cap = float(c.group(1)) if c else None
        # same-room skill-tag counting (브라이오피타: 금속 공예류 스킬 1개당 +5%)
        per_skill_tag = per_skill_value = None
        m = re.search(r"(?:해당 )?(?:제조소|무역소) 내 ([가-힣 ]{2,10}?)류? 스킬 1개당[^%\d]{0,20}\+\s*(\d+(?:\.\d+)?)\s*%", text)
        if m:
            per_skill_tag = m.group(1).replace(" ", "")
            per_skill_value = float(m.group(2))
        # facility-count multipliers (쏜즈: 각각의 무역소가 ... +3% → ×2);
        # these survive automation's zeroing ("시설 수량에 따라 제공" 예외)
        facility_based = False
        if kind in ("output", "misc") and value:
            fac = re.search(r"각각의 (무역소|발전소|제조소)", text)
            if fac:
                value = value * {"무역소": 2, "발전소": 3, "제조소": 4}[fac.group(1)]
                facility_based = True
        # conversion skills ("감지 정보 1점당 무성의 공명 1점으로 전환") re-route
        # this op's own generation and, at plan level, the shared pool
        convert = None
        conv = re.search(r"(" + "|".join(map(re.escape, TOKENS)) + r") (\d+(?:\.\d+)?)점당 (" + "|".join(map(re.escape, TOKENS)) + r") (\d+(?:\.\d+)?)점으로 전환", text)
        if conv:
            src, ratio_src, dst, ratio_dst = conv.group(1), float(conv.group(2)), conv.group(3), float(conv.group(4))
            convert = {"from": src, "per": ratio_src, "to": dst, "amount": ratio_dst}
        # buffChar slots already resolved upgrades — every line here stacks
        tier = 1
        group = entry["name"]
        skills.append({
            "name": entry["name"], "room": room, "unlock": entry["unlock"],
            "description": text, "kind": kind, "value": value, "product": product,
            "group": group, "tier": tier,
            "moraleDrain": parse_morale_drain(text),
            "partners": find_partners(text, o["name"]),
            "tokenGen": gen, "tokenUse": use, "convert": convert,
            "reqFaction": req_faction, "perFaction": per_faction, "perScope": per_scope, "perCap": per_cap,
            "facilityBased": facility_based,
            "perSkillTag": per_skill_tag, "perSkillValue": per_skill_value,
            "_stackGrant": stack_grant.group(1) if stack_grant else None,
            "_stackCount": 5 * (int(stack_grant.group(2)) if stack_grant and stack_grant.group(2) else 1) if stack_grant else 0,
            "_stackConv": {"name": stack_conv.group(1), "per": float(stack_conv.group(2)), "token": stack_conv.group(3), "amount": float(stack_conv.group(4))} if stack_conv else None,
        })
    # dorm stack systems: one skill grants stacks per dorm level, a sibling
    # converts stacks into a token → net token generation for this op
    grants = {sk["_stackGrant"]: sk["_stackCount"] for sk in skills if sk["_stackGrant"]}
    for sk in skills:
        sc = sk["_stackConv"]
        if sc and sc["name"] in grants:
            sk["tokenGen"].append({"token": sc["token"], "estimate": grants[sc["name"]] / sc["per"] * sc["amount"]})
    for sk in skills:
        sk.pop("_stackGrant", None); sk.pop("_stackCount", None); sk.pop("_stackConv", None)
    if skills:
        infra_ops.append({"id": o["id"], "name": o["name"], "rarity": o["rarity"],
                          "faction": o["faction"], "accent": o["accent"], "image": o["image"],
                          "skills": skills})

out = {"rooms": rooms_out, "ops": infra_ops}
json.dump(out, open(f"{REPO}/app/data/infra.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

# report
by_room = {}
partnered = 0
for op in infra_ops:
    for sk in op["skills"]:
        by_room[sk["room"]] = by_room.get(sk["room"], 0) + 1
        if sk["partners"]: partnered += 1
print("ops with infra skills:", len(infra_ops))
print("skills per room:", json.dumps(by_room, ensure_ascii=False))
print("skills naming partners:", partnered)
print("room specs:", json.dumps(rooms_out, ensure_ascii=False))
