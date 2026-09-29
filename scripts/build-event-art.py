#!/usr/bin/env python3
"""이벤트 도감 그림 — 게임 CDN(한·일·글)에서 직접 언팩한다 (UnityPy·lz4inv 필요, 로컬 전용).

## 왜 (사용자 요청 2026-09-23)

"듀얼채널 이벤트말인데, 섬네일 없어? 있을거 같은데?" — 이벤트 도감의 썸네일은 스토리 파이프라인의
키비주얼(public/story/<id>.webp)을 빌려 쓴다. 그래서 **스토리가 없는 이벤트**(듀얼 채널·위수 협의·
벡터 돌파·인도자의 시련 …, 2026-09-23 기준 27개)는 전부 '이미지 없음'이었다. 게임은 이런 이벤트도
홈 화면에 테마 그림을 건다 — 그걸 받는다.

## 무엇을 받나

① 홈 테마 그림 `arts/ui/stage/hometheme/<활동 id>` → public/event/<id>.webp (한국어)
   · 일섭 → public/event/ja/<id>.webp · 글섭 → public/event/en/<id>.webp (그림 속 글자가 서버 언어다)
   ⚠ **지금 걸린 이벤트만** CDN에 있다 (2026-09-23 한섭 9장). 지난 이벤트 것은 다시 받을 수 없으니
     한 번 받은 파일은 지우지 않는다 — 점검 때마다 돌려 새 이벤트 것을 모아 둔다.
     build-events.py 가 스토리 썸네일이 없을 때만 이걸 쓴다.
② 듀얼 채널(activity.ENEMY_DUEL) 상세 — 화면은 app/event-duel.tsx, 데이터는 build-event-duel.py
   · 모드 배너 `activity/[uc]<id>/arts/modebanner/<entryPicId>` · 관객 NPC 아바타 `…/npcavatars/`
     → public/event/duel/<id>/  (⚠ 활동 번들도 **진행 중인 회차만** 남는다 — 지난 회차는 그림 없이 나간다)
   · 게임 안내 5장 `arts/guidebookpages/[pack]enemyduel/entry_N` → public/event/duel/guide/<ko|ja|en>/
     회차 공통 규칙이라 서버마다 한 벌. 서버 언어 그대로다.
     ⚠ 텍스처는 **16:9 화면을 1024×1024 정사각형에 눌러 담은 것**이다 — 게임은 16:9 칸에 늘려 그린다.
       그대로 저장하면 글자·그림이 위아래로 늘어나 보인다 (사용자 지적 2026-09-23). 그래서 1600×900 으로
       되돌려 저장한다 (세로 1024 → 900 은 거의 손실이 없고, 가로 1024 → 1600 은 늘리기만 한다).
   · 메달 `arts/ui/medalicon/…` · 프로필 아바타 `arts/ui/playeravatar/…` · 가구 `arts/ui/furnitureicons/drop/…`
     → public/event/medal/ · event/avatar/ · event/furni/  (지난 회차 것도 아직 남아 있다. 한섭에서만 받는다 —
     글자 없는 그림이다)

③ 지난 이벤트 대체 그림 (2026-09-28) — 아래 mirror_fallback() 주석. 에셋 미러(ArknightsAssets2)의 글로벌판
   홈 테마 그림, 그것도 도면도 없으면 교환 재화 아이콘 합성. CDN 없이 돈다 (`--only-mirror`).

사용: python3 scripts/build-event-art.py [--server kr,jp,en] [--only-mirror]
⚠ 뒤이어 build-events.py(썸네일 연결) → build-event-duel.py(듀얼 상세) → node scripts/r2-sync.mjs
  (public/event/ 는 R2 폴더다 — r2-sync 를 안 돌리면 커밋·배포해도 그림이 404)
"""
import argparse
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fbsutil import Cdn, unity_lzham  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.join(REPO, ".gamedata")
PUB = os.path.join(REPO, "public", "event")
THUMB_SUB = {"kr": "", "jp": "ja", "en": "en"}      # 홈 테마 썸네일 — 서버 → 하위 폴더 ("" = 한국어 기본)
GUIDE_LOC = {"kr": "ko", "jp": "ja", "en": "en"}


