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

# ── 미실장(CN 선행) 오퍼 지원: CN building_data 폴백 + 설명 한국어화 ──────────────
# 미실장 오퍼는 KR building_data에 없으므로 CN 테이블에서 buffChar를 읽되, 파서가
# 한국어 정규식이라 설명을 먼저 한국어로 바꾼다: ① 양쪽에 다 있는 buffId를 조인한
# CN→KR 자동 사전(정형 문구 = 공식 번역), ② scripts/cn-translations.json 수동
# 오버레이(비공식 AI 번역, regen-operators.py와 같은 파일·같은 strip_tags 렌더링 키).
# 번역이 없으면 원문 유지 + 경고 — 파서가 못 읽으므로 스킬 수치가 0으로 잡힌다.
cn_building = load(f"{S}/cn_building_data.json")
MANUAL_PATH = f"{REPO}/scripts/cn-translations.json"
MANUAL = load(MANUAL_PATH) if os.path.exists(MANUAL_PATH) else {}

ROOM_KO = {"MANUFACTURE": "제조소", "TRADING": "무역소", "POWER": "발전소", "WORKSHOP": "가공소",
           "DORMITORY": "숙소", "MEETING": "응접실", "HIRE": "사무실", "TRAINING": "훈련실",
           "CONTROL": "제어 센터"}
KO_ROOM = {v: k for k, v in ROOM_KO.items()}  # 한글 방이름 → 방 종류 (교차방 파트너 조건 파싱용)

def strip_tags(s):
    if not s: return ""
    s = re.sub(r"<[@$/][^>]*>", "", s).replace("</>", "")
    s = re.sub(r"<[a-zA-Z][^>]*>", "", s)
    return re.sub(r"\s+", " ", s).strip()

# CN→KR 버프 텍스트 사전: 같은 buffId가 양 서버에 있으면 렌더링(strip_tags) 기준으로 짝짓기
CJK_RE = re.compile(r"[㐀-鿿]")
_kr_buffs = building.get("buffs") or {}
_cn_buffs = cn_building.get("buffs") or {}
CN2KR_BUFF = {}
for _bid, _cb in _cn_buffs.items():
    _kb = _kr_buffs.get(_bid)
    if not _kb: continue
    for _field in ("description", "buffName"):
        _c, _k = strip_tags(_cb.get(_field)), strip_tags(_kb.get(_field))
        if _c and _k and _c != _k and CJK_RE.search(_c):
            CN2KR_BUFF.setdefault(_c, _k)
untranslated_buffs = []
def tr_buff(text, ctx):
    if not text or not CJK_RE.search(text): return text
    t = (MANUAL.get(text) or {}).get("ko") or CN2KR_BUFF.get(text)
    if t: return t
    untranslated_buffs.append({"ctx": ctx, "cn": text})
    return text

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
name_to_id = {}
for cid, c in chars.items():
    if cid.startswith("char_"): name_to_id.setdefault(c["name"], cid)
# 미실장 오퍼도 파트너 탐지 대상 — 표시명(영문 코드네임)과 별칭(한글 통칭·중문 원명)을 등록.
# 번역된 버프 텍스트가 "클로저"·"타마미츠네 오키드" 같은 한글 통칭으로 미실장 오퍼를 언급한다
for o in operators:
    if not o.get("unreleased"): continue
    for n in [o["name"], *(o.get("aliases") or [])]:
        if n and len(n) >= 2: name_to_id.setdefault(n, o["id"])
names = sorted(name_to_id.keys(), key=len, reverse=True)

# matches "+30%" and "30% 상승" / "30% 추가 상승"
PCT = r"(?:\+\s*(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%(?:\s*추가)?\s*상승)"

# 만트라 "정예 오퍼레이터가 배치된 시설 1개당 +2% (최대 10개)" — 게임 상한은 10이지만
# 실존 정예 오퍼 수만큼만 시설을 채울 수 있다 (현재 6명 → +12%). 신규 정예 오퍼가
# 추가되면 파이프라인 재생성 시 자동으로 반영된다 (사용자 확정)
ELITE_TEAM = "로도스 아일랜드-정예 오퍼레이터"
elite_count = sum(1 for o in operators if ELITE_TEAM in (o.get("factions") or []))

