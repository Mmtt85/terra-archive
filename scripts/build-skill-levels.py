#!/usr/bin/env python3
"""전투 스킬의 **레벨별 수치**(Lv.1~7 · 특화 M1~M3)를 오퍼별 JSON으로 뽑는다.

Usage: python3 scripts/build-skill-levels.py [gamedata-dir]   # default: .gamedata

출처는 클뜯 `skill_table.json`의 `levels[]` — 한 레벨 = 한 엔트리이고,
설명 문장은 보통 **레벨마다 똑같고 숫자만 바뀐다**(blackboard 값·초기 SP·지속시간).

⚠ 왜 operators.json에 안 넣는가: 948개 스킬 × 10레벨을 합치면 370KB(gzip 75KB)로
   operators.json(1.7MB, gzip 276KB)을 27% 불린다. 이 파일은 **번들에 통째로 실려**
   모든 페이지 첫 로딩에 들어가는데, 레벨 수치는 오퍼 상세 모달에서만 쓴다 —
   profiles/skins/voice와 같은 관례로 **오퍼당 파일 1개**(평균 0.9KB)를 만들어
   public/skills/<locale>/<id>.json 에 쓰고 모달을 열 때만 받아온다
   (R2 서빙 — scripts/r2-sync.mjs의 DIRS에 "skills"가 있어야 한다).

⚠ 설명 문장은 **템플릿 + 값**으로 쪼갠다. 레벨마다 완성문을 10개 저장하면 같은 문장이
   10번 반복되므로, 레벨 사이에 **실제로 변하는 자리만** `{0}`·`{1}` 마커로 남기고
   변하지 않는 값은 문장에 그대로 박아 둔다. 화면에서는 마커 자리에 그 레벨 값을 끼워
   넣고 강조 표시한다 — 어떤 수치가 레벨을 타는지 한눈에 보인다.

⚠ 특화(M1~M3)에서 **문장 자체가 달라지는 스킬이 83개** 있다(효과가 추가되는 경우).
   그래서 템플릿은 배열이고, `ti`(레벨→템플릿 색인)가 있으면 레벨마다 다른 문장을 쓴다.

⚠ 미실장(CN 선행) 오퍼는 로케일 스킬 테이블에 없어 CN 테이블로 폴백하는데, 그대로 쓰면
   **중국어 원문이 화면에 샌다** — operators.json의 설명은 이미 AI 번역본이기 때문이다.
   그래서 폴백일 때는 CN 템플릿을 버리고, **operators.json(로케일본)의 최고레벨 설명에서
   변하는 값의 자리를 찾아** 템플릿을 되만든다. 자리를 못 찾으면 tpl 없이 sp·지속만 낸다
   (화면은 기존 설명을 그대로 쓰고 레벨 탭으로 SP·지속만 바뀐다).

출력 형식 — 키는 스킬 id:
  {"skchr_texas_2": {
     "tpl": ["배치 코스트 {0} 즉시 획득. … 공격력 {1}만큼 … {2}초간 기절시킨다."],
     "v":   [["9","105%","2"], …],   # 레벨별 값 (변하는 자리만, tpl 마커 순서)
     "sp":  [[20,40], …],            # [초기 SP, 소모 SP] — 레벨을 탈 때만
     "d":   [20, …],                 # 지속시간(초) — 레벨을 탈 때만
     "ti":  [0,0,0,0,0,0,0,1,1,1],   # 레벨→tpl 색인 — 템플릿이 2개 이상일 때만
     "rg":  [[{"row":0,"col":1}, …], …],  # 공격 범위 — **레벨마다 달라질 때만** (7개 스킬)
     "ri":  [0,0,0,0,0,1,1,1,1,1]}}  # 레벨→rg 색인. 레벨을 안 타면 operators.json의 것 하나로 충분
  배열 길이 = 레벨 수(보통 10, 특화가 없는 스킬은 7).
"""
import json
import os
import re
import shutil
import sys
from collections import Counter

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = f"{REPO}/public/skills"

load = lambda p: json.load(open(p, encoding="utf-8"))

# 로케일 → (테이블 접두사, 폴백). 미실장 오퍼는 로케일 테이블에 없어 CN 원문으로 폴백한다
# (프로필·보이스와 같은 관례).
LOCALES = {"ko": ("kr", "cn"), "en": ("en", "cn"), "ja": ("jp", "cn")}
MANUAL = {}

