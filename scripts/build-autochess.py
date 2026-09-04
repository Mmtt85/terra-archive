#!/usr/bin/env python3
"""위수 협의(오토체스) 가이드 데이터 — app/data/autochess{,.en,.ja}.json + public/ac/ 아이콘.

사용:
  python3 scripts/build-autochess.py            # 최신 시즌 (데이터 + 아이콘)
  python3 scripts/build-autochess.py --all      # 지난 시즌까지 전부 — 점검일엔 이걸 쓴다
  python3 scripts/build-autochess.py --season 1 # 그 시즌만
  python3 scripts/build-autochess.py --no-icons # 데이터만 (아이콘은 이미 받아둔 경우)

시즌 (사용자 요청 2026-09-05 "예전 맹약 어땠는지 궁금해하는 사람들도 많더라"):
  최신 시즌은 **파일명이 그대로** autochess.json — 기존 임포트·링크가 안 깨진다.
  지난 시즌은 autochess-s<N>.json 이고, 목록은 autochess-seasons.json 이 낸다.
  시즌 번호·활동 id 는 **손으로 적지 않는다** — autoChessData.versionInfoDict 가 정본이라
  새 시즌이 들어오면 `--all` 한 번으로 저절로 늘어난다. 새 시즌 대응 절차는
  `.claude/skills/autochess-season` 스킬이 정본.
  ⚠ 시즌1↔2 사이에 **같은 id인데 수치가 갈아엎어졌다** (밴드 29/29 · 맹약 18/18 ·
    기물 195/200 실측). 그래서 시즌을 섞어 참조하면 안 된다 — 각 시즌 블록만 본다.
  ⚠ 최상위 autoChessData 는 시즌 union 이라 **지난 시즌을 구워도 현재 값**이 나온다
    (밴드 해금 조건·특훈 적 유형 이름 등). 이름·조건 수준이라 그대로 두지만, 지난 시즌
    화면에서 해금 조건이 당시와 다를 수 있다.

입력은 **이미 받아둔 .gamedata/*_activity_table.json** 이다 (fetch-gamedata.py가 챙긴다).
위수 협의는 별도 테이블이 아니라 activity_table 안에
`activity.AUTOCHESS_SEASON.act2autochess` 로 774KB가 통째로 박혀 있다.

⚠ KR/EN/JA를 **한 번에** 낸다 — build-i18n.py를 따로 돌릴 필요 없다 (CLAUDE.md 규칙 자체 충족).

로케일 사정 (2026-09-04 실측 — 세 서버 모두 시즌2가 들어와 폴백이 다 걷혔다):
  kr  act2autochess ✓  → 한국어 공식 텍스트
  jp  act2autochess ✓  → 일본어 공식 텍스트
  en  act2autochess ✓  → 영어 공식 텍스트 (글섭 resVersion 26-08-28부터)

⚠ 아래 폴백 장치는 **지우지 말 것.** 지금은 놀고 있지만 한섭 선출시 구간마다 되살아난다 —
  한섭에 먼저 들어온 밴드는 글섭 리소스가 따라올 때까지 EN에서 한국어로 나간다.
  실제로 2026-09-02 위수 협의 2단계 4종(스즈란·제시카·뮤엘시스·팽)이 한섭에만 있어
  EN 산출물에 한글 299자가 실려 나갔고, 9/3 글섭 갱신으로 0자가 됐다.
    ① 이름류(맹약·모드·밴드 효과명)는 그 로케일 시즌2 → 시즌1 EN 같은 id → 한국어 순.
    ② **설명문은 시즌1에서 빌려 오지 않는다.** 시즌1↔2 사이에 수치가 바뀐 사례가 있어
       (garrison_02_a: EN 시즌1 "+10% ATK/HP" vs KR 시즌2 "+30%") 빌려 오면 틀린 숫자가 나간다.
       그래서 설명은 한국어 원문으로 떨어지고, 화면은 doc.krOnly 플래그로 안내문을 띄운다.
    ③ 진영 맹약(시라쿠사·카시미어 등)이 시즌1 EN에도 없으면 handbook_team_table의
       공식 영문 국가명으로 메운다.
  글섭이 밀렸는지 확인: python3 scripts/fetch-gamedata-cdn.py --server en --check

산출 아이콘 (public/ac/ — R2 이관 대상, 라우트 /autochess 와 폴더명이 겹치지 않게 'ac'):
  ac/bond/<bondId>.webp   맹약 아이콘 23
  ac/band/<bandId>.webp   밴드 아이콘 36
  ac/equip/<trapId>.webp  장비 아이콘 45
  ac/type/<key>.webp      능력 분류 아이콘 4 (작전/맹약/자금/정비)
  ac/mode/<key>.webp      모드 아이콘 5
기물 얼굴은 기존 /avatars/<charId>.webp 를 그대로 쓴다 (새로 받지 않는다).
"""
import json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(REPO, ".gamedata")
DATA = os.path.join(REPO, "app", "data")
PUB = os.path.join(REPO, "public", "ac")
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"
AC_ARTS = f"{ASSETS}/ui/autochess/%5Buc%5Dautochesscommon/arts"
AC_OUTER = f"{ASSETS}/ui/autochess/%5Buc%5Dautochessouter/arts"
ITEM_ICON = "https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/item"
SKILL_ICON = f"{ASSETS}/arts/skills"          # skill_icon_<iconId>.png
MODTYPE_ICON = f"{ASSETS}/arts/ui/uniequiptype"  # <typeIcon 소문자>.png

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp  # noqa: E402
from acseason import dispatch_all, out_name, season_arg, seasons_of  # noqa: E402

ACT1 = "act1autochess"         # 시즌1 — EN 이름 폴백 전용
NO_ICONS = "--no-icons" in sys.argv

load = lambda p: json.load(open(os.path.join(S, p), encoding="utf-8"))


# ── 게임 마크업 정리 ──────────────────────────────────────────────────────────
# 강조 태그는 **굵게** 로 살리고(화면에서 i18n.rich()가 <b>로 렌더) 나머지는 지운다.
# ⚠ 태그를 통째로 지우는 정규식(`</?[a-zA-Z][^>]*>`)을 쓰면 안 된다 — 이 모드의 설명문은
#   조건절을 홑화살괄호로 감싼다(`<전장에 … 6명 배치>`, EN `<In battle>`). 영문은 첫 글자가
#   알파벳이라 조건절이 통째로 날아간다. 그래서 @ / $ / color 로 시작하는 것만 지운다.
EMPH_TAGS = ("@ba.vup", "@ba.vdown", "@ba.kw", "@autochess.dgreen", "@acdm.award")
EMPH_RE = re.compile(r"<(" + "|".join(re.escape(t) for t in EMPH_TAGS) + r")>(.*?)</>", re.S)
DROP_RE = re.compile(r"<@[^>]*>|<\$[^>]*>|</?color[^>]*>|</>")


def rich(s):
    """게임 텍스트 → 화면용. 강조는 **굵게**, 나머지 마크업은 제거."""
    if not s:
        return ""
    s = s.replace("\r\n", "\n").replace("\\n", "\n")
    s = re.sub(r"</?color[^>]*>", "", s)      # 색 태그는 먼저 걷어낸다 (강조와 중첩되므로)
    prev = None
    while prev != s:                          # 중첩 대비 반복
        prev = s
        s = EMPH_RE.sub(lambda m: f"**{m.group(2)}**" if m.group(2).strip() else "", s)
    s = DROP_RE.sub("", s)
    s = re.sub(r"\*\*\s*\*\*", "", s)
    return re.sub(r"[ \t]+\n", "\n", s).strip()




COND_RE = re.compile(r"^<([^>]+)>\s*")


# ── 단계 게이트 — 그 단계가 **언제 켜지는가** (편성 계산기용, 2026-08-29) ──────────
# 조건 문구가 규칙적이라 파싱이 되고, 같은 숫자가 게임 blackboard 에도 있는 것은 대조한다
# (validate_gates). 손 표를 안 쓰는 이유는 시즌이 바뀌면 표가 먼저 썩기 때문이다.
#
#   전장에 서로 다른 [염국] 오퍼레이터 **6**명 배치  → {"k":"char","n":6}
#   전장에 서로 다른 [아케인] 오퍼레이터 **3**배치    → 같은 뜻인데 '명'이 없다
#   전장에 [독행] 오퍼레이터 1명 배치                → 강조(**)조차 없다
#   전장에 정예화 오퍼레이터 **2**명 배치            → {"k":"gold","n":2}  (궁극기 전용)
#   중첩 수 **40**회 달성 · 최초로 **80**회 중첩     → {"k":"stack","n":40}
#   중첩 수 **25**회당                              → {"k":"stack","n":25,"rep":1} (반복 발동)
#
# ⚠ **인원 게이트와 중첩 게이트는 성격이 다르다.** 인원은 판을 짜는 순간 확정되지만,
#   중첩은 전투 중에 쌓이는 값이라 편성만으로는 도달 여부를 알 수 없다 (신속·기민 40,
#   기습 50, 기적·투자자 100, 예견 80/150). 화면에서 반드시 갈라 보여야 한다 —
#   섞어 놓으면 "편성만 하면 켜지는 효과"로 읽힌다.
_GN = r"\*{0,2}(\d+)\*{0,2}"
GATE_GOLD = re.compile(r"정예화.*?" + _GN + r"\s*명")
GATE_CHAR = re.compile(r"오퍼레이터\s*" + _GN + r"\s*명?\s*배치")
GATE_STACK_REP = re.compile(r"중첩\s*수\s*" + _GN + r"\s*회당")
GATE_STACK = re.compile(r"중첩\s*수\s*" + _GN + r"\s*회\s*달성|최초로\s*" + _GN + r"\s*회\s*중첩")


def gate_of(cond):
    """조건 문구(한국어) → 기계가 판정할 수 있는 게이트. 못 읽으면 None(=항상 적용)."""
    if not cond:
        return None
    if "정예화" in cond and (m := GATE_GOLD.search(cond)):
        return {"k": "gold", "n": int(m.group(1))}
    if m := GATE_STACK_REP.search(cond):
        return {"k": "stack", "n": int(m.group(1)), "rep": 1}
    if m := GATE_STACK.search(cond):
        return {"k": "stack", "n": int(m.group(1) or m.group(2))}
    if m := GATE_CHAR.search(cond):
        return {"k": "char", "n": int(m.group(1))}
    return None


# blackboard 의 임계 키 → 게이트 종류. `layer`류는 맹약마다 뜻이 갈려(조력=중첩 증가량,
# 빅토리아·기적=발동 주기, 투자자=달성 임계) 대조에 쓰지 않는다 — 문구가 정본이다.
GATE_BB_KEYS = {"power_bond_char_cnt": "char", "ex_bond_char_cnt": "char",
                "power_char_cnt": "gold", "ex_char_cnt": "gold",
                "power_bond_stack_cnt": "stack"}


def validate_gates(bid, b, gates):
    """문구에서 읽은 게이트를 blackboard 숫자와 대조한다. 어긋나면 빌드를 세운다."""
    board = {}
    for blk in (KR["effectBuffInfoDataDict"].get(b.get("effectId")) or []):
        for kv in (blk.get("blackboard") or []):
            board.setdefault(kv["key"], kv["value"])
    for key, kind in GATE_BB_KEYS.items():
        want = int(board.get(key) or 0)
        if want <= 0:          # 불굴의 power_bond_stack_cnt=0 처럼 뜻 없는 0 은 건너뛴다
            continue
        if not any(g and g["k"] == kind and g["n"] == want for g in gates):
            sys.exit(f"단계 게이트 불일치: {bid}({b['name']}) blackboard {key}={want} 인데 "
                     f"문구에서 읽은 게이트는 {[g for g in gates if g]} — 조건 문구 형태가 바뀌었는지 확인")


def steps_of(desc):
    """설명문을 '조건 → 효과' 단계로 쪼갠다.

    맹약·능력 설명은 `<전장에 서로 다른 [염국] 오퍼레이터 6명 배치> 전투 시작 후 …` 처럼
    조건을 홑화살괄호로 앞세운 줄이 이어지는 꼴이다. 줄마다 조건을 떼어 내면 화면에서
    조건 칩 + 본문으로 그릴 수 있다 (통짜 문단보다 훨씬 읽힌다).
    """
    out = []
    for line in rich(desc).split("\n"):
        line = line.strip()
        if not line:
            continue
        m = COND_RE.match(line)
        if m:
            out.append({"c": m.group(1).strip(), "t": line[m.end():].strip()})
        else:
            out.append({"t": line})
    return out


# ── 로케일 소스 ───────────────────────────────────────────────────────────────
PREFIX = {"ko": "kr", "en": "en", "ja": "jp"}
SUFFIX = {"ko": "", "en": ".en", "ja": ".ja"}

acts, act1s, chars, skills, equips, char_equips, bequips, items, enemies, teams, outers = {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}
ats = {loc: load(f"{pre}_activity_table.json") for loc, pre in PREFIX.items()}

SEASONS = seasons_of(ats["ko"])
if not SEASONS:
    sys.exit("kr_activity_table.json 에서 위수 협의 시즌을 못 찾았다 — fetch-gamedata 를 먼저 돌릴 것")
