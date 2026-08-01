#!/usr/bin/env python3
"""오퍼레이터 프로필(아카이브 파일) 텍스트를 오퍼별 JSON으로 뽑는다.

Usage: python3 scripts/build-profiles.py [gamedata-dir]   # default: .gamedata

출처는 클뜯 `handbook_info_table.json`의 `handbookDict[*].storyTextAudio` —
게임 내 오퍼레이터 기록실의 '기본정보 / 종합검진 / 프로필 / 임상 진단 분석 /
파일 자료 N / 승진 기록' 문서 전문이다. KR·EN·JP 테이블이 각각 공식 번역이라
AI 번역을 거치지 않는다 (미실장 오퍼만 CN을 폴백으로 쓴다).

⚠ 왜 operators.json에 안 넣는가: 전문을 합치면 4.5MB로 operators.json(1.7MB)의
약 3배다. operators.json은 목록 화면에 통째로 실리므로 넣으면 첫 로딩이 무거워진다.
그래서 **오퍼당 파일 1개**(평균 ~11KB)로 쪼개 public/profiles/<locale>/<id>.json에
쓰고, 상세 모달을 열 때만 그 한 장을 받아온다(R2 서빙 — scripts/r2-sync.mjs).

출력 형식 (배열, 게임 내 문서 순서):
  [{ "title": "기본정보", "text": "...", "unlock": null },
   { "title": "임상 진단 분석", "text": "...", "unlock": {"type": "FAVOR", "param": "25"} }]
  unlock: null = 즉시 열람(DIRECT). FAVOR=신뢰도, AWAKE=승진(param "2;1" = 정예화2 1단계).
"""
import json
import os
import re
import shutil
import sys

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = f"{REPO}/public/profiles"

load = lambda p: json.load(open(p, encoding="utf-8"))

# 사이트에 수록된 오퍼만 — 클뜯엔 NPC·적 핸드북도 섞여 있다
ops = [o["id"] for o in load(f"{REPO}/app/data/operators.json")]

# 로케일 → (핸드북 테이블 접두사, 폴백 접두사). 미실장 오퍼는 로케일 테이블에 아직
# 없으므로 CN 원문으로 폴백한다 (사이트가 빈 화면이 되는 것보다 낫다 — 모달이 원문
# 표기임을 안내한다).
LOCALES = {"ko": ("kr", "cn"), "en": ("en", "cn"), "ja": ("jp", "cn")}


