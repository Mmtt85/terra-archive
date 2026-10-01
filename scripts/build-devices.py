#!/usr/bin/env python3
"""미리 깔린 장치 사전 — 경로 지도(app/stage-route-map.tsx)가 장치 표식에 붙일 이름·설명·아이콘.

## 왜 (사용자 요청 2026-09-29 "어둠이랑 네온사인은 어디에 있는거야? 보이질 않네")

작전 시뮬레이터가 레벨의 미리 깔린 장치(predefines.tokenInsts — 네온사인·발리스타·토석 구조물 …)를
하나도 그리지 않아서, 작전 설명에 <네온사인>이 있어도 지도에서 찾을 수 없었다. 위치는 경로 문서의
pd(routeutil.devices_of_level)가 싣고, 여기는 **장치 종류당 한 번**만 적는 사전이다 — 이름·설명을
판마다 되풀이하면 5.6MB 짜리 stage-routes.json 이 더 불어난다.

## 형식 — app/data/devices.json  {장치 키: {n: {ko,en,ja}, d?: {ko,en,ja}, i?: 아이콘, h?: 1}}
  n  이름 — 한섭 표(kr/en/jp character_table). 한섭에 없는 미래시 장치는 중섭 이름 + cn-translations.json
  d  설명 — 게임 표의 한 줄(색 표식은 벗긴다). 표에 없으면 뺀다 (지어내지 않는다)
  i  아이콘(public 기준) — 게임 CDN 의 arts/charavatars/<키> 가 있는 것만 (135종 중 53종, 2026-09-29).
     없으면 화면이 마름모 표식으로 그린다
  h  숨김 — 게임 화면에 **안 보이는** 전역 제어용 장치 (밀물 제어·독가스 컨트롤러·중력·눈보라 …).
     레벨엔 보통 장식 칸에 한 개씩 박혀 있는데, 그대로 그리면 없는 물건이 지도에 생긴다.
     표에 '보이지 않음' 표식이 따로 없어서 이름·설명으로 가린다 (HIDDEN 아래 규칙).

사용:
  python3 scripts/build-devices.py            # 경로 파일 3종의 pd 에서 키를 모아 사전·아이콘을 만든다
  python3 scripts/build-devices.py --no-icons # 이름·설명만 (CDN 을 열지 않는다 — 무인 CI)

경로 파일에 pd 를 새로 붙이는 건 `python3 scripts/routenames.py stage rogue future` (빌더들도 부른다).
"""
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cntr  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "app", "data")
GD = os.path.join(REPO, ".gamedata")
ICON_DIR = os.path.join(REPO, "public", "stage", "dev")
ROUTE_FILES = ("stage-routes.json", "rogue-routes.json", "future-routes.json")

# 안 보이는 장치 — 표에 표식이 없어 이름·설명으로 가린다 (2026-09-29 전수 156종 중).
#  · 이름에 '제어'·'컨트롤러'·'통제' — 밀물 제어 장치·독가스 컨트롤러·협동 경기 통제·늪지대 제어 …
#  · 설명에 '보이지 않는' — 눈보라("보이지 않는 트랩, 눈보라 발동에 사용")
#  · 그 밖의 전역 효과 장치 — 이름만으론 안 잡혀 키로 적는다
HIDDEN_NAME = re.compile(r"제어|컨트롤러|통제")
HIDDEN_KEYS = {
    "trap_036_storm",        # 모래 폭풍 — 날씨
    "trap_1112_acblzd",      # 맹약의 한풍 — 날씨
    "trap_121_gractrl",      # 중력 — 중력 방향 전환
    "trap_092_vgctrl",       # 벤데타 — 전역 제어(ctrl)
    "trap_250_hlctrl",       # 근원 탐구 성사 — 전역 제어(ctrl)
    "trap_335_totalattack",  # 全场总攻击 — 전역 총공격 신호
}
# 변종 키(<장치>@<모습>)의 이름 — 맵 테마에 따라 모습이 다른 장치 (routeutil.DEVICE_VARIANTS 가 키를 고른다).
# 설명·아이콘은 @ 앞의 원래 장치를 그대로 쓴다
VARIANT_NAMES = {
    "trap_027_stone@box": {"ko": "박스", "en": "Box", "ja": "箱"},   # 흑류수해 맵의 돌무더기 (사용자 요청 2026-10-01)
}
TAG = re.compile(r"<[@$/][^>]*>|</>")


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def clean(s):
    return TAG.sub("", s or "").strip() or None


