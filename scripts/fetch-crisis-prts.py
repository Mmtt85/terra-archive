#!/usr/bin/env python3
"""위기 협약(危机合约) 시즌별 맵 목록·계약/지표 — PRTS 위키에서 모은다.

왜 이 스크립트가 있나 (2026-10-17):
게임 데이터(crisis_table·crisis_v2_table)는 **지금 열린 시즌의 계약만** 내려 준다 — 지난 시즌의
계약(합약)·지표(指标)·로테이션 맵 일정은 게임 파일 어디에도 남지 않는다. PRTS 위키가 그걸 시즌마다
표로 정리해 두었으므로, 그 위키텍스트를 받아 구조화한다.

문서 구조
- 시즌 2(作战赛季): `危机合约/<시즌>/指标详情` — 맵마다 표(머리 `! colspan=N | <맵 이름>`),
  행 = [所属指标集 (额外分数)] · [[文件:<지표 id>.png]] · 이름 · 描述 · 维度 · 分数.
  맵 목록은 `关卡一览/活动关卡` 의 `==<시즌>==` 절(主测试地/轮换测试地), 로테이션 개방일은 시즌 문서의
  `{{危机合约轮换测试地任务|地名=…|开放=…（11/25）…|失效=…（11/28）失效}}`.
- 시즌 1(经典赛季): `危机合约/<시즌>/合约详情` 의 `===[[<지역 지점>]]===` 이 맵 목록(常驻/轮换).
  계약은 `<지역 지점>/历史合约` 문서 — 常驻는 `<section begin=常驻行动地点 />` 표(열 = 같은 칸의 1~3 등급),
  轮换은 `===<시즌>===` 아래 `====<날짜>====` 마다 표(支援合约 1개 + 任选合约).
  계약 칸은 `{{危机合约词条|<id>|<이름>|<등급 0~3>|<설명>|…}}` (0 = 지원 계약).
- 맵 → 레벨: 맵 문서 `{{普通关卡信息|关卡id=…}}`. 그 id 가 CDN 매니페스트에 없으면(尖灭测试作战 맵을
  시즌 2 #1 이 재사용한 act38rune_* 등) 시즌 2 레벨들과 적 구성·맵 크기를 대조해 고른다.

사용:
  python3 scripts/fetch-crisis-prts.py            # 캐시(.gamedata/prts-crisis/) 사용, 없는 문서만 받음
  python3 scripts/fetch-crisis-prts.py --refresh  # 전부 다시 받음
  python3 scripts/fetch-crisis-prts.py --no-levels  # CDN 레벨 대조 생략 (PRTS 관卡id 그대로)

⚠ PRTS 요청에는 User-Agent + Accept-Language 헤더가 필수 (없으면 WAF 403). `/w/` 렌더는 느려서 안 쓴다.
출력: scripts/crisis-prts.json
"""
import datetime
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(REPO, ".gamedata", "prts-crisis")
OUT = os.path.join(REPO, "scripts", "crisis-prts.json")
sys.path.insert(0, os.path.join(REPO, "scripts"))

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "ko,en;q=0.9",   # ⚠ 빼면 PRTS WAF가 403을 낸다 (실측)
}

# 시즌 1(经典) #1~#12 · 시즌 2(作战) #1~#5. #0 荒芜行动·2019 은 사이트에 없어 뺀다.
V1 = ["黄铁行动", "利刃行动", "燃灰行动", "铅封行动", "光谱行动", "蛮鳞行动",
      "松烟行动", "寻昼行动", "渊默行动", "尘环行动", "赝波行动", "起源行动"]
V2 = ["浊燃作战", "潮曦作战", "净罪作战", "弧光作战", "涤墨作战"]

REFRESH = "--refresh" in sys.argv
NO_LEVELS = "--no-levels" in sys.argv
FETCHED = []


