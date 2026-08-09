#!/usr/bin/env python3
"""작전(스테이지) 도감 데이터 빌드 — 지형 도면 중심의 /stages.

사용:
  python3 scripts/build-stages.py                # 전부 (맵 도면 2,327장 · 최초 1회 5~10분)
  python3 scripts/build-stages.py --no-images    # 도면 다운로드 생략 (무인 CI용)

⚠ KR/EN/JA를 **한 번에** 낸다 — build-i18n.py를 따로 돌릴 필요 없다 (CLAUDE.md 규칙 자체 충족).

⚠ 등장 적은 `scripts/build-enemies.py`가 만든 `app/data/enemy-stages.json`을 **뒤집어 쓴다.**
  같은 levels/ 파일을 두 번 훑지 않기 위한 것이니, 적 도감을 먼저 돌려야 한다.
  (그 파일이 없으면 등장 적 없이 빌드하고 경고만 남긴다 — 도감 자체는 나와야 한다.)

출력:
  app/data/stages.json / .en.json / .ja.json   작전 2,327개 (이성·보상·드랍·기믹·등장 적)
  public/stage/<stageId>.webp                  인게임 지형 도면 (⚠ git에 커밋한다 — CI가
                                               --no-images로 돌 때 로컬 파일 유무로 map
                                               플래그를 세우므로. 서빙은 R2가 한다)

입력:
  .gamedata/{kr,en,jp}_stage_table.json / _zone_table.json / _item_table.json
  app/data/enemy-stages.json (+ .en/.ja)       등장 적 역색인 (build-enemies.py 산출물)
"""
import json, os, re, shutil, sys, time, urllib.error, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"
_pos = [a for a in sys.argv[1:] if not a.startswith("-")]
S = _pos[0] if _pos else os.environ.get("GAMEDATA_DIR", os.path.join(REPO, ".gamedata"))
DATA = os.path.join(REPO, "app", "data")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp  # noqa: E402
# 인게임 도면이 없는 작전은 레벨 파일의 타일 격자로 그린다 — 통합전략이 쓰던 렌더러를
# 그대로 재사용한다 (build-rogue.py는 __main__ 가드가 있어 임포트해도 빌드가 돌지 않는다).
from importlib import import_module  # noqa: E402
import importlib.util as _ilu  # noqa: E402
_spec = _ilu.spec_from_file_location("build_rogue", os.path.join(os.path.dirname(os.path.abspath(__file__)), "build-rogue.py"))
_rogue = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_rogue)
render_minimap = _rogue.render_minimap

NO_IMAGES = "--no-images" in sys.argv
LOCALES = [("ko", "kr", ""), ("en", "en", ".en"), ("ja", "jp", ".ja")]
load = lambda p: json.load(open(p, encoding="utf-8"))

# 튜토리얼만 뺀다. 종료된 이벤트는 남긴다 — 복각으로 돌아오고, 지형을 다시 보고 싶어지는 건
# 대개 옛 이벤트다. (build-enemies.py의 SKIP_TYPES와 같은 규약)
SKIP_TYPES = {"GUIDE"}

# ⚠ 난이도 판(diffGroup)이 진짜 구분자다. difficulty가 아니라 이쪽을 봐야 한다 (2026-08-09 실측).
#   EASY(103개) = 스토리 모드 간이판. 코드·이름이 정규판과 **103/103 완전히 겹쳐** 목록에
#     "9-2"가 두 줄로 나온다. 고유 콘텐츠가 없으므로 통째로 뺀다.
#   TOUGH(104개) = 어려움 판. 85개가 정규판과 코드가 겹치지만 등장 적·배치가 달라 **남긴다** —
#     대신 코드에 난이도를 붙여 구분한다.
SKIP_DIFF = {"EASY"}
TOUGH_SUFFIX = {"ko": "어려움", "en": "Tough", "ja": "高難度"}

