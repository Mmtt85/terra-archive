#!/usr/bin/env python3
"""생존연산(Reclamation Algorithm) 가이드 데이터 생성.

입력: .gamedata/{kr,en,jp,cn}_sandbox_perm_table.json (fetch-gamedata.py TABLES)
출력: app/data/sandbox.json / .en.json / .ja.json

구성 (2026-08-12 사용자 확정 "생존연산 가이드, 중국어도 다 번역되도록"):
- v2 = sandbox_1 「사막 이야기」(SANDBOX_V2) — KR/EN/JP 공식 텍스트 3벌.
  요리·음료, 제작·건물·설치물, 지역·날씨, 조우(장면·선택지), 균열, 원정, 테크.
- v3 = sandbox_2 「重启锚点」(SANDBOX_V3) — **CN 선행 신시즌** (KR 미출시, 미래시).
  CN 원문에 scripts/sandbox-cn-ko.json 의 비공식 한국어 번역을 씌운다 (한국어 로케일만).
  번역이 없는 문자열은 CN 원문 그대로 나가고 빌드 로그에 미번역 수를 경고한다
  — cn-translation-fill 스킬과 같은 보완 흐름.

용량: 원본 3.4~7.5MB → 로케일당 수백 KB (가이드에 쓰는 필드만 추린다).
클라이언트는 탭 진입 시에만 지연 로드한다 (stages/rogue와 같은 성능 규칙).
"""
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp  # noqa: E402 — 공용 webp 저장 (scripts/imgutil.py)
import routeutil  # noqa: E402 — 타일 격자·경로·스폰 추출 정본 (작전 도감·통전과 공유)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "app", "data")
GD = next((a for a in sys.argv[1:] if not a.startswith("--")), os.path.join(ROOT, ".gamedata"))
NO_IMAGES = "--no-images" in sys.argv

# 이미지 에셋 (ArknightsAssets2 cn 브랜치 — 2026-08-12 탐사 결과):
# - 아이템 아이콘 640장: ui/sandboxperm/[uc]common/itemicon/<itemId>.png (두 시즌 전부)
# - 지역 맵 프리뷰 106장: ui/sandboxv2/mappreview/sandbox_1/<stageId>.png (사막 이야기)
#   신시즌(v3) 프리뷰(s2_XX 78장)는 이름 없는 구획 이미지라 아직 안 쓴다.
# → public/sandbox/{item,map}/<id>.webp — R2 서빙 (r2-sync DIRS·deploy.sh 제거 목록 "sandbox").
#   ⚠ 폴더는 sandbox, 라우트는 /ra — 같으면 deploy.sh가 자산을 떼어낼 때 라우트까지
#     지울 수 있다 (rogue가 2026-08-08에 빠졌던 함정, enemy/stage 단·복수 관례와 동일).
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"
ICON_URL = ASSETS + "/ui/sandboxperm/%5Buc%5Dcommon/itemicon/{iid}.png"
MAP_URL = ASSETS + "/ui/sandboxv2/mappreview/sandbox_1/{sid}.png"
# 시즌 전체 맵 (사용자 요청 2026-08-12 "사막 이야기 전체 맵은 받을 수 있나") —
# 게임의 지도 화면 배경 원본 (6.6MB PNG → webp 리사이즈)
WORLD_URL = ASSETS + "/ui/sandboxv2/topics/%5Buc%5Dsandbox_1/dungeon/mapbkg/sandbox_1_main_0.png"
# 신시즌(V3) 전투 지형 프리뷰 — subStageData.mapPreviewId (사용자 요청 2026-08-12
# "재기동 앵커도 맵 이미지 보여줘")
V3_MAP_URL = ASSETS + "/ui/sandboxv3/topics/%5Buc%5Dsandbox_2/mappreview/{sid}.png"
# 보조 아이콘 (사용자 요청 2026-08-12 "각종 노드들도 이미지가 전부 다 있을텐데"):
# 날씨·지도 노드·조우 종류·테크·설치물 태그·요리 속성 → public/sandbox/misc/<파일>.webp
T1 = ASSETS + "/ui/sandboxv2/topics/%5Buc%5Dsandbox_1"
MISC_URLS = {
    "weather": T1 + "/dungeon/weathertypeicons/{k}.png",
    "node": T1 + "/dungeon/nodetypeicons/{k}.png",
    "event": T1 + "/dungeon/event/{k}.png",
    "tech": T1 + "/sciencenodeicons/{k}.png",
    "tag": ASSETS + "/ui/sandboxv2/%5Buc%5Dcommon/arts/itemtraptag/{k}.png",
    "foodattr": ASSETS + "/ui/sandboxv2/%5Buc%5Dcommon/arts/foodattributeicons/{k}.png",
    "quest": T1 + "/dungeon/floathub/icons/{k}.png",                                  # 균열 주 목표
    "riftenv": ASSETS + "/ui/sandboxv2/%5Buc%5Dcommon/arts/riftparamicon/{k}.png",     # 균열 환경·적 파벌
    "riftteam": ASSETS + "/ui/sandboxv2/%5Buc%5Dcommon/arts/riftteamicon/{k}.png",     # 균열 팀 버프
}
FOOD_ATTR_ICONS = ["attack_main", "cooldown_main", "cost_main", "skill_point_main", "special_main", "survive_main"]
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
ENEMY_PORTRAIT_URL = ASSETS + "/arts/enemies/{k}.png"


