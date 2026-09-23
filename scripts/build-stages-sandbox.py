#!/usr/bin/env python3
"""작전 도감(/stages)·작전 시뮬레이터(/sim)에 얹는 **생존연산 지역 색인** — app/data/stages-sandbox{,.en,.ja}.json.

사용자 요청 2026-09-23 "생존연산 맵들도 다 작전도감 및 작전시뮬레이터에 편입시켜주고, 형식도 맞춰줘".
통합전략 색인(scripts/build-stages-rogue.py)과 **같은 방식**이다 — 자기 완결형 미니 StageDoc 을 내고,
화면(app/stages-*.tsx · app/sim-launcher.tsx)이 mergeRogueDoc 으로 본 문서 뒤에 이어 붙인다.

사용:
  python3 scripts/build-stages-sandbox.py     # 네트워크 불필요 — 커밋된 산출물만 읽는다

입력 (전부 build-sandbox.py 산출물 — 그래서 **build-sandbox.py 뒤에** 돌린다):
  app/data/sandbox{,.en,.ja}.json   v2(사막 이야기) 지역·등장 적·적 이름
  app/data/sandbox-routes.json      지역별 격자·경로·스폰 (시뮬 가능 여부, 평면도 판정)
  public/sandbox/map/<id>.webp      지역 도면 (평면도 판정)

⚠ **stages.json 에 섞지 않는다** — 통합전략과 같은 이유(상세 페이지 파일 수 한도, build-stages-rogue.py
  머리주석). 생존연산 지역은 목록과 모달(#st-<id>)로만 본다.
⚠ 재기동 앵커(v3, 중섭 선행)는 아직 넣지 않는다 — 지역 하나가 이름 없는 지형 조각(s2_*) 여럿으로
  이뤄지고 도면도 300px 썸네일이라, 도감 한 줄로 세울 이름·그림 규칙을 먼저 정해야 한다.

## 평면도(ortho) — 합친 도면

사막 이야기 도면은 통상 작전(16:9 전투 화면을 정사각에 눌러 담은 그림)과 달리 **격자를 바로 위에서
그린 평면도**다. 단 격자가 그림 전체가 아니라 **가운데 5/6** 만 차지한다(가장자리마다 1/12 여백 —
app/stage-cam.ts SANDBOX_GRID_SHARE). 그래서 그림 비율 = 격자 비율인 86/106장이 이 규칙을 따른다
(2026-09-23 출현·도착 칸 40곳을 잘라 대조 — 전부 표식 한가운데). 그런 도면에만 `ortho: 1` 을 붙인다 — 상세가 원근 없이 격자를
그대로 겹쳐 도면·이동 경로를 한 화면으로 합친다. 나머지 20장은 테두리를 잘라 낸 규칙이 따로 있어
(빈 테두리 제거로도 설명되지 않음) 종전 두 탭(도면 / 격자 경로)으로 남는다.
"""
import json
import os
import sys

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "app", "data")
MAP_DIR = os.path.join(REPO, "public", "sandbox", "map")
LOCALES = [("ko", ""), ("en", ".en"), ("ja", ".ja")]
TYPE_LABEL = {"ko": "생존연산", "en": "Reclamation Algorithm", "ja": "生息演算"}


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def ortho_ok(sid, route):
    """도면 비율 = 격자 비율(±2%) 이면 평면도로 겹칠 수 있다."""
    p = os.path.join(MAP_DIR, sid + ".webp")
    if not route or not os.path.exists(p):
        return False
    with Image.open(p) as im:
        w, h = im.size
    return abs((w / h) / (route["w"] / route["h"]) - 1) < 0.02


def build(loc, suffix, routes):
    path = os.path.join(DATA, f"sandbox{suffix}.json")
    if not os.path.exists(path):
        path = os.path.join(DATA, "sandbox.json")
    v2 = load(path)["v2"]
    season = v2["name"]
    enemy_list, enemy_ix, enemy_names, enemy_img = [], {}, {}, {}
    stages = []
    for row in v2["stages"]:
        sid, code, name, desc, ap, ap2 = row[:6]
        route = routes.get(sid)
        if isinstance(route, str):
            route = routes.get(route)
        rec = {"id": sid, "code": code, "name": name, "t": "SANDBOX", "ev": 0, "z": 0, "sb": 1}
        if desc:
            rec["desc"] = desc
        rec["act"] = [ap, ap2]
        if os.path.exists(os.path.join(MAP_DIR, sid + ".webp")):
            rec["map"] = 1
            if ortho_ok(sid, route):
                rec["ortho"] = 1
        if route and route.get("sp") and route.get("wv"):
            rec["sim"] = 1
        # 등장 적 — [키, 초상키, 초상 출처(1=생존연산 폴더), 수, 단계, hp, atk, def, res]
        # (build-sandbox.py stageEnemies). 수치를 레코드가 직접 들고 간다(es) — 생존연산 전용 적은
        # 적 도감 스탯 색인에 없다. 초상도 경로를 덮어쓴다(enemyImg) — /ra 모달과 같은 규칙.
        e, es = [], []
        for en in v2["stageEnemies"].get(sid) or []:
            key, img, src, cnt, lv, hp, atk, df, res = en[:9]
            if key not in enemy_ix:
                enemy_ix[key] = len(enemy_list)
                enemy_list.append(key)
            enemy_names.setdefault(key, v2["enemyNames"].get(key) or v2["enemyNames"].get(img) or key)
            if src == 1:
                enemy_img[key] = f"/sandbox/enemy/{key}.webp"
            elif img and img != key:
                enemy_img[key] = f"/enemy/{img}.webp"
            e.append([enemy_ix[key], cnt, lv or 0])
            es.append([hp, atk, df, res])
        if e:
            rec["e"] = e
            rec["es"] = es
        stages.append(rec)
    return {
        "zones": [season], "events": [season], "items": {}, "occ": [], "kinds": [],
        "enemyIds": enemy_list, "types": {"SANDBOX": TYPE_LABEL[loc]},
        "enemyNames": enemy_names, "enemyImg": enemy_img, "stages": stages,
    }


def main():
    routes = load(os.path.join(DATA, "sandbox-routes.json"))
    for loc, suffix in LOCALES:
        doc = build(loc, suffix, routes)
        if loc == "ko":
            # /ra 지역 모달용 평면도 목록 — 그 페이지는 이 색인을 안 읽으므로 id 만 따로 (~2KB)
            ortho = sorted(s["id"] for s in doc["stages"] if s.get("ortho"))
            with open(os.path.join(DATA, "sandbox-ortho.json"), "w", encoding="utf-8") as f:
                json.dump(ortho, f, separators=(",", ":"))
        p = os.path.join(DATA, f"stages-sandbox{suffix}.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        st = doc["stages"]
        print(f"  {os.path.basename(p)}: 지역 {len(st)} · 평면도 {sum(1 for s in st if s.get('ortho'))} · "
              f"시뮬 {sum(1 for s in st if s.get('sim'))} · 적 {len(doc['enemyIds'])} · {os.path.getsize(p) // 1024}KB")


if __name__ == "__main__":
    main()
    sys.exit(0)