def save_webp(img, dest, max_w=None, quality=82, size=None):
    """같은 내용이면 파일을 건드리지 않는다 — git·r2-sync 가 헛변경을 안 보게.
    size=(w, h) 면 그 크기로 **비율을 무시하고** 맞춘다 (정사각형에 눌러 담긴 16:9 텍스처를 되돌릴 때)."""
    from PIL import Image
    im = img.convert("RGBA")
    if size:
        im = im.resize(size, Image.LANCZOS)
    elif max_w and im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)
    data = buf.getvalue()
    if os.path.exists(dest) and open(dest, "rb").read() == data:
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, "wb").write(data)
    return True


def run(server):
    unity_lzham()
    import UnityPy
    cdn = Cdn(server, cache_dir=os.path.join(G, "cdn-cache"))
    man = cdn.manifest()
    low = {p.lower(): (p, b) for p, b in man.items()}      # 매니페스트 경로는 대소문자가 섞여 있다
    act = json.load(open(os.path.join(G, f"{server}_activity_table.json"), encoding="utf-8"))
    basic = act["basicInfo"]
    duel = (act.get("activity") or {}).get("ENEMY_DUEL") or {}
    jobs = {}     # 번들 → [(컨테이너 키, 저장 경로, 최대 폭 | (w, h))]

    def want(path, dest, max_w=None):
        hit = low.get(path.lower())
        if not hit:
            return False
        # UnityPy 컨테이너 키 = "dyn/" + 매니페스트 경로(소문자) + ".png"
        jobs.setdefault(hit[1], []).append(("dyn/" + hit[0].lower() + ".png", dest, max_w))
        return True

    # ① 홈 테마 — 활동 id 인 것만 (main_N·rogue_*·sandbox_* 는 이벤트 도감 밖이다)
    # 중섭(cn)은 **한섭에 아직 없는 미래시 이벤트**만, 한국어 자리가 비어 있을 때만 받는다 (2026-09-29 벡터 돌파 #3 —
    # 스토리가 없어 섬네일이 없었다). 그림 속 제목이 중국어지만 다른 판이 아직 없다. 한섭에 열리면 kr 실행이 덮는다.
    kr_basic = json.load(open(os.path.join(G, "kr_activity_table.json"), encoding="utf-8"))["basicInfo"] if server == "cn" else {}
    for p in man:
        if p.lower().startswith("arts/ui/stage/hometheme/"):
            aid = p.rsplit("/", 1)[1]
            if aid not in basic:
                continue
            if server == "cn":
                dest = os.path.join(PUB, f"{aid}.webp")
                if aid not in kr_basic and not os.path.exists(dest):
                    want(p, dest, 720)
                continue
            want(p, os.path.join(PUB, THUMB_SUB[server], f"{aid}.webp"), 720)

    # ② 듀얼 채널
    for aid, d in duel.items():
        if server == "kr":
            base = f"activity/[uc]{aid}/arts/"
            for m in (d.get("modeData") or {}).values():
                pic = m.get("entryPicId")
                if pic:
                    want(base + "modebanner/" + pic, os.path.join(PUB, "duel", aid, pic.lower() + ".webp"), 1020)
            for n in (d.get("npcData") or {}).values():
                av = n.get("avatarId")
                if av:
                    want(base + "npcavatars/" + av, os.path.join(PUB, "duel", aid, "npc", av + ".webp"))
            for mid in (basic.get(aid) or {}).get("ungroupedMedalIds") or []:
                # 메달 폴더 구조가 회차마다 다르다 (act1 은 medalicon/act1enemyduel/ 아래) — 이름으로 찾는다
                p = next((x for x in man if x.lower().startswith("arts/ui/medalicon/")
                          and x.rsplit("/", 1)[1].lower() == mid.lower()), None)
                if p:
                    want(p, os.path.join(PUB, "medal", mid + ".webp"))
            for ms in d.get("milestoneList") or []:
                r = ms.get("reward") or {}
                if r.get("type") == "PLAYER_AVATAR":
                    want("arts/ui/playeravatar/" + r["id"], os.path.join(PUB, "avatar", r["id"] + ".webp"))
                elif r.get("type") == "FURN":
                    want("arts/ui/furnitureicons/drop/" + r["id"], os.path.join(PUB, "furni", r["id"] + ".webp"))
    if duel and server in GUIDE_LOC:
        for i in range(1, 10):
            if not want(f"arts/guidebookpages/[pack]enemyduel/entry_{i}",
                        os.path.join(PUB, "duel", "guide", GUIDE_LOC[server], f"entry_{i}.webp"), (1600, 900)):
                break

    wrote = kept = miss = 0
    for bundle, items in sorted(jobs.items()):
        env = UnityPy.load(io.BytesIO(cdn.bundle(bundle)))
        cont = dict(env.container.items())     # ContainerHelper 는 .get 이 없다(속성 접근으로 오인)
        for key, dest, max_w in items:
            obj = cont.get(key)
            if obj is None:
                miss += 1
                print(f"  ⚠ 번들에 없음: {key}")
                continue
            fit = max_w if isinstance(max_w, tuple) else None
            if save_webp(obj.read().image, dest, None if fit else max_w, size=fit):
                wrote += 1
            else:
                kept += 1
    print(f"{server}: 새로 씀 {wrote} · 그대로 {kept} · 못 찾음 {miss}  (resVersion {cdn.res_version})")


