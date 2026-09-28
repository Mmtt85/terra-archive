#!/usr/bin/env python3
"""리더기 소리(BGM·효과음)를 게임 CDN에서 뽑아 mp3로 굽는다 (2026-09-27).

Usage:
  python3 scripts/build-story-audio.py              # 트랙이 부르는 소리 중 없는 것만 뽑는다 + 색인
  python3 scripts/build-story-audio.py --backfill   # 이미 구운 스크립트·기록 JSON 에 au 트랙만 덧붙인다
  python3 scripts/build-story-audio.py --dry        # 뽑을 목록·크기만 본다

입력은 build-story-scripts.py / build-records.py 가 JSON 에 실은 `au` 트랙이다
(parse_story 의 소리 스냅샷 — 곡·반복음·효과음 **파일 이름**). 여기서는 그 이름을 실제 파일로만 바꾼다.
build-story-vn.py 가 vn 트랙의 배경·스탠딩 이름을 그림으로 바꾸는 것과 같은 짝이다.

산출물 (public/story/ 밑 — deploy.sh 가 R2 로 보내는 폴더):
  public/story/audio/<이름>.mp3
  public/story/audio/index.json     {"pad": 0.05, "a": {이름: [길이초, 종류]}}
      종류 0 = 한 번 울리는 소리 · 1 = 반복(곡 루프·환경음) · "<루프이름>" = 그 루프로 이어지는 인트로
      화면은 색인에 **없는 이름은 부르지 않는다** (CDN 에도 없던 것 — 404 를 안 쌓는다).

## 파일 앞뒤 여백 (이음매) — 왜 PAD 를 붙이는가
MP3 는 인코더가 앞에 지연을 깔고, **브라우저마다 그걸 다르게 먹는다** (2026-09-27 실측, 같은 파일을
decodeAudioData: 크로미움은 앞 1,105샘플 밀림, 웹킷은 576샘플. 길이는 둘 다 같다). 그래서 파일
길이만으로는 곡이 어디서 시작하는지 알 수 없다. 대신:
  · 루프는 앞에 **곡의 끝**, 뒤에 **곡의 처음**을 PAD 만큼 덧대 굽는다 — 시작점을 조금 틀리게 잡아도
    이어지는 내용이 진짜 다음 소리라 이음매가 끊기지 않는다 (위상만 살짝 밀린다).
  · 인트로는 뒤에 **이어질 루프의 처음**을 덧댄다 — 인트로가 조금 길게 울려도 루프 머리가 들린다.
  · 화면(app/story-audio.ts)은 시작점을 가장 늦은 쪽(1,105샘플)으로 잡는다 → 오차가 늘 +쪽이라
    위 덧댐으로 덮인다.
  색인의 길이(초)는 덧댐을 뺀 **원래 곡 길이**다 — 루프 끝을 샘플 단위로 맞추는 데 쓴다.

## 인코딩
lameenc(pip) VBR 5 — 곡 평균 ~124kbps, 효과음 ~70kbps. 원본 표본율·채널을 그대로 둔다.
Opus 가 더 작지만 사파리의 decodeAudioData 지원이 불확실해 MP3 로 간다.
디코딩은 UnityPy + fmod_toolkit(번들 안 FSB5 → WAV). ⚠ ffmpeg 는 필요 없다.

⚠ mp3 는 git 에 올리지 않는다 (.gitignore) — 수백 MB 이고 이 스크립트로 언제든 다시 뽑힌다.
  R2 로는 deploy.sh(r2-sync)가 **이 체크아웃에 있는 것**을 올린다. 색인(index.json)은 git 에 둔다.
"""
import importlib.util
import io
import json
import os
import re
import sys
import wave
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(SCRIPTS)
sys.path.insert(0, SCRIPTS)
OUT = os.path.join(REPO, "public", "story", "audio")
INDEX = os.path.join(OUT, "index.json")
SCRIPT_DIR = os.path.join(REPO, "public", "story", "script")
REC_DIR = os.path.join(REPO, "public", "records")
CDN_CACHE = os.path.join(REPO, ".gamedata", ".cdn")
PAD = 0.05          # 앞뒤 덧댐(초) — 브라우저 간 시작점 오차(최대 ~25ms)보다 넉넉히
VBR_Q = 5


