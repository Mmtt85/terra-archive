# Re-tag concepts for all operators from skill/talent/trait/module text.
import json, re

import os, sys
S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
ops = json.load(open(f"{S}/operators-regen.json", encoding="utf-8"))
kr = json.load(open(f"{S}/kr_character_table.json", encoding="utf-8"))
chars = kr.get("chars", kr)

# 컨셉 판정은 실제 효과(특성·스킬/재능 설명·모듈 효과)만 본다.
# 스킬·재능 '이름'은 컨셉덱 용으로 쓰지 않는다 — 이름만 보고 태깅하면 '침묵의 소리'(에벤홀츠)
# 같은 연출용 명칭이 실제 침묵 효과로 오인된다 (2026-07 사용자 규칙).
def units(o):
    """개별 텍스트 단위 리스트 — 문장 경계(.)가 스킬 사이를 넘지 않도록 이름 제외."""
    u = [o.get("trait") or ""]
    for s in o["skills"]: u.append(s.get("description") or "")
    for t in o["talents"]: u.append(t.get("description") or "")
    for m in o["modules"]:
        for lv in m["levels"]: u.extend(lv["effects"])
    return [x for x in u if x]

def corpus(o):
    # 마침표로 이어 붙여 '[^.]' 정규식이 스킬 경계를 넘지 못하게 한다 (프란카 자기 방어력 감소가
    # 인접 스킬의 '적'과 붙어 '적…방어력 감소'로 오인되는 등 경계 넘김 오탐 방지).
    return " . ".join(units(o))

# 반사(가시): '피격/공격받음/회피·패리 성공' → 공격자·목표·적에게 대미지/손상/반격.
# 스킬명 '반격'(글라우쿠스 '펄스 반격', 훔 '반격 치료')은 능동 스킬이라 이름에서 잡히지 않으며
# 여기서도 배제된다. 모듈 공용 특성('공격하거나 피격될 시 …10% 대미지')은 반사 정체성이 아니라 제외.
REFLECT_WORD = re.compile(r"대미지[^.]{0,8}반사|트루 대미지[^.]{0,8}반사")
REFLECT_HIT = re.compile(
    r"(?:피격(?:될|당)?(?: 시| 때| 때마다)?"
    r"|(?:일반 )?공격을?\s*받(?:을|은|는|았)[^.]{0,6}"
    r"|(?:마법 )?대미지를?\s*받(?:을|는)[^.]{0,6}"
    r"|회피(?: 성공)?[^.]{0,6})"
    r"[^.]{0,45}?(?:상대|목표|적|공격자|공격한 적|전방[^.]{0,6}적)"
    r"[^.]{0,45}?(?:대미지|손상|원거리 공격|반격)"
    r"[^.]{0,14}?(?:입힌|입힘|입히|주고|준다|진행|반격)"
)
MODULE_SPLASH = re.compile(r"공격하거나 피격될 시[^.]*")

def is_reflect(o):
    for u in units(o):
        if REFLECT_WORD.search(u): return True
        if REFLECT_HIT.search(MODULE_SPLASH.sub("", u)): return True
    return False

# 체력 소모: 오퍼 본인이 HP를 지속/주기적으로 소모하는 플레이스타일 (기인 특성, 수르트·이프리트·
# 스카디 이격 등 자가 딜/버프 대가). '자신의 HP …소모/잃/감소', 'HP 점차/지속 감소', 주기적 HP
# 감소를 잡되, HP를 잃는 주체가 소환물(환영·장치)·아군(목표)이면 제외한다.
DRAIN = re.compile(
    r"(?:자신|스스로)의?\s?HP를?\s?소모"
    r"|(?:자신|스스로)의?\s?HP[^.]{0,8}[\d.]+%[^.]{0,6}(?:씩\s?)?(?:잃|감소|소모)"
    r"|HP가?\s?지속(?:적으로|해서)?\s?감소"
    r"|HP\s?점차\s?감소"
    r"|(?:매초|초당|초마다)[^.]{0,12}(?:자신의?\s?)?HP[^.]{0,10}(?:잃|감소|소모)"
)
NON_SELF = re.compile(r"환영|장치|형상|잔상|분신|드론|소환물|지원군|복제|인형|허수아비|골렘|목표가|아군|대상이")
DRAIN_EXCLUDE = {"나이팅게일"}  # 소모 문구가 전부 '환영'(모듈 조각엔 주어 누락) → 오퍼 본인 소모 아님

def is_drain(o):
    if o["name"] in DRAIN_EXCLUDE: return False
    for u in units(o):
        for sent in re.split(r"[.]", u):
            if "HP" not in sent: continue
            if NON_SELF.search(sent) and not re.search(r"자신|스스로", sent): continue
            if DRAIN.search(sent): return True
    return False