# 작전 계열 표시명 — 구역 이름이 비어 있을 때의 폴백이자 필터 라벨.
# ⚠ build-enemies.py의 ZONE_TYPE_LABELS와 **같은 문구**여야 한다 (두 도감이 서로를 링크한다).
TYPE_LABELS = {
    "ko": {"MAIN": "메인 스토리", "SUB": "막간 이야기", "ACTIVITY": "이벤트", "CAMPAIGN": "섬멸 작전",
           "DAILY": "자원 확보", "CLIMB_TOWER": "보안 파견", "SPECIAL_STORY": "특별 작전", "GUIDE": "튜토리얼"},
    "en": {"MAIN": "Main Theme", "SUB": "Intermezzi", "ACTIVITY": "Event", "CAMPAIGN": "Annihilation",
           "DAILY": "Supply", "CLIMB_TOWER": "Stationary Security Service", "SPECIAL_STORY": "Special Operation", "GUIDE": "Tutorial"},
    "ja": {"MAIN": "メインテーマ", "SUB": "幕間", "ACTIVITY": "イベント", "CAMPAIGN": "殲滅作戦",
           "DAILY": "資源調達", "CLIMB_TOWER": "保全駐在", "SPECIAL_STORY": "特別作戦", "GUIDE": "チュートリアル"},
}
# 드랍 빈도 — 게임 표기 그대로. 확률 수치는 데이터에 없다(펭귄 물류 실측은 재료파밍 도우미 소관).
OCC_LABELS = {
    "ko": {"ALWAYS": "확정", "ALMOST": "거의 항상", "USUAL": "자주", "OFTEN": "보통", "SOMETIMES": "가끔"},
    "en": {"ALWAYS": "Guaranteed", "ALMOST": "Almost always", "USUAL": "Frequent", "OFTEN": "Common", "SOMETIMES": "Occasional"},
    "ja": {"ALWAYS": "確定", "ALMOST": "ほぼ確定", "USUAL": "頻繁", "OFTEN": "普通", "SOMETIMES": "たまに"},
}
# 드랍 구분 — 첫 클리어 보상과 상시 드랍은 성격이 다르다
DROP_LABELS = {
    "ko": {"NORMAL": "주요 드랍", "SPECIAL": "특별 드랍", "ADDITIONAL": "추가 드랍",
           "COMPLETE": "완벽 작전", "ONCE": "최초 클리어", "CONDITION_DROP": "조건 드랍"},
    "en": {"NORMAL": "Regular drop", "SPECIAL": "Special drop", "ADDITIONAL": "Extra drop",
           "COMPLETE": "3-star clear", "ONCE": "First clear", "CONDITION_DROP": "Conditional"},
    "ja": {"NORMAL": "通常ドロップ", "SPECIAL": "特殊ドロップ", "ADDITIONAL": "追加ドロップ",
           "COMPLETE": "完全作戦", "ONCE": "初回クリア", "CONDITION_DROP": "条件ドロップ"},
}


def clean(s):
    """리치 텍스트 태그(<@lv.item>…</>)를 벗긴다. 기믹 설명에 잔뜩 들어 있다."""
    if not isinstance(s, str):
        return s
    s = re.sub(r"</?[@$a-zA-Z][^>]*>|</>", "", s.replace("\r\n", "\n").replace("\\n", "\n"))
    s = re.sub(r"[ \t]+", " ", s)
    return "\n".join(ln.strip() for ln in s.split("\n")).strip() or None


