#!/usr/bin/env python3
"""게임 CDN에서 **excel 표 하나**를 바로 dict 로 꺼낸다 — 파일로 받아 두는 `fetch-gamedata-cdn.py` 와 같은
디코딩(같은 스키마·같은 슬롯 검사)을 함수로 쓰게 한 것. 레벨·적 DB 는 `cdnlevels.py` 몫이다.

## 왜 (2026-10-01, 사용자 확인 "침몰자 블랙플로우 엔딩 추가된거 있나?")

통합전략 빌더(build-rogue.py)가 표를 **한 번 받아 둔 레포 캐시(.gamedata/rogue/)에서만** 읽었다 — 캐시가 있으면
다시 받지 않았다. 그래서 8월 중순에 받은 판이 10월까지 그대로 쓰였고, 그사이 중섭에 들어온 흑류수해 월간 방문객
두 팀(9월 「未冷的」·10월 「南方往事」)이 사이트에 없었다. 표를 받아 두는 도구(fetch-gamedata-cdn.py)의 목록에도
roguelike_topic_table 이 없어 누가 받아 줄 수도 없었다. 이제 빌더는 여기서 **지금 게임이 쓰는 판**을 먼저 받는다.

캐시: `.gamedata/.cdn/tables/<서버>_<resVersion>_<표>.json` — 같은 판이면 다시 풀지 않는다(판이 바뀌면 새로 푼다).
못 얻으면(스키마 불일치·네트워크) None — 부르는 쪽이 종전 레포 캐시로 물러난다.

사용:
    import cdntables
    t = cdntables.table("roguelike_topic_table", server="cn")    # dict | None
"""
import importlib.util
import json
import os
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
CDN_CACHE = os.path.join(REPO, ".gamedata", ".cdn")
TABLE_CACHE = os.path.join(CDN_CACHE, "tables")

_fg = None          # fetch-gamedata-cdn.py 모듈 (이름에 하이픈이 있어 importlib 로 싣는다)
_cdn = {}           # server -> Cdn
_lock = threading.RLock()
_warned = set()


def _mod():
    global _fg
    if _fg is None:
        spec = importlib.util.spec_from_file_location("fetch_gamedata_cdn", os.path.join(HERE, "fetch-gamedata-cdn.py"))
        _fg = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_fg)
    return _fg


def _conn(server):
    if server not in _cdn:
        _cdn[server] = _mod().Cdn(server, cache_dir=CDN_CACHE)
    return _cdn[server]


def res_version(server="kr"):
    """그 서버 CDN 의 지금 판 (예: 26-09-22-07-47-20_6c71fa). 못 읽으면 None."""
    try:
        with _lock:
            return _conn(server).res_version
    except Exception:
        return None


def table(name, server="kr"):
    """excel 표 하나를 공식 JSON 모양 dict 로. 못 얻으면 None (이유는 한 번만 찍는다)."""
    with _lock:
        try:
            fg = _mod()
            cdn = _conn(server)
            cache = os.path.join(TABLE_CACHE, "%s_%s_%s.json" % (server, cdn.res_version, name))
            # 같은 판에서 한 번 못 푼 표는 다시 시도하지 않는다 — 스키마가 안 맞으면 몇 번을 해도 같고,
            # 한 번에 수 초(번들 읽기 + flatc)를 버린다 (2026-10-01: 빌더가 한 표를 여러 번 불러 매번 헛돌았다).
            # 판이 바뀌면(클라 업데이트) 새 이름이라 다시 시도한다.
            if os.path.exists(cache + ".fail"):
                raise RuntimeError(open(cache + ".fail", encoding="utf-8").read().strip() + " (같은 판에서 이미 실패)")
            if os.path.exists(cache):
                try:
                    with open(cache, encoding="utf-8") as f:
                        return json.load(f)
                except json.JSONDecodeError:
                    os.remove(cache)
            fg.unity_lzham()
            cdn.manifest()
            fb, _ = cdn.text_asset("gamedata/excel/" + name)
            fbs_path, fbs_text = fg.schema_for(name, server)
            if not fbs_text:
                raise RuntimeError("스키마 없음")
            data = fg.decode(fb, fbs_path, fbs_text, name)
            if data is None:
                why = "디코딩 실패(스키마 불일치 — python3 scripts/fbs-repair.py %s --server %s)" % (name, server)
                os.makedirs(TABLE_CACHE, exist_ok=True)
                with open(cache + ".fail", "w", encoding="utf-8") as f:
                    f.write(why)
                raise RuntimeError(why)
            os.makedirs(TABLE_CACHE, exist_ok=True)
            tmp = cache + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, cache)
            return data
        except Exception as e:
            key = (server, name)
            if key not in _warned:
                _warned.add(key)
                print("  ⚠ CDN 표 %s/%s 를 못 얻었다: %s — 레포 캐시로 물러난다" % (server, name, str(e)[:100]),
                      file=sys.stderr)
            return None


_story_bundles = {}   # (server, bundle) -> {에셋이름: 본문}


def story(path, server="kr"):
    """스토리 본문(gamedata/story/<path>) 하나를 글자로. 못 찾으면 None.

    통합전략 기록 원문(엔딩북 조각·월간 방문객 장면)이 쓴다 — 레포는 며칠씩 밀려, 이달 방문객 기록이 레포에 없던
    일이 있었다 (2026-10-01). build-story-scripts.py 의 cdn_story_txt 와 같은 방식이다:
    ⚠ 표와 달리 본문은 RSA 서명이 없어 text_asset()(앞 128바이트를 자른다)을 쓰면 첫 줄이 잘린다 — 번들을 직접 연다.
    ⚠ 한 번들에 본문이 1,700개 넘게 들어 있다 — **에셋 이름으로 고른다** (첫 TextAsset 을 집으면 엉뚱한 화가 나온다).
    """
    import io
    with _lock:
        try:
            fg = _mod()
            cdn = _conn(server)
            fg.unity_lzham()
            cdn.manifest()
            try:
                _, bundle = cdn.find("gamedata/story/" + path.lower())
            except KeyError:
                return None
            key = (server, bundle)
            if key not in _story_bundles:
                import UnityPy
                env = UnityPy.load(io.BytesIO(cdn.bundle(bundle)))
                tbl = {}
                for obj in env.objects:
                    if obj.type.name != "TextAsset":
                        continue
                    d = obj.read()
                    raw = d.m_Script
                    tbl[d.m_Name.lower()] = raw if isinstance(raw, str) else bytes(raw).decode("utf-8", "replace")
                _story_bundles[key] = tbl
            return _story_bundles[key].get(path.lower().rsplit("/", 1)[-1])
        except Exception as e:
            print("  ⚠ CDN 스토리 %s/%s 를 못 얻었다: %s" % (server, path, str(e)[:80]), file=sys.stderr)
            return None


if __name__ == "__main__":
    # 점검: python3 scripts/cdntables.py roguelike_topic_table kr cn en jp
    nm = sys.argv[1] if len(sys.argv) > 1 else "roguelike_topic_table"
    for srv in sys.argv[2:] or ["kr", "cn", "en", "jp"]:
        d = table(nm, srv)
        print(srv, res_version(srv), "→", "없음" if d is None else "%d개 키" % len(d))