# ── PRTS ──────────────────────────────────────────────────────────────
def get(page):
    fn = os.path.join(CACHE, page.replace("/", "__") + ".txt")
    if os.path.exists(fn) and not REFRESH:
        FETCHED.append(page)
        return open(fn, encoding="utf-8").read()
    url = ("https://prts.wiki/api.php?action=parse&page=" + urllib.parse.quote(page)
           + "&prop=wikitext&format=json&redirects=1")
    for i in range(5):
        time.sleep(0.5)
        try:
            raw = urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=90).read()
            d = json.loads(raw)
            break
        except Exception as e:  # PRTS 는 가끔 TLS 핸드셰이크·읽기에서 멈춘다 — 몇 번 다시
            print(f"  … 재시도 {i + 1} {page}: {e}", file=sys.stderr)
            time.sleep(3)
    else:
        sys.exit(f"✗ PRTS 문서를 못 받았다: {page}")
    w = d["parse"]["wikitext"]["*"] if "parse" in d else ""
    if not w:
        print(f"  ⚠ 빈 문서: {page}", file=sys.stderr)
    os.makedirs(CACHE, exist_ok=True)
    with open(fn, "w", encoding="utf-8") as f:
        f.write(w)
    FETCHED.append(page)
    print(f"  ↓ {page} ({len(w)})", file=sys.stderr)
    return w


# ── 위키텍스트 도구 ───────────────────────────────────────────────────
def templates(text, name):
    """{{name|…}} 을 중첩 괄호를 지켜 찾아 (시작, 끝, [인자…]) 로. 인자는 최상위 '|' 로 나눈다."""
    out = []
    key = "{{" + name
    i = 0
    while True:
        i = text.find(key, i)
        if i < 0:
            return out
        j = i + len(key)
        if j < len(text) and text[j] not in "|}\n ":
            i = j
            continue
        depth, k, args, cur = 0, i, [], ""
        k = i + 2
        depth = 1
        buf = []
        sq = 0
        while k < len(text) and depth:
            if text.startswith("{{", k):
                depth += 1; buf.append("{{"); k += 2; continue
            if text.startswith("}}", k):
                depth -= 1
                if depth:
                    buf.append("}}")
                k += 2; continue
            if text.startswith("[[", k):
                sq += 1; buf.append("[["); k += 2; continue
            if text.startswith("]]", k):
                sq -= 1; buf.append("]]"); k += 2; continue
            c = text[k]
            if c == "|" and depth == 1 and sq == 0:
                args.append("".join(buf)); buf = []
            else:
                buf.append(c)
            k += 1
        args.append("".join(buf))
        out.append((i, k, [a for a in args[1:]]))
        i = k


def _tpl_text(m):
    name = m.group(1).strip()
    parts = [p for p in m.group(2).split("|")] if m.group(2) is not None else []
    pos = [p for p in parts if not re.match(r"^\s*[\w一-鿿]+\s*=", p)]
    low = name.lower()
    if low in ("color", "颜色"):
        return pos[1] if len(pos) > 1 else ""
    if low in ("修正",):
        return pos[0] if pos else ""
    if low in ("术语",):
        return pos[1] if len(pos) > 1 else (pos[0] if pos else "")
    if low in ("popup", "fa", "mdi", "ruby"):
        return "" if low != "ruby" else (pos[0] if pos else "")
    return pos[-1] if pos else ""


def clean(s):
    """위키 마크업·게임 서식 태그를 벗긴다. <枯朽之种> 같은 적·기믹 꺾쇠 이름은 남긴다."""
    if s is None:
        return None
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    for _ in range(4):   # 안쪽 틀부터
        s2 = re.sub(r"\{\{([^{}|]+)(?:\|([^{}]*))?\}\}", _tpl_text, s)
        if s2 == s:
            break
        s = s2
    s = re.sub(r"\[\[(?:文件|file|File):[^\]]*\]\]", "", s)
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"'''?", "", s)
    s = re.sub(r"<[@$][^>]*>", "", s)          # 게임 서식 <@ba.vup> <$ba.xx>
    s = s.replace("</>", "")
    s = re.sub(r"</?[A-Za-z][A-Za-z0-9]*(?:\s[^<>]*)?/?>", "", s)   # HTML 태그 (span·div·small …)
    s = s.replace("&nbsp;", " ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{2,}", "\n", s)
    return s.strip()


def section(text, begin):
    """<section begin=X /> … <section end=X /> 안쪽."""
    m = re.search(r"<section begin=" + re.escape(begin) + r"\s*/>(.*?)<section end=" + re.escape(begin) + r"\s*/>",
                  text, re.S)
    return m.group(1) if m else None