# regen-operators.py의 interpolate와 같은 토큰 문법 — 정본은 저기다.
TOKEN = re.compile(r"\{(-?)([a-zA-Z0-9_.\[\]@]+)(?::([^}]*))?\}")


def strip_tags(s):
    if not s:
        return s
    s = re.sub(r"<[@$/][^>]*>", "", s).replace("</>", "")
    s = re.sub(r"<[a-zA-Z][^>]*>", "", s)
    s = s.replace("\\n", " ").replace("\n", " ")
    return re.sub(r"\s+", " ", s).strip()


def fmt_num(v):
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, float):
        v = round(v, 2)
    return str(v)


def blackboard(level):
    bb = {}
    for e in level.get("blackboard") or []:
        bb[str(e.get("key", "")).lower()] = e.get("valueStr") if e.get("valueStr") is not None else e.get("value")
    return bb


def value_at(match, bb):
    """토큰 하나를 그 레벨의 값으로 — regen-operators.py의 interpolate와 같은 규칙."""
    neg, key, fmt = match.group(1) == "-", match.group(2).lower(), match.group(3) or ""
    if key not in bb:
        return ""
    v = bb[key]
    if isinstance(v, str):
        return v
    if neg:
        v = -v
    if "%" in fmt:
        v = v * 100
        v = int(round(v)) if abs(v - round(v)) < 1e-6 else round(v, 1)
        return f"{v}%"
    return fmt_num(v)


def duration_of(level):
    d = level.get("duration")
    if d is None or d <= 0:
        return None
    return int(d) if float(d).is_integer() else round(d, 1)


# 값이 문장 안에서 **독립된 수치로** 나타나는 자리만 (105% 안의 10, 2회 안의 2 오인 방지)
def standalone(text, value):
    if not value:
        return []
    spans = []
    for m in re.finditer(re.escape(value), text):
        before = text[m.start() - 1] if m.start() else ""
        after = text[m.end()] if m.end() < len(text) else ""
        after2 = text[m.end() + 1] if m.end() + 1 < len(text) else ""
        if before.isdigit() or before in ".%":
            continue
        if after.isdigit() or after == "%":
            continue
        # ⚠ 마침표는 소수점일 때만 거른다 — "공격력 +70%. 앞쪽으로…"처럼 **문장이 끝나는
        #   마침표**까지 소수점으로 보는 바람에 멀쩡한 자리를 버렸다. 그 탓에 Thumpy S2·S3,
        #   안젤리나 얼터 S3의 레벨 탭이 문구를 못 바꿨다 (사용자 지적 2026-08-01).
        if after == "." and after2.isdigit():
            continue
        spans.append((m.start(), m.end()))
    return spans


def retemplate(text, values):
    """이미 번역된 최고레벨 문장에서 변하는 값의 자리를 찾아 {n} 마커로. 실패하면 None.

    ⚠ **같은 값이 여러 번 나오는 문장**은 예전엔 통째로 포기했다 — Thumpy S1
    "공격력 +50%, 방어력 +50%"처럼 최고레벨에서 두 수치가 우연히 같으면 그렇게 된다.
    그 바람에 CN 폴백 오퍼의 레벨 탭이 **설명은 그대로인 채 SP만 바뀌어**, 레벨을 눌러도
    아무것도 안 변하는 것처럼 보였다 (사용자 지적 2026-08-01).
    이제 **CN 템플릿의 슬롯 순서와 번역문의 등장 순서를 1:1로** 짝지어 나눠 갖는다.
    값 개수와 등장 횟수가 정확히 맞을 때만 — 남거나 모자라면 어느 자리인지 알 수 없으므로
    종전대로 포기한다(원문 유출·오표기보다 텍스트를 안 내는 쪽이 낫다).
    """
    need = Counter(values)
    spans_by_value = {}
    for value, count in need.items():
        spans = standalone(text, value)
        if len(spans) != count:
            return None
        spans_by_value[value] = spans
    used = Counter()
    picked = []
    for i, value in enumerate(values):
        start, end = spans_by_value[value][used[value]]
        used[value] += 1
        picked.append((start, end, i))
    picked.sort()
    for a, b in zip(picked, picked[1:]):
        if a[1] > b[0]:
            return None                      # 자리가 겹치면 포기
    out, last = [], 0
    for start, end, i in picked:
        out.append(text[last:start])
        out.append("{%d}" % i)
        last = end
    out.append(text[last:])
    return "".join(out)


