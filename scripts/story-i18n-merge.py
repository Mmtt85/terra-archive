# -*- coding: utf-8 -*-
# 스토리 요약 다국어화 3단계 — 이벤트별 번역 조각을 검증·병합.
#
# scripts/story-i18n/<loc>/<id>.json (서브에이전트가 만든 번역)을 KO 원본과 구조 비교해
# 이상 없으면 app/data/story-summaries.<loc>.json으로 조립한다. 번역이 아직 없는 이벤트는
# KO로 폴백(파일은 항상 이벤트 전수 완비 — 사이트가 깨지지 않게).
#
# ── 검증 등급 (2026-07-29 개편) ─────────────────────────────────────────────
# 예전엔 **모든 검증 실패가 똑같이 '이벤트 통째 KO 폴백'** 이었다. 그래서 KO에서 alias 하나를
# 지우기만 해도 멀쩡한 번역 24건이 통째로 한국어로 되돌아갔다(2026-07-29 사고). 벌이 죄에
# 비례하도록 두 등급으로 나눈다:
#   치명(FATAL) → KO 폴백. 구조가 어긋나 렌더가 깨지거나 오번역이 나가는 경우.
#                 블록/엔티티 개수·키 불일치, 비번역 필드 변조, 번역 누락(빈 문자열),
#                 로케일 파일인데 한국어가 절반 이상 남음(번역이 사실상 안 된 것).
#   경고(WARN)  → 그대로 발행하고 리포트만. 표시 품질이 조금 떨어질 뿐인 경우.
#                 alias 길이 불일치, **볼드** 개수 불일치, 한국어 잔존 소수.
#
# ── 발행본 보호 ────────────────────────────────────────────────────────────
# 쓰기 직전에 **이미 발행된 app/data/story-summaries.<loc>.json과 대조**해, 전에 번역돼
# 있던 이벤트의 결과가 달라지면(KO 폴백으로 후퇴하든, 본문이 다시 쓰이든) 아무것도 쓰지 않고
# exit 1 한다. 새로 번역된 이벤트만 추가되는 평시에는 걸리지 않는다.
# 발행본을 직접 손본 적이 있으면 스캐폴드가 뒤처져 여기서 걸리므로, 먼저
# `story-i18n-backport.py`로 발행본을 스캐폴드에 되돌린 뒤 merge 한다.
# 의도한 변경이면 --publish.
#
# ── 낡은 번역 탐지 ─────────────────────────────────────────────────────────
# 번역이 검증을 통과하면 그 시점 KO 본문의 지문(_ko)을 번역 파일에 새긴다. 나중에 KO 요약을
# 고치면(예: 사실 오류 수정) 지문이 어긋나므로 "낡음 — 재번역 필요"로 잡힌다. KO만 고치고
# EN/JA에 옛 내용이 그대로 남는 사고를 막는 장치다. _ko는 app/data 출력에는 넣지 않는다.
import hashlib, json, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = f"{REPO}/scripts/story-i18n"
load = lambda p: json.load(open(p, encoding="utf-8"))
ko_all = load(f"{REPO}/app/data/story-summaries.json")
HANGUL = re.compile(r"[가-힣]")
BOLD = re.compile(r"\*\*")

TEXT_KEYS = ("x", "cap", "who")          # 블록의 번역 대상 문자열 필드
KEEP_KEYS = ("t", "src", "side")          # 블록의 비번역(구조) 필드
FP_KEY = "_ko"                            # 번역 시점 KO 지문
KOR_FATAL_RATIO = 0.5                     # 번역 문자열의 이 비율 이상 한글이면 '번역 안 됨'


def ko_fingerprint(ko):
    """번역 대상 텍스트만 모아 만든 지문 — KO 본문이 바뀌면 달라진다.
    alias·이미지 등 비번역 구조는 제외(그쪽은 길이 검증이 따로 잡는다)."""
    parts = [ko.get("tagline", "")]
    for b in ko["blocks"]:
        parts += [str(b.get(k, "")) for k in TEXT_KEYS]
    for grp in ("chars", "terms"):
        for e in ko.get(grp) or []:
            parts += [e.get("name", ""), e.get("desc", "")]
    return hashlib.sha1(" ".join(parts).encode()).hexdigest()[:16]