def heading_block(text, title, level):
    """==…== 머리 `title` 아래부터 같은/더 높은 단계 머리 전까지."""
    eq = "=" * level
    m = re.search(r"^" + eq + r"\s*\[?\[?" + re.escape(title) + r"\]?\]?\s*" + eq + r"\s*$", text, re.M)
    if not m:
        return None
    rest = text[m.end():]
    n = re.search(r"^={1," + str(level) + r"}[^=].*?={1," + str(level) + r"}\s*$", rest, re.M)
    return rest[: n.start()] if n else rest


def table_rows(tbl):
    """표 위키텍스트 → [[셀 원문…]…] (머리 행 '!' 제외)."""
    rows, cur = [], None
    for line in tbl.split("\n"):
        st = line.strip()
        if st.startswith("{|") or st.startswith("|}"):
            if cur:
                rows.append(cur)
            cur = None
            continue
        if st.startswith("|-"):
            if cur:
                rows.append(cur)
            cur = []
            continue
        if cur is None:
            continue
        if st.startswith("!"):
            cur = None
            continue
        if st.startswith("|"):
            for c in re.split(r"\|\|", st[1:]):
                cur.append(c)
        elif cur:
            cur[-1] += "\n" + line
    if cur:
        rows.append(cur)
    return rows


def cell_body(c):
    """`style=… | 본문` 의 본문 (속성부가 있으면 떼어 낸다). 틀·링크 안의 '|' 는 건드리지 않는다."""
    depth = sq = 0
    i = 0
    while i < len(c):
        if c.startswith("{{", i): depth += 1; i += 2; continue
        if c.startswith("}}", i): depth -= 1; i += 2; continue
        if c.startswith("[[", i): sq += 1; i += 2; continue
        if c.startswith("]]", i): sq -= 1; i += 2; continue
        if c[i] == "|" and depth == 0 and sq == 0:
            return c[i + 1:]
        i += 1
    return c


def rid(x):
    """파일 이름 → 게임 id (위키 파일명은 첫 글자 대문자·'_' 대신 공백일 때가 있다)."""
    return re.sub(r"[\s_]+", "_", (x or "").strip()).lower() or None


def ymd(y, mo, d):
    return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"


def season_info(w):
    def f(k):
        m = re.search(r"\|" + k + r"=([^\n|]*)", w)
        return m.group(1).strip() if m else None
    return {"title": f("名称"), "subtitle": f("副标题"),
            "start": (f("活动开始时间") or "")[:10] or None, "end": (f("活动结束时间") or "")[:10] or None}


def map_level_id(name):
    w = get(name)
    m = re.search(r"\|关卡id=\s*([^\s|]+)", w)
    size = re.search(r"\|地图大小=\s*(\d+)\s*[×x]\s*(\d+)", w)
    enemies = [clean(e) for e in re.findall(r"\|敌人\d+=([^\n|]+)", w)]
    return {"id": m.group(1) if m else None,
            "size": (int(size.group(1)), int(size.group(2))) if size else None,   # 가로×세로
            "enemies": [e for e in enemies if e]}


# ── 시즌 2 ────────────────────────────────────────────────────────────
def parse_v2_rows(tbl):
    has_set = "所属指标集" in tbl
    out = []
    for r in table_rows(tbl):
        cells = [cell_body(c) for c in r]
        if len(cells) < (6 if has_set else 5):
            continue
        if has_set:
            st, icon, name, desc, dim, score = cells[:6]
        else:
            st = None
            icon, name, desc, dim, score = cells[:5]
        m = re.search(r"\[\[(?:文件|file|File):([^|\]]+?)\.png", icon)
        if not m:
            continue
        rune = {"id": rid(m.group(1)), "name": clean(name), "desc": clean(desc),
                "dim": clean(dim), "score": int(re.sub(r"\D", "", clean(score)) or 0)}
        if st is not None:
            s = clean(st)
            mm = re.match(r"^(.*?)\s*[（(]\s*(\d+)\s*[)）]\s*$", s)
            if mm:
                rune["set"], rune["setBonus"] = mm.group(1).strip(), int(mm.group(2))
            elif s and s not in ("-", "—", "/"):
                rune["set"] = s
        out.append(rune)
    # 같은 지표가 경로도의 다른 칸에 또 있으면(예: 山川之形 둘) 한 줄로 합치고 count 를 단다
    merged = []
    for r in out:
        for m in merged:
            if all(m.get(k) == r.get(k) for k in ("id", "name", "desc", "score", "set", "dim")):
                m["count"] = m.get("count", 1) + 1
                break
        else:
            merged.append(r)
    return merged


