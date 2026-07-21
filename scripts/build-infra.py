# Build app/data/infra.json — structured RIIC data for the base planner.
# Usage: python3 scripts/build-infra.py <gamedata-dir>
import json, os, re, sys

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

load = lambda p: json.load(open(p, encoding="utf-8"))
building = load(f"{S}/kr_building_data.json")
kr = load(f"{S}/kr_character_table.json"); chars = kr.get("chars", kr)
operators = load(f"{REPO}/app/data/operators.json")

# ── 인프라 진영 카운트 교정 (사용자 확인 2026-07-21 + 인게임 크로스체크) ──────────────
# 게임 RIIC의 진영 그룹(<$cc.g.rh> 등)은 character_table의 groupId와 다르게, **스토리상
# 그 진영을 탈퇴한 이격 오퍼를 제외**한다. 뮤엘시스 "라인 랩 1명당" 등 진영 카운트 스킬이
# 대상. 근거: groupId=rhine 12명 중 인게임 라인 랩 명단(10명)에서 빠진 건 이격 2명뿐
# (사일런스 더 패러디그매틱·아스트젠 더 라이트체이서 — 둘 다 로도스로 이적). buffId가
# 리치텍스트 그룹 참조라 명단 파일이 따로 없어 여기 명시. **인프라 전용** — operators.json의
# 표시/프로필 진영은 groupId 그대로 두고(로어) infra.json 카운트에서만 뺀다. 새 이탈 이격이
# 나오면 여기 (id, 뺄 진영) 추가.
INFRA_FACTION_REMOVE = {
    "char_1031_slent2": {"라인 랩"},   # 사일런스 더 패러디그매틱
    "char_1047_halo2":  {"라인 랩"},   # 아스트젠 더 라이트체이서
}
for _o in operators:
    _rm = INFRA_FACTION_REMOVE.get(_o["id"])
    if _rm and _o.get("factions"):
        _o["factions"] = [f for f in _o["factions"] if f not in _rm]
        if _o.get("faction") in _rm:
            _o["faction"] = _o["factions"][0] if _o["factions"] else _o.get("faction")

ops_by_id = {o["id"]: o for o in operators}

