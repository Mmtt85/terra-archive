#!/usr/bin/env python3
"""스토리 리더용 **효과음**을 KR 공식 CDN에서 뽑아 m4a로 굽는다.

사용:
  python3 scripts/build-story-sfx.py              # 대본이 부르는 효과음 전부 (없는 것만)
  python3 scripts/build-story-sfx.py --force      # 이미 있어도 다시 굽는다
  python3 scripts/build-story-sfx.py --limit 50   # 앞에서 N개만 (시험용)

입력은 build-story-scripts.py 가 이미 낸 public/story/script/**/*.json 의 `au` 트랙이다
(효과음 키 = 대본의 [PlaySound(key="$…")]).

산출물 (public/story/ 밑 — deploy.sh 가 통째로 R2 로 보내는 폴더라 Cloudflare Pages 의
2만 파일 한도를 건드리지 않는다):
  public/story/sfx/<키>.m4a
  app/data/story-sfx-ids.json     ← 실제로 구운 키 목록 (화면이 있는 것만 재생)

## ⚠ BGM 은 여기서 다루지 않는다 (의도적)
음악은 Monster Siren Records 가 **별도 상품으로 파는 것**이라 재호스팅하지 않는다.
리더는 `au` 트랙의 BGM 키로 **곡명과 공식 링크만** 띄운다 (app/story-audio.ts).
효과음은 별도 판매 상품이 아닌 0.5~4초짜리 기능적 클립이라 배경·스탠딩과 같은 선에 둔다.

## 조달 경로 (2026-08-25 실증)
GitHub 미러(ArknightsAssets2)의 dyn/audio 에는 21개 파일뿐이라 쓸 수 없다. KR 공식
CDN 매니페스트에는 음원 번들이 2,619개(항목 72,782개) 있고, **대본 키가 파일 경로와
그대로 이어진다**:
    $d_gen_walk_n    → audio/sound_beta_2/avg/d_gen_walk_n
    $b_char_defboost → audio/sound_beta_2/battle/b_char/b_char_defboost
접두가 붙는 경우가 있어(`$indust_loop` → `m_bat_indust_loop`) **접미 일치**로 찾는다.

## 필요한 것
  pip3 install --user UnityPy lz4inv     (build-story.py --kr-thumbs 와 같은 언팩 경로)
  afconvert                              (macOS 내장 — 이 스크립트는 macOS 전용이다)
UnityPy 가 AudioClip 을 WAV(PCM)로 풀어 주고, afconvert 가 AAC 96kbps 로 줄인다.
AAC 를 고른 이유는 iOS 사파리까지 되는 유일한 무난한 선택이라서다 (Opus 는 더 작지만
사파리 지원이 들쭉날쭉하다).
"""
import io, json, os, re, struct, subprocess, sys, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT_DIR = os.path.join(REPO, "public", "story", "script")
OUT_DIR = os.path.join(REPO, "public", "story", "sfx")
DATA = os.path.join(REPO, "app", "data")
CACHE = os.path.join(REPO, ".gamedata", "story-sfx-cache")
CONF = "https://ak-conf.arknights.kr/config/prod/official/network_config"
BITRATE = "96000"          # AAC CBR — 실측 11.9 KB/초


