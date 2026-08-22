#!/usr/bin/env python3
"""위수 협의(오토체스) 가이드 데이터 — app/data/autochess{,.en,.ja}.json + public/ac/ 아이콘.

사용:
  python3 scripts/build-autochess.py            # 데이터 + 아이콘
  python3 scripts/build-autochess.py --no-icons # 데이터만 (아이콘은 이미 받아둔 경우)

입력은 **이미 받아둔 .gamedata/*_activity_table.json** 이다 (fetch-gamedata.py가 챙긴다).
위수 협의는 별도 테이블이 아니라 activity_table 안에
`activity.AUTOCHESS_SEASON.act2autochess` 로 774KB가 통째로 박혀 있다.

⚠ KR/EN/JA를 **한 번에** 낸다 — build-i18n.py를 따로 돌릴 필요 없다 (CLAUDE.md 규칙 자체 충족).

로케일 사정 (2026-08-22 실측):
  kr  act2autochess ✓  → 한국어 공식 텍스트
  jp  act2autochess ✓  → 일본어 공식 텍스트
  en  act1autochess만  → **시즌2가 영어 서버에 없다.**
      영어판은 ① 이름류(맹약·모드·밴드 효과명)는 시즌1 EN에 같은 id가 있으면 빌려 오고,
      ② **설명문은 전부 한국어 원문**을 쓴다. 시즌1↔2 사이에 수치가 바뀐 사례가 실제로
      있어서(garrison_02_a: EN 시즌1 "+10% ATK/HP" vs KR 시즌2 "+30%") 설명을 빌려 오면
      틀린 숫자를 내보내게 된다. 화면은 doc.krOnly 플래그를 보고 안내문을 띄운다.
      진영 맹약 5개(시라쿠사·카시미어·아케인·독행·궁극기)는 시즌1 EN에 없어
      handbook_team_table의 공식 영문 국가명으로 메우고, 나머지는 한국어로 남는다.

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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp  # noqa: E402

ACT = "act2autochess"          # 시즌2 (위수 협의: 맹약)
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


def dedupe_texts(pairs):
    """(id, 설명) 목록에서 **같은 말을 두 번 하는 슬롯**을 걷어낸다.

    클뜯 데이터는 한 기물에 능력 슬롯을 두세 개 달아 두고 같은 문구를 그대로 복제해 넣는
    경우가 있다 (2026-08-22 실측 6건: 레코드키퍼 garrison_156/157이 글자까지 동일,
    비질 garrison_152/153이 동일하고 garrison_01이 그 문장의 부분집합).
    그대로 두면 화면에 같은 능력이 두 번 나온다 — 공백을 지운 뒤 완전히 같거나
    다른 항목에 통째로 포함되는 것을 버린다.
    """
    keep = []
    norm = [(gid, re.sub(r"\s+", "", txt)) for gid, txt in pairs]
    for i, (gid, flat) in enumerate(norm):
        if not flat:
            continue
        dup = any(j != i and (flat in other) and (len(flat) < len(other) or j < i)
                  for j, (_, other) in enumerate(norm))
        if not dup:
            keep.append(gid)
    return keep or [gid for gid, _ in pairs[:1]]


COND_RE = re.compile(r"^<([^>]+)>\s*")


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

acts, act1s, chars, skills, equips, items, enemies, teams, outers = {}, {}, {}, {}, {}, {}, {}, {}, {}
for loc, pre in PREFIX.items():
    at = load(f"{pre}_activity_table.json")
    season = at.get("activity", {}).get("AUTOCHESS_SEASON", {})
    acts[loc] = season.get(ACT)
    act1s[loc] = season.get(ACT1)
    chars[loc] = load(f"{pre}_character_table.json")
    skills[loc] = load(f"{pre}_skill_table.json")
    equips[loc] = load(f"{pre}_uniequip_table.json").get("equipDict", {})
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
    sys.exit("kr_activity_table.json 에 act2autochess 가 없다 — fetch-gamedata.py 를 먼저 돌릴 것")

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
TRAPS = KR["trapChessDataDict"]           # 115 — 장비(일반/강화)
TRAPSHOP = KR["trapShopChessDatas"]       # 59  — 상점 장비 목록
BANDS = KR["bandDataListDict"]            # 36  — 밴드(시작 조직)
EFFECTS = KR["effectInfoDataDict"]        # 361 — 효과 이름·설명 (장비·밴드·전략 공용)

# 능력 분류 아이콘 — eventTypeIcon(icon_battle 등)에서 접미만 딴다
TYPE_ICON = {"icon_battle": "battle", "icon_bond": "bond", "icon_gold": "gold", "icon_support": "support"}

OPS = {loc: {o["id"]: o for o in json.load(open(os.path.join(DATA, f"operators{SUFFIX[loc]}.json"), encoding="utf-8"))}
       for loc in ("ko", "en", "ja")}


def skill_name(loc, cid, idx):
    c = chars[loc].get(cid) or chars["ko"].get(cid)
    if not c or idx is None or idx < 0:
        return None
    sk = (c.get("skills") or [])
    if idx >= len(sk):
        return None
    sid = sk[idx].get("skillId")
    lv = ((skills[loc].get(sid) or skills["ko"].get(sid) or {}).get("levels") or [{}])
    return lv[0].get("name") if lv else None


def module_of(loc, ueid):
    if not ueid:
        return None
    e = equips[loc].get(ueid) or equips["ko"].get(ueid)
    if not e:
        return None
    return {"n": e.get("uniEquipName"), "i": e.get("typeIcon")}


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
        bond_rows.append({
            "id": bid,
            "n": name,
            "nation": bid in BOND_TEAM,     # 진영 맹약 여부 (특성 맹약과 갈라 보인다)
            "min": b.get("activeCount"),    # 발동 인원 임계값
            # 세는 범위 — BOARD(전장) / BOARD_AND_DECK(예비까지) / BOARD_ALL_CHESS(정예화 전원).
            # ⚠ '독행'만 downward다 — 인원이 **적을수록** 강해지므로 "N명부터"로 쓰면 뜻이 뒤집힌다.
            "cond": b.get("activeCondition"),
            **({"down": 1} if "downward" in (b.get("activeConditionTemplate") or "") else {}),
            "steps": steps_of(loc_desc(loc, "bondInfoDict", bid, "desc", b["desc"])),
            "chess": [],                    # 아래에서 채운다
        })

    # ── 기물 ──
    chess_rows, gar_used = [], {}
    for cid, c in CHESS.items():
        base = CHESSDATA.get(cid) or {}
        gold_id = c.get("goldenChessId")
        gold = CHESSDATA.get(gold_id) or {}
        char_id = c.get("charId")
        op = OPS[loc].get(char_id) or OPS["ko"].get(char_id) or {}
        name = char_name(loc, char_id)
        if not name and c.get("chessType") == "DIY":
            name = {"ko": "자유 선택 슬롯", "en": "Free pick slot", "ja": "自由選択スロット"}[loc]
        gar = list(base.get("garrisonIds") or [])
        garG = list(gold.get("garrisonIds") or [])
        for g in gar + garG:
            gar_used[g] = True
        row = {
            "id": cid,
            "gid": gold_id,
            "op": char_id,
            "n": name,
            "t": c.get("chessLevel"),           # 티어(코스트) 1~6
            "sort": c.get("shopLevelSortId"),
            "kind": c.get("chessType"),         # NORMAL(상점 등장) / PRESET(특수 지급) / DIY
            "bonds": list(base.get("bondIds") or []),
            "gar": gar,
            "garG": garG,
            "up": base.get("upgradeNum"),       # 골든까지 필요한 장수
        }
        if op:
            row["r"] = op.get("rarity")
            row["job"] = op.get("job")
            row["jobCode"] = op.get("jobCode")
        sn = skill_name(loc, char_id, c.get("defaultSkillIndex"))
        if sn:
            row["sk"] = {"n": sn, "i": (c.get("defaultSkillIndex") or 0) + 1}
        md = module_of(loc, c.get("defaultUniEquipId"))
        if md:
            row["mod"] = md
        chess_rows.append(row)
        for bid in row["bonds"]:
            if bid in bond_order:
                bond_rows[bond_order[bid]]["chess"].append(cid)

    chess_rows.sort(key=lambda r: (r["t"] or 0, r["sort"] if (r["sort"] or 0) > 0 else 99, r["n"] or ""))

    # ── 기물 능력(garrison) — 참조된 것만 ──
    gar_rows = {}
    for gid in gar_used:
        g = GARRISON.get(gid)
        if not g:
            continue
        gar_rows[gid] = {
            "d": rich(loc_desc(loc, "garrisonDataDict", gid, "garrisonDesc", g["garrisonDesc"])),
            "t": loc_name(loc, "garrisonDataDict", gid, "eventTypeDesc", g.get("eventTypeDesc")),
            "ic": TYPE_ICON.get(g.get("eventTypeIcon"), "battle"),
        }

    # 같은 말을 두 번 하는 슬롯 정리 (dedupe_texts 주석 참조) — 정리 후 안 쓰이는 능력은 뺀다
    used_after = set()
    for row in chess_rows:
        for key in ("gar", "garG"):
            row[key] = dedupe_texts([(g, gar_rows[g]["d"]) for g in row[key] if g in gar_rows])
            used_after.update(row[key])
    gar_rows = {k: v for k, v in gar_rows.items() if k in used_after}

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
    diy_pool = []
    for oid, o in OPS[loc].items():
        if o.get("rarity") != 6 or o.get("unreleased"):
            continue
        diy_pool.append({"op": oid, "n": o.get("name") or oid,
                         "job": o.get("job"), "seq": o.get("seq") or 0,
                         **({"in": 1} if oid in roster_ops else {})})
    diy_pool.sort(key=lambda r: -(r["seq"] or 0))

    const = KR["constData"]
    token = item_of(loc, const.get("milestoneId") or "")
    doc = {
        "id": ACT,
        "name": season_name,
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
                 "diyTier": diy_tier, "diyPool": diy_pool},
        "bonds": bond_rows,
        "chess": chess_rows,
        "gar": gar_rows,
        "equips": equip_rows,
        "bands": band_rows,
        "buffs": buff_rows,
        "enemies": sp_rows,
        "enemyTypes": sp_types,
        "enemyNames": sp_names,
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
    path = os.path.join(DATA, f"autochess{SUFFIX[loc]}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(docs[loc], f, ensure_ascii=False, separators=(",", ":"))
    print(f"{os.path.relpath(path, REPO)}  {os.path.getsize(path)/1024:.0f}KB", file=sys.stderr)

d = docs["ko"]
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
    jobs = list(dict.fromkeys(jobs))
    fails = download(jobs)
    print(f"아이콘 {len(jobs) - len(fails)}/{len(jobs)}", file=sys.stderr)
    for url, err in fails[:10]:
        print("  실패:", url, err, file=sys.stderr)