# ── 1. 스테이지 목록 (KR을 정본으로) ────────────────────────────────────────
tables = {loc: load(f"{S}/{pre}_stage_table.json")["stages"] for loc, pre, _ in LOCALES}
zones = {loc: load(f"{S}/{pre}_zone_table.json")["zones"] for loc, pre, _ in LOCALES}
items = {loc: load(f"{S}/{pre}_item_table.json")["items"] for loc, pre, _ in LOCALES}
# 이벤트 이름 — 구역 위의 한 단계다 (사용자 요청 2026-08-09: "무슨 이벤트인지 필터링 한번 더").
# 한 이벤트가 구역을 여러 개 갖는다: '사세행' = 상추실록·망춘유사·대필신편.
# zoneToActivity(구역 → 이벤트 id) + basicInfo(이벤트 id → 이름)로 되짚는다.
acts = {loc: load(f"{S}/{pre}_activity_table.json") for loc, pre, _ in LOCALES}
# 펭귄 물류 실측 드랍률 (재료파밍 도우미의 farm.json 재사용) — 게임 표기는 '가끔' 같은
# 빈도뿐이라, 실측 %와 **그 재료의 효율 순위**(기대 이성 오름차순)를 함께 싣는다
# (사용자 요청 2026-08-09). 수치는 로케일 무관이라 한 번만 만든다.
_farm_path = os.path.join(DATA, "farm.json")
MEASURED = {}          # stageId → {itemId: (rate%, rank, total)}
if os.path.exists(_farm_path):
    for _it in load(_farm_path)["items"]:
        _sts = sorted(_it["stages"], key=lambda x: x["sanity"])
        for _rank, _st in enumerate(_sts, 1):
            MEASURED.setdefault(_st["id"], {})[_it["id"]] = (_st["rate"], _rank, len(_sts))
ZONE_TO_ACT = acts["ko"]["zoneToActivity"]


def event_name(loc, zid):
    """그 구역이 속한 이벤트 이름. 이벤트가 아니거나 매핑이 없으면 None."""
    aid = ZONE_TO_ACT.get(zid)
    if not aid:
        return None
    info = (acts[loc].get("basicInfo") or {}).get(aid) or (acts["ko"].get("basicInfo") or {}).get(aid)
    return clean((info or {}).get("name"))

# ── 메인 스토리 챕터 (2026-08-09 사용자 리포트로 발각) ──────────────────────
# ⚠ zoneNameFirst를 무조건 챕터 라벨로 쓰면 안 된다. 15·16장(act2mainss/act3mainss)은
#   first가 **영어 제목**이고 3개 언어에서 값이 똑같다("Dissociative Recombination").
#   그래서 "로케일마다 다른가"로 판정한다 — 진짜 챕터 라벨은 ko '에피소드 3' ·
#   en 'Episode 3' · ja '第三章'로 갈리지만, 영어 제목은 어느 로케일에서든 같다.
CHAPTER_RE = re.compile(r"EPISODE\s*(\d+)", re.I)


def _chapter_label(loc, n):
    """15·16장은 세 로케일 모두 first가 미번역이라 'EPISODE 15'가 그대로 노출됐다
    (사용자 지적 2026-08-10) — 기존 챕터들과 같은 표기로 합성한다.
    ⚠ build-enemies.py에도 같은 함수가 있다 — zone_name처럼 글자까지 같아야 한다."""
    if loc == "ko":
        return f"에피소드 {n}"
    if loc == "ja":                      # ja는 한자 수사다: 第十五章 (第15章이 아니다)
        d = "一二三四五六七八九"
        tens, ones = divmod(n, 10)
        num = ("" if tens < 2 else d[tens - 1]) + ("十" if tens else "") + (d[ones - 1] if ones else "")
        return f"第{num}章"
    return f"Episode {n}"


def _localized_first(zid):
    """zoneNameFirst가 로케일마다 다르면(=진짜 챕터 라벨) True."""
    vals = {clean((zones[loc].get(zid) or {}).get("zoneNameFirst")) for loc in ("ko", "en", "ja")}
    vals.discard(None)
    return len(vals) > 1


def chapter_of(zid):
    """메인 스토리 챕터 번호. 정렬용 — 코드가 'R8-1'·'JT8-1'이라 코드순으로는
    8장이 통째로 맨 뒤로 밀린다 (사용자 리포트). 15·16장은 zoneId가 act2mainss_zone1이라
    zoneId 파싱만으로도 안 된다 — zoneNameThird의 'EPISODE 15'가 유일하게 믿을 값이다."""
    z = zones["ko"].get(zid) or {}
    m = CHAPTER_RE.search(z.get("zoneNameThird") or "")
    if m:
        return int(m.group(1))
    m = re.fullmatch(r"main_(\d+)", zid or "")
    return int(m.group(1)) if m else None


