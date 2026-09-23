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

사용: python3 scripts/build-event-art.py [--server kr,jp,en]
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
    for p in man:
        if p.lower().startswith("arts/ui/stage/hometheme/"):
            aid = p.rsplit("/", 1)[1]
            if aid in basic:
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
    if duel:
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="kr,jp,en")
    for s in ap.parse_args().server.split(","):
        run(s.strip())


if __name__ == "__main__":
    main()