# 시너지 팟 (사용자 확정 컨셉덱) — 컨셉 필터 최상단 고정 순서
POTS = ["해산물팟", "쉐이팟", "쉐라그팟", "카시미어팟", "미노스팟", "아베무팟", "소각팟",
        "라테라노팟", "탄약팟", "라인랩팟", "라이오스 파티"]
# 판정: 앵커 진영 소속이거나, 전투 텍스트(스킬·재능·특성·모듈)에 시너지 언급이 있을 때.
# 출신지만으로 붙이지 않는다 (예: 에기르 ≠ 해산물팟 — terra-archive 도메인 규칙).
POT_BY_FACTION = {
    "해산물팟": {"어비설 헌터스"},
    "쉐이팟": {"염-쉐이"},
    "쉐라그팟": {"쉐라그", "카란 무역회사"},
    "카시미어팟": {"카시미어"},
    "미노스팟": {"미노스"},
    "아베무팟": {"Ave Mujica"},
    "라테라노팟": {"라테라노"},
    "라인랩팟": {"라인 랩"},
    "라이오스 파티": {"라이오스 파티"},
}
POT_BY_TEXT = {
    "해산물팟": r"어비[설셜]",
    "쉐이팟": r"쉐이\]?\s?오퍼레이터",  # '[쉐이의 기이한 계원]에서' 같은 이벤트 맵 조건은 제외 (라이디언)
    "쉐라그팟": r"쉐라그",
    "카시미어팟": r"카시미어",
    "미노스팟": r"미노스",
    "소각팟": r"소각",       # KR 연소 원소 = '소각 손상'
    "라테라노팟": r"라테라노",
    "라인랩팟": r"라인 랩",
    "탄약팟": r"탄약",
    "라이오스 파티": r"라이오스",
}
POT_EXTRA = {  # 텍스트에 안 잡히지만 사용자가 확정한 멤버 (소각 게이지를 실질 축적하는 고빈도 술딜러)
    "소각팟": {"골든글로우", "라플란드 더 데카덴차"},
}

# canonical tag order (frequency-informed); tags emitted in this order
TAG_ORDER = POTS + ["공격 회복", "피격 회복", "아군 치유", "자가 회복", "SP 배터리", "기절", "수면",
             "냉기·빙결", "감속·정지", "속박", "공포", "취약", "방어력 감소", "마법 저항 감소",
             "방어 무시", "마법 저항 무시", "트루 대미지", "지속 피해", "원소 피해", "강제 이동",
             "공격 중지", "보호막", "반사", "회피", "은신·위장", "은신 감지", "불사·생존", "체력 비례",
             "체력 소모", "대공", "소환물·장치", "함정", "쾌속 배치",
             "소환사", "음유시인", "리퍼", "힐링 디펜더", "포트리스"]