# ⚠ 긴급 작전(stageId 접미 `#f#`)은 일반판과 code·levelId가 완전히 같다 — 접지 않으면
#   "4-6"이 두 줄로 나온다 (build-enemies.py에서 실측 822행 중복). 일반판을 남긴다.
seen = {}
for sid, v in tables["ko"].items():
    if v.get("stageType") in SKIP_TYPES or not v.get("levelId"):
        continue
    if v.get("diffGroup") in SKIP_DIFF:
        continue
    key = (v.get("code") or sid, v["levelId"].lower())
    prev = seen.get(key)
    if prev is None or (v.get("difficulty") == "NORMAL" and prev.get("difficulty") != "NORMAL"):
        seen[key] = v

TYPE_ORDER = {"MAIN": 0, "SUB": 1, "SPECIAL_STORY": 2, "CAMPAIGN": 3, "DAILY": 4, "CLIMB_TOWER": 5}
def natural(code):
    return [int(p) if p.isdigit() else p for p in re.split(r"(\d+)", code or "")]
# ⚠ 메인 스토리는 **챕터 번호로** 먼저 묶는다. 코드로만 정렬하면 8장(코드가 'R8-1'·
#   'JT8-1')이 통째로 맨 뒤로 밀린다 (2026-08-09 사용자 리포트). 구역 필터 목록도
#   여기 순서를 그대로 물려받으므로 이 정렬 하나가 화면 순서를 결정한다.
def sort_key(v):
    ch = chapter_of(v.get("zoneId")) if v.get("stageType") in ("MAIN", "SUB") else None
    return (TYPE_ORDER.get(v.get("stageType"), 9), ch if ch is not None else 999,
            natural(v.get("code") or v["stageId"]))
stages = sorted(seen.values(), key=sort_key)
print(f"작전: {len(stages)}개")

# ── 2. 등장 적 — build-enemies.py 산출물을 뒤집는다 ─────────────────────────
# 같은 levels/ 파일을 두 번 훑지 않는다. 그쪽 색인은 (코드, 이름, 구역, 종류) 행 기준이라
# 여기서도 같은 키로 맞춰 되짚는다.
# ⚠ 키에 **이름까지** 넣어야 한다 (2026-08-09 실측). 섬멸 작전은 코드가 지역명이라
#   '빅토리아'만 4개 작전이 공유하고 맵 이름으로만 갈린다 — (코드, 구역)으로 조인하면
#   네 작전에 똑같은 적 71마리가 붙는다. 이벤트 다부작도 같은 모양이 57건 있다.
enemy_by_stage = {}          # (code, name, zone) → [[enemyId, cnt, lv], …]
ep = os.path.join(DATA, "enemy-stages.json")
if os.path.exists(ep):
    doc = load(ep)
    rows = doc["stages"]
    for eid, refs in doc["byEnemy"].items():
        for r in refs:
            row = rows[r[0]]
            enemy_by_stage.setdefault((row[0], row[1], row[2]), []).append(
                [eid, r[1] if len(r) > 1 else 0, r[2] if len(r) > 2 else 0])
    print(f"등장 적 색인: 작전 {len(enemy_by_stage)}개분")
else:
    print("  ⚠ app/data/enemy-stages.json 없음 — 등장 적 없이 빌드한다 "
          "(scripts/build-enemies.py를 먼저 돌릴 것)")

# 적 이름 — 도감과 같은 표기를 쓴다 (지어내지 않는다)
enemy_names = {}
for loc, _, suf in LOCALES:
    p = os.path.join(DATA, f"enemies{suf}.json")
    enemy_names[loc] = {e["id"]: e["name"] for e in load(p)} if os.path.exists(p) else {}