LATEST = SEASONS[-1][0]

if dispatch_all(__file__, SEASONS, sys.argv):     # --all → 시즌마다 새 프로세스
    sys.exit()

SEASON = season_arg(sys.argv) or LATEST
ACT = dict(SEASONS).get(SEASON)
if not ACT:
    sys.exit(f"시즌 {SEASON} 이 없다 — 있는 시즌: {[n for n, _ in SEASONS]}")

for loc, pre in PREFIX.items():
    at = ats[loc]
    season = at.get("activity", {}).get("AUTOCHESS_SEASON", {})
    acts[loc] = season.get(ACT)
    act1s[loc] = season.get(ACT1)
    chars[loc] = load(f"{pre}_character_table.json")
    skills[loc] = load(f"{pre}_skill_table.json")
    _uq = load(f"{pre}_uniequip_table.json")
    equips[loc] = _uq.get("equipDict", {})
    char_equips[loc] = _uq.get("charEquip", {})   # 오퍼 → 보유 모듈 id 목록
    _be = load(f"{pre}_battle_equip_table.json")
    bequips[loc] = _be.get("equips", _be)   # 모듈 전투 효과 (특성 변경·재능 강화 문구)
    items[loc] = load(f"{pre}_item_table.json")["items"]
    enemies[loc] = load(f"{pre}_enemy_handbook_table.json").get("enemyData", {})
    teams[loc] = load(f"{pre}_handbook_team_table.json")
    acts[loc + "_basic"] = at.get("basicInfo", {})
    # ⚠ activity.AUTOCHESS_SEASON 말고 **최상위 autoChessData** 에도 이 모드 데이터가 있다
    #   (2026-08-22 발견). 특훈 적 유형의 공식 이름·설명, 리더 적(boss)→적 id 매핑이
    #   여기에만 있으므로 시즌 블록과 같이 읽는다. 세 로케일 모두 갖고 있다.
    outers[loc] = at.get("autoChessData") or {}

KR = acts["ko"]
if not KR:
    sys.exit(f"kr_activity_table.json 에 {ACT} 가 없다 — fetch-gamedata.py 를 먼저 돌릴 것")
BASIC = acts["ko_basic"].get(ACT) or {}

# 시즌1 EN에 없는 맹약의 영문 이름 — 국가 맹약만 공식 표기가 handbook_team_table에 있다
BOND_TEAM = {"siracusaShip": "siracusa", "kazimierzShip": "kazimierz", "yanShip": "yan",
             "sargonShip": "sargon", "victoriaShip": "victoria", "kjeragShip": "kjerag",
             "lateranoShip": "laterano", "egirShip": "egir"}


def act_of(loc):
    return acts.get(loc)


def loc_name(loc, dic, key, field, kr_value):
    """이름류 — 그 로케일 시즌2 → (EN) 시즌1 같은 id → 한국어."""
    a = act_of(loc)
    if a and key in a.get(dic, {}):
        v = a[dic][key].get(field)
        if v:
            return v
    if loc == "en":
        a1 = act1s.get("en")
        if a1 and key in a1.get(dic, {}):
            v = a1[dic][key].get(field)
            if v:
                return v
    return kr_value


def loc_desc(loc, dic, key, field, kr_value):
    """설명문 — 그 로케일 시즌2에만 의존한다. 없으면 한국어 원문 (시즌1을 빌리지 않는다)."""
    a = act_of(loc)
    if a and key in a.get(dic, {}):
        v = a[dic][key].get(field)
        if v:
            return v
    return kr_value


def char_name(loc, cid):
    if not cid:
        return None
    c = chars[loc].get(cid) or chars["ko"].get(cid) or {}
    return c.get("name")


def item_of(loc, iid):
    return items[loc].get(iid) or items["ko"].get(iid) or {}


# ── 기물(오퍼레이터) ──────────────────────────────────────────────────────────
CHESS = KR["charShopChessDatas"]          # 133 — 상점에 뜨는 기물 정본
CHESSDATA = KR["charChessDataDict"]       # 266 — 일반(_a)/골든(_b) 각각의 능력치·맹약·능력
GARRISON = KR["garrisonDataDict"]         # 320 — 기물별 위수 협의 전용 능력
BONDS = KR["bondInfoDict"]                # 23  — 맹약(진영 8 + 특성 15)


# ── 특질 중복 판정 — 설명문이 아니라 **원본 구현(blackboard)** 을 본다 ──────────────
#
# 사용자 지적 2026-08-26: "그라벨은 특질이 두 갠데 '배치 시 중첩 +1'이 중복돼 있는 것
# 같은데, 두 개 합쳐서 총 +2가 중첩된다는 말이야? 아니면 진짜로 그냥 중복인 거야?"
#
# 원본을 파 보면 능력 하나는 **설명문(garrisonDesc)** 과 **구현(blackboard)** 을 따로 갖는데,
# 구현은 조각 하나만 담고 설명문은 그 기물의 **최종 효과 전체**를 적는다. 그래서 조각이
# 둘이면 첫 카드의 설명문이 둘째 카드의 내용을 이미 포함한다 — 화면에서는 수치가 두 배로
# 붙는 것처럼 읽힌다. 실측(2026-08-26, 특질 2개인 기물 9종):
#
#   그라벨      75 = 쓰러질 시 [불굴] +2 만 구현   / 143 = 배치 시 [카시미어] +1 만 구현
#               → 75 의 설명문이 배치 시 줄까지 적어 둔 것. 카시미어는 **+1** 이다.
#   데겐블레허  155 = 배치 시 +8(전투당 최대 24)  / 65 = 획득 시 +8(SERVER_GAIN)
#               → 155 의 설명문이 획득 시 줄까지 적어 둔 것. 획득은 **+8** 이다.
#   해럴드·틴맨·로즈몬티스  03 = 공·HP ×1.2 만    / 09·151 = 맹약 3중첩당 +1% 만
#   메테오      137 = 공·HP ×1.25 만              / 01 = 약점 대미지 변환만
#   니어2       145 → 144(재배치 -1.5%)           / 160 → 159(공속 +0.5)
#   이그제큐터  23 = [라테라노] +7                 / 55 = [예견] +3  (설명문은 둘 다 양쪽을 적음)
#   산탈라      141 = 휴식 진입 시 +4              / 142 = 휴식 종료 시 +4  ← **여기만 진짜 합산**
#
# ⚠ 그래서 "글자가 비슷하면 지운다"로는 안 된다 — 산탈라(유사도 0.848)가 그라벨(0.650)보다
#   더 닮았는데 산탈라는 지우면 안 된다. **발동 시점(blackboard 의 key·eventType)** 이
#   판정 기준이다 (사용자 확정 2026-08-26).

# 조건 문구 → 발동 시점. **한국어 원문 기준**으로만 판정하고, 그 결과(줄 번호·능력 id)를
# EN/JA 에 그대로 적용한다 — 세 로케일의 줄 수가 같은 것은 전수 확인했다.
COND_TRIGGER = {"배치 시": "onstart", "쓰러질 시": "selfdead", "획득 시": "SERVER_GAIN"}


def gar_trigger(gid):
    """이 능력이 **실제로** 언제 발동하는가 — 설명문이 아니라 blackboard/eventType 에서 뽑는다."""
    g = GARRISON.get(gid) or {}
    ev = g.get("eventType") or ""
    if ev.startswith("SERVER_"):          # SERVER_GAIN(획득) · SERVER_PREP_START/FIN(휴식 전후)
        return ev
    key = ""
    for b in g.get("blackboard") or []:
        if b.get("key") == "key":
            key = b.get("valueStr") or ""
    for mark in ("onstart", "selfdead", "consume_ammo", "onkill"):
        if mark in key:
            return mark
    return ev or "IN_BATTLE"


def gar_line_keep(gid, siblings):
    """여러 줄 설명에서 **형제 능력이 구현하는 줄**을 뺀다 → 남길 줄 번호 (없으면 None)."""
    g = GARRISON.get(gid)
    if not g:
        return None
    lines = rich(g["garrisonDesc"]).split("\n")
    if len(lines) < 2:
        return None
    mine = gar_trigger(gid)
    sib = {gar_trigger(x) for x in siblings if x != gid}
    keep = []
    for i, ln in enumerate(lines):
        m = COND_RE.match(ln)
        trig = COND_TRIGGER.get(m.group(1).strip()) if m else None
        # 이 줄의 조건이 **형제 능력의 발동 시점**이고 내 것이 아니면, 그 줄은 형제 몫이다
        if trig and trig != mine and trig in sib:
            continue
        keep.append(i)
    return keep if 0 < len(keep) < len(lines) else None


# 비교에서 지우는 것 — 강조(**)·괄호 주석·따옴표. 괄호를 빼는 이유는 같은 효과를 다르게
# 풀어 쓰기 때문이고(메테오 01 "물리 또는 마법 대미지로 변경" vs 137 "대미지 유형 변경"),
# 따옴표를 빼는 이유는 '부여하는 특질'을 인용부호로 감싸기 때문이다(니어2 145 의 '…' 안이
# 곧 144 의 설명문 전체다).
_GAR_QUOTE = "\u0027\u0022\u2018\u2019\u201c\u201d\u300c\u300d"


def _gar_norm(txt):
    txt = txt.replace("**", "")
    return re.sub(r"[(（][^)）]*[)）]", " ", txt)


def _gar_flat(txt):
    """공백·구두점을 다 지운 비교용 문자열 — 부분문자열 판정."""
    return re.sub(r"[\s,、" + _GAR_QUOTE + r"]+", "", _gar_norm(txt))


def _gar_tokens(txt):
    """토큰 집합 — 긴 쪽이 문장 **중간에** 구절을 끼워 넣으면 부분문자열로는 안 걸린다
    (니어2 145 는 160 의 문장 가운데에 '재배치 시간 -1.5%, ' 를 끼워 넣는다)."""
    return set(t.strip(_GAR_QUOTE) for t in re.split(r"[\s,、]+", _gar_norm(txt)) if t.strip(_GAR_QUOTE))


def dedupe_gar(ids, texts):
    """같은 말을 두 번 하는 슬롯 정리 — **발동 시점이 같을 때만** 지운다.

    발동 시점이 다르면 진짜로 각각 터지는 것이므로(산탈라·그라벨·데겐블레허) 건드리지 않는다.
    """
    if len(ids) < 2:
        return list(ids)
    tok = [_gar_tokens(texts[g]) for g in ids]
    flat = [_gar_flat(texts[g]) for g in ids]
    trig = [gar_trigger(g) for g in ids]
    keep = []
    for i, gid in enumerate(ids):
        dup = any(j != i and trig[j] == trig[i] and flat[i]
                  and (flat[i] in flat[j] or (tok[i] and tok[i] <= tok[j]))
                  and (len(flat[i]) < len(flat[j]) or j < i)
                  for j in range(len(ids)))
        if not dup:
            keep.append(gid)
    return keep or [ids[0]]


# 남길 능력·줄을 **한국어 기준으로 한 번만** 계산해 세 로케일이 같은 결과를 쓰게 한다
GAR_KEPT, GAR_LINES = {}, {}
for _cid, _cd in CHESSDATA.items():
    _ids = [g for g in (_cd.get("garrisonIds") or []) if g in GARRISON]
    if not _ids:
        continue
    for _g in _ids:
        _lk = gar_line_keep(_g, _ids)
        if _lk is not None:
            GAR_LINES[_g] = _lk
    _texts = {}
    for _g in _ids:
        _ls = rich(GARRISON[_g]["garrisonDesc"]).split("\n")
        _texts[_g] = "\n".join(_ls[i] for i in GAR_LINES.get(_g, range(len(_ls))))
    GAR_KEPT[_cid] = dedupe_gar(_ids, _texts)


def gar_desc(loc, gid, g):
    """능력 설명 — 형제 능력이 구현하는 줄은 뺀 뒤 로케일 문구로 낸다.

    줄 번호는 **한국어에서 계산**해 그대로 쓴다 (세 로케일의 줄 수가 같은 것은 전수 확인).
    """
    txt = rich(loc_desc(loc, "garrisonDataDict", gid, "garrisonDesc", g["garrisonDesc"]))
    idx = GAR_LINES.get(gid)
    if idx is None:
        return txt
    lines = txt.split("\n")
    return "\n".join(lines[i] for i in idx if i < len(lines))