def build_skill(entry, ranges=None):
    """스킬 하나 → {tpl, v, sp, d, ti}. 레벨이 하나뿐이면 None."""
    levels = entry.get("levels") or []
    if len(levels) < 2:
        return None
    raws = [l.get("description") or "" for l in levels]
    bbs = [blackboard(l) for l in levels]

    # 원문 템플릿이 같은 레벨끼리 묶어서 처리한다 (특화에서 문장이 바뀌는 스킬 때문).
    groups = []
    for raw in raws:
        if raw not in groups:
            groups.append(raw)
    tpls = []
    vals = [[] for _ in levels]
    for raw in groups:
        rows = [i for i, r in enumerate(raws) if r == raw]
        tokens = list(TOKEN.finditer(raw))
        columns = [[value_at(tok, bbs[i]) for i in rows] for tok in tokens]
        varying = [j for j, col in enumerate(columns) if len(set(col)) > 1]
        out, last, slot = [], 0, 0
        for j, tok in enumerate(tokens):
            out.append(raw[last:tok.start()])
            if j in varying:
                out.append("{%d}" % slot)
                slot += 1
            else:
                out.append(columns[j][0])   # 레벨을 안 타는 값은 문장에 박아 둔다
            last = tok.end()
        out.append(raw[last:])
        tpls.append(strip_tags("".join(out)))
        for k, i in enumerate(rows):
            vals[i] = [columns[j][k] for j in varying]

    doc = {"tpl": tpls}
    if any(vals):
        doc["v"] = vals
    sp = [[l.get("spData", {}).get("initSp"), l.get("spData", {}).get("spCost")] for l in levels]
    if len({tuple(x) for x in sp}) > 1:
        doc["sp"] = sp
    dur = [duration_of(l) for l in levels]
    if len(set(dur)) > 1:
        doc["d"] = dur
    if len(groups) > 1:
        doc["ti"] = [groups.index(r) for r in raws]
    # 공격 범위가 레벨마다 달라지는 스킬(실측 7개) — 화면의 Lv 탭을 따라가야 하므로
    # 여기 실어 보낸다. 레벨 내내 같으면 operators.json의 skill.range 하나로 충분하다.
    rids = [l.get("rangeId") for l in levels]
    if ranges and len(set(rids)) > 1:
        uniq = sorted({r for r in rids if r})
        if all(r in ranges for r in uniq):
            doc["rg"] = [[{"row": g["row"], "col": g["col"]} for g in ranges[r]["grids"]] for r in uniq]
            # rangeId가 없는 레벨(= 기본 범위)은 -1로 둔다 — 화면이 오퍼 기본 범위를 쓴다
            doc["ri"] = [uniq.index(r) if r else -1 for r in rids]
    # 레벨을 타는 게 하나도 없으면(패시브 등) 레벨 표시가 무의미하다
    if not any(k in doc for k in ("v", "sp", "d", "ti", "ri")):
        return None
    return doc


def cn_interpolated(level):
    """레벨 하나의 CN 설명을 값까지 채워 넣은 문장 — regen-operators가 만드는 것과 같은 형태라
    scripts/cn-translations.json의 **키로 그대로 쓸 수 있다**."""
    raw = level.get("description") or ""
    bb = blackboard(level)
    out, last = [], 0
    for m in TOKEN.finditer(raw):
        out.append(raw[last:m.start()])
        out.append(value_at(m, bb))
        last = m.end()
    out.append(raw[last:])
    return strip_tags("".join(out))


