#!/usr/bin/env python3
"""경로 주인 적의 이름·초상 보충 — 화면 이름표에 없는 적을 경로 문서가 직접 들고 간다 (`nm`).

## 왜 (사용자 제보 2026-09-23 "흑류수해 작전 시뮬레이터에 enemy_2133_shdopl_d 가 나온다")

경로 지도(app/stage-route-map.tsx)는 선·시뮬 말의 주인을 **화면의 이름표**(nameOf)·초상(imgOf)으로
찾는다. 그 이름표는 '등장 적' 목록(레벨 enemyDbRefs ∩ 도감에 보이는 적)이나 테마 적 사전이라, 경로에만
나오는 적은 이름이 없어 말풍선에 id 가 찍히고 말이 까맣게 빈다. 같은 날 전수 조사로 248종이 나왔다
(작전 도감·시뮬레이터 본 도감 152 · 통합전략 96 · 생존연산 8, /rogue 노드 98, /ra 3):
  · 189종 = 그 판 전용 변종 — enemyDbRefs 가 `useDb: false` 로 **이름과 모델(prefabKey)을 레벨 파일에
    직접 적는다** (`enemy_2133_shdopl_d` = 空植体(奇美拉), 모델 enemy_2133_shdopl). 원본 적 DB 에도
    도감에도 없다.
  · 59종 = 원본 DB(enemy_database) 적인데 도감에 없거나 그 판 목록에서 빠진 것.
그래서 레벨 파일·원본 DB 의 값을 그대로 옮겨 싣는다 (지어내지 않는다).

## 형식 — 레코드마다 nm: {적키: {p, n?, i?, ko?, en?, ja?}}  (화면 이름표 밖의 주인만)
  p         모델 키 — overwrittenData.prefabKey → DB 의 prefabKey → 자기 키
  n         그 판에서의 이름, **레벨 파일 언어 그대로** (한섭 레벨 = 한국어, 중섭 선행 = 중국어)
  i         초상 경로(public 기준) — 실제로 있는 파일만 싣는다
  ko/en/ja  모델 적의 현지 이름 — 도감·테마 사전에 있을 때만
고르는 규칙은 화면 쪽 app/stage-route-map.tsx `ownerName`.

사용:
  python3 scripts/routenames.py            # 경로 파일 4개에 제자리로 붙인다 (로컬 레벨 캐시·app/data 만 읽는다)
  python3 scripts/routenames.py rogue      # 하나만 (stage · rogue · sandbox · sandbox2)

빌더(build-enemies · build-rogue-routes · build-sandbox)도 경로 파일을 쓴 뒤 fix() 를 부른다.
CLI 는 빌더를 통째로 다시 돌리지 않고 nm 만 새로 붙일 때 쓴다 — 로컬 원본이 CI 보다 오래됐으면
빌더 전체 실행은 다른 데이터를 뒤로 돌린다 (PROJECT-GUIDE §2 카메라와 같은 사정).
"""
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "app", "data")
PUB = os.path.join(REPO, "public")
GD = os.path.join(REPO, ".gamedata")
LOCS = (("ko", ""), ("en", ".en"), ("ja", ".ja"))


def _load(p):
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _mv(x):
    return x.get("m_value") if isinstance(x, dict) and x.get("m_defined") else None


def _flat_db(doc):
    """enemy_database — 원본 {"enemies":[{Key,Value}]} · 캐시(평탄 {키: [단계별]}) 둘 다 받는다."""
    if isinstance(doc, dict) and isinstance(doc.get("enemies"), list):
        return {e.get("Key"): e.get("Value") or [] for e in doc["enemies"] if e.get("Key")}
    return doc or {}


def base_of(key):
    """변종 접미를 뗀 원본 id — enemy_2133_shdopl_d → enemy_2133_shdopl, enemy_1056_ganwar#1 → enemy_1056_ganwar"""
    m = re.match(r"^(enemy_\d+_[a-z0-9]+)", key or "")
    return m.group(1) if m else key


def portrait(keys, folders):
    """public 에 실제로 있는 첫 초상 경로. keys 는 우선순위 순(모델 키 → 자기 키), 각자 원본 id 로 한 번 더."""
    cands = []
    for k in keys:
        for c in (k, base_of(k)):
            if c and c not in cands:
                cands.append(c)
    for folder in folders:
        for c in cands:
            rel = f"/{folder}/{c}.webp"
            if os.path.exists(PUB + rel):
                return rel
    return None


