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

def num(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return round(v, 3) if isinstance(v, float) else v


def build_rogue1():
    table = fetch_json("excel/roguelike_topic_table.json")
    topic = table["topics"]["rogue_1"]
    r = table["details"]["rogue_1"]
    handbook = fetch_json("excel/enemy_handbook_table.json")["enemyData"]
    enemy_db = fetch_json("levels/enemydata/enemy_database.json")

    items = r["items"]  # 유물/음반/티켓 등 표시 텍스트

    # ── 존 (portal_* 변형 존은 원본과 중복이라 제외) ──────────────────────────
    zones = []
    for zid, z in r["zones"].items():
        if zid.startswith("portal_"):
            continue
        desc = (z.get("description") or "").split("\n", 1)
        zones.append({
            "id": zid, "num": int(zid.split("_")[1]), "name": z["name"],
            "time": desc[0] if len(desc) > 1 else None,
            "desc": desc[1] if len(desc) > 1 else desc[0],
            "buff": z.get("buffDescription"), "hidden": bool(z.get("isHiddenZone")),
        })
    zones.sort(key=lambda z: z["num"])
    # 존 배경 — ui/rogueliketopic/topics/rogue_1_update/levelbgpic/rogue_1_map_<n>.png
    zone_dir = os.path.join(REPO, "public", "rogue", "zone")
    download_webp([(f"{ASSETS}/ui/rogueliketopic/topics/rogue_1_update/levelbgpic/rogue_1_map_{z['num']}.png",
                    os.path.join(zone_dir, f"rogue_1_map_{z['num']}.webp")) for z in zones], max_px=900)
    for z in zones:
        z["img"] = os.path.exists(os.path.join(zone_dir, f"rogue_1_map_{z['num']}.webp"))

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
        parts = sid.split("_")  # ro1_n_1_1 / ro1_e_1_1 / ro1_b_1 / ro1_ev_1 / ro1_t_1
        kind_code = parts[1]
        kind = {"n": "normal", "e": "emergency", "b": "boss", "ev": "event", "t": "duel"}.get(kind_code, kind_code)
        zone = int(parts[2]) if kind_code in ("n", "e") else None
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
            "name": st["name"], "desc": st.get("description"),
            "eliteDesc": st.get("eliteDesc") or None,
            "emg": lv["emg"] if kind == "emergency" else None,
            "enemies": enemies,
        })
    order = {"normal": 0, "emergency": 1, "boss": 2, "event": 3, "duel": 4}
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
        name = mv(pick.get("name")) or mv(base.get("name")) or hb.get("name") or key
        enemies[key] = {
            "name": name,
            "rank": hb.get("enemyLevel"),  # NORMAL/ELITE/BOSS
            "index": hb.get("enemyIndex"),
            "attack": hb.get("attackType"),
            "desc": hb.get("description"),
            "ability": hb.get("ability"),
            "hp": num(attr("maxHp", 0)), "atk": num(attr("atk", 0)),
            "def": num(attr("def", 0)), "res": num(attr("magicResistance", 0)),
            "aspd": num(attr("attackSpeed", 100)), "ms": num(attr("moveSpeed", 1)),
            "weight": num(attr("massLevel", 1)),
            "lifePoint": mv(pick.get("lifePointReduce"), mv(base.get("lifePointReduce"), 1)),
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
    cap_order = (r["archiveComp"]["capsule"] or {}).get("capsule", {})
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
    # 음반 자켓 — ui/rogueliketopic/topics/rogue_1/capsule/<id>.png
    cap_dir = os.path.join(REPO, "public", "rogue", "capsule")
    download_webp([(f"{ASSETS}/ui/rogueliketopic/topics/rogue_1/capsule/{c['id']}.png",
                    os.path.join(cap_dir, f"{c['id']}.webp")) for c in capsules], max_px=360)
    for c in capsules:
        c["img"] = os.path.exists(os.path.join(cap_dir, f"{c['id']}.webp"))

    tools = [{"id": iid, "name": it["name"], "desc": it.get("description"), "usage": it.get("usage"),
              "img": os.path.exists(os.path.join(REPO, "public", "rogue", "relic", f"{iid}.webp"))}
             for iid, it in items.items() if it.get("type") == "ACTIVE_TOOL"]
    bands = [{"id": iid, "name": it["name"], "desc": it.get("description"), "usage": it.get("usage"),
              "img": os.path.exists(os.path.join(REPO, "public", "rogue", "relic", f"{iid}.webp"))}
             for iid, it in items.items() if it.get("type") == "BAND"]

    # ── 환각(variation) + 융합(fusion) ────────────────────────────────────────
    variations = [{"id": k, "name": v.get("outerName") or v.get("innerName"),
                   "func": v.get("functionDesc"), "desc": v.get("desc"), "fusion": False}
                  for k, v in r["variationData"].items()]
    variations += [{"id": k, "name": v.get("name"), "func": v.get("functionDesc"),
                    "desc": v.get("desc"), "fusion": True}
                   for k, v in r["fusionData"].items()]

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

    # ── 조우 씬 (enter 씬 + 선택지 텍스트) ────────────────────────────────────
    encounters = []
    for sid, sc in r["choiceScenes"].items():
        if not sid.endswith("_enter"):
            continue
        prefix = sid[: -len("_enter")].replace("scene_", "choice_")
        chs = [{"title": c["title"], "desc": c.get("description")}
               for cid, c in sorted(r["choices"].items())
               if cid.startswith(prefix + "_")]
        encounters.append({
            "scene": sid, "title": sc["title"], "desc": sc.get("description"),
            "bg": sc.get("background"), "choices": chs,
        })
    encounters.sort(key=lambda x: x["scene"])
    # 조우 배경 CG — avg/images/<bg>.png
    scene_dir = os.path.join(REPO, "public", "rogue", "scene")
    download_webp([(f"{ASSETS}/avg/images/{e['bg']}.png",
                    os.path.join(scene_dir, f"{e['bg']}.webp"))
                   for e in encounters if e.get("bg")], max_px=720)
    for e in encounters:
        if e.get("bg") and not os.path.exists(os.path.join(scene_dir, f"{e['bg']}.webp")):
            e["bg"] = None

    # ── 수작업 큐레이션 병합 (조우 층 규칙·엔딩 조건 — PRTS 기반) ─────────────
    curated_path = os.path.join(REPO, "scripts", "rogue1-curated.json")
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
        # 보스(험난한 길) 출현 층 — 사용자 확인: b_1~5=3층, b_6~7=5층, b_8~9=히든 6층
        boss_floors = curated.get("bossFloors", {})
        for s in stages:
            if s["id"] in boss_floors:
                s["zone"] = boss_floors[s["id"]]

    out = {
        "id": "rogue_1",
        "name": topic["name"],
        "line": topic.get("lineText"),
        "zones": zones,
        "nodeTypes": [{"id": k, "name": v["name"], "desc": v.get("description")}
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

    dest = os.path.join(REPO, "app", "data", "rogue1.json")
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    kb = os.path.getsize(dest) // 1024
    print(f"rogue1.json: zones={len(zones)} stages={len(stages)} enemies={len(enemies)} "
          f"relics={len(relics)} capsules={len(capsules)} variations={len(variations)} "
          f"encounters={len(encounters)} → {kb}KB")


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
                "t": "incident", "duel": "duel", "c": "savage"}
    used_enemies = {}
    stages = []
    for st in r["stages"].values():
        sid = st["id"]
        parts = sid.split("_")  # ro6_n_1_1 / ro6_e_1_1 / ro6_b_1 / ro6_t_1 / ro6_duel_1 / ro6_c_1
        kind = kind_map.get(parts[1], parts[1])
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
            "name": st["name"], "desc": st.get("description"),
            "eliteDesc": st.get("eliteDesc") or None,
            "emg": lv["emg"] if kind == "emergency" else None,
            "level": st["levelId"],
            "enemies": enemies,
        })
    order = {"normal": 0, "emergency": 1, "boss": 2, "savage": 3, "duel": 4, "incident": 5}
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
            "attack": hbk.get("attackType") or hb.get("attackType"),
            "desc": hbk.get("description") or hb.get("description"),
            "ability": hbk.get("ability") or hb.get("ability"),
            "hp": num(attr("maxHp", 0)), "atk": num(attr("atk", 0)),
            "def": num(attr("def", 0)), "res": num(attr("magicResistance", 0)),
            "aspd": num(attr("attackSpeed", 100)), "ms": num(attr("moveSpeed", 1)),
            "weight": num(attr("massLevel", 1)),
            "lifePoint": mv(pick.get("lifePointReduce"), mv(base.get("lifePointReduce"), 1)),
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
    for x in relics:
        x["img"] = os.path.exists(os.path.join(relic_icon_dir, f"{x['id']}.webp"))

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

    tools = [{"id": iid, "name": it["name"], "desc": it.get("description"), "usage": it.get("usage"),
              "img": os.path.exists(os.path.join(relic_icon_dir, f"{iid}.webp"))}
             for iid, it in items.items() if it.get("type") == "ACTIVE_TOOL"]
    bands = [{"id": iid, "name": it["name"], "desc": it.get("description"), "usage": it.get("usage"),
              "img": os.path.exists(os.path.join(relic_icon_dir, f"{iid}.webp"))}
             for iid, it in items.items() if it.get("type") == "BAND"]

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

    encounters = []
    for sid, sc in r["choiceScenes"].items():
        if not sid.endswith("_enter"):
            continue
        prefix = sid[: -len("_enter")].replace("scene_", "choice_")
        chs = [{"title": c["title"], "desc": c.get("description")}
               for cid, c in sorted(r["choices"].items())
               if cid.startswith(prefix + "_")]
        encounters.append({
            "scene": sid, "title": sc["title"], "desc": sc.get("description"),
            "bg": sc.get("background"), "choices": chs,
        })
    encounters.sort(key=lambda x: x["scene"])
    # 같은 제목의 변형 씬(溯源 19종 등)은 하나로 병합 — 선택지는 제목 기준 합집합
    merged, by_title = [], {}
    for e in encounters:
        m = by_title.get(e["title"])
        if m is None:
            by_title[e["title"]] = e
            merged.append(e)
            continue
        m["desc"] = m["desc"] or e["desc"]
        m["bg"] = m["bg"] or e["bg"]
        seen_ch = {c["title"] for c in m["choices"]}
        m["choices"] += [c for c in e["choices"] if c["title"] not in seen_ch]
    encounters = merged
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
        "nodeTypes": [{"id": k, "name": v["name"], "desc": v.get("description")}
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
    for enc in out["encounters"]:
        keep_cn(enc, "title")

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
    for enc in out["encounters"]:
        drop_same_cn(enc, "title")

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
    if len(sys.argv) > 1 and sys.argv[1] == "--icons":
        unpack_icons(sys.argv[2] if len(sys.argv) > 2 else "rogue_1")
    elif len(sys.argv) > 1 and sys.argv[1] == "rogue6":
        build_rogue6()
    else:
        build_rogue1()
