"""게임 도감에 안 보이는 적 변형 → 도감에 보이는 본체 (2026-09-29).

벡터 돌파 #3(act3break, 중섭 선행)의 보스는 작전마다 수치만 다른 **숨김 변형**으로만 나온다 —
`enemy_8018_etouch_1`(VEC-04) · `_2`(VEC-08) · `_3`(VEC-12·VEC-D), `enemy_8016_misery_3`(VEC-C).
전부 `hideInHandbook` 이고 도감에 보이는 건 본체(`enemy_8018_etouch`) 하나다. 그대로 두면 이벤트 창
적 목록에 같은 'Touch' 가 세 번 찍히고, 한섭 도감에도 숨김으로 있는 미저리 변형은 어느 도감에도 없어
눌러도 창이 안 뜬다. 도감 표에 아예 없는 레벨 전용 개체(`enemy_7010_bldrgn_b`)도 같은 처지다.

본 도감(build-enemies.py VISIBLE)은 숨김 적을 통째로 뺀다 — 게임 도감 표기를 따르는 규칙이다.
미래시(build-events.py 미래시 행 · build-future-dex.py)는 그 규칙을 지키되 **본체로 접는다**:
본체가 있으면 본체 id 로, 없으면 None(목록에서 뺀다). 작전별 수치는 호출부가 변형 id 로 따로 싣는다.

⚠ **끝 조각만 떼면 틀린다** (실측): `enemy_8019_pollut_3` 은 레벨 데이터 이름이 "过灌注" 라
  `_2`(과관류)의 변형인데, 떼면 `enemy_8019_pollut`(재관류)로 간다. `enemy_1597_agbbms` 는 이름이
  "酣酣睡飞行员" 인 `enemy_1595_agbmes` 의 변형인데 id 줄기부터 다르다. 그래서 도감 표에 없는 id 는
  레벨 데이터(enemy_database)의 이름을 받아 **이름으로 본체를 확인·검색**한다 (db_name).
"""
import re

_TAIL = re.compile(r"^(enemy_\d+_[a-z0-9]+(?:_[a-z0-9]+)*)_[a-z0-9]+$")


def _nm(v):
    return ((v or {}).get("name") or "").strip()


def visible(eid, book, db_name=None):
    """eid 가 도감에 보이면 그대로, 숨김·표에 없는 변형이면 보이는 본체, 못 찾으면 None.

    book = 그 서버의 enemy_handbook_table["enemyData"], db_name = 레벨 데이터의 그 id 이름(있으면).
    ① 끝 조각을 하나씩 떼며 올라가 **이름이 같은**(이름을 모르면 아무) 보이는 본체.
    ② 없으면 이름이 같은 보이는 항목 — 하나뿐이거나, 같은 번호(enemy_<번호>_)로 하나일 때만."""
    v = book.get(eid)
    if v is not None and not v.get("hideInHandbook"):
        return eid
    name = _nm(v) or (db_name or "").strip()
    cur = eid
    for _ in range(3):
        m = _TAIL.match(cur)
        if not m:
            break
        cur = m.group(1)
        b = book.get(cur)
        if b is None or b.get("hideInHandbook"):
            continue
        if not name or _nm(b) == name:
            return cur
        break                      # 이름이 다른 본체 — 이름으로 찾는다
    if not name:
        return None
    same = [k for k, b in book.items() if not b.get("hideInHandbook") and _nm(b) == name]
    if len(same) == 1:
        return same[0]
    num = re.match(r"enemy_(\d+)_", eid)
    near = [k for k in same if num and k.startswith(f"enemy_{num.group(1)}_")]
    return near[0] if len(near) == 1 else None


_db_names = None


def db_names(server="cn"):
    """레벨 데이터(enemy_database)의 {적 id: 이름} — 도감 표에 없는 변형의 이름. 못 받으면 {}."""
    global _db_names
    if _db_names is not None:
        return _db_names
    _db_names = {}
    try:
        import cdnlevels
        db = cdnlevels.level("levels/enemydata/enemy_database", schema="enemy_database", server=server)
    except Exception:
        db = None
    if isinstance(db, list):
        db = {e["Key"]: e["Value"] for e in db if isinstance(e, dict) and "Key" in e}
    for k, rows in (db or {}).items():
        for r in rows or []:
            n = (r.get("enemyData") or {}).get("name")
            n = n.get("m_value") if isinstance(n, dict) and n.get("m_defined") else (n if isinstance(n, str) else None)
            if n:
                _db_names[k] = n
                break
    return _db_names