# "X 오퍼레이터가 배치된 시설 1개당 +v% (최대 c개)" 시설 카운트 절 — 만트라(정예)뿐
# 아니라 타락사쿰(쉐이) 같은 진영 조건도 지원. 게임 상한(c)과 실존 오퍼 수 중 작은 쪽.
# 절을 떼어낸 텍스트를 함께 돌려줘 기본치 파싱이 이 절의 %를 이중 계상하지 않게 한다.
# ⚠ 토큰은 화이트리스트 alternation으로만 잡는다 — 자유 캡처는 leftmost 매칭이
# "내 정예" 같은 조사구를 물어 카운트가 0이 되는 회귀를 냈다 (2026-07).
# 실제 정의는 FACTION_NAMES 확정 후(아래) — 호출은 parse_skill 시점이라 문제없다.
def facility_clause(text):
    m = FAC_RE.search(text)
    if not m: return 0.0, text
    token = m.group(1)
    per, cap = float(m.group(2)), float(m.group(3))
    if token == "정예":
        count = elite_count
    else:  # 진영명 토큰 — 정확 일치 또는 하이픈 꼬리 일치(쉐이 = 염-쉐이)
        count = sum(1 for o in operators
                    if any(token == f or f.split("-")[-1] == token for f in (o.get("factions") or [])))
    return per * min(cap, count), text[:m.start()] + text[m.end():]

# 자기 컨디션 낙차(소진)로 생산력이 변하는 오퍼(토터)의 대표 운용 낙차.
# 만컨디션(낙차 0)이 아니라 12h 교대 평균 기준 — 컨디션 9~12 구간 (사용자 제보 2026-07)
DROP_ASSUMED = 12

def parse_metric(room, text):
    """Return (kind, value) — the op's headline contribution in this room."""
    def best(pattern, src=None):
        vals = []
        for m in re.finditer(pattern, src if src is not None else text):
            g = [g for g in m.groups() if g]
            if g: vals.append(float(g[-1]))
        return max(vals) if vals else None
    if room == "MANUFACTURE":
        # automation (위디·유넥티스·윈드플릿·패신저): zeroes operator-provided
        # efficiency, scales with power-plant count (3 in the 243 layout)
        m = re.search(r"생산력이 전부 0이 되고[^%]*?발전소 하나당[^+%\d]{0,20}\+\s*(\d+(?:\.\d+)?)\s*%", text)
        if m: return "automation", float(m.group(1))  # per plant; planner multiplies
        # automation_crew (스네구로치카): same zero-out, but scales with the
        # room's own headcount instead of power plants
        m = re.search(r"생산력이 전부 0이 되고[^%]*?제조소 내의 오퍼레이터 1명당[^+%\d]{0,20}\+\s*(\d+(?:\.\d+)?)\s*%", text)
        if m: return "automation_crew", float(m.group(1))  # per teammate in room; planner multiplies
        v = best(r"생산력[^+%\d]{0,24}" + PCT)
        if v: return "output", v
    if room == "TRADING":
        m = re.search(r"자신을 제외한 작업 중인 오퍼레이터 1명당[^+%\d]{0,20}\+\s*(\d+(?:\.\d+)?)\s*%", text)
        if m: return "percoworker", float(m.group(1))
        # 시설 카운트 절(만트라 정예 / 타락사쿰 쉐이)을 먼저 떼어 기본치와 분리 계상
        fac_add, fac_text = facility_clause(text)
        v = best(r"(?:오더 수주 효율|주문 획득 효율)[^+%\d]{0,24}" + PCT, fac_text)
        if v or fac_add:
            # 응접실 레벨 성장형 (비질·미틈): "응접실 레벨 1레벨당 추가로 5% 제공,
            # 최대 40% 제공" → 응접실은 만렙(Lv3) 기준이므로 상한 채택
            grow = re.search(r"응접실 레벨 ?1?(?:레벨)?당 추가로 수주 효율 (\d+(?:\.\d+)?)% 제공", fac_text)
            if grow and v is not None:
                cap = re.search(r"최대 \+?(\d+(?:\.\d+)?)% 제공", fac_text)
                v = float(cap.group(1)) if cap else v + float(grow.group(1)) * 3
            return "output", (v or 0) + fac_add
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
        # 성장형 상한 채택: "드론 상한 10당 +1% (최대 +25%)" → 25 고정 (이격그레이 점검 매뉴얼, 사용자 확정)
        cap = re.search(r"최대 \+?(\d+(?:\.\d+)?)%", text)
        if v and cap: v = max(v, float(cap.group(1)))
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
        fac_add, fac_text = facility_clause(text)  # 켈시 '테라의 방주': 정예 시설 1개당 +4% (최대 5개)
        v = best(r"(?:인맥 레퍼런스|연락).{0,16}(?:누적 |획득 )?속도[^+%\d]{0,18}" + PCT, fac_text)
        if v or fac_add: return "output", (v or 0) + fac_add
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
        v_mfg = best(r"제조소의 생산력[^+%\d]{0,10}" + PCT)
        # "무역소의 …" 뿐 아니라 "무역소 내 <진영> 1명당 … 오더 수주 효율"(야하타 우미리)도 무역소 오라로 인식
        v_trd = best(r"무역소[^.]{0,40}?오더 수주 효율[^+%\d]{0,10}" + PCT)
        if v_mfg and v_trd:
            # 배타 조건 분기 (왕 권변: "외세≥실리면 무역 +7% / 실리>외세면 제조 +2%") —
            # 성장형 상한 채택과 같은 관례로 유리한 분기를 가정해 큰 쪽을 채택
            return ("ctrl_trade", v_trd) if v_trd >= v_mfg else ("ctrl_mfg", v_mfg)
        if v_mfg: return "ctrl_mfg", v_mfg
        if v_trd: return "ctrl_trade", v_trd
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
            # 자기 컨디션이 낮을 때만("미만/이하") 생성되는 배타 브랜치(시·링)는 풀파워 A조
            # 기준에선 비활성 — 같은 오퍼가 화식·감지를 동시에 내는 이중계상 방지.
            # 컨디션 높을 때("초과/이상") 브랜치만 남긴다.
            before = text[max(0, m.start() - 30):m.start()]
            if "컨디션" in before and ("미만" in before or "이하" in before):
                continue
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
                # 사무실 4슬롯. "초기 모집 인원은 포함하지 않음"(멀베리)이면 초기 2명 제외 = 2
                # (사용자 확정 2026-07: 20점이 정배, 40점은 과다)
                amount *= 2 if re.search(r"초기 모집 인원", text) else 4
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

