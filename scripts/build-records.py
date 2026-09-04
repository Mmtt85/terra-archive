#!/usr/bin/env python3
"""오퍼레이터 기록(밀록, handbookAvgList)을 오퍼별 JSON으로 뽑는다.

Usage: python3 scripts/build-records.py [gamedata-dir]   # default: .gamedata

출처는 클뜯 `handbook_info_table.json`의 `handbookDict[*].handbookAvgList` — 게임
오퍼레이터 아카이브의 '기록 복원'(오퍼별 미니 스토리, 통칭 밀록)이다. 본문은
`<server>/gamedata/story/<storyTxt>.txt`의 AVG 스크립트라 **build-story-scripts.py의
파서·컷씬·스탠딩 파이프라인을 그대로 재사용**한다 (라인 스키마 동일 → UI도
story.tsx ScriptReader 재사용).

- KR/EN/JP 테이블·스크립트가 각각 공식 번역 — AI 번역을 거치지 않는다.
- CN에만 있는 기록(미실장 오퍼 전체 + 실장 오퍼의 CN 선행 기록)은 CN 원문을
  `f:1`(미래시) 플래그와 함께 싣는다 — UI가 '미래시 포함'일 때만 보여주고 원문
  표기임을 안내한다. 스크립트 전문이라 cn-translations 줄 사전 대상이 아니다.
- ⚠ ci-refresh에는 넣지 않는다 — 기록은 큰 점검에만 늘고, 스크립트 원문 fetch가
  1,100여 건이라 무인 러너(캐시 없음)에서 돌리면 느리고 레이트리밋에 걸린다.
  kr-big-patch 로컬 단계에서 돌린다 (.gamedata/story-cache/ 캐시 공유).

출력 (public/records/<locale>/<charId>.json — R2 서빙, r2-sync DIRS "records"):
  { "id": cid,
    "recs": [ { "name": 세트명, "tag": 스토리 소개문, "lines": [ScriptLine…],
                "unlock": [{"t": "AWAKE", "p": ["0","30"]}, {"t": "FAVOR", "p": ["50"]}],
                "f": 1? } ],
    "faces": { 화자: 스탠딩 스프라이트 } }
+ app/data/record-ids.json — 기록이 있는 오퍼 id 목록 (UI가 fetch 여부·섹션 표시 판단)
"""
import importlib.util
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetchutil
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(SCRIPTS)
S = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GAMEDATA_DIR", ".gamedata")
OUT_ROOT = f"{REPO}/public/records"

_spec = importlib.util.spec_from_file_location("bss", os.path.join(SCRIPTS, "build-story-scripts.py"))
bss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bss)

load = lambda p: json.load(open(p, encoding="utf-8"))
ops = [o["id"] for o in load(f"{REPO}/app/data/operators.json")]

# 사이트 로케일 → (핸드북·스크립트 서버, 플레이어 호칭)
LOCALES = {"ko": ("kr", "박사"), "en": ("en", "Doctor"), "ja": ("jp", "ドクター")}
HB = {sv: load(f"{S}/{sv}_handbook_info_table.json")["handbookDict"] for sv in ("kr", "en", "jp", "cn")}


# ── CN 선행 기록의 한국어 번역 ────────────────────────────────────────────────
# 기록 본문은 AVG 스크립트 전문이라 cn-translations.json(줄 사전)에 넣을 물건이 아니다.
# 이벤트 스토리 전문과 **같은 규약**을 쓴다 (build-story-scripts.py --cn / --cn-merge):
#   ① 이 스크립트가 원문 골격을 scripts/records-cn/_src/<cid>.json 으로 떨어뜨린다
#   ② AI가 같은 구조로 scripts/records-cn/<cid>.json 에 한국어를 채운다
#   ③ 다음 실행에서 **문자열만** 갈아 끼운다 — 줄 수·키가 어긋나면 그 기록은 손대지 않는다
# EN/JA는 원문 유지 (스토리 전문 선례 — 번역본은 한국어만, UI가 비공식 번역임을 알린다).
CN_TR = f"{REPO}/scripts/records-cn"