def v2_season(n, name):
    sw = get(f"危机合约/{name}")
    info = season_info(sw)
    year = int(info["start"][:4])
    det = get(f"危机合约/{name}/指标详情")
    # 표 머리 맵 이름 → 지표
    tables = {}
    for m in re.finditer(r"\{\|.*?\n\|\}", det, re.S):
        t = m.group(0)
        h = re.search(r"^!\s*colspan=\d+\s*\|\s*(.+?)\s*$", t, re.M)
        if h:
            tables[clean(h.group(1))] = parse_v2_rows(t)
    # 맵 목록
    lst = heading_block(get("关卡一览/活动关卡"), name, 2) or ""
    maps, kind = [], None
    for line in lst.split("\n"):
        if "主测试地" in line:
            kind = "main"
        elif "轮换测试地" in line:
            kind = "rotation"
        for mm in re.finditer(r"\[\[([^\]|]+)\|", line):
            if kind:
                maps.append((mm.group(1).strip(), kind))
    if not maps:   # 폴백: 시즌 문서의 {{参阅|…任务地图}}
        names = re.findall(r"\{\{参阅\|危机合约/[^/]+/(.+?) 任务地图", sw)
        maps = [(x, "main" if i == 0 else "rotation") for i, x in enumerate(names)]
    # 로테이션 개방일
    opens = {}
    for _, _, args in templates(sw, "危机合约轮换测试地任务"):
        kv = dict(a.split("=", 1) for a in args if "=" in a)
        nm = clean(kv.get("地名", ""))

        def md(s):
            m = re.search(r"[（(](\d{1,2})/(\d{1,2})[)）]", s or "")
            if not m:
                return None
            mo, d = int(m.group(1)), int(m.group(2))
            y = year + (1 if mo < int(info["start"][5:7]) else 0)
            return ymd(y, mo, d)
        op = md(kv.get("开放"))
        if op is None and "初始开放" in (kv.get("开放") or ""):
            op = info["start"]
        opens[nm] = {"open": op, "rewardUntil": md(kv.get("失效")), "openText": clean(kv.get("开放")),
                     "tasks": [clean(kv[k]) + " — " + clean(kv.get("条件" + k[2:], ""))
                               for k in sorted(kv, key=lambda x: (len(x), x)) if re.match(r"^任务\d+$", k)]}
    out = []
    for nm, kind in maps:
        lv = map_level_id(nm)
        e = {"name": nm, "kind": kind, "prtsLevelId": lv["id"], "level": None, "_lv": lv}
        if kind == "rotation" and nm in opens:
            o = opens[nm]
            e["dates"] = [o["open"]] if o["open"] else []
            if o["rewardUntil"]:
                e["rewardUntil"] = o["rewardUntil"]
            if o["tasks"]:
                e["tasks"] = o["tasks"]
        elif kind == "main":
            e["dates"] = [info["start"], info["end"]]
        e["runes"] = tables.get(nm, [])
        if not e["runes"]:
            print(f"  ⚠ {name} {nm}: 지표 표를 못 찾았다", file=sys.stderr)
        out.append(e)
    extra = sorted(set(tables) - {m[0] for m in maps})
    return {"prtsName": name, "prtsTitle": info["title"], "subtitle": info["subtitle"],
            "start": info["start"], "end": info["end"], "maps": out,
            **({"notes": "지표 표만 있고 맵 목록에 없는 것: " + ", ".join(extra)} if extra else {})}


# ── 시즌 1 ────────────────────────────────────────────────────────────
CONTRACT = "危机合约词条"

# 초기 시즌(#0·#1 무렵) 문서는 {{合约|<이름>|<등급>|<수치…>|class=|icon=|intro=}} 틀을 쓴다 — id·설명이
# 없고 위키 모듈(模块:GetRuneKey·GetRuneIntro)이 이름으로 찾아 채운다. 그 Lua 표를 그대로 읽어 흉내 낸다.
# 클래스 갈래(目标：应急合约·战略调度)의 아이콘은 모板:合约 의 #switch 를 옮겼다.
CLASS_COST = {"术师和重装": "casterdefender_1", "重装和术师": "casterdefender_1", "术师和医疗": "casterhealer_1",
              "医疗和术师": "casterhealer_1", "近卫和重装": "guarddefender_1", "重装和近卫": "guarddefender_1",
              "医疗和近卫": "guardhealer_1", "近卫和医疗": "guardhealer_1", "医疗和重装": "healerdefender_1",
              "重装和医疗": "healerdefender_1", "狙击": "_sniper_1", "狙击和术师": "snipercaster_2",
              "术师和狙击": "snipercaster_2", "狙击和医疗": "sniperhealer_1", "医疗和狙击": "sniperhealer_1"}