def fetch_level(path, server="kr"):
    """gamedata levels/ 파일 — 로컬 캐시 (build-enemies.py와 같은 이름 규약이라 캐시 공유).
    server="cn"이면 중국 서버 파일 (신시즌 sandbox_2는 CN에만 있다)."""
    dest = os.path.join(GD, ("cn__" if server == "cn" else "") + path.replace("/", "__"))
    if os.path.exists(dest):
        try:
            return json.load(open(dest, encoding="utf-8"))
        except json.JSONDecodeError:
            os.remove(dest)
    req = urllib.request.Request(f"{GAMEDATA}/{server}/gamedata/{path}", headers={"User-Agent": "Mozilla/5.0"})
    try:
        raw = urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    os.makedirs(os.path.dirname(dest) or GD, exist_ok=True)
    open(dest, "wb").write(raw)
    return json.loads(raw)


def stats_for(enemy_db, key, ref):
    """이 지역에서 그 적의 코어 스탯 — enemyDbRefs의 레벨·오버라이드 반영 (routeutil.ms_for와 같은 언랩)."""
    lvl = (ref or {}).get("level") or 0
    ov = ((ref or {}).get("overwrittenData") or {}).get("attributes") or {}
    recs = (enemy_db or {}).get(key) or []
    rec = next((r for r in recs if r.get("level", 0) == lvl), recs[0] if recs else None)
    base = ((rec or {}).get("enemyData") or {}).get("attributes") or {}
    def g(name):
        v = routeutil._mv(ov.get(name))
        if v is None:
            v = routeutil._mv(base.get(name))
        return int(v) if isinstance(v, (int, float)) else 0
    return [g("maxHp"), g("atk"), g("def"), g("magicResistance")], lvl


def download_webp(jobs, max_px=None, photo=True):
    """(url, dest) 목록 병렬 다운로드 → webp. 이미 있으면 스킵 (build-rogue.py와 같은 조리법)."""
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
        except Exception as e:  # noqa: BLE001
            return (url, str(e))
    with ThreadPoolExecutor(12) as ex:
        return [f for f in ex.map(one, jobs) if f]

LOCALES = [("", "kr"), (".en", "en"), (".ja", "jp")]

# CN 선행분 비공식 번역 (CN 원문 → 한국어). 없는 키는 원문 유지 + 경고.
CN_KO_PATH = os.path.join(ROOT, "scripts", "sandbox-cn-ko.json")
CN_KO = json.load(open(CN_KO_PATH, encoding="utf-8")) if os.path.exists(CN_KO_PATH) else {}
_missing: set[str] = set()


def t_ko(s):
    """CN 문자열 → 비공식 한국어. 미등록이면 원문 그대로 두고 경고 수집."""
    if not s:
        return s
    hit = CN_KO.get(s)
    if hit is None:
        _missing.add(s)
        return s
    return hit


def clean(s):
    """리치 텍스트 태그 제거 — <@tag>…</> · <color=#…>…</color> 류."""
    if not s:
        return s
    s = re.sub(r"<@[^>]*>|<\$[^>]*>|</color>|<color=[^>]*>|</>", "", s)
    return s.replace("\\n", "\n").strip()


def load(prefix):
    p = os.path.join(GD, f"{prefix}_sandbox_perm_table.json")
    return json.load(open(p, encoding="utf-8"))


