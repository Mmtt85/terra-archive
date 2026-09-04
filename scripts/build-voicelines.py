#!/usr/bin/env python3
"""오퍼레이터 보이스 대사(텍스트)를 오퍼별 JSON으로 뽑는다.

Usage: python3 scripts/build-voicelines.py [gamedata-dir]   # default: .gamedata

출처는 클뜯 `charword_table.json`:
  · charWords      — 대사 1줄 = 1엔트리 (제목·본문·해금 조건·재생 위치)
  · voiceLangDict  — 오퍼별 언어별 성우 이름 (중국어/일본어/한국어/영어 …)
KR·EN·JP 테이블이 각각 공식 번역이라 AI 번역을 거치지 않는다.

⚠ **음성 파일(mp3)은 가져오지 않는다** (사용자 확정 2026-07-31: "텍스트만 할까").
   음성은 ArknightsAssets2 레포 voice 브랜치에 언어별로 약 1GB씩 있지만, 게임 에셋
   원본을 그대로 재배포하는 것이라 성격이 다르다 — 넣기로 하면 별도 결정이 필요하다.

⚠ 왜 operators.json에 안 넣는가: 대사 17,223줄을 합치면 로케일당 약 3MB로
   operators.json(1.7MB)보다 크다. 목록 화면에 통째로 실리는 파일이라 넣으면 첫
   로딩이 무거워진다 — profiles/skins와 같은 관례로 **오퍼당 파일 1개**를 만들어
   public/voice/<locale>/<id>.json 에 쓰고, 상세 모달을 열 때만 받아온다
   (R2 서빙 — scripts/r2-sync.mjs의 DIRS에 "voice"가 있어야 한다).

⚠ 대사는 charId가 아니라 **wordKey로 묶는다**. 한 charId 밑에 여러 세트가 들어 있다:
   · 언어 변종(`…_ITA`·`…_CN_TOPOLECT`) — 같은 대본을 그 언어 성우가 읽은 것(문장부호만 다름).
     voiceLangDict[charId].wordkeys에 실려 있어 이걸로 걸러낸다. 표시하면 같은 줄이 두 번 나온다.
   · 복장 전용 세트(`…_epoque#7` 등) — 38줄 중 37줄이 다른 **별개 대본**이라 살린다.
     skin_table의 `charId@suffix` 이름을 붙인다.
   · 다른 형태(가드 아미야 char_1001_amiya2)는 그 자체가 오퍼 id라 **그 오퍼 몫**으로 넘긴다.

출력 형식:
  {"cv": [{"lang": "한국어", "names": ["이소은"]}, …],
   "lines": [{"t": "어시스턴트 임명", "x": "대사 본문",
              "u": {"type": "FAVOR", "param": "0"},   # null = 즉시 열람
              "p": "HOME_PLACE"}],                    # 재생 위치(없으면 생략)
   "sets": [{"name": "황홀", "lines": [...]}]}        # 복장 전용 보이스(있을 때만)
  lines 순서 = 게임 내 순서(voiceIndex).
"""
import cnmiss
import json
import os
import re
import shutil
import sys
from collections import Counter

S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = f"{REPO}/public/voice"

load = lambda p: json.load(open(p, encoding="utf-8"))

# 사이트에 수록된 오퍼만 — 클뜯엔 NPC·적·토큰 대사도 섞여 있다
ops = [o["id"] for o in load(f"{REPO}/app/data/operators.json")]

# 로케일 → (테이블 접두사, 폴백 접두사). 미실장 오퍼는 로케일 테이블에 아직 없으므로
# CN 원문으로 폴백한다 (프로필과 같은 관례 — 빈 화면보다 원문이 낫다).
LOCALES = {"ko": ("kr", "cn"), "en": ("en", "cn"), "ja": ("jp", "cn")}

# 언어 코드 → 표시 이름. 게임 테이블(voiceLangTypeDict)에도 이름이 있지만 로케일별로
# 다르므로 사이트 사전 키(한국어 원문)로 고정하고 UI가 t()로 옮긴다.
LANG_NAME = {
    "CN_MANDARIN": "중국어", "CN_TOPOLECT": "중국어(방언)", "JP": "일본어",
    "KR": "한국어", "EN": "영어", "ITA": "이탈리아어", "GER": "독일어",
    "RUS": "러시아어", "FRE": "프랑스어", "LINKAGE": "협업", "11": "스페인어",
}
LANG_ORDER = ["KR", "JP", "CN_MANDARIN", "EN", "CN_TOPOLECT", "ITA", "GER", "RUS", "FRE", "11", "LINKAGE"]