# ── 맹약의 '중첩 수에 따라 변경' 실수치 (사용자 요청 2026-08-24) ─────────────────
# 게임 설명문은 "공격력 증가 (중첩 수에 따라 변경)"처럼 숫자를 안 준다. 진짜 값은
# effectBuffInfoDataDict의 전투 블랙보드에 있고, 어느 키를 봐야 하는지는 bondInfoDict의
# descParamBaseList/descParamPerStackList가 **순서대로 짝지어** 알려 준다.
#   예) 염국 base_atk 0.23 · atk_per_stack 0.009 → 기본 +23%, 중첩 1당 +0.9%
# 키 이름만으로는 단위를 알 수 없어(공속은 정수, 배율은 ×) 여기 손으로 짝지어 둔다.
# 코드는 화면(app/autochess.tsx STACK_LABEL)이 로케일 라벨로 옮긴다.
STACK_META = {
    "base_atk":                      ("atk", "pct"),
    "base_max_hp":                   ("hp", "pct"),
    "base_def":                      ("def", "pct"),
    "base_attack_speed":             ("aspd", "flat"),
    "base_time":                     ("time", "sec"),
    "base_duration":                 ("duration", "sec"),
    "base_damage":                   ("truedmg", "flat"),
    "base_damage_value":             ("magicdmg", "flat"),
    "base_damage_scale":             ("dmgscale", "mult"),
    "base_ex_damage_scale":          ("chilldmg", "mult"),   # 쉐라그 — 냉기·빙결 상태 적 전용
    "base_damage_scale_show":        ("magictaken", "pct"),
    "base_damage_scale_show_ex":     ("lowhpdmg", "pct"),
    "base_ammo_percent":             ("ammo", "pct"),
    "base_max_atk_when_born":        ("atkcap", "pct"),
    "base_prob":                     ("prob", "pct"),
    "baseprob":                      ("prob", "pct"),
    "bond_eff_kjerag[storm].base_time": ("stormtime", "sec"),
}


# 게임의 descParam 목록이 빠뜨린 값 — 기습은 설명문이 "공격력 및 HP 증가"인데 목록엔
# 공격력만 있다. 블랙보드에 같은 크기(0.25 / 0.01)의 HP 값이 실제로 있으므로 함께 낸다
# (2026-08-24 실측). 아케인의 base_damage_scale 1.2는 damage_scale_show 0.2와 같은 값의
# 배율 표기라 일부러 안 넣는다 — 넣으면 같은 수치가 두 줄로 나온다.
STACK_EXTRA = {"raidShip": ["base_max_hp"]}

# ── 설명문이 숫자를 감춘 **상수** (사용자 지적 2026-08-24: "라테라노는 6명 모이면 공격력
# 증가인데 그거에 대한 설명은 왜 없냐") ─────────────────────────────────────────
# "(최대치 존재)"·"일정량"·"증가"로만 적힌 값들. 실수치는 전투 블랙보드에 있는데 화면
# 어디에도 안 나와서 "그래서 얼마나 오르는데?"가 됐다. 중첩 계수(STACK_META)와 달리 게임이
# 어느 키인지 알려 주지 않으므로, **원문과 하나씩 대조해 확인한 것만** 손으로 적는다.
#   (코드, 단위, 블랙보드 키, 몇 번째 단계, 상한 키 또는 None, 상한 단위)
BOND_CONST = {
    "lateranoShip": [("atkperammo", "pct", "atk_per_consume", 1, "max_atk_for_consume", "pct")],
    # 쉐라그는 일반 대미지 배율(상수)과 냉기·빙결 배율(중첩)이 따로다 — 앞의 것이 빠져 있었다
    "kjeragShip":   [("dmgscale", "mult", "base_damage_scale", 0, None, None)],
    "victoriaShip": [("atkequip", "pct", "atk_normal_equip", 2, None, None),
                     ("atkequipgold", "pct", "atk_golden_equip", 2, None, None)],
    "preciShip":    [("pen", "pct", "power_def_penetrate", 1, None, None)],
    "deputShip":    [("respawn", "pct", "respawn_time", 0, None, None)],
    # 사르곤은 스킬을 쏠 때마다 쌓이고 25중첩에서 멈춘다 ("스킬 발동 시 … 증가(최대치 존재)")
    "sargonShip":   [("aspdcast", "flat", "base_attack_speed", 0, "max_buff_stack_cnt", "stack"),
                     ("atkcast", "pct", "base_atk", 1, "max_buff_stack_cnt", "stack")],
}


def stack_rows(b):
    """맹약 하나의 중첩 수치 — [{k: 코드, u: 단위, b: 기본값, p: 중첩 1당, s: 몇 번째 단계}]

    s(단계 번호)는 "6명 배치 시" 같은 **상위 단계 효과에도 중첩 계수가 붙는지**를 화면에서
    보여 주기 위한 것이다 (사용자 물음 2026-08-24). 게임의 파라미터 목록은 설명문에
    '(중첩 수에 따라 변경)'이 나오는 **순서 그대로**라, 그 표식을 가진 단계에 앞에서부터
    나눠 준다. 표식보다 파라미터가 많은 경우(시라쿠사 공속+지속시간이 한 표식 안에 있고,
    기습은 목록이 HP를 빠뜨려 우리가 채웠다)는 **남는 몫을 첫 표식에** 붙인다 —
    두 사례 모두 원문과 대조해 확인했다.
    """
    base = b.get("descParamBaseList") or []
    per = b.get("descParamPerStackList") or []
    if not base:
        return []
    board = {}
    for blk in (KR["effectBuffInfoDataDict"].get(b.get("effectId")) or []):
        for kv in (blk.get("blackboard") or []):
            board.setdefault(kv["key"], kv["value"])
    # ⚠ 표식 위치는 **한국어 원문**에서 센다 — 로케일 문구에는 '중첩 수에 따라 변경'이라는
    #   말이 없다. 단계 구성(줄 수·순서)은 로케일이 같으므로 인덱스를 그대로 쓴다.
    #   (2026-08-24: 로케일 steps로 세다가 EN/JA에서만 단계 표식이 통째로 빠졌다)
    kr_steps = steps_of(b["desc"])
    marks = [i for i, st in enumerate(kr_steps)
             if "중첩 수에 따라 변경" in (st.get("c") or "") + st["t"]]
    pairs = [(bk, per[i] if i < len(per) else None) for i, bk in enumerate(base)]
    for bk in STACK_EXTRA.get(b["bondId"], []):
        pairs.append((bk, re.sub(r"^base_", "", bk) + "_per_stack"))
    out = []
    for bk, pk in pairs:
        meta = STACK_META.get(bk)
        bv, pv = board.get(bk), board.get(pk) if pk else None
        if not meta or bv is None:
            if bv is None:
                print(f"  ⚠ 맹약 {b['bondId']}: 블랙보드에 {bk} 없음", file=sys.stderr)
            elif not meta:
                print(f"  ⚠ 맹약 {b['bondId']}: STACK_META에 {bk} 미등록", file=sys.stderr)
            continue
        row = {"k": meta[0], "u": meta[1], "b": round(bv, 6)}
        if pv:
            row["p"] = round(pv, 6)
        out.append(row)
    # 단계 배정 — 뒤에서부터 표식 하나에 하나씩, 남는 몫은 첫 표식으로
    if marks:
        for j, row in enumerate(out):
            m = len(out) - j          # 이 행 뒤로 남은 개수(자기 포함)
            row["s"] = marks[max(0, len(marks) - m)]
    # 설명문이 감춘 상수 — 중첩과 무관하므로 p가 없다
    for code, unit, key, step, cap_key, cap_unit in BOND_CONST.get(b["bondId"], []):
        v = board.get(key)
        if v is None:
            print(f"  ⚠ 맹약 {b['bondId']}: 블랙보드에 {key} 없음 (BOND_CONST)", file=sys.stderr)
            continue
        row = {"k": code, "u": unit, "b": round(v, 6), "s": step}
        if cap_key is not None and board.get(cap_key) is not None:
            row["cap"] = round(board[cap_key], 6)
            row["capU"] = cap_unit
        out.append(row)
    # 같은 단계 안에서는 **상수 먼저, 중첩 계수 나중** — 쉐라그처럼 "기본 배율 / 특정 상태에
    # 추가 배율"인 경우 기본값이 먼저 와야 읽힌다 (설명문 순서와도 같다)
    out.sort(key=lambda r: (r.get("s", 0), 1 if "p" in r else 0))
    return out

TRAPS = KR["trapChessDataDict"]           # 115 — 장비(일반/강화)
TRAPSHOP = KR["trapShopChessDatas"]       # 59  — 상점 장비 목록
BANDS = KR["bandDataListDict"]            # 36  — 밴드(시작 조직)
EFFECTS = KR["effectInfoDataDict"]        # 361 — 효과 이름·설명 (장비·밴드·전략 공용)

# 능력 분류 아이콘 — eventTypeIcon(icon_battle 등)에서 접미만 딴다
TYPE_ICON = {"icon_battle": "battle", "icon_bond": "bond", "icon_gold": "gold", "icon_support": "support"}

# ── 특질(전용 능력) 분류 — 오퍼레이터 필터용 (사용자 요청 2026-08-23) ─────────────
# 발동 시점은 원문에 <획득 시> 같은 홑화살괄호 마커로 박혀 있고(rich()가 보존한다),
# '맹약이 N회 중첩할 때마다'·'중첩 수 +N'·'전방 1칸' 같은 효과 유형은 문구 패턴이 고정돼
# 있어 정규식으로 갈린다. ⚠ 분류는 **항상 KR 원문**으로 한다 — EN/JA 데이터도 설명문이
# 한국어 그대로라(krOnly) 로케일마다 태그가 갈리면 안 된다.
#   tg  = 카테고리 코드 목록 (하나의 능력이 여러 카테고리에 속할 수 있다 —
#         예: "<휴식 기간 종료 시> [빅토리아] 맹약의 중첩 수 +1" 은 restEnd + stack)
#   evb = 'every'(중첩될 때마다)일 때 그 능력이 세는 맹약 id **목록** (병기 가능 —
#         "[사르곤]/[고수] 맹약이"). 특정 맹약이 아니라 '핵심 맹약'을 세면 ["core"].
TRIG_TAGS = [
    ("acq", "<획득 시>"), ("restEnd", "<휴식 기간 종료 시>"), ("restIn", "<휴식 기간 진입 시>"),
    ("sell", "<판매 시>"), ("battle", "<전투 중>"), ("deploy", "<배치 시>"),
]
# '맹약을 중첩' = **계속해서** 쌓을 수 있는 것만 (사용자 확정 2026-08-23: 필라에·가비알처럼
# 스킬 발동마다 쌓는 류. 파피루스는 '스킬 **처음** 발동 시' 1회라 제외 — 획득 시·휴식 기간
# 종료 시처럼 트리거당 한 번뿐인 중첩은 그 트리거 카테고리로 충분하다).
# 반복 트리거 = "~할 때마다" / "스킬 발동 시"(처음 아님) / "적 처치 시"(첫 아님) /
# "(전투당 최대 N회)" 상한부(상한이 있다는 것 자체가 반복된다는 뜻) / 남의 중첩에 얹는 증폭.
STACK_RE = re.compile(r"중첩 수 ?\*{0,2}\+")
# '최대 N회'에 '전투당' 접두를 강제하지 않는다 — 데겐블레허(garrison_155)는 "(최대 24회 중첩)"
# 이라 접두 없이 같은 기전(배치마다 중첩·상한)이다 (전수 감사 2026-08-23에서 걸림).
REPEAT_RE = re.compile(r"때마다|스킬 발동 시|적을? 처치 시|최대 ?\*{0,2}\d+\*{0,2}회|증가할 경우")
FIRST_KILL_RE = re.compile(r"첫 ?\*{0,2}\d*\*{0,2}회? ?적을? 처치")
# "[사르곤]/[고수] 맹약이 3회 중첩할 때마다"처럼 여러 맹약이 병기된다 (실데이터 6쌍 —
# 전수 감사 2026-08-23에서 마지막 하나만 잡던 버그가 걸림). 병기 전체를 잡아 evb를 목록으로.
EVERY_RE = re.compile(r"((?:\[[^\]]+\][/·, ]*)+|핵심 )맹약이 \*{0,2}\d+\*{0,2}회 중첩[할될] 때마다")
POS_RE = re.compile(r"(전방|후방|주변|근처|주위) ?\*{0,2}\d")


# ── 특질이 올려 주는 중첩 — 구조화 (사용자 요청 2026-08-30 "어느 상황에 어느 맹약이
# 몇 개씩 추가되는지 전부 토탈") ──────────────────────────────────────────────
# 설명문(KR 원문)을 시점(w)·대상(to)·수치(n)로 갈라 gn 행으로 낸다. 시뮬레이터가 판에
# 올라온 기물들의 gn 을 시점별로 합산한다.
#   w  = acq 획득 · restIn 휴식 진입 · restEnd 휴식 종료 · deploy 배치 · down 쓰러질 시 ·
#        battle 전투 중(시작 포함) · refresh 갱신 · sell 판매
#   to = 맹약 id 목록 | "own"(자신이 속한 맹약) | "ownAct"(자신의 활성화된 맹약) |
#        "top"(가장 많이 중첩된 맹약) | "benchAct"(정비 구역 각 오퍼의 활성화된 맹약)
#   c  = 1 이면 **조건부** — 횟수·확률·남의 행동에 달려 있어 합산 불가. 화면은 설명문을
#        그대로 보여 준다 (수치를 절반만 합쳐 확정값처럼 보이면 안 된다, autochess-board.ts
#        머리주석과 같은 원칙).
#   per= "bench"(정비 구역 오퍼 1명당) | "tiers"(전장의 pb 소속 각기 다른 티어 1명당) —
#        1명당류 중 **판만 보고 셀 수 있는** 두 형태만 확정으로 남긴다.
#   na = 맹약 활성화 불필요 · bn = 정비 구역에 있어도 적용 · nb = 전방(f)/후방(b) 1칸에도
GAIN_W_MARK = [("acq", "<획득 시>"), ("restIn", "<휴식 기간 진입 시>"), ("restEnd", "<휴식 기간 종료 시>"),
               ("deploy", "<배치 시>"), ("down", "<쓰러질 시>"), ("battle", "<전투 중>"),
               ("battle", "<전투 시작 시>"), ("refresh", "<갱신 시>"), ("sell", "<판매 시>")]
