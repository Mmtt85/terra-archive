#!/usr/bin/env python3
"""오퍼레이터 레코드(밀록) 해금 조건 요약 → app/data/record-req.json (내 정보 '오퍼레이터 레코드' 카드, 2026-10-22).

build-records.py 가 만든 public/records/<locale>/<charId>.json 에서 조건만 뽑는다 (build-records.py 끝에서 자동으로 부른다).
  { charId: [ { "n": {"ko": 이름, "en": …, "ja": …}, "e": 정예화, "l": 레벨, "fv": 신뢰도 %, "f": 1? (중섭 선행) } ] }
조건 종류: AWAKE [정예화, 레벨] · FAVOR [신뢰도 %] — 둘 다 없으면 0.
"""
import glob
import json
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = f"{REPO}/public/records"
out = {}
for p in sorted(glob.glob(f"{ROOT}/ko/*.json")):
    doc = json.load(open(p, encoding="utf-8"))
    cid = doc["id"]
    names = {}
    for loc in ("en", "ja"):
        q = f"{ROOT}/{loc}/{cid}.json"
        if os.path.exists(q):
            names[loc] = [r.get("name") for r in json.load(open(q, encoding="utf-8"))["recs"]]
    recs = []
    for i, r in enumerate(doc["recs"]):
        e = l = fv = 0
        for u in r.get("unlock") or []:
            if u.get("t") == "AWAKE" and u.get("p"):
                e, l = int(u["p"][0]), int(u["p"][1]) if len(u["p"]) > 1 else 1
            elif u.get("t") == "FAVOR" and u.get("p"):
                fv = int(u["p"][0])
        n = {"ko": r.get("name")}
        for loc, lst in names.items():
            if i < len(lst) and lst[i]:
                n[loc] = lst[i]
        rec = {"n": n, "e": e, "l": l, "fv": fv}
        if r.get("f"):
            rec["f"] = 1
        recs.append(rec)
    if recs:
        out[cid] = recs
json.dump(out, open(f"{REPO}/app/data/record-req.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"record-req: {len(out)}명 · {sum(len(v) for v in out.values())}건")