def build_v2(tbl):
    """sandbox_1 「사막 이야기」 — 해당 로케일 공식 텍스트.

    화면이 카드+상세 모달 구조라(사용자 확정 2026-08-12 "록라 소장품 도감처럼")
    목록에 필요한 요약과 모달에 필요한 상세를 **한 레코드**에 담는다.
    """
    d = tbl["detail"]["SANDBOX_V2"]["sandbox_1"]
    items_src = {k: v for k, v in tbl["itemData"].items() if k.startswith("sandbox_1")}
    # [이름, 용도, 희귀도, 타입, 설명]
    items = {k: [v["itemName"], clean(v.get("itemUsage") or ""), v.get("itemRarity", 0), v.get("itemType", ""),
                 clean(v.get("itemDesc") or "")]
             for k, v in items_src.items()}

    foods = []
    for f in d["foodData"].values():
        foods.append({
            "id": f["id"],
            "attrs": f.get("attributes") or [],
            "recipes": [r["mats"] for r in (f.get("recipes") or [])],
            "variants": [[v.get("type"), v.get("name"), clean(v.get("usage") or "")] for v in (f.get("variants") or [])],
        })
    food_mats = [[m["id"], m.get("type"), m.get("attribute"), m.get("variantType"), clean(m.get("buffDesc") or "")]
                 for m in d["foodMatData"].values()]
    drink_mats = [[m["id"], m.get("count", 0)] for m in d["drinkMatData"].values()]

    # ── 제작·설치물 — 종류(type)·태그별 분류 + 레벨별 상세 (사용자 요청 2026-08-12) ──
    trap_tags = {k: [v["tagName"], v.get("tagPic") or ""] for k, v in d["itemTrapTagData"].items()}
    building_rarity = {k: v.get("itemRarity", 0) for k, v in d["buildingItemData"].items()}
    # itemTrapData는 레벨 행 단위 — 밑동(minLevelItemId)으로 묶어 레벨 목록을 만든다
    trap_by_base = {}
    for row in d["itemTrapData"].values():
        base = row.get("minLevelItemId") or row["itemId"]
        g = trap_by_base.setdefault(base, {"name": row.get("baseItemName") or "", "tag": row.get("itemTag") or "",
                                           "type": row.get("itemType") or "", "levels": []})
        g["levels"].append([row.get("trapLevel", 1), row["itemId"], row.get("buildingLevel", -1)])
    for g in trap_by_base.values():
        g["levels"].sort()

    crafts = []
    for c in d["craftItemData"].values():
        iid = c["itemId"]
        tr = trap_by_base.get(iid) or {}
        crafts.append({
            "id": iid,
            "type": c.get("type") or "",            # BASE_BUILDING · COMBAT_BUILDING · TACTICAL
            "tag": tr.get("tag") or "",             # OUTPUT · DEFEND · ENHANCE …
            "kind": tr.get("type") or "",           # FUNCTION · BATTLE · TACTICAL · ANIMAL
            "unlock": clean(c.get("buildingUnlockDesc") or ""),
            "mats": c.get("materialItems") or {},
            "up": c.get("upgradeItems") or None,
            "rarity": building_rarity.get(iid, 0),
            "out": c.get("outputRatio", 0),
            "wd": c.get("withdrawRatio", 0),
            "repair": c.get("repairCost", 0),
            "lvs": [lv[0] for lv in tr.get("levels", [])],
        })

    stages = [[s["stageId"], s.get("code") or "", s.get("name") or "", clean(s.get("description") or ""),
               s.get("actionCost", 0), s.get("actionCostEnemyRush", 0)]
              for s in d["stageData"].values()]
    # 지역별 획득 자원 (rewardConfigData) — 지역 필터·상세에 쓴다.
    # ⚠ 게임 데이터에 '지역 ↔ 노드 종류' 고정 매핑은 없다 (노드는 런타임 배치) —
    #   그래서 사용자 요청의 '노드 종류별'은 **획득 자원별**로 갈음한다 (2026-08-12).
    smp = (d.get("rewardConfigData") or {}).get("stageMapPreviewRewardDict") or {}
    stage_rewards = {k: [r["rewardItem"] for r in (v.get("rewardList") or [])] for k, v in smp.items()}

    zones = {z["zoneId"]: z.get("zoneName") or "" for z in d["zoneData"].values()}
    # 전체 지도 위 구역 표시 (사용자 요청 2026-08-12 "전체 지도 위에 노드들도 표시").
    # ⚠ 노드 개별 좌표는 데이터에 없다 (nodes에 minDistance뿐 — 노드는 판마다 새로 배치).
    #   대신 mapData의 **구역 폴리곤·중심**이 있어 그걸 지도에 얹는다. 좌표는 카메라 범위
    #   (mapConfig.cameraBoundMin/Max)로 정규화해 0~1 비율로 저장 — 이미지 크기와 무관해진다.
    main = (d.get("mapData") or {}).get("sandbox_1_main_0") or {}
    cfg = main.get("mapConfig") or {}
    lo, hi = cfg.get("cameraBoundMin") or {}, cfg.get("cameraBoundMax") or {}
    span_x = (hi.get("x", 1) - lo.get("x", 0)) or 1
    span_y = (hi.get("y", 1) - lo.get("y", 0)) or 1
    def nx(v):  # 0(왼쪽)~1(오른쪽)
        return round((v - lo.get("x", 0)) / span_x, 4)
    def ny(v):  # 0(위)~1(아래) — 게임 y축은 위가 +
        return round((hi.get("y", 0) - v) / span_y, 4)
    zone_areas = []
    for zid, zv in (main.get("zones") or {}).items():
        c = zv.get("center") or {}
        verts = [[nx(p2.get("x", 0)), ny(p2.get("y", 0))] for p2 in (zv.get("vertices") or [])]
        if verts:
            zone_areas.append({"id": zid, "name": zones.get(zid, ""),
                               "c": [nx(c.get("x", 0)), ny(c.get("y", 0))], "v": verts})
    nodes_total = len(main.get("nodes") or {})
    node_types = {k: [v.get("name") or "", v.get("iconId") or ""] for k, v in d["nodeTypeData"].items()}
    # 날씨 — 기후 종류(weatherType)별로 묶고 위험도(level)로 정렬 (사용자 요청:
    # "쾌청·위험도1·2·3 다 나뉘어 있으니 한 종류로 그룹바이, 상세에서 위험도 지정")
    wgroups = {}
    for w in d["weatherData"].values():
        g = wgroups.setdefault(w.get("weatherType") or "NORMAL",
                               {"type": w.get("weatherType") or "NORMAL", "name": w.get("weatherTypeName") or "", "lv": []})
        g["lv"].append([w.get("weatherLevel", 0), w.get("name") or "", clean(w.get("functionDesc") or ""),
                        clean(w.get("description") or ""), w.get("weatherIconId") or ""])
    for g in wgroups.values():
        g["lv"].sort(key=lambda x: x[0])
    weather = list(wgroups.values())

    def fam(scene_id):
        core = scene_id[len("scene_"):] if scene_id.startswith("scene_") else scene_id
        return core.rsplit("_", 1)[0]
    fam_icon = {}
    for ev in d["eventData"].values():
        if ev.get("enterSceneId"):
            fam_icon[fam(ev["enterSceneId"])] = ev.get("iconId") or ""
    ev_name = {}
    for ev in d["eventData"].values():
        if ev.get("enterSceneId"):
            ev_name[fam(ev["enterSceneId"])] = ev.get("iconName") or ""
    choices = d["eventChoiceData"]
    scenes = []
    for sc in d["eventSceneData"].values():
        f = fam(sc["eventSceneId"])
        scenes.append({
            "id": sc["eventSceneId"],
            "icon": fam_icon.get(f, ""),
            "kind": ev_name.get(f, ""),
            "title": sc.get("title") or "",
            "desc": clean(sc.get("desc") or ""),
            "choices": [[choices[c].get("title") or "", clean(choices[c].get("desc") or ""), choices[c].get("costAction", 0)]
                        for c in (sc.get("choiceIds") or []) if c in choices],
        })

    # ── 균열 — riftId별로 난이도(환경압력)를 한 카드에 묶는다 (사용자 요청 2026-08-12
    # "환경 압력도 00 11 22 33 중복이니 하나로 합쳐줘, 카드 형식으로") ──
    rewards = d.get("riftRewardDisplayData") or {}
    rifts = {}
    for r in d["riftDifficultyData"].values():
        g = rifts.setdefault(r["riftId"], {"id": r["riftId"], "diffs": []})
        g["diffs"].append([r.get("difficultyLevel", 0), clean(r.get("desc") or ""),
                           rewards.get(r.get("rewardGroupId") or "", [])])
    for g in rifts.values():
        g["diffs"].sort(key=lambda x: x[0])
    fixed = [[f.get("riftName") or "", rewards.get(f.get("rewardGroupId") or "", [])]
             for f in (d.get("fixedRiftData") or {}).values()]
    rift = {
        "sets": list(rifts.values()),
        "fixed": fixed,
        # 주 목표 — 종류(targetType)별로 묶는다
        "mains": [[m.get("targetType") or "", m.get("title") or "", clean(m.get("desc") or ""),
                   m.get("targetDayCount", 0), m.get("questIconName") or "", m.get("questIconId") or "",
                   clean(m.get("storyDesc") or "")]
                  for m in d["riftMainTargetData"].values()],
        "subs": [[m.get("name") or "", clean(m.get("desc") or "")] for m in d["riftSubTargetData"].values()],
        "teams": [[tv[0].get("teamName") or "", clean(tv[0].get("teamDesc") or ""), tv[0].get("teamSmallIconId") or "",
                   [[b.get("buffLevel", 0), clean(b.get("buffDesc") or "")] for b in tv]]
                  for tv in (d.get("riftTeamBuffData") or {}).values()],
        "globals": [clean(g.get("desc") or "") for g in (d.get("riftGlobalEffectData") or {}).values()],
        "envs": [[e.get("desc") or "", e.get("iconId") or ""] for e in (d.get("riftEnemyParamData") or {}).values()],
    }

    # ── 원정 — 같은 효과(effectDesc)끼리 묶어 한 카드, 안에서 편성 변형을 고른다 ──
    exp_groups = {}
    for e in d["expeditionData"].values():
        g = exp_groups.setdefault(clean(e.get("effectDesc") or ""), {"eff": clean(e.get("effectDesc") or ""), "rows": []})
        g["rows"].append([clean(e.get("desc") or ""), e.get("costDrink", 0), e.get("charCnt", 0),
                          e.get("minEliteRank", 0), e.get("duration", 0), e.get("professions") or []])
    for g in exp_groups.values():
        g["rows"].sort(key=lambda x: (x[4], x[2]))
    expeditions = list(exp_groups.values())

    techs = [[t.get("techName") or "", t.get("techType") or "", t.get("tokenCost", 0), clean(t.get("rawDesc") or ""),
              t.get("techIconId") or ""]
             for t in d["developmentData"].values()]

    # 오브젝트·적 처치 보상 (파괴하면 뭐가 나오는지)
    rcd = d.get("rewardConfigData") or {}
    trap_rewards = {k: [v.get("rewardItemId") or "", v.get("count", 0)] for k, v in (rcd.get("trapRewardDict") or {}).items()}
    enemy_rewards = {k: [v.get("rewardItemId") or "", v.get("count", 0)] for k, v in (rcd.get("enemyRewardDict") or {}).items()}

    return {
        "name": tbl["basicInfo"]["sandbox_1"].get("topicName") or "",
        "items": items, "foods": foods, "foodMats": food_mats, "drinkMats": drink_mats,
        "crafts": crafts, "trapTags": trap_tags,
        "stages": stages, "stageRewards": stage_rewards, "zones": zones, "nodeTypes": node_types,
        "zoneAreas": zone_areas, "nodeCount": nodes_total,
        "weather": weather, "scenes": scenes, "rift": rift, "expeditions": expeditions, "techs": techs,
        "trapRewards": trap_rewards, "enemyRewards": enemy_rewards,
    }