# 오퍼 이름이 진영 이름의 접두어인 경우("쉐라" ⊂ "쉐라그") 진영 언급을 파트너로
# 오인하지 않도록, 매치 지점이 더 긴 진영명으로 시작하면 무시한다
FACTION_NAMES = sorted({f for o in operators for f in (o.get("factions") or []) if f}, key=len, reverse=True)

# facility_clause용 토큰 화이트리스트: 정예 + 진영명 + 하이픈 꼬리("염-쉐이"→"쉐이")
_fac_tokens = {"정예"} | set(FACTION_NAMES) | {f.split("-")[-1] for f in FACTION_NAMES if "-" in f}
FAC_RE = re.compile(r"(" + "|".join(re.escape(t) for t in sorted(_fac_tokens, key=len, reverse=True))
                    + r") 오퍼레이터가 배치된 시설 1개당[^%]*?\+\s*(\d+(?:\.\d+)?)\s*%[^(]{0,10}\(최대 (\d+)개\)")

def find_partners(text, self_name, self_id=None):
    found = []
    scan = text
    for n in names:
        # 자기 자신 언급 제외 — 미실장 오퍼는 표시명(영문)과 텍스트 속 한글 통칭이 달라
        # 이름 비교만으론 못 거르므로 id로도 거른다 (클로저 '특별 오더' 자기 언급 등)
        if n == self_name or len(n) < 2 or (self_id and name_to_id.get(n) == self_id): continue
        # avoid substring hits inside other words (e.g. '레이' in '오퍼레이터'):
        # the name must not be glued to a preceding Hangul syllable
        for m in re.finditer(r"(?<![가-힣])" + re.escape(n), scan):
            at = m.start()
            if any(len(f) > len(n) and scan.startswith(f, at) for f in FACTION_NAMES):
                continue  # 진영명("쉐라그 오퍼레이터…")이지 오퍼 언급이 아니다
            found.append(name_to_id[n])
            scan = scan.replace(n, "§")
            break
    return found

# KR release order: handbook entries append in release order (robots/reserves
# without a handbook entry sink to the bottom)
handbook = load(f"{S}/kr_handbook_info_table.json")
handbook = handbook.get("handbookDict", handbook)
release_seq = {cid: i for i, cid in enumerate(handbook.keys())}