def fetch(url, binary=False, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": "terra-archive-sfx/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read()
        return raw if binary else json.loads(raw.decode("utf-8"))


# ── 1. 대본이 부르는 효과음 키 모으기 ──────────────────────────────────────
def wanted_keys():
    """script/**/*.json 의 au 트랙에서 효과음 키를 모은다. 로케일 폴더도 훑지만 키는
    언어 공용이라 합집합이 곧 전체다."""
    keys = {}
    for root, _dirs, files in os.walk(SCRIPT_DIR):
        for fn in files:
            if not fn.endswith(".json"):
                continue
            try:
                doc = json.load(open(os.path.join(root, fn), encoding="utf-8"))
            except Exception:
                continue
            for ep in doc.get("eps") or []:
                for cue in ep.get("au") or []:
                    for snd in cue.get("s") or []:
                        if isinstance(snd, list) and snd and snd[0]:
                            keys.setdefault(snd[0], 0)
                            keys[snd[0]] += 1
    return keys


# ── 2. KR CDN 매니페스트 (.idx FlatBuffer 수제 파싱) ───────────────────────
# 스키마는 OpenArknightsFBS resource_manifest.fbs — build-story.py --kr-thumbs 와 같다.
def load_manifest():
    nw = json.loads(fetch(CONF)["content"])
    urls = nw["configs"][nw["funcVer"]]["network"]
    ver = fetch(urls["hv"].replace("{0}", "Android"))
    base = f"{urls['hu']}/Android/assets/{ver['resVersion']}"
    hul = fetch(f"{base}/hot_update_list.json")

    def fetch_dat(name):
        dat = name.replace("/", "_").replace("#", "__").split(".")[0] + ".dat"
        with zipfile.ZipFile(io.BytesIO(fetch(f"{base}/{dat}", binary=True))) as z:
            return z.read(z.filelist[0])

    buf = fetch_dat(hul["manifestName"])[128:]
    u32 = lambda o: struct.unpack_from("<I", buf, o)[0]
    i32 = lambda o: struct.unpack_from("<i", buf, o)[0]
    u16 = lambda o: struct.unpack_from("<H", buf, o)[0]

    def table(o):
        vt = o - i32(o); n = (u16(vt) - 4) // 2
        return lambda s: (o + u16(vt + 4 + s * 2)) if s < n and u16(vt + 4 + s * 2) else None

    def string_at(fo):
        so = fo + u32(fo); return buf[so + 4:so + 4 + u32(so)].decode("utf-8")

    def vector_at(fo):
        vo = fo + u32(fo); return vo + 4, u32(vo)

    root = table(u32(0))
    b0, bn = vector_at(root(1))
    bundles = []
    for i in range(bn):
        t = table(b0 + i * 4 + u32(b0 + i * 4)); f = t(0)
        bundles.append(string_at(f) if f else "")
    a0, an = vector_at(root(2))
    audio = {}                      # 자산 경로 → 번들 이름
    for i in range(an):
        t = table(a0 + i * 4 + u32(a0 + i * 4)); fa, fb = t(0), t(1)
        if not fa:
            continue
        p = string_at(fa)
        if p.lower().startswith("audio/"):
            audio[p] = bundles[i32(fb)] if fb else ""
    return base, audio, fetch_dat


# ── 3. 언팩 → WAV → m4a ────────────────────────────────────────────────────
def unity_env(raw):
    import lz4inv, UnityPy
    from UnityPy.enums.BundleFile import CompressionFlags
    from UnityPy.helpers.CompressionHelper import DECOMPRESSION_MAP
    DECOMPRESSION_MAP[CompressionFlags.LZHAM] = lz4inv.decompress_buffer
    return UnityPy.load(io.BytesIO(raw))


def encode(wav_bytes, dest):
    """WAV(PCM) → AAC m4a. afconvert 는 파이프를 안 받아서 임시 파일을 거친다."""
    tmp = dest + ".wav"
    open(tmp, "wb").write(wav_bytes)
    try:
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-s", "0",
                        "-b", BITRATE, tmp, dest],
                       check=True, capture_output=True)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def main():
    args = sys.argv[1:]
    force = "--force" in args
    limit = None
    if "--limit" in args:
        limit = int(args[args.index("--limit") + 1])
    if sys.platform != "darwin":
        sys.exit("afconvert 가 필요하다 — macOS 에서 실행할 것 (CI 는 이 단계를 돌리지 않는다)")
    try:
        import lz4inv, UnityPy  # noqa: F401
    except ImportError:
        sys.exit("pip3 install --user UnityPy lz4inv 후 다시 실행")

    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)

    keys = wanted_keys()
    print(f"대본이 부르는 효과음: {len(keys)}종 (호출 {sum(keys.values())}회)")
    todo = sorted(keys) if force else [k for k in sorted(keys)
                                       if not os.path.exists(os.path.join(OUT_DIR, k + ".m4a"))]
    if limit:
        todo = todo[:limit]
    if not todo:
        print("전부 이미 구워져 있다 — 할 일 없음")
        write_manifest(keys)
        return
    print(f"구울 것: {len(todo)}종")

    base, audio, fetch_dat = load_manifest()
    print(f"CDN 음원 항목: {len(audio)}개")

    # 키 → 자산 경로 (접미 일치). 여러 개 걸리면 경로가 짧은 쪽 = 더 정확한 매칭.
    bypath = {}
    for p in audio:
        bypath.setdefault(p.rsplit("/", 1)[-1].lower(), []).append(p)
    resolved, missing = {}, []
    for k in todo:
        cand = bypath.get(k.lower()) or []
        if not cand:                                  # 접두가 붙는 경우 (m_bat_ 등)
            cand = [p for p in audio if p.rsplit("/", 1)[-1].lower().endswith(k.lower())]
        if cand:
            resolved[k] = sorted(cand, key=len)[0]
        else:
            missing.append(k)
    print(f"경로 해석: {len(resolved)}종 · 못 찾음 {len(missing)}종")

    # 번들 단위로 묶어 한 번만 받는다 (한 번들에 여러 클립이 들어 있다)
    by_bundle = {}
    for k, p in resolved.items():
        by_bundle.setdefault(audio[p], []).append((k, p))

    done, failed = [], []

    def one(item):
        bundle, wants = item
        cached = os.path.join(CACHE, bundle.replace("/", "__"))
        try:
            if os.path.exists(cached):
                raw = open(cached, "rb").read()
            else:
                raw = fetch_dat(bundle)
                open(cached, "wb").write(raw)
            env = unity_env(raw)
            clips = {}
            for obj in env.objects:
                if obj.type.name != "AudioClip":
                    continue
                d = obj.read()
                for nm, blob in d.samples.items():
                    clips[os.path.splitext(nm)[0].lower()] = bytes(blob)
            out = []
            for k, p in wants:
                blob = clips.get(p.rsplit("/", 1)[-1].lower()) or clips.get(k.lower())
                if not blob:
                    failed.append(k); continue
                encode(blob, os.path.join(OUT_DIR, k + ".m4a"))
                out.append(k)
            return out
        except Exception as e:
            failed.extend(k for k, _ in wants)
            print(f"  ⚠ {bundle}: {type(e).__name__} {e}")
            return []

    with ThreadPoolExecutor(6) as ex:
        for got in ex.map(one, by_bundle.items()):
            done.extend(got)

    total = sum(os.path.getsize(os.path.join(OUT_DIR, f))
                for f in os.listdir(OUT_DIR) if f.endswith(".m4a"))
    print(f"완료: 신규 {len(done)}종 · 실패 {len(failed)}종 · 못 찾음 {len(missing)}종")
    print(f"public/story/sfx/ 총 {total / 1024 / 1024:.1f} MB")
    if missing:
        print(f"  못 찾음 표본: {missing[:8]}")
    if failed:
        print(f"  실패 표본: {failed[:8]}")
    write_manifest(keys)


def write_manifest(keys):
    """화면이 '있는 것만' 재생하도록 실제로 구워진 키를 낸다."""
    have = sorted(f[:-4] for f in os.listdir(OUT_DIR) if f.endswith(".m4a")) \
        if os.path.isdir(OUT_DIR) else []
    p = os.path.join(DATA, "story-sfx-ids.json")
    json.dump(have, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"  story-sfx-ids.json: {len(have)}종 {os.path.getsize(p) // 1024}KB")


if __name__ == "__main__":
    main()