MIRROR = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/{ref}/assets/dyn/"
MIRROR_HOME = MIRROR.format(ref="en") + "arts/ui/stage/hometheme/"


def mirror_png(path):
    """에셋 미러에서 PNG 한 장 — 글로벌(en) 먼저, 없으면 중섭(cn). 없으면 None."""
    import urllib.parse
    import urllib.request
    from PIL import Image
    for ref in ("en", "cn"):
        try:
            with urllib.request.urlopen(MIRROR.format(ref=ref) + urllib.parse.quote(path), timeout=30) as res:
                return Image.open(io.BytesIO(res.read()))
        except Exception:  # noqa: BLE001 — 404 면 다음 브랜치
            continue
    return None


def on_card(img, max_w, dest):
    """작은 그림을 카드 비율의 **투명** 바탕 가운데에 얹는다 — 두 배 넘게 키우지 않는다(흐려진다)."""
    from PIL import Image
    im = img.convert("RGBA")
    w = min(max_w, im.width * 2)
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    canvas = Image.new("RGBA", CARD, (0, 0, 0, 0))
    canvas.paste(im, ((CARD[0] - im.width) // 2, (CARD[1] - im.height) // 2), im)
    save_webp(canvas, dest)
CARD = (420, 508)      # 이벤트 카드 얼굴 비율 (globals.css .ev-card-face aspect-ratio — object-fit: contain)


def is_grid_render(path):
    """작전 도면이 **실사가 아니라 build-stages.py 의 격자 렌더**인가 — 인게임 미리보기가 없는 작전은 타일 격자를
    그려 두는데, 섬네일로 걸면 어두운 칸만 보인다 (2026-09-28 만우절·폴리비전·위수 협의 1회차·벡터 돌파 1회차·
    협동 경기). 파일 형식으론 못 가른다(둘 다 손실 WebP) — 96px 로 줄여 4비트 색 가짓수를 센다.
    실측: 격자 35~95 · 실사 205~538. 기준 150."""
    from PIL import Image
    im = Image.open(path).convert("RGB").resize((96, 96))
    return len({(r >> 4, g >> 4, b >> 4) for r, g, b in im.getdata()}) < 150


def mirror_fallback():
    """③ 지난 이벤트 대체 그림 (사용자 요청 2026-09-28 "섬네일 없는 게 되게 많네... 다 만들어줘" — 138개 중 24개).

    게임 CDN 에는 **지금 걸린 이벤트의 홈 테마 그림만** 남아서(①), 스토리도 없고 그 회차를 놓친 지난 이벤트
    (인도자의 시련·듀얼 채널 1·2회차·벡터 돌파·협동 경기 …)는 '이미지 없음'이었다.
    ⓐ 에셋 미러의 **글로벌(en) 브랜치** 홈 테마 그림을 받는다 — 미러엔 한섭 브랜치가 없고, 중섭판은 그림 속
       제목이 중국어라 **영어판을 한국어 자리(public/event/<id>.webp)에도** 쓴다 (en·ja 는 build-events.py 가
       그 파일로 물러난다). 이미 있는 파일(①의 한섭·언어판)은 덮지 않는다. 메인 사이드(actNmainss)는 그림이
       _1~_3 으로 쪼개져 있어 _1 을 쓴다.
    ⓑ 그것도 없으면 **대표 작전 도면**(public/stage/ — 작전 도감의 지형 도면, 목록에서 첫 **실사** 도면 —
       격자 렌더는 건너뛴다, is_grid_render)을 카드 비율
       (420:508 세로)로 **가운데를 잘라** 만든다. 카드는 object-fit: contain 이라 가로 도면(640×360)을 그대로 걸면
       위아래가 비어 작게 뜬다. (인도자의 시련 1~4·벡터 돌파 1회차·위수 협의 1회차·협동 경기·폴리비전 박물관 …)
    ⓒ 실사 도면도 없으면 작은 공식 그림을 카드 비율의 **투명** 바탕 가운데에 얹는다 — 그대로 걸면 카드 가득
       늘어나 흐려지고, 바탕을 칠하면 라이트 모드에서 덩어리가 된다(카드 바탕색이 비쳐 보이게 둔다).
       ① 미러의 홈 화면 입구 배너 `activity/[uc]<id>/prefab/top_entry_holder/home_entry_big` (만우절 — 254×112)
       ② 교환 재화 아이콘 — 사이트 public/items/, 없으면 미러 `activity/commonassets/[uc]items/<iconId>`
          (힘노이의 지혜·폴리비전 박물관·위수 협의 1회차·벡터 돌파 1회차·협동 경기)
    대상은 지난번 build-events.py 산출물(app/data/events.json)에서 **스토리가 없는** 이벤트뿐이다."""
    import urllib.request
    from PIL import Image
    ev_path = os.path.join(REPO, "app", "data", "events.json")
    if not os.path.exists(ev_path):
        print("mirror: app/data/events.json 이 없다 — build-events.py 를 먼저 돌린다")
        return
    rows = [r for r in json.load(open(ev_path, encoding="utf-8"))["events"] if not r.get("story") and not r.get("fut")]
    got = cropped = made = 0
    for r in rows:
        aid = r["id"]
        dest = os.path.join(PUB, f"{aid}.webp")
        if os.path.exists(dest):
            continue
        for name in (f"{aid}.png", f"{aid}_1.png"):
            try:
                with urllib.request.urlopen(MIRROR_HOME + name, timeout=30) as res:
                    img = Image.open(io.BytesIO(res.read()))
            except Exception:  # noqa: BLE001 — 404 면 다음 후보
                continue
            save_webp(img, dest, 720)
            got += 1
            print(f"  mirror: {aid} ← hometheme/{name}")
            break
        if os.path.exists(dest):
            continue
        smap = next((p for p in (os.path.join(REPO, "public", "stage", f"{st[0]}.webp") for st in r.get("stages") or [])
                     if os.path.exists(p) and not is_grid_render(p)), None)
        if smap:
            im = Image.open(smap).convert("RGB")
            w = min(im.width, round(im.height * CARD[0] / CARD[1]))
            h = min(im.height, round(w * CARD[1] / CARD[0]))
            x, y = (im.width - w) // 2, (im.height - h) // 2
            save_webp(im.crop((x, y, x + w, y + h)), dest)
            cropped += 1
            print(f"  mirror: {aid} ← 작전 도면 가운데 ({os.path.basename(smap)})")
            continue
        entry = mirror_png(f"activity/[uc]{aid}/prefab/top_entry_holder/home_entry_big.png")
        if entry is not None:
            on_card(entry, 400, dest)
            made += 1
            print(f"  mirror: {aid} ← 홈 입구 배너 합성")
            continue
        for it in r.get("items") or []:
            icon_id = it[2] if len(it) > 2 else it[0]
            local = os.path.join(REPO, "public", "items", f"{icon_id}.webp")
            img = Image.open(local) if os.path.exists(local) else mirror_png(f"activity/commonassets/[uc]items/{icon_id}.png")
            if img is not None:
                on_card(img, 200, dest)
                made += 1
                print(f"  mirror: {aid} ← 재화 아이콘 합성 ({icon_id})")
                break
    print(f"mirror: 홈 테마 그림 {got} · 작전 도면 {cropped} · 작은 그림 합성 {made}  (스토리 없는 이벤트 {len(rows)}개 중)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="kr,jp,en", help="cn 을 더하면 미래시 이벤트 홈 테마 그림")
    ap.add_argument("--only-mirror", action="store_true", help="CDN 언팩 없이 ③ 지난 이벤트 대체 그림만")
    args = ap.parse_args()
    if not args.only_mirror:
        for s in args.server.split(","):
            run(s.strip())
    mirror_fallback()


if __name__ == "__main__":
    main()
