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
    # 이미지 링크는 통째로 제거 — 안 하면 [[文件:…|x40px|link=]]의 잔해("x40px|link=")가 샌다
    s = re.sub(r"\[\[(?:文件|档案|[Ff]ile|[Ii]mage)[^\]]*\]\]", "", s)
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s)   # [[페이지|라벨]] → 라벨
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)            # [[페이지]] → 페이지
    s = re.sub(r"'{2,}", "", s)                  # 위키 볼드·이탤릭('' ''') 제거
    s = s.replace("<br/>", "\n").replace("<br>", "\n").replace("<hr>", "")
    s = re.sub(r"</?(?:small|big|span|div|b|i|u|s)(?:\s[^>]*)?>", "", s)   # 장식 태그 잔해
    return s.strip()


# 전투 스테이지 링크 — PRTS choose 텍스트의 [[<코드> <CN 작전명>|…]] 위키링크.
# 조우→전투 대응이 게임 데이터에 없는데 PRTS가 여기 박아 뒀다 (2026-08-16 발견).
LINK_RE = re.compile(r"\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")


def extract_links(*raws):
    out = []
    for raw in raws:
        for m in LINK_RE.findall(raw or ""):
            t = m.strip()
            if t and t not in out:
                out.append(t)
    return out


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
                cdesc = clean(cnamed.get("desc1", ""))
                # 확정 소장품 보상의 CN 이름 — 获得收藏品「이름」 패턴. 랜덤(一件随机/1个)은 제외.
                relic_cn = None
                m = re.search(r"收藏品[『「\"“]?([^”」』\"，,。;；()（）%]{1,24})", cdesc)
                if m:
                    nm2 = m.group(1).strip().strip("“”\"'‘’")
                    if nm2 and not re.match(r"^(一件|随机|\d|１|获得|奖励)", nm2):
                        relic_cn = nm2
                # desc2 = 보충 설명 (선택지 등장 조건·必定为一件稀有收藏品류 — 같은 제목의
                # 병렬 선택지를 구분해 주는 정보. 사라진 풍습 린수 제보, 2026-08-16).
                # 원문 선두의 ※는 떼어 둔다 — 표시할 때 ※를 붙이므로 중복되지 않게.
                cnote = clean(cnamed.get("desc2", "")).lstrip("※").strip()
                sc["choices"].append({
                    "kind": cpos[0].strip() if cpos else "",
                    "title": clean(cpos[1]) if len(cpos) > 1 else "",
                    "desc": cdesc,
                    "dest": int(cnamed["dest"]) if cnamed.get("dest", "").strip().isdigit() else None,
                    "links": extract_links(cpos[1] if len(cpos) > 1 else "", cnamed.get("desc1", "")),
                    **({"relicCn": relic_cn} if relic_cn else {}),
                    **({"note": cnote} if cnote else {}),
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
             "ch_branch": 0, "ch_note": 0, "ch_fail": 0, "sc_ok": 0, "sc_fail": 0, "battles": 0}
    # CN 작전명 → 스테이지 id (동명 변형 _b/_c 전부 — 결투 원거리/근거리판 등)
    stage_by_name = {}
    for sid, st in det["stages"].items():
        if st.get("name"):
            stage_by_name.setdefault(norm(st["name"]), []).append(sid)
    out = {}
    for ev in events:
        title = next((s["title"] for s in ev["scenes"] if s["title"]), "")
        sids = by_title.get(norm(title), [])
        if not sids:
            continue
        stats["matched"] += 1
        # 동명 enter가 여럿이면(변형 씬 res3a 등 — 사이트는 동명을 하나로 병합해 대표 씬 id가
        # 어느 쪽이 될지 모른다) 그룹·출력을 전부에 걸친다 (검은 발자국 회귀, 2026-08-16)
        enter = sids[0]
        bases = [x.replace("scene_", "").replace("_enter", "") for x in sids]
        base_re = "|".join(re.escape(b) for b in bases)
        grp_scene = {sid: sc for sid, sc in all_scenes.items()
                     if re.match(rf"scene_(?:{base_re})[a-z]?(_|$)", sid)}
        grp_choice = {cid: c for cid, c in all_choices.items()
                      if re.match(rf"choice_(?:{base_re})[a-z]?_\d+$", cid)}
        sc_by_desc = {}
        for sid, sc in grp_scene.items():
            sc_by_desc.setdefault(norm(sc.get("description") or ""), []).append(sid)
        ch_by_title = {}
        for cid, c in grp_choice.items():
            ch_by_title.setdefault(norm(c["title"]), []).append(cid)
        # 동명 선택지 구분 신호 — 게임 desc(리치태그 제거)와 보상 소장품명(displayData.itemId)
        items_cn = det.get("items") or {}
        ch_sig = {}
        for cid, c in grp_choice.items():
            iid = (c.get("displayData") or {}).get("itemId")
            ch_sig[cid] = (norm(re.sub(r"<[^>]*>", "", c.get("description") or "")),
                           norm((items_cn.get(iid) or {}).get("name") or "") if iid else "")

        # 이 조우에서 링크된 전투 스테이지 — [[<코드> <CN명>|…]] 의 CN명을 스테이지에 매칭.
        # 페이지명 앞의 코드 토큰(ISW-NO 등)은 떼고 대조한다.
        ev_battles = []
        for s in ev["scenes"]:
            for c in s["choices"]:
                for ln in c.get("links") or []:
                    name = re.sub(r"^[A-Za-z0-9-]+[\s_]+", "", ln)
                    for sid2 in stage_by_name.get(norm(name), []):
                        # 층 일반/긴급(roN_n_F·roN_e_F) 링크는 '그 층의 랜덤 전투'라는 뜻
                        # (힘든 전투 직면 등) — 고정 맵이 아니므로 제외한다.
                        if re.match(r"ro\d+_[ne]_\d", sid2):
                            continue
                        # 특수전 긴급판(roN_e_t_*)은 본판 모달의 일반/긴급 탭으로 접근 — 중복 제외
                        if re.match(r"ro\d+_e_t_", sid2):
                            continue
                        if sid2 not in ev_battles:
                            ev_battles.append(sid2)
        stats["battles"] += len(ev_battles)

        scenes_out = []
        used = set()   # 이 조우에서 이미 배선한 cid — 동명 병렬 선택지의 중복 배선 방지
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
                    cid = cids[0]
                    if len(cids) > 1:
                        # 동명 선택지 여럿 — 무조건 첫 후보로 붙이면 오배선된다 (곱사등이 괴인
                        # 4갈래가 전부 '그림자' 소장품으로 나오던 회귀, 사용자 제보 2026-08-16).
                        # PRTS의 소장품명(relicCn)·설명(desc1)을 게임 쪽 보상 아이템명·desc와
                        # 대조해 최적 후보를 고르고, 동점(게임 텍스트까지 동일한 병렬 선택지 —
                        # 사라진 풍습 린수)은 아직 안 쓴 후보를 순서대로 소비해 중복을 막는다.
                        want_r = norm(c.get("relicCn") or "")
                        want_d = norm(c.get("desc") or "")
                        def amb_score(k):
                            d_n, r_n = ch_sig[k]
                            sc2 = 0.0
                            if want_r and r_n:
                                sc2 += 2 * difflib.SequenceMatcher(None, want_r, r_n).ratio()
                            if want_d and d_n:
                                sc2 += difflib.SequenceMatcher(None, want_d, d_n).ratio()
                            return sc2
                        cid = max(cids, key=lambda k: (amb_score(k), k not in used, -cids.index(k)))
                    used.add(cid)
                    node["choices"].append({"cid": cid,
                                            **({"relicCn": c["relicCn"]} if c.get("relicCn") else {}),
                                            **({"noteCn": c["note"]} if c.get("note") else {}),
                                            **({"dest": c["dest"]} if c["dest"] is not None else {})})
                    continue
                # 게임 선택지에 없음 — dest가 있으면 랜덤 결과 분기 라벨(【검정 성공】·주화명·보상명),
                # PRTS 편집자가 롤 테이블을 선택지 모양으로 적은 것이다.
                if c["dest"] is not None:
                    label = prob.group(1) if prob else re.sub(r"[【】]", "", c["title"] or c["desc"] or "")
                    node["choices"].append({"branch": clean(label), "dest": c["dest"],
                                            **({"prob": float(prob.group(2))} if prob else {})})
                    stats["ch_branch"] += 1
                elif explicit_branch and (c["desc"] or c["title"]):
                    # dest 없는 안내 블록 — 예전엔 버렸지만 랜덤 출현 규칙(以下选项随机出现N个)·
                    # 주사위 판정 룰·조건 안내·확률별 결과 서사가 여기 실려 있다 (사라진 풍습
                    # "소장품은 뭔데" 제보의 답이 이 블록에 있었음, 2026-08-16). 노트로 보존.
                    txt = c["title"] or c["desc"]
                    if txt:
                        node["choices"].append({"noteCn": txt})
                        stats["ch_note"] += 1
                elif c["title"]:
                    stats["ch_fail"] += 1
            scenes_out.append(node)
        # 씬이 1개뿐이고 링크가 없으면 트리로서 무의미 — 평탄 렌더 유지.
        # 전투 링크는 트리 유무와 무관하게 남긴다 (encounterBattles 자동 보강용).
        entry = {}
        if len(scenes_out) > 1:
            entry["scenes"] = scenes_out
        if ev_battles:
            entry["battles"] = ev_battles
        elif any(c.get("icon") == "battle" or (c.get("displayData") or {}).get("funcIconId") == "battle"
                 for c in grp_choice.values()):
            # 전투 선택지(icon=battle)가 있는데 고정 맵 링크가 없다 = 그 층의 랜덤 일반
            # 전투 ('힘든 전투 직면' 류 — PRTS도 층 일반 맵 전체를 가리킴). UI가 '랜덤
            # 전투' 안내를 달 근거 (사용자 지시 2026-08-16). 수작업 링크가 있으면
            # build-rogue가 이 플래그를 무시한다.
            entry["randomBattle"] = True
        if entry:
            for sid_k in sids:
                out[sid_k] = entry
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
              f"선택지 정확 {st['ch_ok']} 퍼지 {st['ch_fuzzy']} 분기 {st['ch_branch']} 노트 {st['ch_note']} "
              f"실패 {st['ch_fail']} · 씬 해결 {st['sc_ok']} 실패 {st['sc_fail']}")
    meta = {"_comment": "조우 씬 트리 — PRTS 事件一览을 게임 id에 매칭 (build-rogue-enc-scenes.py 재생성, 손대지 말 것). "
                        "sid/cid = 게임 데이터 id (로케일 텍스트는 build-rogue.py가 해석), dest = 이 조우 씬 배열 인덱스, "
                        "branch = PRTS 편집자 분기 라벨(랜덤 결과), prob = %확률, noteCn = 안내 블록(랜덤 출현 규칙·"
                        "주사위 판정·조건, 선택지에 붙으면 desc2 보충 설명). descCn/titleCn = id 미해결 CN 폴백. "
                        "battles = PRTS 위키링크([[코드 작전명|…]])에서 추출한 이 조우의 전투 스테이지 — "
                        "rogueN-curated.json encounterBattles(수작업)가 우선하고 없는 조우만 이걸로 보강한다."}
    json.dump({**meta, **result}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    total = sum(len(v) for v in result.values())
    print(f"→ scripts/rogue-enc-scenes.json (트리 {total}건, {os.path.getsize(OUT)//1024}KB)")


if __name__ == "__main__":
    main()