# 지도 오브젝트 — 레벨 predefines.tokenInsts의 설치물 중 표시할 종류 (사용자 요청
# 2026-08-12). 지도에는 파괴 가능 바위(rock)만 그리고 나머지는 모달의 자원 목록으로.
OBJ_KINDS = {
    "trap_413_hiddenstone": "rock",      # 길을 막는 파괴 가능 바위
    "trap_410_xbstone": "stone",         # 석재 바위
    "trap_411_xbiron": "iron",           # 철광석 바위
    "trap_460_xbdiam": "diam",           # 명징석 바위
    "trap_409_xbwood": "wood",           # 벌목 (사용자 지시 2026-08-12: '식생'이 아니라 '목재')
    "trap_414_vegetation": "wood",
    "trap_416_gtreasure": "treasure",    # 보물
    "trap_422_streasure": "treasure",
}


def build_stage_details(kr_tbl):
    """v2 지역별 타일 격자·경로·스폰(시뮬)·등장 적 — 작전 도감 상세와 같은 재료.

    반환: (routes_doc {stageId: StageRoutes|별칭}, stage_enemies {stageId: rows}, ra_only_ids)
    rows = [적id, 초상id, 출처(0=적도감 초상/1=sandbox 초상), 마릿수, 레벨, hp, atk, def, res]
    마릿수는 웨이브 스폰 합 — 습격(러시) 풀에만 있는 적은 0으로 싣고 UI가 표기를 달리한다."""
    d = kr_tbl["detail"]["SANDBOX_V2"]["sandbox_1"]
    handbook = json.load(open(os.path.join(GD, "kr_enemy_handbook_table.json"), encoding="utf-8"))
    hb = handbook.get("enemyData", handbook)
    enemy_db = fetch_level("levels/enemydata/enemy_database.json") or {}

    routes_doc, first_by_level = {}, {}
    stage_enemies, ra_only, stage_objs = {}, set(), {}
    for st in d["stageData"].values():
        sid = st["stageId"]
        lid = (st.get("levelId") or "").lower()
        if not lid:
            continue
        lv = fetch_level(f"levels/{lid}.json")
        if not lv:
            continue
        rt = routeutil.routes_of_level(lv, enemy_db)
        if rt:
            # 지도 오브젝트 오버레이 — 좌표는 경로와 같은 규약(row 0 = 아래), 렌더러가 뒤집는다
            ob = []
            for tk in ((lv.get("predefines") or {}).get("tokenInsts") or []):
                kind = OBJ_KINDS.get(((tk.get("inst") or {}).get("characterKey")) or "")
                pos = tk.get("position") or {}
                if kind and isinstance(pos.get("row"), int):
                    ob.append([kind, pos.get("col", 0), pos.get("row", 0)])
            if ob:
                rt["ob"] = ob
                cnt = {}
                for o in ob:
                    cnt[o[0]] = cnt.get(o[0], 0) + 1
                stage_objs[sid] = cnt
            if lid in first_by_level:
                routes_doc[sid] = first_by_level[lid]
            else:
                first_by_level[lid] = sid
                routes_doc[sid] = rt
        refs = {x.get("id"): x for x in lv.get("enemyDbRefs") or []}
        keys = list(rt["e"]) if rt else []
        order = keys + [k for k in refs if k not in keys]
        counts = {}
        for sp in (rt or {}).get("sp") or []:
            counts[sp[5]] = counts.get(sp[5], 0) + sp[3]
        rows = []
        for key in order:
            stats, lvl = stats_for(enemy_db, key, refs.get(key))
            # 초상: 도감(핸드북)에 있으면 그 초상, 변형(_b·_1 등)은 접미를 벗겨 밑동으로,
            # 그것도 없으면 sandbox 폴더에서 자체 초상 (arts/enemies 직다운)
            img, src = key, 0
            if key not in hb:
                base = key
                while base not in hb:
                    stripped = re.sub(r"_(\d+|[a-z]+)$", "", base)
                    if stripped == base:
                        base = None
                        break
                    base = stripped
                if base:
                    img = base
                else:
                    src = 1
                    ra_only.add(key)
            cnt = counts.get(keys.index(key), 0) if key in keys else 0
            rows.append([key, img, src, cnt, lvl, *stats])
        stage_enemies[sid] = rows
    return routes_doc, stage_enemies, ra_only, stage_objs