CLASS_EXCL = {"术师和重装": "casterdefender_2", "重装和术师": "casterdefender_2", "医疗和术师": "casterhealer_2",
              "术师和医疗": "casterhealer_2", "近卫和重装": "defenderguard_2", "重装和近卫": "defenderguard_2",
              "近卫和术师": "guardcaster_2", "术师和近卫": "guardcaster_2", "近卫和医疗": "guardhealer_2",
              "医疗和近卫": "guardhealer_2", "医疗": "healer_1", "医疗和重装": "healerdefender_2",
              "重装和医疗": "healerdefender_2", "狙击和术师": "snipercaster_3", "术师和狙击": "snipercaster_3",
              "狙击和医疗": "sniperhealer_2", "医疗和狙击": "sniperhealer_2", "狙击和辅助": "sniperspecial",
              "辅助和狙击": "sniperspecial", "特种": "special_1", "狙击和特种": "specialsniper_2",
              "特种和狙击": "specialsniper_2", "辅助": "supporter_1"}
_RUNE_KEY = _RUNE_INTRO = None


def _lua_table(src):
    out = {}
    for line in src.split("\n"):
        st = line.strip()
        if st.startswith("--"):
            continue
        m = re.match(r"^t\['(.+?)'\]\s*=\s*(.+?)\s*$", st)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def _lua_eval(expr, args):
    """'所有…提升'..args[2]..'%' → 문자열 (args[k] = 틀의 k+1 번째 위치 인자)."""
    s = ""
    for lit, ix in re.findall(r"'((?:[^'\\]|\\.)*)'|args\[(\d+)\]", expr):
        if ix:
            s += args.get(int(ix), "")
        else:
            s += lit
    return s


def legacy_contract(a):
    """{{合约|…}} 인자 → rune (id·설명을 모듈 표로 채운다)."""
    global _RUNE_KEY, _RUNE_INTRO
    if _RUNE_KEY is None:
        _RUNE_KEY = _lua_table(get("模块:GetRuneKey"))
        _RUNE_INTRO = _lua_table(get("模块:GetRuneIntro"))
    pos = [x for x in a if not re.match(r"^\s*(class|icon|intro|width)\s*=", x)]
    kv = dict(x.split("=", 1) for x in a if re.match(r"^\s*(class|icon|intro|width)\s*=", x))
    kv = {k.strip(): v.strip() for k, v in kv.items()}
    name = pos[0].strip()
    lv = int(re.sub(r"\D", "", pos[1]) or 0) if len(pos) > 1 else 0
    cls = kv.get("class")
    key = None
    if cls and name == "目标：应急合约":
        key = "Char_cost_" + CLASS_COST.get(cls, "?")
    elif cls and name == "目标：战略调度":
        key = "Char_exclude_" + CLASS_EXCL.get(cls, "?")
    else:
        key = kv.get("icon") or _lua_eval(_RUNE_KEY.get(name, "''"), {})
    if cls and name in ("目标：应急合约", "目标：战略调度"):
        desc = _lua_eval(_RUNE_INTRO.get(name, "''"), {2: cls})
    elif kv.get("intro"):
        desc = kv["intro"]
    else:
        args = {k: pos[k].strip() for k in range(2, len(pos))}   # 틀 {{{3}}}(pos[2]) → args[2]
        desc = _lua_eval(_RUNE_INTRO.get(name, "''"), args)
    return {"id": rid(key), "name": clean(name), "desc": clean(desc) or None, "level": lv,
            "legacyTemplate": True}


