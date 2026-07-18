#!/usr/bin/env python3
"""Build public/story/script/<eventId>.json — 스토리 '전문 보기' (풀 스크립트 + 컷씬).

Usage:
  python3 scripts/build-story-scripts.py            # 요약이 있는 전 이벤트 (사이드+메인)
  python3 scripts/build-story-scripts.py act49side  # 한 이벤트만

- 대상: app/data/story-summaries.json 에 요약이 있는 이벤트 중 story_review_table 에
  에피소드 구성이 있는 것 (사이드 act*·1stact + 메인 main_0~16). rogue_N 은 원문이
  조각(월별 대화·엔딩)이라 제외 — UI 는 story-script-ids.json 에 있는 id 만 버튼을 띄운다.
- 산출물은 정적 JSON — JS 번들에 import 하지 말 것 (home 청크 폭증). UI 가 fetch 로 로드.
- 컷씬([Image(image=…)])은 public/story/cut/<name>.webp 재사용, 없는 것만 다운로드.
- 텍스트는 한국어 게임 원문 그대로 (EN/JA 로케일은 UI 에서 KO 전용 안내).

라인 스키마 (lines[]):
  {"n": 화자, "x": 대사}   | {"x": 지문/나레이션}      | {"st": 자막/스티커 텍스트}
  {"img": 컷씬 이름}        | {"loc": 장소 스탬프}       | {"opts": [선택지…]}
  {"br": "1;2"}            (직전 opts 의 값 참조 — 분기 시작 마커)
"""
import json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"
CACHE = os.path.join(REPO, ".gamedata", "story-cache")
OUT_DIR = os.path.join(REPO, "public", "story", "script")
CUT_DIR = os.path.join(REPO, "public", "story", "cut")


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": "terra-archive-script/1.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read()
        return raw if binary else json.loads(raw.decode("utf-8"))


def fetch_txt_cached(path):
    """story txt 를 .gamedata/story-cache/ 에 캐시하며 가져온다. 404 는 None."""
    dest = os.path.join(CACHE, path.replace("/", "__") + ".txt")
    if os.path.exists(dest):
        return open(dest, encoding="utf-8").read()
    try:
        raw = fetch(f"{GAMEDATA}/kr/gamedata/story/{path}.txt", binary=True)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    os.makedirs(CACHE, exist_ok=True)
    open(dest, "w", encoding="utf-8").write(raw.decode("utf-8"))
    return raw.decode("utf-8")


# 인라인 마크업 제거 — <p=2>·</>·<color=…>·<i> 류. {@nickname} 은 플레이어 호칭 '독타'.
MARKUP = re.compile(r"</?[@$a-zA-Z][^>]*>|</>")

def clean(s):
    s = s.replace("{@nickname}", "독타")
    s = MARKUP.sub("", s)
    s = s.replace("\\n", "\n").replace("\r", "")
    return s.strip()


RE_NAME = re.compile(r'\[name\s*=\s*"([^"]*)"[^\]]*\]\s*(.*)', re.I)
RE_MULTI = re.compile(r'\[multiline\([^)]*name\s*=\s*"([^"]*)"[^\]]*\]\s*(.*)', re.I)
RE_IMAGE = re.compile(r'\[image\s*\([^\]]*?image\s*=\s*"([^"]+)"', re.I)
RE_STICK = re.compile(r'\[(?:sticker|subtitle)\s*\([^\]]*?text\s*=\s*"([^"]*)"', re.I)
RE_DECIS = re.compile(r'\[decision\s*\([^\]]*?options\s*=\s*"([^"]*)"(?:[^\]]*?values\s*=\s*"([^"]*)")?', re.I)
RE_PRED = re.compile(r'\[predicate\s*\([^\]]*?references\s*=\s*"([^"]*)"', re.I)
RE_ANIM = re.compile(r'\[animtext\s*\([^\]]*\)\]\s*(.*)', re.I)