def enemy_names_for(prefix, ids):
    """로케일 핸드북에서 적 이름 — 변형은 밑동 이름으로 폴백."""
    handbook = json.load(open(os.path.join(GD, f"{prefix}_enemy_handbook_table.json"), encoding="utf-8"))
    hb = handbook.get("enemyData", handbook)
    out = {}
    for i in ids:
        cand = i
        while cand and cand not in hb:
            stripped = re.sub(r"_(\d+|[a-z]+)$", "", cand)
            cand = stripped if stripped != cand else None
        e = hb.get(cand) if cand else None
        if e and e.get("name"):
            out[i] = e["name"]
    return out


def build_v3(cn, ko_mode):
    """sandbox_2 「重启锚点」 — CN 선행. ko_mode면 비공식 번역을 씌우고 CN 원문을 병기한다."""
    d = cn["detail"]["SANDBOX_V3"]["sandbox_2"]
    tr = t_ko if ko_mode else (lambda s: s)
    items_src = {k: v for k, v in cn["itemData"].items() if k.startswith("sandbox_2")}
    # [번역명(없으면 CN), CN 원문, 용도(CN), 희귀도]
    items = {}
    for k, v in items_src.items():
        cn_name = v.get("itemName") or ""
        items[k] = [tr(cn_name), cn_name, clean(v.get("itemUsage") or ""), v.get("itemRarity", 0), v.get("itemType", "")]

    process = [[r.get("outputItemId") or "", r.get("outputCnt", 1), r.get("materials") or {}, r.get("recipeLevel", 1)]
               for r in d["processRecipeData"].values()]
    builds = [[b.get("outputItemId") or "", b.get("materials") or {}, b.get("outputTrapType") or ""]
              for b in d["buildRecipeData"].values()]
    stages = [[s.get("code") or "", tr(s.get("name") or ""), s.get("name") or "", clean(s.get("description") or "")]
              for s in d["stageData"].values()]
    weather = [[tr(w.get("name") or ""), w.get("name") or "", clean(w.get("funcDesc") or ""), clean(w.get("desc") or "")]
               for w in d["weatherData"].values()]
    choices = d["eventChoiceData"]
    scenes = []
    for sc in d["eventSceneData"].values():
        scenes.append({
            "title": tr(sc.get("title") or ""),
            "cn": sc.get("title") or "",
            "desc": clean(sc.get("desc") or ""),
            # [CN 원문, 번역, 설명] — CN이 메인, 번역은 서브 병기 (사용자 확정 2026-08-12)
            "choices": [[choices[c].get("title") or "", tr(choices[c].get("title") or ""), clean(choices[c].get("desc") or "")]
                        for c in (sc.get("choiceIdList") or []) if c in choices],
        })
    # 전투 지형 — V3는 시나리오(stageData)와 전투 맵(subStageData)이 갈려 있다.
    # 맵 프리뷰가 있는 건 subStage 쪽이라 지역 탭은 이걸 보여준다.
    subs = [[sv.get("subStageId") or "", sv.get("mapPreviewId") or "", sv.get("levelId") or ""]
            for sv in (d.get("subStageData") or {}).values()]
    info = cn["basicInfo"]["sandbox_2"]
    return {
        "subs": subs,
        "name": tr(info.get("topicName") or ""), "cnName": info.get("topicName") or "",
        "start": info.get("topicStartTime", 0),
        "items": items, "process": process, "builds": builds,
        "stages": stages, "weather": weather, "scenes": scenes,
    }


