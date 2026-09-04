#!/usr/bin/env python3
"""잠재능력이 '재능 강화'일 때 **실제로 무엇이 얼마나 오르는지** 계산한다 (2026-09-04).

왜 필요한가: 잠재 설명이 `BUFF` 형이면 "공격력 +22"처럼 수치가 그대로 적혀 있지만,
`CUSTOM` 형은 게임 원문이 "제2재능 강화"라고만 한다. 무엇이 얼마나 강해지는지는
**재능 후보**(`talents[].candidates[]`)에 들어 있다 — 후보가 `requiredPotentialRank`로
갈라져 있어서, 그 잠재로 열리는 후보와 바로 아래 후보를 견주면 정확한 증가폭이 나온다.

    잠재5 "제2재능 강화"
      pot 0 : 배치 후 … 공격 속도 +8,  모든 피격 대미지가 25% 감소
      pot 4 : 배치 후 … 공격 속도 +10, 모든 피격 대미지가 30% 감소
    →  "공격 속도 +8 → +10 · 피격 대미지가 25% → 30%"

⚠ 언어를 가리지 않아야 한다. KR·EN·JA·CN 표가 저마다 어순이 달라서 라벨을 정규식으로
  집어내는 방식은 한 언어만 맞고 나머지가 깨진다. 그래서 **difflib으로 바뀐 구간만**
  집어내고, 그 앞 몇 글자를 문맥으로 붙인다 — 어느 언어에서든 같은 코드가 돈다.
"""
import difflib
import re

# 잠재 강화 표식: 게임이 상위 후보 안에 <@ba.talpu>(+2)</> 로 증가분을 이미 박아 둔다.
# 우리는 아래 후보와 직접 견주므로 이 표식은 **지우고** 비교한다 (안 지우면 "(+2)"가
# 통째로 '바뀐 구간'으로 잡혀 "+10(+2)" 같은 중복 표기가 나온다).
TALPU_RE = re.compile(r"<@ba\.talpu>(.*?)</>", re.S)
# ⚠ 번역문에서는 그 표식이 **태그가 아니라 평범한 괄호**로 남는다("공격력 +85%(+5%)").
#   태그만 지우면 미실장 오퍼(사전으로 옮긴 텍스트)에서 "방어력 8 → 11(+3)" 처럼 새어 나온다.
TALPU_PLAIN_RE = re.compile(r"\s*[（(]\s*\+[0-9.]+%?\s*[)）]")
TAG_RE = re.compile(r"<[^>]*>")
# 문맥을 자를 구분자 — 세 언어의 문장부호를 함께 본다
BREAK = "，,、。．.；;：:·・/()（）[]【】〈〉<>"


def _plain(s):
    if not s:
        return ""
    s = TALPU_RE.sub("", s)          # 증가분 표식 제거 (태그판)
    s = TAG_RE.sub("", s).replace("</>", "")
    s = TALPU_PLAIN_RE.sub("", s)    # 〃 (번역문에 남은 괄호판)
    return re.sub(r"\s+", " ", s).strip()


NUM_RE = re.compile(r"\d+(?:\.\d+)?")


def _tokens(s):
    """글자 단위로 쪼개되 **숫자는 통째로 한 토큰**으로 둔다.

    ⚠ 이게 없으면 difflib이 숫자 안을 갈라 버린다 — "20 → 26" 이 문맥 "…2" + "0 → 6" 으로,
      "110% → 113%" 가 "11" + "0% → 3%" 로 나왔다 (2026-09-04 첫 구현에서 실제로 그랬다).
    """
    out, i = [], 0
    for m in NUM_RE.finditer(s):
        out.extend(s[i:m.start()])
        out.append(m.group())
        i = m.end()
    out.extend(s[i:])
    return out


def _ctx(toks, lo, back=16):
    """바뀐 자리 앞의 짧은 문맥. 구분자까지 거슬러 오르되, back글자를 넘기면 **띄어쓰기에서**
    끊는다 — 글자 수로만 자르면 '공격 범위'가 '격 범위'로 잘린다(한국어·영어는 띄어쓰기가
    단어 경계다). 중국어·일본어는 띄어쓰기가 없어 back에서 그냥 끊긴다."""
    i, n = lo, 0
    while i > 0 and toks[i - 1] not in BREAK:
        if n >= back and toks[i - 1] == " ":
            break
        n += len(toks[i - 1])
        i -= 1
    # 뒤쪽 공백은 **살린다** — 잘라내고 붙이면 "대미지가25%" 처럼 한국어 띄어쓰기가 깨진다.
    return "".join(toks[i:lo]).lstrip()