def parse_story(txt):
    """스크립트 원문 → 라인 배열. 연출 태그(음악·이펙트·스탠딩)는 버린다."""
    lines = []
    last_img = None
    for raw in txt.splitlines():
        line = raw.strip()
        if not line:
            continue
        if not line.startswith("["):
            x = clean(line)
            if x:
                lines.append({"x": x})
            continue
        m = RE_NAME.match(line)
        if m:
            x = clean(m.group(2))
            if x:
                lines.append({"n": clean(m.group(1)) or "???", "x": x})
            continue
        m = RE_MULTI.match(line)
        if m:
            x = clean(m.group(2))
            if x:
                # 같은 화자의 직전 대사에 이어붙인다 (multiline 은 한 말풍선의 연속)
                prev = lines[-1] if lines else None
                who = clean(m.group(1)) or "???"
                if prev and prev.get("n") == who:
                    prev["x"] += "\n" + x
                else:
                    lines.append({"n": who, "x": x})
            continue
        m = RE_IMAGE.match(line)
        if m:
            name = m.group(1)
            if name != last_img:
                lines.append({"img": name})
                last_img = name
            continue
        m = RE_STICK.match(line)
        if m:
            x = clean(m.group(1))
            if x:
                lines.append({"st": x})
            continue
        m = RE_DECIS.match(line)
        if m:
            opts = [clean(o) for o in m.group(1).split(";") if clean(o)]
            if opts:
                ln = {"opts": opts}
                # 분기(Predicate references)는 옵션 '순번'이 아니라 values 를 참조한다 (3;4 등)
                vals = [v.strip() for v in (m.group(2) or "").split(";") if v.strip()]
                if len(vals) == len(opts):
                    ln["vals"] = vals
                lines.append(ln)
            continue
        m = RE_PRED.match(line)
        if m:
            lines.append({"br": m.group(1)})
            continue
        m = RE_ANIM.match(line)
        if m:
            x = clean(m.group(1))
            if x:
                lines.append({"loc": x})
            continue
        # 그 외 연출 태그는 전부 무시
    # 앞뒤 의미 없는 br 정리: opts 없이 나온 br(연출 분기)은 버린다
    out, seen_opts = [], False
    for ln in lines:
        if "opts" in ln:
            seen_opts = True
        if "br" in ln and not seen_opts:
            continue
        out.append(ln)
    return out


def build_event(eid, entry):
    infos = sorted(entry["infoUnlockDatas"], key=lambda i: i["storySort"])
    eps, images = [], []
    txts = {}
    with ThreadPoolExecutor(8) as ex:
        for info, txt in zip(infos, ex.map(lambda i: fetch_txt_cached(i["storyTxt"]), infos)):
            txts[info["storyId"]] = txt
    for info in infos:
        txt = txts.get(info["storyId"])
        if not txt:
            continue
        lines = parse_story(txt)
        if not lines:
            continue
        for ln in lines:
            if "img" in ln and ln["img"] not in images:
                images.append(ln["img"])
        eps.append({
            "code": info.get("storyCode") or "",
            "name": info.get("storyName") or "",
            "tag": info.get("avgTag") or "",
            "lines": lines,
        })
    return eps, images


def download_cuts(names):
    """컷씬 webp — 이미 있으면 스킵. 404(에셋 미러 누락)는 건너뛰고 목록 반환."""
    from imgutil import save_webp
    os.makedirs(CUT_DIR, exist_ok=True)
    missing, failed = [n for n in names if not os.path.exists(os.path.join(CUT_DIR, f"{n}.webp"))], []

    def dl(name):
        # 레포 파일명은 소문자 — 스크립트 참조가 대문자(21_I1 등)면 소문자로 재시도
        for cand in dict.fromkeys([name, name.lower()]):
            try:
                png = fetch(f"{ASSETS}/avg/images/{cand}.png", binary=True)
                save_webp(png, os.path.join(CUT_DIR, f"{name}.webp"), photo=True, max_px=1080)
                return
            except urllib.error.HTTPError:
                continue
        failed.append(name)

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(dl, missing))
    return failed


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    summaries = json.load(open(os.path.join(REPO, "app", "data", "story-summaries.json"), encoding="utf-8"))
    review = fetch(f"{GAMEDATA}/kr/gamedata/excel/story_review_table.json")
    os.makedirs(OUT_DIR, exist_ok=True)

    ids, total_kb, all_failed = [], 0, []
    targets = [only] if only else sorted(summaries.keys())
    for eid in targets:
        entry = review.get(eid)
        if not entry:  # rogue_N 등 리뷰 테이블에 없는 합성 이벤트
            continue
        eps, images = build_event(eid, entry)
        if not eps:
            continue
        failed = download_cuts(images)
        all_failed += failed
        # 다운로드 실패(미러 누락) 컷씬 마커는 빼서 UI 깨짐 방지
        if failed:
            bad = set(failed)
            for ep in eps:
                ep["lines"] = [ln for ln in ep["lines"] if ln.get("img") not in bad]
        out = {"id": eid, "eps": eps}
        dest = os.path.join(OUT_DIR, f"{eid}.json")
        json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        kb = os.path.getsize(dest) // 1024
        total_kb += kb
        ids.append(eid)
        nlines = sum(len(e["lines"]) for e in eps)
        print(f"{eid}: {len(eps)}편 {nlines}라인 {len(images)}컷 → {kb}KB" + (f" (컷 누락 {len(failed)})" if failed else ""))

    if not only:
        json.dump(sorted(ids), open(os.path.join(REPO, "app", "data", "story-script-ids.json"), "w", encoding="utf-8"),
                  ensure_ascii=False)
        print(f"\n합계 {len(ids)}이벤트 {total_kb/1024:.1f}MB → public/story/script/ · ids → app/data/story-script-ids.json")
    if all_failed:
        print("미러에 없는 컷씬:", sorted(set(all_failed)))


if __name__ == "__main__":
    main()
