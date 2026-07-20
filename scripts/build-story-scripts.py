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
    s = re.sub(r"\{@nickname\}", "독타", s, flags=re.I)  # {@Nickname} 대문자 변형 포함
    s = s.replace("{@nbs}", " ")          # 비개행 공백 토큰 → 일반 공백 (예: "Ave Mujica")
    s = re.sub(r"\{@[^}]*\}", "", s)        # 그 외 미처리 제어 토큰({@...}) 제거
    s = MARKUP.sub("", s)
    s = re.sub(r"[ \t]{2,}", " ", s)        # 토큰 제거로 생긴 이중 공백 정리
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


RE_CHARTAG = re.compile(r'\[[Cc]har(?:acter|slot)\s*\(([^)]*)\)', )
RE_CHARNAME = re.compile(r'name2?\s*=\s*"([^"]+)"')
RE_FOCUS = re.compile(r'focus\s*=\s*(\d)')

def scan_faces(txt, votes):
    """무대 위 스탠딩 스프라이트와 뒤따르는 화자를 짝지어 votes[화자][스프라이트] 집계.
    focus= 속성이 있으면 포커스된 스프라이트에만 투표 (오퍼가 아닌 NPC 얼굴 연결용)."""
    active = []
    for line in txt.splitlines():
        m = RE_CHARTAG.search(line)
        if m:
            attrs = m.group(1)
            names = [n.split("#")[0] for n in RE_CHARNAME.findall(attrs)]
            f = RE_FOCUS.search(attrs)
            if f and names:
                i = int(f.group(1)) - 1
                active = [names[i]] if 0 <= i < len(names) else names
            else:
                active = names
            continue
        m = RE_NAME.match(line.strip())
        if m and active:
            who = clean(m.group(1))
            for spr in active:
                votes[who][spr] += 1


# 안내방송·시스템 음성 등 실체 없는 화자 — 무대 위 스프라이트를 물려받아 얼굴이 오귀속되므로
# 배정에서 제외 (예: '수송차 안내 방송'이 옆에 선 워미 얼굴로 붙던 버그, 사용자 리포트 2026-07-20).
ANNOUNCE_RE = re.compile(r"(방송|안내음|알림음|스피커|자동\s*음성|시스템\s*음성|아나운스)")

def resolve_faces(votes):
    """화자별 다수결 스프라이트 — 과반+2표 이상일 때만 채택 (오귀속 방지)."""
    faces = {}
    for who, cnt in votes.items():
        if not who or who.startswith("?") or ANNOUNCE_RE.search(who):
            continue
        (spr, n), total = cnt.most_common(1)[0], sum(cnt.values())
        if n >= 2 and n * 2 > total:
            faces[who] = spr
    return faces


def download_sprites(names):
    """스탠딩 스프라이트(기본 표정 #1$1) → public/story/char/<base>.webp. 실패분 반환."""
    from imgutil import save_webp
    char_dir = os.path.join(REPO, "public", "story", "char")
    os.makedirs(char_dir, exist_ok=True)
    missing = [n for n in names if not os.path.exists(os.path.join(char_dir, f"{n}.webp"))]
    failed = []

    def dl(base):
        for variant in (f"{base}#1$1", f"{base}#1", base):
            url = f"{ASSETS}/avg/characters/{base}/{urllib.request.quote(variant)}.png"
            try:
                png = fetch(url, binary=True)
            except urllib.error.HTTPError:
                continue
            save_webp(png, os.path.join(char_dir, f"{base}.webp"), max_px=640)
            return
        failed.append(base)

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(dl, missing))
    return failed