def v1_runes_from_table(tbl, date=None):
    """한 표의 {{危机合约词条}} 들 → [rune]. col = 표에서의 칸 번호(같은 칸 = 같은 계약 묶음의 등급들)."""
    out = []
    for r in table_rows(tbl):
        col = 0
        for c in r:
            body = cell_body(c)
            if "'''等级" in body or "'''支援'''" in body:
                continue
            col += 1
            found = [(s, "new", a) for s, e, a in templates(body, CONTRACT)]
            found += [(s, "old", a) for s, e, a in templates(body, "合约")]
            for s, kind, a in sorted(found, key=lambda x: x[0]):
                if kind == "new":
                    if len(a) < 4:
                        continue
                    lv = int(re.sub(r"\D", "", a[2]) or 0)
                    rune = {"id": rid(a[0]), "name": clean(a[1]), "desc": clean(a[3]), "level": lv}
                else:
                    if not a:
                        continue
                    rune = legacy_contract(a)
                    lv = rune["level"]
                if lv == 0:
                    rune["group"] = "支援合约"
                else:
                    rune["col"] = col
                pre = body[:s]
                mk = templates(pre, "合约标记")
                for _, _, ma in mk:
                    if ma and ma[0].strip() == "追加" and len(ma) > 1:
                        d = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", ma[1].strip())
                        rune["added"] = ymd(*d.groups()) if d else ma[1].strip()
                    elif ma and ma[0].strip() == "挑战":
                        rune["challenge"] = True
                if date:
                    rune["dates"] = [date] if isinstance(date, str) else list(date)
                out.append(rune)
    return out


def merge_runes(lst):
    """(id, 이름, 설명, 등급) 이 같으면 하나로 — 날짜는 합친다."""
    out = []
    for r in lst:
        for m in out:
            if all(m.get(k) == r.get(k) for k in ("id", "name", "desc", "level")):
                if "dates" in r:
                    m["dates"] = sorted(set(m.get("dates", [])) | set(r["dates"]))
                if r.get("challenge"):
                    m["challenge"] = True
                break
        else:
            out.append(dict(r))
    return out


def parse_date_label(label):
    """'2023年03月21日-22日' · '2023年03月31日-04月01日' · '2023年03月26日、04月02日' → [YYYY-MM-DD…]."""
    m = re.match(r"(\d{4})年(.*)$", label.strip())
    if not m:
        return []
    y = int(m.group(1))
    body = re.sub(r"(\d{1,2})\s*-\s*(\d{1,2})日", r"\1日-\2日", m.group(2))   # '11月15-16日'
    toks = re.findall(r"(?:(\d{1,2})月)?(\d{1,2})日|([-~～至、,，])", body)
    days, mo, rng = [], None, False
    for tm, td, sep in toks:
        if sep:
            rng = sep in "-~～至"
            continue
        if tm:
            mo = int(tm)
        d = datetime.date(y + (1 if days and mo < days[-1].month else 0), mo, int(td))
        if rng and days:
            x = days[-1] + datetime.timedelta(days=1)
            while x < d:
                days.append(x)
                x += datetime.timedelta(days=1)
        days.append(d)
        rng = False
    return [d.isoformat() for d in days]


