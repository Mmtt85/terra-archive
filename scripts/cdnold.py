#!/usr/bin/env python3
"""중섭 **옛 판** CDN 에서 그림 꺼내기 — 끝난 이벤트의 그림을 지금 CDN 이 내린 뒤에도 얻는다.

## 왜 (2026-10-01, 사용자 지적 "포영창정 교환재화도 섬네일 하나도 안나옴")

중섭 CDN 은 지금 판(resVersion)에 **끝난 이벤트의 활동 번들·아이콘을 빼 버린다**. 에셋 미러(ArknightsAssets2)·
yuanyan3060 에도 콜라보 같은 건 빠져 있다. 그런데 **옛 판 주소는 아직 그대로 준다**(실측: 5월 27일 판
26-05-27-13-32-37_d44f28 이 살아 있다). 판 번호는 클뜯 레포의 `cn/hot_update_list.json` 이 그 무렵 커밋마다 들고 있다.

쓰는 곳: build-events.py(교환 재화 아이콘) · build-event-art.py --extra(미실장 이벤트 훈장·가구 아이콘).
⚠ `gh` (GitHub CLI, 로그인됨)가 있어야 커밋을 찾는다 — 로컬 전용. 없으면 None 으로 조용히 물러난다.

사용:
    import cdnold
    im = cdnold.image_at("act50side_melding_1", ts)   # ts = 그 이벤트 중섭 개방 시각(초)
"""
import io
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
CACHE = os.path.join(os.path.dirname(HERE), ".gamedata", "cdn-cache")
_by_ts = {}       # 개방 시각 → fbsutil.Cdn | None


def cdn_at(ts):
    """그 시각(개방일 사흘 뒤까지)의 마지막 레포 커밋이 기록한 중섭 판에 붙은 Cdn. 못 열면 None."""
    if not ts:
        return None
    if ts in _by_ts:
        return _by_ts[ts]
    _by_ts[ts] = None
    try:
        import fbsutil
        until = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts + 3 * 86400))
        sha = subprocess.run(["gh", "api", "-X", "GET", "repos/ArknightsAssets/ArknightsGamedata/commits",
                              "-f", "path=cn/hot_update_list.json", "-f", f"until={until}", "-f", "per_page=1",
                              "--jq", ".[0].sha"], capture_output=True, text=True, timeout=60).stdout.strip()
        if not sha:
            return None
        url = f"https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/{sha}/cn/hot_update_list.json"
        with urllib.request.urlopen(url, timeout=120) as r:
            ver = json.loads(r.read().decode("utf-8")).get("versionId")
        c = fbsutil.Cdn("cn", cache_dir=CACHE)
        c.res_version = ver
        c.assets = "%s/%s/assets/%s" % (c.urls["hu"], "Android", ver)
        c.hot_update = fbsutil._get(c.assets + "/hot_update_list.json")
        _by_ts[ts] = c
        print(f"  옛 중섭 CDN 판 {ver} ({time.strftime('%Y-%m-%d', time.gmtime(ts))} 개방 이벤트)")
    except Exception as e:  # noqa: BLE001 — gh 없음(CI)·네트워크 — 그림 없이 간다
        print(f"  ⚠ 옛 중섭 CDN 판을 못 열었다 ({str(e)[:60]})")
    return _by_ts[ts]


def image_at(name, ts):
    """그 판에서 에셋 이름(경로 끝)이 name 인 그림 하나 (PIL.Image | None). 활동 재화·훈장·가구는 폴더가 제각각이라
    (`activity/[uc]act50side/arts/meldingitem/…`, `arts/ui/medalicon/act53side/…`) 경로 끝 이름으로 찾는다."""
    c = cdn_at(ts)
    if not c:
        return None
    want = name.lower()
    for path, bundle in [(k, v) for k, v in c.manifest().items() if k.lower().rsplit("/", 1)[-1] == want]:
        import UnityPy
        env = UnityPy.load(io.BytesIO(c.bundle(bundle)))
        for kind in ("Sprite", "Texture2D"):
            for obj in env.objects:
                if obj.type.name == kind:
                    d = obj.read()
                    if (getattr(d, "m_Name", "") or "").lower() == want:
                        return d.image
    return None