# ⚠ "1명당"은 기본이 조건부다 — garrison_119(휴식 기간에 획득한 오퍼 1명당)를 확정으로
#   오분류했던 시제품 버그(2026-08-30). 셀 수 있는 두 형태는 probe 에서 문구를 지워 살린다.
GAIN_COND_RE = re.compile(r"때마다|1명당|확률|첫 |처음|보급센터|증가할 경우|특질 획득|될 경우|쓰러[질지]|적 처치|스킬 발동|같은 행|이번 라운드")
GAIN_BENCH_RE = re.compile(r"정비 구역에 있는 오퍼레이터 1명당")
GAIN_TIER_RE = re.compile(r"전장에 있는 각기 다른 티어의 ((?:\[[^\]]+\][/·, ]*)+)오퍼레이터 1명당")
GAIN_NB_RE = re.compile(r"자신과 (전방|후방) 1칸 오퍼레이터의 활성화된 맹약")
GAIN_PAIR_RE = re.compile(r"((?:\[[^\]]+\][/·, ]*)+)(?:맹약의? )?중첩 수 \*\*\+(\d+)\*\*")
GAIN_OWN_RE = re.compile(r"자신이 속한 맹약의 중첩 수 \*\*\+(\d+)\*\*")
GAIN_OWNACT_RE = re.compile(r"자신(?:과 (?:전방|후방) 1칸 오퍼레이터)?의 활성화된 맹약(?:의)? 중첩 수 \*\*\+(\d+)\*\*")
GAIN_TOP_RE = re.compile(r"가장 많이 중첩된 맹약의 중첩 수 \*\*\+(\d+)\*\*")
GAIN_BENCHACT_RE = re.compile(r"정비 구역에 있는 각 오퍼레이터의 활성화된 맹약 중첩 수 \*\*\+(\d+)\*\*")


def stack_gains(kr_text, bond_id_by_kr_name):
    """KR 설명문 → gn 행 목록 (중첩을 올리는 특질이 아니면 None)."""
    if "중첩 수" not in kr_text:
        return None
    # '중첩 수를 세기만 하는'(every) 문장 — "N회 중첩할 때마다"만 있고 +를 안 올리면 대상 아님
    if "중첩 수 **+" not in kr_text and "중첩 수 획득" not in kr_text:
        return None
    ws = gain_timings(kr_text)   # 시점 마커가 없으면 battle (부여형 등)
    na = "맹약 활성화 불필요" in kr_text
    bn = "정비 구역에 있어도" in kr_text
    per = pb = nb = None
    m = GAIN_NB_RE.search(kr_text)
    if m:
        nb = "f" if m.group(1) == "전방" else "b"
    if GAIN_BENCH_RE.search(kr_text):
        per = "bench"
    m = GAIN_TIER_RE.search(kr_text)
    if m:
        per = "tiers"
        pb = [bond_id_by_kr_name[n] for n in re.findall(r"\[([^\]]+)\]", m.group(1)) if n in bond_id_by_kr_name]
    probe = GAIN_BENCH_RE.sub("", GAIN_TIER_RE.sub("", kr_text))
    if GAIN_COND_RE.search(probe):
        return [{"w": w, "c": 1} for w in ws]
    rows = []
    for m in GAIN_BENCHACT_RE.finditer(kr_text):
        rows.append({"to": "benchAct", "n": int(m.group(1))})
    for m in GAIN_OWN_RE.finditer(kr_text):
        rows.append({"to": "own", "n": int(m.group(1))})
    if not any(r["to"] == "benchAct" for r in rows):   # benchAct 문장은 ownAct 패턴에도 걸린다
        for m in GAIN_OWNACT_RE.finditer(kr_text):
            rows.append({"to": "ownAct", "n": int(m.group(1))})
    for m in GAIN_TOP_RE.finditer(kr_text):
        rows.append({"to": "top", "n": int(m.group(1))})
    for m in GAIN_PAIR_RE.finditer(kr_text):
        names = re.findall(r"\[([^\]]+)\]", m.group(1))
        ids = [bond_id_by_kr_name[n] for n in names if n in bond_id_by_kr_name]
        if ids:
            rows.append({"to": ids, "n": int(m.group(2))})
    if not rows:
        return [{"w": w, "c": 1} for w in ws]   # 수치를 못 읽으면 조건부로 강등 (30: 보급센터 레벨)
    out = []
    for w in ws:
        for r in rows:
            e = {"w": w, **r}
            if na:
                e["na"] = 1
            if bn:
                e["bn"] = 1
            if per:
                e["per"] = per
            if pb:
                e["pb"] = pb
            if nb:
                e["nb"] = nb
            out.append(e)
    return out


# ── 특질이 주는 자금·무료 갱신·아이템 — 구조화 (사용자 요청 2026-08-30 "중첩뿐만 아니라
# 스와이어처럼 아이템이나 자금 같은 것도") ───────────────────────────────────────
#   k = "gold" 자금 · "ref" 무료 갱신 · "item" 아이템(it = 장비 id) · "res" 조건부(설명문 표시)
#   확률·랜덤·'또는'·'~할 경우'·같은 행 조건·오퍼레이터 획득(대상 유동)은 전부 조건부.
# ⚠ 따옴표 이름을 통째로 힌트로 삼으면 안 된다 — "'휴식 기간 진입 시' 특질 보유"(프틸롭시스)
#   같은 특질 부여·복제형이 자원으로 오분류됐다 (2026-08-30 실측 3건). 반드시 "N개 획득"까지.
RES_HINT_RE = re.compile(r"자금 |무료 갱신|'[^']+' ?\d+개 획득|\d명 (?:랜덤 )?획득|랜덤으로|'획득 시' 특질 발동")
RES_COND_RE = re.compile(r"확률|또는|랜덤|경우|같은 행|특질 발동")
RES_GOLD_RE = re.compile(r"자금 \*{0,2}(\d+)\*{0,2} 추가 획득")
RES_REF_RE = re.compile(r"(\d+)회 무료 갱신 획득|무료 갱신 (\d+)회 획득")
RES_ITEM_RE = re.compile(r"'([^']+)' ?(\d+)개 획득")
# 스와이어 디 엘리건트 위트(garrison_98) — 정비 구역 적용이 "[염국]/[투자자] 활성화 시"로
# 조건부다. bna = 그 맹약 중 하나라도 발동 중이면 정비 구역에서도 센다.
RES_BNA_RE = re.compile(r"\(((?:\[[^\]]+\][/·, ]*)+)활성화 시 정비 구역에 있어도")


def gain_timings(kr_text):
    ws = []
    for w, mk in GAIN_W_MARK:
        if mk in kr_text and w not in ws:
            ws.append(w)
    return ws or ["battle"]


def res_gains(kr_text, bond_id_by_kr_name, equip_id_by_kr_name):
    """KR 설명문 → 자원 수급 행 목록 (자원을 주는 특질이 아니면 None)."""
    if "중첩 수" in kr_text or not RES_HINT_RE.search(kr_text):
        return None
    ws = gain_timings(kr_text)
    rows = []
    if not RES_COND_RE.search(kr_text):
        m = RES_GOLD_RE.search(kr_text)
        if m:
            rows.append({"k": "gold", "n": int(m.group(1))})
        for m in RES_REF_RE.finditer(kr_text):
            rows.append({"k": "ref", "n": int(m.group(1) or m.group(2))})
        for m in RES_ITEM_RE.finditer(kr_text):
            iid = equip_id_by_kr_name.get(m.group(1))
            if iid:
                rows.append({"k": "item", "it": iid, "n": int(m.group(2))})
            else:
                rows = []
                break
    if not rows:
        rows = [{"k": "res", "c": 1}]
    bna = None
    m = RES_BNA_RE.search(kr_text)
    if m:
        bna = [bond_id_by_kr_name[n] for n in re.findall(r"\[([^\]]+)\]", m.group(1)) if n in bond_id_by_kr_name]
    bn = bool(not bna and "정비 구역에 있어도" in kr_text)
    out = []
    for w in ws:
        for r in rows:
            e = {"w": w, **r}
            if bn:
                e["bn"] = 1
            if bna:
                e["bna"] = bna
            out.append(e)
    return out


def classify_gar(kr_text, bond_id_by_kr_name):
    """KR 설명문 → (tg 목록, evb, bs). 어느 카테고리에도 안 걸리면 tg=[] — 화면이 '그 외'로 묶는다.

    bs = 설명문이 [이름] 꼴로 언급하는 맹약 id 전부 (시뮬레이터의 '이 맹약을 돕는 특질' 판정용,
    사용자 요청 2026-08-23). 맹약이 아닌 대괄호([빅토리아]식 이름과 안 겹침)는 조용히 버린다.
    """
    tg, evb = [], None
    bs = [bond_id_by_kr_name[n] for n in dict.fromkeys(re.findall(r"\[([^\]]+)\]", kr_text))
          if n in bond_id_by_kr_name]
    for code, marker in TRIG_TAGS:
        if marker in kr_text:
            tg.append(code)
    m = EVERY_RE.search(kr_text)
    if m:
        tg.append("every")
        names = re.findall(r"\[([^\]]+)\]", m.group(1))
        evb = [bond_id_by_kr_name[n] for n in names if n in bond_id_by_kr_name] if names else ["core"]
        for n in names:
            if n not in bond_id_by_kr_name:
                print(f"  ⚠ '때마다' 맹약 이름을 못 찾음: [{n}] — {kr_text[:50]}")
        evb = evb or None
    if STACK_RE.search(kr_text) and REPEAT_RE.search(FIRST_KILL_RE.sub("", kr_text)):
        tg.append("stack")
    if POS_RE.search(kr_text):
        tg.append("pos")
    return tg, evb, bs

OPS = {loc: {o["id"]: o for o in json.load(open(os.path.join(DATA, f"operators{SUFFIX[loc]}.json"), encoding="utf-8"))}
       for loc in ("ko", "en", "ja")}


# {key} / {key:0%} / {-key} 토큰을 그 레벨의 blackboard 값으로 — build-skill-levels.py의
# value_at과 같은 규칙 (기물 상세 모달에 스킬·모듈 설명을 싣는다, 사용자 요청 2026-08-23).
TOKEN_RE = re.compile(r"\{(-?)([0-9a-zA-Z_@\[\].']+)(?::([^}]*))?\}")


def interp(text, blackboard, duration=None):
    bb = {str(e.get("key", "")).lower(): (e.get("valueStr") if e.get("valueStr") is not None else e.get("value"))
          for e in (blackboard or [])}
    if duration and duration > 0:
        bb.setdefault("duration", duration)

    def rep(m):
        neg, key, fmt = m.group(1) == "-", m.group(2).lower(), m.group(3) or ""
        if key not in bb:
            return m.group(0)
        v = bb[key]
        if isinstance(v, str):
            return v
        if neg:
            v = -v
        if "%" in fmt:
            v *= 100
            v = int(round(v)) if abs(v - round(v)) < 1e-6 else round(v, 1)
            return f"{v}%"
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        return str(round(v, 2) if isinstance(v, float) else v)
    return TOKEN_RE.sub(rep, text or "")


def skill_of(loc, cid, idx, level):
    """기물이 들고 나오는 스킬의 (이름, 그 레벨 설명). level은 1부터."""
    c = chars[loc].get(cid) or chars["ko"].get(cid)
    if not c or idx is None or idx < 0:
        return None, None, None
    sk = (c.get("skills") or [])
    if idx >= len(sk):
        return None, None, None
    sid = sk[idx].get("skillId")
    lvs = ((skills[loc].get(sid) or skills["ko"].get(sid) or {}).get("levels") or [])
    if not lvs:
        return None, None, None
    lv = lvs[min((level or 1) - 1, len(lvs) - 1)]
    entry = skills["ko"].get(sid) or {}
    icon = entry.get("iconId") or sid   # 아이콘 파일명 — iconId가 따로 있는 스킬이 있다
    return lvs[0].get("name"), rich(interp(lv.get("description"), lv.get("blackboard"), lv.get("duration"))), icon