def parse_skill(entry, oname, oid=None):
        room = entry["room"]
        if room not in ROOM_KO: return None
        text = entry["description"]
        # "모든 숙소의 레벨 1당 +N%" (아르케토·틴맨·나란투야·필라에): 숙소 4개 ×
        # Lv5 = 20레벨 기준 상한 — 절을 떼고 기본치를 파싱한 뒤 ×20을 더한다
        dorm_lvl = re.search(r"모든 숙소의 레벨 ?1당[^%+]*\+\s*(\d+(?:\.\d+)?)\s*%", text)
        metric_text = text[:dorm_lvl.start()] + text[dorm_lvl.end():] if dorm_lvl else text
        kind, value = parse_metric(room, metric_text)
        if dorm_lvl and kind in ("output", "misc"):
            kind, value = "output", (value or 0) + float(dorm_lvl.group(1)) * 20
        # 자기 컨디션 낙차 페널티·게이트 (토터 흐려진 시야/창밖 눈보라): 만컨디션 최대치가
        # 아니라 대표 운용 낙차(DROP_ASSUMED)에서의 실효율로 보정 — 40% 고정 표기 방지
        if kind in ("output", "misc") and value:
            gate = re.search(r"컨디션 낙차(?:가)? ?(\d+) 이상일 경우", text)
            if gate and DROP_ASSUMED < int(gate.group(1)):
                value = 0
            pen = re.search(r"컨디션 낙차 ?(\d+)당 생산력 -\s*(\d+(?:\.\d+)?)\s*%", text)
            if pen:
                value = max(0, value - (DROP_ASSUMED // int(pen.group(1))) * float(pen.group(2)))
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
        # 알려진 진영명 우선(길이 내림차순) — 공백 포함 진영("우르수스 학생자치단")이
        # 자유 캡처에서 '학생자치단'으로 잘리는 것을 방지. 플래너는 factions 정확 일치 게이트
        for f in FACTION_NAMES:
            if re.search(re.escape(f) + r" 오퍼레이터와 함께", text):
                req_faction = f
                break
        if not req_faction:
            m = re.search(r"([가-힣A-Za-z·]{2,14}) 오퍼레이터와 함께", text)
            if m: req_faction = m.group(1)
        per_faction = per_scope = per_cap = None
        # "<진영> 오퍼레이터(최대 N명)? 1명당/1명 증가할 때마다" — 진영명을 알려진 진영으로
        # 한정 매칭한다(공백 포함 '라인 랩'도, '제조소 내의'·'숙소 내' 같은 방 범위 조사구는
        # 진영이 아니므로 자연히 제외). 오퍼레이터와 "1명당" 사이 "(최대 N명)"은 개수 상한(내스티)
        for f in FACTION_NAMES:
            fm = re.search(re.escape(f) + r" 오퍼레이터(?:가)?(?:\(최대 (\d+)명\))? ?1명(?:당| 증가할 때마다)", text)
            if not fm: continue
            per_faction = f
            # 방 범위: 자기 방 안의 진영 동료만 센다. "제어 센터 내"(블리츠 등)뿐 아니라
            # 자기가 생산방에 앉아 "함께 배치된 …"·"해당 무역소/제조소/발전소 내 … 1명당"으로
            # 세는 오라(엑시아 뉴커버넌트·모건·팽 알터)도 방 범위. "기반시설 내 배치된"(바르카리스·
            # 아몬드 등)이나 제어에서 "무역소 내 …"를 세는 원격 오라(야하타)는 base 유지.
            per_scope = "room" if re.search(r"제어 센터 내|함께 배치(?:되어 있는|된)|해당 (?:무역소|제조소|발전소) 내", text) else "base"
            cnt_cap = fm.group(1)  # "(최대 N명)" = 개수 상한 → 퍼센트 상한 등가로 변환 (3%×5명 = 15%)
            if cnt_cap and value:
                per_cap = value * float(cnt_cap)
            else:
                c = re.search(r"최대 \+?(\d+(?:\.\d+)?)%", text)
                per_cap = float(c.group(1)) if c else None
            break
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
        # 임계값 미만 조건 (사일라흐 감화력: "인맥 레퍼런스 누적 속도가 30% 미만인
        # 경우(기본 5% 포함) 추가로 +20%") — 대상 방의 현재 수치가 임계값 미만일
        # 때만 발동. 오퍼별 특례가 아니라 같은 문구를 가진 모든 오퍼에 적용된다
        below_threshold = None
        bt = re.search(r"(\d+(?:\.\d+)?)% 미만인 경우.{0,60}?추가로 \+?\s*\d", text)
        if bt:
            below_threshold = float(bt.group(1))
        # 조건부 진영 인원 게이트 (실버애쉬 더 레인프로스트: "쉐라그 오퍼레이터가
        # 3명 배치된 무역소의 오더 수주 효율 +10%") — 같은 방 동반이 아니라
        # 진영 N명 배치 조건. 플래너는 교대 기준 기지 전체 인원수로 근사한다
        gate_faction = gate_count = None
        gm = re.search(r"([가-힣A-Za-z· ]{2,16}?) 오퍼레이터가 (\d+)명 배치된 (?:무역소|제조소|발전소)", text)
        if gm:
            gate_faction, gate_count = gm.group(1).strip(), int(gm.group(2))
        # 작업 플랫폼(1성 로봇) 발전소 배치 조건 (푸딩 오버클럭: "2대 이상의 작업 플랫폼이
        # 발전소에 배치된 경우 …") — 자동편성은 로봇을 발전소에 넣지 않으므로 이 오라는
        # 사실상 발동하지 않는다. 플래너가 미충족으로 보고 오라를 계상하지 않게 표시
        gp = re.search(r"(\d+)대 이상의 작업 플랫폼이 발전소에 배치된 경우", text)
        gate_platforms = int(gp.group(1)) if gp else None
        # 공사용 로봇 세트 (미니멀리스트): 생성 스킬이 "시설 레벨당 +1대 (최대 64대)",
        # 소비 스킬이 "로봇 8대당 생산력 +5%" — 만렙 기지 상한(64대) 기준으로 결합
        robo_cap = re.search(r"공사용 로봇[^%]*?최대 (\d+)대", text)
        robo_use = re.search(r"공사용 로봇 (\d+)대당[^%+\d]{0,16}\+?\s*(\d+(?:\.\d+)?)\s*%", text)
        # 기반시설 어디든 존재 조건 (언더플로우: "울피아누스가 기반시설에 있으면
        # 추가로 +10%") — 같은 방 동반(partners)이 아니라 기지 전체 존재 조건.
        # partners로 오인하면 기본 효율까지 통째로 게이트돼 버린다
        base_partner_ids = []
        base_partner_bonus = None
        bp = re.search(r"([가-힣A-Za-z0-9·' ]{2,20}?)(?:이|가) 기반시설[^%]*?있으면[^%]*?추가로 \+?\s*(\d+(?:\.\d+)?)\s*%", text)
        if bp and bp.group(1).strip() in name_to_id:
            base_partner_ids = [name_to_id[bp.group(1).strip()]]
            base_partner_bonus = float(bp.group(2))
        # 교차방 파트너 조건 (레토 환난지교: "만약 굼이 무역소에 배치되어 있다면 +35%") —
        # 특정 오퍼가 특정 방 종류에 배치돼야 스킬 발동. 같은 방 동반도 기지 존재도 아님.
        # 방 순서상 그리디 1차엔 판정 불가 → 플래너가 낙관 배치 후 리페어 패스에서 엄격 검증
        room_partner = None
        rp = re.search(r"만약 ([가-힣A-Za-z0-9·' ]{1,20}?)(?:이|가) (제조소|무역소|발전소|응접실|사무실|가공소|훈련실|제어 센터|숙소)에 배치(?:되어 있|돼 있)다면", text)
        if rp and rp.group(1).strip() in name_to_id:
            room_partner = {"id": name_to_id[rp.group(1).strip()], "room": KO_ROOM[rp.group(2)]}
        # buffChar slots already resolved upgrades — every line here stacks
        tier = 1
        group = entry["name"]
        return {
            "buffId": entry["buffId"],  # 다국어 오버레이(build-i18n.py) 매핑 키
            "name": entry["name"], "room": room, "unlock": entry["unlock"],
            "description": text, "kind": kind, "value": value, "product": product,
            "group": group, "tier": tier,
            "moraleDrain": parse_morale_drain(text),
            # 교차방 파트너(roomPartner)·기지 존재 파트너(basePartners)는 같은 방 동반 조건이
            # 아니므로 partners에서 제외 — 이중 게이트 방지 (레토는 '굼'이 1글자라 우연히 회피)
            "partners": [p for p in find_partners(text, oname, oid)
                         if p not in base_partner_ids and not (room_partner and p == room_partner["id"])],
            "basePartners": base_partner_ids, "basePartnerBonus": base_partner_bonus,
            "gateFaction": gate_faction, "gateCount": gate_count,
            "gatePlatforms": gate_platforms, "roomPartner": room_partner,
            "belowThreshold": below_threshold,
            "_roboCap": int(robo_cap.group(1)) if robo_cap else None,
            "_roboUse": (float(robo_use.group(1)), float(robo_use.group(2))) if robo_use else None,
            "tokenGen": gen, "tokenUse": use, "convert": convert,
            "reqFaction": req_faction, "perFaction": per_faction, "perScope": per_scope, "perCap": per_cap,
            "facilityBased": facility_based,
            "perSkillTag": per_skill_tag, "perSkillValue": per_skill_value,
            "_stackGrant": stack_grant.group(1) if stack_grant else None,
            "_stackCount": 5 * (int(stack_grant.group(2)) if stack_grant and stack_grant.group(2) else 1) if stack_grant else 0,
            "_stackConv": {"name": stack_conv.group(1), "per": float(stack_conv.group(2)), "token": stack_conv.group(3), "amount": float(stack_conv.group(4))} if stack_conv else None,
        }


infra_ops = []
for o in operators:
    skills = []
    # 미실장 오퍼는 KR building_data에 없음 → CN 테이블 폴백 + 설명·이름 한국어화
    src = building
    is_unrel = bool(o.get("unreleased"))
    slots_b = ((building.get("chars") or {}).get(o["id"]) or {}).get("buffChar") or []
    if not slots_b and is_unrel:
        src = cn_building
        slots_b = ((cn_building.get("chars") or {}).get(o["id"]) or {}).get("buffChar") or []
    for slot in slots_b:
        data = slot.get("buffData") or []
        if not data: continue
        # 슬롯의 모든 정예화 단계를 만든다 (data[-1] = 최종). 최종만 활성이지만, 하위 단계는
        # 정예화를 낮췄을 때(withElite) 대체본으로 쓰이도록 최종 스킬의 tiers에 보존한다
        tier_entries = []
        for bd in data:
            bf = (src.get("buffs") or {}).get(bd["buffId"])
            if not bf: continue
            cond = bd.get("cond") or {}
            ph = cond.get("phase", 0)
            ph = ph if isinstance(ph, int) else int(str(ph).replace("PHASE_", ""))
            unlock = f"Lv.{cond.get('level', 1)}" if ph == 0 else f"정예화 {ph}"
            name = strip_tags(bf.get("buffName"))
            desc = strip_tags(bf.get("description"))
            if is_unrel:
                name = tr_buff(name, f"{o['name']}·buffName")
                desc = tr_buff(desc, f"{o['name']}·description")
            tier_entries.append({"buffId": bd["buffId"], "name": name, "room": bf.get("roomType"),
                                 "unlock": unlock, "description": desc})
        if not tier_entries: continue
        main = parse_skill(tier_entries[-1], o["name"], o["id"])
        if main is None: continue
        lowers = [s for s in (parse_skill(e, o["name"], o["id"]) for e in tier_entries[:-1]) if s is not None]
        if lowers: main["tiers"] = lowers
        skills.append(main)
    # dorm stack systems: one skill grants stacks per dorm level, a sibling
    # converts stacks into a token → net token generation for this op
    grants = {sk["_stackGrant"]: sk["_stackCount"] for sk in skills if sk["_stackGrant"]}
    for sk in skills:
        sc = sk["_stackConv"]
        if sc and sc["name"] in grants:
            sk["tokenGen"].append({"token": sc["token"], "estimate": grants[sc["name"]] / sc["per"] * sc["amount"]})
    # 공사용 로봇 세트 결합 (미니멀리스트): 형제 스킬의 로봇 상한 × 소비 스킬 배율
    robo_caps = [sk["_roboCap"] for sk in skills if sk["_roboCap"]]
    for sk in skills:
        if sk["_roboUse"] and robo_caps:
            per, val = sk["_roboUse"]
            sk["kind"], sk["value"] = "output", robo_caps[0] / per * val  # 64/8×5 = +40%
    for sk in skills:
        for s in [sk, *sk.get("tiers", [])]:  # 하위 tier의 임시 필드도 함께 정리
            for k in ("_stackGrant", "_stackCount", "_stackConv", "_roboCap", "_roboUse"):
                s.pop(k, None)
    if skills:
        entry = {"id": o["id"], "name": o["name"], "rarity": o["rarity"],
                 # 직군 계열 — 보유 오퍼 설정(RosterModal) 정렬용 (백과사전 SORT_KEYS와 동일).
                 # jobCode는 로케일 무관 정렬 순서, subProfession·birthplace·race는 KR 문자열 정렬.
                 "job": o["job"], "jobCode": o["jobCode"], "subProfession": o["subProfession"],
                 "birthplace": o.get("birthplace", ""), "race": o.get("race", ""),
                 "faction": o["faction"],
                 # 다중 소속 (마터호른 = 카란 무역회사 + 쉐라그) — 진영 카운트·게이트는 전부 인정
                 "factions": o.get("factions") or [o["faction"]],
                 "accent": o["accent"], "image": o["image"],
                 # 미실장은 KR 핸드북에 없음 → operators.json의 seq(100000+CN 도감순) 사용
                 "seq": release_seq.get(o["id"], o.get("seq", -1)),
                 "skills": skills}
        if is_unrel: entry["unreleased"] = True
        infra_ops.append(entry)

# ── "~류" 스킬 패밀리 카탈로그 (사용자 확정 2026-07) ────────────────────────────────
# 도로시("라인테크류 스킬 1개당 +5%")처럼 특정 스킬 계열 수에 따라 스케일하는 오퍼가 있어,
# 어떤 스킬이 어느 계열(라인테크류·금속공예류 등)에 속하는지 미리 정리해 둔다.
# 계열 태그 = 스킬들이 실제로 참조하는 perSkillTag 값들의 집합. 각 스킬엔 자기가 속한 계열을
# families로 달고, 최상위 skillFamilies에 태그→오퍼명 목록을 정리해 스코어링·검수에 쓴다.
# 계열 판정은 부분 문자열이 아니라 **정확 명칭**: 스킬명이 "<태그>" 또는 "<태그> α/β/γ" 꼴일 때만
# (사용자 확정 2026-07: 표준화류 = 표준화 α/β 같은 스킬들. '비표준화'류 오포함 방지.
#  컨빅션 "작전기록류 생산력 +35%"의 '작전기록류'는 제품 분류라 스킬 계열이 아님)
family_tags = sorted({sk["perSkillTag"] for op in infra_ops for sk in op["skills"] if sk.get("perSkillTag")})
def in_family(name, tag):
    return bool(re.fullmatch(rf"{re.escape(tag)}\s*[^가-힣]{{0,2}}", (name or "").strip()))
skill_families = {tag: [] for tag in family_tags}
for op in infra_ops:
    for sk in op["skills"]:
        fams = [tag for tag in family_tags if in_family(sk.get("name"), tag)]
        if fams:
            sk["families"] = fams
            for tag in fams:
                if op["name"] not in skill_families[tag]:
                    skill_families[tag].append(op["name"])

out = {"rooms": rooms_out, "ops": infra_ops, "skillFamilies": skill_families}
json.dump(out, open(f"{REPO}/app/data/infra.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("skill families:", json.dumps({k: len(v) for k, v in skill_families.items()}, ensure_ascii=False))

# report
by_room = {}
partnered = 0
for op in infra_ops:
    for sk in op["skills"]:
        by_room[sk["room"]] = by_room.get(sk["room"], 0) + 1
        if sk["partners"]: partnered += 1
print("ops with infra skills:", len(infra_ops),
      f"({sum(1 for op in infra_ops if op.get('unreleased'))} unreleased)")
print("skills per room:", json.dumps(by_room, ensure_ascii=False))
print("skills naming partners:", partnered)
print("room specs:", json.dumps(rooms_out, ensure_ascii=False))
if untranslated_buffs:
    dedup = list({m["cn"]: m for m in untranslated_buffs}.values())
    print(f"UNTRANSLATED buff texts: {len(dedup)} — scripts/cn-translations.json에 채울 것 (파싱 수치 0으로 잡힘)",
          file=sys.stderr)
    for m in dedup: print(json.dumps(m, ensure_ascii=False), file=sys.stderr)
