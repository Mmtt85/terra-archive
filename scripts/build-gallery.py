#!/usr/bin/env python3
"""갤러리(/gallery) 색인 — app/data/gallery{,.en,.ja}.json.

제안 게시판 요청 (2026-10-04 사용자 승인): "역대 CG나 오퍼들 스탠딩 혹은 정예 일러를 정리해서 볼 수 있는 항목".
그림은 **새로 받지 않는다** — 스토리 리더기용으로 이미 R2 에 올라가 있는 것을 묶어 색인만 만든다.

  · CG       public/story/cut/<이름>.webp — 대본(public/story/script/*.json) 에피소드 `vn`(장면 상태)의 `cut` 이 처음 나온 순서대로,
             메인 스토리(장) · 이벤트로 묶는다. [CG 이름, 에피소드 번호(1부터)] — 갤러리 창의 '스토리에서 보기' 가 쓴다.
  · 스탠딩   public/story/sprite/<인물>-<포즈>__<표정>.webp — 인물(<인물>)마다 파일 꼬리 목록.
             이름은 그 로케일 대본의 faces(화자 이름 → 인물)에서 가장 많이 쓴 것, 없으면 같은 번호의 오퍼 이름.
             둘 다 없는 인물(대사 없는 엑스트라)은 싣지 않는다 — 이름 없는 칸만 늘어난다.
  · 인물마다 `s` = 나오는 스토리(`refs` 순번 — CG 없는 스토리 포함) — 스탠딩 창 '등장 스토리' 버튼·하위 메뉴.
  · 일러스트 오퍼 목록(operators.json) + 오퍼별 스킨 문서(public/skins/<로케일>/<id>.json, R2)를 화면이 그때 받는다 —
             여기서는 싣지 않는다.

사용: python3 scripts/build-gallery.py   (스토리 대본 재생성 — build-story-scripts.py — 뒤에)
"""
import collections
import json
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "app", "data")
STORY = os.path.join(REPO, "public", "story")
LOCALES = [("ko", "", ""), ("en", ".en", "en"), ("ja", ".ja", "ja")]
load = lambda p: json.load(open(p, encoding="utf-8"))


def script_dir(sub):
    return os.path.join(STORY, "script", sub) if sub else os.path.join(STORY, "script")


cut_files = {f[:-5].lower(): f[:-5] for f in os.listdir(os.path.join(STORY, "cut")) if f.endswith(".webp")}
sprite_files = sorted(f[:-5] for f in os.listdir(os.path.join(STORY, "sprite")) if f.endswith(".webp"))
stories = load(os.path.join(DATA, "stories.json"))["events"]
chrono = load(os.path.join(DATA, "chronology.json"))
main_titles = {}


def _walk(node):
    if isinstance(node, dict):
        if node.get("kind") == "main" and str(node.get("id", "")).startswith("main_"):
            main_titles[node["id"]] = node.get("title") or {}
        for v in node.values():
            _walk(v)
    elif isinstance(node, list):
        for v in node:
            _walk(v)


_walk(chrono)


# 한섭에 열린 메인 스토리 장 — 그 밖(중섭 선행 main_17 …)은 미실장 표시
try:
    kr_main = {k for k in load(os.path.join(REPO, ".gamedata", "kr_story_review_table.json")) if k.startswith("main_")}
except (OSError, json.JSONDecodeError):
    kr_main = {f"main_{i}" for i in range(100)}


def exists(rel):
    return os.path.exists(os.path.join(REPO, "public", rel.lstrip("/")))


def line_caption(lines, at):
    """CG 한 줄 설명 — 그 CG 가 처음 뜨는 줄의 대사 그대로 (사용자 요청 2026-10-04 "그 이미지가 쓰인 스크립트 그대로").
    그 줄이 연출뿐이라 대사가 비면 바로 뒤 대사를 쓴다. '화자: 대사', 길면 90자에서 자른다."""
    for ln in lines[at:at + 15]:
        x = re.sub(r"\s+", " ", (ln.get("x") or "").strip())
        if not x:
            continue
        n = (ln.get("n") or "").strip()
        cap = f"{n}: {x}" if n else x
        return cap if len(cap) <= 90 else cap[:89] + "…"
    return ""


def cuts_of(script):
    out, seen = [], set()
    for i, ep in enumerate(script.get("eps") or [], 1):
        lines = ep.get("lines") or []
        for ln in ep.get("vn") or []:          # 장면 상태(배경·스탠딩·컷)는 줄이 아니라 vn 목록에 있다
            c = ln.get("cut")
            if not c:
                continue
            real = cut_files.get(c.lower())
            if real and real not in seen:
                seen.add(real)
                at = ln.get("i", 0)
                # [CG, 화(1부터), 그 화에서 처음 뜨는 줄(0부터) — 리더기 시작 줄, 그 줄의 대사 한 줄]
                out.append([real, i, at, line_caption(lines, at)])
    return out