def tag(o):
    T = corpus(o)
    raw = chars.get(o["id"], {})
    tags = set()
    sub = o["subProfession"]
    spTypes = {s["spType"] for s in o["skills"]}

    if "공격 회복" in spTypes: tags.add("공격 회복")
    if "피격 회복" in spTypes: tags.add("피격 회복")

    if o["job"] == "메딕" or re.search(r"아군[^.]{0,24}(HP|체력)[^.]{0,10}회복|아군[^.]{0,14}치료|치료함", T):
        tags.add("아군 치유")
    if re.search(r"(자신|스스로)의? ?(HP|체력)[^.]{0,12}회복", T):
        tags.add("자가 회복")
    if re.search(r"(아군|오퍼레이터)[^%]{0,26}SP[^%]{0,18}(회복|공급|\+|획득)", T):
        tags.add("SP 배터리")

    if re.search(r"기절", T): tags.add("기절")
    if re.search(r"수면", T): tags.add("수면")
    if re.search(r"냉기|빙결", T): tags.add("냉기·빙결")
    if re.search(r"감속|정지 (효과|상태)|정지시키|일시정지|이동 속도[^+]{0,8}(감소|낮|늦|-)", T) or sub == "감속자": tags.add("감속·정지")
    if re.search(r"속박", T): tags.add("속박")
    if re.search(r"공포", T): tags.add("공포")
    if re.search(r"취약", T): tags.add("취약")
    if re.search(r"적[^.]{0,40}방어력[^.]{0,12}(감소|-\d)|방어력을? ?(감소|깎)", T): tags.add("방어력 감소")
    if re.search(r"마법 저항(력)?[^.]{0,14}(감소|-\d)", T): tags.add("마법 저항 감소")
    if re.search(r"방어력?[^가-힣]{0,12}무시|방어력의 \d+(\.\d+)?%[^가-힣]{0,4}무시", T): tags.add("방어 무시")
    if re.search(r"마법 저항(력)?[^가-힣]{0,12}무시", T): tags.add("마법 저항 무시")
    if re.search(r"트루 대미지", T): tags.add("트루 대미지")
    if re.search(r"지속 (대미지|피해)|중독|1초마다[^.]{0,26}대미지|초당[^.]{0,20}대미지를|매초[^.]{0,24}대미지", T): tags.add("지속 피해")
    if re.search(r"원소 (대미지|피해|손상)|괴리|신경 손상|부식 손상|화상 손상|감전", T): tags.add("원소 피해")
    if re.search(r"밀어내|끌어당|당겨오|넉백|잡아당", T): tags.add("강제 이동")
    if re.search(r"공격(을)? ?(중지|중단|멈추)|공격하지 않(는|음|고)", T): tags.add("공격 중지")
    if re.search(r"보호막|실드", T): tags.add("보호막")
    if is_reflect(o): tags.add("반사")
    if re.search(r"회피", T): tags.add("회피")
    if re.search(r"은신|위장", T):
        if re.search(r"은신[^.]{0,14}(감지|발견|드러|무효|무시)|위장[^.]{0,14}(감지|발견|드러|무효|무시)", T):
            tags.add("은신 감지")
        if re.search(r"(자신|배치|스스로)[^.]{0,20}(은신|위장)|은신 상태가 되|위장 상태", T) or o["subProfession"] in ("매복자", "척후병"):
            tags.add("은신·위장")
        if not tags & {"은신 감지", "은신·위장"}:
            tags.add("은신·위장")
    if re.search(r"사망하지 않|사망을 (방지|무시)|치명적인 대미지를 (입어도|받아도|무시)|치명상[^가-힣]{0,4}(을|를)? ?입(어도|을 경우)|쓰러지지 않|HP를 최소 1|HP가 1 이하로|전투 불능이 되지 않", T): tags.add("불사·생존")
    if re.search(r"(최대 HP|HP ?최대치|현재 HP)의 \d+(\.\d+)?%", T): tags.add("체력 비례")
    if is_drain(o): tags.add("체력 소모")
    for pot, facs in POT_BY_FACTION.items():
        if any(f in facs for f in o["factions"]): tags.add(pot)
    for pot, pat in POT_BY_TEXT.items():
        if re.search(pat, T): tags.add(pot)
    for pot, names in POT_EXTRA.items():
        if o["name"] in names: tags.add(pot)
    if re.search(r"공중 (유닛|목표|적)|드론", T) or "대공" in sub: tags.add("대공")

    if raw.get("displayTokenDict") or re.search(r"소환(수|물|하여|해)|장치를 (배치|설치)", T):
        tags.add("소환물·장치")
    if re.search(r"함정", T) or sub == "함정술사": tags.add("함정")

    redeploys = [s["redeploy"] for s in o["stats"] if isinstance(s.get("redeploy"), (int, float))]
    if redeploys and min(redeploys) <= 40 and o["rarity"] >= 3: tags.add("쾌속 배치")


    if sub == "소환사": tags.add("소환사")
    if sub == "음유시인": tags.add("음유시인")
    if sub == "리퍼": tags.add("리퍼")
    if sub == "가디언": tags.add("힐링 디펜더")
    if sub == "포트리스": tags.add("포트리스")

    return [t for t in TAG_ORDER if t in tags]

dist = {}
for o in ops:
    o["concepts"] = tag(o)
    for t in o["concepts"]: dist[t] = dist.get(t, 0) + 1

json.dump(ops, open(f"{S}/operators-tagged.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("tag distribution:", json.dumps(dict(sorted(dist.items(), key=lambda x: -x[1])), ensure_ascii=False))
untagged = [o["name"] for o in ops if not o["concepts"]]
print("untagged:", len(untagged), untagged[:20])

# spot checks against known kits
CHECK = {"이프리트": None, "프틸롭시스": None, "스즈란": None, "글래디아": None, "텍사스 디 오메르토사": None, "사리아": None,
         "수르트": None, "엑시아": None, "쏜즈": None, "니엔": None, "블레미샤인": None,
         "토가와 사키코": None, "내스티": None, "호시구마 더 브리처": None, "스카디": None, "링": None}
for o in ops:
    if o["name"] in CHECK: CHECK[o["name"]] = o["concepts"]
for k, v in CHECK.items(): print(f"  {k}: {v}")
