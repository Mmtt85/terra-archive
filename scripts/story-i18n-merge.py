# -*- coding: utf-8 -*-
# 스토리 요약 다국어화 3단계 — 이벤트별 번역 조각을 검증·병합.
#
# scripts/story-i18n/<loc>/<id>.json (서브에이전트가 만든 번역)을 KO 원본과 구조 비교해
# 이상 없으면 app/data/story-summaries.<loc>.json으로 조립한다. 번역이 아직 없는 이벤트는
# KO로 폴백(파일은 항상 73개 완비 — 사이트가 깨지지 않게). 구조 불일치는 리포트만 하고
# 그 이벤트는 KO 폴백 처리(잘못된 번역이 반영되지 않게).
#
# 검증 불변식: 블록 개수·타입·비번역 필드(t/src/side/op/img/alias 길이)는 KO와 동일해야 하고,
# 번역 필드(tagline·block x/cap/who·entity name/desc)는 비어 있지 않아야 한다.
# **볼드** 마크다운 개수도 KO와 같아야 한다(누락/추가 방지). EN에 한글이 남으면 경고.
import json, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f"{REPO}/scripts/story-i18n"
load = lambda p: json.load(open(p, encoding="utf-8"))
ko_all = load(f"{REPO}/app/data/story-summaries.json")
HANGUL = re.compile(r"[가-힣]")
BOLD = re.compile(r"\*\*")

TEXT_KEYS = ("x", "cap", "who")          # 블록의 번역 대상 문자열 필드
KEEP_KEYS = ("t", "src", "side")          # 블록의 비번역(구조) 필드


def check_str(ko_s, tr_s, path, errs, loc):
    if not isinstance(tr_s, str) or not tr_s.strip():
        errs.append(f"{path}: 번역 비어 있음")
        return
    if BOLD.findall(ko_s or "").__len__() != BOLD.findall(tr_s).__len__():
        errs.append(f"{path}: **볼드** 개수 불일치 (KO {len(BOLD.findall(ko_s or ''))} vs {len(BOLD.findall(tr_s))})")
    if loc == "en" and HANGUL.search(tr_s):
        errs.append(f"{path}: EN인데 한글 잔존 → {tr_s[:40]}")


def validate(ko, tr, loc):
    errs = []
    if set(tr.keys()) != set(ko.keys()):
        errs.append(f"최상위 키 불일치: {sorted(tr.keys())} vs {sorted(ko.keys())}")
        return errs
    check_str(ko.get("tagline", ""), tr.get("tagline", ""), "tagline", errs, loc)
    for grp in ("chars", "terms"):
        ke, te = ko.get(grp) or [], tr.get(grp) or []
        if len(ke) != len(te):
            errs.append(f"{grp}: 개수 불일치 {len(ke)} vs {len(te)}")
            continue
        for i, (k, t) in enumerate(zip(ke, te)):
            if k.get("op") != t.get("op"):
                errs.append(f"{grp}[{i}].op 변경됨: {k.get('op')} → {t.get('op')}")
            if k.get("img") != t.get("img"):
                errs.append(f"{grp}[{i}].img 변경됨")
            if len(k.get("alias") or []) != len(t.get("alias") or []):
                errs.append(f"{grp}[{i}].alias 길이 불일치")
            check_str(k.get("name", ""), t.get("name", ""), f"{grp}[{i}].name", errs, loc)
            check_str(k.get("desc", ""), t.get("desc", ""), f"{grp}[{i}].desc", errs, loc)
    kb, tb = ko["blocks"], tr["blocks"]
    if len(kb) != len(tb):
        errs.append(f"blocks 개수 불일치 {len(kb)} vs {len(tb)}")
        return errs
    for i, (k, t) in enumerate(zip(kb, tb)):
        if set(k.keys()) != set(t.keys()):
            errs.append(f"blocks[{i}] 키 불일치: {sorted(t.keys())} vs {sorted(k.keys())}")
            continue
        for kk in KEEP_KEYS:
            if kk in k and k[kk] != t[kk]:
                errs.append(f"blocks[{i}].{kk} 변경됨: {k[kk]} → {t[kk]}")
        for tk in TEXT_KEYS:
            if tk in k:
                check_str(k[tk], t.get(tk, ""), f"blocks[{i}].{tk}", errs, loc)
    return errs


def merge(loc):
    out, done, pending, bad = {}, [], [], []
    for eid, ko in ko_all.items():
        p = f"{WORK}/{loc}/{eid}.json"
        if not os.path.exists(p):
            out[eid] = ko          # 미번역 → KO 폴백
            pending.append(eid)
            continue
        try:
            tr = load(p)
        except Exception as e:
            out[eid] = ko
            bad.append((eid, [f"JSON 파싱 실패: {e}"]))
            continue
        errs = validate(ko, tr, loc)
        if errs:
            out[eid] = ko          # 구조 불일치 → KO 폴백(오번역 반영 방지)
            bad.append((eid, errs))
        else:
            out[eid] = tr
            done.append(eid)
    json.dump(out, open(f"{REPO}/app/data/story-summaries.{loc}.json", "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    # 실제로 번역된 id 목록 — story.tsx가 미번역 이벤트에 'KO 전용' 안내를 띄우는 데 쓴다.
    # (부분 롤아웃 정직성: 번역 안 된 이벤트는 en/ja에서 한국어 폴백이므로 안내가 필요)
    json.dump(sorted(done), open(f"{REPO}/app/data/story-translated.{loc}.json", "w", encoding="utf-8"),
              ensure_ascii=False)
    print(f"[{loc}] 번역 완료 {len(done)} · 미번역 {len(pending)} · 불량 {len(bad)} → story-summaries.{loc}.json")
    if pending:
        print(f"     미번역: {' '.join(pending)}")
    for eid, errs in bad:
        print(f"  ✗ {eid}:")
        for e in errs[:8]:
            print(f"      - {e}")
    return len(bad)


if __name__ == "__main__":
    locs = sys.argv[1:] or ["en", "ja"]
    total_bad = sum(merge(loc) for loc in locs)
    sys.exit(1 if total_bad else 0)