def build_event(eid, entry):
    from collections import Counter, defaultdict
    infos = sorted(entry["infoUnlockDatas"], key=lambda i: i["storySort"])
    eps, images = [], []
    votes = defaultdict(Counter)
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
        scan_faces(txt, votes)
        for ln in lines:
            if "img" in ln and ln["img"] not in images:
                images.append(ln["img"])
        eps.append({
            "code": info.get("storyCode") or "",
            "name": info.get("storyName") or "",
            "tag": info.get("avgTag") or "",
            "lines": lines,
        })
    # 화자 → 스탠딩 스프라이트 얼굴 (오퍼가 아닌 인물도 썸네일 연결, 사용자 요청 2026-07-18)
    faces = resolve_faces(votes)
    failed = download_sprites(sorted(set(faces.values())))
    if failed:
        bad = set(failed)
        faces = {w: s for w, s in faces.items() if s not in bad}
    return eps, images, faces


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


# ── CN 선행(미실장) 이벤트: 원문 파싱 → AI 번역 → 병합 ─────────────────────────
# python3 scripts/build-story-scripts.py --cn act51side       # CN 파싱 → scripts/story-cn/<id>/
# (AI가 scripts/story-cn/<id>/ko/ep_NN.json 에 번역을 채운다 — 구조 보존)
# python3 scripts/build-story-scripts.py --cn-merge act51side # 검증·병합 → public/story/script/

