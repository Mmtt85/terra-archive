#!/usr/bin/env python3
"""미번역 CN 원문을 **문자열 그대로** 모아 `.ci/cn-missing.json` 에 남긴다 (2026-09-04).

왜 필요한가: 파이프라인은 그동안 "미번역 21명 · 26,208자" 처럼 **개수만** 찍었다.
그래서 `cn-translation-fill` 스킬이 무엇을 번역해야 하는지 알려면 사람이 산출물을 뒤져
한자를 골라내야 했고, **조회 키를 정확히 맞추기가 어려웠다** — 스크립트마다 조회 단위가
다르기 때문이다(프로필은 줄 단위, 모듈 이야기는 한 편 통째로, 보이스는 대사 한 줄).
키가 한 글자라도 어긋나면 번역을 채워도 안 먹는다.

그래서 **조회에 실패한 바로 그 키**를 각 스크립트가 여기에 흘려 넣는다. 채울 때는
이 파일의 문자열을 그대로 cn-translations.json 의 키로 쓰면 반드시 맞는다.

쓰는 쪽:
    from cnmiss import note, dump
    ...  note(key, kind="profiles", who=cid)      # 조회 실패한 자리에서
    ...  dump()                                    # 스크립트 끝에서 한 번

산출 형태:
    {"<CN 원문>": {"kind": ["profiles"], "who": ["char_4217_makoto"], "len": 42}, ...}
여러 스크립트가 이어 돌아도 **합쳐진다**(먼저 있던 것을 읽어 병합) — ci-refresh 한 판이
끝나면 전 파이프라인의 미번역이 이 한 파일에 모인다.
"""
import json
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, ".ci", "cn-missing.json")
CJK_RE = re.compile(r"[㐀-鿿]")

_seen = {}


def note(text, kind="", who=""):
    """조회에 실패한 CN 원문 한 건. 한자가 없으면 무시한다."""
    if not isinstance(text, str):
        return
    key = text.strip()
    if not key or not CJK_RE.search(key):
        return
    e = _seen.setdefault(key, {"kind": [], "who": [], "len": len(key)})
    if kind and kind not in e["kind"]:
        e["kind"].append(kind)
    if who and who not in e["who"]:
        e["who"].append(who)


def dump():
    """모은 것을 `.ci/cn-missing.json` 에 **병합** 저장한다. 없으면 아무것도 안 한다."""
    if not _seen:
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    old = {}
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding="utf-8"))
        except (ValueError, OSError):
            old = {}
    for k, v in _seen.items():
        o = old.setdefault(k, {"kind": [], "who": [], "len": v["len"]})
        for f in ("kind", "who"):
            o[f] = sorted(set(o.get(f, [])) | set(v[f]))
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(old, f, ensure_ascii=False, indent=1, sort_keys=True)


def reset():
    """ci-refresh 한 판의 맨 앞에서 부른다 — 지난 판의 잔재를 지운다."""
    if os.path.exists(OUT):
        os.remove(OUT)