def module_of(loc, ueid, equip_level=None):
    if not ueid:
        return None
    e = equips[loc].get(ueid) or equips["ko"].get(ueid)
    if not e:
        return None
    row = {"n": e.get("uniEquipName"), "i": e.get("typeIcon")}
    # 전투 효과 — battle_equip의 해당 단계(phase). 특성 변경·재능 강화 문구를 모아 잇는다.
    be = bequips[loc].get(ueid) or bequips["ko"].get(ueid) or {}
    phases = be.get("phases") or []
    if equip_level and phases:
        ph = phases[min(equip_level - 1, len(phases) - 1)]
        lines = []
        for part in ph.get("parts") or []:
            for bundle in ("overrideTraitDataBundle", "addOrOverrideTalentDataBundle"):
                for cand in (part.get(bundle) or {}).get("candidates") or []:
                    if (cand.get("requiredPotentialRank") or 0) > 0:
                        continue   # 잠재 조건부 판은 기본 잠재로 취급
                    txt = cand.get("additionalDescription") or cand.get("overrideDescripton") \
                        or cand.get("upgradeDescription") or cand.get("description")
                    if txt:
                        lines.append(rich(interp(txt, cand.get("blackboard"))))
        if lines:
            row["d"] = "\n".join(dict.fromkeys(lines))
        stats = [f"{STAT_KO.get(a.get('key'), a.get('key'))} +{int(a['value']) if float(a['value']).is_integer() else a['value']}"
                 for a in ph.get("attributeBlackboard") or []]
        if stats:
            row["s"] = " · ".join(stats)
    return row


# 모듈 능력치 키 → 화면 표기 (세 로케일 공통 게임 용어라 KR 표기 그대로 두면 안 된다 —
# 로케일별 표기는 화면(i18n)이 아니라 여기서 갈리기 어려워 대표 표기만 쓴다)
STAT_KO = {"max_hp": "HP", "atk": "ATK", "def": "DEF", "magic_resistance": "RES",
           "attack_speed": "ASPD", "cost": "COST", "respawn_time": "REDEPLOY"}


