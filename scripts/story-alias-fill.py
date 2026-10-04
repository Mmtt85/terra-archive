#!/usr/bin/env python3
"""EN/JA 요약의 인물·용어 카드에 **그 언어의 별칭**을 붙인다 (2026-10-04 사용자 지시).

왜: TRANSLATE.md 는 `alias` 를 한국어 그대로 두라고 했다 — 전문 보기(한국어 원문)의 화자 이름을 카드와
잇는 데 쓰이기 때문이다. 그런데 화면 본문 밑줄(app/story.tsx entityMatcher)도 이 alias 로 찾아서,
EN/JA 본문에서 짧은 이름·별칭으로만 나오는 곳('Severin', 'Lin', 'ユーシャ', 'Woodframe')엔 밑줄이 안 걸렸다.
이제 alias 는 **[한국어 별칭 그대로…] + [그 언어 별칭…]** 이다 (앞부분 = KO 그대로, 뒤에 덧붙임).
story-i18n-merge.py 는 앞부분이 KO 와 같은지만 본다.

  python3 scripts/story-alias-fill.py normalize      # 옛 번역이 KO 별칭 자리를 덮어쓴 것 → KO 를 앞에 되살린다
  python3 scripts/story-alias-fill.py table OUT.json # 작업표 — ① 인물 이름 토막 후보(Severin Hawthorn → Severin)
                                                     #   ② KO 별칭이 나오는 문단을 EN/JA 문단과 짝지은 것(번역 표기 찾기)
                                                     #   둘 다 사람(에이전트)이 보고 고른다 — 자동으로 붙이면 'Mr.'·'Caster' 가 섞였다
  python3 scripts/story-alias-fill.py apply ANS.json # 작업표 답 {"en"|"ja": [{"eid","grp","i","alias":[…]}]} 를 검사해 붙인다

붙이기 전 검사(apply): 그 언어 본문에 **독립된 낱말로** 한 번 이상 나와야 하고(EN 은 앞뒤가 로마자·숫자가
아님, JA 는 앞뒤가 가타카나가 아님), **다른 낱말 속에 박힌 채로는 한 번도 나오지 않아야** 하며(JA 'リン' 이
'ドリンク' 에 걸리는 것 — 화면은 JA 경계를 모른다), 같은 이벤트의 다른 카드 이름·별칭과 겹치면 안 된다.
"""
import glob
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
I18N = os.path.join(REPO, "scripts", "story-i18n")
KO = json.load(open(os.path.join(REPO, "app/data/story-summaries.json"), encoding="utf-8"))
GRPS = ("chars", "terms")

# 이름 토막으로 떼어 쓰면 안 되는 말 — 직함·관사·흔한 형용사
EN_STOP = {
    "the", "of", "and", "von", "van", "de", "der", "del", "la", "le", "di", "da", "mr", "mrs", "ms", "miss", "sir", "lady", "lord",
    "count", "countess", "duke", "duchess", "baron", "marquis", "king", "queen", "prince", "princess", "captain", "general",
    "old", "big", "little", "great", "grand", "high", "young", "elder", "master", "doctor", "dr", "professor", "inquisitor",
    "knight", "saint", "saintess", "father", "mother", "brother", "sister", "uncle", "aunt", "chief", "boss", "officer",
    "red", "black", "white", "blue", "iron", "dark", "light", "silver", "golden", "mister", "madam", "madame", "team", "squad",
}
KATA = "ァ-ヺー"


def body(t):
    parts = [t.get("tagline", "")]
    for b in t.get("blocks", []):
        parts.append(b.get("x", ""))
        parts.append(b.get("cap", ""))
    return "\n".join(p for p in parts if p).replace("**", "")


def hits(loc, text, a):
    """(독립 출현 수, 박힌 출현 수)"""
    esc = re.escape(a)
    if loc == "en":
        alone = len(re.findall(rf"(?<![A-Za-z0-9]){esc}(?![A-Za-z0-9])", text))
        total = len(re.findall(esc, text))
    else:
        alone = len(re.findall(rf"(?<![{KATA}]){esc}(?![{KATA}])", text))
        total = len(re.findall(esc, text))
    return alone, total - alone


def files():
    for loc in ("en", "ja"):
        for f in sorted(glob.glob(os.path.join(I18N, loc, "*.json"))):
            eid = os.path.basename(f)[:-5]
            if eid in KO:
                yield loc, eid, f


def load(f):
    return json.load(open(f, encoding="utf-8"))


def save(f, t):
    with open(f, "w", encoding="utf-8") as fp:
        json.dump(t, fp, ensure_ascii=False, indent=2)
        fp.write("\n")


def taken(t, skip):
    """같은 이벤트의 다른 카드가 쓰는 이름·별칭"""
    out = set()
    for g in GRPS:
        for i, e in enumerate(t.get(g, [])):
            if (g, i) == skip:
                continue
            out.add(e.get("name", ""))
            out.update(e.get("alias") or [])
    return out


