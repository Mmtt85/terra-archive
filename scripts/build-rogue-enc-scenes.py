#!/usr/bin/env python3
"""통합전략 조우 씬 트리 — PRTS 위키 ISEvent 데이터를 게임 데이터 id에 매칭한다.

왜 이 스크립트가 있나 (2026-08-16, 사용자 지시 "수작업으로 하면 끝이 없어. 데이터 연결이 돼야해"):
게임 excel(roguelike_topic_table)에는 조우의 **씬↔선택지 소속**과 **랜덤 롤 테이블**이 없다
(선택지는 NEXT_PROB·nextSceneId=null 뿐, 그 배선은 클라이언트 C# 프리팹에 있음 — [uc]lua에도 없음).
그래서 기존 extract_encounters는 접두 매칭으로 선택지를 전부 _enter 씬에 평탄하게 쏟았고,
다단계 조우(북지 주술사 경기 등)는 rogueN-curated.json encounterTree 수작업 19건이 전부였다.

PRTS 위키의 `<테마>/事件一览` 페이지가 이 배선을 {{ISEvent/scene}}·{{ISEvent/choose|…|dest=N}}
템플릿으로 구조화해 갖고 있다 — 씬별 선택지 목록, 선택지→결과 씬 링크(dest, 0-based 씬 인덱스),
랜덤 분기 확률(【源石锭】20%概率)까지. 이걸 CN excel과 텍스트 매칭해 **게임 데이터 id 기반**
씬 트리(scripts/rogue-enc-scenes.json)로 변환한다. build-rogue.py가 이 트리를 각 로케일
텍스트로 해석해 encounters[].scenes로 병합한다.

실측 커버리지 (2026-08-16): 이벤트 제목 매칭 297/297 (100%) · 선택지 정확+정규화 약 93%,
나머지는 퍼지·분기 라벨 처리. IS6은 정확 매칭 100%.

사용:
  python3 scripts/build-rogue-enc-scenes.py            # 캐시 사용 (없으면 PRTS에서 받음)
  python3 scripts/build-rogue-enc-scenes.py --refresh  # PRTS 강제 재다운로드

⚠ PRTS 요청에는 User-Agent + Accept-Language 헤더가 필수 (없으면 WAF가 403).
출력: scripts/rogue-enc-scenes.json (커밋 대상 — build-rogue.py의 입력)
"""
import difflib
import json
import os
import re
import sys
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(REPO, ".gamedata", "rogue")
OUT = os.path.join(REPO, "scripts", "rogue-enc-scenes.json")

# CN 테마명 → 事件一览 페이지 (cn excel topics[].name과 일치해야 함)
THEMES = {
    "rogue_1": "傀影与猩红孤钻",
    "rogue_2": "水月与深蓝之树",
    "rogue_3": "探索者的银凇止境",
    "rogue_4": "萨卡兹的无终奇语",
    "rogue_5": "岁的界园志异",
    "rogue_6": "沉沦者的黑流树海",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "ko,en;q=0.9",   # ⚠ 빼면 PRTS WAF가 403을 낸다 (실측)
}


def fetch_events(tid, refresh=False):
    cache = os.path.join(CACHE, f"prts__events__{tid}.json")
    if os.path.exists(cache) and not refresh:
        return json.load(open(cache, encoding="utf-8"))
    page = urllib.parse.quote(f"{THEMES[tid]}/事件一览")
    url = f"https://prts.wiki/api.php?action=parse&page={page}&prop=wikitext&format=json"
    req = urllib.request.Request(url, headers=HEADERS)
    raw = urllib.request.urlopen(req, timeout=30).read()
    data = json.loads(raw)
    if "parse" not in data:
        raise SystemExit(f"{tid}: PRTS 응답 이상 — {str(data)[:200]}")
    open(cache, "wb").write(raw)
    return data


# ── wikitext 파서 — {{ISEvent/scene|…}} / {{ISEvent/choose|…}} 중괄호 균형 파싱 ──

def split_templates(text, name):
    out, i = [], 0
    needle = "{{" + name
    while True:
        i = text.find(needle, i)
        if i < 0:
            break
        depth, j = 0, i
        while j < len(text):
            if text[j:j + 2] == "{{":
                depth += 1
                j += 2
                continue
            if text[j:j + 2] == "}}":
                depth -= 1
                j += 2
                if depth == 0:
                    break
                continue
            j += 1
        out.append(text[i:j])
        i = j
    return out