# ── 지식 베이스(L2): app/data/rules.json — 파서 추정 상수·토큰 카탈로그·파싱 교정 ──
# 상수 튜닝·새 토큰 추가·오분류 교정은 코드가 아니라 rules.json을 고친다 (INFRA-RULES §8).
# 재생성 후 diff 없음 = 교정이 파서 정식 지원으로 흡수됐다는 뜻이므로 해당 override를 지운다.
RULES = load(f"{REPO}/app/data/rules.json")
P = RULES["parser"]
OVERRIDES = {k: v for k, v in (RULES.get("skillOverrides") or {}).items() if not k.startswith("_")}
applied_overrides = set()

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
DROP_ASSUMED = P["DROP_ASSUMED"]

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
        # 음수 생산력 (벌컨 장인정신 -5%, 베나 -20%) — 헤드라인이 음수라 PCT(+전용) 미포착.
        # 이 오퍼들의 진짜 값은 창고 용량(cap)이지만 생산력 페널티도 반영해야 한다
        vn = re.search(r"생산력[^+\-%\d]{0,24}-\s*(\d+(?:\.\d+)?)\s*%", text)
        if vn: return "output", -float(vn.group(1))
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
                v = float(cap.group(1)) if cap else v + float(grow.group(1)) * P["MEETING_LEVELS"]
            return "output", (v or 0) + fac_add
        # order-quality effects, converted to a rough efficiency-equivalent %.
        # payout skills (테킬라 용문폐 보너스, 프로바이조 위약 배상) scale with
        # quality-probability crew in the same post — handled in the planner
        m = re.search(r"용문폐 수익 \+\s*(\d+)", text)
        if m: return "payout", round(float(m.group(1)) / P["LMD_PER_PERCENT"])
        m = re.search(r"위약 오더인 경우, 순금 납품 수가 추가로 \+\s*(\d+)", text)
        if m: return "payout_v", float(m.group(1)) * P["VIOLATION_EQUIV_MULT"]  # violation-order loop (프로바이조)
        if re.search(r"고품질 귀금속 오더의 출현 확률이 상승", text): return "quality", P["QUALITY_MAJOR"]
        if re.search(r"고품질 귀금속 오더의 출현 확률이 소폭 상승", text): return "quality", P["QUALITY_MINOR"]
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
        # 제어센터→제조소 진영 카운트 오라: "제조소에 배치된 <진영> 오퍼레이터 1명당 생산력 +N%"
        # (플레임테일: 작전기록 +10/귀금속 -10 분기 · 제시카 이격: 블랙스틸 +5 — 종전엔 morale로
        # 오분류돼 오라 유실). **알려진 진영만** 매칭 — 비비아나 '기사 오퍼레이터'처럼 셀 수 없는
        # 그룹은 종전(misc 폴백) 유지. perFaction은 공통 파서가, 생산품별 부호는 perProduct가 채운다
        v_pm = best(MFG_FACTION_AURA_RE)
        if v_pm:
            return "ctrl_mfg", v_pm
        v_mfg = best(r"제조소의 생산력[^+%\d]{0,10}" + PCT)
        # "무역소의 …" 뿐 아니라 "무역소 내 <진영> 1명당 … 오더 수주 효율"(야하타 우미리)도 무역소 오라로 인식
        v_trd = best(r"무역소[^.]{0,40}?오더 수주 효율[^+%\d]{0,10}" + PCT)
        if v_mfg and v_trd:
            # 배타 조건 분기 (왕 권변: "외세≥실리면 무역 +7% / 실리>외세면 제조 +2%") —
            # 성장형 상한 채택과 같은 관례로 유리한 분기를 가정해 큰 쪽을 채택
            return ("ctrl_trade", v_trd) if v_trd >= v_mfg else ("ctrl_mfg", v_mfg)
        if v_mfg: return "ctrl_mfg", v_mfg
        if v_trd: return "ctrl_trade", v_trd
        # 음수 오더 효율 오라 (노시스 정밀 계산: "무역소 내 쉐라그 1명당 오더 수주 효율 -15%") —
        # PCT(+전용) 미포착으로 종전엔 misc/0으로 유실. perFaction=쉐라그는 공통 파서가 채운다
        v_trn = re.search(r"무역소[^.]{0,40}?오더 수주 효율[^+\-%\d]{0,10}-\s*(\d+(?:\.\d+)?)\s*%", text)
        if v_trn: return "ctrl_trade", -float(v_trn.group(1))
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

TOKENS = RULES["tokens"]  # 시설 간 포인트 토큰 카탈로그 — 새 토큰 시스템은 rules.json에 추가

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
                amount *= P["DORM_SELF_MEMBERS"] if room == "DORMITORY" else P["DORM_ALL_MEMBERS"]
            elif re.search(r"모집 인원마다", text):
                # 사무실 4슬롯. "초기 모집 인원은 포함하지 않음"(멀베리)이면 초기 2명 제외 = 2
                # (사용자 확정 2026-07: 20점이 정배, 40점은 과다)
                amount *= P["RECRUIT_SLOTS_EXCL_INITIAL"] if re.search(r"초기 모집 인원", text) else P["RECRUIT_SLOTS"]
            elif re.search(r"오퍼레이터가 1명 증가할 때마다", text):
                amount *= P["CONTROL_EXTRA_MEMBERS"]  # e.g. Ash: per teammate in the control center
            entry_gen = {"token": token, "estimate": amount}
            if per_member: entry_gen["perMember"] = per_member
            gen.append(entry_gen)
    # dorm level grants (센시: 숙소 레벨 1당 마물 요리 1개 제공 → Lv5 = 5개)
    for token in TOKENS:
        m = re.search(r"레벨(?: ?1)?당 " + re.escape(token) + r" ?(\d+)개", text)
        if m: gen.append({"token": token, "estimate": float(m.group(1)) * P["DORM_LEVEL"]})
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

# 명단형 그룹 (rules.json constants.OP_GROUPS — 비비아나 '기사' 등): 진영 데이터에 없는
# 게임 내부 그룹. 파서는 진영과 동일하게 "1명당" 카운트 대상으로 인정하고, 엔진은 명단으로 센다
OP_GROUP_NAMES = sorted((RULES.get("constants", {}).get("OP_GROUPS") or {}).keys(), key=len, reverse=True)
PER_COUNT_NAMES = sorted(set(FACTION_NAMES) | set(OP_GROUP_NAMES), key=len, reverse=True)