# 스탠딩 — 인물 id → 파일 꼬리
by_char = collections.defaultdict(list)
for f in sprite_files:
    base = f.split("__")[0]
    cid = base.split("-")[0]
    by_char[cid].append(f[len(cid):])


def natural(s):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]


ops = {loc: {o["id"]: o for o in load(os.path.join(DATA, f"operators{suf}.json"))} for loc, suf, _ in LOCALES}


def op_of(cid):
    """인물 id → 오퍼 id (avg_003_kalts_1 · avgnew_482_pallas_1 · char_155_tiger_1 → char_003_kalts …)."""
    m = re.match(r"(?:avg|avgnew|char)_(\d+[a-z]*)_([a-z0-9]+)", cid)
    if not m:
        return None
    key = f"char_{m.group(1)}_{m.group(2)}"
    if key in ops["ko"]:
        return key
    pre = f"char_{m.group(1)}_"
    hits = [k for k in ops["ko"] if k.startswith(pre)]
    return hits[0] if len(hits) == 1 else None


# ── 엑스트라 번호(avg_npc_…)로 그려진 오퍼 스탠딩 (사용자 지적 2026-10-04 "가난한 소녀는 폰사이러스인데 오퍼도감 버튼이 없네")
# 스토리는 오퍼를 신분을 숨긴 모습·어린 시절·변장으로 그릴 때 엑스트라 그림을 쓴다. 이으는 규칙 (정확한 것만):
#   ① 표시 이름(대본 화자 이름)이 오퍼 이름 그대로 — '에이야퍄들라'
#   ② 모든 한국어 스토리 원문(밀록 포함 — .gamedata/story-cache)에서 그 그림이 가장 많이 쓴 이름이 오퍼 이름이고,
#      5줄 이상 · 그 그림 대사의 50% 이상 — 여러 인물이 함께 선 장면은 대사가 엉뚱한 그림에 붙어 기준을 둔다
#      (40% 로 두면 '조심스러운 라테라노 사람들'→파인콘 같은 오탐이 끼었다)
#   ③ 본명 별칭표 — 원문에 본명으로만 나오는 오퍼 (확인된 것만 적는다)
#   ⚠ '밀록 주인 = 그 밀록에서 가장 많이 말하는 엑스트라'는 쓰지 않는다 — 실측 29건 중 다수가 밀록 속 다른 인물이었다.
OP_ALIAS = {"앤 마이어": "char_488_buildr"}   # 폰사이러스 밀록 (story_buildr) — 어린 시절 '가난한 소녀'
STORY_CACHE = os.path.join(REPO, ".gamedata", "story-cache")
cache_names = collections.defaultdict(collections.Counter)
if os.path.isdir(STORY_CACHE):
    for f in os.listdir(STORY_CACHE):
        if re.match(r"(cn|en|jp|ja|kr)__", f):
            continue
        cur = None
        for line in open(os.path.join(STORY_CACHE, f), encoding="utf-8", errors="ignore"):
            mm = re.search(r'\[(?:charslot|Character)\([^)]*?name="([^"#$]+)', line, re.I)
            if mm:
                cur = mm.group(1).split("-")[0]
            m2 = re.match(r'\[name="([^"]+)"\]', line)
            if m2 and cur:
                cache_names[cur][m2.group(1).strip()] += 1
# 무인 CI 엔 원문 캐시가 없다 — 직전 산출물의 연결을 그대로 쓴다 (안 그러면 매일 연결이 사라졌다 생겼다 한다)
prev_links = {}
if not cache_names and os.path.exists(os.path.join(DATA, "gallery.json")):
    prev_links = {c["id"]: c["op"] for c in load(os.path.join(DATA, "gallery.json")).get("chars", []) if c.get("op")}
ko_op_by_name = {}
for o in ops["ko"].values():
    ko_op_by_name.setdefault(o["name"], o["id"])


def npc_op(cid, shown_ko):
    if cid in prev_links:
        return prev_links[cid]
    if shown_ko in ko_op_by_name:
        return ko_op_by_name[shown_ko]
    cn = cache_names.get(cid)
    if not cn:
        return None
    top, n = cn.most_common(1)[0]
    if top in OP_ALIAS:
        return OP_ALIAS[top]
    if top in ko_op_by_name and n >= 5 and n / sum(cn.values()) >= 0.5:
        return ko_op_by_name[top]
    return None