def owner_names(lv, keys, known, enemy_db=None, img_of=None, names=None):
    """레벨 하나 — 경로 주인 keys 중 화면이 스스로 이름 붙이지 못하는(known 밖) 적의 nm 항목.
    names = {로케일: {적키: 이름}} — 모델 적의 현지 이름을 찾을 사전."""
    refs = {r.get("id"): r for r in (lv or {}).get("enemyDbRefs") or [] if r.get("id")}
    out = {}
    for k in keys:
        if k in known:
            continue
        ow = (refs.get(k) or {}).get("overwrittenData") or {}
        n, p = _mv(ow.get("name")), _mv(ow.get("prefabKey"))
        rows = (enemy_db or {}).get(k) or []
        ed = (rows[0] or {}).get("enemyData") if rows else None
        if ed:
            n = n or _mv(ed.get("name"))
            p = p or _mv(ed.get("prefabKey"))
        p = p or k
        row = {"p": p}
        if n:
            row["n"] = n
        img = img_of(p, k) if img_of else None
        if img:
            row["i"] = img
        for loc, tbl in (names or {}).items():
            v = tbl.get(p) or tbl.get(base_of(p))
            if v:
                row[loc] = v
        out[k] = row
    return out


def attach(doc, ctx_of, enemy_db, img_of, names):
    """경로 문서 전체 — ctx_of(sid) → (레벨 JSON, 화면이 아는 적 집합). 별칭(문자열)은 건너뛴다.
    반환: (nm 을 단 레코드 수, 항목 수)."""
    n_rec = n_key = 0
    for sid, rec in doc.items():
        if not isinstance(rec, dict):
            continue
        keys = list((rec.get("e") or {}).keys())
        lv, known = ctx_of(sid)
        nm = owner_names(lv, keys, known, enemy_db, img_of, names) if keys and lv else {}
        if nm:
            rec["nm"] = nm
            n_rec += 1
            n_key += len(nm)
        else:
            rec.pop("nm", None)
    return n_rec, n_key


def _names(*tables):
    """로케일별 {적키: 이름} — 앞의 사전이 이긴다. tables = [(로케일, {키: 이름}), …]"""
    out = {loc: {} for loc, _ in LOCS}
    for loc, tbl in tables:
        for k, v in (tbl or {}).items():
            if v:
                out[loc].setdefault(k, v)
    return out


def _dex_names():
    rows = []
    for loc, suf in LOCS:
        rows.append((loc, {e["id"]: e["name"] for e in _load(f"{DATA}/enemies{suf}.json") or []}))
    return rows


def _level(path):
    """레벨 캐시 한 판 — 빌더들과 같은 이름 규약(경로의 / → __)."""
    return _load(path)


def _cache_name(lid):
    return ("levels/" + lid.lower() + ".json").replace("/", "__")


# ── 문서별 배선 ─────────────────────────────────────────────────────────────
def _fix_stage():
    """본 도감 stage-routes.json — 이름표 = 그 판의 '등장 적'(레벨 enemyDbRefs ∩ 도감에 보이는 적,
    build-enemies.py 역색인과 같은 규칙)."""
    p = f"{DATA}/stage-routes.json"
    doc = _load(p)
    tbl = _load(f"{GD}/kr_stage_table.json") or {}
    stages = tbl.get("stages", tbl)
    visible = {e["id"] for e in _load(f"{DATA}/enemies.json") or [] if not e.get("hid")}

    def ctx(sid):
        lid = ((stages.get(sid) or {}).get("levelId") or "")
        lv = _level(os.path.join(GD, "levels", _cache_name(lid))) if lid else None
        refs = {r.get("id") for r in (lv or {}).get("enemyDbRefs") or []}
        return lv, refs & visible
    db = _flat_db(_load(f"{GD}/levels__enemydata__enemy_database.json"))
    res = attach(doc, ctx, db, lambda pf, k: portrait([pf, k], ["enemy"]), _names(*_dex_names()))
    return p, doc, res


def _fix_rogue():
    """통합전략 rogue-routes.json — 이름표 = 그 노드의 등장 적 ∩ 테마 적 사전 (/rogue 모달·작전 도감 공통).
    레벨은 build-rogue-routes.py 와 같은 순서(KR 표 먼저, 없으면 CN — rogue_6 은 CN 레벨이라 이름이 중국어)."""
    p = f"{DATA}/rogue-routes.json"
    doc = _load(p)
    kr = (_load(f"{GD}/rogue/excel__roguelike_topic_table.json") or {}).get("details") or {}
    cn = (_load(f"{GD}/rogue/cn__excel__roguelike_topic_table.json") or {}).get("details") or {}
    lvl = {}
    for branch, det in (("kr", kr), ("cn", cn)):
        for tid, t in det.items():
            if not tid.startswith("rogue_"):
                continue
            for s in (t.get("stages") or {}).values():
                sid, lid = s.get("id"), s.get("levelId")
                if sid and lid and sid not in lvl:
                    lvl[sid] = (branch, lid)
    themes, stage_keys, imgs, tables = {}, {}, {}, []
    for n in range(1, 7):
        for loc, suf in LOCS:
            d = _load(f"{DATA}/rogue{n}{suf}.json")
            if not d:
                continue
            tables.append((loc, {k: e.get("name") for k, e in (d.get("enemies") or {}).items()}))
            if loc != "ko":
                continue
            themes[n] = set((d.get("enemies") or {}).keys())
            for k, e in (d.get("enemies") or {}).items():
                if e.get("img"):
                    imgs.setdefault(k, e["img"])
            for s in d.get("stages") or []:
                stage_keys[s["id"]] = {se["key"] for se in s.get("enemies") or []}

    def ctx(sid):
        b = lvl.get(sid)
        lv = _level(os.path.join(GD, "rogue", ("" if b[0] == "kr" else "cn__") + _cache_name(b[1]))) if b else None
        m = re.match(r"^ro(\d+)_", sid)
        theme = themes.get(int(m.group(1)), set()) if m else set()
        refs = stage_keys.get(sid)
        if refs is None:
            refs = {r.get("id") for r in (lv or {}).get("enemyDbRefs") or []}
        return lv, refs & theme

    def img_of(pf, k):
        for c in (pf, base_of(pf), k):
            if imgs.get(c) and os.path.exists(f"{PUB}/rogue/enemy/{imgs[c]}.webp"):
                return f"/rogue/enemy/{imgs[c]}.webp"
        return portrait([pf, k], ["rogue/enemy", "enemy"])
    db = _flat_db(_load(f"{GD}/cn__levels__enemydata__enemy_database.json"))
    db.update(_flat_db(_load(f"{GD}/levels__enemydata__enemy_database.json")))   # KR 이 정본, CN 은 보충
    res = attach(doc, ctx, db, img_of, _names(*tables, *_dex_names()))
    return p, doc, res