def localize_fallback(doc, description, entry=None, locale="ko", manual=None):
    """CN 폴백 스킬 → 번역된 문장으로 템플릿을 되만들거나, 못 하면 텍스트를 뺀다.

    ⚠ 특화에서 **문장 자체가 바뀌는 스킬**(ti)은 최고레벨 번역 하나로는 나머지 변형을 만들
    수 없어 예전엔 통째로 포기했다 — 이격 안젤리나 S2가 그 예 (사용자 요청 2026-08-01).
    이제 변형별 대표 레벨의 CN 보간문을 **cn-translations.json에서 찾아** 각각 되만든다.
    한 변형이라도 번역이 없으면 종전대로 전부 뺀다(원문 유출 방지).
    """
    values = doc.get("v")
    if not values:
        doc.pop("tpl", None); doc.pop("v", None); doc.pop("ti", None)
        return doc

    ti = doc.get("ti")
    if not ti:
        tpl = retemplate(description or "", values[-1])
        if tpl is None:
            doc.pop("tpl", None); doc.pop("v", None)
            return doc
        doc["tpl"] = [tpl]
        return doc

    # ti 있음 — 변형마다 대표 레벨(그 변형의 최고 레벨)을 잡아 번역문을 구한다
    levels = (entry or {}).get("levels") or []
    tpls = []
    for g in range(len(doc.get("tpl") or [])):
        rows = [i for i, x in enumerate(ti) if x == g]
        if not rows or not levels:
            return _drop_text(doc)
        top = max(rows)
        text = description if top == len(ti) - 1 else None   # 최고 레벨은 operators.json 것
        if text is None:
            hit = (manual or {}).get(cn_interpolated(levels[top]))
            text = (hit or {}).get(locale) or ""
        tpl = retemplate(text, values[top]) if text else None
        if tpl is None:
            return _drop_text(doc)
        tpls.append(tpl)
    doc["tpl"] = tpls
    return doc


def _drop_text(doc):
    doc.pop("tpl", None); doc.pop("v", None); doc.pop("ti", None)
    return doc


def main():
    ops = load(f"{REPO}/app/data/operators.json")
    # 미실장 오퍼 텍스트의 비공식 번역 사전 — ti 변형 문장을 여기서 찾는다 (regen-operators와 공용)
    mpath = f"{REPO}/scripts/cn-translations.json"
    global MANUAL
    MANUAL = load(mpath) if os.path.exists(mpath) else {}
    # 로케일별 operators.json — 미실장 오퍼 폴백 시 번역된 설명을 여기서 가져온다
    op_text = {}
    for locale in LOCALES:
        path = f"{REPO}/app/data/operators.json" if locale == "ko" else f"{REPO}/app/data/operators.{locale}.json"
        rows = load(path) if os.path.exists(path) else []
        op_text[locale] = {o["id"]: {s["id"]: s.get("description") or "" for s in o["skills"]} for o in rows}
    # 범위 격자는 언어와 무관하다 — KR 우선, 없으면 CN
    ranges = {}
    for prefix in ("kr", "cn"):
        rp = f"{S}/{prefix}_range_table.json"
        if os.path.exists(rp):
            raw = load(rp)
            ranges = raw.get("range", raw)
            break
    tables = {}
    for prefix in {p for pair in LOCALES.values() for p in pair}:
        path = f"{S}/{prefix}_skill_table.json"
        if not os.path.exists(path):
            print(f"  ⚠ {path} 없음 — 이 접두사는 건너뜁니다")
            continue
        table = load(path)
        tables[prefix] = table.get("skills", table)

    for locale, (main_prefix, fallback) in LOCALES.items():
        out_dir = f"{OUT_ROOT}/{locale}"
        shutil.rmtree(out_dir, ignore_errors=True)
        os.makedirs(out_dir, exist_ok=True)
        wrote = fell_back = skipped = 0
        total_skills = 0
        for op in ops:
            doc = {}
            used_fallback = False
            for skill in op["skills"]:
                sid = skill["id"]
                entry = (tables.get(main_prefix) or {}).get(sid)
                from_cn = False
                if entry is None and fallback in tables:
                    entry = tables[fallback].get(sid)
                    from_cn = used_fallback = entry is not None
                if entry is None:
                    continue
                built = build_skill(entry, ranges)
                if built and from_cn:
                    built = localize_fallback(built, (op_text[locale].get(op["id"]) or {}).get(sid, ""),
                                              entry, locale, MANUAL)
                    if not any(k in built for k in ("v", "sp", "d")):
                        built = None
                if built:
                    doc[sid] = built
            if not doc:
                skipped += 1
                continue
            with open(f"{out_dir}/{op['id']}.json", "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
            wrote += 1
            total_skills += len(doc)
            fell_back += 1 if used_fallback else 0
        size = sum(os.path.getsize(f"{out_dir}/{n}") for n in os.listdir(out_dir))
        print(f"{locale}: {wrote}명 · 스킬 {total_skills}개 · {size/1024:.0f}KB"
              f" (CN 폴백 {fell_back} · 레벨 수치 없음 {skipped})")


if __name__ == "__main__":
    main()
