# 적 이동 경로 추출 — 레벨 JSON 한 개 → 경로 지도 문서 (app/stage-route-map.tsx가 그린다).
#
# build-enemies.py(작전 도감 stage-routes.json)와 build-rogue-routes.py(통합전략
# rogue-routes.json)가 **공유하는 정본**이다 — 규칙을 고칠 곳은 여기 한 곳.
# 확정 규칙 전체는 .claude/skills/route-map-rules/SKILL.md 참조.
#
# 좌표계: 타일 행렬 g는 row 0 = 위(render_minimap 규약), 경로 좌표 r은 row 0 = 아래
# (게임 월드 원점이 좌하단) — 상하 반전은 렌더러(stage-route-map.tsx) 몫이다.


def _mv(field, default=None):
    """enemy_database의 {m_defined, m_value} 언랩 (build-enemies.py mv와 동일 규약)."""
    if isinstance(field, dict) and "m_defined" in field:
        return field["m_value"] if field["m_defined"] else default
    return field if field is not None else default


def tile_char(t):
    # 통행(passableMask)·배치(buildableType)·높이(heightType)로 분류한다
    # (사용자 요청 2026-08-10 "이동불가·배치불가 … 다 구분 가능하게").
    # tileKey 이름 추측보다 속성이 정확하다 — 예: tile_fence는 '배치만 되는' 타일.
    key = t.get("tileKey") or ""
    if key in ("tile_start", "tile_flystart"):
        return "s"           # 적 출현 (게임 표기 빨강)
    if key == "tile_end":
        return "e"           # 방어 목표 (게임 표기 파랑)
    if key == "tile_hole":
        return "h"           # 구멍 — 비행만 통과
    if key == "tile_telin":
        return "i"           # 통로 입구 — 적이 들어가 출구로 순간이동 (2026-08-10)
    if key == "tile_telout":
        return "o"           # 통로 출구
    # 물 — 생존연산은 여기에 '수상 플랫폼'을 놓아야 오퍼레이터를 배치할 수 있다
    # (사용자 제보 2026-08-12). 일반 작전의 얕은 물도 같은 문자로 구분해 보여준다.
    if key in ("tile_xbdpsea", "tile_puddle", "tile_water"):
        return "u"
    if key == "tile_deepwater":
        return "d"           # 깊은 물 — 비행만 통과
    walk = t.get("passableMask") in ("ALL", "WALK_ONLY")
    build = t.get("buildableType") or "NONE"
    if walk:
        return "r" if build in ("MELEE", "ALL") else "p"   # 도로 / 이동만(배치 불가)
    if build in ("MELEE", "ALL"):
        return "b"           # 배치만 — 이동 불가지만 지상 배치 가능 (펜스류)
    if t.get("heightType") in (1, "HIGHLAND"):
        return "w" if build == "RANGED" else "x"           # 고지대(원거리 배치) / 높은 장식
    return "f"               # 평지 장애물 — 이동·배치 불가


def grid_of_level(lv):
    """레벨 JSON → {h, w, g} (타일 격자만). 적 경로가 하나도 없는 지형에도 도면은 그린다
    — 생존연산 신시즌의 자원 전용 지형이 그 경우다 (2026-08-12).
"""
    md = (lv or {}).get("mapData") or {}
    grid = md.get("map") or []
    tdefs = md.get("tiles") or []
    if isinstance(grid, dict):
        flat = grid.get("matrix_data") or []
        cn = grid.get("column_size") or 0
        grid = [flat[i:i + cn] for i in range(0, len(flat), cn)] if cn else []
    if not grid or not tdefs:
        return None
    g = ["".join(tile_char(tdefs[c]) if 0 <= c < len(tdefs) else "f" for c in row) for row in grid]
    return {"h": len(g), "w": len(g[0]), "g": g, "r": [], "f": [], "e": {}}


# 경로를 그리지 않는 적 — 레벨 파일엔 SPAWN 경로가 붙어 있지만 실제로는 걷지 않고 **조건을 맞춘 오퍼레이터
# 머리 위로 떨어지는** 기믹 적이다 (사용자 지시 2026-09-25: 쉐이의 기이한 계원 '쉐이의 몸' — 거의 전 작전 —
# 과 6층 보스 작전의 '쉐이'). 여기서 빼면 e 에서 빠지므로 경로선(렌더러는 e 가 스폰하는 경로만 그린다)과
# 시뮬레이션 말(sp 는 e 의 적만 싣는다)이 함께 사라진다. 등장 적 카드는 '경로 없음'으로 남는다.
DROP_IN_ENEMIES = {"enemy_2119_dyshhj_2", "enemy_2119_dyshhj"}