def v1_season(n, name):
    sw = get(f"危机合约/{name}")
    info = season_info(sw)
    det = get(f"危机合约/{name}/合约详情")
    perm = heading_block(det, "常驻行动地点", 2) or ""
    rot = heading_block(det, "轮换行动地点", 2) or ""
    maps = []
    for kind, block in (("main", perm), ("rotation", rot)):
        for nm in re.findall(r"^===\s*\[\[([^\]|]+)\]\]\s*===", block, re.M):
            maps.append((nm.strip(), kind))
    out, notes = [], []
    for nm, kind in maps:
        lv = map_level_id(nm)
        hist = get(f"{nm}/历史合约")
        e = {"name": nm, "kind": kind, "prtsLevelId": lv["id"], "level": None, "_lv": lv}
        if kind == "main":
            body = section(hist, "常驻行动地点") or heading_block(hist, "常驻行动地点", 2) or ""
            runes = []
            for t in re.finditer(r"\{\|.*?\n\|\}", body, re.S):
                runes += v1_runes_from_table(t.group(0))
            e["dates"] = [info["start"], info["end"]]
            e["runes"] = merge_runes(runes)
        else:
            body = section(hist, name) or heading_block(hist, name, 3) or ""
            runes, dates = [], []
            parts = re.split(r"^====\s*(.+?)\s*====\s*$", body, flags=re.M)
            # parts = [앞, 날짜1, 본문1, 날짜2, 본문2 …]
            if len(parts) == 1:
                parts = ["", "", parts[0]]
            for i in range(1, len(parts), 2):
                ds = parse_date_label(parts[i]) if parts[i] else []
                dates += ds
                for t in re.finditer(r"\{\|.*?\n\|\}", parts[i + 1], re.S):
                    runes += v1_runes_from_table(t.group(0), ds or None)
            e["dates"] = sorted(set(dates))
            for r in runes:
                r.pop("col", None)   # 로테이션 표는 첫 행에 지원 계약 칸이 끼어 칸 번호가 행마다 어긋난다
            e["runes"] = merge_runes(runes)
        if not e["runes"]:
            notes.append(f"{nm}: 계약 표를 못 찾았다")
            print(f"  ⚠ {name} {nm}: 계약 표를 못 찾았다", file=sys.stderr)
        out.append(e)
    res = {"prtsName": name, "prtsTitle": info["title"], "subtitle": info["subtitle"],
           "start": info["start"], "end": info["end"], "maps": out,
           "notes": "level = 계약 등급(危机合约词条 3번째 인자, 0 = 지원 계약). 게임의 위험도 합산값과 같다고 보고 risk 에도 옮겼다. "
                    "col = 상주 지점 표의 칸 번호(같은 칸의 1~3 등급 중 하나만 고른다). 로테이션 계약의 dates = 그 계약이 걸렸던 날."}
    if notes:
        res["notes"] += " / " + " · ".join(notes)
    for m in out:
        for r in m["runes"]:
            if "level" in r:
                r["risk"] = r["level"]
    return res


# ── 레벨 대응 ─────────────────────────────────────────────────────────
def link_levels(seasons):
    names_cn = {}
    have = set()
    lv_cache = {}
    if not NO_LEVELS:
        import cdnlevels
        import cdntables
        for srv in ("kr", "cn"):
            try:
                mani = cdnlevels._conn(srv).manifest()
            except Exception as e:
                print(f"  ⚠ {srv} 매니페스트 실패: {e}", file=sys.stderr)
                continue
            for k in mani:
                m = re.match(r"^gamedata/levels/obt/(?:crisis/v2/level_(crisis_v2_\d+-\d+)|rune/(level_rune_\d+-\d+))$", k)
                if m:
                    have.add(m.group(1) or m.group(2))
        hb = cdntables.table("enemy_handbook_table", server="cn") or {}
        for eid, e in (hb.get("enemyData") or hb).items():
            if isinstance(e, dict) and e.get("name"):
                names_cn[eid] = e["name"]

        def level(lid):
            if lid not in lv_cache:
                rel = ("obt/crisis/v2/level_" + lid) if lid.startswith("crisis_v2") else ("obt/rune/" + lid)
                d = None
                for srv in ("kr", "cn"):
                    try:
                        d = cdnlevels.level(rel, server=srv)
                    except Exception:
                        d = None
                    if d:
                        break
                lv_cache[lid] = d
            return lv_cache[lid]

    def lv_sig(lid):
        d = level(lid)
        if not d:
            return None
        mp = d["mapData"]["map"]
        en = {names_cn.get(r["id"]) for r in (d.get("enemyDbRefs") or [])} - {None}
        return {"size": (mp["column_size"], mp["row_size"]), "enemies": en, "bgm": d.get("bgmEvent")}

    for sid, s in seasons.items():
        for m in s["maps"]:
            lv = m.pop("_lv")
            pid = lv["id"]
            if NO_LEVELS:
                m["level"] = pid
                continue
            if pid in have:
                m["level"] = pid
                continue
            # PRTS id 가 매니페스트에 없다 → 같은 계열 레벨과 적·크기 대조
            if sid.startswith("crisis_v2"):
                pool = sorted(x for x in have if x.startswith("crisis_v2_"))
            else:
                pool = sorted(x for x in have if x.startswith("level_rune_"))
            claimed = {mm["prtsLevelId"] for ss in seasons.values() for mm in ss["maps"]}
            want = set(lv["enemies"])
            best = []
            for cand in pool:
                if cand in claimed:
                    continue
                sg = lv_sig(cand)
                if not sg:
                    continue
                inter = len(want & sg["enemies"])
                uni = len(want | sg["enemies"]) or 1
                best.append((inter / uni, sg["size"] == lv["size"], cand, sorted(want & sg["enemies"])))
            best.sort(key=lambda x: (-x[0], not x[1]))
            if best:
                top = best[0]
                second = best[1][0] if len(best) > 1 else 0
                ev = (f"PRTS 关卡id={pid} 는 CDN 에 없음 → 적 구성 대조 {top[2]} "
                      f"(겹침 {top[0]:.2f}: {'·'.join(top[3][:6])}; 크기 {'일치' if top[1] else '불일치'} "
                      f"PRTS {lv['size']}; 2위 {second:.2f})")
                if top[0] >= 0.5 and top[1] and top[0] - second >= 0.2:
                    m["level"] = top[2]
                    m["levelBy"] = ev
                else:
                    m["levelGuess"] = top[2]
                    m["levelGuessWhy"] = ev
            else:
                m["levelGuessWhy"] = f"PRTS 关卡id={pid} 는 CDN 에 없고 대조할 후보도 없음"
    # 시즌 1 상주 맵 검증: bgmEvent = rune_season_N_1_main / 시즌 2 메인 = crisis_v2_season_N_1_main
    if not NO_LEVELS:
        for sid, s in seasons.items():
            for m in s["maps"]:
                if m["kind"] == "main" and m.get("level"):
                    sg = lv_sig(m["level"])
                    if sg and sg["bgm"] != f"{sid}_main":
                        m["levelNote"] = f"bgmEvent={sg['bgm']} (기대 {sid}_main)"
    return sorted(have)


