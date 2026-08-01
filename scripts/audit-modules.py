#!/usr/bin/env python3
"""모듈 전수 검사 — 갱신할 때마다 모듈 현황이 온전한지 훑는다 (사용자 요청 2026-08-01).

Usage: python3 scripts/audit-modules.py [gamedata-dir]   # default: .gamedata

왜 필요한가: 2026-07-31 중섭 패치에서 피아메타에게 **통합전략 전용 모듈(ISW-A)**이 붙었는데
사이트는 그걸 몰랐다. `regen-operators`가 KR 오퍼는 KR uniequip 테이블만 보기 때문에,
**이미 실장된 오퍼에 CN에서만 추가된 모듈**은 통째로 빠진다. 신규 오퍼는 눈에 띄지만
기존 오퍼에 조용히 붙는 모듈은 아무도 모르고 지나간다 — 그래서 매 갱신마다 훑는다.

검사 항목
  1. 미래 모듈  — KR 실장 오퍼인데 CN에만 있는 모듈 (곧 KR에 올 것)
  2. 누락       — KR 테이블에 있는데 operators.json에 없는 모듈 (파서 회귀)
  3. 유령       — operators.json에 있는데 어느 테이블에도 없는 모듈
  4. 빈 내용    — 스탯·효과가 둘 다 비어 파싱이 실패한 모듈
  5. 특수 모듈  — 통합전략(ISW/SO)·생존연산(RA) 전용 모듈 현황

종료 코드는 항상 0 — 리포트용이라 파이프라인을 죽이지 않는다. 경고는 stderr로 낸다.
"""
import json
import os
import sys
from collections import Counter, defaultdict

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load = lambda p: json.load(open(p, encoding="utf-8"))

ops = {o["id"]: o for o in load(f"{REPO}/app/data/operators.json")}


def table(prefix):
    p = f"{S}/{prefix}_uniequip_table.json"
    if not os.path.exists(p):
        return {}, {}
    t = load(p)
    return t.get("equipDict") or {}, t.get("charEquip") or {}


kr_eq, kr_ce = table("kr")
cn_eq, cn_ce = table("cn")

# ORIGINAL(기본 장비)은 모듈이 아니다 — regen-operators와 같은 기준
real = lambda eq: eq.get("typeName1") != "ORIGINAL"
mtype = lambda eq: (eq.get("typeName1") or "") + ("-" + eq["typeName2"] if eq.get("typeName2") else "")


def mods_of(cid, eq, ce):
    return [eq[i] for i in (ce.get(cid) or []) if i in eq and real(eq[i])]


lines = []
warn = []

# ── 1. 미래 모듈 (KR 실장 오퍼 + CN에만 있는 모듈) ──────────────────────────
future = []
for cid, op in ops.items():
    if op.get("unreleased"):
        continue
    have = {e["uniEquipId"] for e in mods_of(cid, kr_eq, kr_ce)}
    for e in mods_of(cid, cn_eq, cn_ce):
        if e["uniEquipId"] not in have:
            future.append((op["name"], e.get("uniEquipName"), mtype(e)))
# 2026-08-01부터 미래 모듈은 operators.json에 unreleased로 실려 '미래시 포함' 토글에 걸린다.
# 그래도 계속 세어 둔다 — 새로 붙은 게 있으면 번역이 필요하기 때문이다.
site_future = sum(1 for o in ops.values() for m in (o.get("modules") or []) if m.get("unreleased"))
if future:
    warn.append(f"미래 모듈(KR 실장 오퍼 · CN 선행) {len(future)}건 · 사이트 수록 {site_future}건")
    for n, en, t in sorted(future):
        lines.append(f"  [미래] {n}: {en} ({t})")

# ── 2·3. 사이트 ↔ 테이블 대조 ───────────────────────────────────────────────
missing, ghost = [], []
for cid, op in ops.items():
    src = cn_eq if op.get("unreleased") else kr_eq
    srcce = cn_ce if op.get("unreleased") else kr_ce
    # ⚠ 이름으로 비교하면 안 된다 — 미실장 오퍼의 모듈 이름은 operators.json에서 **번역돼**
    #   있어 원문과 절대 안 맞는다(첫 판에서 15건이 통째로 오탐이었다). id로 대조한다.
    want = {e["uniEquipId"]: e.get("uniEquipName") for e in mods_of(cid, src, srcce)}
    # 실장 오퍼의 **미래 모듈**(CN 선행)은 unreleased 표시로 정상 수록된 것이다 — 유령이 아니다.
    cn_ids = {e["uniEquipId"] for e in mods_of(cid, cn_eq, cn_ce)}
    got = {m.get("id"): m for m in (op.get("modules") or [])}
    for i in want.keys() - got.keys():
        missing.append((op["name"], want[i]))
    for i in got.keys() - want.keys():
        m = got[i]
        if i in cn_ids and m.get("unreleased"):
            continue                       # 미래 모듈 — 1번 항목에서 이미 센다
        if i in cn_ids and not m.get("unreleased"):
            warn.append(f"미래 모듈인데 unreleased 표시가 없다: {op['name']} / {m.get('name')}")
            continue
        ghost.append((op["name"], m.get("name") or i))
if missing:
    warn.append(f"누락 모듈 {len(missing)}건 — 테이블엔 있는데 operators.json에 없다 (파서 회귀 의심)")
    for n, en in sorted(missing)[:20]:
        lines.append(f"  [누락] {n}: {en}")
if ghost:
    warn.append(f"유령 모듈 {len(ghost)}건 — operators.json에만 있다")
    for n, en in sorted(ghost)[:20]:
        lines.append(f"  [유령] {n}: {en}")

# ── 4. 빈 내용 ──────────────────────────────────────────────────────────────
empty = []
for op in ops.values():
    for m in op.get("modules") or []:
        levels = m.get("levels") or []
        if not levels or all(not (lv.get("stats") or "").strip() and not (lv.get("effects") or []) for lv in levels):
            empty.append((op["name"], m.get("name")))
if empty:
    warn.append(f"내용이 빈 모듈 {len(empty)}건 — 스탯·효과가 둘 다 비었다")
    for n, en in sorted(empty)[:20]:
        lines.append(f"  [빈칸] {n}: {en}")

# ── 5. 특수 모듈 현황 ───────────────────────────────────────────────────────
kinds = Counter()
special = defaultdict(list)
for op in ops.values():
    for m in op.get("modules") or []:
        t = m.get("type") or "?"
        kinds[t] += 1
        suffix = t.split("-")[-1]
        if suffix in ("A", "B"):
            special[t].append(op["name"])

print(f"모듈 총계: 사이트 {sum(kinds.values())} · KR 테이블 {sum(1 for e in kr_eq.values() if real(e))}"
      f" · CN 테이블 {sum(1 for e in cn_eq.values() if real(e))}")
print("종류별:", " · ".join(f"{k} {n}" for k, n in sorted(kinds.items())))
if special:
    print("특수 모듈(통합전략 ISW/SO · 생존연산 RA):")
    for t, names in sorted(special.items()):
        print(f"  {t}: {len(names)}명 — {', '.join(sorted(names)[:6])}{' …' if len(names) > 6 else ''}")
for l in lines:
    print(l)

if warn:
    print(f"  ⚠ 모듈 검사: {' / '.join(warn)}", file=sys.stderr)
else:
    print("✔ 모듈 이상 없음")