def zone_name(loc, zid, stype):
    """⚠ build-enemies.py의 zone_name과 **글자 하나까지 같아야 한다** — 두 도감이
    (코드, 이름, 구역)으로 서로의 색인을 되짚는다. 한쪽만 고쳤다가 조인이
    2,038 → 1,538로 깨진 적이 있다 (2026-08-09)."""
    z = zones[loc].get(zid) or {}
    second = clean(z.get("zoneNameSecond"))
    third = clean(z.get("zoneNameThird"))
    # 메인 스토리는 챕터 표기를 앞에 붙인다 (사용자 요청). 로케일마다 다른 first가
    # 진짜 챕터 라벨이고(에피소드 3 / Episode 3 / 第三章), 아니면 third('EPISODE 15')를 쓴다.
    head = clean(z.get("zoneNameFirst")) if _localized_first(zid) else None
    if not head and third:
        m = CHAPTER_RE.search(third)
        if m:
            head = _chapter_label(loc, int(m.group(1)))
    if head and second and head != second:
        return f"{head} · {second}"
    n = second or head or third
    return n or TYPE_LABELS[loc].get(z.get("type") or stype) or TYPE_LABELS[loc].get(stype) or ""


def drops_of(loc, v):
    """표시용 드랍 목록. 게임의 '작전 정보' 화면과 같은 구성이다."""
    info = v.get("stageDropInfo") or {}
    out = []
    for d in info.get("displayDetailRewards") or []:
        # 다이아·가구·인장 등은 도감에서 의미가 옅다 — 재료와 작전기록만 싣는다
        if d.get("type") not in ("MATERIAL", "CARD_EXP", "ACTIVITY_ITEM"):
            continue
        it = items[loc].get(d["id"]) or items["ko"].get(d["id"])
        if not it:
            continue
        out.append({
            "id": d["id"], "name": clean(it.get("name")) or d["id"],
            "occ": OCC_LABELS[loc].get(d.get("occPercent"), d.get("occPercent")),
            "kind": DROP_LABELS[loc].get(d.get("dropType"), d.get("dropType")),
        })
    return out


def build(loc):
    """사전 인코딩 산출물. 배열/객체를 그대로 늘어놓으면 로케일당 3MB가 된다 —
    실측 내역이 등장 적 43%·드랍 22%였고 전부 반복되는 id·라벨 문자열이었다.
    반복되는 값은 전부 위쪽 사전에 한 번만 두고 본문은 번호로 가리킨다."""
    table = tables[loc]
    zone_list, zone_ix = [], {}
    ev_list, ev_ix = [], {}
    item_map = {}
    enemy_list, enemy_ix = [], {}
    occ_list, occ_ix = [], {}
    kind_list, kind_ix = [], {}

    def intern(v, lst, ix):
        if v not in ix:
            ix[v] = len(lst)
            lst.append(v)
        return ix[v]

    out = []
    for kv in stages:
        sid = kv["stageId"]
        v = table.get(sid) or kv
        code = clean(v.get("code")) or sid
        if kv.get("diffGroup") == "TOUGH":
            code = f"{code} ({TOUGH_SUFFIX[loc]})"
        zone = zone_name(loc, v.get("zoneId") or kv.get("zoneId"), kv.get("stageType"))
        ents = enemy_by_stage.get((clean(kv.get("code")) or sid,
                                   clean(kv.get("name")) or "",
                                   zone_name("ko", kv.get("zoneId"), kv.get("stageType"))), [])
        drops = []
        for d in drops_of(loc, v):
            item_map[d["id"]] = d["name"]
            row_d = [d["id"], intern(d["occ"], occ_list, occ_ix), intern(d["kind"], kind_list, kind_ix)]
            m = MEASURED.get(sid, {}).get(d["id"])
            if m:   # 실측치가 있는 (작전, 재료)만 — 316쌍 (2026-08-09 실측)
                row_d += [m[0], m[1], m[2]]
            drops.append(row_d)
        e = {
            "id": sid,
            "code": code,
            "name": clean(v.get("name")) or code,
            "z": intern(zone, zone_list, zone_ix),
            "t": kv.get("stageType"),
        }
        # ⚠ 이벤트 계열에만 붙인다. zoneToActivity에는 메인·막간의 연동 이벤트 구역도
        #   섞여 있어(실측 3개), 그대로 두면 메인 스토리를 골랐을 때 '이벤트' 칸이 뜬다.
        ev = event_name(loc, kv.get("zoneId")) if kv.get("stageType") == "ACTIVITY" else None
        if ev:
            e["ev"] = intern(ev, ev_list, ev_ix)
        # 0·null인 칸은 아예 넣지 않는다 (2,327개 × 빈 칸이 그대로 용량이다)
        desc = clean(v.get("description"))
        if desc: e["desc"] = desc
        if kv.get("apCost"): e["ap"] = kv["apCost"]
        if kv.get("expGain"): e["exp"] = kv["expGain"]
        if kv.get("goldGain"): e["gold"] = kv["goldGain"]
        danger = clean(v.get("dangerLevel"))
        if danger: e["danger"] = danger
        if drops: e["d"] = drops
        # 등장 적: [적번호, 스폰수, 스탯레벨] — 적 도감(/enemies/<id>)으로 이어진다
        if ents:
            e["e"] = [[intern(x[0], enemy_list, enemy_ix), x[1], x[2]] for x in ents]
        out.append(e)
    return {
        "zones": zone_list, "events": ev_list, "items": item_map, "occ": occ_list, "kinds": kind_list,
        "enemyIds": enemy_list,
        "types": {k: TYPE_LABELS[loc].get(k, k) for k in {s.get("stageType") for s in stages}},
        "enemyNames": {eid: enemy_names[loc].get(eid, eid) for eid in enemy_list},
        "stages": out,
    }


