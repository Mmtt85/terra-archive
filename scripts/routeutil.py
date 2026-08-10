# 적 이동 경로 추출 — 레벨 JSON 한 개 → 경로 지도 문서 (app/stage-route-map.tsx가 그린다).
#
# build-enemies.py(작전 도감 stage-routes.json)와 build-rogue-routes.py(통합전략
# rogue-routes.json)가 **공유하는 정본**이다 — 규칙을 고칠 곳은 여기 한 곳.
# 확정 규칙 전체는 .claude/skills/route-map-rules/SKILL.md 참조.
#
# 좌표계: 타일 행렬 g는 row 0 = 위(render_minimap 규약), 경로 좌표 r은 row 0 = 아래
# (게임 월드 원점이 좌하단) — 상하 반전은 렌더러(stage-route-map.tsx) 몫이다.


def routes_of_level(lv):
    """레벨 JSON → {h, w, g, r, f, e} 또는 None (격자·경로가 없으면).

    g: 행 문자열 배열 (타일 분류 문자), r: 경로별 [col,row] 꼭짓점 (null 자리 보존),
    f: 경로별 비행 플래그, e: 적 id → 경로 번호 목록.
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

    def tchar(t):
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
        walk = t.get("passableMask") in ("ALL", "WALK_ONLY")
        build = t.get("buildableType") or "NONE"
        if walk:
            return "r" if build in ("MELEE", "ALL") else "p"   # 도로 / 이동만(배치 불가)
        if build in ("MELEE", "ALL"):
            return "b"           # 배치만 — 이동 불가지만 지상 배치 가능 (펜스류)
        if t.get("heightType") in (1, "HIGHLAND"):
            return "w" if build == "RANGED" else "x"           # 고지대(원거리 배치) / 높은 장식
        return "f"               # 평지 장애물 — 이동·배치 불가
    g = ["".join(tchar(tdefs[c]) if 0 <= c < len(tdefs) else "f" for c in row) for row in grid]

    rts, fly = [], []
    for rt in lv.get("routes") or []:
        # ⚠ 자리를 지워선 안 된다 — waves가 routeIndex 번호로 가리킨다. 못 그리면 null.
        if not isinstance(rt, dict) or rt.get("motionMode") not in ("WALK", "FLY"):
            rts.append(None); fly.append(0)
            continue
        pts = ([rt.get("startPosition")]
               + [cp.get("position") for cp in rt.get("checkpoints") or []
                  if isinstance(cp, dict) and cp.get("type") == "MOVE"]
               + [rt.get("endPosition")])
        poly = [[p["col"], p["row"]] for p in pts if isinstance(p, dict)]
        rts.append(poly if len(poly) >= 2 else None)
        fly.append(1 if rt.get("motionMode") == "FLY" else 0)

    eroutes = {}

    def walk(actions):
        for a in actions or []:
            if a.get("actionType") in (0, "SPAWN") and a.get("key") and a.get("routeIndex") is not None:
                eroutes.setdefault(a["key"], set()).add(a["routeIndex"])
    for w in lv.get("waves") or []:
        for fg in w.get("fragments") or []:
            walk(fg.get("actions"))
    for b in (lv.get("branches") or {}).values():
        for ph in b.get("phases") or []:
            walk(ph.get("actions"))
    er = {k: sorted(i for i in v if 0 <= i < len(rts) and rts[i]) for k, v in eroutes.items()}
    er = {k: v for k, v in er.items() if v}
    if not any(rts):
        return None
    return {"h": len(g), "w": len(g[0]), "g": g, "r": rts, "f": fly, "e": er}
