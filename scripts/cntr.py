#!/usr/bin/env python3
"""cn-translations.json 로더 — **조회할 때만** 문장부호 변종을 흡수한다 (2026-09-04).

왜 필요한가: 중섭 데이터를 클뜯 레포에서 CDN 직수신으로 바꾼 뒤(2026-09-02) 원문의
말줄임표 표기가 통째로 달라졌다 — 레포판은 `......`(마침표 6개), CDN판은 `……`(U+2026 둘).
사전 키는 레포 시절 원문이라 **한 글자도 안 틀렸는데 318건 41,043자가 조용히
미번역으로 되돌아갔다** (미실장 오퍼 상세가 중국어로 다시 뜬다는 사용자 제보로 발견).

고치는 자리가 셋 있었는데 둘은 틀렸다:
  ✗ 원문(산출물)을 `......`로 되돌린다 → 출력 텍스트는 CDN 표기가 맞다.
  ✗ 사전에 변종 키를 복제해 넣는다 → 항목이 두 배가 되고, 다음에 표기가 또 바뀌면 또 복제.
  ✓ **조회 키만** 정규화한다 — 사전 파일은 그대로 두고 `.get()`이 변종을 흡수한다.

쓰는 쪽:
    import cntr
    MANUAL = cntr.load(f"{REPO}/scripts/cn-translations.json")   # 없으면 빈 사전
    MANUAL.get(cn_text)          # ...... / …… 어느 쪽이 와도 잡힌다
    cntr.Dict(other_table)       # 수확 사전 등 다른 조회표에도 씌울 수 있다

⚠ `Dict`는 **만들 때** 변종 색인을 짠다. 만든 뒤에 키를 더 넣으면 그 키는 변종 조회가
  안 된다 — 다 채운 뒤에 씌울 것.
"""
import json
import os
import re

# 말줄임표: `...`(3개 이상) · `…`(하나 이상) 전부 한 형태로 본다.
# 다음에 또 다른 표기 흔들림이 발견되면 여기에 규칙을 더한다 (원문·사전은 건드리지 않는다).
_ELLIPSIS = re.compile(r"(?:\.{3,}|…+)")
# 눈에 안 보이는 공백 변종 — 줄바꿈 없는 공백(U+00A0)·전각 공백(U+3000)·제로폭(U+200B/FEFF).
# 2026-09-04 실측: 스킨 설명의 "女神异闻录3 Reload"가 원문에서는 3과 Reload 사이가 U+00A0라,
# 보통 공백으로 적은 사전 키와 **눈으로는 똑같은데** 안 맞았다 (P3 콜라보 4줄 미번역).
# 말줄임표와 같은 부류의 함정이라 같은 자리에서 흡수한다.
_SPACE = re.compile(r"[ 　​﻿]")


def norm(s):
    """조회용 정규화 — 사람이 읽을 텍스트를 만드는 데 쓰면 안 된다."""
    if not isinstance(s, str):
        return s
    return _ELLIPSIS.sub("…", _SPACE.sub(" ", s))


class Dict(dict):
    """평범한 dict인데 `.get()`·`in`이 문장부호 변종까지 본다.

    `.items()`·`.values()`는 **원본 그대로** 낸다 — 수확·역색인이 두 배가 되면 안 된다.
    """

    def __init__(self, data=None):
        super().__init__(data or {})
        self._alt = {}
        for k, v in self.items():
            if isinstance(k, str):
                self._alt.setdefault(norm(k), v)

    def get(self, key, default=None):
        hit = dict.get(self, key, None)
        if hit is not None:
            return hit
        if isinstance(key, str):
            return self._alt.get(norm(key), default)
        return default

    def __contains__(self, key):
        if dict.__contains__(self, key):
            return True
        return isinstance(key, str) and norm(key) in self._alt


def load(path):
    """cn-translations.json 을 변종 흡수 사전으로 읽는다. 파일이 없으면 빈 사전."""
    if not os.path.exists(path):
        return Dict()
    with open(path, encoding="utf-8") as f:
        return Dict(json.load(f))