def build_locale(loc):
    a = act_of(loc)
    krOnly = a is None                      # EN — 설명문이 한국어로 나간다
    basic = acts[loc + "_basic"].get(ACT) or acts["ko_basic"][ACT]
    season_name = basic.get("name") or acts["ko_basic"][ACT]["name"]
    if loc == "en":                         # 시즌2가 EN에 없으므로 시즌1 이름을 쓴다(동일 제목)
        season_name = (acts["en_basic"].get(ACT1) or {}).get("name") or season_name

    # ── 맹약 ──
    bond_rows, bond_order = [], {}
    for bid, b in BONDS.items():
        name = loc_name(loc, "bondInfoDict", bid, "name", b["name"])
        if loc == "en" and name == b["name"] and bid in BOND_TEAM:
            t = teams["en"].get(BOND_TEAM[bid]) or {}
            name = t.get("powerName") or name
        bond_order[bid] = len(bond_rows)
        steps = steps_of(loc_desc(loc, "bondInfoDict", bid, "desc", b["desc"]))
        # 게이트는 **한국어 원문**에서 읽어 인덱스로 얹는다 (stack_rows 의 marks 와 같은 이유 —
        # 로케일 문구는 표현이 달라 파싱이 안 되고, 단계 구성은 세 언어가 같다)
        gates = [gate_of(st.get("c")) for st in steps_of(b["desc"])]
        if loc == "ko":
            validate_gates(bid, b, gates)
        # 정비구역(덱)까지 세게 되는 **해금 단계** 표식 — 예견·기적·투자자는 발동 범위가
        # BOARD_AND_DECK 이지만, 정비구역을 실제로 세는 건 이 단계(중첩 150·100·100)에
        # 도달한 뒤다. 문구가 "(정비 구역의 [X] 오퍼레이터도 맹약 활성화 가능)"으로 알려 준다.
        # ⚠ 그 전까지는 정비구역이 맹약에 **아무 영향이 없다** (사용자 지적 2026-08-29).
        kr_steps = steps_of(b["desc"])
        for i, (st, g) in enumerate(zip(steps, gates)):
            if g:
                st["g"] = g
            if i < len(kr_steps) and "정비 구역" in kr_steps[i]["t"]:
                st["dk"] = 1
        bond_rows.append({
            "id": bid,
            "n": name,
            "nation": bid in BOND_TEAM,     # 진영 맹약 여부 (특성 맹약과 갈라 보인다)
            "min": b.get("activeCount"),    # 발동 인원 임계값
            # 세는 범위 — BOARD(전장) / BOARD_AND_DECK(예비까지) / BOARD_ALL_CHESS(정예화 전원).
            # ⚠ '독행'만 downward다 — 인원이 **적을수록** 강해지므로 "N명부터"로 쓰면 뜻이 뒤집힌다.
            "cond": b.get("activeCondition"),
            **({"down": 1} if "downward" in (b.get("activeConditionTemplate") or "") else {}),
            # 중첩 개념이 없는 맹약 (조화·협동방어·독행·궁극기) — 계산기가 중첩 칸을 안 그린다
            **({"ns": 1} if b.get("noStack") else {}),
            "steps": steps,
            **({"stk": stk} if (stk := stack_rows(b)) else {}),
            # 중첩 개념이 **아예 없는** 맹약이 넷 있다 (조화·협동방어·독행·궁극기) —
            # 계수도 없고 문구가 중첩을 언급조차 않는다. 그런데도 화면이 중첩 입력칸을
            # 내주면 "여긴 중첩 없지 않냐"가 된다 (사용자 지적 2026-08-30).
            # ⚠ 판정은 **한국어 원문**으로 한다 — EN/JA는 문구가 번역돼 정규식이 안 먹는다.
            **({"stku": 1} if (stk or any("중첩" in (st.get("t") or "") + (st.get("c") or "")
                                          for st in kr_steps)) else {}),
            "chess": [],                    # 아래에서 채운다
        })

    # ── 기물 ──
    # `isHidden`은 이름 그대로 **보급센터(상점) 미진열**이라는 뜻이고, 그 이상이 아니다.
    # 붙은 17개를 "같은 charId가 다른 티어에 살아 있나"로 가르면 성격이 완전히 갈린다:
    #
    #   ① 짝이 있는 8건 = **옛 티어 잔재** → 버린다. 티어가 옮겨지면서 옛 항목이 숨김으로
    #      남고 새 티어 항목이 목록 끝에 덧붙는다 (틴맨 T1→T2, 쉐라 T4→T3, 레코드키퍼 T4→T5,
    #      와파린·시빌라이트 에테르나·프틸롭시스·가비알 디 인빈서블 T5→T4, 님프 T6→T5).
    #      남기면 같은 오퍼가 두 번, 하나는 틀린 티어로 뜬다.
    #
    #   ② 짝이 없는 9건 = **상점에만 안 뜨는 실존 기물** → 남긴다 (offshop=1).
    #      비그나·어스스피릿·맹약 서포터·클리프하트·아코르트·인포서·샤마르·비즈왁스·로즈솔트.
    #
    # ⚠ 2026-09-02 정정 — 종전엔 17개를 통째로 버렸다. 2026-08-24에 ②도 "게임에 아예 없다"고
    #   판단했는데(“비즈왁스는 아예 없는데?”), 그건 **상점에서 안 보인다**는 관찰이었고 실제로는
    #   맹약에서 직접 뽑는 경로로 나온다. 사용자 실사용 제보 2026-09-02: 퍼퓨머(조력·협동방어)에
    #   〈의태 물질〉을 끼워 **로즈솔트**(협동방어)가 나왔고, 다른 사람은 **클리프하트**도 봤다.
    #   둘 다 ②에 있다. 통째로 버리면 맹약 소속 인원이 11개 맹약에서 모자라게 나온다
    #   (조력 8→11, 불굴 7→9, 협동방어 5→7 …) — 시너지 판정에 쓰는 숫자라 표시만의 문제가 아니다.
    #   그래서 bondInfoDict.chessIdList가 숨김 기물을 품고 있는 것은 데이터 찌꺼기가 아니라
    #   **뽑기 풀 그 자체**다. 맹약 소속 목록에서도 ②는 빼지 않는다.
    LIVE_CHARS = {c["charId"] for c in CHESS.values() if not c.get("isHidden")}
    STALE = {cid for cid, c in CHESS.items()
             if c.get("isHidden") and c.get("charId") in LIVE_CHARS}
    OFFSHOP = {cid for cid, c in CHESS.items()
               if c.get("isHidden") and c.get("charId") not in LIVE_CHARS}

    # ── OFFSHOP 기물의 획득 경로 (2026-09-02) ────────────────────────────────
    # 보급센터에 안 뜨니 "그럼 어떻게 얻느냐"를 기물마다 적어 준다. 판정 기준은
    # **효과 문구에 '보급센터'가 없고 맹약/풀에서 곧장 주는 것**이다 — 보급센터를 거치는
    # 경로(호출 모듈·긴급 차출권·비콘·상업 포장 계획·헤드헌터·구류의 인연·집단 행동·
    # 클리어 보상)는 진열이 막혀 있어 OFFSHOP이 나올 수 없다.
    #   · WAY_ANY   착용자와 같은 맹약이면 무엇이든 → 9종 전부 해당
    #   · WAY_FIX   특정 기물을 고정 지급 (우등생 → 맹약 서포터)
    #   · 진영 지원 allybuff_select_7_* 은 blackboard의 bond로 맹약을 맞춰 붙인다.
    #     ⚠ 이 8종을 참조하는 컨테이너를 못 찾았다 — 협동 지원 선택지로 보이나 확정 못 해
    #     `maybe: 1`로 내보내고 화면이 "가능성 있음"으로 낮춰 쓴다.
    WAY_ANY = ["eff_acarm069", "eff_acarm114"]        # 의태 물질 · 간이 통신기
    WAY_FIX = {}                                       # chessId → [effectId]
    WAY_BOND = {}                                      # bondId  → effectId (미확정)
    for _eid, _arr in (KR.get("effectBuffInfoDataDict") or {}).items():
        for _b in (_arr or []):
            _bb = {x.get("key"): x.get("valueStr") for x in (_b.get("blackboard") or [])}
            if _b.get("key") == "single_special_choice_gain_bond_chess" and _bb.get("bond"):
                WAY_BOND[_bb["bond"]] = _eid
            if _b.get("key") == "preparation_start_gain_chess_from_round" and _bb.get("chess", "").startswith("chess_char_"):
                WAY_FIX.setdefault(_bb["chess"], []).append(_eid)

    # 효과 id → 그 효과를 지닌 화면 항목 (누르면 상세가 열리게 — 사용자 요청 2026-09-02
    # "의태물질같은것도 다 매핑시켜주고"). doc.refs는 게임 문구에 실제로 등장한 이름만
    # 담아서 여기 이름들(의태 물질·간이 통신기·우등생)이 없다 — 그래서 따로 푼다.
    WAY_TARGET = {}                                    # effectId → (kind, id)
    for _tid, _t in (KR.get("trapChessDataDict") or {}).items():
        if _t.get("effectId") and not (KR["trapShopChessDatas"].get(_tid) or {}).get("hideInShop"):
            WAY_TARGET.setdefault(_t["effectId"], ("item", _tid))
    for _b in (KR.get("bandDataListDict") or {}).values():
        WAY_TARGET.setdefault(_b.get("effectId"), ("band", _b.get("bandId")))

    def ways_of(cid, bond_ids):
        """OFFSHOP 기물 하나의 획득 경로 — [{e: 효과명, k/id: 링크 대상, maybe?: 1}]"""
        name = lambda e: (loc_name(loc, "effectInfoDataDict", e, "effectName",
                                   (EFFECTS.get(e) or {}).get("effectName")) or e)
        def row(e, maybe=False):
            r = {"e": name(e)}
            tgt = WAY_TARGET.get(e)
            if tgt:
                r["k"], r["tid"] = tgt
            if maybe:
                r["maybe"] = 1
            return r
        rows = [row(e) for e in WAY_FIX.get(cid, [])]
        rows += [row(e) for e in WAY_ANY]
        rows += [row(WAY_BOND[b], True) for b in bond_ids if b in WAY_BOND]
        return rows

    # 직군 코드 → 로케일 라벨. NPC 기물(예비 오퍼레이터·맹약 서포터 등)은 operators.json에
    # 없어 rarity·job이 비는데, 화면에서 ★와 직군 칩이 통째로 사라진다 (전수 대조 2026-08-23).
    # 그래서 클뜯 character_table로 폴백한다.
    job_label = {}
    for _o in OPS[loc].values():
        job_label.setdefault(_o.get("jobCode"), _o.get("job"))
    RARITY_N = {"TIER_1": 1, "TIER_2": 2, "TIER_3": 3, "TIER_4": 4, "TIER_5": 5, "TIER_6": 6}

    chess_rows, gar_used = [], {}
    for cid, c in CHESS.items():
        if cid in STALE:
            continue
        base = CHESSDATA.get(cid) or {}
        gold_id = c.get("goldenChessId")
        gold = CHESSDATA.get(gold_id) or {}
        char_id = c.get("charId")
        op = OPS[loc].get(char_id) or OPS["ko"].get(char_id) or {}
        name = char_name(loc, char_id)
        if not name and c.get("chessType") == "DIY":
            name = {"ko": "자유 선택 슬롯", "en": "Free pick slot", "ja": "自由選択スロット"}[loc]
        # 남길 능력은 **한국어 blackboard 기준**으로 이미 골라 뒀다 (GAR_KEPT — 위 주석 참조)
        gar = list(GAR_KEPT.get(cid) or base.get("garrisonIds") or [])
        garG = list(GAR_KEPT.get(gold_id) or gold.get("garrisonIds") or [])
        for g in gar + garG:
            gar_used[g] = True
        row = {
            "id": cid,
            "gid": gold_id,
            "op": char_id,
            "n": name,
            "t": c.get("chessLevel"),           # 티어(코스트) 1~6
            "sort": c.get("shopLevelSortId"),
            # 기물 출처 — 이름과 달리 **상점 진열 여부가 아니다** (2026-09-02 실측):
            #   PRESET 모드가 고정 지급 (charId == backupCharId, 4★15·5★38·6★6)
            #   NORMAL 내 계정의 ★6, 미보유면 backupCharId의 예비 오퍼로 대체 (전원 ★6)
            #   DIY    자유 선택 슬롯
            # 둘 다 보급센터에 뜬다 — 진열에서 빠지는 건 isHidden(OFFSHOP)뿐이다.
            "kind": c.get("chessType"),
            "bonds": list(base.get("bondIds") or []),
            "gar": gar,
            "garG": garG,
            "up": base.get("upgradeNum"),       # 골든까지 필요한 장수
            # 보급센터 미진열 — 맹약에서 직접 뽑는 경로로만 나온다 (ways_of 주석)
            **({"off": 1, "ways": ways_of(cid, base.get("bondIds") or [])} if cid in OFFSHOP else {}),
        }
        if op:
            row["r"] = op.get("rarity")
            row["job"] = op.get("job")
            row["jobCode"] = op.get("jobCode")
            row["sub"] = op.get("subProfession")   # 세부직군 — 필터용 (사용자 요청 2026-08-23)
        elif char_id:
            # 백과사전에 없는 NPC 기물 — 성급·직군만이라도 클뜯에서 채운다
            cc = chars["ko"].get(char_id) or {}
            if cc.get("rarity") in RARITY_N:
                row["r"] = RARITY_N[cc["rarity"]]
            if job_label.get(cc.get("profession")):
                row["job"] = job_label[cc["profession"]]
                row["jobCode"] = cc.get("profession")
        # 본체 미보유 시 대체 출전하는 전용 캐릭터 (backupCharId ≠ charId, 55기물) —
        # 얼굴·이름만 바뀌고 맹약·특질·스킬 구성은 기물 것 그대로다 (사용자 스크린샷 검증
        # 2026-08-23: 르무엔 미보유 계정의 '스톰아이' 특질 = garrison_24 = 르무엔 기물 특질).
        bk = c.get("backupCharId")
        if bk and char_id and bk != char_id:
            row["bk"] = {"op": bk, "n": char_name(loc, bk) or bk}
        # 스킬·모듈 설명 (사용자 요청 2026-08-23: 도감 링크 대신 모달 안에서 바로 읽게.
        # 이어서 "1·2스와 보유 모듈 전부 설명을 붙이고, 기본 구성에는 '디폴트'만 표시").
        # 기물의 스킬 레벨·모듈 단계는 CHESSDATA status에 있다 — 일반/골든이 다르다
        # (예: 인사이더 일반 Lv4 → 골든 Lv7 + 모듈 1단계. 일반은 equipLevel 0 = 모듈 없음).
        st_b, st_g = base.get("status") or {}, gold.get("status") or {}
        idx = c.get("defaultSkillIndex")
        n_skills = len((chars["ko"].get(char_id) or {}).get("skills") or [])
        sks = []
        for i2 in range(n_skills):
            n2, d2, ic2 = skill_of(loc, char_id, i2, st_b.get("skillLevel"))
            if not n2:
                continue
            sk_row = {"n": n2, "i": i2 + 1, **({"ic": ic2} if ic2 else {})}
            if d2:
                sk_row["d"] = d2
                sk_row["lv"] = st_b.get("skillLevel")
            _, d2g, _ic = skill_of(loc, char_id, i2, st_g.get("skillLevel"))
            if d2g and d2g != d2:
                sk_row["dG"] = d2g
                sk_row["lvG"] = st_g.get("skillLevel")
            if i2 == idx:
                sk_row["df"] = 1
            sks.append(sk_row)
        if sks:
            row["sks"] = sks
        mods = []
        for eid in char_equips["ko"].get(char_id) or []:
            e0 = equips["ko"].get(eid) or {}
            if e0.get("type") == "INITIAL":
                continue   # 기본형(빈) 모듈 — 효과가 없다
            md = module_of(loc, eid, st_g.get("equipLevel"))
            if md:
                if eid == c.get("defaultUniEquipId"):
                    md["df"] = 1
                mods.append(md)
        if mods:
            row["mods"] = mods
            if not (st_b.get("equipLevel") or 0):
                row["modG"] = 1   # 모듈 슬롯은 골든부터 열린다
        chess_rows.append(row)
        for bid in row["bonds"]:
            if bid in bond_order:
                bond_rows[bond_order[bid]]["chess"].append(cid)

    chess_rows.sort(key=lambda r: (r["t"] or 0, r["sort"] if (r["sort"] or 0) > 0 else 99, r["n"] or ""))

    # ── 기물 능력(garrison) — 참조된 것만 ──
    bond_id_by_kr_name = {b["name"]: bid for bid, b in BONDS.items()}
    # KR 장비 이름 → 장비 id (자원 수급의 '맹약코인' 같은 따옴표 이름을 장비 카드로 잇는다)
    equip_id_by_kr_name = {}
    for _iid, _s in TRAPSHOP.items():
        _eff = EFFECTS.get((TRAPS.get(_iid) or {}).get("effectId")) or {}
        if _eff.get("effectName"):
            equip_id_by_kr_name[_eff["effectName"]] = _iid
    gar_rows = {}
    for gid in gar_used:
        g = GARRISON.get(gid)
        if not g:
            continue
        kr_desc = rich(g["garrisonDesc"])
        tg, evb, bs = classify_gar(kr_desc, bond_id_by_kr_name)
        gn = (stack_gains(kr_desc, bond_id_by_kr_name) or []) + \
             (res_gains(kr_desc, bond_id_by_kr_name, equip_id_by_kr_name) or []) or None   # 항상 KR 원문 기준
        gar_rows[gid] = {
            "d": gar_desc(loc, gid, g),
            "t": loc_name(loc, "garrisonDataDict", gid, "eventTypeDesc", g.get("eventTypeDesc")),
            "ic": TYPE_ICON.get(g.get("eventTypeIcon"), "battle"),
            **({"tg": tg} if tg else {}),
            **({"evb": evb} if evb else {}),
            **({"bs": bs} if bs else {}),
            **({"gn": gn} if gn else {}),
        }

    # 중복 정리는 GAR_KEPT 가 이미 했다 (blackboard 기준, 로케일 무관) — 여기서는 정리 후
    # 아무 기물도 안 쓰는 능력만 사전에서 뺀다
    used_after = set()
    for row in chess_rows:
        for key in ("gar", "garG"):
            row[key] = [g for g in row[key] if g in gar_rows]
            used_after.update(row[key])
    gar_rows = {k: v for k, v in gar_rows.items() if k in used_after}

    # gn 전수 검증 — 확정 행에 수치·대상이 비면 파이프라인을 세운다 (validate_gates 와 같은 원칙:
    # 새 패치에서 문구 패턴이 바뀌면 조용히 틀린 합계를 내보내는 대신 여기서 터져야 한다)
    if loc == "ko":
        det = sum(1 for v in gar_rows.values() if any(not r.get("c") for r in v.get("gn", [])))
        cond = sum(1 for v in gar_rows.values() if v.get("gn") and all(r.get("c") for r in v["gn"]))
        res_det = sum(1 for v in gar_rows.values() for r in v.get("gn", []) if r.get("k") and not r.get("c"))
        print(f"  중첩 수급(gn): 확정 {det} · 조건부 {cond} · 자원 확정 행 {res_det}")
        for k, v in gar_rows.items():
            for r in v.get("gn", []):
                if r.get("c"):
                    continue
                if r.get("k") == "item" and not r.get("it"):
                    sys.exit(f"gn 검증 실패: {k} {r} — item 행에 it(장비 id)가 없다")
                if not r.get("n") or (not r.get("k") and not r.get("to")):
                    sys.exit(f"gn 검증 실패: {k} {r} — 확정 행에 n/to 가 없다")

    # ── 물자관리소(보급센터) ──
    tiers = []
    for lv, rows in sorted(KR["shopCharChessInfoData"].items(), key=lambda x: int(x[0])):
        cur = {"t": int(lv)}
        for e in rows:
            k = "g" if e.get("isGolden") else "b"
            cur[k] = {"buy": e.get("purchasePrice"), "sell": e.get("chessSoldPrice"),
                      "ph": e.get("evolvePhase"), "lv": e.get("charLevel"),
                      "sk": e.get("skillLevel"), "md": e.get("equipLevel")}
        tiers.append(cur)

    shop_levels = {}
    for mid, lv in KR["shopLevelDataDict"].items():
        shop_levels[mid] = [{"lv": int(k), "up": v.get("initialUpgradePrice"),
                             "slot": v.get("charChessCount"), "item": v.get("itemCount")}
                            for k, v in sorted(lv.items(), key=lambda x: int(x[0]))]

    # ── 모드 ──
    mode_rows = []
    for mid, m in KR["modeDataDict"].items():
        mode_rows.append({
            "id": mid,
            "n": loc_name(loc, "modeDataDict", mid, "name", m["name"]),
            "code": m.get("code"),
            "sort": m.get("sortId"),
            "diff": m.get("modeDifficulty"),
            "type": m.get("modeType"),
            "icon": (m.get("modeIconId") or "").replace("mode_", "").replace("_icon", ""),
            "color": m.get("modeColor"),
            "d": rich(loc_desc(loc, "modeDataDict", mid, "desc", m.get("desc"))),
            "eff": [rich(x) for x in (loc_desc(loc, "modeDataDict", mid, "effectDescList",
                                               m.get("effectDescList")) or [])],
            "bonds": list(m.get("activeBondIdList") or []),
        })
    mode_rows.sort(key=lambda r: (r["sort"] or 0, r["type"] or ""))

    # ── 장비 ──
    equip_rows = []
    for iid, s in TRAPSHOP.items():
        base = TRAPS.get(iid) or {}
        gold = TRAPS.get(s.get("goldenItemId")) or {}
        trap = base.get("charId") or ""
        ename = char_name(loc, trap) or trap
        eff = EFFECTS.get(base.get("effectId")) or {}
        effG = EFFECTS.get(gold.get("effectId")) or {}
        equip_rows.append({
            "id": iid,
            "trap": trap,
            "n": loc_name(loc, "effectInfoDataDict", base.get("effectId"), "effectName", eff.get("effectName")) or ename,
            "t": s.get("itemLevel"),
            "sort": s.get("shopLevelSortId"),
            "buy": base.get("purchasePrice"),
            "d": rich(loc_desc(loc, "effectInfoDataDict", base.get("effectId"), "effectDesc", eff.get("effectDesc"))),
            "dG": rich(loc_desc(loc, "effectInfoDataDict", gold.get("effectId"), "effectDesc", effG.get("effectDesc"))),
            "bond": base.get("giveBondId"),
            "up": base.get("upgradeNum"),
            "hide": bool(s.get("hideInShop")),
        })
    equip_rows.sort(key=lambda r: (r["t"] or 0, r["sort"] or 0))

    # ── 밴드 ──
    band_rows = []
    for bid, b in BANDS.items():
        eff = EFFECTS.get(b.get("effectId")) or {}
        nm = loc_name(loc, "effectInfoDataDict", b.get("effectId"), "effectName", eff.get("effectName"))
        desc = rich(loc_desc(loc, "bandDataListDict", bid, "bandDesc", b["bandDesc"]))
        # 설명 앞머리의 [효과명] 중복 제거 — 카드 제목에 이미 있다. 로케일마다 괄호가 달라
        # (KR `[집중 케어]`, JA `【厳重監護】：`) 이름이 일치할 때만 떼어 낸다. EN은 설명이
        # 한국어 폴백이라 한국어 효과명으로도 대조한다. 둘째 줄부터의 대괄호는 건드리지 않는다
        # (band_dusk 처럼 효과가 두 개인 밴드가 있다).
        aliases = {x for x in (nm, eff.get("effectName")) if x}
        m = re.match(r"^[\[【]([^\]】]{1,24})[\]】][:：]?\s*", desc)
        if m and m.group(1).strip() in aliases:
            desc = desc[m.end():]
        # 해금 조건과 대표 오퍼레이터 이름은 시즌 블록이 아니라 **최상위 autoChessData**의
        # bandDataDict에 있다 (사용자 요청 2026-08-22 "전략 상세모달에 해금조건도").
        # 37개 중 26개만 조건이 있다 — 나머지는 처음부터 열려 있는 전략이다.
        ob = (outers[loc].get("bandDataDict") or {}).get(bid) or {}
        ob_kr = (outers["ko"].get("bandDataDict") or {}).get(bid) or {}
        band_rows.append({
            "id": bid,
            "icon": bid.replace("band_", ""),
            "n": nm or bid,
            "hp": b.get("totalHp"),
            "modes": list(b.get("modeTypeList") or []),
            "d": desc,
            "sort": b.get("sortId"),
            "by": ob.get("bandName") or ob_kr.get("bandName") or "",
            "un": rich(ob.get("unlockDesc") or ob_kr.get("unlockDesc") or ""),
        })
    band_rows.sort(key=lambda r: r["sort"] or 0)

    # ── 전략(버프 선택지) ──
    buff_rows = []
    for eid, e in EFFECTS.items():
        if e.get("effectType") != "BUFF_GAIN":
            continue
        buff_rows.append({
            "id": eid,
            "n": loc_name(loc, "effectInfoDataDict", eid, "effectName", e.get("effectName")),
            "d": rich(loc_desc(loc, "effectInfoDataDict", eid, "effectDesc", e.get("effectDesc"))),
            "round": e.get("continuedRound"),
        })
    buff_rows.sort(key=lambda r: r["n"] or "")


    # ── 특수 적 ──
    # 유형별로 '대장' 한 마리(specialEnemyKey)가 뽑히고, 그 라운드에는 딸린 일반/정예
    # 적(attached*)이 함께 나온다. 화면에서 초상 카드 + 상세 모달로 보여 주므로
    # 딸린 적 이름도 함께 낸다 — 적 도감(1MB)은 모달을 열 때만 지연 로드되기 때문에,
    # 카드/목록 단계에서 이름이 비어 보이면 안 된다.
    sp_rows = []
    sp_names = {}

    def en_name(key):
        e = enemies[loc].get(key) or enemies["ko"].get(key) or {}
        return e.get("name") or key

    for key, s in KR["specialEnemyInfoDict"].items():
        e = enemies[loc].get(key) or enemies["ko"].get(key) or {}
        an = list(s.get("attachedNormalEnemyKeys") or [])
        ae = list(s.get("attachedEliteEnemyKeys") or [])
        sp_rows.append({
            "id": key,
            "n": e.get("name") or key,
            "code": e.get("enemyIndex"),
            "rank": e.get("enemyLevel"),
            "type": s.get("type"),
            "w": s.get("randomWeight"),
            "half": bool(s.get("isInFirstHalf")),
            "an": an,
            "ae": ae,
        })
        for k2 in [key, *an, *ae]:
            sp_names[k2] = en_name(k2)
    sp_rows.sort(key=lambda r: (r["type"] or "", -(r["w"] or 0), r["n"]))

    # ── 수배·특훈 (직접 고르는 적) ────────────────────────────────────────────
    # 사용자 지적 2026-08-29: "제셀톤이나 투척수 같은, 자기가 직접 골라야 나오는 적들".
    # 전략 선택지 중 **적을 불러오는 쪽**(ENEMY_GAIN)이 통째로 빠져 있었다 — 위에서 싣던 건
    # BUFF_GAIN(오퍼 지원류) 43종뿐이고, 이쪽은 129종이 0종이었다. 고르면 다음 전투에 그 적이
    # 나오고 처치·승리 시 자금을 준다 (제셀톤 윌리엄스 - 수배 = enemyeffect_b_9, 자금 4).
    #
    # 데이터가 균일해서 추출이 확정적이다 — 129종 전부 blackboard 에
    # enemy_id·count·coin·round 를 갖고 있다 (실측). 자금 조건만 세 갈래다:
    #   add_enemy_kill_gain_coin(109) 처치 시 · add_enemy_selfbattle_win_gain_coin(20) 승리 시
    #   next_battle_add_enemy_win_gain_coin(1) 다음 전투 승리 시
    COIN_WHEN = {"add_enemy_kill_gain_coin": "kill",
                 "add_enemy_selfbattle_win_gain_coin": "win",
                 "next_battle_add_enemy_win_gain_coin": "next"}
    hunt_rows = []
    for eid, e in EFFECTS.items():
        if e.get("effectType") != "ENEMY_GAIN":
            continue
        bb, when = {}, None
        for blk in (KR["effectBuffInfoDataDict"].get(eid) or []):
            when = COIN_WHEN.get(blk.get("key"), when)
            for kv in (blk.get("blackboard") or []):
                bb.setdefault(kv["key"], kv["valueStr"] if kv["valueStr"] is not None else kv["value"])
        enemy = bb.get("enemy_id")
        if not enemy:
            continue
        hunt_rows.append({
            "id": eid,
            "n": loc_name(loc, "effectInfoDataDict", eid, "effectName", e.get("effectName")),
            "d": rich(loc_desc(loc, "effectInfoDataDict", eid, "effectDesc", e.get("effectDesc"))),
            "e": enemy,                                   # 등장하는 적
            "c": int(bb.get("count") or 1),               # 마릿수
            "coin": int(bb.get("coin") or 0),             # 보상 자금
            **({"w": when} if when else {}),              # 자금을 언제 주나
            **({"r": int(bb["round"])} if bb.get("round") else {}),
        })
        sp_names.setdefault(enemy, en_name(enemy))        # 적 이름표를 같이 싣는다
    hunt_rows.sort(key=lambda r: (-r["coin"], r["n"] or ""))

    # ── 유형별 **전체 적 명단** (enemyInfoDict) ──
    # specialEnemyInfoDict는 각 부대의 '대표' 적 67종뿐이고, 같이 나오는 일반·정예 적은
    # 그 안의 attached* 에만 들어 있다. 그래서 화면에 대표만 깔면 게임의 '특훈 적 - 특이'
    # 목록보다 한참 짧아 보인다 (사용자 지적 2026-08-24: 특이 17종만 보였는데 실제 35종).
    # enemyInfoDict가 유형별 전 명단을 게임 표기 순서대로 갖고 있으므로 그걸 정본으로 싣고,
    # 각 적이 대표(sp)인지 함께 나오는 일반(n)·정예(e)인지만 표시한다.
    role_of = {}
    for key, s in KR["specialEnemyInfoDict"].items():
        role_of[key] = "sp"
        for k2 in (s.get("attachedNormalEnemyKeys") or []):
            role_of.setdefault(k2, "n")
        for k2 in (s.get("attachedEliteEnemyKeys") or []):
            role_of.setdefault(k2, "e")
    sp_by_id = {r["id"]: r for r in sp_rows}
    en_list = {}
    for ty, keys in (KR.get("enemyInfoDict") or {}).items():
        rows2 = []
        for key in keys:
            e = enemies[loc].get(key) or enemies["ko"].get(key) or {}
            sp = sp_by_id.get(key)
            rows2.append({
                "id": key,
                "n": e.get("name") or key,
                "code": e.get("enemyIndex"),
                "rank": e.get("enemyLevel"),
                "role": role_of.get(key, "n"),
                **({"w": sp["w"], "half": sp["half"]} if sp else {}),
            })
            sp_names.setdefault(key, en_name(key))
        en_list[ty] = rows2

    # 유형은 '특훈 적 - 비행' 처럼 게임에 **공식 이름과 설명**이 있다 (autoChessData).
    # 처음엔 내부 enum(FLY/TIMES/…)만 보고 우리 말을 지어냈는데, 사용자가 게임 표기를
    # 알려 줘서 바로잡았다 (2026-08-22) — TIMES는 '부활'이 아니라 '빈도', REFLECTION은 '굴절'.
    otype = (outers[loc].get("enemyTypeDatas") or {})
    otype_kr = (outers["ko"].get("enemyTypeDatas") or {})
    sp_types = {}
    for k, v in KR["specialEnemyRandomTypeDict"].items():
        meta = otype.get(k) or otype_kr.get(k) or {}
        sp_types[k] = {
            "count": v.get("count"),
            "weight": v.get("weight"),
            "n": meta.get("name") or k,
            "d": rich(meta.get("description") or ""),
            "icon": meta.get("icon"),
            "sort": meta.get("sortId") or 99,
            # involveRandom=false 인 '특이'는 유형 추첨에 끼지 않는 기본 편성이다
            "rnd": bool(meta.get("involveRandom")),
        }

    # ── 리더 적(보스) ──
    # act2 쪽 bossInfoDict는 HP·가중치만, 최상위 autoChessData 쪽은 적 id를 준다 — 합친다.
    # handbookEnemyId가 따로 있는 경우(보스6·7)는 도감에 그 id로만 실려 있으니 그쪽을 쓴다.
    boss_meta = outers[loc].get("bossInfoDict") or outers["ko"].get("bossInfoDict") or {}
    boss_round = {}
    for mode_id, rounds in (KR.get("battleDataDict") or {}).items():
        if mode_id == "mode_training_1":
            continue          # 입문 튜토리얼은 라운드 수가 달라 같이 세면 헷갈린다
        for rnd, lst in rounds.items():
            for x in lst:
                if x.get("bossId"):
                    boss_round.setdefault(x["bossId"], set()).add(int(rnd))
    boss_rows = []
    for bid, b in KR["bossInfoDict"].items():
        m = boss_meta.get(bid) or {}
        eid = m.get("handbookEnemyId") or m.get("enemyId") or ""
        e = enemies[loc].get(eid) or enemies["ko"].get(eid) or {}
        boss_rows.append({
            "id": bid,
            "sort": b.get("sortId"),
            "enemy": eid,
            "n": e.get("name") or eid,
            "code": e.get("enemyIndex"),
            "w": b.get("weight"),
            "hide": bool(b.get("isHidingBoss")),
            "hp": {"funny": b.get("bloodPoint"), "normal": b.get("bloodPointNormal"),
                   "hard": b.get("bloodPointHard"), "abyss": b.get("bloodPointAbyss")},
            "round": sorted(boss_round.get(bid, [])),
        })
        if eid:
            sp_names.setdefault(eid, e.get("name") or eid)
    boss_rows.sort(key=lambda r: r["sort"] or 0)

    # ── 마일스톤 ──
    ms_rows = []
    for m in KR["milestoneList"]:
        it = m.get("rewardItem") or {}
        info = item_of(loc, it.get("id"))
        ms_rows.append({
            "lv": m.get("milestoneLvl"),
            "tk": m.get("tokenNum"),
            "id": it.get("id"),
            "n": info.get("name") or it.get("id"),
            "c": it.get("count"),
        })

    # ── 자유 선택(DIY) 슬롯 후보 ──
    # 클뜯에는 후보 **목록**이 없고 등급 조건만 있다 — diyChessDict의 값이 "TIER_6"뿐이다.
    # 즉 "★6 오퍼레이터 아무나"가 조건이므로, KR에 나온 ★6 전원을 후보로 싣고
    # 그중 이 모드 상점 명단에 이미 들어 있는지(`in`)를 같이 표시한다.
    diy_tier = {}
    for slot, pool in (KR.get("diyChessDict") or {}).items():
        diy_tier[slot] = pool
    # ⚠ 미래시(중국 서버 선행, KR 미출시) 오퍼레이터는 뺀다 — 한국 서버 이벤트라
    #   중섭 오퍼는 자유 선택 칸에 나오지 않는다 (사용자 교정 2026-08-22).
    roster_ops = {c["op"] for c in chess_rows if c.get("op")}
    # 자유 선택 오퍼의 맹약 (사용자 확정 2026-08-23: "전부 진영 혹은 특성 맹약이 있음 —
    # 어떻게든 찾아와줘"). 시즌2 명단 밖 오퍼는 클뜯 어디에도 명시 배정이 없어 두 경로로 찾는다:
    #  ① 시즌1 명단에 있던 오퍼(46) — 그 배정 그대로 (골든글로우 → 빅토리아 ✓)
    #  ② 나머지 — 진영 맹약을 autoChessData.bondInfoDict의 powerIdList(진영 팀 id 목록)와
    #     character_table의 nationId/groupId/teamId 대조로 도출. 특성 맹약은 명단 밖 오퍼에
    #     대한 데이터가 없어 지어내지 않는다 (진영 없는 로도스 소속 등은 맹약 없이 남는다).
    s1_bonds = {}
    a1_ko = act1s.get("ko")
    if a1_ko:
        cdd1 = a1_ko.get("charChessDataDict") or {}
        rows1 = a1_ko.get("charShopChessDatas") or []
        for r1 in (rows1 if isinstance(rows1, list) else list(rows1.values())):
            cid1 = r1.get("charId")
            bl1 = (cdd1.get(r1.get("chessId")) or {}).get("bondIds") or []
            if cid1 and bl1:
                s1_bonds[cid1] = [b for b in bl1 if b in bond_order]
    power_map = {bid: set(b.get("powerIdList") or []) for bid, b in (outers["ko"].get("bondInfoDict") or {}).items()
                 if b.get("isPower") and bid in bond_order}

    def diy_bonds(oid):
        if s1_bonds.get(oid):
            return s1_bonds[oid]
        c0 = chars["ko"].get(oid) or {}
        ids = {c0.get("nationId"), c0.get("groupId"), c0.get("teamId")} - {None}
        return [bid for bid, pl in power_map.items() if ids & pl]

    diy_pool = []
    for oid, o in OPS[loc].items():
        if o.get("rarity") != 6 or o.get("unreleased"):
            continue
        bs = diy_bonds(oid)
        diy_pool.append({"op": oid, "n": o.get("name") or oid,
                         "job": o.get("job"), "seq": o.get("seq") or 0,
                         **({"bonds": bs} if bs else {}),
                         **({"in": 1} if oid in roster_ops else {})})
    diy_pool.sort(key=lambda r: -(r["seq"] or 0))

    # ── 대체 기물(NPC) — 자유 선택 판의 나머지 절반 ──
    # 게임의 자체 편성(자유 선택) 후보 = 명단 밖 보유 ★6 + 이 NPC들 (사용자 스크린샷
    # 2026-08-23 — 예비 오퍼레이터·예비 인원·튤립~미저리 ac시리즈·로드샤프가 항상 뜬다).
    # 클뜯 상 등장처는 charShopChessDatas.backupCharId 뿐이다: 진영·소속이 없어 맹약도 없고,
    # 본업은 본체 미보유 기물의 대체 출전 — '특질'은 그때 대체하는 기물의 것을 그대로 쓴다.
    subs_map = {}
    for cid2, c2 in CHESS.items():
        if cid2 in STALE:
            continue          # 걷어낸 중복 기물을 대체 대상으로 가리키지 않게
        bk2, main2 = c2.get("backupCharId"), c2.get("charId")
        if bk2 and main2 and bk2 != main2:
            subs_map.setdefault(bk2, []).append(cid2)
    diy_subs = []
    for bk2, targets in subs_map.items():
        cc = chars["ko"].get(bk2) or {}
        rar = RARITY_N.get(cc.get("rarity"), 0)
        targets.sort(key=lambda x: (-(CHESS[x].get("chessLevel") or 0), CHESS[x].get("shopLevelSortId") or 0))
        prof = cc.get("profession")
        diy_subs.append({"op": bk2, "n": char_name(loc, bk2) or bk2, "r": rar,
                         **({"job": job_label[prof]} if job_label.get(prof) else {}),
                         "subs": targets})
    diy_subs.sort(key=lambda r: (-(r["r"] or 0), r["n"] or ""))

    # ── 문구 상호 참조 (refs) ────────────────────────────────────────────────
    # 게임 문구는 다른 항목을 홑화살괄호·대괄호로 부른다 — "<염국> 오퍼레이터 1명 우선 등장",
    # "[사르곤] 오퍼레이터 스킬 발동", "<호출 모듈> 1개 획득", "일부 적이 <덕로드>로 변경".
    # 화면에서 눌러 그 상세를 바로 열 수 있게 **이름 → 대상** 매핑을 여기서 미리 풀어 싣는다
    # (사용자 요청 2026-08-24 "매핑할 수 있는 건 전부"). 런타임에 못 푸는 이유가 둘 —
    #   ① 이름이 로케일마다 다르다 (EN/JA 표가 따로 있어야 한다)
    #   ② 적 이름표는 1MB짜리 적 도감에만 있다 (autochess.json엔 이 모드에 나오는 적뿐)
    def _norm(s):
        return re.sub(r"\s+", "", s or "").lower()

    # 넣는 순서가 곧 우선순위다 (먼저 넣은 쪽이 이긴다).
    # 밴드의 대표 오퍼 이름(by)을 맨 뒤로 미루는 게 중요하다 — '덕로드'는 band_ducklord의
    # 대표 이름이면서 동시에 그 밴드가 소환하는 **적**이라, 문구가 부르는 쪽은 적이다.
    ref_index = {}

    def _put(kind, name, ident):
        k = _norm(name)
        if k and k not in ref_index:
            ref_index[k] = [kind, ident]

    for r in bond_rows:
        _put("bond", r["n"], r["id"])
    for r in equip_rows:
        _put("item", r["n"], r["id"])
    for r in band_rows:
        _put("band", r["n"], r["id"])
    for r in chess_rows:
        _put("op", r["n"], r["id"])
    for r in mode_rows:
        _put("mode", r["n"], r["id"])
    # 밴드의 대표 오퍼 이름(by)은 **맨 뒤**로 미룬다 — '덕로드'는 band_ducklord의 대표
    # 이름이면서 동시에 그 밴드가 소환하는 적이라, 문구가 부르는 쪽은 적이다.
    by_index = {}
    for r in band_rows:
        k = _norm(r.get("by"))
        if k and k not in ref_index and k not in by_index:
            by_index[k] = ["band", r["id"]]

    # 적 이름은 **홑화살괄호로 불릴 때만** 인정한다. 게임 문구에서 홑화살괄호는 고유명사
    # (아이템·소환물·특정 적), 대괄호는 분류(맹약·직군·팀)를 뜻하는데, 적 도감에는
    # '스나이퍼'·'캐스터' 같은 직군과 같은 이름의 잡몹이 있어서 그대로 두면
    # "[스나이퍼] 오퍼레이터의 공격력" 이 엉뚱한 잡몹 상세로 이어진다.
    enemy_index = {}
    for src in (enemies[loc], enemies["ko"]):     # EN은 설명이 한국어 원문이다 (krOnly)
        for key, e in src.items():
            k = _norm(e.get("name"))
            if k and k not in enemy_index:
                enemy_index[k] = ["enemy", key]

    refs = {}

    def _scan(o):
        if isinstance(o, dict):
            for v in o.values():
                _scan(v)
        elif isinstance(o, list):
            for v in o:
                _scan(v)
        elif isinstance(o, str):
            # 괄호 종류마다 따로 훑는다 — "<전장에 서로 다른 [사르곤] 오퍼레이터 6명 배치>"
            # 처럼 조건절이 대괄호 참조를 품고 있어서, 한 번에 훑으면 안쪽을 놓친다.
            # ⚠ 일본어판은 대괄호 대신 **【】** 를 쓴다 (JA 원문 실측 2026-08-24).
            for name in re.findall(r"<([^<>\n]{1,40})>", o):
                k = _norm(name)
                hit = ref_index.get(k) or enemy_index.get(k) or by_index.get(k)
                if hit:
                    refs[name] = hit
            for name in re.findall(r"[\[【]([^\[\]【】\n]{1,40})[\]】]", o):
                k = _norm(name)
                hit = ref_index.get(k) or by_index.get(k)
                if hit:
                    refs[name] = hit

    _scan([bond_rows, chess_rows, gar_rows, equip_rows, band_rows, buff_rows, hunt_rows, mode_rows, sp_types])

    # 문구가 부르는 적은 이 모드의 특훈 적 명단 밖일 수 있다 (덕로드·고프닉 …). 상세 모달이
    # 적 도감(1MB)을 받기 전에도 이름은 떠야 하므로 이름표에 미리 채워 둔다.
    for name, (kind, ident) in refs.items():
        if kind == "enemy":
            sp_names.setdefault(ident, name)

    const = KR["constData"]
    token = item_of(loc, const.get("milestoneId") or "")
    doc = {
        "id": ACT,
        "name": season_name,
        "season": SEASON,
        "cur": SEASON == LATEST,
        # 한국 서버 개최 기간 (basicInfo) — 지난 시즌 안내문에 그대로 쓴다
        "period": [BASIC.get("startTime"), BASIC.get("endTime")],
        "krOnly": krOnly,
        "token": token.get("name") or "",
        "const": {
            "deck": const.get("maxDeckChessCnt"),
            "board": const.get("maxBattleChessCnt"),
            "refresh": const.get("shopRefreshPrice"),
            "store": const.get("storeCntMax"),
            "borrow": const.get("borrowCount"),
            "hpCost": const.get("costPlayerHpLimit"),
        },
        "modes": mode_rows,
        "shop": {"tiers": tiers, "levels": shop_levels,
                 "diy": {k: (v.get("charChessDiySlotIdList") or [])
                         for k, v in KR["shopLevelDisplayDataDict"].items()
                         if v.get("charChessDiySlotIdList")},
                 "diyTier": diy_tier, "diyPool": diy_pool, "diySubs": diy_subs},
        "bonds": bond_rows,
        "chess": chess_rows,
        "gar": gar_rows,
        "equips": equip_rows,
        "bands": band_rows,
        "buffs": buff_rows,
        "hunts": hunt_rows,          # 직접 고르는 적 (수배·특훈) — ENEMY_GAIN
        "enemies": sp_rows,
        "enemyList": en_list,
        "enemyTypes": sp_types,
        "enemyNames": sp_names,
        "refs": refs,
        "bosses": boss_rows,
        "milestones": ms_rows,
        "rounds": [{"r": r["round"], "tk": (r.get("item") or {}).get("count")}
                   for r in KR["baseRewardDataList"]],
        "difficulty": KR["difficultyFactorInfo"],
    }
    return doc