def top_split(body):
    """템플릿 본문을 최상위 | 로 분해 (중첩 {{}}·[[]] 내부는 무시)."""
    parts, depth, cur, i = [], 0, "", 0
    while i < len(body):
        c2 = body[i:i + 2]
        if c2 in ("{{", "[["):
            depth += 1
            cur += c2
            i += 2
            continue
        if c2 in ("}}", "]]"):
            depth -= 1
            cur += c2
            i += 2
            continue
        if body[i] == "|" and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += body[i]
        i += 1
    parts.append(cur)
    return parts


def clean(s):
    s = re.sub(r"\{\{color\|[^|]*\|([^}]*)\}\}", r"\1", s)
    s = re.sub(r"\{\{mdi\|[^}]*\}\}", "", s)
    s = re.sub(r"\{\{[^}]*\}\}", "", s)          # 남은 템플릿 제거
    s = s.replace("<br/>", "\n").replace("<br>", "\n")
    return s.strip()


def is_named(p):
    """최상위 인자가 이름있는 인자(k=v)인지 — 값 앞부분에 = 가 나오면"""
    head = p.split("{{")[0][:20]
    return "=" in head and not p.startswith("{{")


def parse_topic(data):
    wt = data["parse"]["wikitext"]["*"]
    bounds = [(m.group(1), m.start()) for m in re.finditer(r"\|事件([0-9a-zA-Z_]+)=", wt)]
    events = []
    for k, (key, start) in enumerate(bounds):
        end = bounds[k + 1][1] if k + 1 < len(bounds) else len(wt)
        scenes = []
        for tpl in split_templates(wt[start:end], "ISEvent/scene"):
            parts = top_split(tpl[2:-2])[1:]
            named = {p.split("=", 1)[0].strip(): p.split("=", 1)[1] for p in parts if is_named(p)}
            pos = [p for p in parts if not is_named(p)]
            sc = {"name": clean(pos[0]) if pos else "",
                  "title": clean(pos[2]) if len(pos) > 2 else "",
                  "desc": clean(pos[3]) if len(pos) > 3 else "",
                  "choices": []}
            for ch in split_templates(named.get("选项", ""), "ISEvent/choose"):
                cb = top_split(ch[2:-2])[1:]
                cnamed = {p.split("=", 1)[0].strip(): p.split("=", 1)[1] for p in cb if is_named(p)}
                cpos = [p for p in cb if not is_named(p)]
                sc["choices"].append({
                    "kind": cpos[0].strip() if cpos else "",
                    "title": clean(cpos[1]) if len(cpos) > 1 else "",
                    "desc": clean(cnamed.get("desc1", "")),
                    "dest": int(cnamed["dest"]) if cnamed.get("dest", "").strip().isdigit() else None,
                })
            scenes.append(sc)
        if scenes:
            events.append({"key": key, "scenes": scenes})
    return events


# ── 게임 데이터 매칭 ─────────────────────────────────────────────────────────

def norm(s):
    """표기 차이 흡수 — 공백·문장부호·이모지 제거"""
    s = re.sub(r"[\s！？。，、·…“”\"'‘’（）()：:；;—\-~～!?\.]+", "", s or "")
    return re.sub(r"[\U0001F000-\U0001FAFF☀-➿️]", "", s)


# PRTS 편집자 라벨(【검정 성공】·【수집품 획득】류) — 게임 선택지가 아니라 랜덤 분기 라벨.
# 확률 표기: 【源石锭】20%概率
PROB_RE = re.compile(r"【([^】]+)】\s*(\d+(?:\.\d+)?)%概率")