by_loc = {loc: build(loc) for loc, _, _ in LOCALES}

# ── 3. 지형 도면 — arts/ui/stage/mappreviews/<stageId>.png ──────────────────
if NO_IMAGES:
    print("도면: --no-images — 건너뜀")
    have = set()
    dest_dir = os.path.join(REPO, "public", "stage")
    if os.path.isdir(dest_dir):
        have = {f[:-5] for f in os.listdir(dest_dir) if f.endswith(".webp")}
else:
    dest_dir = os.path.join(REPO, "public", "stage")
    os.makedirs(dest_dir, exist_ok=True)
    todo = [s["stageId"] for s in stages
            if not os.path.exists(os.path.join(dest_dir, s["stageId"] + ".webp"))]

    def one(sid):
        try:
            req = urllib.request.Request(f"{ASSETS}/arts/ui/stage/mappreviews/{sid}.png",
                                         headers={"User-Agent": "Mozilla/5.0"})
            png = urllib.request.urlopen(req, timeout=90).read()
            # photo=True·method=4 — 2,327장이라 method 6(장당 수 초)은 쓸 수 없다.
            # 640px면 칸·진입로·고지가 충분히 읽힌다 (원본은 1000px 내외).
            save_webp(png, os.path.join(dest_dir, sid + ".webp"), photo=True, max_px=640, method=4)
            return None
        except Exception:
            return sid
    fails = []
    if todo:
        print(f"도면: {len(todo)}장 받는 중…")
        with ThreadPoolExecutor(12) as ex:
            fails = [f for f in ex.map(one, todo) if f]
    have = {f[:-5] for f in os.listdir(dest_dir) if f.endswith(".webp")}
    print(f"도면: 인게임 이미지 신규 {len(todo) - len(fails)} · 없음 {len(fails)}")

    # ── 폴백 0: 어려움(tough_*)은 일반판(main_*)과 지형이 같다 — 짝의 도면을 복사 ──
    # 어려움 판은 대부분 자체 미리보기가 없어 격자로 렌더되던 것 (사용자 지적 2026-08-10:
    # "11-15 어려움만 맵이 있고 11-14·11-16은 격자"). 격자보다 일반판 실사가 정답이므로
    # 격자 렌더 **앞에서** 복사한다. 자체 미리보기가 있는 소수(예: tough_11-13)는 위
    # 다운로드가 이미 채웠으니 여기 걸리지 않는다.
    copied = 0
    for kv in stages:
        sid = kv["stageId"]
        if sid in have or not sid.startswith("tough_"):
            continue
        src = os.path.join(dest_dir, sid.replace("tough_", "main_", 1) + ".webp")
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(dest_dir, sid + ".webp"))
            copied += 1
    if copied:
        have = {f[:-5] for f in os.listdir(dest_dir) if f.endswith(".webp")}
        print(f"도면: 어려움 판 ← 일반판 복사 {copied}장")

    # ── 폴백: 레벨 파일의 타일 격자를 직접 그린다 ─────────────────────────────
    # 보안 파견(lt_*)·다인 모드(멀티·보스러시·아케이드 등)는 인게임 미리보기 이미지가
    # 아예 없다. 지형이 이 도감의 본체이므로 빈 칸으로 두지 않고 격자로 렌더한다
    # (통합전략이 같은 이유로 쓰던 render_minimap 재사용).
    LEVEL_CACHE = os.path.join(REPO, ".gamedata", "levels")
    pend = [kv for kv in stages if kv["stageId"] not in have]
    drawn = 0
    for kv in pend:
        lid = (kv.get("levelId") or "").lower()
        lp = os.path.join(LEVEL_CACHE, f"levels/{lid}.json".replace("/", "__"))
        if not lid or not os.path.exists(lp):
            continue
        try:
            if render_minimap(load(lp), os.path.join(dest_dir, kv["stageId"] + ".webp")):
                drawn += 1
        except Exception:
            continue
    have = {f[:-5] for f in os.listdir(dest_dir) if f.endswith(".webp")}
    print(f"도면: 격자 렌더 {drawn}장 → 보유 {len(have)}/{len(stages)}")

    # ── 폴백 2: 팬위키 도면 (사용자 요청 2026-08-10 "안 나오는 것 전부 찾아라") ──────
    # 옛 이벤트(스토리 콜렉션·보스러시·연합작전 등)는 인게임 미리보기도 레벨 파일도
    # 현행 kr/cn 레포에서 지워져 위 두 경로가 다 막힌다(181개 실측). 위키에서 받는다 —
    # 받은 파일은 로컬 public/stage/에 남으므로 재실행 때 위키를 다시 두드리지 않는다.
    #   ① arknights.wiki.gg — images/<코드>_map.png (2단계 보스전은 _map_1.png)
    #   ② prts.wiki — 코드가 시즌마다 재사용되는 것(보스러시 TN-* 등)은 CN 스테이지명
    #      으로만 구분된다: api.php에서 '<코드>_<CN이름>' 접두로 찾아 地图(WAVE1 우선)를
    #      고른다. ⚠ prts.wiki는 **api.php·media만 빠르다** — /w/ 페이지 렌더는 이
    #      환경에서 60초+ 걸리므로 절대 페이지를 긁지 말 것 (2026-08-10 실측).
    pend = [kv for kv in stages if kv["stageId"] not in have]
    wiki_n = prts_n = 0
    if pend:
        cn_names = {}
        try:
            cn_path = os.path.join(S, "cn_stage_table.json")
            if not os.path.exists(cn_path):
                req = urllib.request.Request(
                    "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/cn/gamedata/excel/stage_table.json",
                    headers={"User-Agent": "Mozilla/5.0"})
                with open(cn_path, "wb") as f:
                    f.write(urllib.request.urlopen(req, timeout=180).read())
            cn_names = {k: clean(v.get("name")) for k, v in load(cn_path)["stages"].items()}
        except Exception as err:
            print(f"  ⚠ CN 스테이지명 로드 실패 — prts 폴백 생략: {err}")

        def wfetch(url):
            # ⚠ media.prts.wiki는 IP 라운드로빈 중 일부가 이 망에서 SYN조차 안 잡힌다
            #   (2026-08-10 실측: SYN_SENT로 60초씩 매달려 전체가 40분+ 늘어짐).
            #   짧은 타임아웃 + 재시도로 다른 IP를 다시 뽑는 쪽이 훨씬 빠르다.
            last = None
            for _ in range(2):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "terra-archive-fetch (fansite; contact nzkonaru@gmail.com)"})
                    return urllib.request.urlopen(req, timeout=15).read()
                except Exception as err:
                    last = err
            raise last

        def one_wiki(kv):
            sid, code = kv["stageId"], clean(kv.get("code") or "")
            if not code:
                return (0, 0)
            got, src = None, 0
            for cand in (f"{code}_map.png", f"{code}_map_1.png"):
                try:
                    got = wfetch("https://arknights.wiki.gg/images/" + urllib.parse.quote(cand))
                    src = 1
                    break
                except Exception:
                    continue
            if got is None and cn_names.get(sid):
                try:
                    pre = urllib.parse.quote(f"{code}_{cn_names[sid]}")
                    api = wfetch("https://prts.wiki/api.php?action=query&list=allimages"
                                 f"&aiprefix={pre}&ailimit=50&format=json")
                    imgs = json.loads(api).get("query", {}).get("allimages", [])
                    best = (next((i for i in imgs if "地图" in i["name"] and "WAVE1" in i["name"]), None)
                            or next((i for i in imgs if "地图" in i["name"]), None))
                    if best:
                        got = wfetch(best["url"])
                        src = 2
                except Exception:
                    pass
            if not got:
                return (0, 0)
            try:
                save_webp(got, os.path.join(dest_dir, sid + ".webp"), photo=True, max_px=640, method=4)
            except Exception:
                return (0, 0)
            time.sleep(0.1)   # 팬위키에 예의 — 4갈래면 이 정도가 적정 부하다
            return (1, 0) if src == 1 else (0, 1)

        # 4갈래 병렬 — prts 미디어가 장당 15~30초라 순차로는 181장에 수십 분이 걸렸다
        print(f"도면: 위키 폴백 {len(pend)}장 시도 중…")
        with ThreadPoolExecutor(4) as ex:
            results = list(ex.map(one_wiki, pend))
        wiki_n = sum(a for a, _ in results)
        prts_n = sum(b for _, b in results)
        print(f"도면: 위키 폴백 wiki.gg {wiki_n} · prts {prts_n}")

    have = {f[:-5] for f in os.listdir(dest_dir) if f.endswith(".webp")}
    still = [kv["stageId"] for kv in stages if kv["stageId"] not in have]
    if still:
        print(f"  ⚠ 끝내 도면 없음 {len(still)}개: {still[:8]}")