def device_keys():
    keys = set()
    for fn in ROUTE_FILES:
        p = os.path.join(DATA, fn)
        if not os.path.exists(p):
            continue
        for rec in load(p).values():
            if isinstance(rec, dict):
                keys.update(row[0] for row in rec.get("pd") or [])
    return keys


def icon(key, want):
    """CDN 아바타 → public/stage/dev/<키>.webp. 이미 있으면 그대로. 없으면 None."""
    rel = f"/stage/dev/{key}.webp"
    if os.path.exists(os.path.join(REPO, "public") + rel):
        return rel
    if not want:
        return None
    import cdnassets  # noqa: E402  (UnityPy — 필요할 때만)
    for server in ("kr", "cn"):
        mani = cdnassets._conn(server).manifest()
        path = f"arts/charavatars/{key}"
        if path not in mani and path.lower() not in mani:
            continue
        im = cdnassets.image(path, server=server)
        if im is None:
            continue
        os.makedirs(ICON_DIR, exist_ok=True)
        im = im.convert("RGBA")
        im.thumbnail((96, 96))
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=88)
        open(os.path.join(REPO, "public") + rel, "wb").write(buf.getvalue())
        return rel
    return None


def main():
    want_icons = "--no-icons" not in sys.argv
    tables = {loc: load(os.path.join(GD, f"{srv}_character_table.json"))
              for loc, srv in (("ko", "kr"), ("en", "en"), ("ja", "jp"), ("cn", "cn"))}
    tr = cntr.load(os.path.join(REPO, "scripts", "cn-translations.json"))
    out, untranslated = {}, []
    for key in sorted(device_keys()):
        row = {}
        base = key.split("@")[0]
        kr = tables["ko"].get(base)
        cn = tables["cn"].get(base) or {}
        if kr:
            n = {loc: tables[loc].get(base, {}).get("name") or kr.get("name") for loc in ("ko", "en", "ja")}
            d = {loc: clean(tables[loc].get(base, {}).get("description")) for loc in ("ko", "en", "ja")}
        else:
            # 미래시(중섭 선행) 장치 — 중섭 원문 + 비공식 번역. 번역이 없으면 원문 그대로 두고 알린다
            t_n, t_d = tr.get(cn.get("name") or "") or {}, tr.get(cn.get("description") or "") or {}
            if cn.get("name") and not t_n:
                untranslated.append(cn["name"])
            n = {loc: t_n.get(loc) or cn.get("name") or base for loc in ("ko", "en", "ja")}
            d = {loc: clean(t_d.get(loc) or cn.get("description")) for loc in ("ko", "en", "ja")}
        n = VARIANT_NAMES.get(key) or n
        row["n"] = {loc: v.strip() for loc, v in n.items()}
        if any(d.values()):
            row["d"] = {loc: v for loc, v in d.items() if v}
        name_all = " ".join(filter(None, [(kr or {}).get("name"), cn.get("name")]))
        desc_all = " ".join(filter(None, [(kr or {}).get("description"), cn.get("description")]))
        if base in HIDDEN_KEYS or HIDDEN_NAME.search(name_all) or "보이지 않는" in desc_all or "不可见" in desc_all:
            row["h"] = 1
        else:
            ic = icon(base, want_icons)
            if ic:
                row["i"] = ic
        out[key] = row
    p = os.path.join(DATA, "devices.json")
    json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  devices.json: 장치 {len(out)}종 · 아이콘 {sum(1 for r in out.values() if r.get('i'))} · "
          f"숨김 {sum(1 for r in out.values() if r.get('h'))} — {os.path.getsize(p) // 1024}KB")
    for s in untranslated:
        print(f"  ⚠ 장치 이름 미번역: {s} — scripts/cn-translations.json 에 채울 것")


if __name__ == "__main__":
    main()