def main():
    seasons = {}
    for i, nm in enumerate(V1, 1):
        print(f"시즌 1 #{i} {nm}", file=sys.stderr)
        seasons[f"rune_season_{i}_1"] = v1_season(i, nm)
    for i, nm in enumerate(V2, 1):
        print(f"시즌 2 #{i} {nm}", file=sys.stderr)
        seasons[f"crisis_v2_season_{i}_1"] = v2_season(i, nm)
    have = link_levels(seasons)
    # 어느 시즌 맵에도 대응되지 않은 CDN 시즌 레벨
    used = {m.get("level") for s in seasons.values() for m in s["maps"]}
    unused = [x for x in have if x not in used]
    doc = {
        "_source": f"PRTS 위키 (prts.wiki) — {datetime.date.today().isoformat()} 받음 (api.php action=parse wikitext). "
                   f"문서 {len(set(FETCHED))}개: 危机合约/<시즌>(/合约详情|/指标详情), 关卡一览/活动关卡, "
                   "<맵 이름>, <맵 이름>/历史合约. 생성: scripts/fetch-crisis-prts.py",
        "_fields": {
            "maps[].level": "사이트·게임 레벨 id (PRTS 关卡id 가 CDN 매니페스트에 있으면 그대로, 없으면 적·크기 대조 — levelBy 에 근거)",
            "maps[].prtsLevelId": "PRTS 맵 문서의 关卡id 원문",
            "maps[].dates": "main: [시즌 시작, 끝] · 시즌 1 rotation: 열린 날 전부 · 시즌 2 rotation: [개방일] (+ rewardUntil 한정 보상 만료일)",
            "runes[].id": "지표·계약 아이콘 id (게임 번들 arts/ui/[uc]crisisv2/runeicon/<id> 등과 같은 이름)",
            "v2 runes": "dim 维度 · score 分数 · set 所属指标集 · setBonus 额外分数 · count 경로도에 같은 지표가 여러 칸",
            "v1 runes": "level 등급(0=지원) · risk(=level) · col 상주 표 칸 · added 시즌 중 추가일 · challenge 挑战 표식 · dates 로테이션에서 걸린 날",
        },
        "cdnLevelsUnmatched": unused,
        "seasons": seasons,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"✓ {OUT}", file=sys.stderr)
    for sid, s in seasons.items():
        ms = s["maps"]
        print(f"  {sid:24s} {s['prtsName']}  맵 {len(ms)} · 레벨 {sum(1 for m in ms if m.get('level'))} · "
              f"지표 {sum(len(m['runes']) for m in ms)}", file=sys.stderr)
    print("  CDN 레벨 중 어느 맵에도 안 붙은 것: " + " ".join(unused), file=sys.stderr)


if __name__ == "__main__":
    main()