def load_bss():
    spec = importlib.util.spec_from_file_location("bss", os.path.join(SCRIPTS, "build-story-scripts.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── 대상 JSON (이벤트 전문 3개 언어 + 오퍼 기록 3개 언어) ─────────────────────
LOCALES = {"ko": ("kr", "박사"), "en": ("en", "Doctor"), "ja": ("jp", "ドクター")}


def docs():
    """(경로, 로케일, 종류) — 종류 'eps'(이벤트) / 'recs'(기록)"""
    for loc in LOCALES:
        d = SCRIPT_DIR if loc == "ko" else os.path.join(SCRIPT_DIR, loc)
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.endswith(".json"):
                    yield os.path.join(d, f), loc, "eps"
        d = os.path.join(REC_DIR, loc)
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.endswith(".json"):
                    yield os.path.join(d, f), loc, "recs"


def save(path, doc):
    json.dump(doc, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


# ── --backfill: 이미 구운 JSON 에 au 만 덧붙인다 ─────────────────────────────
# 스크립트 전체 재생성(build-story-scripts.py)은 부작용이 크다 — story-script-ids 목록을 덮어쓰고,
# 컷씬을 다시 합성하고, build-story-vn.py 의 스탠딩 보정(patch_missing)을 날린다 (PROJECT-GUIDE §리더기).
# 그래서 소리만은 **원문을 다시 파싱해 줄이 똑같은 편에만** 트랙을 붙인다. 어느 원문이 어느 편인지는
# 표를 따라가지 않고 **내용으로** 찾는다 — 캐시(.gamedata/story-cache)의 원문을 전부 파싱해
# 줄 목록의 지문으로 색인한다. 이벤트·기록·중섭 선행 원문이 한 규칙으로 풀린다.
def _sig(lines):
    import hashlib
    norm = [{**ln, "img": ln["img"].lower()} if "img" in ln else ln for ln in lines]
    return hashlib.sha1(json.dumps(norm, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def _struct(lines):
    """번역본(중섭 원문 AI 번역)용 — 글자를 빼고 줄의 **모양**만 본다. 병합 검증이 줄 수·키·img·br 을
    원문과 1:1 로 맞춰 두므로(cn_merge) 이것으로 원문을 찾을 수 있다."""
    import hashlib
    shape = [[sorted(k for k in ln if k != "vals"), (ln.get("img") or "").lower(), ln.get("br"),
              len(ln.get("opts") or [])] for ln in lines]
    return hashlib.sha1(json.dumps(shape).encode()).hexdigest()


def backfill():
    bss = load_bss()
    cache = bss.CACHE
    by_srv = defaultdict(list)
    for f in os.listdir(cache):
        m = re.match(r"(en|jp|cn)__", f)
        by_srv[m.group(1) if m else "kr"].append(os.path.join(cache, f))
    print("원문 캐시:", {k: len(v) for k, v in by_srv.items()})

    exact = {}                  # 지문 → au (로케일 호칭으로 파싱한 결과)
    shape = defaultdict(list)   # 모양 → [au…] (중섭 원문 — 번역본 짝찾기)
    for loc, (srv, nick) in LOCALES.items():
        bss.NICKNAME = nick
        for sv in (srv, "cn"):
            for p in by_srv.get(sv, []):
                txt = open(p, encoding="utf-8").read()
                au = []
                lines = bss.parse_story(txt, None, au)
                if not lines:
                    continue
                exact.setdefault(_sig(lines), au)
                if sv == "cn" and loc == "ko":
                    shape[_struct(lines)].append(au)
        print(f"  {loc}: 색인 {len(exact)}개")

    stats = Counter()
    unmatched = []
    for path, loc, kind in docs():
        doc = json.load(open(path, encoding="utf-8"))
        changed = False
        for k, ep in enumerate(doc.get(kind, [])):
            au = exact.get(_sig(ep["lines"]))
            if au is None and (doc.get("tr") == "cn" or ep.get("tr") == "cn"):
                cands = shape.get(_struct(ep["lines"]), [])
                # 모양이 같은 원문이 여럿이면 소리까지 같을 때만 쓴다 (짧은 기록에서 드물게 겹친다)
                if cands and all(c == cands[0] for c in cands):
                    au = cands[0]
            if au is None:
                stats["unmatched"] += 1
                unmatched.append(f"{os.path.relpath(path, REPO)}#{k}")
                continue
            stats["matched"] += 1
            want = au if bss.has_audio(au) else None
            if want:
                stats["with_audio"] += 1
            if ep.get("au") != want:
                if want:
                    ep["au"] = want
                else:
                    ep.pop("au", None)
                changed = True
        if changed:
            save(path, doc)
            stats["files"] += 1
    print(f"편 {stats['matched']}개 짝찾음 (소리 있음 {stats['with_audio']}) · 못 찾음 {stats['unmatched']} · "
          f"고친 파일 {stats['files']}")
    for u in unmatched[:15]:
        print("   · 못 찾음:", u)
    if len(unmatched) > 15:
        print(f"   … 외 {len(unmatched) - 15}개")


# ── 추출 ────────────────────────────────────────────────────────────────────
def collect():
    """트랙 전체에서 (이름 → 종류). 반복으로 한 번이라도 쓰이면 반복으로 굽는다 (한 번 울릴 때도
    가운데 원래 구간만 재생하므로 문제없다). 인트로는 가장 자주 짝지어진 루프를 짝으로 둔다."""
    kind, partner = {}, defaultdict(Counter)
    for path, _loc, key in docs():
        doc = json.load(open(path, encoding="utf-8"))
        for ep in doc.get(key, []):
            for a in ep.get("au") or []:
                if a.get("m"):
                    kind[a["m"]] = 1
                    if a.get("mi"):
                        partner[a["mi"]][a["m"]] += 1
                for sid, _vol in (a.get("lp") or {}).values():
                    kind[sid] = 1
                for s in a.get("se") or []:
                    kind.setdefault(s[0], 0)
    for intro, cnt in partner.items():
        if kind.get(intro) != 1:            # 루프로도 쓰이는 파일은 루프가 이긴다
            kind[intro] = cnt.most_common(1)[0][0]
    return kind


def cdn_paths():
    """{파일 이름: (서버, 경로, 번들)} — 한섭 우선, 없으면 중섭 (선행 번역본의 새 곡)."""
    from fbsutil import Cdn, unity_lzham
    unity_lzham()
    out, conns = {}, {}
    for sv in ("cn", "kr"):                  # 뒤가 이긴다
        cdn = Cdn(sv, cache_dir=CDN_CACHE)
        conns[sv] = cdn
        for p, b in cdn.manifest().items():
            if not p.startswith("audio/sound_beta_2/") or "/voice" in p:
                continue
            out[p.rsplit("/", 1)[-1]] = (sv, p, b)
    return out, conns


def _pcm(clip):
    """AudioClip → (pcm16 bytes, 채널, 표본율). fmod_toolkit 이 FSB5 를 WAV 로 풀어 준다."""
    samples = clip.samples
    if not samples:
        return None
    wav = next(iter(samples.values()))
    w = wave.open(io.BytesIO(wav))
    ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    raw = w.readframes(n)
    if sw != 2:
        return None
    if ch > 2:                               # lameenc 는 2채널까지 — 앞 둘만
        import array
        a = array.array("h")
        a.frombytes(raw)
        b = array.array("h", (a[i + j] for i in range(0, len(a), ch) for j in (0, 1)))
        raw, ch = b.tobytes(), 2
    return raw, ch, sr


def _encode(pcm, ch, sr, kind, head=None):
    import lameenc
    fr = ch * 2
    n = len(pcm) // fr
    P = round(PAD * sr)
    if kind == 1 and n:
        rep = pcm * (P // n + 2) if n < P else pcm
        pre, post = rep[-P * fr:], rep[:P * fr]
    else:
        pre = b"\0" * (P * fr)
        post = head if head is not None and len(head) == P * fr else b"\0" * (P * fr)
    enc = lameenc.Encoder()
    enc.set_channels(ch)
    enc.set_in_sample_rate(sr)
    enc.set_quality(2)
    enc.set_vbr(4)
    enc.set_vbr_quality(VBR_Q)
    return bytes(enc.encode(pre + pcm + post) + enc.flush()), n / sr


def _clips(bundle_path):
    from fbsutil import unity_lzham
    import UnityPy
    unity_lzham()
    env = UnityPy.load(bundle_path)
    out = {}
    for obj in env.objects:
        if obj.type.name == "AudioClip":
            d = obj.read()
            out[(d.m_Name or "").lower()] = d
    return out


def work(job):
    """번들 하나 — [(이름, 종류, 짝 루프의 번들 경로|None)] 를 굽는다. 프로세스 풀에서 돈다."""
    bundle_path, tasks = job
    done, bad = {}, []
    try:
        clips = _clips(bundle_path)
    except Exception as e:
        return done, [(t[0], "번들 열기 실패: %s" % str(e)[:60]) for t in tasks]
    others = {}
    for name, kind, partner_bundle in tasks:
        clip = clips.get(name)
        if clip is None:
            bad.append((name, "번들 안에 없음"))
            continue
        try:
            got = _pcm(clip)
            if got is None:
                bad.append((name, "디코딩 실패"))
                continue
            pcm, ch, sr = got
            head = None
            if isinstance(kind, str):         # 인트로 — 뒤에 이어질 루프의 머리를 덧댄다
                src = clips if partner_bundle in (None, bundle_path) else others.setdefault(
                    partner_bundle, _clips(partner_bundle))
                loop = src.get(kind)
                lg = _pcm(loop) if loop is not None else None
                if lg and lg[1] == ch and lg[2] == sr:
                    head = lg[0][:round(PAD * sr) * ch * 2]
            mp3, dur = _encode(pcm, ch, sr, kind, head)
            open(os.path.join(OUT, name + ".mp3"), "wb").write(mp3)
            done[name] = [round(dur, 5), kind]
        except Exception as e:
            bad.append((name, str(e)[:80]))
    return done, bad


def extract(dry=False):
    kind = collect()
    idx = json.load(open(INDEX, encoding="utf-8")) if os.path.exists(INDEX) else {"pad": PAD, "a": {}}
    have = idx["a"]
    todo = {n: k for n, k in kind.items()
            if not (n in have and have[n][1] == k and os.path.exists(os.path.join(OUT, n + ".mp3")))}
    print(f"트랙이 부르는 소리 {len(kind)}개 (반복 {sum(1 for k in kind.values() if k == 1)} · "
          f"인트로 {sum(1 for k in kind.values() if isinstance(k, str))}) · 새로 구울 것 {len(todo)}개")
    if not todo:
        write_index(idx, kind)
        return
    paths, conns = cdn_paths()
    missing = sorted(n for n in todo if n not in paths)
    jobs = defaultdict(list)
    for n, k in todo.items():
        if n not in paths:
            continue
        sv, _p, b = paths[n]
        pb = None
        if isinstance(k, str) and k in paths:
            pb = paths[k][:1] + (paths[k][2],)
        jobs[(sv, b)].append((n, k, pb))
    sizes = {}
    for sv, cdn in conns.items():
        for a in cdn.hot_update["abInfos"]:
            sizes[(sv, a["name"])] = a.get("totalSize", 0)
    total = sum(sizes.get(k, 0) for k in jobs)
    print(f"번들 {len(jobs)}개 · 약 {total / 1048576:.0f}MB 수신 (캐시에 있으면 건너뜀) · CDN 에 없음 {len(missing)}개")
    if missing:
        print("   ·", ", ".join(missing[:12]), "…" if len(missing) > 12 else "")
    if dry:
        return

    def fetch(key):
        sv, b = key
        cdn = conns[sv]
        cdn.bundle(b)                       # 캐시에 내려받는다 (.gamedata/.cdn/<resVersion>_<dat>)
        dat = b.replace("/", "_").replace("#", "__").split(".")[0] + ".dat"
        return key, os.path.join(CDN_CACHE, "%s_%s" % (cdn.res_version, dat))

    need = set(jobs) | {pb for tasks in jobs.values() for _n, _k, pb in tasks if pb}
    with ThreadPoolExecutor(8) as ex:
        local = dict(ex.map(fetch, sorted(need)))
    os.makedirs(OUT, exist_ok=True)
    work_items = []
    for key, tasks in jobs.items():
        work_items.append((local[key], [(n, k, local.get(pb) if pb else None) for n, k, pb in tasks]))
    # 곡 번들이 무겁다 — 큰 것부터 돌려 끝이 늘어지지 않게
    work_items.sort(key=lambda w: -os.path.getsize(w[0]))
    bad_all, n_done = [], 0
    with ProcessPoolExecutor(max(2, (os.cpu_count() or 4) - 2)) as ex:
        for i, (done, bad) in enumerate(ex.map(work, work_items), 1):
            have.update(done)
            bad_all += bad
            n_done += len(done)
            if i % 20 == 0:
                print(f"  번들 {i}/{len(work_items)} · {n_done}/{len(todo)}개…")
                write_index(idx, kind, quiet=True)   # 중간에 죽어도 구운 만큼은 색인에 남긴다
    write_index(idx, kind)
    print(f"구움 {n_done}개 · 실패 {len(bad_all)}개")
    for n, why in bad_all[:20]:
        print("   ✗", n, why)
    print("→ R2 반영: node scripts/r2-sync.mjs (deploy.sh 가 돌린다)")


def write_index(idx, kind, quiet=False):
    """색인 — 지금 트랙이 부르는 것만 남긴다 (옛 이름은 파일이 있어도 뺀다)."""
    a = {n: v for n, v in sorted(idx["a"].items()) if n in kind and os.path.exists(os.path.join(OUT, n + ".mp3"))}
    os.makedirs(OUT, exist_ok=True)
    json.dump({"pad": PAD, "a": a}, open(INDEX, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    if quiet:
        return
    mb = sum(os.path.getsize(os.path.join(OUT, n + ".mp3")) for n in a) / 1048576
    print(f"색인 {len(a)}개 · {mb:.0f}MB → public/story/audio/index.json")


def main():
    args = sys.argv[1:]
    if "--backfill" in args:
        backfill()
        return
    extract(dry="--dry" in args)


if __name__ == "__main__":
    main()