for doc in by_loc.values():
    for e in doc["stages"]:
        if e["id"] in have:
            e["map"] = 1     # 도면 없는 작전이 더 적다 — 있는 쪽만 표시해 용량을 아낀다

for loc, _, suf in LOCALES:
    p = os.path.join(DATA, f"stages{suf}.json")
    json.dump(by_loc[loc], open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  {os.path.basename(p)}: {len(by_loc[loc]['stages'])}개 {os.path.getsize(p)//1024}KB")

# 미번역 감시 — EN/JA에 한글이 남아 있으면 그 작전은 KR 폴백이다 (CN 선행 이벤트 등)
HANGUL = re.compile(r"[가-힣]")
for loc in ("en", "ja"):
    left = [e["code"] for e in by_loc[loc]["stages"] if HANGUL.search(e["name"] or "")]
    if left:
        print(f"  ⚠ {loc}: 이름 미번역 {len(left)}개 (KR 폴백) 예: {left[:5]}")

n_enemy = sum(1 for e in by_loc["ko"]["stages"] if e.get("e"))
print(f"등장 적이 붙은 작전: {n_enemy}/{len(stages)} · 도면 보유 {sum(1 for e in by_loc['ko']['stages'] if e.get('map'))}")
print("완료 — app/data/stages*.json")
