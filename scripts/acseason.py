#!/usr/bin/env python3
"""위수 협의 **시즌 해석** 공용 모듈 (2026-09-05).

시즌을 다루는 스크립트가 둘(`build-autochess.py`·`build-autochess-routes.py`)이라
규칙을 양쪽에 적으면 새 시즌이 왔을 때 한쪽만 따라간다. 규칙은 여기 한 곳에만 둔다.
새 시즌 대응 절차 전체는 `.claude/skills/autochess-season` 스킬이 정본.

핵심: **시즌 목록을 손으로 적지 않는다.** activity_table 최상위 `autoChessData`의
`versionInfoDict` 가 정본이고, 키가 `V<시즌>_<단계>` · 값에 `activityId` 가 있다.
    {"V1_1": {"activityId": "act1autochess", …}, "V2_1": {"activityId": "act2autochess", …}}
그래서 새 시즌이 게임에 들어오면 `--all` 한 번으로 저절로 늘어난다.

파일명 규약: **최신 시즌은 접미사 없음** (`autochess.json`) — 기존 임포트·공유 링크가
안 깨진다. 지난 시즌만 `-s<N>` 이 붙는다 (`autochess-s1.json`). 그래서 새 시즌이 오면
옛 최신본이 자동으로 `-s<N>` 쪽으로 내려간다.
"""
import re
import sys


def seasons_of(at):
    """activity_table → [(시즌 번호, 활동 id)] 오름차순."""
    ver = (at.get("autoChessData") or {}).get("versionInfoDict") or {}
    found = {}
    for key, v in ver.items():
        m = re.match(r"V(\d+)_", key or "")
        aid = (v or {}).get("activityId")
        if m and aid:
            found[int(m.group(1))] = aid
    if not found:      # versionInfoDict 가 사라지면 활동 id 에서 되짚는다 (act<N>autochess)
        for aid in (at.get("activity", {}).get("AUTOCHESS_SEASON") or {}):
            m = re.match(r"act(\d+)autochess$", aid)
            if m:
                found[int(m.group(1))] = aid
    return sorted(found.items())


def season_arg(argv):
    """`--season N` → N. 없으면 None (부르는 쪽이 최신 시즌으로 채운다)."""
    if "--season" in argv:
        return int(argv[argv.index("--season") + 1])
    return None


def out_name(n, latest, suffix=""):
    """시즌 번호 → 산출 파일명 뿌리. 최신 시즌만 접미사가 없다."""
    return f"autochess{'' if n == latest else f'-s{n}'}{suffix}"


def dispatch_all(script, seasons, argv):
    """`--all` — 시즌마다 자기 자신을 다시 부르고 끝낸다.

    두 스크립트 다 최상위 코드가 **한 시즌을 전제**로 짜여 있어 (전역 KR·ACT…) 한
    프로세스 안에서 두 번 돌 수 없다. 프로세스를 새로 띄우는 게 가장 확실하다.
    `--all` 이 없으면 아무것도 하지 않고 False 를 준다.
    """
    if "--all" not in argv:
        return False
    import os
    import subprocess
    rest = [a for a in argv[1:] if a != "--all"]
    for n, _aid in seasons:
        subprocess.run([sys.executable, os.path.abspath(script), "--season", str(n), *rest], check=True)
    return True