def routes_of_level(lv, enemy_db=None):
    """레벨 JSON → {h, w, g, r, f, e[, sp, wv, cw, mm]} 또는 None (격자·경로가 없으면).

    g: 행 문자열 배열 (타일 분류 문자), r: 경로별 [col,row] 꼭짓점 (null 자리 보존),
    f: 경로별 비행 플래그, e: 적 id → 경로 번호 목록.
    ⚠ r 은 **routes + extraRoutes 를 이어 붙인 것**이다. 웨이브의 routeIndex 는 앞쪽(routes)을,
      브랜치(기믹 소환)의 routeIndex 는 뒤쪽(extraRoutes)을 가리킨다 — 자세한 근거는 아래 주석.

    시뮬레이션 확장 (사용자 요청 2026-08-10 "시뮬레이트 버튼") — enemy_db(평탄화된
    enemy_database: 적id → 레벨 레코드[])를 주면 이동속도까지 실어 준다.
    ⚠ 용량 규칙: 적 id는 문자열 반복 대신 **e의 키 순서 번호**로 싣는다 (72,806 액션 ×
      평균 17자 문자열이 그대로 1MB였다 — 2026-08-10 실측 후 인덱스화).
      sp: 스폰 목록 [웨이브번호, 웨이브 내 시각(조각+액션 preDelay), 경로번호, 마릿수,
          간격초, 적번호(e 키 순서), 조각 preDelay] — waves만. branches(조건부 증원)는
          시작 시각이 데이터로 확정되지 않아 제외한다 (재생 화면에서 고지).
      ems: e 키 순서대로 그 적의 이동속도(타일/초) — enemyDbRefs 레벨·오버라이드 반영.
      wv: 웨이브별 [preDelay, postDelay, maxTimeWaitingForNextWave].
      cw: {경로번호: [[원본 꼭짓점 번호, 초, 모드], …]} — 모드 0=고정 대기,
          1=조각 시계 T까지, 2=웨이브 시계 T까지. 대기 있는 경로만 (희소 사전).
      mm: 레벨 전역 이동속도 배율 (1이면 생략).
    """
    if not lv:
        return None
    md = lv.get("mapData") or {}
    grid = md.get("map") or []
    tdefs = md.get("tiles") or []
    if isinstance(grid, dict):   # 신형 {row_size, column_size, matrix_data} (render_minimap과 동일 처리)
        flat = grid.get("matrix_data") or []
        cn = grid.get("column_size") or 0
        grid = [flat[i:i + cn] for i in range(0, len(flat), cn)] if cn else []
    if not grid or not tdefs:
        return None

    g = ["".join(tile_char(tdefs[c]) if 0 <= c < len(tdefs) else "f" for c in row) for row in grid]

    rts, fly, waits = [], [], []

    def add_route(rt):
        # ⚠ 자리를 지워선 안 된다 — waves가 routeIndex 번호로 가리킨다. 못 그리면 null.
        if not isinstance(rt, dict) or rt.get("motionMode") not in ("WALK", "FLY"):
            rts.append(None); fly.append(0); waits.append(None)
            return
        # 경유 대기 — 폴리라인의 k번째 꼭짓점(start=0) **도착 후**의 대기.
        # WAIT_*는 MOVE 사이에 끼어 있으므로 직전 꼭짓점 번호에 단다.
        # ⚠ cw의 번호가 poly 번호와 어긋나지 않게, 좌표가 없는 항목은 pts에 아예 안 넣는다.
        pts, cw = [], []
        if isinstance(rt.get("startPosition"), dict):
            pts.append(rt["startPosition"])
        for cp in rt.get("checkpoints") or []:
            if not isinstance(cp, dict):
                continue
            t = cp.get("type")
            if t == "MOVE":
                if isinstance(cp.get("position"), dict):
                    pts.append(cp["position"])
            elif t in ("WAIT_FOR_SECONDS", "WAIT_CURRENT_FRAGMENT_TIME", "WAIT_CURRENT_WAVE_TIME") \
                    and (cp.get("time") or 0) > 0 and pts:
                mode = {"WAIT_FOR_SECONDS": 0, "WAIT_CURRENT_FRAGMENT_TIME": 1, "WAIT_CURRENT_WAVE_TIME": 2}[t]
                cw.append([len(pts) - 1, round(cp["time"], 2), mode])
        if isinstance(rt.get("endPosition"), dict):
            pts.append(rt["endPosition"])
        poly = [[p["col"], p["row"]] for p in pts]
        rts.append(poly if len(poly) >= 2 else None)
        fly.append(1 if rt.get("motionMode") == "FLY" else 0)
        waits.append(cw or None)

    for rt in lv.get("routes") or []:
        add_route(rt)
    # ⚠ **기믹 소환(branches)의 routeIndex 는 routes 가 아니라 `extraRoutes` 를 가리킨다.**
    #   2026-09-13 제보로 발견 — IS-EX 의 '패밀리 어둠의 멸살자'가 빨간 출현칸이 아니라
    #   엉뚱한 이동 타일에서 시작하는 것으로 그려졌다. 같은 0번이라도 웨이브는 routes[0],
    #   브랜치는 extraRoutes[0] 이라 남의 경로(리무진·시민 것)를 덮어 쓰고 있었다.
    #   전수 검증: 브랜치 SPAWN 2,367건이 100% extraRoutes 범위 안, 웨이브 65,861건이
    #   100% routes 범위 안 — 예외 0건이라 배열로 가르는 것이 안전하다.
    #   기존 번호를 깨지 않으려고 **뒤에 이어 붙이고** 브랜치만 이 오프셋을 더해 가리킨다
    #   (앞에 끼워 넣으면 waves 의 routeIndex 가 통째로 밀린다).
    xoff = len(rts)
    for rt in lv.get("extraRoutes") or []:
        add_route(rt)

    eroutes = {}

    def walk(actions, off=0):
        """off — 이 액션들의 routeIndex 가 가리키는 배열의 시작 번호.
        웨이브는 routes(0), 브랜치는 extraRoutes(xoff). 위 주석 참조."""
        for a in actions or []:
            if a.get("actionType") in (0, "SPAWN") and a.get("key") and a.get("routeIndex") is not None \
                    and a["key"] not in DROP_IN_ENEMIES:
                eroutes.setdefault(a["key"], set()).add(off + a["routeIndex"])
    for w in lv.get("waves") or []:
        for fg in w.get("fragments") or []:
            walk(fg.get("actions"))
    for b in (lv.get("branches") or {}).values():
        for ph in b.get("phases") or []:
            walk(ph.get("actions"), xoff)
    er = {k: sorted(i for i in v if 0 <= i < len(rts) and rts[i]) for k, v in eroutes.items()}
    er = {k: v for k, v in er.items() if v}
    if not any(rts):
        return None
    doc = {"h": len(g), "w": len(g[0]), "g": g, "r": rts, "f": fly, "e": er}

    # ── 시뮬레이션 확장 — 위 docstring 참조 ────────────────────────────────
    def ms_for(key):
        """이 레벨에서 그 적의 이동속도(타일/초) — enemyDbRefs의 레벨·오버라이드 반영."""
        ref = next((x for x in lv.get("enemyDbRefs") or [] if x.get("id") == key), None)
        ms = None
        if ref:
            ov = ((ref.get("overwrittenData") or {}).get("attributes") or {}).get("moveSpeed")
            ms = _mv(ov)
            if ms is None and enemy_db:
                recs = enemy_db.get(key) or []
                rec = next((r for r in recs if r.get("level", 0) == (ref.get("level") or 0)), recs[0] if recs else None)
                if rec:
                    ms = _mv(((rec.get("enemyData") or {}).get("attributes") or {}).get("moveSpeed"))
        return round(ms, 3) if isinstance(ms, float) else (ms if ms else 1)

    kidx = {k: i for i, k in enumerate(er)}
    sp, wv = [], []
    for wi, w in enumerate(lv.get("waves") or []):
        mtw = w.get("maxTimeWaitingForNextWave")
        wv.append([round(w.get("preDelay") or 0, 2), round(w.get("postDelay") or 0, 2),
                   round(mtw, 2) if isinstance(mtw, (int, float)) else -1])
        for fg in w.get("fragments") or []:
            fpre = round(fg.get("preDelay") or 0, 2)
            for a in fg.get("actions") or []:
                if a.get("actionType") in (0, "SPAWN") and a.get("key") and a.get("routeIndex") is not None:
                    ri, ki = a["routeIndex"], kidx.get(a["key"])
                    if ki is None or not (0 <= ri < len(rts) and rts[ri]):
                        continue
                    sp.append([wi, round(fpre + (a.get("preDelay") or 0), 2), ri,
                               a.get("count") or 1, round(a.get("interval") or 0, 2), ki, fpre])
    if sp:
        doc["sp"] = sp
        doc["wv"] = wv
        doc["ems"] = [ms_for(k) for k in er]
        cw = {str(i): v for i, v in enumerate(waits) if v}
        if cw:
            doc["cw"] = cw
        mmul = (lv.get("options") or {}).get("moveMultiplier")
        if isinstance(mmul, (int, float)) and mmul not in (0, 1):
            doc["mm"] = round(mmul, 3)
    return doc
