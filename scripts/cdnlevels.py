#!/usr/bin/env python3
"""게임 CDN에서 **작전 레벨 데이터**(levels/…)를 직접 꺼낸다 — 클뜯 레포를 기다리지 않는다.

표(gamedata/excel)는 `fetch-gamedata-cdn.py`, 그림은 `cdnassets.py`, 스토리 본문은
`build-story-scripts.py` 가 맡는다. 여기는 **작전 한 판의 속살** 담당이다:
등장 적(enemyDbRefs)·스폰 웨이브·이동 경로(routes)·타일 격자(mapData).
적 도감의 '등장 작전', 작전 도감의 지형 도면·드랍, 작전 시뮬레이터가 전부 이걸 먹는다.

## 왜 (2026-09-16)

사용자 제보: "작전 도감에서 이벤트 맵은 적 정보가 없다."
실측하니 작전 2,256개 중 **220개(전부 이벤트)** 에 등장 적이 비어 있었다. 원인은 적 도감이
레벨을 **클뜯 레포에서 HTTP 로 한 판씩** 받고 있었다는 것:
  · 무인 CI 는 `--meta-only` 로 돌아 이 단계를 통째로 건너뛴다 (2,283번 요청 = 179MB).
  · 그래서 채워지는 건 사람이 로컬에서 전체 실행을 돌린 그때뿐이고, 그 뒤 열린 이벤트는
    영영 빈 채로 남는다 (로컬 캐시 실측: act12mini·act50·act51 하나도 없음).

CDN 은 사정이 다르다 — **레벨 2,649개가 번들 6개**에 들어 있다. 2,283번 요청이 6번이 된다.
그래서 CI 도 매번 전체를 돌 수 있고, 새 이벤트 맵이 열린 날 바로 채워진다.

## 함정 (둘 다 실제로 당했다)

- **번들 하나에 레벨이 384개**다. `Cdn.text_asset()` 을 이름 없이 부르면 첫 TextAsset 을
  주므로 `level_main_00-01` 을 달라고 했는데 `level_sub_06-2-1` 이 나온다. 구조가 같아
  디코딩은 멀쩡히 되고 숫자만 딴판이라 눈치채기 어렵다 — **반드시 이름으로 고른다.**
- 공개 스키마(OpenArknightsFBS = 중섭)는 한섭 클라보다 필드가 앞선다. 루트 슬롯 수가
  안 맞아도 **뒤쪽 필드가 없는 것뿐**이면 flatc 는 정상 디코딩한다 (레포 JSON 8판과
  대조해 적·경로·타일·웨이브가 전부 일치하는 것을 확인했다). 그래서 excel 표와 달리
  슬롯 수 검사를 걸지 않는다.
- 지난 이벤트는 CDN 매니페스트에서 빠진다 (act2multi·act42side 등). 그때는 None 을
  돌려주고 호출부가 종전대로 레포에서 받으면 된다.

사용:
    import cdnlevels
    d = cdnlevels.level("obt/main/level_main_00-01")      # dict | None
    d = cdnlevels.level("levels/obt/main/level_main_00-01.json")   # 같은 것
"""
import io
import json
import os
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(REPO, ".gamedata", ".cdn")
SCHEMA = "prts___levels"

_cdn = {}        # server -> Cdn
_bundles = {}    # (server, bundle) -> {에셋이름(소문자): FlatBuffer 바이트}
_schema = {}     # 스키마 이름 -> (fbs 경로, fbs 원문) | False
_ready = None
_lock = threading.RLock()


def available():
    """UnityPy·lz4inv·flatc 와 레벨 스키마가 다 있나. 없으면 호출부는 레포로 물러난다."""
    global _ready
    if _ready is None:
        try:
            import UnityPy  # noqa: F401
            import lz4inv   # noqa: F401
            subprocess.run(["flatc", "--version"], capture_output=True, check=True)
            _ready = _load_schema() is not None
        except Exception:
            _ready = False
    return _ready


def _load_schema(name=SCHEMA):
    """`fetch-gamedata-cdn.py` 의 schema_for 를 그대로 빌려 쓴다 (캐시·폴백 규칙 공유)."""
    if name not in _schema:
        import importlib.util
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch-gamedata-cdn.py")
        spec = importlib.util.spec_from_file_location("_fgcdn", path)
        mod = importlib.util.module_from_spec(spec)
        argv, sys.argv = sys.argv, ["fetch-gamedata-cdn.py"]
        try:
            spec.loader.exec_module(mod)
        except SystemExit:
            pass
        finally:
            sys.argv = argv
        p, txt = mod.schema_for(name, "kr")
        _schema[name] = (p, txt) if txt else False
    return _schema[name] or None