def _span(toks, lo, hi):
    """바뀐 값 + 바로 뒤에 붙는 단위(%·초·秒 …)."""
    j = hi
    while j < len(toks) and toks[j] in ("%", "초", "秒", "s", "점", "개"):
        j += 1
    return "".join(toks[lo:j]).strip()


def talent_delta(lower, upper, sep=" · "):
    """재능 설명 두 개(아래 잠재 / 위 잠재)를 견줘 '문맥 A → B' 목록을 만든다.

    문맥은 **한 번만** 적는다 — 양쪽에 다 붙이면 "모든 적에게 공격력의 30 → 모든 적에게
    공격력의 32" 처럼 같은 말이 두 번 나와 읽기 나쁘다.
    """
    a, b = _plain(lower), _plain(upper)
    if not a or not b or a == b:
        return None
    ta, tb = _tokens(a), _tokens(b)
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    parts, seen = [], set()
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "replace":
            continue
        old, new = _span(ta, i1, i2), _span(tb, j1, j2)
        if not old or not new or old == new:
            continue
        ctx = _ctx(ta, i1)
        # 부호(+ -)는 값의 일부다 — 문맥에 남겨 두면 "공격 속도 + 8 → 10" 처럼 읽힌다
        sign = ""
        while ctx.rstrip() and ctx.rstrip()[-1] in "+-":
            ctx = ctx.rstrip()
            sign = ctx[-1] + sign
            ctx = ctx[:-1]
        if sign:
            old, new = sign + old, sign + new
            ctx = ctx.rstrip() + (" " if ctx.rstrip() and ctx.rstrip()[-1].isalnum() else "")
        key = (ctx, old, new)
        if key in seen:
            continue
        seen.add(key)
        parts.append(("%s%s → %s" % (ctx, old, new)) if ctx else ("%s → %s" % (old, new)))
    return sep.join(parts) or None


def _cands(t):
    return [c for c in (t.get("candidates") or []) if c]


def potential_detail(c, rank, tr=None):
    """`c`(character_table 항목)의 잠재 `rank`(2~6)가 재능 강화면 증가폭 문자열을 낸다.

    ⚠ `requiredPotentialRank` 는 **0 = 잠재1(기본)** 이다. 그래서 잠재 `rank` 에 대응하는
      값은 `rank - 1` — 처음에 `rank - 2` 로 잡았다가 증가폭이 **한 단계 위 잠재에** 붙었다
      (2026-09-04: 엑시아 P3 "제1재능 강화"인데 P4에 표시됐다). 엑시아로 검산해 둘 것 —
      P3 ↔ required 2, P6 ↔ required 5.

    `tr` 이 있으면 후보 설명을 견주기 전에 그것으로 한 번 옮긴다 (미실장 오퍼의 CN 원문용).
    같은 잠재가 재능을 여럿 건드리면 전부 모아 준다.
    """
    need = rank - 1
    out = []
    for idx, t in enumerate(c.get("talents") or []):
        cands = _cands(t)
        if not cands:
            continue
        # 이 잠재에서 열리는 후보들 (정예화 단계가 여럿이면 가장 높은 것)
        at = [x for x in cands if (x.get("requiredPotentialRank") or 0) == need]
        if not at:
            continue
        upper = at[-1]
        below = [x for x in cands if (x.get("requiredPotentialRank") or 0) < need]
        if not below:
            continue
        # 같은 정예화 단계끼리 견주는 게 정확하다 — 없으면 가장 높은 아래 후보
        ph = (upper.get("unlockCondition") or {}).get("phase")
        same = [x for x in below if (x.get("unlockCondition") or {}).get("phase") == ph]
        lower = (same or below)[-1]
        lo, up = lower.get("description"), upper.get("description")
        if tr:                       # 미실장 오퍼 — 사전으로 옮긴 뒤 견준다
            lo, up = tr(lo), tr(up)
        d = talent_delta(lo, up)
        if d:
            out.append(d)
    return " / ".join(out) or None


def build_potentials(c, strip_tags, tr=None):
    """잠재 목록 — `detail` 은 재능 강화형에만 붙고 나머지는 None."""
    out = []
    for i, p in enumerate(c.get("potentialRanks") or []):
        rank = i + 2
        out.append({"rank": rank,
                    "description": strip_tags(p.get("description")),
                    "detail": potential_detail(c, rank, tr)})
    return out