def check_str(ko_s, tr_s, path, fatal, warn, kor):
    if not isinstance(tr_s, str) or not tr_s.strip():
        fatal.append(f"{path}: 번역 비어 있음")
        return
    if len(BOLD.findall(ko_s or "")) != len(BOLD.findall(tr_s)):
        warn.append(f"{path}: **볼드** 개수 불일치 (KO {len(BOLD.findall(ko_s or ''))} vs {len(BOLD.findall(tr_s))})")
    kor.append(bool(HANGUL.search(tr_s)))


def validate(ko, tr, loc):
    """(치명, 경고) 두 목록을 돌려준다."""
    fatal, warn, kor = [], [], []
    if set(tr.keys()) - {FP_KEY} != set(ko.keys()):
        fatal.append(f"최상위 키 불일치: {sorted(set(tr.keys()) - {FP_KEY})} vs {sorted(ko.keys())}")
        return fatal, warn
    check_str(ko.get("tagline", ""), tr.get("tagline", ""), "tagline", fatal, warn, kor)
    for grp in ("chars", "terms"):
        ke, te = ko.get(grp) or [], tr.get(grp) or []
        if len(ke) != len(te):
            fatal.append(f"{grp}: 개수 불일치 {len(ke)} vs {len(te)}")
            continue
        for i, (k, t) in enumerate(zip(ke, te)):
            if k.get("op") != t.get("op"):
                fatal.append(f"{grp}[{i}].op 변경됨: {k.get('op')} → {t.get('op')}")
            if k.get("img") != t.get("img"):
                fatal.append(f"{grp}[{i}].img 변경됨")
            # alias는 로케일 본문 하이라이트와 한국어 원문 화자 매칭을 겸해 언어가 섞인다.
            # 길이만 KO와 맞추면 되고, 어긋나도 하이라이트가 조금 덜 걸릴 뿐이라 경고에 그친다.
            if len(k.get("alias") or []) != len(t.get("alias") or []):
                warn.append(f"{grp}[{i}].alias 길이 불일치 (KO {len(k.get('alias') or [])} vs {len(t.get('alias') or [])})")
            check_str(k.get("name", ""), t.get("name", ""), f"{grp}[{i}].name", fatal, warn, kor)
            check_str(k.get("desc", ""), t.get("desc", ""), f"{grp}[{i}].desc", fatal, warn, kor)
    kb, tb = ko["blocks"], tr["blocks"]
    if len(kb) != len(tb):
        fatal.append(f"blocks 개수 불일치 {len(kb)} vs {len(tb)}")
        return fatal, warn
    for i, (k, t) in enumerate(zip(kb, tb)):
        if set(k.keys()) != set(t.keys()):
            fatal.append(f"blocks[{i}] 키 불일치: {sorted(t.keys())} vs {sorted(k.keys())}")
            continue
        for kk in KEEP_KEYS:
            if kk in k and k[kk] != t[kk]:
                fatal.append(f"blocks[{i}].{kk} 변경됨: {k[kk]} → {t[kk]}")
        for tk in TEXT_KEYS:
            if tk in k:
                check_str(k[tk], t.get(tk, ""), f"blocks[{i}].{tk}", fatal, warn, kor)
    # 한국어 잔존 — 소수면 경고, 절반 넘으면 '번역이 안 된 파일'로 보고 폴백
    if kor:
        ratio = sum(kor) / len(kor)
        if ratio >= KOR_FATAL_RATIO:
            fatal.append(f"{loc} 파일인데 한국어 잔존 {sum(kor)}/{len(kor)} ({ratio:.0%}) — 번역 미완")
        elif sum(kor):
            warn.append(f"한국어 잔존 {sum(kor)}/{len(kor)}곳")
    return fatal, warn