def _conn(server):
    with _lock:
        if server not in _cdn:
            from fbsutil import Cdn, unity_lzham
            unity_lzham()
            c = Cdn(server, cache_dir=CACHE)
            c.manifest()
            _cdn[server] = c
        return _cdn[server]


def _table(server, bundle):
    """번들 하나를 열어 {에셋이름(소문자): FlatBuffer 바이트}. 번들당 한 번만.

    레벨 번들은 하나에 수백 개가 들어 있어서(최대 903개) 한 판씩 열면 같은 10MB 를
    수백 번 다시 푼다. 이름표만 만들어 두고 나중에 꺼내 쓴다.
    """
    key = (server, bundle)
    if key in _bundles:
        return _bundles[key]
    with _lock:
        if key in _bundles:
            return _bundles[key]
        import UnityPy
        env = UnityPy.load(io.BytesIO(_conn(server).bundle(bundle)))
        out = {}
        for obj in env.objects:
            if obj.type.name != "TextAsset":
                continue
            try:
                d = obj.read()
                s = d.m_Script
                raw = s.encode("utf-8", "surrogateescape") if isinstance(s, str) else bytes(s)
                out[(d.m_Name or "").lower()] = raw[128:]    # 앞 128바이트는 RSA 서명
            except Exception:
                continue
        _bundles[key] = out
        return out


def _norm(path):
    """'levels/obt/main/level_main_00-01.json' → 'obt/main/level_main_00-01'"""
    p = str(path)
    if p.endswith(".json"):
        p = p[:-5]
    if p.startswith("levels/"):
        p = p[len("levels/"):]
    return p.strip("/")


def level(path, server="kr", schema=SCHEMA):
    """레벨 하나를 공식 JSON 모양 dict 로. CDN 에 없거나 못 뜯으면 None.

    ⚠ `levels/enemydata/enemy_database` 는 레벨이 아니라 **적 스탯 원본**이라 스키마가 다르다
    (`enemy_database.fbs`). 레벨 스키마로 풀면 구조가 같은 자리만 읽혀 22칸짜리 엉뚱한
    dict 가 나온다 — 조용히 틀리므로 `schema=` 로 명시해 부를 것 (2026-09-17 실측).
    """
    if not available():
        return None
    lid = _norm(path)
    try:
        cdn = _conn(server)
        full = "gamedata/levels/" + lid
        mani = cdn.manifest()
        bundle = mani.get(full)
        if bundle is None:
            hits = [(p, b) for p, b in mani.items() if p.startswith(full)]
            if not hits:
                return None
            full, bundle = sorted(hits)[0]
        fb = _table(server, bundle).get(full.rsplit("/", 1)[-1].lower())
        if fb is None:
            return None
        return _decode(fb, schema)
    except Exception as e:
        print("⚠ CDN 레벨 실패(%s): %s" % (lid, str(e)[:60]), file=sys.stderr)
        return None


def _decode(fb, schema=SCHEMA):
    from fbsutil import load_flatc_json
    got = _load_schema(schema)
    if got is None:
        return None
    fbs_path, fbs_text = got
    with tempfile.TemporaryDirectory() as tmp:
        binp = os.path.join(tmp, "level.fb")
        open(binp, "wb").write(fb)
        r = subprocess.run(
            ["flatc", "--json", "--raw-binary", "--strict-json", "--allow-non-utf8",
             "--defaults-json", "-o", tmp, fbs_path, "--", binp],
            capture_output=True)
        out = os.path.join(tmp, "level.json")
        if r.returncode != 0 or not os.path.exists(out):
            return None
        return load_flatc_json(out, fbs_text)


if __name__ == "__main__":   # 수동 확인: python3 scripts/cdnlevels.py obt/main/level_main_00-01
    for arg in sys.argv[1:]:
        d = level(arg)
        if d is None:
            print(arg, "→ 없음")
        else:
            md = d.get("mapData") or {}
            print(arg, "→ 적 %d · 경로 %d · 타일 %d (%sx%s)"
                  % (len(d.get("enemyDbRefs") or []), len(d.get("routes") or []),
                     len(md.get("tiles") or []), md.get("width"), md.get("height")))
