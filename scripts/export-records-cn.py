#!/usr/bin/env python3
"""CN 선행 오퍼레이터 기록의 번역본을 scripts/story-cn/ 작업 폴더에서 scripts/records-cn/ 로 옮긴다.

  python3 scripts/export-records-cn.py en ja      # → scripts/records-cn/{en,ja}/<charId>.json
  python3 scripts/export-records-cn.py ko         # → scripts/records-cn/<charId>.json (KO 는 로케일 폴더 없이 — 종전 규약)

번역은 이벤트 전문과 같은 방식으로 scripts/story-cn/story_<오퍼>_set_<N>/<lang>/ep_NN.json 에서 한다
(규칙 _TRANSLATE.md · 검사 _check.py — story-cn 은 gitignore 라 로컬 전용). 기록은 build-records.py 가
굽는데, 그쪽은 **레포에 남는** records-cn 을 읽으므로 여기서 한 번 옮겨 둔다. 그다음:
  python3 scripts/build-records.py && python3 scripts/build-story-vn.py --records

- 화자(n)는 화자표(speakers.json / speakers.<lang>.json) 값으로 싣는다.
- tag(기록 소개문)는 대본 밖(handbook storyIntro)이라 scripts/story-cn/_record-intros.json 에서 온다.
- cn_name(원문 세트명)을 달아 build-records.py 가 순서가 아니라 이름으로 짝짓게 한다.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY_CN = os.path.join(REPO, "scripts", "story-cn")
OUT = os.path.join(REPO, "scripts", "records-cn")
KEEP = ("n", "x", "st", "loc", "opts")


def load(p):
    return json.load(open(p, encoding="utf-8"))


def main():
    langs = sys.argv[1:] or ["en", "ja"]
    hb = load(os.path.join(REPO, ".gamedata", "cn_handbook_info_table.json"))["handbookDict"]
    sets = {}                                   # storySetId → (charId, set)
    for cid, v in hb.items():
        for s in v.get("handbookAvgList") or []:
            sets[s["storySetId"]] = (cid, s)
    intros = load(os.path.join(STORY_CN, "_record-intros.json"))
    for lang in langs:
        per_cid, skipped = {}, []
        for sid in sorted(os.listdir(STORY_CN)):
            base = os.path.join(STORY_CN, sid)
            if not sid.startswith("story_") or not os.path.isfile(os.path.join(base, "meta.json")):
                continue
            if sid not in sets:
                skipped.append(f"{sid}(핸드북에 없음)")
                continue
            cid, s = sets[sid]
            spk_path = os.path.join(base, "speakers.json" if lang == "ko" else f"speakers.{lang}.json")
            meta = load(os.path.join(base, "meta.json"))
            paths = [os.path.join(base, lang, f"ep_{m['idx']:02d}.json") for m in meta["eps"]]
            if not os.path.exists(spk_path) or not all(os.path.exists(p) for p in paths):
                skipped.append(f"{sid}(번역 없음)")
                continue
            spk = load(spk_path)
            for m, p in zip(meta["eps"], paths):
                src = load(os.path.join(base, f"ep_{m['idx']:02d}.json"))
                tr = load(p)
                if len(tr["lines"]) != len(src["lines"]):
                    sys.exit(f"{sid}/{lang}/ep_{m['idx']:02d}: 줄 수 {len(src['lines'])} ≠ {len(tr['lines'])} — _check.py 부터")
                lines = []
                for a, b in zip(src["lines"], tr["lines"]):
                    ln = {k: b[k] for k in KEEP if k in b}
                    if "n" in a:
                        ln["n"] = spk[a["n"]]
                    lines.append(ln)
                intro = (intros.get(sid) or {}).get(lang)
                per_cid.setdefault(cid, []).append({
                    "sort": (s.get("sortId") or 0, m["idx"]),
                    "cn_name": s.get("storySetName") or src["name"],
                    "name": tr.get("name") or src["name"],
                    "tag": intro or "",
                    "lines": lines,
                })
        dest_dir = OUT if lang == "ko" else os.path.join(OUT, lang)
        os.makedirs(dest_dir, exist_ok=True)
        for cid, recs in sorted(per_cid.items()):
            recs.sort(key=lambda r: r.pop("sort"))
            json.dump({"id": cid, "recs": recs}, open(os.path.join(dest_dir, f"{cid}.json"), "w", encoding="utf-8"),
                      ensure_ascii=False, indent=1)
        print(f"{lang}: {len(per_cid)}명 · 기록 {sum(len(r) for r in per_cid.values())}편 → "
              f"{os.path.relpath(dest_dir, REPO)}/" + (f" · 건너뜀 {', '.join(skipped)}" if skipped else ""))


if __name__ == "__main__":
    main()