def add(loc, t, g, i, cands, text, ko_alias):
    e = t[g][i]
    cur = list(e.get("alias") or [])
    added = []
    for a in cands:
        a = a.strip()
        if not a or a in cur or a == e.get("name") or a in taken(t, (g, i)):
            continue
        alone, embedded = hits(loc, text, a)
        if alone == 0 or embedded > 0:
            continue
        if loc == "ja" and re.fullmatch(f"[{KATA}]+", a) and len(a) < 3:
            continue  # 두 글자 가타카나는 다른 이벤트·다른 낱말에 너무 쉽게 걸린다
        cur.append(a)
        added.append(a)
    if added:
        e["alias"] = cur
    return added


def cmd_normalize():
    n = 0
    for loc, eid, f in files():
        t = load(f)
        ch = False
        for g in GRPS:
            for k, e in zip(KO[eid][g], t.get(g, [])):
                ka, ta = k.get("alias") or [], e.get("alias") or []
                if ta[: len(ka)] != ka:
                    e["alias"] = ka + [a for a in ta if a not in ka]
                    ch = True
                    n += 1
        if ch:
            save(f, t)
    print(f"normalize: {n}개 카드의 KO 별칭을 앞에 되살림")


def name_tokens(loc, name, text):
    """인물 이름 토막 후보 (Severin Hawthorn → Severin). 직함·흔한 낱말은 거른다 — 그래도 틀린 것이 섞이므로
    (Duke of Caster → Caster) 자동으로 붙이지 않고 작업표에 실어 검토받는다."""
    if loc == "en" and re.search(r"\bof\b", name):
        return []
    toks = re.split(r"[\s・＝=]+", name) if loc == "ja" else re.split(r"\s+", name)
    if len(toks) < 2:
        return []
    out = []
    for tok in toks:
        tok = tok.strip("'\"「」()（）.,")
        if loc == "en":
            if len(tok) < 3 or not tok[0].isupper() or tok.lower() in EN_STOP:
                continue
            if re.search(rf"(?<![A-Za-z]){re.escape(tok.lower())}(?![A-Za-z])", text):
                continue  # 소문자로도 쓰이는 흔한 낱말
        elif len(tok) < 2:
            continue
        alone, embedded = hits(loc, text.replace(name, ""), tok)
        if alone and not embedded:
            out.append(tok)
    return out


def cmd_table(out):
    tasks = {"en": [], "ja": []}
    for loc, eid, f in files():
        t = load(f)
        text = body(t)
        for i, e in enumerate(t.get("chars", [])):
            toks = name_tokens(loc, e.get("name", ""), text)
            if toks:
                tasks[loc].append({"eid": eid, "grp": "chars", "i": i, "kind": "name-token", "ko_name": KO[eid]["chars"][i].get("name"),
                                   "name": e.get("name"), "desc": e.get("desc", "")[:80], "candidates": toks})
        kb, tb = KO[eid]["blocks"], t.get("blocks", [])
        if len(kb) != len(tb):
            continue
        for g in GRPS:
            for i, (k, e) in enumerate(zip(KO[eid][g], t.get(g, []))):
                have = set(e.get("alias") or []) - set(k.get("alias") or [])
                for a in k.get("alias") or []:
                    pairs = []
                    for kb_, tb_ in zip(kb, tb):
                        kx = (kb_.get("x") or "") + (kb_.get("cap") or "")
                        if a in kx:
                            p = kx.find(a)
                            pairs.append({"ko": kx[max(0, p - 60): p + 80], "tr": ((tb_.get("x") or "") + (tb_.get("cap") or ""))[:400]})
                        if len(pairs) >= 2:
                            break
                    if not pairs:
                        continue  # 한국어 본문에도 안 나오는 별칭(원문 화자 매칭용) — 번역 표기 불필요
                    tasks[loc].append({"eid": eid, "grp": g, "i": i, "kind": "ko-alias", "ko_name": k.get("name"), "name": e.get("name"),
                                       "ko_alias": a, "have": sorted(have), "pairs": pairs})
    json.dump(tasks, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"table: en {len(tasks['en'])} · ja {len(tasks['ja'])} → {out}")


def cmd_apply(ans):
    data = json.load(open(ans, encoding="utf-8"))
    n = skip = 0
    for loc, rows in data.items():
        by = {}
        for r in rows:
            by.setdefault(r["eid"], []).append(r)
        for eid, rs in by.items():
            f = os.path.join(I18N, loc, f"{eid}.json")
            t = load(f)
            text = body(t)
            ch = False
            for r in rs:
                want = [a for a in r.get("alias", []) if a]
                added = add(loc, t, r["grp"], r["i"], want, text, None)
                n += len(added)
                skip += len(want) - len(added)
                ch = ch or bool(added)
            if ch:
                save(f, t)
    print(f"apply: 별칭 {n}개 추가 · 검사에서 뺀 것 {skip}개(이미 있음·본문에 없음·다른 낱말에 박힘·다른 카드와 겹침)")


if __name__ == "__main__":
    c = sys.argv[1] if len(sys.argv) > 1 else ""
    if c == "normalize":
        cmd_normalize()
    elif c == "table":
        cmd_table(sys.argv[2])
    elif c == "apply":
        cmd_apply(sys.argv[2])
    else:
        print(__doc__)