def match_topic(tid, events, det):
    """PRTS 이벤트 → 게임 id 매칭. 반환: {enter_sid: {scenes:[…]}}, 통계"""
    enters = {sid: sc for sid, sc in det["choiceScenes"].items()
              if sid.endswith("_enter") and "startbuff" not in sid}
    by_title = {}
    for sid, sc in enters.items():
        by_title.setdefault(norm(sc["title"]), []).append(sid)
    all_scenes = det["choiceScenes"]
    all_choices = det["choices"]

    stats = {"events": len(events), "matched": 0, "ch_ok": 0, "ch_fuzzy": 0,
             "ch_branch": 0, "ch_fail": 0, "sc_ok": 0, "sc_fail": 0}
    out = {}
    for ev in events:
        title = next((s["title"] for s in ev["scenes"] if s["title"]), "")
        sids = by_title.get(norm(title), [])
        if not sids:
            continue
        stats["matched"] += 1
        enter = sids[0]
        # 그룹: scene_ro3_ent1_enter → 접두 ro3_ent1 (+변형 a/b) 의 씬·선택지 전부
        base = enter.replace("scene_", "").replace("_enter", "")
        grp_scene = {sid: sc for sid, sc in all_scenes.items()
                     if re.match(rf"scene_{re.escape(base)}[a-z]?(_|$)", sid)}
        grp_choice = {cid: c for cid, c in all_choices.items()
                      if re.match(rf"choice_{re.escape(base)}[a-z]?_\d+$", cid)}
        sc_by_desc = {}
        for sid, sc in grp_scene.items():
            sc_by_desc.setdefault(norm(sc.get("description") or ""), []).append(sid)
        ch_by_title = {}
        for cid, c in grp_choice.items():
            ch_by_title.setdefault(norm(c["title"]), []).append(cid)

        scenes_out = []
        for idx, s in enumerate(ev["scenes"]):
            # 씬 id: 첫 씬은 enter 확정, 나머지는 지문 텍스트로
            sid = None
            if idx == 0:
                sid = enter
                stats["sc_ok"] += 1
            elif s["desc"]:
                cand = sc_by_desc.get(norm(s["desc"]))
                if not cand:
                    close = difflib.get_close_matches(norm(s["desc"]), list(sc_by_desc), n=1, cutoff=0.8)
                    cand = sc_by_desc.get(close[0]) if close else None
                if cand:
                    sid = cand[0]
                    stats["sc_ok"] += 1
                else:
                    stats["sc_fail"] += 1
            node = {"sid": sid, "choices": []}
            if sid is None and s["desc"]:
                node["descCn"] = s["desc"]     # id 미해결 — CN 원문 폴백
            for c in s["choices"]:
                prob = PROB_RE.search((c["title"] or "") + " " + (c["desc"] or ""))
                bracket = re.fullmatch(r"【[^】]*】|.*概率.*", c["title"] or "")
                explicit_branch = c["kind"] == "desc" or bracket or (not c["title"] and prob)
                cids = None
                if not explicit_branch and c["title"]:
                    cids = ch_by_title.get(norm(c["title"]))
                    if cids:
                        stats["ch_ok"] += 1
                    else:
                        close = difflib.get_close_matches(norm(c["title"]), list(ch_by_title), n=1, cutoff=0.55)
                        if close:
                            cids = ch_by_title[close[0]]
                            stats["ch_fuzzy"] += 1
                if cids:
                    node["choices"].append({"cid": cids[0],
                                            **({"dest": c["dest"]} if c["dest"] is not None else {})})
                    continue
                # 게임 선택지에 없음 — dest가 있으면 랜덤 결과 분기 라벨(【검정 성공】·주화명·보상명),
                # PRTS 편집자가 롤 테이블을 선택지 모양으로 적은 것이다. dest 없으면 순수 주석 → 버림.
                if c["dest"] is not None:
                    label = prob.group(1) if prob else re.sub(r"[【】]", "", c["title"] or c["desc"] or "")
                    node["choices"].append({"branch": clean(label), "dest": c["dest"],
                                            **({"prob": float(prob.group(2))} if prob else {})})
                    stats["ch_branch"] += 1
                elif not explicit_branch and c["title"]:
                    stats["ch_fail"] += 1
            scenes_out.append(node)
        # 씬이 1개뿐이고 링크가 없으면 트리로서 무의미 — 평탄 렌더 유지
        if len(scenes_out) > 1:
            out[enter] = {"scenes": scenes_out}
    return out, stats


def main():
    refresh = "--refresh" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    cn = json.load(open(os.path.join(CACHE, "cn__excel__roguelike_topic_table.json"), encoding="utf-8"))["details"]
    result = {}
    for tid in THEMES:
        det = cn.get(tid)
        if det is None:
            print(f"{tid}: cn excel에 없음 — 건너뜀")
            continue
        events = parse_topic(fetch_events(tid, refresh))
        trees, st = match_topic(tid, events, det)
        result[tid] = trees
        print(f"{tid}: PRTS {st['events']}건 → 매칭 {st['matched']} · 트리 {len(trees)} · "
              f"선택지 정확 {st['ch_ok']} 퍼지 {st['ch_fuzzy']} 분기 {st['ch_branch']} 실패 {st['ch_fail']} · "
              f"씬 해결 {st['sc_ok']} 실패 {st['sc_fail']}")
    meta = {"_comment": "조우 씬 트리 — PRTS 事件一览을 게임 id에 매칭 (build-rogue-enc-scenes.py 재생성, 손대지 말 것). "
                        "sid/cid = 게임 데이터 id (로케일 텍스트는 build-rogue.py가 해석), dest = 이 조우 씬 배열 인덱스, "
                        "branch = PRTS 편집자 분기 라벨(랜덤 결과), prob = %확률. descCn/titleCn = id 미해결 CN 폴백."}
    json.dump({**meta, **result}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(len(v) for v in result.values())
    print(f"→ scripts/rogue-enc-scenes.json (트리 {total}건, {os.path.getsize(OUT)//1024}KB)")


if __name__ == "__main__":
    main()