def clean(s):
    """게임 텍스트 태그 정리 — build-profiles.py의 clean과 같은 규칙."""
    if not s:
        return ""
    s = re.sub(r"<[@$/][^>]*>", "", s).replace("</>", "")
    s = re.sub(r"</?[a-zA-Z][^>]*>", "", s)
    s = s.replace("\\n", "\n").replace("\r\n", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return "\n".join(line.strip() for line in s.split("\n")).strip()


def unlock_of(word):
    """해금 조건 — DIRECT(즉시)면 None, FAVOR(신뢰도)·AWAKE(승진)는 param과 함께."""
    kind = word.get("unlockType")
    if not kind or kind == "DIRECT":
        return None
    raw = word.get("unlockParam")
    param = None
    # unlockParam은 문자열화된 JSON이거나 이미 dict/list다 (테이블 버전에 따라 다름)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            raw = None
    if isinstance(raw, list) and raw:
        raw = raw[0]
    if isinstance(raw, dict):
        for k in ("valueStr", "valueInt"):
            if raw.get(k) not in (None, "", "None"):
                param = str(raw[k])
                break
    return {"type": kind, "param": param}


def by_wordkey(table):
    """wordKey → 대사 목록(게임 순서). 언어 변종·복장 세트가 전부 여기서 갈린다."""
    groups = {}
    for w in (table.get("charWords") or {}).values():
        groups.setdefault(w.get("wordKey") or w.get("charId"), []).append(w)
    return groups


def lang_variants(table):
    """언어 변종 wordKey 집합 — voiceLangDict의 wordkeys 중 charId 본인이 아닌 것."""
    out = set()
    for char_id, entry in (table.get("voiceLangDict") or {}).items():
        for key in entry.get("wordkeys") or []:
            if key != char_id:
                out.add(key)
    return out


def lines_of(words):
    """대사 목록을 게임 순서(voiceIndex)대로 정리."""
    words = sorted(words, key=lambda w: (int(w.get("voiceIndex") or 0), w.get("charWordId") or ""))
    out = []
    for w in words:
        text = clean(w.get("voiceText"))
        if not text:
            continue
        row = {"t": clean(w.get("voiceTitle")) or "", "x": text, "u": unlock_of(w)}
        place = w.get("placeType")
        if place and place != "NONE":
            row["p"] = place
        out.append(row)
    return out


def cv_for(table, op_id):
    """언어별 성우 — 이름이 비어 있는 언어는 버린다.
    가드 아미야처럼 자기 id로 항목이 없는 형태는 wordkeys에 자기 id를 담은 항목에서 찾는다."""
    vld = table.get("voiceLangDict") or {}
    entry = vld.get(op_id)
    if not entry:
        entry = next((e for e in vld.values() if op_id in (e.get("wordkeys") or [])), {}) or {}
    got = entry.get("dict") or {}
    out = []
    for lang in LANG_ORDER + [k for k in got if k not in LANG_ORDER]:
        names = [n for n in ((got.get(lang) or {}).get("cvName") or []) if n and n.strip()]
        if names:
            out.append({"lang": LANG_NAME.get(lang, lang), "names": names})
    return out


def skin_names(prefix):
    """복장 전용 보이스 세트 이름 — wordKey `char_x_y_epoque#7` ↔ 스킨 id `char_x_y@epoque#7`."""
    path = f"{S}/{prefix}_skin_table.json"
    if not os.path.exists(path):
        return {}
    skins = (load(path).get("charSkins") or {})
    out = {}
    for skin_id, entry in skins.items():
        if "@" not in skin_id:
            continue
        name = ((entry.get("displaySkin") or {}).get("skinName") or "").strip()
        if name:
            out[skin_id.replace("@", "_", 1)] = name
    return out


def build(table, op_id, op_ids, variants, names):
    """이 오퍼의 기본 세트 + 복장 전용 세트. 대사가 없으면 (None, []) ."""
    groups = table["_groups"]
    base = lines_of(groups.get(op_id) or [])
    extras = []
    for key, words in groups.items():
        # 자기 접두사로 시작하는 다른 세트만 — 언어 변종과 **다른 오퍼의 형태**(가드 아미야)는 뺀다
        if key == op_id or key in variants or key in op_ids:
            continue
        if not key.startswith(f"{op_id}_"):
            continue
        lines = lines_of(words)
        if lines:
            extras.append({"name": names.get(key) or key[len(op_id) + 1:], "lines": lines})
    return base, extras


# 미실장(CN 선행) 오퍼의 대사는 CN 원문 그대로다 — 프로필·스킬과 같은 사전으로 덮어쓴다
# (사용자 지적 2026-08-01: 배포본에서 신캐 보이스가 하나도 번역 안 돼 있다).
MANUAL_PATH = f"{REPO}/scripts/cn-translations.json"
MANUAL = load(MANUAL_PATH) if os.path.exists(MANUAL_PATH) else {}
CJK_RE = re.compile(r"[\u3400-\u9fff]")
untranslated = []
TITLES = {}   # locale → {CN 제목: 공식 제목} — harvest_titles()가 채운다


def harvest_titles(tables):
    """대사 제목("任命助理" 등)의 **공식 역어**를 클뜯에서 캐낸다.

    제목은 오퍼별 창작이 아니라 voiceId(CN_001…)마다 고정된 UI 라벨이라, 이미 실장된
    오퍼 456명의 CN↔KR/EN/JP 엔트리를 (charId, voiceId)로 짝지으면 공식 표기가 만장일치로
    떨어진다(39종). 번역기에 맡길 이유가 없다 — 미실장 오퍼에도 그대로 쓴다.
    """
    cn = tables.get("cn")
    if not cn:
        return
    cn_title = {(e["charId"], e["voiceId"]): e["voiceTitle"] for e in cn["charWords"].values()}
    for locale, (prefix, _) in LOCALES.items():
        t = tables.get(prefix)
        if not t:
            continue
        votes = {}
        for e in t["charWords"].values():
            src = cn_title.get((e["charId"], e["voiceId"]))
            if src and e["voiceTitle"] and src != e["voiceTitle"]:
                votes.setdefault(src, Counter())[e["voiceTitle"]] += 1
        TITLES[locale] = {k: v.most_common(1)[0][0] for k, v in votes.items()}


def localize(text, loc, cid):
    """CN 대사 한 줄 → 공식 제목/사전에 있으면 그 로케일 표기, 없으면 원문 유지(+경고 집계)."""
    if not text:
        return text
    key = text.strip()
    official = TITLES.get(loc, {}).get(key)
    if official:
        return official
    hit = MANUAL.get(key)
    if hit and hit.get(loc):
        return hit[loc]
    if CJK_RE.search(text):
        untranslated.append((loc, cid, len(text)))
        cnmiss.note(text, "voice", cid)
    return text


def main():
    tables = {}
    for prefix in {p for pair in LOCALES.values() for p in pair}:
        path = f"{S}/{prefix}_charword_table.json"
        if os.path.exists(path):
            table = load(path)
            table["_groups"] = by_wordkey(table)
            table["_variants"] = lang_variants(table)
            table["_skins"] = skin_names(prefix)
            tables[prefix] = table
        else:
            print(f"  ⚠ {path} 없음 — 이 접두사는 건너뜁니다")

    # ⚠ 안전장치 (2026-08-01): 입력 테이블이 하나도 없는데 rmtree부터 하면 **기존 산출물을
    #   통째로 날린다**. 실제로 CI에 charword_table이 없어 보이스 1,280개가 지워지고 그대로
    #   커밋·배포됐다. 입력이 없으면 지우기 전에 죽어서 파이프라인을 세운다.
    if not tables:
        print("charword_table을 하나도 못 읽었다 — 기존 보이스를 지우지 않고 중단한다 "
              f"(찾은 경로: {S}/*_charword_table.json)", file=sys.stderr)
        sys.exit(1)

    harvest_titles(tables)

    op_ids = set(ops)
    for locale, (main_prefix, fallback) in LOCALES.items():
        out_dir = f"{OUT_ROOT}/{locale}"
        shutil.rmtree(out_dir, ignore_errors=True)
        os.makedirs(out_dir, exist_ok=True)
        wrote = fell_back = empty = extra_sets = 0
        total_lines = 0
        for op_id in ops:
            table = tables.get(main_prefix)
            source = None
            base, extras = ([], []) if not table else build(
                table, op_id, op_ids, table["_variants"], table["_skins"])
            if not base and fallback in tables:
                table = tables[fallback]
                base, extras = build(table, op_id, op_ids, table["_variants"], table["_skins"])
                if base:
                    source = "cn"
                    fell_back += 1
            if not base:
                empty += 1
                continue
            if source == "cn":
                # CN 폴백 = 미실장 오퍼. 제목·본문·복장 세트명을 사전으로 갈아 끼운다.
                base = [{**r, "t": localize(r.get("t"), locale, op_id),
                         "x": localize(r.get("x"), locale, op_id)} for r in base]
                extras = [{**e, "name": localize(e.get("name"), locale, op_id),
                           "lines": [{**r, "t": localize(r.get("t"), locale, op_id),
                                      "x": localize(r.get("x"), locale, op_id)} for r in (e.get("lines") or [])]}
                          for e in extras]
            doc = {"cv": cv_for(table, op_id), "lines": base}
            if extras:
                doc["sets"] = extras
                extra_sets += len(extras)
            if source:
                doc["source"] = source
            with open(f"{out_dir}/{op_id}.json", "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
            wrote += 1
            total_lines += len(base) + sum(len(e["lines"]) for e in extras)
        size = sum(os.path.getsize(f"{out_dir}/{n}") for n in os.listdir(out_dir))
        print(f"{locale}: {wrote}명 · 대사 {total_lines}줄 · 복장 전용 세트 {extra_sets}개 · {size/1024/1024:.1f}MB"
              f" (CN 폴백 {fell_back} · 대사 없음 {empty})")


if __name__ == "__main__":
    main()

# 미번역 CN 대사 집계 — cn-translations.json에 채우면 사라진다 (무인 리포트가 이 경고를 잡는다)
if untranslated:
    ko = [x for x in untranslated if x[0] == "ko"]
    ops_n = len({x[1] for x in ko})
    print(f"  ⚠ 미번역 CN 보이스 대사: {ops_n}명 · {sum(x[2] for x in ko):,}자 "
          f"— scripts/cn-translations.json에 채울 것", file=sys.stderr)

cnmiss.dump()
