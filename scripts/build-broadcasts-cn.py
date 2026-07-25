#!/usr/bin/env python3
"""중국 서버(미래시) 공식 방송 일정을 app/data/broadcasts.json에 반영한다.

Usage: python3 scripts/build-broadcasts-cn.py   (변경 없으면 파일을 건드리지 않는다)

중섭 공식 방송은 유튜브가 아니라 **비리비리 라이브**다 — 明日方舟 공식 계정(uid 161775300)의
라이브룸 5555734. 스페이스·다이내믹 API는 wbi 서명이 필요하지만 라이브룸 get_info는 서명 없이
열려 있고, 운영팀이 **방 소개문에 다음 방송 일정을 적어 둔다**:

    title       集成战略「沉沦者的黑流树海」前瞻试玩直播
    description 《明日方舟》全新集成战略主题「…」前瞻试玩直播计划将于7月15日20:00进行。
    live_status 0=꺼짐 1=생방송 2=재방송 루프,  live_time=생방송 시작(CST)

**왜 크론 워커가 아니라 여기(GitHub Actions)인가**: 비리비리는 클라우드플레어 이그레스를
리스크컨트롤로 막는다 (workers/broadcast에서 모든 엔드포인트 412 "request was banned",
2026-07-25 확인). GitHub 러너에서는 정상 응답(code 0)이라 결정론 레인(data-refresh.yml)에
붙였다. 그래서 갱신 주기는 6시간이 아니라 하루 1~3회 — 방송은 며칠 전에 공지되므로 충분하다.

프론트(app/home.tsx BroadcastBadges)는 워커 payload와 이 정적 파일을 합쳐 보여주고,
server="cn" 항목은 **미래시 데이터 포함이 켜졌을 때만** 노출한다 (사이트 공통 규칙).
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = f"{REPO}/app/data/broadcasts.json"

ROOM = 5555734
ROOM_API = f"https://api.live.bilibili.com/room/v1/Room/get_info?room_id={ROOM}"
ROOM_URL = f"https://live.bilibili.com/{ROOM}"
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Referer": ROOM_URL,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
CST = timezone(timedelta(hours=8))
DEFAULT_DURATION_MIN = 150
MAX_CN = 4   # 중섭 방송 이력 보존 수 — 화면 전체 지난 방송 상한이 10건이라 중섭은 소수만


def fetch_room():
    req = urllib.request.Request(ROOM_API, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.load(res).get("data") or {}


def live_iso(live_time):
    """'2026-07-15 20:00:00'(CST) → ISO8601(+08:00). 미방송('0000-…')이면 None"""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})", str(live_time or ""))
    if not m or m.group(1) == "0000":
        return None
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}:00+08:00"


def schedule_iso(desc, now=None):
    """방 소개문의 '7月15日20:00' → ISO8601(+08:00).

    연도가 없으므로 작년·올해·내년 중 **지금과 가장 가까운** 해를 고른다 (연말연시 뒤집힘 방지).
    """
    m = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2})\s*[:：时点]\s*(\d{2})?", str(desc or ""))
    if not m:
        return None
    now = now or datetime.now(CST)
    mo, day, hh = int(m.group(1)), int(m.group(2)), int(m.group(3))
    mm = int(m.group(4) or 0)
    best = None
    for year in (now.year - 1, now.year, now.year + 1):
        try:
            dt = datetime(year, mo, day, hh, mm, tzinfo=CST)
        except ValueError:      # 2월 30일 같은 오탈자
            continue
        gap = abs((dt - now).total_seconds())
        if best is None or gap < best[0]:
            best = (gap, dt)
    return best[1].isoformat() if best else None


def collect():
    data = fetch_room()
    if not data:
        sys.exit("라이브룸 응답이 비었습니다 — 비리비리 차단 여부 확인")
    cover = data.get("user_cover") or None
    title = (data.get("title") or "").strip()
    out = []
    start = live_iso(data.get("live_time")) if data.get("live_status") == 1 else None
    if start:
        out.append({"server": "cn", "title": title or "明日方舟 공식 생방송", "start": start,
                    "durationMin": DEFAULT_DURATION_MIN, "url": ROOM_URL, "cover": cover,
                    "key": f"cn:live:{start[:10]}"})
    sched = schedule_iso(data.get("description"))
    # 생방송 중이면 같은 날짜 예고는 중복이라 싣지 않는다
    if sched and (not start or sched[:10] != start[:10]):
        out.append({"server": "cn", "title": title or str(data.get("description") or "")[:60],
                    "start": sched, "durationMin": DEFAULT_DURATION_MIN, "url": ROOM_URL,
                    "cover": cover, "key": f"cn:sched:{sched[:10]}"})
    return out


def main():
    doc = json.load(open(OUT, encoding="utf-8"))
    entries = doc.get("broadcasts", [])
    others = [b for b in entries if b.get("server") != "cn"]
    # 기존 중섭 항목은 이력으로 남기고(지난 방송도 계속 보여준다), 같은 날짜는 새 정보로 덮는다
    by_key = {b.get("key") or f"cn:{b.get('start', '')[:10]}": b for b in entries if b.get("server") == "cn"}
    for b in collect():
        by_key[b["key"]] = b
    cn = sorted(by_key.values(), key=lambda b: b.get("start", ""), reverse=True)[:MAX_CN]
    merged = others + cn
    if merged == entries:
        print("변경 없음 — 중섭 방송 일정 그대로")
        return
    doc["broadcasts"] = merged
    doc["updated"] = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
    json.dump(doc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    open(OUT, "a", encoding="utf-8").write("\n")
    print(f"갱신: 중섭 {len(cn)}건 (전체 {len(merged)}건)")
    for b in cn[:3]:
        print(f"  {b['start'][:16]} | {b['title'][:50]}")


if __name__ == "__main__":
    main()
