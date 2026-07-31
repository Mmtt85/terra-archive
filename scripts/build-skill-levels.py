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

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = f"{REPO}/public/skills"

load = lambda p: json.load(open(p, encoding="utf-8"))

# 로케일 → (테이블 접두사, 폴백). 미실장 오퍼는 로케일 테이블에 없어 CN 원문으로 폴백한다
# (프로필·보이스와 같은 관례).
LOCALES = {"ko": ("kr", "cn"), "en": ("en", "cn"), "ja": ("jp", "cn")}

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
        if before.isdigit() or before in ".%":
            continue
        if after.isdigit() or after in ".%":
            continue
        spans.append((m.start(), m.end()))
    return spans


def retemplate(text, values):
    """이미 번역된 최고레벨 문장에서 변하는 값의 자리를 찾아 {n} 마커로. 실패하면 None."""
    picked = []
    for i, value in enumerate(values):
        spans = standalone(text, value)
        if len(spans) != 1:
            return None
        picked.append((spans[0][0], spans[0][1], i))
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


def localize_fallback(doc, description):
    """CN 폴백 스킬 → 번역된 설명으로 템플릿을 되만들거나, 못 하면 텍스트를 뺀다."""
    values = doc.get("v")
    if doc.get("ti") or not values:
        doc.pop("tpl", None); doc.pop("v", None); doc.pop("ti", None)
        return doc
    tpl = retemplate(description or "", values[-1])
    if tpl is None:
        doc.pop("tpl", None); doc.pop("v", None)
        return doc
    doc["tpl"] = [tpl]
    return doc


def main():
    ops = load(f"{REPO}/app/data/operators.json")
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
                    built = localize_fallback(built, (op_text[locale].get(op["id"]) or {}).get(sid, ""))
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
