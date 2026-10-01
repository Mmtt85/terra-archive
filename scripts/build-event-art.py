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

    # ③ 벡터 돌파 (activity.VEC_BREAK_V2, 2026-09-29 사용자 요청 "벡터돌파 말인데, 표시할 수 있는 데이터는 다 표시") —
    #    scripts/build-event-vecbreak.py 가 파일 유무로 경로를 싣는다. 그림은 회차 공용 폴더(arts/ui/[uc]vecbreakv2/)에
    #    **지난 회차 것까지** 남아 있다(한섭 CDN: 2회차 보급·교관·특별 전선 아이콘). 중섭은 한섭에 없는 회차(미래시)만.
    #    · 전투 보급 아이콘 squadbuff/<iconId> · 교관 offensebossicon/<iconId> · 특별 전선 적 bossicon/<bossIconId>
    #    · 메달 medalicon/**/<medalId> (duel 과 같은 public/event/medal/) · 게임 안내 guidebookpages/[pack]vecbreakv2/*
    vec = (act.get("activity") or {}).get("VEC_BREAK_V2") or {}
    _sk_path = os.path.join(G, f"{server}_skin_table.json")
    skins = (json.load(open(_sk_path, encoding="utf-8")).get("charSkins") or {}) if vec and os.path.exists(_sk_path) else {}
    for aid, d in vec.items():
        if server == "cn" and aid in kr_basic:
            continue
        ui = "arts/ui/[uc]vecbreakv2/"
        for b in (d.get("battleBuffDict") or {}).values():
            if b.get("iconId"):
                want(ui + "squadbuff/" + b["iconId"], os.path.join(PUB, "vec", "buff", b["iconId"].lower() + ".webp"))
        for st in list((d.get("offenseStageDict") or {}).values()) + list((d.get("hardStageDict") or {}).values()):
            ic = (st.get("bossData") or {}).get("iconId")
            if ic:
                want(ui + "offensebossicon/" + ic, os.path.join(PUB, "vec", "boss", ic.lower() + ".webp"))
        for st in (d.get("defenseDetailDict") or {}).values():
            if st.get("bossIconId"):
                want(ui + "bossicon/" + st["bossIconId"], os.path.join(PUB, "vec", "def", st["bossIconId"].lower() + ".webp"))
        # 벡터 돌파는 basicInfo 에 메달 목록(ungroupedMedalIds)이 없다 — 메달 id 접두로 찾는다
        for p in man:
            name = p.rsplit("/", 1)[1].lower()
            if p.lower().startswith("arts/ui/medalicon/") and name.startswith(f"medal_activity_{aid}_"):
                want(p, os.path.join(PUB, "medal", name + ".webp"))
        for ms in d.get("milestoneList") or []:
            r = ms.get("reward") or {}
            if r.get("type") == "PLAYER_AVATAR":
                want("arts/ui/playeravatar/" + r["id"], os.path.join(PUB, "avatar", r["id"] + ".webp"))
            elif r.get("type") == "FURN":
                want("arts/ui/furnitureicons/drop/" + r["id"], os.path.join(PUB, "furni", r["id"] + ".webp"))
            elif r.get("type") == "CHAR_SKIN":
                # 사이트 복장 초상(public/skin/portrait — build-skins)에 없는 새 복장만 (미래시 회차)
                sk = (skins.get(r["id"]) or {}).get("portraitId")
                if sk and not os.path.exists(os.path.join(REPO, "public", "skin", "portrait", sk + ".webp")):
                    want("arts/charportraits/skins/" + sk, os.path.join(PUB, "skin", sk + ".webp"))   # 복장은 skins/ 아래
    # 게임 안내는 모드 공용이라 서버(언어)마다 한 벌 — 중섭판은 한국어 자리가 빌 때만 (미래시 회차만 있는 동안)
    guide_loc = GUIDE_LOC.get(server) or ("ko" if server == "cn" else None)
    if vec and guide_loc and not (server == "cn" and os.path.exists(os.path.join(PUB, "vec", "guide", "ko", "offense_1.webp"))):
        for part in ("offense", "defense"):
            for i in range(1, 10):
                if not want(f"arts/guidebookpages/[pack]vecbreakv2/{part}_{i}",
                            os.path.join(PUB, "vec", "guide", guide_loc, f"{part}_{i}.webp"), (1600, 900)):
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

    # ⓓ 미실장(중섭 선행) 이벤트 중 그림이 없는 것 — 미러의 **중섭(cn) 브랜치** 홈 테마 그림 (2026-10-01).
    #    ①(--server cn)은 중섭 CDN 에 **지금 걸린** 이벤트 것만 받으니, 중섭에서 이미 끝난 미실장 이벤트
    #    (相变临界·진지 축구·丛林症结 …)는 그림 없이 떴다. 미실장은 중섭판이 원본이라 그림 속 중국어 제목을 허용한다
    #    (build-story.py 미실장 썸네일과 같은 예외). 메인 사이드(actNmainss)는 _1 로 쪼개져 있다.
    #    스토리가 있는 미실장은 build-story.py 가 /story/cn/ 에 따로 받으므로 여기서 건드리지 않는다.
    fut_rows = [r for r in json.load(open(ev_path, encoding="utf-8"))["events"]
                if r.get("fut") and not r.get("story") and not str(r.get("thumb") or "").startswith("/event/")]
    fut_got = 0
    for r in fut_rows:
        aid = r["id"]
        dest = os.path.join(PUB, f"{aid}.webp")
        if os.path.exists(dest):
            continue
        for name in (f"{aid}.png", f"{aid}_1.png"):
            img = mirror_png(f"arts/ui/stage/hometheme/{name}")
            if img is not None:
                save_webp(img, dest, 720)
                fut_got += 1
                print(f"  mirror(cn): {aid} ← hometheme/{name}")
                break
        else:
            print(f"  ⚠ mirror(cn): {aid} 홈 테마 그림을 못 찾았다 — 카드는 '이미지 없음'으로 뜬다")
    print(f"mirror: 미실장 이벤트 그림 {fut_got}장 (그림 없던 {len(fut_rows)}개 중)")


