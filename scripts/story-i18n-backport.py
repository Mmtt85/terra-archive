# -*- coding: utf-8 -*-
# 스토리 요약 다국어화 — 역이관(발행본 → 번역 작업본).
#
# merge.py의 반대 방향이다. app/data/story-summaries.<loc>.json(발행본)을 손으로 고치는 일이
# 실제로 생긴다 — 사실 오류 제보를 받아 그 블록만 즉시 고치거나, 문체를 일괄 정리하거나.
# 그런데 scripts/story-i18n/<loc>/ 작업본은 그대로라서, 나중에 merge를 돌리면 **발행본의
# 수정이 옛 번역으로 조용히 되돌아간다** (2026-07-29 실측: JA 16개 이벤트가 정리된 평서체에서
# 옛 경어체로, EN 12개 이벤트의 alias가 옛 값으로 되돌아갈 뻔했다).
#
# 그래서 규칙은 하나다: **발행본을 직접 고쳤으면 merge 전에 이 스크립트를 돌린다.**
# merge는 발행본과 결과가 달라지면 스스로 멈추므로, 잊어도 사고가 나지는 않는다.
#
# KO 폴백 상태인 이벤트(story-translated.<loc>.json에 없는 것)는 건드리지 않는다 —
# 한국어 원문을 번역 작업본에 덮어써 버리면 번역이 끝난 것처럼 보이기 때문.
import json, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f"{REPO}/scripts/story-i18n"
load = lambda p: json.load(open(p, encoding="utf-8"))


def backport(loc, dry):
    pub = load(f"{REPO}/app/data/story-summaries.{loc}.json")
    tr_ok = set(load(f"{REPO}/app/data/story-translated.{loc}.json"))
    changed, skipped = [], 0
    for eid, obj in pub.items():
        if eid not in tr_ok:            # KO 폴백본 — 번역 작업본을 덮지 않는다
            skipped += 1
            continue
        p = f"{WORK}/{loc}/{eid}.json"
        cur = load(p) if os.path.exists(p) else None
        # _ko 지문은 merge가 관리하므로 비교·보존에서 제외
        if cur is not None and {k: v for k, v in cur.items() if k != "_ko"} == obj:
            continue
        changed.append(eid)
        if not dry:
            json.dump(obj, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    verb = "바뀔 것" if dry else "역이관"
    print(f"[{loc}] {verb} {len(changed)}건 · KO 폴백이라 건너뜀 {skipped}건")
    if changed:
        print(f"     {' '.join(changed)}")
    return len(changed)


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    locs = [a for a in sys.argv[1:] if not a.startswith("--")] or ["en", "ja"]
    total = sum(backport(loc, dry) for loc in locs)
    if dry and total:
        print("\n실제로 반영하려면 --dry-run 없이 다시 실행하세요.")
