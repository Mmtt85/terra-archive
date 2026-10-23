#!/usr/bin/env python3
"""오퍼 중국어 이름표 — app/data/op-cn-names.json ({오퍼 id: 중국 서버 표시명}).

MAA 기반시설 내보내기(app/maa-export.ts)가 '中文(중국 서버 클라이언트)'을 고르면 이 이름으로 담는다.
MAA 는 게임 화면 글자(OCR)와 이름을 그대로 비교하므로 클라이언트 언어의 표시명이어야 한다 (2026-10-23).
종전에 별칭에서 꺼내려 했더니 로봇(Castle-3 등)·최근 오퍼 29명이 빠져 표에서 직접 만든다.

사용: python3 scripts/build-op-cn-names.py   (.gamedata/cn_character_table.json — fetch-gamedata-cdn.py --server cn)
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GD = os.path.join(ROOT, ".gamedata")
OUT = os.path.join(ROOT, "app", "data", "op-cn-names.json")

table = json.load(open(os.path.join(GD, "cn_character_table.json"), encoding="utf-8"))
infra = json.load(open(os.path.join(ROOT, "app", "data", "infra.json"), encoding="utf-8"))
ids = sorted({o["id"] for o in infra["ops"]})
out = {cid: table[cid]["name"] for cid in ids if cid in table and table[cid].get("name")}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
missing = [cid for cid in ids if cid not in out]
print(f"op-cn-names.json: {len(out)}/{len(ids)}명 · {os.path.getsize(OUT) // 1024}KB" + (f" · 없음 {missing[:5]}" if missing else ""))