def cn_translate(cid, recs):
    """CN 원문 기록(f:1)에 번역을 덮어쓰고, 없으면 번역용 원문 골격을 떨어뜨린다."""
    fut = [r for r in recs if r.get("f")]
    if not fut:
        return
    p = f"{CN_TR}/{cid}.json"
    tr = load(p) if os.path.exists(p) else None
    src = (tr or {}).get("recs") or []
    if tr and len(src) != len(fut):
        print(f"  ✗ {cid}: 번역 기록 {len(src)}편 ≠ 원문 {len(fut)}편 — 통째로 건너뜀", file=sys.stderr)
        src = []
    for i, rec in enumerate(fut):
        t = src[i] if i < len(src) else None
        if t and len(t.get("lines") or []) == len(rec["lines"]):
            for ln, tl in zip(rec["lines"], t["lines"]):
                for k in ("n", "x", "st", "loc"):
                    if k in ln and tl.get(k):
                        ln[k] = tl[k]
                if ln.get("opts") and tl.get("opts") and len(ln["opts"]) == len(tl["opts"]):
                    ln["opts"] = tl["opts"]
            rec["name"] = t.get("name") or rec["name"]
            rec["tag"] = t.get("tag") or rec["tag"]
            rec["tr"] = "cn"      # UI 안내를 '원문 그대로'에서 '비공식 AI 번역'으로 바꾼다
            continue
        if t:
            print(f"  ✗ {cid}[{i}]: 줄 수 {len(t.get('lines') or [])} ≠ {len(rec['lines'])} — 건너뜀", file=sys.stderr)
        os.makedirs(f"{CN_TR}/_src", exist_ok=True)
        skel = {"id": cid, "recs": [{"name": r["name"], "tag": r["tag"],
                                     "lines": [{k: v for k, v in ln.items() if k in ("n", "x", "st", "loc", "opts")}
                                               for ln in r["lines"]]} for r in fut]}
        json.dump(skel, open(f"{CN_TR}/_src/{cid}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def txt_path(server, path):
    prefix = "" if server == "kr" else f"{server}__"  # bss 캐시 규약과 동일 — 캐시 공유
    return os.path.join(bss.CACHE, prefix + path.replace("/", "__") + ".txt")


def prefetch(pairs):
    """(server, storyTxt) 목록을 병렬로 캐시에 받아 둔다 — 이후 파싱은 캐시만 읽는다."""
    todo = [(sv, p) for sv, p in pairs if not os.path.exists(txt_path(sv, p))]
    if not todo:
        return

    def dl(job):
        sv, p = job
        try:
            # fetchutil — 일시 오류(429·5xx·타임아웃) 지수 백오프 재시도. 조용히 삼키면
            # 그 오퍼의 기록이 소리 없이 빠진다 (첫 실행에서 켈시 등 4건 누락됐던 원인).
            raw = fetchutil.urlread(f"{bss.GAMEDATA}/{sv}/gamedata/story/{p}.txt", ua="terra-archive-records")
        except Exception as exc:
            print(f"  ⚠ fetch 실패 {sv}/{p}: {exc}", file=sys.stderr)
            return  # 진짜 404 — 파싱 단계에서 캐시 부재로 스킵된다
        os.makedirs(bss.CACHE, exist_ok=True)
        open(txt_path(sv, p), "w", encoding="utf-8").write(raw.decode("utf-8"))

    with ThreadPoolExecutor(12) as ex:
        list(ex.map(dl, todo))
    print(f"  스크립트 fetch {len(todo)}건")


def read_txt(server, path):
    p = txt_path(server, path)
    return open(p, encoding="utf-8").read() if os.path.exists(p) else None


def op_sets(cid, server):
    """이 오퍼의 (세트, 출처서버) 목록 — 로케일 서버 세트 + CN에만 있는 선행 세트."""
    loc = (HB[server].get(cid) or {}).get("handbookAvgList") or []
    cn = (HB["cn"].get(cid) or {}).get("handbookAvgList") or []
    have = {s["storySetId"] for s in loc}
    out = [(s, server) for s in loc] + [(s, "cn") for s in cn if s["storySetId"] not in have]
    return sorted(out, key=lambda x: x[0].get("sortId") or 0)


def unlock_of(s):
    return [{"t": u.get("unlockType"), "p": [p for p in (u.get("unlockParam1"), u.get("unlockParam2")) if p]}
            for u in (s.get("unlockParam") or [])]


# ── 1) 전 로케일에서 필요한 스크립트 경로 수집 → 병렬 프리페치 ──────────────────
pairs = set()
for loc, (server, _) in LOCALES.items():
    for cid in ops:
        for s, src in op_sets(cid, server):
            for st in s.get("avgList") or []:
                pairs.add((src, st["storyTxt"]))
prefetch(sorted(pairs))

# ── 2) 로케일별 파싱·조립 ─────────────────────────────────────────────────────
cut_needed = {}        # 컷씬 이름 → cg 레이어 (로케일 공용 — 이름이 같으면 같은 그림)
written = {}
ids_ko = []
sprites = set()
for loc, (server, nickname) in LOCALES.items():
    bss.NICKNAME = nickname  # clean()의 {@nickname} 치환
    out_dir = f"{OUT_ROOT}/{loc}"
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        os.remove(os.path.join(out_dir, f))  # 삭제된 기록 잔재 정리
    n = future_sets = 0
    for cid in ops:
        recs = []
        votes = defaultdict(Counter)
        for s, src in op_sets(cid, server):
            for st in s.get("avgList") or []:
                txt = read_txt(src, st["storyTxt"])
                if not txt:
                    continue
                lines = bss.parse_story(txt)
                if not lines:
                    continue
                bss.scan_faces(txt, votes)
                bss.scan_cg_layers(txt, cut_needed)
                rec = {"name": s.get("storySetName") or "", "tag": st.get("storyIntro") or "",
                       "unlock": unlock_of(s), "lines": lines}
                if src == "cn":
                    rec["f"] = 1
                    future_sets += 1
                recs.append(rec)
                for ln in lines:
                    if "img" in ln:
                        cut_needed.setdefault(ln["img"], cut_needed.get(ln["img"]))
        if not recs:
            continue
        if loc == "ko":
            cn_translate(cid, recs)
        faces = bss.resolve_faces(votes)
        sprites.update(faces.values())
        payload = {"id": cid, "recs": recs, "faces": faces}
        with open(f"{out_dir}/{cid}.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        n += 1
        if loc == "ko":
            ids_ko.append(cid)
    written[loc] = (n, future_sets)

# ── 3) 컷씬·스탠딩 이미지 — 기존 public/story/{cut,char} 재사용, 없는 것만 다운로드 ──
failed_cuts = bss.download_cuts(list(cut_needed), {k: v for k, v in cut_needed.items() if v})
failed_sprites = bss.download_sprites(sorted(sprites))

# 케이스 정규화 + 다운로드 실패분 제거 (bss.normalize_case와 같은 이유 — Pages는 케이스 구별)
cut_case = bss.actual_case_map(bss.CUT_DIR)
char_dir = os.path.join(REPO, "public", "story", "char")
char_case = bss.actual_case_map(char_dir) if os.path.isdir(char_dir) else {}
bad_cuts, bad_sprites = set(failed_cuts), set(failed_sprites)
for loc in LOCALES:
    out_dir = f"{OUT_ROOT}/{loc}"
    for fn in os.listdir(out_dir):
        p = os.path.join(out_dir, fn)
        doc = load(p)
        changed = False
        for rec in doc["recs"]:
            kept = []
            for ln in rec["lines"]:
                if "img" in ln:
                    if ln["img"] in bad_cuts:
                        changed = True
                        continue
                    fixed = cut_case.get(ln["img"].lower(), ln["img"])
                    if fixed != ln["img"]:
                        ln["img"] = fixed
                        changed = True
                kept.append(ln)
            rec["lines"] = kept
        fixed_faces = {w: char_case.get(s.lower(), s) for w, s in doc["faces"].items() if s not in bad_sprites}
        if fixed_faces != doc["faces"]:
            doc["faces"] = fixed_faces
            changed = True
        if changed:
            json.dump(doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

json.dump(sorted(ids_ko), open(f"{REPO}/app/data/record-ids.json", "w", encoding="utf-8"),
          ensure_ascii=False)

total = sum(os.path.getsize(os.path.join(dp, fn))
            for loc in LOCALES for dp, _, fns in os.walk(f"{OUT_ROOT}/{loc}") for fn in fns)
for loc, (n, fut) in written.items():
    print(f"records/{loc}: {n}명" + (f" (CN 선행 기록 {fut}건)" if fut else ""))
print(f"합계 {total / 1024 / 1024:.1f} MB · record-ids {len(ids_ko)}명")
if failed_cuts:
    print("미러에 없는 컷씬:", sorted(set(failed_cuts)))
print("→ R2 반영: node scripts/r2-sync.mjs")
