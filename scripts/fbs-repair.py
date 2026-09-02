#!/usr/bin/env python3
"""중섭 스키마를 **그 서버의 공식 JSON을 정답지 삼아** 서버별 스키마로 고친다.

## 왜 필요한가

`fetch-gamedata-cdn.py`는 공개 스키마(OpenArknightsFBS main = 중섭)를 쓰는데, 한섭 클라는
중섭보다 뒤처진 빌드라 테이블 필드가 몇 개 적다. FlatBuffers 는 필드 자리(vtable 슬롯)로
읽으므로 **하나만 어긋나도 그 아래가 전부 밀려** flatc가 조용히 세그폴트한다.

## 어떻게 고치는가

클뜯 레포의 그 서버 JSON이 정답지다. 공식 직렬화기는 **부재 필드도 null 로 찍어 주므로**,
"레포 JSON에 한 번도 안 나온 키" = "그 서버 클라에 없는 필드"로 볼 수 있다.
그래서 스키마와 레포 JSON을 나란히 걸어가며 테이블 타입마다 실제로 관측된 키를 모으고,
한 번도 안 보인 필드를 지운다.

    python3 scripts/fbs-repair.py building_data              # 레포 JSON을 받아서 수리
    python3 scripts/fbs-repair.py stage_table --server kr
    python3 scripts/fbs-repair.py activity_table --dry-run   # 무엇을 지울지만 본다

결과는 `scripts/fbs/<server>/<table>.fbs`. 클라가 올라가 다시 어긋나면 그때 또 돌리면 된다.

⚠ **표본이 없는 타입은 건드리지 않는다.** 레포 JSON에 한 번도 등장하지 않은 테이블 타입은
  필드가 없어서가 아니라 그 데이터가 아직 안 들어와서일 수 있다 — 그런 걸 비우면
  멀쩡한 스키마를 망가뜨린다.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbsutil import parse_fbs
from fetchutil import urlread

HERE = os.path.dirname(os.path.abspath(__file__))
FBS_DIR = os.path.join(HERE, "fbs")
FBS_URL = "https://raw.githubusercontent.com/MooncellWiki/OpenArknightsFBS/main/FBS/%s.fbs"
REPO = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/%s/gamedata/excel/%s.json"
PREFIX = {"kr": "kr", "jp": "jp", "en": "en", "cn": "cn"}


def observe(tables, root, data, seen, unwrapped):
    """스키마를 따라 JSON을 걸으며 타입별로 실제 나온 키를 모은다."""
    def walk(val, typ):
        if val is None:
            return
        m = re.fullmatch(r"\[\s*(.+?)\s*\]", typ)
        if m:
            et = m.group(1)
            if et.startswith("dict__"):
                vt = tables.get(et, {}).get("value", "string")
                if isinstance(val, dict):
                    for v in val.values():
                        walk(v, vt)
                elif isinstance(val, list):        # 아직 안 정규화된 모양도 받아 준다
                    for e in val:
                        if isinstance(e, dict):
                            walk(e.get("value"), vt)
                return
            if et.startswith("list_"):
                inner = tables.get(et, {}).get("values", "[string]")
                if isinstance(val, list):
                    for e in val:
                        walk(e, inner)
                return
            if isinstance(val, list):
                for e in val:
                    walk(e, et)
            return
        if typ in tables and isinstance(val, dict):
            seen.setdefault(typ, set()).update(val.keys())
            for k, v in val.items():
                ft = tables[typ].get(k)
                if ft:
                    walk(v, ft)

    spec = tables.get(root, {})
    if unwrapped and len(spec) == 1:
        # 루트가 껍데기 하나인 표는 공식 JSON이 그 껍데기를 벗겨 놨다 — 도로 씌워서 건는다
        only = next(iter(spec))
        seen.setdefault(root, set()).add(only)
        walk(data, spec[only])
    else:
        walk(data, root)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("table")
    ap.add_argument("--server", default="kr", choices=list(PREFIX))
    ap.add_argument("--ref", help="정답지 JSON 경로 (생략하면 클뜯 레포에서 받는다)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    cache = os.path.join(FBS_DIR, "_cache")
    os.makedirs(cache, exist_ok=True)
    base = os.path.join(cache, a.table + ".fbs")
    if not os.path.exists(base):
        open(base, "wb").write(urlread(FBS_URL % a.table, timeout=60, ua="terra-archive-cdn/1.0"))
    text = open(base, encoding="utf-8").read()
    tables, root = parse_fbs(text)

    if a.ref:
        ref = json.load(open(a.ref, encoding="utf-8"))
    else:
        local = os.path.join(".gamedata", "%s_%s.json" % (PREFIX[a.server], a.table))
        if os.path.exists(local):
            print("정답지: %s (로컬)" % local)
            ref = json.load(open(local, encoding="utf-8"))
        else:
            print("정답지: 클뜯 레포에서 받는 중…")
            ref = json.loads(urlread(REPO % (PREFIX[a.server], a.table), timeout=180,
                                     ua="terra-archive-cdn/1.0").decode("utf-8"))

    spec = tables.get(root, {})
    unwrapped = len(spec) == 1 and not (isinstance(ref, dict) and set(ref) == set(spec))
    seen = {}
    observe(tables, root, ref, seen, unwrapped)

    drops, kept_types = {}, 0
    for tname, fields in tables.items():
        if tname not in seen:              # 표본 없음 → 손대지 않는다
            continue
        kept_types += 1
        gone = [f for f in fields if f not in seen[tname]]
        if gone:
            drops[tname] = gone

    print("표본이 잡힌 테이블 %d개 / 전체 %d개" % (kept_types, len(tables)))
    if not drops:
        print("지울 필드 없음 — 스키마가 이미 맞는다."); return 0
    total = sum(len(v) for v in drops.values())
    print("지울 필드 %d개 (테이블 %d개):" % (total, len(drops)))
    for t, fs in sorted(drops.items(), key=lambda kv: -len(kv[1]))[:14]:
        print("   %-52s %s" % (t, ", ".join(fs[:5]) + (" …" if len(fs) > 5 else "")))
    if a.dry_run:
        return 0

    # 해당 테이블 블록 안에서만 그 필드 줄을 지운다
    out, cur = [], None
    for ln in text.split("\n"):
        m = re.match(r"^(?:table|struct)\s+(\w+)\s*\{", ln)
        if m:
            cur = m.group(1)
        elif ln.startswith("}"):
            cur = None
        elif cur in drops:
            fm = re.match(r"^\s*(\w+)\s*:", ln)
            if fm and fm.group(1) in drops[cur]:
                continue
        out.append(ln)

    hdr = ("// %s 서버 전용 %s 스키마 — scripts/fbs-repair.py 가 자동 생성.\n"
           "// 원본: MooncellWiki/OpenArknightsFBS main(중섭). 이 서버 클라에 없는 필드 %d개를\n"
           "// 지웠다 (정답지 = 클뜯 레포의 %s JSON — 공식 직렬화기는 부재 필드도 null 로 찍으므로\n"
           "// '한 번도 안 나온 키' = '클라에 없는 필드'). 클라가 올라가 또 어긋나면 다시 돌릴 것.\n\n"
           % (a.server, a.table, total, PREFIX[a.server]))
    dest_dir = os.path.join(FBS_DIR, a.server)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, a.table + ".fbs")
    open(dest, "w", encoding="utf-8").write(hdr + "\n".join(out))
    print("\n→ %s" % dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
