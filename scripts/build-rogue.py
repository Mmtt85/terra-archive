# 통합전략(로그라이크) 데이터 빌드 — app/data/rogue1.json
#
# Usage:
#   python3 scripts/build-rogue.py            # rogue_1 (팬텀 & 크림슨 솔리테어)
#
# 소스 (ArknightsAssets/ArknightsGamedata kr — PROJECT-GUIDE §2 클뜯 레포):
#   excel/roguelike_topic_table.json  — 존·스테이지·유물·레퍼토리(음반)·환각·난이도·엔딩·조우 씬
#   levels/obt/roguelike/ro1/*.json   — 스테이지별 등장 적(enemyDbRefs)·스폰 수(waves)·긴급 배율(runes)
#   levels/enemydata/enemy_database.json — 적 스탯 원본 (level별)
#   excel/enemy_handbook_table.json   — 적 도감 텍스트 (이름·급·공격방식·능력)
#
# 조우(우연한 만남)의 층별 출현 규칙과 엔딩 선제조건은 클라 테이블에 없어
# scripts/rogue1-curated.json (PRTS 위키 기반 수작업 큐레이션)에서 병합한다.
#
# 유물·무대 도구 아이콘은 KR CDN 스프라이트 아틀라스에만 있어 별도 모드로 언팩한다:
#   python3 scripts/build-rogue.py --icons    # UnityPy·lz4inv 필요 (pip3 install --user)
#   → public/rogue/relic/<itemId>.webp 생성 후 기본 모드 재실행하면 img 플래그가 붙는다.
import json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 적 이름 교정 — 클뜯 표기가 통칭과 다른 보스 등 (사용자 확정). 재생성해도 유지된다.
ENEMY_NAME_FIX = {"캔모씨": "캔낫"}
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"
CACHE = os.path.join(REPO, ".gamedata", "rogue")
os.makedirs(CACHE, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp

def fetch_json(path, branch="kr"):
    """gamedata JSON — .gamedata/rogue 에 캐시. branch=kr|cn (미출시 토픽은 cn 선행 데이터)."""
    prefix = "" if branch == "kr" else f"{branch}__"
    cache = os.path.join(CACHE, prefix + path.replace("/", "__"))
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    url = f"{GAMEDATA}/{branch}/gamedata/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req).read()
    open(cache, "wb").write(raw)
    return json.loads(raw)

def download_webp(jobs, max_px=None, photo=True):
    """(url, dest) 목록을 병렬 다운로드해 webp 저장. 이미 있으면 스킵. 실패 목록 반환."""
    def one(job):
        url, dest = job
        if os.path.exists(dest):
            return None
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            png = urllib.request.urlopen(req, timeout=30).read()
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            save_webp(png, dest, photo=photo, max_px=max_px)
            return None
        except Exception as e:
            return (url, str(e))
    with ThreadPoolExecutor(12) as ex:
        fails = [f for f in ex.map(one, jobs) if f]
    return fails

# ── 미니맵 렌더 — level json의 mapData(타일 그리드)를 색 격자 webp로 ─────────
TILE_COLORS = {
    "tile_forbidden": (26, 17, 19), "tile_hole": (12, 8, 9),
    "tile_road": (82, 80, 90), "tile_floor": (70, 68, 78),
    "tile_wall": (132, 128, 138), "tile_rcm_crate": (132, 128, 138),
    "tile_start": (196, 60, 46), "tile_flystart": (172, 66, 88),
    "tile_end": (52, 130, 190), "tile_telin": (120, 84, 160), "tile_telout": (156, 120, 190),
    "tile_grass": (72, 92, 62), "tile_deepwater": (34, 52, 74), "tile_water": (44, 70, 96),
    "tile_infection": (128, 62, 130), "tile_corrosion": (128, 62, 130),
    "tile_defup": (96, 116, 96), "tile_gazebo": (96, 108, 130), "tile_healing": (96, 140, 110),
    "tile_fence": (110, 96, 80), "tile_fence_bound": (110, 96, 80),
    "tile_bigforce": (150, 96, 60), "tile_smog": (90, 90, 100), "tile_yinyang_road": (100, 96, 106),
}
def render_minimap(level, dest):
    from PIL import Image
    md = level.get("mapData") or {}
    grid = md.get("map") or []
    tiles = md.get("tiles") or []
    if not grid or not tiles:
        return False
    cell, gap = 14, 2
    rows, cols = len(grid), len(grid[0])
    bg = (20, 12, 14)
    img = Image.new("RGB", (cols * cell + gap, rows * cell + gap), bg)
    px = img.load()
    for r in range(rows):
        for c in range(cols):
            t = tiles[grid[r][c]]
            key = t.get("tileKey")
            color = TILE_COLORS.get(key)
            if color is None:  # 미지정 타일은 지형 높이로 추정
                color = (132, 128, 138) if t.get("heightType") in (1, "HIGHLAND") else (82, 80, 90)
            x0, y0 = c * cell + gap, r * cell + gap
            for y in range(y0, y0 + cell - gap):
                for x in range(x0, x0 + cell - gap):
                    px[x, y] = color
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    scale = 4  # 부드럽게 축소 저장
    img = img.resize((img.width * scale // 2, img.height * scale // 2), Image.NEAREST)
    save_webp_img(img, dest)
    return True

def save_webp_img(img, dest):
    img.save(dest, "WEBP", quality=88)

def mv(field, default=None):
    """enemy_database의 {m_defined, m_value} 언랩."""
    if isinstance(field, dict) and "m_defined" in field:
        return field["m_value"] if field["m_defined"] else default
    return field if field is not None else default

# 적 상태 면역 필드 → 표기 (도감 상세 표시용, 사용자 요청 2026-07-18). 로케일별.
IMMUNE_FIELDS = ["stunImmune", "silenceImmune", "sleepImmune", "frozenImmune", "levitateImmune",
                 "disarmedCombatImmune", "fearedImmune", "palsyImmune", "attractImmune", "teleportImmune"]
IMMUNE_LABELS = {
    None: ["기절", "침묵", "수면", "빙결", "부양", "무장 해제", "공포", "마비", "흡인", "강제 이동"],
    "en": ["Stun", "Silence", "Sleep", "Freeze", "Levitate", "Disarm", "Fear", "Paralysis", "Pull", "Forced movement"],
    "ja": ["スタン", "沈黙", "睡眠", "凍結", "浮遊", "武装解除", "恐怖", "麻痺", "吸引", "強制移動"],
}
IMMUNE_KO = list(zip(IMMUNE_FIELDS, IMMUNE_LABELS[None]))

# 공격(피해) 타입 — 신버전 핸드북은 attackType이 폐기(null)되고 damageType 배열로 이동.
DAMAGE_LABELS = {
    None: {"PHYSIC": "물리", "MAGIC": "마법", "NO_DAMAGE": "피해 없음", "HEAL": "치유"},
    "en": {"PHYSIC": "Physical", "MAGIC": "Arts", "NO_DAMAGE": "No damage", "HEAL": "Healing"},
    "ja": {"PHYSIC": "物理", "MAGIC": "術", "NO_DAMAGE": "ダメージなし", "HEAL": "治療"},
}
DAMAGE_KO = DAMAGE_LABELS[None]


def attack_of(hb, loc=None):
    # damageType(['PHYSIC'] 등)을 "물리·마법" 식 표기로. 옛 attackType이 있으면 우선.
    if hb.get("attackType"):
        return hb["attackType"]
    dt = hb.get("damageType") or []
    return "·".join(DAMAGE_LABELS[loc].get(d, d) for d in dt) or None


def ability_of(hb):
    # 능력은 abilityList([{text, textFormat}]) 각 줄을 개행으로 합친다. 옛 ability 문자열 폴백.
    al = hb.get("abilityList") or []
    lines = [a.get("text", "").strip() for a in al if a.get("text")]
    return "\n".join(lines) or hb.get("ability") or None


def dedupe_choices(chs):
    # 다단계 조우 씬은 후속 단계 선택지가 접두 매칭으로 전부 쓸려 들어와
    # 같은 선택지가 반복된다 — 제목+설명이 같으면 하나만 남긴다 (사용자 리포트 2026-07-18)
    seen, out = set(), []
    for c in chs:
        key = (c["title"], c.get("desc"))
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


def extract_encounters(choice_scenes, choices, tree_overrides=None, items=None):
    """조우 씬을 계단식 트리로 추출 (사용자 요청 2026-07-19).

    선택지(choice)의 `nextSceneId`가 후속 씬을 가리키고, 후속 씬은 부모와 같은 제목에
    새 지문·새 선택지를 갖는 다단계 구조다(흑류수해 최대 3단). choice id에서 끝 `_N`을
    떼면 그 선택지가 속한 씬 id가 나온다(choice_ro6_bat1_1 → scene_ro6_bat1(_enter),
    choice_ro6_bat1_1_2 → scene_ro6_bat1_1) — 이 정확 바인딩으로 트리를 복원한다.

    예전엔 접두 매칭으로 부모+자식 선택지를 한 리스트에 쏟고 제목 기준으로 씬을
    합쳐서(union) 같은 선택지가 여러 벌 반복됐다 — 그 중복을 트리로 대체한다.
    NEXT/NEXT_PROB(서사 진행)만 다음 씬을 중첩하고, TRADE·SACRIFICE 등 결과 분기는
    단말 선택지로 둔다(결과 씬은 같은 텍스트 반복뿐이라 파고들 실익이 없음).
    형제 선택지는 (제목,설명) 기준 중복 제거(확률 변형 '접과장품' 3벌 등).

    tree_overrides: {enter_scene_id: {"부모choice번호": [자식choice번호…]}} — 게임 데이터엔
    씬↔선택지 소속 링크가 없어(전투 돌입 등 후속 이벤트가 어느 선택 밑인지 미저장) 자동
    복원이 불가하다. 중요 조우만 choice의 끝번호(_N)로 부모-자식을 수작업 지정해 중첩한다
    (번호는 로케일 무관 — 사용자 확정 2026-07-19). rogueN-curated.json의 encounterTree."""
    tree_overrides = tree_overrides or {}
    relic_items = items or {}

    def name_reward(c, desc):
        # 선택지가 특정 소장품을 주면(displayData.itemId=RELIC) 이름을 병기한다.
        # 게임 텍스트가 "소장품 획득"으로 뭉뚱그린 확정 보상을 구체화 (사용자 요청 2026-07-20).
        # itemId=null(랜덤 소장품)·비(非)소장품(각뿔·희망 등)은 건드리지 않는다. 이미 설명에
        # 이름이 박힌 경우(예: 소장품 <전기주전자> 획득)도 그대로 둔다. 동명 선택지 3벌이
        # 서로 다른 소장품을 주면(곱사등이의 그림자/칼춤/배풍등) variants가 자동 분리된다.
        dd = c.get("displayData") or {}
        iid = dd.get("itemId")
        if not iid:
            return desc
        it = relic_items.get(iid)
        if not it or it.get("type") != "RELIC":
            return desc
        nm = (it.get("name") or "").strip()
        if not nm:
            return desc
        # 「소장품명」으로 감싸 프론트가 소장품 상세 모달로 링크(사용자 요청 2026-07-20).
        # 설명에 이름이 이미 평문으로 박혀 있으면 displayData.type과 무관하게 그 자리만
        # 감싼다 — 예전엔 건너뛰어서 "추억기 획득"류가 링크가 안 됐고(화룡점정, 2026-07-24),
        # '연구한다→불사'처럼 type=NORMAL인 확정 보상도 놓쳤다.
        bare = lambda s: re.sub(r"""[\s'"‘’“”「」『』()（）《》]""", "", s or "")
        if f"「{nm}」" in (desc or ""):
            return desc
        if desc and nm in desc:
            # 이미 따옴표류로 장식된 표기(“翱翼”·'꾸물이' 등)는 건드리지 않는다 —
            # 안에 「」를 겹치면 이중 장식이 되고, rogue6은 CN 원문이 번역 사전 키라
            # 문자열이 바뀌면 한국어 번역이 통째로 떨어져 나간다.
            i = desc.index(nm)
            deco = set("'\"‘’“”「」『』《》")
            if (i > 0 and desc[i - 1] in deco) or (i + len(nm) < len(desc) and desc[i + len(nm)] in deco):
                return desc
            return desc.replace(nm, f"「{nm}」", 1)
        # 이름이 설명에 없을 때의 끝 병기는 확정 보상 표기(type=ITEM)에만 — NORMAL 등에
        # 무턱대고 붙이면 보상이 아닌 항목까지 보상처럼 읽힌다.
        if dd.get("type") != "ITEM" or bare(nm) in bare(desc):
            return desc
        return f"{desc} 「{nm}」" if desc and desc.strip() else f"「{nm}」"

    from collections import defaultdict
    scene_ch = defaultdict(list)
    for cid, c in choices.items():
        base = re.sub(r"_\d+$", "", cid).replace("choice_", "scene_")
        parent = base if base in choice_scenes else (
            base + "_enter" if base + "_enter" in choice_scenes else None)
        if parent:
            scene_ch[parent].append((cid, c))
    def cnum_of(cid):
        m = re.search(r"_(\d+)$", cid)
        return int(m.group(1)) if m else 999
    for k in scene_ch:
        # 끝번호 숫자 정렬 — 문자열 정렬이면 _10이 _2보다 앞에 와서 게임의 저작 순서
        # (대리인 6종 → 떠나기 → 반복 → 특수 분기)가 흐트러진다 (화룡점정, 2026-07-24).
        scene_ch[k].sort(key=lambda x: (x[1].get("sortId") or 0, cnum_of(x[0]), x[0]))

    def group_by_title(nodes):
        # 다라운드 조우(춤 루프 '被歌颂的影子' 등)는 같은 선택지가 라운드마다 설명만 달리
        # 반복된다(加入它们 -1/-2/-3 HP · 收下 보상 12종). (제목,설명) 중복제거로는 안 걸려
        # 목록이 줄줄이 늘어난다 — 제목이 같으면 하나로 묶고, 서로 다른 설명을 variants로
        # 자식에 접는다 (사용자 리포트 2026-07-19). 순서=제목 첫 등장 순.
        order, groups = [], {}
        for n in nodes:
            if n["title"] not in groups:
                groups[n["title"]] = []
                order.append(n["title"])
            groups[n["title"]].append(n)
        out = []
        for title in order:
            g = groups[title]
            if len(g) == 1:
                out.append(g[0])
                continue
            variants, seen = [], set()
            nxt = None
            for n in g:
                # 이미 그룹화된 노드를 재그룹해도(동명 씬 병합 후 폴드) variants가 살도록
                # desc와 기존 variants를 함께 편입한다.
                for d in [n.get("desc")] + (n.get("variants") or []):
                    if d and d not in seen:
                        seen.add(d)
                        variants.append(d)
                # 변형 묶음이 돼도 첫 서사·하위 트리는 보존 — 예전엔 통째로 버려져서
                # '쉐이시를 바꾼다'(각뿔⇄촛불 변형)의 류아 분기가 사라졌다 (2026-07-24).
                if nxt is None and n.get("next"):
                    nxt = n["next"]
            node = {"title": title, "desc": None}
            if variants:
                node["variants"] = variants
            if nxt:
                node["next"] = nxt
            out.append(node)
        return out

    def build_scene(sid, seen, exempt=frozenset()):
        # 원시 노드 목록(_num=choice 끝번호 보유, 그룹화 전). 하위 씬도 재귀로 원시.
        # exempt: encounterTree가 지목한 선택 번호는 (제목,desc)가 같아도 dedup에서 제외한다
        # — 미치광이 인형처럼 '껴안는다'가 라운드별로 제목·desc 동일하나 결과가 다른 시퀀스 보존.
        nodes, dedup = [], set()
        for cid, c in scene_ch.get(sid, []):
            m = re.search(r"_(\d+)$", cid)
            cnum = int(m.group(1)) if m else -1
            desc = name_reward(c, c.get("description"))
            key = (c["title"], desc)
            if key in dedup and cnum not in exempt:
                continue
            dedup.add(key)
            node = {"title": c["title"], "desc": desc, "_num": cnum}
            nxt = c.get("nextSceneId")
            # 결과 씬 지문을 항상 _resultDesc에 담아둔다(원시). NEXT류는 아래서 next로 승격되고,
            # TRADE/SACRIFICE는 평소엔 버려지지만 encounterTree로 중첩될 때 서사로 복원된다.
            if nxt and nxt in choice_scenes:
                node["_resultDesc"] = (choice_scenes[nxt].get("description") or "").strip() or None
            if (nxt and nxt in choice_scenes and nxt not in seen
                    and str(c.get("type", "")).startswith("NEXT")):
                sub = build_scene(nxt, seen | {nxt})
                sub_desc = (choice_scenes[nxt].get("description") or "").strip()
                if sub or sub_desc:
                    node["next"] = {"desc": sub_desc or None, "choices": sub}
            nodes.append(node)
        return nodes

    def finalize(nodes):
        # 하위 next.choices 먼저 재귀 그룹화 → 이 레벨 제목 그룹화 → 내부 필드 제거
        for n in nodes:
            if n.get("next"):
                n["next"]["choices"] = finalize(n["next"]["choices"])
        grouped = group_by_title(nodes)
        for n in grouped:
            n.pop("_num", None)
            n.pop("_resultDesc", None)
        return grouped

    def apply_overrides(raw, sid):
        # 수작업 지정된 부모→자식 번호대로 자식 노드를 부모의 next.choices로 옮긴다.
        ov = tree_overrides.get(sid)
        if not ov:
            return raw
        by_num = {n["_num"]: n for n in raw}
        moved = set()
        for pnum, cnums in ov.items():
            parent = by_num.get(int(pnum))
            if parent is None:
                continue
            # 부모가 TRADE라 next가 없으면, 결과 씬 지문(_resultDesc)을 서사로 승격해 만든다.
            nx = parent.get("next")
            if nx is None:
                nx = {"desc": parent.get("_resultDesc"), "choices": []}
                parent["next"] = nx
            elif not nx.get("desc"):
                nx["desc"] = parent.get("_resultDesc")
            for cnum in cnums:
                child = by_num.get(int(cnum))
                if child is not None and int(cnum) not in moved:
                    nx["choices"].append(child)
                    moved.add(int(cnum))
        return [n for n in raw if n["_num"] not in moved]

    encounters = []
    for sid, sc in choice_scenes.items():
        if not sid.endswith("_enter") or "startbuff" in sid:
            continue
        bg = sc.get("background")
        if bg:
            bg = bg.removesuffix(".png").lower()
        ov = tree_overrides.get(sid) or {}
        exempt = {int(p) for p in ov} | {int(c) for cs in ov.values() for c in cs}
        encounters.append({
            "scene": sid, "title": sc["title"], "desc": sc.get("description"),
            "bg": bg, "choices": finalize(apply_overrides(build_scene(sid, {sid}, exempt), sid)),
        })
    encounters.sort(key=lambda x: x["scene"])
    # 동명 enter 씬(溯源 19변형·三重身 3변형 등)은 대표 1개만 — 예전엔 선택지를 union해
    # 중복이 폭발했다. 트리는 첫 대표 것을 유지하고 배경/지문만 보충하되, 대표 트리 어디에도
    # 없는 고유 선택지만 뒤에 덧붙인다(화룡점정 marketsp 진입 변형의 촛불 교환 등 —
    # 사용자 요청 2026-07-24). (제목,설명) 재귀 대조라 溯源류 동일 변형은 전처럼 무시된다.
    def tree_keys(chs, acc):
        for c in chs:
            acc.add((c["title"], c.get("desc")))
            for v in c.get("variants") or []:
                acc.add((c["title"], v))
            if c.get("next"):
                tree_keys(c["next"]["choices"], acc)
        return acc
    merged, by_title = [], {}
    for e in encounters:
        m = by_title.get(e["title"])
        if m is None:
            by_title[e["title"]] = e
            merged.append(e)
            continue
        m["desc"] = m["desc"] or e["desc"]
        m["bg"] = m["bg"] or e["bg"]
        have = tree_keys(m["choices"], set())
        extra = [c for c in e["choices"]
                 if (c["title"], c.get("desc")) not in have
                 and not any((c["title"], v) in have for v in c.get("variants") or [])]
        if extra:
            m["choices"] = group_by_title(m["choices"] + extra)
    return merged


def load_encounter_tree(rogue_name):
    """rogueN-curated.json의 encounterTree(수작업 부모→자식 선택지 중첩) 로드."""
    path = os.path.join(REPO, "scripts", f"{rogue_name}-curated.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8")).get("encounterTree") or {}
    return {}


def num(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return round(v, 3) if isinstance(v, float) else v


def merge_dup_enemies(stages, enemies):
    """완전 동일(이름·스탯·능력·이미지)한 적 엔트리는 하나로 병합 — 같은 오브젝트가
    배치 위치별로 id만 다른 경우(시대의 흔적 x/y/z 등, 사용자 확정 2026-07-18).
    긴급 룬(per/replace)이 참조하는 키는 병합 대상에서 제외해 참조 무결성을 지킨다."""
    protected = set()
    for st in stages:
        emg = st.get("emg") or {}
        for p in emg.get("per") or []:
            protected.update(p.get("keys") or [])
        for f, to in (emg.get("replace") or {}).items():
            protected.update([f, to])
    sig_of, remap = {}, {}
    for key in sorted(enemies):
        if key in protected:
            continue
        e = enemies[key]
        sig = json.dumps({a: e.get(a) for a in e if a != "index"},
                         ensure_ascii=False, sort_keys=True)
        if sig in sig_of:
            remap[key] = sig_of[sig]
        else:
            sig_of[sig] = key
    for key in remap:
        del enemies[key]
    if remap:
        for st in stages:
            merged, out = {}, []
            for se in st["enemies"]:
                k = remap.get(se["key"], se["key"])
                if k in merged:
                    merged[k]["cnt"] += se["cnt"]
                else:
                    ne = dict(se, key=k)
                    merged[k] = ne
                    out.append(ne)
            st["enemies"] = out
    return len(remap)


# 토픽별 고유 시스템 갤러리 — (라벨, 소스, 필터). 전시관 탭에 이름+설명 갤러리로 렌더.
#   source="item"     → items 중 type이 필터에 속하는 것 (이름 기준 중복제거)
#   source="charbuff" → charBuffData 중 buffType이 필터에 속하는 것 (거부반응/생체변이)
#   source="variation"→ variationData 전부 (붕괴 패러다임 — 이름이 플레이스홀더라 desc가 본체)
MECH_GROUPS = {
    # 첫 항목=시그니처 시스템(전시관 밖 최상위 탭으로 승격) · 나머지=전시관 안 서브탭
    "rogue_2": [("거부반응", "charbuff", ["MUTATION", "EVOLUTION"]),
                ("계시", "squadbuff", None),
                ("주사위", "item", ["DICE_TYPE"])],
    "rogue_3": [("암호판", "item", ["TOTEM"]),
                ("붕괴 패러다임", "module_chaos", None)],
    "rogue_4": [("사고", "fragment", None),
                ("시대", "module_disaster", None)],
    "rogue_5": [("주화", "item", ["COPPER", "COPPER_BUFF"]),
                ("분노", "module_wrath", None)],
}

# 노드 타입별 기능 설명 (수작업 큐레이션, 2026-07-19). 게임 데이터의 description은
# 플레이버 텍스트뿐이라, 실제로 뭘 하는 노드인지를 UI에 병기한다. 근거: 게임 상식 +
# 데이터 교차 확인(거짓과 진실=battleLoadingTips 사고 레어도, 길라잡이=모집권 저장 팁,
# 울창한 숲길=아이템 '숨겨진 비경 진입' 문구, 앞서 출발=rogue_5 주화 '계원행' 문구).
# NODE_FUNC[tid]가 공통 표를 오버라이드 (같은 타입이라도 토픽마다 기능이 다른 경우).
NODE_FUNC_COMMON = {
    "BATTLE_NORMAL": "일반 전투 노드입니다. 승리하면 소장품·오리지늄각뿔 등 보상을 얻습니다.",
    "BATTLE_ELITE": "일반 작전보다 강한 적이 나오는 고난도 전투입니다. 그만큼 보상(희망 등)이 좋습니다.",
    "BATTLE_BOSS": "층의 마지막을 지키는 보스 전투입니다. 통과해야 다음 층으로 나아갈 수 있습니다.",
    "SHOP": "오리지늄각뿔로 소장품·아이템을 사거나 목표 생명력을 회복할 수 있는 상점입니다.",
    "BATTLE_SHOP": "오리지늄각뿔로 소장품·아이템을 사거나 목표 생명력을 회복할 수 있는 상점입니다.",
    "REST": "목표 생명력 회복, 오퍼레이터 임시 승급 등 정비 선택지를 제공하는 휴식 노드입니다.",
    "INCIDENT": "무작위 이벤트가 발생하는 노드입니다. 선택지에 따라 보상을 얻거나 대가를 치릅니다.",
    "ENTERTAINMENT": "테마마다 다른 미니게임·내기가 벌어지는 오락 노드입니다. 결과에 따라 보상이 달라집니다.",
    "UNKNOWN": "어떤 노드인지 가려져 있는 미확인 노드입니다. 진입하면 실제 노드가 드러납니다.",
    "WISH": "무작위로 제시되는 모집권 중 원하는 것을 골라 획득하는 노드입니다.",
    "SACRIFICE": "가진 것(목표 생명력·소장품 등)을 대가로 바치고 다른 보상과 맞바꾸는 노드입니다.",
    "EXPEDITION": "오퍼레이터 일부를 파견 보내는 노드입니다. 파견된 오퍼레이터는 한동안 편성에서 빠지고, 복귀할 때 보상을 가져옵니다.",
    "STORY": "엔딩 분기와 이어지는 스토리 이벤트 노드입니다. 진행 상황·소지품에 따라 특정 위치에 나타나며, 히든 엔딩 루트로 이어지기도 합니다.",
    "STORY_HIDDEN": "엔딩 분기와 이어지는 스토리 이벤트 노드입니다. 진행 상황·소지품에 따라 특정 위치에 나타나며, 히든 엔딩 루트로 이어지기도 합니다.",
    "DUEL": "상대를 골라 싸우는 특수 전투입니다. 패배해도 목표 생명력이 깎이지 않으며, 어려운 상대일수록 보상이 좋습니다.",
    "TREASURE": "전투 없이 소장품 등 보상을 얻어 가는 보물 노드입니다.",
    "PORTAL": "특수 구역으로 통하는 입구입니다. 진입하면 별도의 구역·이벤트로 이어집니다.",
    "MISSION": "의뢰를 받아 조건을 달성하면 보상을 받는 노드입니다.",
    "ALCHEMY": "재료를 투입해 다른 결과물로 바꾸는 정련 노드입니다.",
}
NODE_FUNC = {
    "rogue_3": {
        "PORTAL": "숨겨진 비경으로 통하는 입구입니다. 비경에서는 전용 조우가 확률적으로 등장합니다.",
    },
    "rogue_4": {
        "ALCHEMY": "'사고'를 투입해 다른 결과물로 바꾸는 정련 노드입니다. 사고의 레어도가 결과물의 품질에 영향을 줍니다.",
    },
    "rogue_5": {
        "PORTAL": "특수 구역 '시비경'으로 통하는 입구입니다.",
        "SPECIAL_ZONE": "특수 구역 '시비경'으로 통하는 입구입니다.",
        "STASHED_RECRUIT": "저장해 둔 모집권을 사용할 수 있는 노드입니다. 여기서 사용하면 희망 소모가 줄어듭니다.",
    },
    "rogue_6": {
        "PORTAL": "가공품을 소모해 히든 구역 '흑담'으로 진입하는 입구입니다. 흑담에서는 유토피아 규칙이 적용됩니다.",
        "SCRAP_SHOP": "부품(자연물·가공품·개념체)으로 거래하는 비경의 상인입니다.",
        "DOOR": "지도 위 떨어진 지점을 잇는 지름길 통로입니다. 이동에 드는 행동력을 아낄 수 있습니다.",
        "FINAL": "탐험의 마지막을 장식하는 최종 전투 노드입니다.",
        "EVACUATE": "보스전을 정면으로 치르지 않고 빠져나가는 샛길입니다.",
        "EMPLOY": "탐험 중 임시 지원을 받을 수 있는 노드입니다.",
        "LIGHT": "주변 지형과 노드를 미리 내려다보고 표시해 두는 조망 노드입니다.",
        "EMPTY": "아무 일도 일어나지 않는 빈 노드입니다. 행동력을 아끼며 지나가는 길목입니다.",
        "BATTLE_SAVAGE": "'주민' 거점을 공격하는 고난도 전투입니다. 기밀 등급 4 이상에서만 등장합니다.",
    },
}

def node_func(tid, ntype):
    return (NODE_FUNC.get(tid) or {}).get(ntype) or NODE_FUNC_COMMON.get(ntype)

def build_topic(tid="rogue_1", loc=None):
    """KR 정식 출시 토픽(rogue_1~5) 공통 빌더 — 스테이지 id 접두 roN_ 공통,
    토픽 고유 시스템(음반/메아리/탐사 도구 등)은 데이터 존재 여부로 분기한다.
    loc="en"|"ja"면 텍스트 테이블만 글로벌/일본 서버 데이터로 바꿔 rogueN.<loc>.json 생성
    — 수치(레벨 파일·enemy_database)는 서버 공통이라 KR 캐시를 그대로 쓴다."""
    ronum = tid.split("_")[1]  # "1"~"5"
    branch = {"en": "en", "ja": "jp"}.get(loc, "kr")
    table = fetch_json("excel/roguelike_topic_table.json", branch)
    topic = table["topics"][tid]
    r = table["details"][tid]
    handbook = fetch_json("excel/enemy_handbook_table.json", branch)["enemyData"]
    enemy_db = fetch_json("levels/enemydata/enemy_database.json")
    # 큐레이션(한국어 집필) 문자열 번역 오버레이 — 없는 문장은 KR 폴백 + 리포트
    tr_map = {}
    if loc:
        p = os.path.join(REPO, "scripts", "rogue-i18n.json")
        if os.path.exists(p):
            tr_map = (json.load(open(p, encoding="utf-8")) or {}).get(loc) or {}
    tr_missing = set()
    def tr(s):
        if not loc or s is None:
            return s
        if s in tr_map:
            return tr_map[s]
        tr_missing.add(s)
        return s

    items = r["items"]  # 유물/음반/티켓 등 표시 텍스트

    # ── 존 — 숫자 존(zone_N)만. portal_/zone_s_/zone_sky_/zone_N_b 등 변형·하위
    # 존은 본 존과 내용이 중복이라 제외 (rogue_6의 중복 변형 존 제거 규칙과 동일 취지)
    zones = []
    for zid, z in r["zones"].items():
        m = re.fullmatch(r"zone_(\d+)", zid)
        if not m:
            continue
        desc = (z.get("description") or "").split("\n", 1)
        zones.append({
            "id": zid, "num": int(m.group(1)), "name": z["name"],
            "time": desc[0] if len(desc) > 1 else None,
            "desc": desc[1] if len(desc) > 1 else desc[0],
            "buff": z.get("buffDescription"), "hidden": bool(z.get("isHiddenZone")),
        })
    zones.sort(key=lambda z: z["num"])
    # 포탈 존 (rogue_5 시비경·금석경 — gameConst.portalZones): 숫자 존이 아니지만 변형 중복이
    # 아니라 고유 콘텐츠다 — '의문 탐색 가능'(쉐이 울림 분대 sp·탐색 유물 페어)으로 여는
    # '기이한 공간' 입구로 진입하는 특수 경계 (nodeTypes func "특수 구역 '시비경'으로 통하는
    # 입구" 참조, 사용자 제보 2026-07-21). 일반 층 뒤에 num 90+로 덧붙이고 portal 플래그.
    # 배경 파일명이 불규칙(backgroundId: rogue_5_map_0 / rogue_5_map_sky_2)이라 bg에 실어 준다.
    # ⚠ rogue_5 전용: 다른 토픽의 portalZones는 성격이 다르다 — rogue_3는 이역 변형
    # 수백 개(zone_s_*), rogue_4는 시공 포탈 내부 구획 — 존 카드로 실으면 안 된다.
    seen_zone_names = {z["name"] for z in zones}
    portal_ids = ((r.get("gameConst") or {}).get("portalZones") or []) if tid == "rogue_5" else []
    for i, pzid in enumerate(portal_ids):
        z = r["zones"].get(pzid)
        # portalZones엔 본 존의 _b 변형(홍육루·산수각·시말릉 — 설명·버프·배경 전부 동일)도
        # 섞여 있다 — 이름이 이미 있는 존은 중복이라 제외 (rogue_6 변형 존 제거 규칙과 동일)
        if not z or z["name"] in seen_zone_names:
            continue
        seen_zone_names.add(z["name"])
        desc = (z.get("description") or "").split("\n", 1)
        zones.append({
            "id": pzid, "num": 90 + i, "name": z["name"], "portal": True,
            "time": desc[0] if len(desc) > 1 else None,
            "desc": desc[1] if len(desc) > 1 else desc[0],
            "buff": z.get("buffDescription"), "hidden": bool(z.get("isHiddenZone")),
            "bg": z.get("backgroundId"),
        })
    # 존 배경 — ui/rogueliketopic/topics/<tid>_update/levelbgpic/<파일명>.png
    # (_update 폴더가 없는 토픽은 topics/<tid>/levelbgpic 폴백)
    zone_file = lambda z: z.get("bg") or f"{tid}_map_{z['num']}"
    zone_dir = os.path.join(REPO, "public", "rogue", "zone")
    for sub in (f"{tid}_update", tid):
        pend = [z for z in zones if not os.path.exists(os.path.join(zone_dir, f"{zone_file(z)}.webp"))]
        if not pend:
            break
        download_webp([(f"{ASSETS}/ui/rogueliketopic/topics/{sub}/levelbgpic/{zone_file(z)}.png",
                        os.path.join(zone_dir, f"{zone_file(z)}.webp")) for z in pend], max_px=900)
    for z in zones:
        z["img"] = os.path.exists(os.path.join(zone_dir, f"{zone_file(z)}.webp"))
    # 홈 화면 키비주얼(히어로 배경) → public/rogue/kv<N>.webp. 인게임 KV는
    # 좌/우 반쪽 2장(각 780×960)을 가로로 이어붙인 와이드 아트 — 폴더·파일명이
    # 토픽마다 불규칙해 개별 매핑. 이미 있으면 스킵 (사용자 확정 아트 2026-07-18).
    # ⚠ rogue_3 좌측 반쪽엔 CN 제목이 박혀 있어 커밋본 kv3.webp는 하늘 그라데이션
    # 보간으로 텍스트를 지운 가공본 — 삭제 후 재실행하면 텍스트가 되살아난다.
    KV_SRC = {
        "rogue_2": ("rogue_2_update/entrykeyvisuals/rogue_2_kv_1_2/rl2_home_kv12_bg1.png",
                    "rogue_2_update/entrykeyvisuals/rogue_2_kv_1_2/rl2_home_kv12_bg2.png"),
        "rogue_3": ("rogue_3_update/entrykeyvisuals/rogue_3_kv_1_2/rl3_home_kv_2_1.png",
                    "rogue_3_update/entrykeyvisuals/rogue_3_kv_1_2/rl3_home_kv_2_2.png"),
    }
    kv_dest = os.path.join(REPO, "public", "rogue", f"kv{ronum}.webp")
    if tid in KV_SRC and not os.path.exists(kv_dest):
        import io
        from PIL import Image
        halves = []
        for p in KV_SRC[tid]:
            req = urllib.request.Request(f"{ASSETS}/ui/rogueliketopic/topics/{p}",
                                         headers={"User-Agent": "Mozilla/5.0"})
            halves.append(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=30).read())).convert("RGB"))
        h = min(im.height for im in halves)
        wide = Image.new("RGB", (sum(im.width for im in halves), h))
        x = 0
        for im in halves:
            wide.paste(im, (x, 0)); x += im.width
        if wide.width > 1280:
            wide = wide.resize((1280, round(wide.height * 1280 / wide.width)), Image.LANCZOS)
        wide.save(kv_dest, "WEBP", quality=88)

    # ── 스테이지 + 레벨 파일 (일반/긴급이 같은 levelId 공유 → 캐시) ──────────
    map_dir = os.path.join(REPO, "public", "rogue", "map")
    level_cache = {}
    def load_level(level_id):
        if level_id in level_cache:
            return level_cache[level_id]
        lv = fetch_json(f"levels/{level_id.lower()}.json")
        # 등장 적: enemyDbRefs 순서 = 인게임 표시 순서
        refs = [{"key": e["id"], "level": e.get("level", 0),
                 "over": e.get("overwrittenData")} for e in lv.get("enemyDbRefs", [])]
        # 스폰 수: waves + branches(조건 스폰 — 최대치 기준)
        counts = {}
        def count_actions(actions):
            for a in actions or []:
                if a.get("actionType") in (0, "SPAWN") and a.get("key"):
                    counts[a["key"]] = counts.get(a["key"], 0) + a.get("count", 1)
        for w in lv.get("waves", []):
            for f in w.get("fragments", []):
                count_actions(f.get("actions"))
        for b in (lv.get("branches") or {}).values():
            for ph in b.get("phases", []):
                count_actions(ph.get("actions"))
        # 긴급 작전(FOUR_STAR 룬) 해석:
        #   enemy_attribute_mul/add · ebuff_attribute — 적 스탯 배율 (ebuff는 enemy 셀렉터로
        #   특정 적 한정 가능) / level_enemy_replace — 긴급 시 적 교체 (더 강한 변종으로)
        emg = {}
        for rune in lv.get("runes") or []:
            if rune.get("difficultyMask") not in ("FOUR_STAR", 8):
                continue
            key = rune.get("key")
            bbs = rune.get("blackboard", [])
            bb_map = {bb["key"]: (bb["valueStr"] if bb.get("valueStr") is not None else bb.get("value")) for bb in bbs}
            if key in ("enemy_attribute_mul", "enemy_attribute_add"):
                for bb in bbs:
                    if bb.get("value") is not None:
                        emg.setdefault(key.rsplit("_", 1)[1], {})[bb["key"]] = num(bb["value"])
            elif key == "ebuff_attribute":
                stats = {k: num(v) for k, v in bb_map.items() if k != "enemy" and isinstance(v, (int, float))}
                sel = bb_map.get("enemy")
                if sel:  # 특정 적 한정 배율
                    keys = [re.sub(r"#\d+$", "", e) for e in str(sel).split("|")]
                    emg.setdefault("per", []).append({"keys": keys, "mul": stats})
                else:
                    emg.setdefault("mul", {}).update(stats)
            elif key == "level_enemy_replace":
                frm = re.sub(r"#\d+$", "", str(bb_map.get("key") or ""))
                to = re.sub(r"#\d+$", "", str(bb_map.get("value") or ""))
                if frm and to:
                    emg.setdefault("replace", {})[frm] = to
        level_cache[level_id] = {"refs": refs, "counts": counts, "emg": emg, "raw": lv}
        return level_cache[level_id]

    used_enemies = {}  # key → {level, over} (스탯 해석용 대표 ref)
    stages = []
    for st in r["stages"].values():
        sid = st["id"]
        parts = sid.split("_")  # roN_n_1_1 / roN_e_1_1 / roN_b_1 / roN_ev_1 / roN_t_1 / roN_duel_1 / ro5_fs_1
        kind_code = parts[1]
        # t=특수(조우·이벤트 전투) / duel=외나무다리 / fs·sv·dv=IS5 고유(시련 계열)
        kind = {"n": "normal", "e": "emergency", "b": "boss", "ev": "event", "t": "special",
                "duel": "duel", "fs": "trial", "sv": "trial", "dv": "trial"}.get(kind_code, kind_code)
        # e_t_N = 특수 스테이지의 긴급판 (t와 페어) — kind는 emergency 그대로, zone 없음
        zone = int(parts[2]) if kind_code in ("n", "e") and parts[2].isdigit() else None
        lv = load_level(st["levelId"])
        enemies = []
        for ref in lv["refs"]:
            cnt = lv["counts"].get(ref["key"], 0)
            enemies.append({"key": ref["key"], "cnt": cnt})
            cur = used_enemies.get(ref["key"])
            if cur is None or ref["level"] > cur["level"]:
                used_enemies[ref["key"]] = ref
        # 긴급 교체(level_enemy_replace) 대상 적도 도감에 포함
        for to in (lv["emg"].get("replace") or {}).values():
            if to not in used_enemies:
                used_enemies[to] = {"key": to, "level": 0, "over": None}
        stages.append({
            "id": sid, "kind": kind, "zone": zone, "code": st.get("code"),
            # 히든 최종전(ro4_b_9 등)은 원본 이름이 공백 — 인게임 미스터리 연출 그대로 "???" 표기
            "name": (st["name"] or "").strip() or "???", "desc": (st.get("description") or "").strip() or None,
            "eliteDesc": st.get("eliteDesc") or None,
            "emg": lv["emg"] if kind == "emergency" else None,
            "enemies": enemies,
        })
    order = {"normal": 0, "emergency": 1, "boss": 2, "event": 3, "special": 4, "duel": 5, "trial": 6}
    stages.sort(key=lambda s: (order.get(s["kind"], 9), s["zone"] or 0, s["id"]))

    # 전투 노드 미리보기 — 인게임 맵 프리뷰(arts/ui/stage/mappreviews/<stageId>.png).
    # 없는 스테이지만 level mapData 격자 렌더로 폴백.
    download_webp([(f"{ASSETS}/arts/ui/stage/mappreviews/{s['id']}.png",
                    os.path.join(map_dir, f"{s['id']}.webp")) for s in stages], max_px=640)
    for s in stages:
        dest = os.path.join(map_dir, f"{s['id']}.webp")
        if not os.path.exists(dest):
            lvid = r["stages"][s["id"]]["levelId"]
            render_minimap(level_cache[lvid]["raw"], dest)
        s["map"] = s["id"] if os.path.exists(dest) else None

    # ── 적 도감 (등장 적만) ───────────────────────────────────────────────────
    enemies = {}
    for key, ref in used_enemies.items():
        db = enemy_db.get(key)
        if not db:
            continue
        by_level = {e["level"]: e["enemyData"] for e in db}
        base = by_level.get(0, db[0]["enemyData"])
        pick = by_level.get(ref["level"], base)
        def attr(name, default=None):
            v = mv((pick.get("attributes") or {}).get(name))
            if v is None:
                v = mv((base.get("attributes") or {}).get(name), default)
            # 레벨 파일 overwrittenData가 최종 오버라이드
            ow = ((ref.get("over") or {}).get("attributes") or {}).get(name)
            ov = mv(ow) if ow else None
            return ov if ov is not None else v
        hb = handbook.get(key) or handbook.get(key.rsplit("_", 1)[0]) or {}
        # enemy_database는 KR 캐시 공유 — 로케일 빌드에선 핸드북(현지어) 이름을 우선한다
        name = (hb.get("name") or mv(pick.get("name")) or mv(base.get("name")) or key) if loc \
            else (mv(pick.get("name")) or mv(base.get("name")) or hb.get("name") or key)
        name = ENEMY_NAME_FIX.get(name, name)  # 적 이름 교정 (캔모씨→캔낫 등, 사용자 확정)
        enemies[key] = {
            "name": name,
            "rank": hb.get("enemyLevel"),  # NORMAL/ELITE/BOSS
            "index": hb.get("enemyIndex"),
            "attack": attack_of(hb, loc),
            "desc": hb.get("description"),
            "ability": ability_of(hb),
            "hp": num(attr("maxHp", 0)), "atk": num(attr("atk", 0)),
            "def": num(attr("def", 0)), "res": num(attr("magicResistance", 0)),
            "aspd": num(attr("attackSpeed", 100)), "ms": num(attr("moveSpeed", 1)),
            "weight": num(attr("massLevel", 1)),
            "lifePoint": mv(pick.get("lifePointReduce"), mv(base.get("lifePointReduce"), 1)),
            "immune": [lb for k, lb in zip(IMMUNE_FIELDS, IMMUNE_LABELS[loc]) if attr(k, False)],
        }

    # 적 초상 — arts/enemies/<id>.png (변종 _N은 원본 id 초상으로 폴백)
    enemy_dir = os.path.join(REPO, "public", "rogue", "enemy")
    jobs, img_of = [], {}
    for key in enemies:
        cands = [key]
        b = re.sub(r"_\d+$", "", key)
        if b != key:
            cands.append(b)
        for cand in cands:
            dest = os.path.join(enemy_dir, f"{cand}.webp")
            if os.path.exists(dest):
                img_of[key] = cand
                break
            jobs.append((f"{ASSETS}/arts/enemies/{cand}.png", dest))
    fails = {u.rsplit("/", 1)[-1][:-4] for u, _ in download_webp(jobs, max_px=256)}
    for key in enemies:
        if key in img_of:
            continue
        for cand in [key, re.sub(r"_\d+$", "", key)]:
            if cand not in fails and os.path.exists(os.path.join(enemy_dir, f"{cand}.webp")):
                img_of[key] = cand
                break
    for key, e in enemies.items():
        e["img"] = img_of.get(key)
    merged_n = merge_dup_enemies(stages, enemies)
    if merged_n:
        print(f"  동일 적 병합: {merged_n}건")

    # ── 전시관: 유물(소장품) / 레퍼토리(음반) / 무대 도구 / 분대 ─────────────
    relic_order = (r["archiveComp"]["relic"] or {}).get("relic", {})
    relics = []
    for iid, it in items.items():
        if it.get("type") != "RELIC":
            continue
        arc = relic_order.get(iid, {})
        relics.append({
            "id": iid, "name": it["name"], "desc": it.get("description"),
            "usage": it.get("usage"), "obtain": it.get("obtainApproach"),
            "order": arc.get("orderId"), "group": arc.get("relicGroupId"),
            "sort": arc.get("relicSortId", 9999), "sp": bool(arc.get("isSpRelic")),
        })
    # 유물번호(orderId) 정렬 — 숫자 번호 오름차순, 특수 번호(PCS01 등)는 뒤에, 번호 없으면 맨 뒤
    def relic_order_key(x):
        o = x.get("order") or ""
        if o.isdigit():
            return (0, int(o), "")
        return (1, 0, o) if o else (2, 0, x["id"])
    relics.sort(key=relic_order_key)
    relic_icon_dir = os.path.join(REPO, "public", "rogue", "relic")
    for x in relics:
        x["img"] = os.path.exists(os.path.join(relic_icon_dir, f"{x['id']}.webp"))

    capsules = []
    cap_order = (r["archiveComp"].get("capsule") or {}).get("capsule") or {}
    for iid, it in items.items():
        if it.get("type") != "CAPSULE":
            continue
        arc = cap_order.get(iid, {})
        capsules.append({
            "id": iid, "name": it["name"], "en": arc.get("englishName"),
            "desc": it.get("description"), "usage": it.get("usage"),
            "sort": arc.get("capsuleSortId", 9999),
        })
    capsules.sort(key=lambda x: x["sort"])
    # 음반 자켓 — ui/rogueliketopic/topics/<tid>/capsule/<id>.png (rogue_1만 존재)
    cap_dir = os.path.join(REPO, "public", "rogue", "capsule")
    download_webp([(f"{ASSETS}/ui/rogueliketopic/topics/{tid}/capsule/{c['id']}.png",
                    os.path.join(cap_dir, f"{c['id']}.webp")) for c in capsules], max_px=360)
    for c in capsules:
        c["img"] = os.path.exists(os.path.join(cap_dir, f"{c['id']}.webp"))

    # 악단(BAND) 아이콘 — init/initreliciconpic/<id>.png (파일명이 아이템 id와 일치).
    # relic 폴더에 받아 두면 item_group의 img 판정이 자동으로 붙는다.
    band_ids = [iid for iid, it in items.items() if it.get("type") == "BAND"]
    download_webp([(f"{ASSETS}/ui/rogueliketopic/topics/{tid}/init/initreliciconpic/{bid}.png",
                    os.path.join(relic_icon_dir, f"{bid}.webp")) for bid in band_ids], max_px=180, photo=False)

    def item_group(itype):
        # 같은 이름은 업그레이드 티어 중복 (스쿼드 등) — usage가 가장 긴(최종 티어) 항목만 대표로
        # 남긴다 (사용자 요청 2026-07-18: 모든 록라 스쿼드 중복 제거)
        best = {}
        for iid, it in items.items():
            if it.get("type") != itype:
                continue
            nm = it["name"]
            score = len(it.get("usage") or "") + len(it.get("description") or "")
            if nm not in best or score > best[nm][0]:
                best[nm] = (score, {"id": iid, "name": nm, "desc": it.get("description"), "usage": it.get("usage"),
                                    "img": os.path.exists(os.path.join(REPO, "public", "rogue", "relic", f"{iid}.webp"))})
        return [e for _, e in best.values()]
    tools = item_group("ACTIVE_TOOL")
    bands = item_group("BAND")
    explore_tools = item_group("EXPLORE_TOOL")  # IS3 탐사 도구 (다른 토픽은 빈 배열)

    # ── 토픽 고유 시스템 갤러리 (환경 탭) — 토픽마다 다른 예외 메커니즘/수집품을 이름+설명으로.
    #    미즈키=거부반응/주사위 · 사미=붕괴/토템 · 살카즈=파편/재앙 · 쉐이=주화/분노 (사용자 요청).
    #    변형(_a/_b…)이 많아 이름 기준으로 중복 제거하고, 설명이 가장 자세한 항목을 대표로 쓴다.
    def has_icon(iid):
        return os.path.exists(os.path.join(REPO, "public", "rogue", "relic", f"{iid}.webp"))
    # 아이템계 항목의 아이콘 폴백 후보 — 변형 접미사(_a/_i…)는 베이스 아이콘을 공유하고,
    # rogue_5 주화는 강화(copper_buff_)·환전(change_copper_)이 본체 주화 아이콘,
    # 도금 강화(gild_bat_)가 도금(gild_) 아이콘을 공유한다 (아틀라스엔 베이스만 존재).
    def item_icon_cands(iid):
        cands = [iid]
        for pat, rep in ((r"_[a-z]$", ""), ("copper_buff_", "copper_"),
                         ("change_copper_", "copper_"), ("gild_bat_", "gild_")):
            for c in list(cands):
                n = re.sub(pat, rep, c)
                if n not in cands:
                    cands.append(n)
        return cands
    # 고유 시스템 아이콘 정적 PNG (아이템 아틀라스 밖 소스) — (url, 아이콘id) 잡을 모아
    # relic 폴더에 내려받는다: 변이=bufficon/, 붕괴·시대·분노=misc/, 도금=copper/gildicon/
    mech_jobs = set()
    mechanics = []
    mods = (table.get("modules") or {}).get(tid) or {}
    for label, source, mfilter in MECH_GROUPS.get(tid, []):
        entries = []
        # usage=기계적 효과, desc=플레이버 (소장품처럼 둘 다 상세 모달에 표시)
        if source in ("item", "fragment"):
            best = {}
            for iid, it in items.items():
                if source == "fragment":
                    if it.get("type") != "FRAGMENT":
                        continue
                elif it.get("type") not in mfilter:
                    continue
                nm = it.get("name")
                usage = (it.get("usage") or "").strip()
                desc = (it.get("description") or "").strip()
                if not nm or not (usage or desc):
                    continue
                if nm not in best or len(usage) + len(desc) > best[nm]["_len"]:
                    cands = item_icon_cands(iid)
                    for c in cands:
                        if re.fullmatch(r"rogue_\d+_gild_\d+", c):
                            mech_jobs.add((f"{ASSETS}/ui/rogueliketopic/topics/{tid}/copper/gildicon/{c}.png", c))
                    e = {"id": iid, "name": nm, "usage": usage or None, "desc": desc or None,
                         "_cands": cands, "_len": len(usage) + len(desc)}
                    if source == "fragment":
                        # 사고 3분류 — id 접두 D/F/I = 염원/영감/구상 (사용자 확인 2026-07-18:
                        # usage에 '사용 시'가 있으면 영감(F), 없으면 염원(D), '구상'(I)은 단일 항목)
                        code = iid.replace(f"{tid}_fragment_", "").split("_")[0]
                        e["kind"] = tr({"D": "염원", "F": "영감", "I": "구상"}.get(code, "기타"))
                    best[nm] = e
            entries = [{k: v for k, v in e.items() if k != "_len"} for e in best.values()]
            if source == "fragment":
                korder = {"염원": 0, "영감": 1, "구상": 2}
                entries.sort(key=lambda e: korder.get(e.get("kind"), 9))
        elif source == "charbuff":
            best = {}  # 이름 기준 중복 제거 (같은 변이가 난이도 티어별로 중복 — 사용자 요청)
            for bid, bv in (r.get("charBuffData") or {}).items():
                if bv.get("buffType") not in mfilter:
                    continue
                nm = bv.get("outerName") or bv.get("innerName")
                usage = (bv.get("functionDesc") or "").strip()
                desc = (bv.get("desc") or "").strip()
                if not nm or not (usage or desc):
                    continue
                if nm not in best or len(usage) + len(desc) > best[nm]["_len"]:
                    ic = bv.get("iconId") or bid
                    mech_jobs.add((f"{ASSETS}/ui/rogueliketopic/topics/{tid}/bufficon/{ic}.png", ic))
                    best[nm] = {"id": bid, "name": nm, "usage": usage or None, "desc": desc or None,
                                "_cands": [ic], "_len": len(usage) + len(desc)}
            entries = [{k: v for k, v in e.items() if k != "_len"} for e in best.values()]
        elif source == "squadbuff":
            # 계시(啓示) — squadBuffData. 7종 × (기본/강화). 강화판은 기본과 iconId를
            # 공유하므로(virtue_8 아이콘=virtue_1) iconId로 묶고, 낮은 id를 대표(기본)로,
            # 나머지를 '강화' usage 줄로 병합한다 (로케일 무관 — 붕괴/시대/분노와 같은 꼴).
            sb = r.get("squadBuffData") or {}
            groups = {}
            for bv in sb.values():
                groups.setdefault(bv.get("iconId") or bv["id"], []).append(bv)
            def vnum(v):
                try:
                    return int(v["id"].rsplit("_", 1)[1])
                except (ValueError, KeyError):
                    return 999
            enh = {"en": "Enhanced", "ja": "強化"}.get(loc, "강화")
            for ic in sorted(groups, key=lambda k: min(vnum(v) for v in groups[k])):
                lv = sorted(groups[ic], key=vnum)
                base = lv[0]
                lines = []
                bfd = (base.get("functionDesc") or "").strip()
                if bfd:
                    lines.append(bfd)
                for extra in lv[1:]:
                    efd = (extra.get("functionDesc") or "").strip()
                    if efd:
                        lines.append(f"〔{enh}〕 {efd}")
                mech_jobs.add((f"{ASSETS}/ui/rogueliketopic/topics/{tid}/bufficon/{ic}.png", ic))
                entries.append({"id": base["id"],
                                "name": base.get("outerName") or base.get("innerName"),
                                "usage": "\n".join(lines) or None,
                                "desc": (base.get("desc") or "").strip() or None,
                                "_cands": [ic]})
        elif source == "module_chaos":
            # 붕괴 패러다임 — modules.chaos.chaosDatas (실명: '수적 붕괴' 등). 모든 패러다임은
            # 붕괴가 깊어지면 2단계로 심화되며 이름도 바뀐다(nextChaosId 체인, 예: 이미지 에러
            # →블랙아웃). 패러다임당 카드 1장에 두 단계를 함께 표시한다 (단계별 분리 카드는
            # 사용자 반려 2026-07-24 — "카드 하나에 같이"). 아이콘은 게임 데이터·CDN 번들
            # 모두 단계 공용 1장뿐(pic_rogue_3_chaos_N, 실사 확인)이라 손실 없음.
            datas = (mods.get("chaos") or {}).get("chaosDatas") or {}
            base = sorted([v for v in datas.values() if not v.get("prevChaosId")],
                          key=lambda v: v.get("sortId", 0))
            def stage_label(n):
                return {"en": f"Stage {n}", "ja": f"第{n}段階"}.get(loc, f"{n}단계")
            for v in base:
                chain = [v]
                nxt = v.get("nextChaosId")
                while nxt and nxt in datas:
                    chain.append(datas[nxt])
                    nxt = datas[nxt].get("nextChaosId")
                if len(chain) > 1:
                    lines, descs = [], []
                    for i, cv in enumerate(chain):
                        head = stage_label(i + 1) if i == 0 else f"{stage_label(i + 1)} · {cv.get('name')}"
                        lines.append(f"〔{head}〕 {cv.get('functionDesc') or ''}")
                        dsc = (cv.get("desc") or "").strip()
                        if dsc:
                            descs.append(dsc if i == 0 else f"〔{cv.get('name')}〕 {dsc}")
                    usage = "\n".join(x for x in lines if x.strip()) or None
                    desc = "\n".join(descs) or None
                else:
                    usage = (v.get("functionDesc") or "").strip() or None
                    desc = (v.get("desc") or "").strip() or None
                ic = v.get("iconId") or v["chaosId"]
                mech_jobs.add((f"{ASSETS}/ui/rogueliketopic/topics/{tid}/misc/{ic}.png", ic))
                entries.append({"id": v["chaosId"], "name": v.get("name"),
                                "usage": usage, "desc": desc, "_cands": [ic]})
        elif source == "module_disaster":
            # 시대 — modules.disaster.disasterData (유형 9종 × 형성기/확장기/… 단계).
            # 유형별 한 카드, 단계 효과를 usage 줄로 병합.
            datas = (mods.get("disaster") or {}).get("disasterData") or {}
            groups = {}
            for v in datas.values():
                groups.setdefault(v.get("type") or v.get("id"), []).append(v)
            for gtype in sorted(groups):
                lv = sorted(groups[gtype], key=lambda v: v.get("level", 0))
                first = lv[0]
                lines = [f"〔{v.get('levelName') or v.get('level')}〕 {v.get('functionDesc') or ''}" for v in lv]
                ic = first.get("iconId") or gtype
                mech_jobs.add((f"{ASSETS}/ui/rogueliketopic/topics/{tid}/misc/{ic}.png", ic))
                entries.append({"id": gtype, "name": first.get("name"),
                                "usage": "\n".join(x for x in lines if x.strip()) or None,
                                "desc": (first.get("desc") or "").strip() or None,
                                "_cands": [ic]})
        elif source == "module_wrath":
            # IS5 분노(쉐이시 시진) — modules.wrath.wrathData. items의 usage는 '기믹 아이템'
            # 뿐이라 쓸모없고, 실효과는 여기의 단계별 functionDesc다 (사용자 리포트 2026-07-19).
            # 그룹(시진)당 한 카드: 몽롱(L1)→명확(L2)→심각(L3) 디버프 + 각성·진정(L0) 버프.
            # 같은 그룹·단계의 직군별 변형(랜덤/가드/…)은 대표(가장 짧은 id=랜덤형)만 쓴다.
            datas = (mods.get("wrath") or {}).get("wrathData") or {}
            groups = {}
            for v in datas.values():
                groups.setdefault(v.get("group"), {}).setdefault(v.get("level"), []).append(v)
            def wrath_no(g):  # rogue_5_wrath_10 → 10 (숫자 정렬)
                try:
                    return int(g.rsplit("_", 1)[1])
                except ValueError:
                    return 999
            for g in sorted(groups, key=wrath_no):
                lv = groups[g]
                reps = {level: min(vs, key=lambda v: (len(v["id"]), v["id"])) for level, vs in lv.items()}
                first = reps.get(1) or next(iter(reps.values()))
                lines = []
                for level in (1, 2, 3):
                    v = reps.get(level)
                    if v and (v.get("functionDesc") or "").strip():
                        lines.append(f"〔{v.get('levelName') or level}〕 {v['functionDesc'].strip()}")
                v0 = reps.get(0)
                if v0 and (v0.get("functionDesc") or "").strip():
                    calm = {"en": "·Pacified", "ja": "・鎮静"}.get(loc, "·진정")
                    lines.append(f"〔{v0.get('levelName') or '각성'}{calm}〕 {v0['functionDesc'].strip()}")
                mech_jobs.add((f"{ASSETS}/ui/rogueliketopic/topics/{tid}/misc/{g}.png", g))
                entries.append({"id": first["id"], "name": first.get("name"),
                                "usage": "\n".join(lines) or None,
                                "desc": (first.get("desc") or "").strip() or None,
                                "_cands": [g]})
        if entries:
            mechanics.append({"label": label, "items": entries})
    # 아이콘 확보 후 폴백 해소 — 첫 존재 후보를 채택하고, 항목 id와 다르면 iconId로 전달
    # (프론트는 /rogue/relic/<iconId ?? id>.webp). 소스가 없으면 img=False로 남는다.
    download_webp([(u, os.path.join(relic_icon_dir, f"{ic}.webp")) for u, ic in sorted(mech_jobs)],
                  max_px=180, photo=False)
    for m in mechanics:
        for e in m["items"]:
            cands = e.pop("_cands", None) or [e["id"]]
            ic = next((c for c in cands if has_icon(c)), None)
            e["img"] = ic is not None
            if ic and ic != e["id"]:
                e["iconId"] = ic

    # ── 환각/메아리(variation) + 융합(fusion) — 토픽별 존재 여부·정합성 확인 후 수록
    # (rogue_3의 variationData는 이름이 "1"~"8"인 플레이스홀더라 제외)
    variations = [{"id": k, "name": v.get("outerName") or v.get("innerName"),
                   "func": v.get("functionDesc"), "desc": v.get("desc"), "fusion": False}
                  for k, v in (r.get("variationData") or {}).items()
                  if (v.get("outerName") or v.get("innerName") or "").strip() and
                     not (v.get("outerName") or "").isdigit()]
    variations += [{"id": k, "name": v.get("name"), "func": v.get("functionDesc"),
                    "desc": v.get("desc"), "fusion": True}
                   for k, v in (r.get("fusionData") or {}).items()]

    # ── 난이도 (EASY + NORMAL 0~15; 월간/심층은 표기만) ──────────────────────
    difficulties = [{
        "mode": d["modeDifficulty"], "grade": d["grade"], "name": d["name"],
        "rule": d.get("ruleDesc"), "score": d.get("scoreFactor"),
    } for d in r["difficulties"]]

    # ── 엔딩 + 기록 텍스트 ────────────────────────────────────────────────────
    endings = [{
        "id": e["id"], "name": e["name"], "desc": e.get("desc"),
        "boss": e.get("bossIconId"), "priority": e.get("priority", 0),
        "change": e.get("changeEndingDesc"),
    } for e in r["endings"].values()]
    endings.sort(key=lambda x: x["priority"])

    # ── 조우 씬 (enter 씬을 뿌리로 한 계단식 선택지 트리) ──────────────────────
    # nextSceneId를 따라 후속 씬(부모와 제목 공유)을 next로 중첩한다. 예전 접두 매칭+제목
    # union은 부모/자식 선택지를 뭉쳐 중복이 났다 (사용자 리포트 2026-07-19).
    # encounterTree: 후속 이벤트(전투 돌입 등)의 부모 선택 소속은 게임 데이터에 없어
    # rogueN-curated.json에서 choice 끝번호로 수작업 지정 (로케일 무관).
    encounters = extract_encounters(r["choiceScenes"], r["choices"],
                                    load_encounter_tree(f"rogue{ronum}"), items)
    # 조우 배경 CG — avg/images/<bg>.png
    scene_dir = os.path.join(REPO, "public", "rogue", "scene")
    download_webp([(f"{ASSETS}/avg/images/{e['bg']}.png",
                    os.path.join(scene_dir, f"{e['bg']}.webp"))
                   for e in encounters if e.get("bg")], max_px=720)
    for e in encounters:
        if e.get("bg") and not os.path.exists(os.path.join(scene_dir, f"{e['bg']}.webp")):
            e["bg"] = None

    # ── 수작업 큐레이션 병합 (조우 층 규칙·엔딩 조건 — PRTS 기반) ─────────────
    # 로케일 빌드: 큐레이션 한국어 문장은 rogue-i18n.json 오버레이(tr)로 번역하고,
    # 문장 속 「이름」 인용은 KR→현지어 공식 명칭으로 치환한다 (renderCond 자동 링크가
    # 현지어 데이터의 이름과 글자 단위로 일치해야 하므로).
    loc_name = None
    if loc:
        kr_table = fetch_json("excel/roguelike_topic_table.json")
        kr_r = kr_table["details"][tid]
        kr_hb = fetch_json("excel/enemy_handbook_table.json")["enemyData"]
        loc_name = {}
        for kid, kv in kr_r["stages"].items():
            lv2 = r["stages"].get(kid)
            if kv.get("name") and lv2 and lv2.get("name"):
                loc_name[kv["name"].strip()] = lv2["name"].strip()
        for kid, kv in kr_r["choiceScenes"].items():
            lv2 = r["choiceScenes"].get(kid)
            if kv.get("title") and lv2 and lv2.get("title"):
                loc_name[kv["title"].strip()] = lv2["title"].strip()
        for kid, kv in kr_r["items"].items():
            lv2 = r["items"].get(kid)
            if kv.get("name") and lv2 and lv2.get("name"):
                loc_name[kv["name"].strip()] = lv2["name"].strip()
        for kid, kv in kr_r["endings"].items():
            lv2 = r["endings"].get(kid)
            if kv.get("name") and lv2 and lv2.get("name"):
                loc_name[kv["name"].strip()] = lv2["name"].strip()
        for kid, kv in kr_r["zones"].items():
            lv2 = r["zones"].get(kid)
            if kv.get("name") and lv2 and lv2.get("name"):
                loc_name[kv["name"].strip()] = lv2["name"].strip()
        for kid, kv in kr_hb.items():
            lv2 = handbook.get(kid)
            if kv.get("name") and lv2 and lv2.get("name"):
                loc_name[kv["name"].strip()] = lv2["name"].strip()
    def tr_quoted(s):
        if not loc or not s:
            return s
        return re.sub(r"「([^」]+)」", lambda m: f"「{loc_name.get(m.group(1), m.group(1))}」", s)
    curated_path = os.path.join(REPO, "scripts", f"rogue{ronum}-curated.json")
    if os.path.exists(curated_path):
        curated = json.load(open(curated_path, encoding="utf-8"))
        floors = curated.get("encounterFloors", {})
        notes = curated.get("encounterNotes", {})
        for enc in encounters:
            if enc["scene"] in floors:
                enc["floors"] = floors[enc["scene"]]
            if enc["scene"] in notes:
                enc["note"] = tr_quoted(tr(notes[enc["scene"]]))
        conds = curated.get("endingConds", {})
        for e in endings:
            if e["id"] in conds:
                e["cond"] = [tr_quoted(tr(x)) for x in conds[e["id"]]]
        # 보스(험난한 길) 출현 층 — 사용자 확인: b_1~5=3층, b_6~7=5층, b_8~9=히든 6층
        boss_floors = curated.get("bossFloors", {})
        for s in stages:
            if s["id"] in boss_floors:
                s["zone"] = boss_floors[s["id"]]

    out = {
        "id": tid,
        "name": topic["name"],
        "line": topic.get("lineText"),
        "zones": zones,
        "nodeTypes": [{"id": k, "name": v["name"], "desc": v.get("description"),
                       "func": tr(node_func(tid, k))}
                      for k, v in r["nodeTypeData"].items()],
        "difficulties": difficulties,
        "stages": stages,
        "enemies": enemies,
        "relics": relics,
        "capsules": capsules,
        "tools": tools,
        "bands": bands,
        "variations": variations,
        "endings": endings,
        "encounters": encounters,
    }
    if explore_tools:
        out["exploreTools"] = explore_tools
    if mechanics:
        out["mechanics"] = mechanics
    # 게임 마크업 태그(<@ro.lose>1</>, <color=#...> 등)를 모든 문자열에서 일괄 제거
    def sanitize(v):
        if isinstance(v, str):
            return re.sub(r"</?[@$a-zA-Z][^>]*>|</>", "", v.replace("\r\n", "\n").replace("\\n", "\n"))
        if isinstance(v, list):
            return [sanitize(x) for x in v]
        if isinstance(v, dict):
            return {k: sanitize(x) for k, x in v.items()}
        return v
    out = sanitize(out)

    fname = f"rogue{ronum}.{loc}.json" if loc else f"rogue{ronum}.json"
    dest = os.path.join(REPO, "app", "data", fname)
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(dest) // 1024
    print(f"{fname}: zones={len(zones)} stages={len(stages)} enemies={len(enemies)} "
          f"relics={len(relics)} capsules={len(capsules)} variations={len(variations)} "
          f"encounters={len(encounters)} → {kb}KB")
    if loc and tr_missing:
        rep = os.path.join(REPO, "scripts", "rogue-i18n-missing.json")
        old = json.load(open(rep, encoding="utf-8")) if os.path.exists(rep) else {}
        old.setdefault(loc, [])
        old[loc] = sorted(set(old[loc]) | tr_missing)
        json.dump(old, open(rep, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(f"  ⚠ {loc} 미번역 큐레이션 문장 {len(tr_missing)}건 → rogue-i18n-missing.json")


# ── rogue_6 (침몰자의 흑류수해) — CN 선행 데이터 빌드 ─────────────────────────
# KR 미출시(2026-07)라 cn 브랜치에서 빌드하고, 문자열은 3단 번역으로 한국어화한다:
#   ① 같은 id가 KR 데이터에 있는 것(기존 적, 이전 테마 유물 등)은 KR 공식 번역 자동 매핑
#   ② 나머지는 scripts/rogue6-ko.json (CN 원문 → 한국어, AI 집필) 오버레이
#   ③ 미번역 잔여분은 scripts/rogue6-untranslated.json 으로 리포트 (재실행 시 갱신)
# KR 정식 출시 후에는 branch="kr"로 바꾸고 오버레이를 제거하면 된다.

def load_auto_tr():
    """KR/CN 테이블 교차로 CN→KR 공식 번역 사전 자동 생성 (이전 테마 rogue_1~5 공통 항목)."""
    kr = fetch_json("excel/roguelike_topic_table.json")
    cn = fetch_json("excel/roguelike_topic_table.json", "cn")
    tr = {}
    def put(c, k):
        if isinstance(c, str) and isinstance(k, str) and c.strip() and k.strip() and c != k:
            tr.setdefault(c.strip(), k.strip())
    for rid in ["rogue_1", "rogue_2", "rogue_3", "rogue_4", "rogue_5"]:
        dk, dc = kr["details"].get(rid), cn["details"].get(rid)
        if not dk or not dc:
            continue
        for iid, it in dc.get("items", {}).items():
            ik = dk.get("items", {}).get(iid)
            if ik:
                put(it.get("name"), ik.get("name"))
                put(it.get("usage"), ik.get("usage"))
                put(it.get("description"), ik.get("description"))
                put(it.get("obtainApproach"), ik.get("obtainApproach"))
        for nid, nt in dc.get("nodeTypeData", {}).items():
            nk = dk.get("nodeTypeData", {}).get(nid)
            if nk:
                put(nt.get("name"), nk.get("name"))
                put(nt.get("description"), nk.get("description"))
    # 적 핸드북 교차 (기존 적 이름·공격방식·급)
    hb_kr = fetch_json("excel/enemy_handbook_table.json")
    hb_cn = fetch_json("excel/enemy_handbook_table.json", "cn")
    for k, ec in hb_cn["enemyData"].items():
        ek = hb_kr["enemyData"].get(k)
        if ek:
            put(ec.get("name"), ek.get("name"))
            put(ec.get("attackType"), ek.get("attackType"))
    for rc, rk in zip(hb_cn.get("raceData", {}).values(), hb_kr.get("raceData", {}).values()):
        put(rc.get("raceName"), rk.get("raceName"))
    return tr


def build_rogue6():
    table = fetch_json("excel/roguelike_topic_table.json", "cn")
    topic = table["topics"]["rogue_6"]
    r = table["details"]["rogue_6"]
    mod = table["modules"]["rogue_6"]
    handbook_cn = fetch_json("excel/enemy_handbook_table.json", "cn")["enemyData"]
    handbook_kr = fetch_json("excel/enemy_handbook_table.json")["enemyData"]
    enemy_db = fetch_json("levels/enemydata/enemy_database.json", "cn")
    items = r["items"]

    # ── 존 (portal_*=미맹생의 요람 중복 제외, zone_4_1은 4존 변형) ────────────
    zones = []
    for zid, z in r["zones"].items():
        if zid.startswith("zone_portal"):
            continue
        parts = zid.split("_")
        desc = (z.get("description") or "").split("\n", 1)
        zones.append({
            "id": zid, "num": int(parts[1]), "name": z["name"],
            "variant": len(parts) > 2,
            "time": desc[0] if len(desc) > 1 else None,
            "desc": desc[1] if len(desc) > 1 else desc[0],
            "buff": z.get("buffDescription"), "hidden": bool(z.get("isHiddenZone")),
        })
    zones.sort(key=lambda z: (z["num"], z["variant"]))
    # 내용이 본 존과 완전히 같은 변형 존(zone_4_1 등)은 중복이므로 제외
    base_sig = {(z["num"]): (z["name"], z["desc"], z.get("buff")) for z in zones if not z["variant"]}
    zones = [z for z in zones if not (z["variant"] and base_sig.get(z["num"]) == (z["name"], z["desc"], z.get("buff")))]
    zone_dir = os.path.join(REPO, "public", "rogue", "zone")
    download_webp([(f"{ASSETS}/ui/rogueliketopic/topics/rogue_6_update/levelbgpic/rogue_6_map_{z['num']}.png",
                    os.path.join(zone_dir, f"rogue_6_map_{z['num']}.webp")) for z in zones], max_px=900)
    for z in zones:
        z["img"] = os.path.exists(os.path.join(zone_dir, f"rogue_6_map_{z['num']}.webp"))

    # ── 스테이지 + 레벨 (rogue_1과 동일 룬 해석 — n/e가 levelId 공유) ─────────
    map_dir = os.path.join(REPO, "public", "rogue", "map")
    level_cache = {}
    def load_level(level_id):
        if level_id in level_cache:
            return level_cache[level_id]
        lv = fetch_json(f"levels/{level_id.lower()}.json", "cn")
        refs = [{"key": e["id"], "level": e.get("level", 0),
                 "over": e.get("overwrittenData")} for e in lv.get("enemyDbRefs", [])]
        counts = {}
        def count_actions(actions):
            for a in actions or []:
                if a.get("actionType") in (0, "SPAWN") and a.get("key"):
                    counts[a["key"]] = counts.get(a["key"], 0) + a.get("count", 1)
        for w in lv.get("waves", []):
            for f in w.get("fragments", []):
                count_actions(f.get("actions"))
        for b in (lv.get("branches") or {}).values():
            for ph in b.get("phases", []):
                count_actions(ph.get("actions"))
        emg = {}
        for rune in lv.get("runes") or []:
            if rune.get("difficultyMask") not in ("FOUR_STAR", 8):
                continue
            key = rune.get("key")
            bbs = rune.get("blackboard", [])
            bb_map = {bb["key"]: (bb["valueStr"] if bb.get("valueStr") is not None else bb.get("value")) for bb in bbs}
            if key in ("enemy_attribute_mul", "enemy_attribute_add"):
                for bb in bbs:
                    if bb.get("value") is not None:
                        emg.setdefault(key.rsplit("_", 1)[1], {})[bb["key"]] = num(bb["value"])
            elif key == "ebuff_attribute":
                stats = {k: num(v) for k, v in bb_map.items() if k != "enemy" and isinstance(v, (int, float))}
                sel = bb_map.get("enemy")
                if sel:
                    keys = [re.sub(r"#\d+$", "", e) for e in str(sel).split("|")]
                    emg.setdefault("per", []).append({"keys": keys, "mul": stats})
                else:
                    emg.setdefault("mul", {}).update(stats)
            elif key == "level_enemy_replace":
                frm = re.sub(r"#\d+$", "", str(bb_map.get("key") or ""))
                to = re.sub(r"#\d+$", "", str(bb_map.get("value") or ""))
                if frm and to:
                    emg.setdefault("replace", {})[frm] = to
        level_cache[level_id] = {"refs": refs, "counts": counts, "emg": emg, "raw": lv}
        return level_cache[level_id]

    kind_map = {"n": "normal", "e": "emergency", "b": "boss",
                "t": "incident", "duel": "duel", "c": "chase"}
    # 거점전(BATTLE_SAVAGE “居民”据点) 정본 id — PRTS는 t_13~15만 문서화하며,
    # c_5~7은 같은 levelId를 공유하는 미사용 중복 등록이라 제외한다 (피드백 2026-07-18).
    SAVAGE_IDS = {"ro6_t_13", "ro6_t_14", "ro6_t_15"}
    DUP_SKIP = {"ro6_c_5", "ro6_c_6", "ro6_c_7"}
    used_enemies = {}
    stages = []
    for st in r["stages"].values():
        sid = st["id"]
        if sid in DUP_SKIP:
            continue
        parts = sid.split("_")  # ro6_n_1_1 / ro6_e_1_1 / ro6_b_1 / ro6_t_1 / ro6_duel_1 / ro6_c_1
        kind = "savage" if sid in SAVAGE_IDS else kind_map.get(parts[1], parts[1])
        zone = int(parts[2]) if parts[1] in ("n", "e") and parts[2].isdigit() else None
        lv = load_level(st["levelId"])
        enemies = []
        for ref in lv["refs"]:
            cnt = lv["counts"].get(ref["key"], 0)
            enemies.append({"key": ref["key"], "cnt": cnt})
            cur = used_enemies.get(ref["key"])
            if cur is None or ref["level"] > cur["level"]:
                used_enemies[ref["key"]] = ref
        for to in (lv["emg"].get("replace") or {}).values():
            if to not in used_enemies:
                used_enemies[to] = {"key": to, "level": 0, "over": None}
        stages.append({
            "id": sid, "kind": kind, "zone": zone, "code": st.get("code"),
            "name": (st["name"] or "").strip() or "???", "desc": (st.get("description") or "").strip() or None,
            "eliteDesc": st.get("eliteDesc") or None,
            "emg": lv["emg"] if kind == "emergency" else None,
            "level": st["levelId"],
            "enemies": enemies,
        })
    order = {"normal": 0, "emergency": 1, "boss": 2, "chase": 3, "savage": 4, "duel": 5, "incident": 6}
    stages.sort(key=lambda s: (order.get(s["kind"], 9), s["zone"] or 0, s["id"]))

    download_webp([(f"{ASSETS}/arts/ui/stage/mappreviews/{s['id']}.png",
                    os.path.join(map_dir, f"{s['id']}.webp")) for s in stages], max_px=640)
    for s in stages:
        dest = os.path.join(map_dir, f"{s['id']}.webp")
        if not os.path.exists(dest):
            render_minimap(level_cache[s["level"]]["raw"], dest)
        s["map"] = s["id"] if os.path.exists(dest) else None
        del s["level"]

    # ── 적 도감 — CN db + 핸드북 (KR에 있는 적은 KR 공식 텍스트 우선) ─────────
    enemies = {}
    for key, ref in used_enemies.items():
        db = enemy_db.get(key)
        if not db:
            continue
        by_level = {e["level"]: e["enemyData"] for e in db}
        base = by_level.get(0, db[0]["enemyData"])
        pick = by_level.get(ref["level"], base)
        def attr(name, default=None):
            v = mv((pick.get("attributes") or {}).get(name))
            if v is None:
                v = mv((base.get("attributes") or {}).get(name), default)
            ow = ((ref.get("over") or {}).get("attributes") or {}).get(name)
            ov = mv(ow) if ow else None
            return ov if ov is not None else v
        hb_key = key if key in handbook_cn else key.rsplit("_", 1)[0]
        hb = handbook_cn.get(hb_key) or {}
        hbk = handbook_kr.get(hb_key) or {}  # KR 공식 번역이 있으면 우선
        name = hbk.get("name") or mv(pick.get("name")) or mv(base.get("name")) or hb.get("name") or key
        # 중국어 원명은 KR 번역 유무와 무관하게 항상 병기 (사용자 확정 2026-07)
        cn_name = hb.get("name") or mv(pick.get("name")) or mv(base.get("name")) or key
        enemies[key] = {
            "name": name,
            "cn": cn_name,
            "rank": hb.get("enemyLevel") or hbk.get("enemyLevel"),
            "index": hb.get("enemyIndex") or hbk.get("enemyIndex"),
            "attack": attack_of(hbk) or attack_of(hb),
            "desc": hbk.get("description") or hb.get("description"),
            "ability": ability_of(hbk) or ability_of(hb),
            "hp": num(attr("maxHp", 0)), "atk": num(attr("atk", 0)),
            "def": num(attr("def", 0)), "res": num(attr("magicResistance", 0)),
            "aspd": num(attr("attackSpeed", 100)), "ms": num(attr("moveSpeed", 1)),
            "weight": num(attr("massLevel", 1)),
            "lifePoint": mv(pick.get("lifePointReduce"), mv(base.get("lifePointReduce"), 1)),
            "immune": [ko for k, ko in IMMUNE_KO if attr(k, False)],
        }

    enemy_dir = os.path.join(REPO, "public", "rogue", "enemy")
    jobs, img_of = [], {}
    for key in enemies:
        cands = [key]
        b = re.sub(r"_\d+$", "", key)
        if b != key:
            cands.append(b)
        for cand in cands:
            dest = os.path.join(enemy_dir, f"{cand}.webp")
            if os.path.exists(dest):
                img_of[key] = cand
                break
            jobs.append((f"{ASSETS}/arts/enemies/{cand}.png", dest))
    fails = {u.rsplit("/", 1)[-1][:-4] for u, _ in download_webp(jobs, max_px=256)}
    for key in enemies:
        if key in img_of:
            continue
        for cand in [key, re.sub(r"_\d+$", "", key)]:
            if cand not in fails and os.path.exists(os.path.join(enemy_dir, f"{cand}.webp")):
                img_of[key] = cand
                break
    for key, e in enemies.items():
        e["img"] = img_of.get(key)
    merged_n = merge_dup_enemies(stages, enemies)
    if merged_n:
        print(f"  동일 적 병합: {merged_n}건")

    # ── 전시관: 유물 / 스크랩(零件) / 도구 / 분대 / 유산(襁褓) / 부표 ─────────
    relic_icon_dir = os.path.join(REPO, "public", "rogue", "relic")
    relic_order = (r["archiveComp"]["relic"] or {}).get("relic", {})
    relics = []
    for iid, it in items.items():
        if it.get("type") != "RELIC":
            continue
        arc = relic_order.get(iid, {})
        relics.append({
            "id": iid, "name": it["name"], "desc": it.get("description"),
            "usage": it.get("usage"), "obtain": it.get("obtainApproach"),
            "order": arc.get("orderId"), "group": arc.get("relicGroupId"),
            "sort": arc.get("relicSortId", 9999), "sp": bool(arc.get("isSpRelic")),
        })
    # 유물번호(orderId) 정렬 — 숫자 번호 오름차순, 특수 번호(PCS01 등)는 뒤에, 번호 없으면 맨 뒤
    def relic_order_key(x):
        o = x.get("order") or ""
        if o.isdigit():
            return (0, int(o), "")
        return (1, 0, o) if o else (2, 0, x["id"])
    relics.sort(key=relic_order_key)
    # 아이콘 판정 — 정확 일치 우선, 없으면 변형 접미(_a/_b/_c 등)를 뗀 베이스 아이콘으로 폴백.
    # (특선 통조림 α/β/γ처럼 강도 변형이 하나의 아이콘을 공유하는 유물 39종 대응)
    def relic_icon_id(iid):
        if os.path.exists(os.path.join(relic_icon_dir, f"{iid}.webp")):
            return iid
        base = re.sub(r"_[a-z]$", "", iid)
        if base != iid and os.path.exists(os.path.join(relic_icon_dir, f"{base}.webp")):
            return base
        return None
    for x in relics:
        ic = relic_icon_id(x["id"])
        x["img"] = ic is not None
        if ic and ic != x["id"]:
            x["iconId"] = ic

    # 스크랩(零件) — 자연물(GOODS)·가공품(MOVE)·개념체(PASSIVE) 3분류
    scrap_mod = mod["scrap"]
    scrap_type = scrap_mod["scrapItemToType"]
    type_names = {k: v["typeName"] for k, v in scrap_mod["scrapTypeData"].items()}
    move_desc = {k: v.get("scrapDesc") for k, v in scrap_mod.get("moveScrapData", {}).items()}
    scrap_sort = {sid: v.get("sortId", 999) for sid, v in
                  ((r["archiveComp"].get("scrap") or {}).get("scraps") or {}).items()}
    scraps = []
    for iid, it in items.items():
        if it.get("type") != "SCRAP":
            continue
        st = scrap_type.get(iid)
        scraps.append({
            "id": iid, "name": it["name"], "type": st,
            "typeName": type_names.get(st),
            "usage": move_desc.get(iid) or it.get("usage"),
            "desc": it.get("description"),
            "sort": scrap_sort.get(iid, 999),
            "img": os.path.exists(os.path.join(relic_icon_dir, f"{iid}.webp")),
        })
    scraps.sort(key=lambda x: ({"GOODS": 0, "MOVE": 1, "PASSIVE": 2}.get(x["type"], 9), x["sort"], x["id"]))

    # 같은 이름은 업그레이드 티어 중복 — usage가 가장 긴(최종 티어) 항목만 대표로 (사용자 요청)
    def item_group6(itype):
        best = {}
        for iid, it in items.items():
            if it.get("type") != itype:
                continue
            nm = it["name"]
            score = len(it.get("usage") or "") + len(it.get("description") or "")
            if nm not in best or score > best[nm][0]:
                best[nm] = (score, {"id": iid, "name": nm, "desc": it.get("description"), "usage": it.get("usage"),
                                    "img": os.path.exists(os.path.join(relic_icon_dir, f"{iid}.webp"))})
        return [e for _, e in best.values()]
    tools = item_group6("ACTIVE_TOOL")
    # 악단(BAND) 아이콘 — init/initreliciconpic/<id>.png (id 일치). relic 폴더에 받아 img 판정 자동화.
    band_ids = [iid for iid, it in items.items() if it.get("type") == "BAND"]
    download_webp([(f"{ASSETS}/ui/rogueliketopic/topics/rogue_6/init/initreliciconpic/{bid}.png",
                    os.path.join(relic_icon_dir, f"{bid}.webp")) for bid in band_ids], max_px=180, photo=False)
    bands = item_group6("BAND")

    # 유산(襁褓 — 다음 탐색에 물려주는 아이템). 동명 중복(획득 횟수 슬롯)은 대표 1개만
    seen_legacy = set()
    legacies = []
    for iid, it in sorted(items.items()):
        if it.get("type") != "LEGACY" or it["name"] in seen_legacy:
            continue
        seen_legacy.add(it["name"])
        legacies.append({"id": iid, "name": it["name"], "usage": it.get("usage"),
                         "desc": it.get("description"),
                         "img": os.path.exists(os.path.join(relic_icon_dir, f"{iid}.webp"))})

    # 부표(NODE_BUOY — 격자 지도 위 이벤트 마커)
    buoys = [{"id": iid, "name": it["name"], "usage": it.get("usage"),
              "img": os.path.exists(os.path.join(REPO, "public", "rogue", "misc", f"{iid}.webp"))}
             for iid, it in sorted(items.items())
             if it.get("type") == "NODE_BUOY" and "tmp" not in iid]

    # ── 날씨 (주 날씨 10종 × 강도 a/b/c + 보조 날씨 4종) ─────────────────────
    misc_dir = os.path.join(REPO, "public", "rogue", "misc")
    weather_groups = {}
    for wid, w in mod["weather"]["mainWeatherData"].items():
        base = re.sub(r"_[a-z]$", "", wid)  # rogue_6_weather_1
        g = weather_groups.setdefault(base, {"id": base, "name": w.get("name"), "levels": []})
        g["levels"].append({"lv": wid.rsplit("_", 1)[1], "desc": w.get("functionDesc") or w.get("description")})
    weathers = sorted(weather_groups.values(), key=lambda g: int(g["id"].rsplit("_", 1)[1]))
    for g in weathers:
        g["levels"].sort(key=lambda x: x["lv"])
    subweathers = [{"id": wid, "name": w.get("name"),
                    "desc": w.get("functionDesc") or w.get("description")}
                   for wid, w in sorted(mod["weather"]["subWeatherData"].items())]
    icon_jobs = [(f"{ASSETS}/ui/rogueliketopic/topics/rogue_6/misc/{g['id']}.png",
                  os.path.join(misc_dir, f"{g['id']}.webp")) for g in weathers]
    icon_jobs += [(f"{ASSETS}/ui/rogueliketopic/topics/rogue_6/misc/{w['id']}.png",
                   os.path.join(misc_dir, f"{w['id']}.webp")) for w in subweathers]
    icon_jobs += [(f"{ASSETS}/ui/rogueliketopic/topics/rogue_6/misc/{k}.png",
                   os.path.join(misc_dir, f"rogue_6_{k}.webp")) for k in r["variationData"]]
    icon_jobs += [(f"{ASSETS}/ui/rogueliketopic/topics/rogue_6/misc/{b['id']}.png",
                   os.path.join(misc_dir, f"{b['id']}.webp")) for b in buoys]
    download_webp(icon_jobs, max_px=200, photo=False)
    for g in weathers:
        g["img"] = os.path.exists(os.path.join(misc_dir, f"{g['id']}.webp"))
    for w in subweathers:
        w["img"] = os.path.exists(os.path.join(misc_dir, f"{w['id']}.webp"))
    for b in buoys:
        b["img"] = os.path.exists(os.path.join(misc_dir, f"{b['id']}.webp"))

    # ── 이변(variation — 심층 탐색 조건부 규칙) ───────────────────────────────
    variations = [{"id": k, "name": v.get("outerName") or v.get("innerName"),
                   "func": v.get("functionDesc"), "desc": v.get("desc"), "fusion": False,
                   "img": os.path.exists(os.path.join(misc_dir, f"rogue_6_{k}.webp"))}
                  for k, v in r["variationData"].items()]

    difficulties = [{
        "mode": d["modeDifficulty"], "grade": d["grade"], "name": d["name"],
        "rule": d.get("ruleDesc"), "score": d.get("scoreFactor"),
    } for d in r["difficulties"]]

    endings = [{
        "id": e["id"], "name": e["name"], "desc": e.get("desc"),
        "boss": e.get("bossIconId"), "priority": e.get("priority", 0),
        "change": e.get("changeEndingDesc"),
    } for e in r["endings"].values()]
    endings.sort(key=lambda x: x["priority"])

    # 계단식 선택지 트리 (溯源 19변형 등 동명 enter는 대표 1개로 — extract_encounters 참조)
    encounters = extract_encounters(r["choiceScenes"], r["choices"],
                                    load_encounter_tree("rogue6"), items)
    scene_dir = os.path.join(REPO, "public", "rogue", "scene")
    download_webp([(f"{ASSETS}/avg/images/{e['bg']}.png",
                    os.path.join(scene_dir, f"{e['bg']}.webp"))
                   for e in encounters if e.get("bg")], max_px=720)
    for e in encounters:
        if e.get("bg") and not os.path.exists(os.path.join(scene_dir, f"{e['bg']}.webp")):
            e["bg"] = None

    # ── 수작업 큐레이션 병합 ──────────────────────────────────────────────────
    curated_path = os.path.join(REPO, "scripts", "rogue6-curated.json")
    if os.path.exists(curated_path):
        curated = json.load(open(curated_path, encoding="utf-8"))
        floors = curated.get("encounterFloors", {})
        notes = curated.get("encounterNotes", {})
        for enc in encounters:
            if enc["scene"] in floors:
                enc["floors"] = floors[enc["scene"]]
            if enc["scene"] in notes:
                enc["note"] = notes[enc["scene"]]
        conds = curated.get("endingConds", {})
        for e in endings:
            if e["id"] in conds:
                e["cond"] = conds[e["id"]]
        boss_floors = curated.get("bossFloors", {})
        for s in stages:
            if s["id"] in boss_floors:
                s["zone"] = boss_floors[s["id"]]

    out = {
        "id": "rogue_6",
        "name": "침몰자의 흑류수해",  # 비공식 번역명 (KR 미출시)
        "cnName": topic["name"],
        "future": True,
        "line": topic.get("lineText"),
        "zones": zones,
        "nodeTypes": [{"id": k, "name": v["name"], "desc": v.get("description"),
                       "func": node_func("rogue_6", k)}
                      for k, v in r["nodeTypeData"].items()],
        "difficulties": difficulties,
        "stages": stages,
        "enemies": enemies,
        "relics": relics,
        "scraps": scraps,
        "tools": tools,
        "bands": bands,
        "legacies": legacies,
        "buoys": buoys,
        "weathers": weathers,
        "subweathers": subweathers,
        "variations": variations,
        "endings": endings,
        "encounters": encounters,
    }
    def sanitize(v):
        if isinstance(v, str):
            return re.sub(r"</?[@$a-zA-Z][^>]*>|</>", "", v.replace("\r\n", "\n").replace("\\n", "\n"))
        if isinstance(v, list):
            return [sanitize(x) for x in v]
        if isinstance(v, dict):
            return {k: sanitize(x) for k, x in v.items()}
        return v
    out = sanitize(out)

    # 이름류 필드는 중국어 원문을 cn 필드로 병기 (CN 선행 데이터 — 사용자 요청 2026-07)
    def keep_cn(ent, field="name"):
        if ent.get("cn"):  # 이미 원문이 채워져 있으면(적 도감) 유지
            return
        if isinstance(ent.get(field), str) and ent[field].strip():
            ent["cn"] = ent[field]
    for z in out["zones"]:
        keep_cn(z)
    for s in out["stages"]:
        keep_cn(s)
    for e in out["enemies"].values():
        keep_cn(e)
    for coll in ("relics", "scraps", "tools", "bands", "legacies", "buoys",
                 "weathers", "subweathers", "variations", "endings", "nodeTypes"):
        for x in out[coll]:
            keep_cn(x)
    # 선택지 트리를 재귀로 훑어 각 선택지 제목에 원문 병기 (CN 클라 버튼과 대조용,
    # 사용자 요청 2026-07-19). next.desc(후속 씬 지문)는 이름류가 아니라 병기 안 함.
    def keep_cn_tree(chs):
        for ch in chs:
            keep_cn(ch, "title")
            if ch.get("next"):
                keep_cn_tree(ch["next"]["choices"])
    for enc in out["encounters"]:
        keep_cn(enc, "title")
        keep_cn_tree(enc["choices"])

    # ── 번역 오버레이: ① KR 교차 자동 사전 → ② rogue6-ko.json 수동 사전 ──────
    tr = load_auto_tr()
    ko_path = os.path.join(REPO, "scripts", "rogue6-ko.json")
    if os.path.exists(ko_path):
        tr.update(json.load(open(ko_path, encoding="utf-8")))
    untranslated = {}
    def has_cjk(s):
        return any("一" <= ch <= "鿿" for ch in s)
    def translate(v, path=""):
        if isinstance(v, str):
            s = v.strip()
            if s in tr:
                return v.replace(s, tr[s])
            if has_cjk(v):
                untranslated.setdefault(s, path)
            return v
        if isinstance(v, list):
            return [translate(x, path) for x in v]
        if isinstance(v, dict):
            return {k: (x if k == "cn" else translate(x, f"{path}.{k}" if path else k))
                    for k, x in v.items()}
        return v
    out = translate(out)

    # 번역 후에도 이름이 원문과 같으면(=한국어 안 됨/원래 비CJK) cn 병기 제거
    def drop_same_cn(ent, field="name"):
        if ent.get("cn") is not None and ent["cn"] == ent.get(field):
            del ent["cn"]
    for z in out["zones"]:
        drop_same_cn(z)
    for s in out["stages"]:
        drop_same_cn(s)
    for e in out["enemies"].values():
        drop_same_cn(e)
    for coll in ("relics", "scraps", "tools", "bands", "legacies", "buoys",
                 "weathers", "subweathers", "variations", "endings", "nodeTypes"):
        for x in out[coll]:
            drop_same_cn(x)
    def drop_same_cn_tree(chs):
        for ch in chs:
            drop_same_cn(ch, "title")
            if ch.get("next"):
                drop_same_cn_tree(ch["next"]["choices"])
    for enc in out["encounters"]:
        drop_same_cn(enc, "title")
        drop_same_cn_tree(enc["choices"])

    report = os.path.join(REPO, "scripts", "rogue6-untranslated.json")
    json.dump(untranslated, open(report, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    dest = os.path.join(REPO, "app", "data", "rogue6.json")
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(dest) // 1024
    print(f"rogue6.json: zones={len(zones)} stages={len(stages)} enemies={len(enemies)} "
          f"relics={len(relics)} scraps={len(scraps)} weathers={len(weathers)} "
          f"encounters={len(encounters)} → {kb}KB / 미번역 {len(untranslated)}건 → rogue6-untranslated.json")


def unpack_icons(topic="rogue_1"):
    """CDN 스프라이트 아틀라스에서 유물·도구 아이콘 언팩 → public/rogue/relic/.
    KR 미출시 토픽(rogue_6)은 CN 공식 CDN에서 받는다."""
    import io, struct, zipfile
    try:
        import lz4inv, UnityPy
        from UnityPy.enums.BundleFile import CompressionFlags
        from UnityPy.helpers.CompressionHelper import DECOMPRESSION_MAP
        DECOMPRESSION_MAP[CompressionFlags.LZHAM] = lz4inv.decompress_buffer
    except ImportError:
        sys.exit("pip3 install --user UnityPy lz4inv 후 다시 실행")
    def fetch(url, binary=False):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        raw = urllib.request.urlopen(req, timeout=120).read()
        return raw if binary else json.loads(raw)
    conf_url = ("https://ak-conf.hypergryph.com/config/prod/official/network_config"
                if topic == "rogue_6" else
                "https://ak-conf.arknights.kr/config/prod/official/network_config")
    conf = fetch(conf_url)
    network = json.loads(conf["content"])
    urls = network["configs"][network["funcVer"]]["network"]
    ver = fetch(urls["hv"].replace("{0}", "Android"))
    assets_url = f"{urls['hu']}/Android/assets/{ver['resVersion']}"
    def fetch_dat(name):
        dat = name.replace("/", "_").replace("#", "__").split(".")[0] + ".dat"
        with zipfile.ZipFile(io.BytesIO(fetch(f"{assets_url}/{dat}", binary=True))) as z:
            return z.read(z.filelist[0])
    env = UnityPy.load(io.BytesIO(fetch_dat(f"spritepack/ui_roguelike_topic_item_h1_{topic}_0.ab")))
    dest = os.path.join(REPO, "public", "rogue", "relic")
    os.makedirs(dest, exist_ok=True)
    from imgutil import save_webp as _sw  # noqa — 아래에서 PIL 경유 저장
    count = 0
    for obj in env.objects:
        if obj.type.name != "Sprite":
            continue
        d = obj.read()
        buf = io.BytesIO()
        d.image.save(buf, "PNG")
        save_webp(buf.getvalue(), os.path.join(dest, f"{d.m_Name}.webp"), photo=False, max_px=180)
        count += 1
    print(f"{topic} 아이콘 {count}장 언팩 (resVersion {ver['resVersion']}) → public/rogue/relic/")


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg == "--icons":
        unpack_icons(sys.argv[2] if len(sys.argv) > 2 else "rogue_1")
    elif arg == "rogue6":
        build_rogue6()
    elif re.fullmatch(r"rogue[1-5]", arg):
        build_topic(f"rogue_{arg[-1]}")
    elif re.fullmatch(r"rogue[1-5]-(en|ja)", arg):
        build_topic(f"rogue_{arg[5]}", arg.rsplit("-", 1)[1])
    elif arg == "i18n":
        # EN/JA 데이터 — rogue_1~5 (rogue_6은 CN 선행이라 공식 현지화가 없음)
        for n in range(1, 6):
            for lc in ("en", "ja"):
                build_topic(f"rogue_{n}", lc)
    elif arg == "all":
        for n in range(1, 6):
            build_topic(f"rogue_{n}")
        build_rogue6()
        for n in range(1, 6):
            for lc in ("en", "ja"):
                build_topic(f"rogue_{n}", lc)
    else:
        build_topic("rogue_1")
