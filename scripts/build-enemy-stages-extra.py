#!/usr/bin/env python3
"""적 도감 '등장 작전'에 통합전략·생존연산·위기 협약 작전을 더한다 — app/data/enemy-stages{,.en,.ja}.json (2026-10-17).

build-enemies.py 의 역색인은 일반 작전 표(stage_table)만 본다. 그래서 통합전략에만 나오는 적(고대의 넝쿨 = 미즈키 「깨어난 대지」 등
80종)은 등장 작전이 텅 비었다 (사용자 지적 "록라 보스맵이었던 거 같은데 등장 맵이 안 나온다").
작전 도감은 이 작전들을 별도 색인(stages-rogue·stages-sandbox·stages-crisis *.json)으로 이미 갖고 있다 — 그 색인의 적 목록(e)을
뒤집어 붙인다. 구역 이름은 테마 이름 하나이고(층별로 나누지 않는다), 링크는 작전 도감 #st-<id> 그대로(목록이 그 색인을 합쳐 연다).

여러 번 돌려도 같다: 이 스크립트가 붙인 줄(작전 id 가 색인 쪽)은 먼저 걷어 내고 다시 붙인다.
순서: build-enemies.py → build-stages-rogue.py · build-stages-sandbox.py · build-stages-crisis.py → 이것.

  python3 scripts/build-enemy-stages-extra.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "app", "data")
EXTRA = [("stages-rogue", "ROGUE"), ("stages-sandbox", "SANDBOX"), ("stages-crisis", "CRISIS")]


def load(name):
    p = os.path.join(DATA, name)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None


def main():
    for suf in ("", ".en", ".ja"):
        es = load(f"enemy-stages{suf}.json")
        if not es:
            continue
        docs = [(load(f"{n}{suf}.json"), t) for n, t in EXTRA]
        extra_ids = {s["id"] for d, _ in docs if d for s in d["stages"]}
        # 지난번에 붙인 줄 걷어 내기 — 행 번호가 바뀌니 byEnemy 를 다시 매긴다
        keep = [i for i, r in enumerate(es["stages"]) if r[4] not in extra_ids]
        remap = {old: new for new, old in enumerate(keep)}
        rows = [es["stages"][i] for i in keep]
        by = {}
        for k, lst in es["byEnemy"].items():
            nl = [[remap[x[0]], *x[1:]] for x in lst if x[0] in remap]
            if nl:
                by[k] = nl
        added = 0
        for d, t in docs:
            if not d:
                continue
            ids, evs, zones = d["enemyIds"], d.get("events") or [], d.get("zones") or []
            for s in d["stages"]:
                ev = evs[s["ev"]] if isinstance(s.get("ev"), int) and s["ev"] < len(evs) else ""
                zn = zones[s["z"]] if isinstance(s.get("z"), int) and s["z"] < len(zones) else ""
                # 구역은 테마 하나로 묶는다 — 층마다 나누면 한 줄짜리 구역이 줄줄이 생겼다 (사용자 지시 2026-10-17
                # "층별로 나누지 말고 사미 록라 하나로"). 위기 협약은 시즌 이름이 곧 구역
                zone = ev or zn
                idx = len(rows)
                rows.append([s.get("code") or "", s.get("name") or "", zone, t, s["id"]])
                for ent in s.get("e") or []:
                    ei, cnt = ent[0], ent[1] if len(ent) > 1 else 0
                    lv = ent[2] if len(ent) > 2 else 0
                    if ei >= len(ids):
                        continue
                    k = ids[ei]
                    row_e = [idx, cnt, lv] if lv else ([idx, cnt] if cnt else [idx])
                    by.setdefault(k, []).append(row_e)
                added += 1
        p = os.path.join(DATA, f"enemy-stages{suf}.json")
        json.dump({"stages": rows, "byEnemy": by}, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"  enemy-stages{suf}.json: 특수 작전 {added}개 더함 · 작전 {len(rows)} · 적 {len(by)}종 {os.path.getsize(p) // 1024}KB")


if __name__ == "__main__":
    main()
