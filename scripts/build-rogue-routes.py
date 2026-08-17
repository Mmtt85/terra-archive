#!/usr/bin/env python3
"""통합전략 전투 노드의 적 이동 경로 — app/data/rogue-routes.json (사용자 요청 2026-08-10
"모든 로그라이크 작전 노드에도 다 동일하게 적용").

사용:
  python3 scripts/build-rogue-routes.py

작전 도감의 stage-routes.json과 같은 문서 형식이라 렌더러(app/stage-route-map.tsx)를
그대로 쓴다. 추출 로직 정본은 scripts/routeutil.py — 규칙은 .claude/skills/route-map-rules.

- 소스: roguelike_topic_table의 스테이지 → levelId → levels/<id>.json.
  KR에 있는 토픽(rogue_1~5)은 KR 데이터, KR 미출시 토픽(rogue_6 침몰자의 블랙플로우)은
  CN 선행 데이터를 쓴다. KR 토픽이라도 CN에만 추가된 스테이지가 있으면 CN에서 보충한다
  (rogueN.cn.json 중국섭 탭이 같은 스테이지 id를 쓰므로 한 벌로 양쪽을 다 감당한다).
- 레벨 캐시는 build-rogue.py와 같은 .gamedata/rogue/ 를 공유한다 — build-rogue.py를
  돌린 적이 있으면 네트워크 없이 끝난다.
- 일반/긴급 노드는 같은 levelId를 공유한다 → 두 번째부터는 **별칭 문자열**(첫 스테이지
  id)로 저장해 파일을 반으로 줄인다. 클라이언트(app/rogue.tsx)가 한 단계 풀어 읽는다.

출력: app/data/rogue-routes.json  { "<stageId>": {h,w,g,r,f,e} | "<별칭 stageId>" }
"""
import json, os, sys, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
CACHE = os.path.join(REPO, ".gamedata", "rogue")
os.makedirs(CACHE, exist_ok=True)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from routeutil import routes_of_level  # noqa: E402


def fetch_json(path, branch="kr"):
    """build-rogue.py fetch_json과 같은 캐시 규약 (.gamedata/rogue, cn은 cn__ 접두)."""
    prefix = "" if branch == "kr" else f"{branch}__"
    cache = os.path.join(CACHE, prefix + path.replace("/", "__"))
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    url = f"{GAMEDATA}/{branch}/gamedata/{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req).read()
    open(cache, "wb").write(raw)
    return json.loads(raw)


def main():
    kr = fetch_json("excel/roguelike_topic_table.json")["details"]
    cn = fetch_json("excel/roguelike_topic_table.json", "cn")["details"]
    # 적 이동속도 출처 — 시뮬레이션용 (routeutil docstring 참조). KR 캐시가 정본이고,
    # CN 선행 토픽(rogue_6)의 CN 전용 적은 CN 사본이 있으면 겹쳐 보충한다.
    def flat_db(doc):
        """원본은 {"enemies":[{Key,Value}]}, build-rogue.py 캐시본은 이미 평탄 — 둘 다 받는다."""
        if isinstance(doc, dict) and isinstance(doc.get("enemies"), list):
            return {e.get("Key"): e.get("Value") or [] for e in doc["enemies"] if e.get("Key")}
        return doc or {}
    enemy_db = flat_db(fetch_json("levels/enemydata/enemy_database.json"))
    cn_db_path = os.path.join(CACHE, "cn__levels__enemydata__enemy_database.json")
    if os.path.exists(cn_db_path):
        cn_db = flat_db(json.load(open(cn_db_path, encoding="utf-8")))
        enemy_db = {**cn_db, **enemy_db}

    out = {}                 # stageId → 경로 문서 | 별칭 stageId
    owner = {}               # (branch, levelId) → 문서를 가진 stageId
    stats = {}               # topicId → [스테이지 수, 경로 있음]

    def add(topic_id, stages, branch):
        st = stats.setdefault(topic_id, [0, 0])
        for s in stages.values():
            sid, lid = s.get("id"), (s.get("levelId") or "").lower()
            if not sid or not lid or sid in out:
                continue
            st[0] += 1
            key = (branch, lid)
            if key in owner:
                out[sid] = owner[key]      # 같은 레벨(일반/긴급 페어 등) → 별칭
                st[1] += 1
                continue
            try:
                doc = routes_of_level(fetch_json(f"levels/{lid}.json", branch), enemy_db)
            except Exception:              # 레벨 파일 없음(삭제·미배포) — 건너뜀
                doc = None
            if doc:
                out[sid] = doc
                owner[key] = sid
                st[1] += 1

    for tid, r in kr.items():
        if tid.startswith("rogue_"):
            add(tid, r["stages"], "kr")
    for tid, r in cn.items():
        if tid.startswith("rogue_"):       # KR 미출시 토픽 전체 + KR 토픽의 CN 전용 추가분
            add(tid, r["stages"], "cn")

    p = os.path.join(REPO, "app", "data", "rogue-routes.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    for tid, (n, ok) in sorted(stats.items()):
        print(f"  {tid}: 스테이지 {n} · 경로 {ok}")
    print(f"완료 — rogue-routes.json {os.path.getsize(p)//1024}KB (항목 {len(out)})")


if __name__ == "__main__":
    main()
