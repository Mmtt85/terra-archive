#!/usr/bin/env python3
"""Build app/data/stories.json — AI 스토리 요약 탭의 이벤트 목록 + 이미지 수집.

Usage:
  python3 scripts/build-story.py                # 이벤트 목록 재생성 + 썸네일 다운로드
  python3 scripts/build-story.py --cuts act48side   # 해당 이벤트 컷씬 CG 다운로드 (요약 집필용)
  python3 scripts/build-story.py --chars act48side  # 스탠딩 CG 이름↔화자 매칭표 출력
  python3 scripts/build-story.py --chars act48side avg_4056_titi_1 "avg_npc_2068_1#2" …
                                                # 지정 스탠딩 CG 다운로드 (기본 표정 #1$1)

데이터 소스 (전부 원격 — 로컬 gamedata 폴더 불필요):
  - 이벤트 목록·제목(3개 언어)·에피소드 구성: 클뜯 레포 excel/story_review_table.json
    (kr 기준, en/jp는 미출시 이벤트면 한국어로 폴백)
  - 썸네일: ArknightsAssets/ArknightsAssets2(cn 브랜치)
    assets/dyn/arts/ui/storyreview/hubs/activity/storyentrypic_<id>.png
    → public/story/<eventId>.jpg (sips로 jpeg 변환, 있으면 스킵)
  - 컷씬 CG(--cuts): 스토리 스크립트의 [Image(image="...")] 태그를 수집해
    assets/dyn/avg/images/<name>.png → public/story/cut/<name>.jpg (1080px 리사이즈)

요약 본문은 app/data/story-summaries.json 에 별도 저장 — 이 스크립트가 만들지 않는다.
AI(Claude)가 스토리 스크립트를 정독하고 집필해 넣는다 (story-summary 스킬 참고).
ACTIVITY(사이드 스토리)만 수록. MINI_ACTIVITY(스토리 컬렉션)·MAINLINE은 필요해지면 확장.
"""
import json, os, re, subprocess, sys, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"

def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": "terra-archive-story/1.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read()
        return raw if binary else json.loads(raw.decode("utf-8"))

def to_jpeg(png_bytes, dest, max_px=None):
    """PNG 바이트를 jpeg로 변환해 저장 (macOS sips). 실패 시 png 그대로 저장."""
    tmp = dest + ".tmp.png"
    open(tmp, "wb").write(png_bytes)
    cmd = ["sips"] + (["-Z", str(max_px)] if max_px else []) + \
          ["-s", "format", "jpeg", "-s", "formatOptions", "78", tmp, "--out", dest]
    ok = subprocess.run(cmd, capture_output=True).returncode == 0
    os.remove(tmp)
    if not ok:  # sips 없는 환경 폴백 — png 확장자 그대로라도 동작은 한다
        open(dest, "wb").write(png_bytes)
    return ok

# ── --cuts <eventId>: 컷씬 CG 수집 (요약 집필 보조) ──────────────
def download_cuts(event_id):
    review = fetch(f"{GAMEDATA}/kr/gamedata/excel/story_review_table.json")
    event = review.get(event_id) or sys.exit(f"unknown event: {event_id}")
    cut_dir = os.path.join(REPO, "public", "story", "cut")
    os.makedirs(cut_dir, exist_ok=True)
    names = []
    for info in event["infoUnlockDatas"]:
        txt = fetch(f"{GAMEDATA}/kr/gamedata/story/{info['storyTxt']}.txt", binary=True).decode("utf-8")
        for m in re.finditer(r'\[Image\(image="([^"]+)"', txt, re.I):
            if m.group(1) not in names: names.append(m.group(1))
    for name in names:
        dest = os.path.join(cut_dir, f"{name}.jpg")
        if os.path.exists(dest):
            print("skip:", name); continue
        png = fetch(f"{ASSETS}/avg/images/{name}.png", binary=True)
        to_jpeg(png, dest, max_px=1080)
        print("cut:", f"/story/cut/{name}.jpg")
    print(f"{event_id}: {len(names)} cutscenes → public/story/cut/")

if len(sys.argv) > 2 and sys.argv[1] == "--cuts":
    download_cuts(sys.argv[2]); sys.exit(0)