docs = {}
for loc in ("ko", "en", "ja"):
    docs[loc] = build_locale(loc)
    path = os.path.join(DATA, out_name(SEASON, LATEST, SUFFIX[loc]) + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(docs[loc], f, ensure_ascii=False, separators=(",", ":"))
    print(f"{os.path.relpath(path, REPO)}  {os.path.getsize(path)/1024:.0f}KB", file=sys.stderr)

# 시즌 목록 — 화면의 시즌 전환기가 읽는다. 어느 시즌을 굽든 같은 내용이라 매번 덮어쓴다.
idx = [{"n": n, "id": aid, "file": out_name(n, LATEST),
        "s": (acts["ko_basic"].get(aid) or {}).get("startTime"),
        "e": (acts["ko_basic"].get(aid) or {}).get("endTime")} for n, aid in SEASONS]
with open(os.path.join(DATA, "autochess-seasons.json"), "w", encoding="utf-8") as f:
    json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))

d = docs["ko"]
print(f"시즌 {SEASON}/{LATEST} ({ACT})", file=sys.stderr)
print(f"  맹약 {len(d['bonds'])} · 기물 {len(d['chess'])} · 능력 {len(d['gar'])} · 장비 {len(d['equips'])}"
      f" · 밴드 {len(d['bands'])} · 전략 {len(d['buffs'])} · 특수 적 {len(d['enemies'])}"
      f" · 마일스톤 {len(d['milestones'])} · 모드 {len(d['modes'])}", file=sys.stderr)