def merge(loc, force):
    out, done, pending, bad, warned, stale, stamp = {}, [], [], [], [], [], []
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
        fatal, warn = validate(ko, tr, loc)
        if fatal:
            out[eid] = ko          # 구조 파손 → KO 폴백(오번역·렌더 깨짐 방지)
            bad.append((eid, fatal))
            continue
        fp = ko_fingerprint(ko)
        if tr.get(FP_KEY) and tr[FP_KEY] != fp:
            stale.append(eid)      # KO 본문이 번역 이후 바뀜 — 발행은 하되 재번역 대상
        if tr.get(FP_KEY) != fp:
            tr[FP_KEY] = fp
            stamp.append((p, tr))
        out[eid] = {k: v for k, v in tr.items() if k != FP_KEY}
        done.append(eid)
        if warn:
            warned.append((eid, warn))

    # ── 발행본 보호: 이미 번역돼 발행된 이벤트의 결과가 달라지면 쓰지 않는다
    prev_path = f"{REPO}/app/data/story-translated.{loc}.json"
    pub_path = f"{REPO}/app/data/story-summaries.{loc}.json"
    prev = set(load(prev_path)) if os.path.exists(prev_path) else set()
    pub = load(pub_path) if os.path.exists(pub_path) else {}
    regressed = sorted(prev - set(done))                                   # 번역 → KO 폴백
    rewritten = sorted(e for e in prev & set(done) if pub.get(e) != out[e])  # 발행 본문이 달라짐
    if (regressed or rewritten) and not force:
        print(f"[{loc}] ✗ 중단 — 이미 발행된 번역이 바뀝니다. 아무것도 쓰지 않았습니다.")
        if regressed:
            print(f"     KO 폴백으로 후퇴 {len(regressed)}건: {' '.join(regressed)}")
            for eid, errs in bad:
                if eid in prev:
                    print(f"       ✗ {eid}: " + " / ".join(errs[:4]))
        if rewritten:
            print(f"     본문이 다시 쓰임 {len(rewritten)}건: {' '.join(rewritten)}")
            print("       발행본을 직접 고친 적이 있으면 story-i18n-backport.py 를 먼저 돌릴 것")
        print("     의도한 변경이면 --publish")
        return 1

    json.dump(out, open(f"{REPO}/app/data/story-summaries.{loc}.json", "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    # 실제로 번역된 id 목록 — story.tsx가 미번역 이벤트에 'KO 전용' 안내를 띄우는 데 쓴다.
    # (부분 롤아웃 정직성: 번역 안 된 이벤트는 en/ja에서 한국어 폴백이므로 안내가 필요)
    json.dump(sorted(done), open(prev_path, "w", encoding="utf-8"), ensure_ascii=False)
    for p, tr in stamp:       # 지문 각인은 실제로 발행한 뒤에만
        json.dump(tr, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f"[{loc}] 번역 완료 {len(done)} · 미번역 {len(pending)} · 폴백 {len(bad)} · 경고 {len(warned)} · 낡음 {len(stale)}"
          f" → story-summaries.{loc}.json")
    if pending:
        print(f"     미번역: {' '.join(pending)}")
    if stale:
        print(f"     ⚠ 낡음(KO가 번역 이후 바뀜 — 재번역 필요): {' '.join(stale)}")
    for eid, errs in bad:
        print(f"  ✗ {eid} (KO 폴백):")
        for e in errs[:8]:
            print(f"      - {e}")
    for eid, errs in warned:
        print(f"  · {eid} (발행함, 경고 {len(errs)}건): " + " / ".join(errs[:3]))
    return len(bad)


if __name__ == "__main__":
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--publish" in sys.argv or "--force" in sys.argv
    locs = argv or ["en", "ja"]
    total_bad = sum(merge(loc, force) for loc in locs)
    sys.exit(1 if total_bad else 0)