def cn_prepare(eid):
    review = fetch(f"{GAMEDATA}/cn/gamedata/excel/story_review_table.json")
    entry = review.get(eid) or sys.exit(f"CN 리뷰 테이블에 없음: {eid}")
    base = os.path.join(REPO, "scripts", "story-cn", eid)
    os.makedirs(os.path.join(base, "ko"), exist_ok=True)
    infos = sorted(entry["infoUnlockDatas"], key=lambda i: i["storySort"])
    meta, images, speakers = [], [], {}
    for idx, info in enumerate(infos):
        # CN 브랜치 txt — 캐시 키가 KR과 겹치지 않게 접두
        dest = os.path.join(CACHE, "cn__" + info["storyTxt"].replace("/", "__") + ".txt")
        if os.path.exists(dest):
            txt = open(dest, encoding="utf-8").read()
        else:
            txt = fetch(f"{GAMEDATA}/cn/gamedata/story/{info['storyTxt']}.txt", binary=True).decode("utf-8")
            os.makedirs(CACHE, exist_ok=True)
            open(dest, "w", encoding="utf-8").write(txt)
        lines = parse_story(txt)
        for ln in lines:
            if "img" in ln and ln["img"] not in images:
                images.append(ln["img"])
            if "n" in ln:
                speakers[ln["n"]] = speakers.get(ln["n"], 0) + 1
        ep = {"idx": idx, "code": info.get("storyCode") or "", "name": info.get("storyName") or "",
              "tag": info.get("avgTag") or "", "lines": lines}
        json.dump(ep, open(os.path.join(base, f"ep_{idx:02d}.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        meta.append({"idx": idx, "code": ep["code"], "name": ep["name"], "tag": ep["tag"], "nlines": len(lines)})
    json.dump({"id": eid, "eps": meta}, open(os.path.join(base, "meta.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    # 화자 목록 (빈도순) — AI가 speakers.json(CN→KR 통일 표기)을 만들 때 참고
    json.dump(dict(sorted(speakers.items(), key=lambda x: -x[1])),
              open(os.path.join(base, "speakers-raw.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    failed = download_cuts(images)
    print(f"{eid}: {len(meta)}편 파싱 → {base}/ep_*.json · 화자 {len(speakers)}종 · 컷 {len(images)}장"
          + (f" (누락 {failed})" if failed else ""))


def cn_merge(eid):
    import re as _re
    base = os.path.join(REPO, "scripts", "story-cn", eid)
    meta = json.load(open(os.path.join(base, "meta.json"), encoding="utf-8"))
    hanzi = _re.compile(r"[一-鿿]")
    eps, bad = [], []
    for m in meta["eps"]:
        src = json.load(open(os.path.join(base, f"ep_{m['idx']:02d}.json"), encoding="utf-8"))
        ko_path = os.path.join(base, "ko", f"ep_{m['idx']:02d}.json")
        if not os.path.exists(ko_path):
            bad.append((m["idx"], "번역 파일 없음")); continue
        ko = json.load(open(ko_path, encoding="utf-8"))
        errs = []
        if len(ko.get("lines", [])) != len(src["lines"]):
            errs.append(f"라인 수 {len(src['lines'])}→{len(ko.get('lines', []))}")
        else:
            for i, (a, b) in enumerate(zip(src["lines"], ko["lines"])):
                if set(a.keys()) - {"vals"} != set(b.keys()) - {"vals"}:
                    errs.append(f"L{i} 키 불일치 {sorted(a)}→{sorted(b)}"); break
                if a.get("img") != b.get("img") or a.get("br") != b.get("br"):
                    errs.append(f"L{i} img/br 변조"); break
            nhan = sum(1 for b in ko["lines"] for v in (b.get("n"), b.get("x"), b.get("st"), b.get("loc"))
                       if isinstance(v, str) and hanzi.search(v))
            if nhan > 0:
                errs.append(f"중국어 잔존 {nhan}줄")
        if errs:
            bad.append((m["idx"], "; ".join(errs))); continue
        eps.append({"code": ko.get("code") or m["code"], "name": ko.get("name") or m["name"],
                    "tag": ko.get("tag") or m["tag"], "lines": ko["lines"]})
    if bad:
        for idx, msg in bad:
            print(f"  ✗ ep_{idx:02d}: {msg}")
        sys.exit(f"{eid}: {len(bad)}편 불량 — 병합 중단")
    out = {"id": eid, "tr": "cn", "eps": eps}
    dest = os.path.join(OUT_DIR, f"{eid}.json")
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    ids_path = os.path.join(REPO, "app", "data", "story-script-ids.json")
    ids = set(json.load(open(ids_path, encoding="utf-8")))
    ids.add(eid)
    json.dump(sorted(ids), open(ids_path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{eid}: {len(eps)}편 병합 → {dest} ({os.path.getsize(dest)//1024}KB) · ids 갱신")


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--cn":
        cn_prepare(sys.argv[2]); return
    if len(sys.argv) > 2 and sys.argv[1] == "--cn-merge":
        cn_merge(sys.argv[2]); return
    only = sys.argv[1] if len(sys.argv) > 1 else None
    summaries = json.load(open(os.path.join(REPO, "app", "data", "story-summaries.json"), encoding="utf-8"))
    review = fetch(f"{GAMEDATA}/kr/gamedata/excel/story_review_table.json")
    os.makedirs(OUT_DIR, exist_ok=True)

    ids, total_kb, all_failed = [], 0, []
    # 요약이 있는 이벤트 + 미니 이벤트(스토리 컬렉션) 전부 전문 생성 — 미니는 요약이 없어도
    # 전문부터 공개한다(사용자 확정 2026-07-20). KR 스크립트가 없는 미니는 build_event가 빈
    # eps를 돌려주므로 자동 스킵된다.
    mini_ids = {eid for eid, v in review.items() if v.get("actType") == "MINI_STORY"}
    targets = [only] if only else sorted(set(summaries.keys()) | mini_ids)
    for eid in targets:
        entry = review.get(eid)
        if not entry:  # rogue_N 등 리뷰 테이블에 없는 합성 이벤트
            continue
        eps, images, faces = build_event(eid, entry)
        if not eps:
            continue
        failed = download_cuts(images)
        all_failed += failed
        # 다운로드 실패(미러 누락) 컷씬 마커는 빼서 UI 깨짐 방지
        if failed:
            bad = set(failed)
            for ep in eps:
                ep["lines"] = [ln for ln in ep["lines"] if ln.get("img") not in bad]
        out = {"id": eid, "eps": eps, "faces": faces}
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