def clean(s):
    """게임 텍스트 태그 정리 — <color>·<@…> 류를 걷어내고 줄바꿈은 살린다."""
    if not s:
        return ""
    s = re.sub(r"<[@$/][^>]*>", "", s).replace("</>", "")
    s = re.sub(r"</?[a-zA-Z][^>]*>", "", s)
    s = s.replace("\\n", "\n").replace("\r\n", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return "\n".join(line.strip() for line in s.split("\n")).strip()


def sections(entry):
    out = []
    for sta in entry.get("storyTextAudio") or []:
        title = (sta.get("storyTitle") or "").strip()
        for st in sta.get("stories") or []:
            text = clean(st.get("storyText"))
            if not text:
                continue
            kind = st.get("unLockType")
            param = st.get("unLockParam")
            out.append({
                "title": title,
                "text": text,
                # DIRECT(즉시)·빈 조건은 null로 접어 파일을 가볍게 한다
                "unlock": None if kind in (None, "", "DIRECT") else {"type": kind, "param": param},
            })
    return out


# 미실장 오퍼의 CN 원문을 비공식 번역으로 덮어쓴다 (regen-operators와 같은 사전).
# 제목 10종은 전부 번역돼 있고, 본문은 채워진 것만 바뀐다 — 없으면 원문 유지 + 경고.
MANUAL_PATH = f"{REPO}/scripts/cn-translations.json"
MANUAL = load(MANUAL_PATH) if os.path.exists(MANUAL_PATH) else {}
untranslated = []


def harvest_lines(loc_table, cn_table):
    """KR·CN 양쪽에 있는 오퍼(415명)의 프로필을 **줄 단위로 짝지어** CN→로케일 사전을 만든다.

    프로필 앞부분은 정형이라 줄 순서가 양쪽에서 같다:
      CN 【代号】银灰 / 【性别】男 …   KR [코드네임] 실버애쉬 / [성별] 남 …
    같은 섹션에서 줄 수가 일치할 때만 i번째끼리 짝지어 다수결로 뽑는다. 오퍼마다 고유한
    산문 줄은 표가 1이라 다른 오퍼에 잘못 붙을 일이 없다(그 오퍼는 어차피 실장분이라
    폴백 경로를 안 탄다). 필드명·수치·감염 상태 문장이 **공식 번역 그대로** 잡힌다.
    """
    votes = {}
    for cid, cn_entry in cn_table.items():
        loc_entry = loc_table.get(cid)
        if not loc_entry:
            continue
        cn_secs, loc_secs = sections(cn_entry), sections(loc_entry)
        if len(cn_secs) != len(loc_secs):
            continue
        for a, b in zip(cn_secs, loc_secs):
            al = (a.get("text") or "").split("\n")
            bl = (b.get("text") or "").split("\n")
            if len(al) != len(bl):
                continue
            for x, y in zip(al, bl):
                x, y = x.strip(), y.strip()
                if not x or not y or x == y or not CJK_RE.search(x):
                    continue
                votes.setdefault(x, {}).setdefault(y, 0)
                votes[x][y] += 1
    return {k: max(v.items(), key=lambda kv: kv[1])[0] for k, v in votes.items()}


FIELD_CN = re.compile(r"^【([^】]+)】(.*)$")
# 괄호 모양까지 통째로 잡는다 — KR/EN은 [필드], JA는 【フィールド】가 공식 표기다
FIELD_LOC = re.compile(r"^([\[【][^\]】]+[\]】])\s*(.*)$")
DATE_CN = re.compile(r"^(\d{1,2})月(\d{1,2})日$")
DATE_FMT = {"ko": "{m}월 {d}일", "ja": "{m}月{d}日",
            "en": "{mon} {d}"}
EN_MONTHS = ["January", "February", "March", "April", "May", "June",
             "July", "August", "September", "October", "November", "December"]


def harvest_fields(loc_table, cn_table):
    """줄 전체가 안 맞아도 **필드명만은** 짝지어 둔다 — 코드명·생일처럼 값이 오퍼마다 달라
    줄 통째로는 사전에 안 잡히는 항목용 (【代号】→[코드네임])."""
    votes = {}
    for cid, cn_entry in cn_table.items():
        loc_entry = loc_table.get(cid)
        if not loc_entry:
            continue
        cn_secs, loc_secs = sections(cn_entry), sections(loc_entry)
        if len(cn_secs) != len(loc_secs):
            continue
        for a, b in zip(cn_secs, loc_secs):
            al, bl = (a.get("text") or "").split("\n"), (b.get("text") or "").split("\n")
            if len(al) != len(bl):
                continue
            for x, y in zip(al, bl):
                mx, my = FIELD_CN.match(x.strip()), FIELD_LOC.match(y.strip())
                if not mx or not my:
                    continue
                votes.setdefault(mx.group(1), {}).setdefault(my.group(1), 0)
                votes[mx.group(1)][my.group(1)] += 1   # 값은 '【코드네임】' 처럼 괄호째
    return {k: max(v.items(), key=lambda kv: kv[1])[0] for k, v in votes.items()}


def localize_value(value, loc, op_name):
    """필드 값 — 생일은 로케일 날짜 형식으로, 코드명은 그 오퍼의 로케일 이름으로."""
    m = DATE_CN.match(value)
    if m:
        mo, day = int(m.group(1)), int(m.group(2))
        if loc == "en":
            return f"{EN_MONTHS[mo - 1]} {day}"
        return DATE_FMT[loc].format(m=mo, d=day)
    return op_name or value


def localize_fields(text, fields, loc, op_name):
    """줄 사전에서 못 찾은 【필드】값 줄 — 필드명은 사전으로, 값은 규칙으로 옮긴다."""
    if not text:
        return text
    out = []
    for line in text.split("\n"):
        m = FIELD_CN.match(line.strip())
        if not m or m.group(1) not in fields:
            out.append(line)
            continue
        label, value = fields[m.group(1)], m.group(2).strip()   # label에 괄호가 이미 들어 있다
        if not value:
            out.append(label)
            continue
        sep = "" if label.endswith("】") else " "              # JA 공식 표기는 붙여 쓴다
        out.append(f"{label}{sep}{localize_value(value, loc, op_name if m.group(1) == '代号' else None)}")
    return "\n".join(out)


def localize_lines(text, table):
    """줄 단위로 수확 사전을 적용 — 못 찾은 줄(오퍼 고유 산문)은 원문 그대로 둔다."""
    if not text:
        return text, 0
    out, left = [], 0
    for line in text.split("\n"):
        hit = table.get(line.strip())
        if hit:
            out.append(hit)
        else:
            out.append(line)
            if CJK_RE.search(line):
                left += len(line)
    return "\n".join(out), left


def localize(text, loc, cid, what):
    """CN 원문 한 덩어리 → 사전에 있으면 그 로케일 번역, 없으면 원문 그대로(+경고 집계).
    섹션 제목처럼 **한 덩어리가 곧 키**인 것에만 쓴다 (본문은 줄 단위 manual_lines를 쓸 것)."""
    if not text:
        return text
    hit = MANUAL.get(text)
    if hit and hit.get(loc):
        return hit[loc]
    if CJK_RE.search(text):
        untranslated.append((loc, cid, what, len(text)))
    return text


CJK_RE = re.compile(r"[\u3400-\u9fff]")

# 수동 사전을 로케일별 {CN 줄: 번역} 로 펴 둔다 — 본문은 줄 단위로 갈아 끼운다
manual_lines = {loc: {k: v[loc] for k, v in MANUAL.items() if isinstance(v, dict) and v.get(loc)}
                for loc in LOCALES}

written = {}
harvested = {}
harvested_fields = {}
# 로케일별 오퍼 이름 — 코드명 줄에 그 오퍼의 이름을 넣는다
op_names = {}
for _loc in LOCALES:
    _p = f"{REPO}/app/data/operators.json" if _loc == "ko" else f"{REPO}/app/data/operators.{_loc}.json"
    op_names[_loc] = {o["id"]: o["name"] for o in (load(_p) if os.path.exists(_p) else [])}
for loc, (prefix, fallback) in LOCALES.items():
    table = load(f"{S}/{prefix}_handbook_info_table.json")
    table = table.get("handbookDict", table)
    fb = load(f"{S}/{fallback}_handbook_info_table.json")
    fb = fb.get("handbookDict", fb)

    out_dir = f"{OUT_ROOT}/{loc}"
    shutil.rmtree(out_dir, ignore_errors=True)  # 삭제된 오퍼의 잔재 정리
    os.makedirs(out_dir, exist_ok=True)

    harvested.setdefault(loc, harvest_lines(table, fb))
    harvested_fields.setdefault(loc, harvest_fields(table, fb))
    n = fallbacks = 0
    for cid in ops:
        entry = table.get(cid)
        used_fallback = False
        if not entry:
            entry = fb.get(cid)
            used_fallback = bool(entry)
        if not entry:
            continue
        secs = sections(entry)
        if not secs:
            continue
        if used_fallback:
            new_secs = []
            for sec in secs:
                # ① 수확 사전(공식 번역)으로 줄 단위 → ② 남은 덩어리는 수동 사전(비공식 AI 번역)
                # ① 수확 사전(공식 번역) → ② 필드 규칙 → ③ 수동 사전(비공식 AI 번역)
                # ⚠ 셋 다 **줄 단위**로 적용한다. 예전엔 ③이 섹션 텍스트를 통째로 키로 조회해서
                #   줄 단위로 적어 넣은 번역이 하나도 안 붙었다 (2026-08-01).
                text, left = localize_lines(sec.get("text"), harvested[loc])
                if left:
                    text = localize_fields(text, harvested_fields[loc], loc, op_names[loc].get(cid))
                    text, left = localize_lines(text, manual_lines[loc])
                if left:
                    untranslated.append((loc, cid, "text", left))
                new_secs.append({**sec, "title": localize(sec.get("title"), loc, cid, "title"), "text": text})
            secs = new_secs
        payload = {"id": cid, "sections": secs}
        if used_fallback:
            payload["source"] = "cn"  # 미실장 — 모달이 '중국 서버 원문' 안내를 띄운다
        with open(f"{out_dir}/{cid}.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        n += 1
        fallbacks += used_fallback
    written[loc] = (n, fallbacks)

total = sum(
    os.path.getsize(os.path.join(dp, fn))
    for loc in LOCALES for dp, _, fns in os.walk(f"{OUT_ROOT}/{loc}") for fn in fns
)
for loc, (n, fb) in written.items():
    print(f"profiles/{loc}: {n}명" + (f" (CN 원문 폴백 {fb}명)" if fb else ""))
print(f"합계 {sum(n for n, _ in written.values())}개 파일 · {total / 1024 / 1024:.1f} MB"
      f" · 평균 {total / max(1, sum(n for n, _ in written.values())) / 1024:.1f} KB")
print("→ R2 반영: node scripts/r2-sync.mjs")

# 미번역 CN 본문 집계 — cn-translations.json에 채우면 사라진다 (무인 리포트가 이 경고를 잡는다)
if untranslated:
    by_op = {}
    for loc, cid, what, n in untranslated:
        if loc != "ko":
            continue
        by_op[cid] = by_op.get(cid, 0) + n
    total_chars = sum(by_op.values())
    print(f"  ⚠ 미번역 CN 프로필 본문: {len(by_op)}명 · {total_chars:,}자 "
          f"— scripts/cn-translations.json에 채울 것", file=sys.stderr)