def extra_art():
    """④ 이벤트 창 추가 탭(app/event-extra.tsx)의 그림 — 훈장 아이콘 → public/event/medal/<id>.webp,
    이벤트 가구 아이콘 → public/event/furni/<id>.webp (2026-10-01). 목록은 scripts/build-event-extra.py 산출물에서 읽는다.
    둘 다 **지난 이벤트 것도 한섭 CDN 에 남아 있다**(실측 훈장 536/536 · 가구 363/363) — 폴더가 테마·이벤트마다 달라
    (medalicon/act51side/…, furnitureicons/ursusroom/…) 경로 끝 이름으로 찾는다. 이미 있는 파일은 건너뛴다."""
    import glob
    import cdnassets
    want, aid_of = {}, {}
    for f in glob.glob(os.path.join(REPO, "app", "data", "event-extra", "ko", "*.json")):
        d = json.load(open(f, encoding="utf-8"))
        aid = os.path.basename(f)[:-5]
        for m in (d.get("medals") or {}).get("list") or []:
            want[m[0]] = os.path.join(PUB, "medal", m[0] + ".webp"); aid_of[m[0]] = aid
        for x in (d.get("furn") or {}).get("list") or []:
            want[x[0]] = os.path.join(PUB, "furni", x[0] + ".webp"); aid_of[x[0]] = aid
        for m in d.get("missions") or []:
            for r in m[1]:
                if r[0] == "furn":
                    want[r[1]] = os.path.join(PUB, "furni", r[1] + ".webp"); aid_of[r[1]] = aid
    todo = {k: v for k, v in want.items() if not os.path.exists(v)}
    if not todo:
        print(f"extra: 훈장·가구 그림 {len(want)}장 다 있다")
        return
    # 한섭 → 중섭(미실장 이벤트) → 그 이벤트가 열려 있던 중섭 옛 판(끝난 미실장 이벤트 — scripts/cdnold.py)
    last = {}
    for server in ("kr", "cn"):
        for p in cdnassets._conn(server).manifest():
            lp = p.lower()
            if lp.startswith(("arts/ui/medalicon/", "arts/ui/furnitureicons/")):
                last.setdefault(lp.rsplit("/", 1)[-1], (server, p))
    cn_basic = {}
    cn_p = os.path.join(G, "cn_activity_table.json")
    if os.path.exists(cn_p):
        cn_basic = json.load(open(cn_p, encoding="utf-8")).get("basicInfo") or {}
    got = miss = 0
    for name, dest in sorted(todo.items()):
        hit = last.get(name.lower())
        im = cdnassets.image(hit[1], hit[0]) if hit else None
        if im is None:
            st = (cn_basic.get(aid_of.get(name)) or {}).get("startTime")
            if st:
                import cdnold
                im = cdnold.image_at(name, st)
        if im is None:
            miss += 1
            print(f"  ⚠ extra: {name} 그림을 못 찾았다")
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        save_webp(im, dest, 96)
        got += 1
        if got % 100 == 0:
            print(f"  extra: {got}/{len(todo)}")
    print(f"extra: 훈장·가구 그림 새로 {got} · 못 찾음 {miss} (전체 {len(want)})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="kr,jp,en", help="cn 을 더하면 미래시 이벤트 홈 테마 그림")
    ap.add_argument("--only-mirror", action="store_true", help="CDN 언팩 없이 ③ 지난 이벤트 대체 그림만")
    ap.add_argument("--extra", action="store_true", help="④ 이벤트 창 추가 탭의 훈장·가구 그림만 (build-event-extra.py 뒤)")
    args = ap.parse_args()
    if args.extra:
        extra_art()
        return
    if not args.only_mirror:
        for s in args.server.split(","):
            run(s.strip())
    mirror_fallback()


if __name__ == "__main__":
    main()