ko_names = collections.defaultdict(collections.Counter)
for _f in os.listdir(script_dir("")):
    if _f.endswith(".json"):
        for _n, _c in (load(os.path.join(script_dir(""), _f)).get("faces") or {}).items():
            if _n and _c:
                ko_names[_c.split("-")[0]][_n.strip()] += 1

for loc, suf, sub in LOCALES:
    d = script_dir(sub)
    scripts = {f[:-5]: load(os.path.join(d, f)) for f in os.listdir(d) if f.endswith(".json")}
    names = collections.defaultdict(collections.Counter)
    seen_in = collections.defaultdict(set)     # 인물 → 나오는 스토리 id (스탠딩 '그 외 인물 → 등장 스토리' 하위 메뉴)
    for sid, sc in scripts.items():
        for n, c in (sc.get("faces") or {}).items():
            if n and c:
                names[c.split("-")[0]][n.strip()] += 1
                seen_in[c.split("-")[0]].add(sid)
        # 무대에 실제로 올라간 스탠딩(에피소드 vn 의 ch)도 센다 — 화자 이름표(faces)만으로는 대사 이름 없이 오퍼 이름으로
        # 붙은 인물·말없이 서 있던 인물의 등장 스토리가 빠졌다 (사용자 지적 2026-10-04 "오퍼레이터라도 나오는 이벤트가 있을테니")
        for ep in sc.get("eps") or []:
            for v in ep.get("vn") or []:
                for c in v.get("ch") or []:
                    if c and c[0] and c[0] != "char_empty":
                        seen_in[str(c[0]).split("-")[0]].add(sid)

    def ev_row(eid, name):
        sc = scripts.get(eid)
        if not sc:
            return None
        cuts = cuts_of(sc)
        return {"id": eid, "n": name, "cuts": cuts} if cuts else None

    main = []
    for k in sorted((k for k in scripts if re.fullmatch(r"main_\d+", k)), key=lambda x: int(x.split("_")[1])):
        t = main_titles.get(k) or {}
        num = int(k.split("_")[1])
        label = {"ko": f"{num}장", "en": f"Episode {num:02d}", "ja": f"第{num}章"}[loc]
        r = ev_row(k, f"{label} {t.get(loc) or t.get('ko') or ''}".strip())
        if r:
            if k not in kr_main:
                r["fut"] = 1
            main.append(r)
    events = []
    for st in stories:
        r = ev_row(st["id"], (st.get("name") or {}).get(loc) or (st.get("name") or {}).get("ko") or st["id"])
        if r:
            if st.get("unreleased"):
                r["fut"] = 1          # 중섭 선행 — 화면이 흑백(.fut-dim)으로, 미래시를 켜야 열린다
            events.append(r)

    # 등장 스토리 목록 — CG 가 없는 스토리도 들어간다 (메인 장 순 → 스토리 목록 순). 인물의 `s` 는 이 목록의 번호
    refs = []
    for k in sorted((k for k in scripts if re.fullmatch(r"main_\d+", k)), key=lambda x: int(x.split("_")[1])):
        t = main_titles.get(k) or {}
        num = int(k.split("_")[1])
        label = {"ko": f"{num}장", "en": f"Episode {num:02d}", "ja": f"第{num}章"}[loc]
        refs.append([k, f"{label} {t.get(loc) or t.get('ko') or ''}".strip()])
    for st in stories:
        if st["id"] in scripts:
            refs.append([st["id"], (st.get("name") or {}).get(loc) or (st.get("name") or {}).get("ko") or st["id"]])
    story_ids = [r[0] for r in refs]
    chars = []
    for cid, tails in by_char.items():
        shown_ko = ko_names[cid].most_common(1)[0][0] if ko_names.get(cid) else ""
        oid = op_of(cid) or npc_op(cid, shown_ko)
        nm = names[cid].most_common(1)[0][0] if names.get(cid) else None
        if oid and (not nm or loc != "ko"):
            nm = ops[loc].get(oid, {}).get("name") or nm
        if not nm:
            continue
        row = {"id": cid, "n": nm, "f": sorted(tails, key=natural)}
        ins = [i for i, sid in enumerate(story_ids) if sid in seen_in.get(cid, ())]
        if ins:
            row["s"] = ins            # main + events 를 이은 목록의 번호
        if oid:
            row["op"] = oid
        chars.append(row)
    chars.sort(key=lambda r: (r["n"], r["id"]))

    # 통합전략 — 테마마다 키비주얼 · 조우 CG · 층 배경 · 음반 (사용자 요청 2026-10-04 "통합전략 생존연산 일러도")
    rogue = []
    for n in range(1, 10):
        path = os.path.join(DATA, f"rogue{n}{suf}.json")
        if not os.path.exists(path):
            path = os.path.join(DATA, f"rogue{n}.json")
            if not os.path.exists(path):
                continue
        rd = load(path)
        secs = []
        if exists(f"/rogue/kv{n}.webp"):
            secs.append({"k": "kv", "pics": [[f"/rogue/kv{n}.webp", ""]]})
        seen, pics = set(), []
        for e in rd.get("encounters") or []:
            bg = e.get("bg")
            if bg and bg not in seen and exists(f"/rogue/scene/{bg}.webp"):
                seen.add(bg)
                pics.append([f"/rogue/scene/{bg}.webp", e.get("title") or ""])
        if pics:
            secs.append({"k": "scene", "pics": pics})
        seen, pics = set(), []
        for z in rd.get("zones") or []:
            if not z.get("img"):
                continue
            stem = z.get("bg") or "%s_map_%s" % (rd["id"], z.get("num"))
            pth = f"/rogue/zone/{stem}.webp"
            if pth not in seen and exists(pth):
                seen.add(pth)
                pics.append([pth, z.get("name") or ""])
        if pics:
            secs.append({"k": "zone", "pics": pics})
        pics = [[f"/rogue/capsule/{c['id']}.webp", c.get("name") or ""] for c in rd.get("capsules") or []
                if c.get("img") and exists(f"/rogue/capsule/{c['id']}.webp")]
        if pics:
            secs.append({"k": "capsule", "pics": pics})
        if secs:
            row = {"id": rd["id"], "n": rd.get("name") or rd["id"], "link": f"/rogue/is{n}", "secs": secs}
            if n == 6:
                row["fut"] = 1        # 침몰자의 블랙플로우 — 중섭 선행 (rogue-guide 스킬)
            rogue.append(row)

    # 생존연산 — 받아 둔 그림이 월드맵·보스·NPC·지역 그림뿐이다 (이벤트 CG 는 받지 않았다)
    sbd = load(os.path.join(DATA, f"sandbox{suf}.json")) if os.path.exists(os.path.join(DATA, f"sandbox{suf}.json")) else load(os.path.join(DATA, "sandbox.json"))
    sandbox = []
    misc = sorted(os.listdir(os.path.join(REPO, "public", "sandbox", "misc")))
    misc2 = sorted(os.listdir(os.path.join(REPO, "public", "sandbox", "misc2")))
    v2 = [{"k": "world", "pics": [["/sandbox/world/sandbox_1.webp", ""]]}] if exists("/sandbox/world/sandbox_1.webp") else []
    boss = [[f"/sandbox/misc/{f}", ""] for f in misc if f.startswith("img_enemy_")]
    npc = [[f"/sandbox/misc/{f}", ""] for f in misc if f.startswith("img_npc_")]
    if boss:
        v2.append({"k": "boss", "pics": boss})
    if npc:
        v2.append({"k": "npc", "pics": npc})
    if v2:
        sandbox.append({"id": "sandbox_v2", "n": (sbd.get("v2") or {}).get("name") or "Sandbox", "link": "/ra", "secs": v2})
    v3 = []
    zone = [[f"/sandbox/misc2/{f}", ""] for f in misc2 if f.startswith("img_z_")]
    npc3 = [[f"/sandbox/misc2/{f}", ""] for f in misc2 if f.startswith("img_npc_")]
    if zone:
        v3.append({"k": "zone", "pics": zone})
    if npc3:
        v3.append({"k": "npc", "pics": npc3})
    if v3:
        sandbox.append({"id": "sandbox_v3", "n": (sbd.get("v3") or {}).get("name") or "Sandbox", "link": "/ra/anchor",
                        "fut": 1, "secs": v3})

    doc = {"main": main, "events": events, "rogue": rogue, "sandbox": sandbox, "refs": refs, "chars": chars}
    p = os.path.join(DATA, f"gallery{suf}.json")
    json.dump(doc, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    n_cut = sum(len(r["cuts"]) for r in main + events) + sum(len(sec["pics"]) for g in rogue + sandbox for sec in g["secs"])
    print(f"  gallery{suf}.json: CG {n_cut}장(메인 {len(main)}장·이벤트 {len(events)}개) · 스탠딩 {len(chars)}명 "
          f"{sum(len(r['f']) for r in chars)}장 — {os.path.getsize(p) // 1024}KB")