# ── --chars <eventId> [name…]: 스탠딩 CG 매칭표/다운로드 (요약 집필 보조) ──
# 인자 없이: 스크립트의 [charslot name=…]과 바로 뒤따르는 [name="화자"]를 세어
# "어느 스프라이트가 누구인지" 표를 출력한다. 이름을 주면 해당 스탠딩 CG를
# public/story/char/<base>.png 로 내려받는다 (표정 변형 미지정 시 #1$1).
def chars_mode(event_id, wanted):
    review = fetch(f"{GAMEDATA}/kr/gamedata/excel/story_review_table.json")
    event = review.get(event_id) or sys.exit(f"unknown event: {event_id}")
    if wanted:
        char_dir = os.path.join(REPO, "public", "story", "char")
        os.makedirs(char_dir, exist_ok=True)
        for want in wanted:
            base = want.split("#")[0]
            variant = want if "#" in want else f"{want}#1$1"
            dest = os.path.join(char_dir, f"{base}.png")
            if os.path.exists(dest):
                print("skip:", base); continue
            url = f"{ASSETS}/avg/characters/{base}/{urllib.request.quote(variant)}.png"
            png = fetch(url, binary=True)
            tmp = dest + ".tmp.png"
            open(tmp, "wb").write(png)  # 스탠딩은 투명 배경이라 png 유지, 세로 640px로 축소
            ok = subprocess.run(["sips", "-Z", "640", tmp, "--out", dest], capture_output=True).returncode == 0
            os.remove(tmp) if ok else os.rename(tmp, dest)
            print("char:", f"/story/char/{base}.png")
        return
    from collections import Counter, defaultdict
    speaker_for = defaultdict(Counter)
    for info in event["infoUnlockDatas"]:
        txt = fetch(f"{GAMEDATA}/kr/gamedata/story/{info['storyTxt']}.txt", binary=True).decode("utf-8")
        active = set()
        for line in txt.splitlines():
            slots = re.findall(r'\[[Cc]har(?:slot|acter)\([^)]*?name2?\s*=\s*"([^"]+)"', line)
            if slots:
                active = {s.split("#")[0] for s in slots}; continue
            m = re.match(r'\s*\[name="([^"]+)"', line)
            if m and active:
                for a in active: speaker_for[a][m.group(1)] += 1
    for spr, cnt in sorted(speaker_for.items(), key=lambda kv: -sum(kv[1].values())):
        print(f"{sum(cnt.values()):4d}  {spr:28s} → {', '.join(n for n, _ in cnt.most_common(2))}")

if len(sys.argv) > 2 and sys.argv[1] == "--chars":
    chars_mode(sys.argv[2], sys.argv[3:]); sys.exit(0)

# ── 기본: stories.json + 썸네일 ─────────────────────────────
print("fetching story_review_table (kr/en/jp) …", file=sys.stderr)
kr = fetch(f"{GAMEDATA}/kr/gamedata/excel/story_review_table.json")
en = fetch(f"{GAMEDATA}/en/gamedata/excel/story_review_table.json")
jp = fetch(f"{GAMEDATA}/jp/gamedata/excel/story_review_table.json")

thumb_dir = os.path.join(REPO, "public", "story")
os.makedirs(thumb_dir, exist_ok=True)

# 스토리 회고 엔트리 이미지가 에셋 레포에 풀려 있지 않은 이벤트 — 스토리 CG로 대체
THUMB_FALLBACK = {
    "act24side": f"{ASSETS}/avg/images/36_i11.png",  # 불을 쫓는 낙엽
    "act36side": f"{ASSETS}/avg/images/54_i1.png",   # 테라밥
}

events, failed = [], []
acts = sorted((v for v in kr.values() if v["entryType"] == "ACTIVITY"),
              key=lambda v: -v["startTime"])
for act in acts:
    eid = act["id"]
    # 에피소드: 같은 storyCode의 작전 전/후를 하나로 묶은 개수
    codes = []
    for info in act["infoUnlockDatas"]:
        if info["storyCode"] and info["storyCode"] not in codes: codes.append(info["storyCode"])
    events.append({
        "id": eid,
        "name": {
            "ko": act["name"],
            "en": (en.get(eid) or {}).get("name") or act["name"],
            "ja": (jp.get(eid) or {}).get("name") or act["name"],
        },
        "start": time.strftime("%Y-%m", time.gmtime(act["startTime"])),
        "episodes": len(codes),
        "thumb": f"/story/{eid}.jpg",
    })
    dest = os.path.join(thumb_dir, f"{eid}.jpg")
    if os.path.exists(dest): continue
    pic = (act.get("storyEntryPicId") or f"storyEntryPic_{eid}").lower()
    url = THUMB_FALLBACK.get(eid) or f"{ASSETS}/arts/ui/storyreview/hubs/activity/{pic}.png"
    try:
        png = fetch(url, binary=True)
        to_jpeg(png, dest, max_px=640 if eid in THUMB_FALLBACK else None)
        print("thumb:", eid, file=sys.stderr)
    except Exception as err:  # noqa: BLE001 — 썸네일 하나 실패해도 목록은 만든다
        failed.append((eid, pic, str(err)))

out = {"updated": time.strftime("%Y-%m-%d"), "events": events}
json.dump(out, open(f"{REPO}/app/data/stories.json", "w", encoding="utf-8"),
          ensure_ascii=False, separators=(",", ":"))
print(f"stories.json: {len(events)} events")
if failed:
    print("FAILED thumbs:", failed, file=sys.stderr)
    sys.exit(1)
