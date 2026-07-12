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
        v = best(r"생산력[^+%]{0,24}" + PCT)
        if v: return "output", v
    if room == "TRADING":
        v = best(r"(?:오더 수주 효율|주문 획득 효율)[^+%]{0,24}" + PCT)
        if v: return "output", v
        # order-quality effects, converted to a rough efficiency-equivalent %
        m = re.search(r"용문폐 수익 \+\s*(\d+)", text)
        if m: return "quality", round(float(m.group(1)) / 20)
        if re.search(r"고품질 귀금속 오더의 출현 확률이 상승", text): return "quality", 15
        if re.search(r"고품질 귀금속 오더의 출현 확률이 소폭 상승", text): return "quality", 10
        if re.search(r"오더 수주 상한|주문 상한|최대 주문", text): return "capacity", 0
    if room == "POWER":
        v = best(r"(?:무인기|드론)[^+%]{0,20}회복[^+%]{0,14}" + PCT)
        if v: return "output", v
    if room == "MEETING":
        v = best(r"단서 (?:수집|검색) 속도(?:가)?[^%]{0,16}" + PCT)
        if v: return "output", v
    if room == "HIRE":
        v = best(r"(?:인맥 레퍼런스|연락).{0,16}(?:누적 |획득 )?속도[^+%]{0,18}" + PCT)
        if v: return "output", v
    if room == "WORKSHOP":
        v = best(r"부산물[^%]{0,26}" + PCT)
        if v: return "output", v
    if room == "TRAINING":
        v = best(r"(?:훈련|특화)[^%]{0,22}속도[^%]{0,16}" + PCT)
        if v: return "output", v
    if room == "DORMITORY":
        m = re.findall(r"컨디션 회복[^+]{0,10}\+\s*(\d+(?:\.\d+)?)", text)
        if m: return "morale", max(float(x) for x in m)
    if room == "CONTROL":
        m = re.findall(r"컨디션 (?:회복|소모)[^+\-]{0,14}([+\-]\s*\d+(?:\.\d+)?)", text)
        if m: return "morale", max(float(x.replace(" ", "")) for x in m)
        v = best(r"(?:획득 효율|수집 속도|누적 속도)[^+%]{0,18}" + PCT)
        if v: return "aura", v
    # generic percent fallback
    v = best(PCT)
    if v: return "misc", v
    return "misc", 0

TOKENS = ["속세의 화식", "감지 정보", "무성의 공명", "생각의 사슬", "정보 저장", "주술 결정"]

def parse_tokens(text):
    """Cross-facility point systems: generators (+N) and consumers (N점당 +V)."""
    gen, use = [], []
    for token in TOKENS:
        for m in re.finditer(re.escape(token) + r"\s*(\d+(?:\.\d+)?)점당[^%\d]{0,34}?([+\-]?\d+(?:\.\d+)?)\s*(%?)", text):
            per, val, pct = float(m.group(1)), float(m.group(2)), m.group(3) == "%"
            use.append({"token": token, "per": per, "value": val, "percent": pct})
        for m in re.finditer(re.escape(token) + r"\s*\+(\d+)", text):
            amount = float(m.group(1))
            cap = re.search(r"1명당[^(]{0,40}\(최대 (\d+)명\)", text)
            if cap and "1명당" in text:
                amount *= float(cap.group(1))
            elif re.search(r"숙소 내 오퍼레이터 1명당", text):
                amount *= 20
            elif re.search(r"모집 인원마다", text):
                amount *= 4  # office holds up to 4 recruitment slots
            gen.append({"token": token, "estimate": amount})
    return gen, use

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
    for entry in o.get("infrastructure") or []:
        room = next((k for k, v in ROOM_KO.items() if v == entry["room"]), entry["room"])
        text = entry["description"]
        kind, value = parse_metric(room, text)
        override = re.search(r"효율이 전부 0이 되고[^+]{0,20}\+\s*(\d+(?:\.\d+)?)\s*%", text)
        if override:
            kind, value = "override", float(override.group(1))
        product = "any"
        if room == "MANUFACTURE":
            if "금괴" in text: product = "gold"
            elif re.search(r"작전 ?기록", text): product = "exp"
            elif "오리지늄" in text: product = "shard"
        gen, use = parse_tokens(text)
        skills.append({
            "name": entry["name"], "room": room, "unlock": entry["unlock"],
            "description": text, "kind": kind, "value": value, "product": product,
            "moraleDrain": parse_morale_drain(text),
            "partners": find_partners(text, o["name"]),
            "tokenGen": gen, "tokenUse": use,
            "conditional": bool(re.search(r"함께 배치|같이 .{0,10}배치|1명당|마다|미만|이상일 (때|경우)|경우", text)),
        })
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