# 제어센터→제조소 진영·그룹 카운트 오라 (parse_metric CONTROL에서 사용 — FACTION_NAMES 확정 후
# 정의, 호출은 parse_skill 시점이라 문제없다. 화이트리스트 alternation만 — 자유 캡처 금지 회귀 방지)
MFG_FACTION_AURA_RE = re.compile(
    r"제조소에 배치된 (?:" + "|".join(re.escape(f) for f in PER_COUNT_NAMES)
    + r") 오퍼레이터 1명당[^%]{0,24}?생산력[^+%\d]{0,10}" + PCT)

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

_ROOM_KW = {"제어 센터": "CONTROL", "무역소": "TRADING", "제조소": "MANUFACTURE",
            "발전소": "POWER", "응접실": "MEETING", "사무실": "HIRE"}

def detect_cond_bonus(text, self_name, self_id=None):
    """"기본 X% + 조건부 Y%" 복합 스킬을 분리한다 (사용자 제보 2026-07-21, 클래스 버그).

    반환 (base_text, cond) — base_text는 무조건 적용분(조건절 제거), cond는 조건부 가산 명세:
      - perFacBase: 기본 flat + "<진영> 1명당 +V%(≤cap)" (뮤엘시스·모건). base_text=원문 유지
        (perFaction 파서가 '1명당'을 봐야 하므로). bonus=별도 파트너 보너스(모건 시즈).
      - roomFaction: 같은 방에 <진영> 있으면 +value (비나·서퍼·Zima·티폰).
      - roomPartner: 같은 방에 <오퍼> 있으면 +value (르무엔·발라크빈·불피스폴리아).
      - basePartner: 기지 어디든(숙소 포함) <오퍼> 있으면 +value → 엔진 basePartnerBonus 재사용
        (Bellone·산크타). crossRoom: <오퍼>가 특정 방에 있으면 +value (프라마닉스).
    조건이 없거나 유형 미상이면 cond=None(원문 그대로 — 훈련 마스터리·토큰·레벨성장 등 불건드림).
    """
    PCT = r"\+?\s*(\d+(?:\.\d+)?)\s*%"
    bm = re.search(r"추가(?:로)?\s*[^%\d]{0,20}?" + PCT, text)
    if not bm:
        return text, None
    Y = float(bm.group(1))
    head = text[:bm.start()]
    # perFacBase — 진영 카운트 + 별도 기본치. per값은 '1명당' 직후에서 읽는다(추가 보너스 아님).
    # ⚡ 부분문자열 사전필터(f in text)로 정규식 전수 스캔의 백트래킹 비용을 없앤다.
    if "1명당" in text:
        for f in FACTION_NAMES:
            if f not in text:
                continue
            pm = re.search(re.escape(f) + r" 오퍼레이터(?:\(최대 (\d+)명\))? ?1명당[^%\d]{0,24}?" + PCT, text)
            if pm:
                per = float(pm.group(2))
                cond = {"type": "perFacBase", "faction": f, "per": per,
                        "cap": per * float(pm.group(1)) if pm.group(1) else None}
                # 모건류: 같은 스킬에 "<오퍼>와 함께 … 추가 +Z%" 파트너 보너스가 더 있으면 첨부
                pn = re.search(r"(?<![가-힣])([가-힣A-Za-z·]{2,10})(?:와|과) 함께[^%]{0,40}?추가(?:로)?[^%\d]{0,20}?" + PCT, text)
                if pn and pn.group(1) != self_name and name_to_id.get(pn.group(1)):
                    cond["bonus"] = {"ids": [name_to_id[pn.group(1)]], "value": float(pn.group(2))}
                return text, cond  # base_text=원문 (perFaction 파서가 '1명당'을 봐야 함)

    def _cut(anchor):  # 조건절 시작(직전 콤마/마침표/'만약') 이후를 잘라 base_text 반환
        i = head.rfind(anchor)
        j = max(head.rfind(",", 0, i), head.rfind(".", 0, i), head.rfind("만약", 0, i))
        return text[:j] if j > 0 else text[:i]

    # 기지 어디든 존재(basePartner) / 타방 존재(crossRoom) 조건 — 오퍼 지명 (부분문자열 사전필터)
    for n in names:
        if len(n) < 2 or n not in head or n == self_name or (self_id and name_to_id.get(n) == self_id):
            continue
        if re.search(r"(?<![가-힣])" + re.escape(n) + r"[가이]? (?:기반시설|숙소)에 (?:배치|있)", head):
            return _cut(n), {"type": "basePartner", "ids": [name_to_id[n]], "value": Y}
        cr = re.search(r"(?<![가-힣])" + re.escape(n) + r"[가이]? (제어 센터|무역소|제조소|발전소|응접실|사무실)에 배치", head)
        if cr:
            return _cut(n), {"type": "crossRoom", "ids": [name_to_id[n]], "room": _ROOM_KW[cr.group(1)], "value": Y}
    # 같은 방 진영 동반 (진영명 우선 — 오퍼 지명보다 앞서 검사해 오탐 방지)
    for f in FACTION_NAMES:
        if f not in head:
            continue
        if re.search(re.escape(f) + r" 오퍼레이터(?:와 함께|가 있을 경우|와 같은)", head):
            return _cut(f), {"type": "roomFaction", "faction": f, "value": Y}
    # 같은 방 오퍼 동반
    for n in names:
        if len(n) < 2 or n not in head or n == self_name or (self_id and name_to_id.get(n) == self_id):
            continue
        if re.search(r"(?<![가-힣])" + re.escape(n) + r"(?:와|과) 함께", head):
            return _cut(n), {"type": "roomPartner", "ids": [name_to_id[n]], "value": Y}
    return text, None  # 유형 미상 — 원문 유지(불건드림)

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
        # 토큰 소비 절("토큰 N점당 … +X%")은 기본치가 아니라 per-token 보너스(tokenUse로 따로 파싱)다.
        # 기본 % 파싱 전에 떼어내, 순수 per-token 스킬이 그 %를 기본치(value)로 오인하지 않게 한다.
        # (2026-07-20: 삼첸 "협객의 도" 기본 20%가 엔진에서 누락되던 근본 원인 — 순수 per-token
        #  스킬 value가 per-token 값이라 엔진이 통째로 무시했고, 그 탓에 기본치 있는 스킬도 같이 버려짐)
        for _tok in TOKENS:
            metric_text = re.sub(
                re.escape(_tok) + r"\s*\d+(?:\.\d+)?(?:점|개)당[^%\d]{0,34}?[+\-]?\d+(?:\.\d+)?\s*%?",
                "", metric_text)
        kind, value = parse_metric(room, metric_text)
        if dorm_lvl and kind in ("output", "misc"):
            kind, value = "output", (value or 0) + float(dorm_lvl.group(1)) * P["DORM_TOTAL_LEVELS"]
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
        # 증폭형 (와이후 협동의식·스노우상트 근면성실 β): "해당 방 내의 오퍼레이터가 제공한
        # [생산력/오더 수주 효율] N%당 M%를 추가 제공, 최대 C%" — 같은 방 다른 오퍼가 제공한
        # 효율(시설 수량분 제외)을 배수로 되돌린다. 엔진이 팀 제공 효율 합으로 스케일한다.
        # (버메일 '늘린 용량당'·스와이어 '늘어난 상한만큼'·데겐블레허 'N개당'은 용량 변환이라
        #  '오퍼레이터가 제공한 …%…당 …% 추가' 구조가 아니어서 걸리지 않는다 — 회귀 스모크 확인)
        amp = None
        am = re.search(r"오퍼레이터가 제공(?:하는|한)[^%]*?(\d+(?:\.\d+)?)%[^당]{0,40}?당"
                       r"[^%\d]{0,20}(\d+(?:\.\d+)?)%[^%]{0,20}추가[^%]{0,40}최대 (\d+(?:\.\d+)?)%", text)
        if am:
            kind, value = "amplify", 0
            amp = {"per": float(am.group(1)), "add": float(am.group(2)), "cap": float(am.group(3))}
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
        # "<진영·그룹> 오퍼레이터(최대 N명)? 1명당/1명 증가할 때마다" — 알려진 진영 +
        # 명단형 그룹(OP_GROUPS: 비비아나 '기사')으로 한정 매칭한다(공백 포함 '라인 랩'도,
        # '제조소 내의'·'숙소 내' 같은 방 범위 조사구는 자연히 제외). 오퍼레이터와 "1명당"
        # 사이 "(최대 N명)"은 개수 상한(내스티)
        for f in PER_COUNT_NAMES:
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
        # 제어센터→제조소 진영 카운트 오라의 범위 표시 + 생산품별 부호 (사용자 확정 2026-07-19):
        # perScope="mfg" = "제조소에 배치된" 인원만 대상 — 엔진이 기지 전체 근사에서 제어센터
        # 동석 동일 진영(본인 포함)을 빼서 과산정을 줄인다 (플레임테일 자신·제시카 이격 자신).
        # perProduct (플레임테일 '피누스 실베스트리스 기사'): "작전기록류 +10%, 귀금속류 -10%"
        # → 방 생산품에 따라 가감 — 양(+) 방엔 결집 이득, 음(-) 방엔 감산이 그대로 반영된다
        per_product = None
        if kind == "ctrl_mfg" and per_faction and "제조소에 배치된" in text:
            per_scope = "mfg"
            PRODUCT_KO = {"작전기록": "exp", "귀금속": "gold", "순금": "gold", "오리지늄": "shard"}
            pp = {}
            for pm in re.finditer(r"([가-힣]+)류에 대한 생산력\s*([+\-]\s*\d+(?:\.\d+)?)\s*%", text):
                prod = PRODUCT_KO.get(pm.group(1))
                if prod: pp[prod] = float(pm.group(2).replace(" ", ""))
            if pp: per_product = pp
        # same-room skill-tag counting (브라이오피타: 금속 공예류 스킬 1개당 +5%)
        per_skill_tag = per_skill_value = None
        m = re.search(r"(?:해당 )?(?:제조소|무역소) 내 ([가-힣 ]{2,10}?)류? 스킬 1개당[^%\d]{0,20}\+\s*(\d+(?:\.\d+)?)\s*%", text)
        if m:
            per_skill_tag = m.group(1).replace(" ", "")
            per_skill_value = float(m.group(2))
        # 성장형 상한 채택 (제조소): "첫 시간/시간당 +N%, 최대 +M%"(아로마·크루스·씬·팽·케오베)와
        # "훈련실 레벨 1당 +N%, 최대 M%"(Вий)는 만렙 기지 정상 운용 상한값으로 계산한다 — POWER·
        # MEETING과 동일 관례(§2 성장형 상한, 사용자 확정 2026-07). 진영·계열 카운트 스킬의 '최대 c%'는
        # 인원 상한이라 건드리지 않도록, 순수 output이고 성장 문구(시간당·레벨 1당)가 있을 때만 적용.
        if (room == "MANUFACTURE" and kind == "output" and value
                and not per_faction and not per_skill_tag
                and re.search(r"시간당|레벨 ?1(?:레벨)?당", text)):
            grow_cap = re.search(r"최대 \+?(\d+(?:\.\d+)?)\s*%", text)
            if grow_cap:
                value = max(value, float(grow_cap.group(1)))
        # facility-count multipliers (쏜즈: 각각의 무역소가 ... +3% → ×2);
        # these survive automation's zeroing ("시설 수량에 따라 제공" 예외)
        facility_based = False
        if kind in ("output", "misc") and value:
            fac = re.search(r"각각의 (무역소|발전소|제조소)", text)
            if fac:
                value = value * P["FACILITY_COUNTS"][fac.group(1)]
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
        # ── 용량 차원 (오더 상한 / 창고 용량) ─────────────────────────────────
        # 다수 무역·제조 오퍼가 효율/생산력과 **함께** 상한/용량을 ±N 부여하고(실버애쉬 효율+20 &
        # 상한+4, 벌컨 생산력-5 & 용량+19, 데겐블레허 효율+25 & 상한-6), 일부 오퍼는 팀이 쌓은
        # 상한/용량을 다시 효율/생산력으로 **변환**한다(버메일·버블·데겐블레허·스와이어·제이).
        # cap = 이 오퍼의 상한/용량 기여(음수 포함, perFaction이 있으면 엔진이 인원수로 스케일).
        cap = 0.0
        cm = re.search(r"(?:창고 용량 상한|오더 수주 상한|오더 상한|주문 상한)\s*([+\-]\s*\d+(?:\.\d+)?)", text)
        if cm: cap = float(cm.group(1).replace(" ", ""))
        # capConv = 팀 용량→출력 변환기. tier(버블 계단) > bundle(데겐블레허 N개당) >
        # diff(제이 상한차) > lin(버메일·스와이어 용량 비례) 우선순위로 하나만.
        cap_conv = None
        _mx = re.search(r"최대 (\d+(?:\.\d+)?)\s*%", text)
        _tier = re.search(r"(\d+)칸 이하.*?1칸당\s*(\d+(?:\.\d+)?)\s*%.*?(\d+)칸 보다 클 경우.*?1칸당\s*(\d+(?:\.\d+)?)\s*%", text)
        _bundle = re.search(r"제공한 (?:오더 상한|창고 용량)[^%\d]{0,4}(\d+)(?:개|칸)당[^%\d]{0,16}(\d+(?:\.\d+)?)\s*%", text)
        _diff = re.search(r"상한의 차이 1당[^%\d]{0,16}\+?\s*(\d+(?:\.\d+)?)\s*%", text)
        _lin = re.search(r"(?:늘[린어]|늘어난|상승시킨)[^%]{0,10}(?:창고 용량|오더 (?:수주 )?상한)[^%]{0,16}?(\d+(?:\.\d+)?)\s*%", text)
        if _tier:
            cap_conv = {"t": "tier", "at": int(_tier.group(1)), "lo": float(_tier.group(2)), "hi": float(_tier.group(4))}
        elif _bundle:
            cap_conv = {"t": "bundle", "per": int(_bundle.group(1)), "rate": float(_bundle.group(2)),
                        "max": float(_mx.group(1)) if _mx else None}
        elif _diff:
            cap_conv = {"t": "diff", "rate": float(_diff.group(1))}
        elif _lin:
            cap_conv = {"t": "lin", "rate": float(_lin.group(1))}
        # 변환기의 % 는 "용량 1당" 단위값이라 헤드라인 효율로 이중 계상되면 안 된다
        # (제이 시장경제 "차이 1당 +4%"가 output=4로도 잡히는 것 방지) — 변환기면 헤드라인 0
        if cap_conv:
            kind, value = "misc", 0
        # ── 조건부 가산 분리 (사용자 제보 2026-07-21: "기본 X% + 조건부 Y%" 클래스 버그) ──
        # 파서가 조건절로 스킬 전체를 게이트(기본치 소실)하거나 조건값을 기본치로 오배치하던
        # 문제를 교정한다. detect_cond_bonus가 유형·기본치·보너스를 분리한다.
        cond_bonus = None
        per_base = None
        partners_list = [p for p in find_partners(text, oname, oid)
                         if p not in base_partner_ids and not (room_partner and p == room_partner["id"])]
        _base_text, _cond = detect_cond_bonus(text, oname, oid)
        if _cond and _cond["type"] == "perFacBase" and not _cond.get("bonus"):
            # 뮤엘시스: 기본 flat + "진영 1명당 +V%(≤cap)". 모건류(bonus 동반)는 자기-카운트
            # 복잡성 때문에 제외 — 별도 후속 (INFRA-RULES 노트). per값은 '1명당' 직후 값.
            _strip = re.sub(re.escape(_cond["faction"]) + r" 오퍼레이터(?:\(최대 \d+명\))? ?1명당[^%]*?\+?\s*\d+(?:\.\d+)?\s*%", "", text)
            _pk, per_base = parse_metric(room, _strip)
            per_base = per_base or 0
            kind = "output"
            value = _cond["per"]
            per_cap = _cond["cap"]
            per_faction = per_faction or _cond["faction"]
            per_scope = per_scope or ("room" if re.search(r"함께 배치|해당 (?:무역소|제조소|발전소) 내", text) else "base")
        elif _cond and _cond["type"] in ("roomFaction", "roomPartner", "crossRoom", "basePartner"):
            # 조건절을 뗀 base_text로 기본치 재파싱(서퍼 20→10 등 조건값 오배치 교정) 후,
            # 조건은 별도 가산으로. 게이트로 잡혔던 partners/reqFaction는 조건분만 해제한다.
            _bk, _bv = parse_metric(room, _base_text)
            kind, value = (_bk, _bv) if _bv else (kind, 0)
            partners_list = [p for p in partners_list if p not in _cond.get("ids", [])]
            if req_faction == _cond.get("faction"): req_faction = None
            if _cond["type"] == "basePartner":  # 엔진 basePartnerBonus 재사용 (언더플로우와 동일)
                base_partner_ids = list(dict.fromkeys(base_partner_ids + _cond["ids"]))
                base_partner_bonus = _cond["value"]
            elif _cond["type"] == "roomFaction":
                cond_bonus = {"value": _cond["value"], "faction": _cond["faction"]}
            elif _cond["type"] == "roomPartner":
                cond_bonus = {"value": _cond["value"], "ids": _cond["ids"]}
            elif _cond["type"] == "crossRoom":
                cond_bonus = {"value": _cond["value"], "ids": _cond["ids"], "room": _cond["room"]}
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
            "partners": [p for p in partners_list if p not in base_partner_ids],
            "basePartners": base_partner_ids, "basePartnerBonus": base_partner_bonus,
            **({"condBonus": cond_bonus} if cond_bonus else {}),
            **({"perBase": per_base} if per_base else {}),
            "gateFaction": gate_faction, "gateCount": gate_count,
            "gatePlatforms": gate_platforms, "roomPartner": room_partner,
            "belowThreshold": below_threshold,
            **({"cap": cap} if cap else {}),
            **({"capConv": cap_conv} if cap_conv else {}),
            **({"amp": amp} if amp else {}),
            "_roboCap": int(robo_cap.group(1)) if robo_cap else None,
            "_roboUse": (float(robo_use.group(1)), float(robo_use.group(2))) if robo_use else None,
            "tokenGen": gen, "tokenUse": use, "convert": convert,
            "reqFaction": req_faction, "perFaction": per_faction, "perScope": per_scope, "perCap": per_cap,
            # "자신을 제외한 <진영> 1명당" (뮤엘시스): 본인이 그 진영이면 카운트에서 자신을 뺀다
            **({"perExclSelf": True} if per_faction and "자신을 제외" in text else {}),
            # 생산품별 부호 오라는 해당 스킬(플레임테일)에만 싣는다 — null 키로 전 스킬을 불리지 않음
            **({"perProduct": per_product} if per_product else {}),
            "facilityBased": facility_based,
            "perSkillTag": per_skill_tag, "perSkillValue": per_skill_value,
            "_stackGrant": stack_grant.group(1) if stack_grant else None,
            "_stackCount": P["DORM_LEVEL"] * (int(stack_grant.group(2)) if stack_grant and stack_grant.group(2) else 1) if stack_grant else 0,
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
        # 지식 베이스 파싱 교정(skillOverrides): 파서가 새 문구를 오분류하면 정규식 대신
        # rules.json에 buffId 교정 행을 추가한다 — 최종 단계와 하위 tier 모두에 적용
        for s in [main, *main.get("tiers", [])]:
            ov = OVERRIDES.get(s["buffId"])
            if ov:
                s.update(ov.get("patch") or {})
                applied_overrides.add(s["buffId"])
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
# 적용되지 않은 skillOverrides = 대상 buffId가 사라졌거나 오타 — 방치하면 조용히 죽은 규칙이 된다
stale_overrides = set(OVERRIDES) - applied_overrides
if stale_overrides:
    print(f"WARNING: rules.json skillOverrides 미적용 {len(stale_overrides)}건 (buffId 확인 필요): "
          + ", ".join(sorted(stale_overrides)), file=sys.stderr)
if untranslated_buffs:
    dedup = list({m["cn"]: m for m in untranslated_buffs}.values())
    print(f"UNTRANSLATED buff texts: {len(dedup)} — scripts/cn-translations.json에 채울 것 (파싱 수치 0으로 잡힘)",
          file=sys.stderr)
    for m in dedup: print(json.dumps(m, ensure_ascii=False), file=sys.stderr)