def main():
    cn = load("cn")
    kr_tbl = load("kr")
    routes_doc, stage_enemies, ra_only, stage_objs = build_stage_details(kr_tbl)
    p = os.path.join(DATA, "sandbox-routes.json")
    json.dump(routes_doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  sandbox-routes.json: 지역 {len(routes_doc)} — {os.path.getsize(p) // 1024}KB")
    # 핸드북에 이름이 없는 개체는 표시할 정보가 없다 — 도감·등장 적에서 뺀다
    # (2026-08-12 사용자 제보: 적 도감에 id만 뜨는 항목. kr/cn 핸드북 어디에도 없고
    #  대부분 스탯도 0인 내부용 더미·소환체다).
    named = enemy_names_for("kr", sorted({r[0] for rows in stage_enemies.values() for r in rows}))
    dropped = set()
    for sid, rows in list(stage_enemies.items()):
        keep = [r for r in rows if r[0] in named]
        dropped |= {r[0] for r in rows if r[0] not in named}
        stage_enemies[sid] = keep
    if dropped:
        print(f"  이름 없는 개체 {len(dropped)}종 제외 (핸드북 미등록): {', '.join(sorted(dropped)[:6])}…")
    ra_only &= named.keys()
    all_ids = sorted({r[0] for rows in stage_enemies.values() for r in rows})

    docs = {}
    for suffix, prefix in LOCALES:
        tbl = load(prefix)
        doc = {"v2": build_v2(tbl), "v3": build_v3(cn, ko_mode=(suffix == ""))}
        doc["v2"]["stageEnemies"] = stage_enemies
        doc["v2"]["enemyNames"] = enemy_names_for(prefix, all_ids)
        doc["v2"]["stageObjs"] = stage_objs
        # 적 도감 — 적별 대표 스탯(최고 레벨)·초상·등장 지역 역색인 (사용자 요청 2026-08-12)
        dex = {}
        for sid, rows in stage_enemies.items():
            for r in rows:
                e = dex.setdefault(r[0], {"id": r[0], "img": r[1], "src": r[2], "lv": r[4],
                                          "st": r[5:9], "at": []})
                e["at"].append([sid, r[3]])
                if r[4] > e["lv"]:  # 더 높은 강화 단계의 스탯을 대표로
                    e["lv"], e["st"] = r[4], r[5:9]
        doc["v2"]["dex"] = list(dex.values())
        docs[suffix] = doc
        p = os.path.join(DATA, f"sandbox{suffix}.json")
        json.dump(doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"  sandbox{suffix}.json: {os.path.getsize(p) // 1024}KB")
    if _missing:
        print(f"⚠ CN 선행분 미번역 {len(_missing)}건 — scripts/sandbox-cn-ko.json에 보완 (cn-translation-fill 흐름)")
        for s in sorted(_missing)[:20]:
            print(f"   未: {s[:60]}")

    if NO_IMAGES:
        return
    ko = docs[""]
    icon_ids = sorted(set(ko["v2"]["items"]) | set(ko["v3"]["items"]))
    jobs = [(ICON_URL.format(iid=i), os.path.join(ROOT, "public", "sandbox", "item", f"{i}.webp")) for i in icon_ids]
    fails = download_webp(jobs, max_px=128, photo=False)
    print(f"  아이템 아이콘: {len(jobs) - len(fails)}/{len(jobs)}")
    jobs = [(MAP_URL.format(sid=s[0]), os.path.join(ROOT, "public", "sandbox", "map", f"{s[0]}.webp")) for s in ko["v2"]["stages"]]
    fails2 = download_webp(jobs, max_px=640, photo=True)
    print(f"  지역 맵 프리뷰: {len(jobs) - len(fails2)}/{len(jobs)}")

    # 보조 아이콘 — 데이터에 실제로 등장하는 id만 받는다
    v2 = ko["v2"]
    misc = set()
    misc |= {("weather", lv[4]) for w in v2["weather"] for lv in w["lv"] if lv[4]}
    misc |= {("node", nt[1]) for nt in v2["nodeTypes"].values() if nt[1]}
    misc |= {("event", sc["icon"]) for sc in v2["scenes"] if sc.get("icon")}
    misc |= {("tech", t[4]) for t in v2["techs"] if t[4]}
    misc |= {("tag", tg[1]) for tg in v2["trapTags"].values() if tg[1]}
    misc |= {("foodattr", f) for f in FOOD_ATTR_ICONS}
    misc |= {("quest", m[5]) for m in v2["rift"]["mains"] if m[5]}
    misc |= {("riftenv", e[1]) for e in v2["rift"]["envs"] if e[1]}
    misc |= {("riftteam", tm[2]) for tm in v2["rift"]["teams"] if tm[2]}
    jobs = [(MISC_URLS[kind].format(k=k), os.path.join(ROOT, "public", "sandbox", "misc", f"{k}.webp"))
            for kind, k in sorted(misc)]
    fails3 = download_webp(jobs, max_px=96, photo=False)
    print(f"  보조 아이콘(날씨·노드·조우·테크·태그·속성): {len(jobs) - len(fails3)}/{len(jobs)}")

    # 시즌 전체 맵 — 폭 1600px webp로 (원본 6.6MB)
    fails0 = download_webp([(WORLD_URL, os.path.join(ROOT, "public", "sandbox", "world", "sandbox_1.webp"))],
                           max_px=1600, photo=True)
    print(f"  전체 맵: {'실패' if fails0 else 'OK'}")

    # 신시즌 전투 지형 프리뷰
    v3subs = sorted({sv[1] for sv in ko["v3"]["subs"] if sv[1]})
    jobs = [(V3_MAP_URL.format(sid=m), os.path.join(ROOT, "public", "sandbox", "map2", f"{m}.webp")) for m in v3subs]
    failsv3 = download_webp(jobs, max_px=640, photo=True)
    print(f"  신시즌 지형 프리뷰: {len(jobs) - len(failsv3)}/{len(jobs)}")

    # 적 도감에 없는 생존연산 전용 적 초상 (rows의 출처=1)
    jobs = [(ENEMY_PORTRAIT_URL.format(k=k), os.path.join(ROOT, "public", "sandbox", "enemy", f"{k}.webp"))
            for k in sorted(ra_only)]
    fails4 = download_webp(jobs, max_px=128, photo=False)
    if jobs:
        print(f"  생존연산 전용 적 초상: {len(jobs) - len(fails4)}/{len(jobs)}")
    for u, e in (fails + fails2 + fails3 + fails4)[:10]:
        print(f"   실패: {u.rsplit('/', 1)[-1]} — {e}")


if __name__ == "__main__":
    main()