# ── 아이콘 ───────────────────────────────────────────────────────────────────
def download(jobs):
    def one(job):
        url, dest = job
        if os.path.exists(dest):
            return None
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "terra-archive-autochess/1.0"})
            png = urllib.request.urlopen(req, timeout=60).read()
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            save_webp(png, dest)
            return None
        except Exception as err:  # noqa: BLE001 — 아이콘 한 장 실패해도 데이터는 낸다
            return (url, str(err))
    with ThreadPoolExecutor(12) as ex:
        return [f for f in ex.map(one, jobs) if f]


if not NO_ICONS:
    jobs = []
    for b in d["bonds"]:
        jobs.append((f"{AC_ARTS}/bondicon/icon_{b['id'].lower()}.png",
                     os.path.join(PUB, "bond", f"{b['id']}.webp")))
    for b in d["bands"]:
        jobs.append((f"{AC_ARTS}/bandicon/icon_{b['icon']}.png",
                     os.path.join(PUB, "band", f"{b['id']}.webp")))
    for e in d["equips"]:
        if e["trap"]:
            jobs.append((f"{AC_ARTS}/shopitemicon/{e['trap']}.png",
                         os.path.join(PUB, "equip", f"{e['trap']}.webp")))
    for k in ("battle", "bond", "gold", "support"):
        jobs.append((f"{AC_ARTS}/garrisontypeicon/icon_{k}.png", os.path.join(PUB, "type", f"{k}.webp")))
    for k in ("training", "funny", "normal", "hard", "abyss"):
        jobs.append((f"{AC_ARTS}/modeicon/mode_{k}_icon.png", os.path.join(PUB, "mode", f"{k}.webp")))
    # 특훈 적 유형 아이콘 — 이쪽은 autochesscommon이 아니라 autochessouter/arts 밑에 있다
    for k, v in d["enemyTypes"].items():
        if v.get("icon"):
            jobs.append((f"{AC_OUTER}/enemytypeicon/{v['icon']}.png",
                         os.path.join(PUB, "etype", f"{k}.webp")))
    # 마일스톤 보상 아이콘은 기존 public/items 를 그대로 쓴다 (없는 것만 받는다)
    idir = os.path.join(REPO, "public", "items")
    for m in d["milestones"]:
        iid = m["id"]
        dest = os.path.join(idir, f"{iid}.webp")
        if iid and not os.path.exists(dest):
            icon = item_of("ko", iid).get("iconId")
            if icon:
                jobs.append((f"{ITEM_ICON}/{urllib.request.quote(icon)}.png", dest))
    # 스킬·모듈 타입 아이콘 — 기물 상세 모달용 (사용자 요청 2026-08-23). 참조된 것만.
    for c2 in d["chess"]:
        for sk2 in c2.get("sks") or []:
            if sk2.get("ic"):
                jobs.append((f"{SKILL_ICON}/skill_icon_{urllib.request.quote(sk2['ic'])}.png",
                             os.path.join(PUB, "skill", f"{sk2['ic']}.webp")))
        for md2 in c2.get("mods") or []:
            if md2.get("i"):
                jobs.append((f"{MODTYPE_ICON}/{md2['i'].lower()}.png",
                             os.path.join(PUB, "modtype", f"{md2['i'].lower()}.webp")))
    jobs = list(dict.fromkeys(jobs))
    fails = download(jobs)
    print(f"아이콘 {len(jobs) - len(fails)}/{len(jobs)}", file=sys.stderr)
    for url, err in fails[:10]:
        print("  실패:", url, err, file=sys.stderr)