def _sandbox_names(season):
    rows = []
    for loc, suf in LOCS:
        d = _load(f"{DATA}/sandbox{suf}.json") or {}
        rows.append((loc, (d.get(season) or {}).get("enemyNames") or {}))
    return rows


def _fix_sandbox():
    """생존연산 사막 이야기 sandbox-routes.json — 이름표 = 그 지역의 등장 적 행(stageEnemies, /ra·작전 도감 공통)."""
    p = f"{DATA}/sandbox-routes.json"
    doc = _load(p)
    kr = _load(f"{GD}/kr_sandbox_perm_table.json") or {}
    stages = ((kr.get("detail") or {}).get("SANDBOX_V2") or {}).get("sandbox_1", {}).get("stageData") or {}
    lid_of = {s.get("stageId"): s.get("levelId") for s in stages.values()}
    rows = ((_load(f"{DATA}/sandbox.json") or {}).get("v2") or {}).get("stageEnemies") or {}

    def ctx(sid):
        lid = lid_of.get(sid) or ""
        lv = _level(os.path.join(GD, _cache_name(lid))) if lid else None
        return lv, {r[0] for r in rows.get(sid) or []}
    db = _flat_db(_load(f"{GD}/levels__enemydata__enemy_database.json"))
    res = attach(doc, ctx, db, lambda pf, k: portrait([pf, k], ["enemy", "sandbox/enemy"]),
                 _names(*_sandbox_names("v2"), *_dex_names()))
    return p, doc, res


def _fix_sandbox2():
    """생존연산 신시즌(재기동 앵커, CN 선행) sandbox2-routes.json — 이름표 = 그 전투 지형의 적(foes)."""
    p = f"{DATA}/sandbox2-routes.json"
    doc = _load(p)
    cn = _load(f"{GD}/cn_sandbox_perm_table.json") or {}
    subs = ((cn.get("detail") or {}).get("SANDBOX_V3") or {}).get("sandbox_2", {}).get("subStageData") or {}
    lid_of = {s.get("subStageId"): s.get("levelId") for s in subs.values()}
    foes = {s["id"]: {r[0] for r in s.get("foes") or []}
            for s in (((_load(f"{DATA}/sandbox.json") or {}).get("v3") or {}).get("subs") or [])}

    def ctx(sid):
        lid = lid_of.get(sid) or ""
        lv = _level(os.path.join(GD, "cn__" + _cache_name(lid))) if lid else None
        return lv, foes.get(sid, set())
    db = _flat_db(_load(f"{GD}/cn__levels__enemydata__enemy_database.json"))
    res = attach(doc, ctx, db, lambda pf, k: portrait([pf, k], ["enemy", "sandbox/enemy"]),
                 _names(*_sandbox_names("v3"), *_dex_names()))
    return p, doc, res


FIXERS = {"stage": _fix_stage, "rogue": _fix_rogue, "sandbox": _fix_sandbox, "sandbox2": _fix_sandbox2}


def fix(which=None):
    """경로 파일에 nm 을 제자리로 붙인다 — 빌더들이 경로 파일을 쓴 뒤 부른다."""
    for name in which or FIXERS:
        p, doc, (n_rec, n_key) = FIXERS[name]()
        if doc is None:
            print(f"  ⚠ {os.path.basename(p)} 없음 — 건너뜀")
            continue
        json.dump(doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"  {os.path.basename(p)}: 이름표 밖 경로 주인 {n_key}건 · 레코드 {n_rec}개 (nm)")


if __name__ == "__main__":
    fix([a for a in sys.argv[1:] if a in FIXERS] or None)
