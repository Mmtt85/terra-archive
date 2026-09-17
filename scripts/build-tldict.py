#!/usr/bin/env python3
"""중국어→한국어 번역 사전 공개본 — 사람이 열어 읽을 수 있는 모양으로 낸다.

배경 (2026-09-17):
  중섭 화면을 OCR로 읽어 한국어를 덧씌우는 개인 앱에서 "공개 API·오프라인 사전·증분
  동기화가 가능하냐"는 문의가 왔다.

⚠ **200개씩 끊는 조각(chunk)은 만들지 않는다 — 한 번 만들었다가 접었다.**
  사전 전량이 3MB인데 받는 쪽은 2~3주에 한 번 내려받는다. 증분으로 아끼는 건 한 달에
  3MB뿐인데, 그 대가로 47개짜리 조각 파일이 생기고 **열어 봐도 뭐가 든 파일인지 알 수
  없어졌다** (사용자 지적 2026-09-17: "청크 안에 내용이 그냥 중구난방이라 읽을 수가 없음").
  조각 배정 상태를 물려받는 코드에서 고아 파일 버그도 났다. 아낀 것보다 치른 게 컸다.

  그래서 **의미 있는 경계로만** 가른다:
    · 콘텐츠 단위 (통합전략은 테마별, 생존연산, 오퍼)
    · 자주 바뀌는 것 ↔ 거의 안 바뀌는 것 (op-fut ↔ op-past)
  파일마다 해시를 manifest에 실으므로 증분은 **파일 단위로** 그대로 된다.

내는 것 (14개):
  manifest.json      파일 목록·해시·항목 수 + **바로 요청할 수 있는 URL**
  op-fut.json        미실장 오퍼·재료 — 중섭 패치마다 늘어난다
  op-past.json       한섭 출시로 공식 번역이 덮은 옛 장부 — 거의 안 바뀐다
  kr-{op,item,enemy,stage}.json
                     **공식 CN↔KO 대조본** — 한섭에 나온 것의 중국어 원문과 공식 한국어를
                     id 로 짝지은 것. 번역이 아니라 대조라 AI 번역이 안 섞인다.
                     받는 쪽이 보는 건 중섭 화면이라 한섭 출시 여부와 무관하게 필요하다
                     (사용자 지적 2026-09-17).
  ra.json            생존연산
  is1.json … is6.json  통합전략 1~6 — 안에서 collectibles·nodes·encounters·endings·battles 로 갈라 둔다
  is-common.json     통합전략 공통 조우 편집자 텍스트 (테마 구분이 없는 안내·판정 문구)

통합전략 파일 모양 (사용자 지시 2026-09-17 "is3 : {아이템: 뭐시기, 적: 뭐시기} 이런 식"):
  {"collectibles": {"热水壶": {"ko": "전기주전자"}, …}, "nodes": {…}, "encounters": {…}, …}

출처:
  scripts/cn-translations.json   미실장 오퍼·재료 상세 (특성·재능·스킬·잠재·모듈·기반시설)
  scripts/sandbox-cn-ko.json     생존연산
  scripts/rogue-enc-i18n.json    통합전략 조우 씬 텍스트 (게임 excel에 없는 직접 집필분)
  app/data/rogue{1..5}.cn.json   통합전략 1~5 — **원문 병기(`cn` 필드)** 에서 긁는다
  app/data/rogue6.json           통합전략 6 — 같은 방식

  ⚠ 통합전략은 **여섯 테마 전부**다 (사용자 지시 2026-09-17). 1~5는 사전 파일이 따로
    없는데, build-rogue.py 의 cn_koreanize() 가 이름·제목·설명에 CN 원문을 `cn` 필드로
    병기해 두므로 거기서 (cn → 한국어) 짝을 그대로 긁어낼 수 있다.

  ⚠ `scripts/rogue-i18n.json`·`rogue<N>-curated.json`·`scripts/story-i18n/` 은 **뺐다** —
    키가 중국어가 아니라 한국어라 CN 화면 OCR로는 찾을 수 없다.

  ⚠ **스토리 전문은 "원문이 없어서" 뺀 게 아니다** (2026-09-17에 한 번 그렇게 잘못 적었다).
    위 한 줄은 story-i18n **용어집** 얘기고, 스토리 본문은 사정이 다르다 — CN 원문이
    같은 gamedata 레포에 있고(build-story-scripts.py 가 이미 `cn/gamedata/story/` 를
    받아 온다) KR 과 **줄 단위로 짝이 맞는다** (실측: level_main_01-01_beg 대사 34줄이
    CN·KR 34/34, 화자까지 일치). 안 담은 진짜 이유는 셋이다:
      ① 분량 — KR 전문만 46MB(1,909편). 사전 3.2MB 의 수십 배라 별도 파일이어야 한다.
      ② 정작 필요한 데가 빈다 — CN 2,009편 vs KR 1,909편, 차이 100편이 미래시인데
         거기엔 짝지을 KR 원문이 아예 없다. 짝이 맞는 건 한섭에 이미 나온 것뿐이다.
      ③ OCR 정합 — 명칭은 짧아 정확히 일치하지만 대사는 길고 줄바꿈·변수 치환이 섞인다.
    ①②는 옆 세션의 스토리 전문 번역 데이터가 나오면 다시 볼 일이다 (사용자 2026-09-17).

manifest 에 URL 을 미리 박아 둔다 (사용자 지시 2026-09-17) — 받는 쪽이 주소를 조합하지
않게 하려는 것이고, 거기에 **해시를 `?v=` 로 같이 박는다.** 조각 JSON 의 캐시 정책이
`max-age=60, must-revalidate` 라, 해시가 바뀐 걸 보고 곧바로 받아도 자기 캐시·중간
프록시·CDN 엣지가 옛 바이트를 돌려줄 창이 남는다. 내용이 바뀌면 URL 이 바뀌므로 그 창이
닫힌다 — 이 사이트가 이미 같은 사고를 겪고 같은 방식으로 막아 둔 자리가 있다
(app/rogue.tsx 의 `?v=2` "트리밍 전 이미지가 CDN 엣지에 남아 몇 시간째 옛 그림").
R2 워커는 쿼리 파라미터를 무시하고 같은 오브젝트를 준다 (실측 2026-09-17).
도메인·경로를 옮겨도 받는 쪽은 manifest 만 다시 받으면 따라온다 — 하드코딩할 것이
manifest 주소 하나로 줄어든다.

사용:  python3 scripts/build-tldict.py
"""
import hashlib
import html
import json
import os
import re
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "public", "tl")
# ⚠ **형식 버전(v)은 두지 않는다** (사용자 지시 2026-09-17). manifest 가 네 항목뿐이라
#   숫자를 얹어 봐야 받는 쪽이 그걸 검사해 줄 거라는 보장이 없고, 안 보면 없느니만 못하다.
#   **형식을 깨야 하면 숫자를 올리지 말고 주소를 새로 판다** (assets/tl2/ 같은 식) —
#   그러면 옛 앱은 옛 주소에서 그대로 돌아가고, 깨진 걸 모른 채 엉뚱한 번역을 덧씌우는
#   일이 아예 안 생긴다. 항목을 **더하는** 것은 깨는 변경이 아니니 그냥 더하면 된다.
# 공개 기준 주소 — r2-sync.mjs 가 아니라 publish-tl.mjs 가 assets/tl/ 로 올린다.
# 여기를 고치면 manifest 의 url 이 함께 따라간다.
BASE = "https://files.terra-archive.net/assets/tl"

CJK = re.compile(r"[一-鿿]")

# 통합전략 산출물의 컬렉션 → 파일 안의 갈래 이름. 제보자가 물어 온 갈래 그대로 맞춘다
# ("소장품·노드·조우·엔딩·전투 설명" — 키는 영어로 낸다).
# ⚠ 갈래 이름은 **영어 키**다 (사용자 지시 2026-09-17). 받는 쪽이 한국어권이라는 보장이
#   없고, JSON 키에 한글이 섞이면 쓰는 쪽 코드가 지저분해진다. 값(번역문)만 한국어다.
IS_GROUP = {
    "relics": "collectibles", "capsules": "collectibles", "tools": "collectibles",
    "scraps": "collectibles", "legacies": "collectibles", "buoys": "collectibles",
    "nodeTypes": "nodes", "zones": "nodes", "weathers": "nodes",
    "subweathers": "nodes", "difficulties": "nodes",
    "encounters": "encounters", "visitors": "encounters",
    "endings": "endings",
    "stages": "battles", "enemies": "battles", "bands": "battles",
    "mechanics": "battles", "variations": "battles",
}
IS_ORDER = ["collectibles", "nodes", "encounters", "endings", "battles"]

ROGUE_FILES = [("is1", "app/data/rogue1.cn.json"), ("is2", "app/data/rogue2.cn.json"),
               ("is3", "app/data/rogue3.cn.json"), ("is4", "app/data/rogue4.cn.json"),
               ("is5", "app/data/rogue5.cn.json"),
               # 6번은 중섭 선행이라 CN 변형 빌드가 없다 — KR 산출물이 원문 병기를 들고 있다
               ("is6", "app/data/rogue6.json")]

FUT_THEMES = {"is6"}   # 아직 한섭에 없는 테마


def load(rel):
    with open(os.path.join(REPO, rel), encoding="utf-8") as fp:
        return json.load(fp)


def harvest_rogue(doc):
    """통합전략 산출물에서 {갈래: {중국어 원문: {ko}}} 를 긁는다.

    build-rogue.py 의 cn_koreanize() 가 이름·제목·설명에 CN 원문을 `cn` 필드로 병기해
    둔다 — 인게임 화면이 중국어라 대조할 것이 있어야 하기 때문이다(사용자 지적 2026-09-06).
    그 병기를 뒤집으면 그대로 CN→KO 사전이 된다.
    """
    groups = {}

    def walk(x, group):
        if isinstance(x, dict):
            cn = x.get("cn")
            if isinstance(cn, str) and CJK.search(cn):
                for field in ("name", "title", "desc"):
                    ko = x.get(field)
                    if isinstance(ko, str) and ko.strip() and not CJK.search(ko):
                        groups.setdefault(group, {}).setdefault(cn, {"ko": ko})
                        break
            for v in x.values():
                walk(v, group)
        elif isinstance(x, list):
            for v in x:
                walk(v, group)

    for coll, val in doc.items():
        group = IS_GROUP.get(coll)
        if group:
            walk(val, group)
    return {g: groups[g] for g in IS_ORDER if groups.get(g)}


def live_blobs():
    """지금 사이트 데이터에 실려 있는 한국어 뭉치 — '아직 한섭에 없나' 판정용.

    cn-translations.json 은 **과거 미실장 번역이 쌓인 장부**다. 한섭에 정식 출시되면
    공식 번역이 그 자리를 덮으므로 옛 AI 번역문은 더 이상 산출물에 나타나지 않는다
    (실측 2026-09-17: 2,802건 중 2,451건이 이미 대체됨). 그래서 "지금 산출물에 그
    번역문이 보이나"가 곧 "아직 한섭에 없나"다.
    """
    out = []
    for rel in ("app/data/operators.json", "app/data/infra.json", "app/data/items.json"):
        path = os.path.join(REPO, rel)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fp:
                out.append(fp.read())
    return out


def md_to_html(md):
    """README.md → 본문 HTML. 여기 쓰는 문법만 다룬다 (제목·표·코드블록·목록·문단)."""
    def inline(t):
        t = html.escape(t)
        t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
        t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
        # [글](주소) 를 먼저 완성해 자리표시자로 빼 둔다 — 안 그러면 아래 맨주소 변환이
        # 그 안의 주소까지 또 감싸 <a href="<a href=…"> 로 겹친다 (2026-09-17에 그랬다).
        done = []

        def stash(m):
            done.append(f'<a href="{m[2]}">{m[1]}</a>')
            return f"\x00{len(done) - 1}\x00"

        t = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", stash, t)
        # 맨주소·메일은 그대로 링크로
        t = re.sub(r"(?<![\w>])(https?://[^\s<)]+|[\w.+-]+@[\w.-]+\.\w+)",
                   lambda m: f'<a href="{"mailto:" if "@" in m[1] else ""}{m[1]}">{m[1]}</a>', t)
        return re.sub(r"\x00(\d+)\x00", lambda m: done[int(m[1])], t)

    lines, out, i = md.split("\n"), [], 0
    cells = lambda r: [c.strip() for c in r.strip().strip("|").split("|")]
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(html.escape(lines[i]))
                i += 1
            i += 1
            out.append("<pre><code>" + "\n".join(buf) + "</code></pre>")
        elif ln.startswith("#"):
            n = len(ln) - len(ln.lstrip("#"))
            out.append(f"<h{n}>{inline(ln[n:].strip())}</h{n}>")
            i += 1
        elif ln.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[-: |]+\|$", lines[i + 1]):
            al = ["right" if a.strip().endswith(":") else "left" for a in cells(lines[i + 1])]
            head, i, body = cells(ln), i + 2, []
            while i < len(lines) and lines[i].startswith("|"):
                body.append(cells(lines[i]))
                i += 1
            th = "".join(f'<th style="text-align:{al[k]}">{inline(c)}</th>' for k, c in enumerate(head))
            tr = "".join("<tr>" + "".join(
                f'<td style="text-align:{al[k] if k < len(al) else "left"}">{inline(c)}</td>'
                for k, c in enumerate(r)) + "</tr>" for r in body)
            out.append(f"<table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>")
        elif re.match(r"^(-|\d+\.) ", ln):
            tag, items = ("ul" if ln.startswith("- ") else "ol"), []
            while i < len(lines) and (re.match(r"^(-|\d+\.) ", lines[i])
                                      or (items and lines[i].startswith("  ") and lines[i].strip())):
                if re.match(r"^(-|\d+\.) ", lines[i]):
                    items.append(re.sub(r"^(-|\d+\.) ", "", lines[i]))
                else:
                    items[-1] += " " + lines[i].strip()
                i += 1
            out.append(f"<{tag}>" + "".join(f"<li>{inline(x)}</li>" for x in items) + f"</{tag}>")
        elif not ln.strip():
            i += 1
        else:
            buf = []
            while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||```|- |\d+\. )", lines[i]):
                buf.append(lines[i].strip())
                i += 1
            out.append("<p>" + inline(" ".join(buf)) + "</p>")
    return "\n".join(out)


HTML_SHELL = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>테라 아카이브 — 중국어→한국어 번역 사전</title>
<meta name="robots" content="noindex">
<style>
 :root{--bg:#fbfaf8;--fg:#23201c;--dim:#6d6459;--line:#e3ddd3;--code:#f2efe9;--accent:#b4622a}
 @media (prefers-color-scheme:dark){:root{--bg:#171614;--fg:#e7e2da;--dim:#9a9187;--line:#322e29;--code:#22201d;--accent:#e08b4e}}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.75 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
 main{max-width:820px;margin:0 auto;padding:40px 16px 80px}
 h1{font-size:25px;line-height:1.35;margin:0 0 18px;letter-spacing:-.4px}
 h2{font-size:18px;margin:38px 0 12px;padding-top:18px;border-top:1px solid var(--line);letter-spacing:-.3px}
 a{color:var(--accent)}
 code{background:var(--code);padding:1.5px 5px;border-radius:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em}
 pre{background:var(--code);border:1px solid var(--line);border-radius:9px;padding:13px 15px;overflow-x:auto;line-height:1.6}
 pre code{background:none;padding:0;font-size:12.5px}
 table{border-collapse:collapse;width:100%;margin:14px 0;font-size:13.5px;display:block;overflow-x:auto}
 th,td{border-bottom:1px solid var(--line);padding:8px 11px;text-align:left;white-space:nowrap}
 th{color:var(--dim);font-weight:600;font-size:12px}
 td:nth-child(2){white-space:normal;min-width:14em}
 ul,ol{padding-left:20px}li{margin:5px 0}
 footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);color:var(--dim);font-size:12.5px}
</style></head><body><main>
__BODY__
<footer>이 페이지는 <code>README.md</code>를 그대로 옮긴 것입니다 — 같은 내용을 마크다운으로
받으시려면 <a href="README.md">README.md</a>.</footer>
</main></body></html>
"""


def human(n):
    return f"{n / 1048576:.1f} MB" if n >= 1024 * 1024 else f"{round(n / 1024):,} KB"


def update_readme_table(md_path, counts, order):
    """규격서 「파일」 표의 **숫자 칸만** 다시 쓴다 — 파일·내용 칸의 문구는 손댄 그대로 둔다.

    항목 수도 크기도 빌드마다 바뀌는데 손으로 적어 두면 중섭 패치 한 번에 거짓말이 된다.
    그렇다고 표 전체를 만들어 버리면 공들여 고친 설명 문구가 매번 날아간다 — 그래서
    행이 어느 파일을 가리키는지 첫 칸의 코드 스팬에서 읽어내 **뒤 두 칸만** 갈아 끼운다.
    `is1.json` … `is6.json` 처럼 둘 이상을 가리키는 행은 그 사이 전부의 범위를 낸다.
    """
    with open(md_path, encoding="utf-8") as fp:
        text = fp.read()
    rows = re.search(r"^\| 파일 \|.*?(?=\n\n)", text, re.M | re.S)
    if not rows:
        return
    out = []
    for i, line in enumerate(rows[0].split("\n")):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if i == 0:
            out.append("| " + " | ".join(cells[:2] + ["항목", "크기"]) + " |")
            continue
        if i == 1:
            out.append("|---|---|---:|---:|")
            continue
        named = re.findall(r"`([A-Za-z0-9.\-]+\.json)`", cells[0])
        if not named:
            out.append(line)
            continue
        if len(named) > 1 and named[0] in order and named[-1] in order:
            span = order[order.index(named[0]):order.index(named[-1]) + 1]
        else:
            span = named
        sizes = [os.path.getsize(os.path.join(OUT, f)) for f in span if os.path.exists(os.path.join(OUT, f))]
        nums = [counts[f] for f in span if f in counts]
        n = "—" if not nums else (f"{nums[0]:,}" if len(set(nums)) == 1
                                  else f"{min(nums):,}~{max(nums):,}")
        if not sizes:
            z = "—"
        elif len(set(sizes)) == 1:
            z = human(sizes[0])
        else:
            lo, hi = human(min(sizes)), human(max(sizes))
            # 단위가 같으면 "43~86 KB" — "43 KB~86 KB" 는 눈에 걸린다
            z = f"{lo.split()[0]}~{hi}" if lo.split()[1] == hi.split()[1] else f"{lo}~{hi}"
        out.append("| " + " | ".join(cells[:2] + [n, z]) + " |")
    fixed = text.replace(rows[0], "\n".join(out), 1)
    if fixed != text:
        with open(md_path, "w", encoding="utf-8") as fp:
            fp.write(fixed)


def write_html(md_path, out_path):
    with open(md_path, encoding="utf-8") as fp:
        body = md_to_html(fp.read())
    raw = HTML_SHELL.replace("__BODY__", body)
    old = open(out_path, encoding="utf-8").read() if os.path.exists(out_path) else None
    if old != raw:
        with open(out_path, "w", encoding="utf-8") as fp:
            fp.write(raw)


def digest(obj):
    raw = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def leaves(doc):
    """잎(번역문) 수 — 갈래로 한 겹 싸인 파일도 맞게 센다."""
    if not doc:
        return 0
    first = next(iter(doc.values()))
    if isinstance(first, dict) and not ({"ko", "en", "ja"} & set(first)):
        return sum(len(v) for v in doc.values())
    return len(doc)


# ── 모으기 ───────────────────────────────────────────────────────────────────
files, labels = {}, {}

# 오퍼·재료 장부 — 살아 있는 것(미실장)과 대체된 것(옛 장부)을 가른다.
# 앞쪽은 중섭 패치마다 늘고 뒤쪽은 거의 안 바뀌므로, 받는 쪽이 앞쪽만 자주 받으면 된다.
blobs = live_blobs()
GD = os.path.join(REPO, ".gamedata")


def _t(name):
    path = os.path.join(GD, f"{name}.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fp:
        return json.load(fp)


def cn_only_texts():
    """CN 표에만 있는 원문 / KR 표에 있는 원문 — 미래시 판정의 직접 증거."""
    only, krs = set(), set()
    tag_re = re.compile(r"<[^>]+>")
    tag = tag_re
    def take(cn_map, kr_map, fields):
        for i, e in (cn_map or {}).items():
            if not isinstance(e, dict): continue
            dest = krs if i in (kr_map or {}) else only
            for f in fields:
                t = e.get(f)
                if isinstance(t, str):
                    t = tag.sub("", t).strip()
                    if t: dest.add(t)
    def both(n):
        c, k = _t(f"cn_{n}"), (_t(f"kr_{n}") or _t(n))
        return (c, k) if c and k else (None, None)
    c, k = both("item_table")
    if c: take(c.get("items"), k.get("items"), ("name", "description", "usage"))
    c, k = both("character_table")
    if c: take(c, k, ("name", "appellation", "description"))
    c, k = both("enemy_handbook_table")
    if c: take(c.get("enemyData") or c, k.get("enemyData") or k, ("name", "description", "ability"))
    c, k = both("stage_table")
    if c: take(c.get("stages"), k.get("stages"), ("name", "description"))
    c, k = both("uniequip_table")
    if c: take(c.get("equipDict"), k.get("equipDict"), ("uniEquipName", "uniEquipDesc"))
    # ⚠ 보이스·기록도 봐야 한다 (2026-09-17 실측). 이 둘을 빼 뒀더니 미실장 오퍼의
    #   기록 836건·보이스 551건이 전부 op-past 로 떨어졌다 — 미래시인데 "출시로 덮인
    #   옛 것" 취급을 받은 것이다. char id 단위로 갈린다.
    c, k = both("charword_table")
    if c:
        kd, only_ops = k.get("charWords") or {}, None
        for wid, e in (c.get("charWords") or {}).items():
            dest = krs if wid in kd else only
            for f in ("voiceTitle", "voiceText"):
                t = tag_re.sub("", e.get(f) or "").strip()
                if t: dest.add(t)
    c, k = both("handbook_info_table")
    if c:
        kd = k.get("handbookDict") or {}
        for hid, e in (c.get("handbookDict") or {}).items():
            dest = krs if hid in kd else only
            for d2 in (e.get("storyTextAudio") or []):
                for s2 in (d2.get("stories") or []):
                    t = tag_re.sub("", s2.get("storyText") or "").strip()
                    if not t: continue
                    dest.add(t)
                    for ln in t.split("\n"):
                        ln = ln.strip()
                        if ln: dest.add(ln)
    return only - krs, krs


def cn_live_texts():
    """현행 CN 게임데이터에 실제로 들어 있는 중국어 문자열 전부 — 고아 판정용."""
    out, tag = set(), re.compile(r"<[^>]+>")
    def walk(o):
        if isinstance(o, dict):
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
        elif isinstance(o, str) and CJK.search(o):
            t = tag.sub("", o).strip()
            if t:
                out.add(t)
                for ln in t.split("\n"):
                    ln = ln.strip()
                    if ln: out.add(ln)
    import glob as _glob
    for f in _glob.glob(os.path.join(GD, "cn_*.json")):
        try:
            with open(f, encoding="utf-8") as fp: walk(json.load(fp))
        except (OSError, ValueError):
            continue
    return out


CN_LIVE = cn_live_texts()
CN_ONLY, KR_TEXTS = cn_only_texts()

op_fut, dropped = {}, 0
for cn, val in load("scripts/cn-translations.json").items():
    if cn.startswith("_") or not isinstance(val, dict):
        continue
    entry = {k: v for k, v in val.items() if k in ("ko", "en", "ja") and v}
    if not entry.get("ko") or entry["ko"] == cn:
        continue
    # 미래시냐 옛 장부냐 — **CN 표에만 있고 KR 표에 없는 원문인가**로 가른다.
    # 종전에는 "번역문이 사이트 산출물에 보이나"라는 간접 증거를 썼는데, 산출물에
    # 안 싣는 갈래(아이템 도감은 미실장 133종을 아예 뺀다)가 통째로 past 로 잘못
    # 떨어졌다 (2026-09-17 실측: 새로 넣은 아이템 번역 175건이 전부 오분류).
    # 직접 증거가 없을 때만 옛 방식으로 폴백한다.
    # 현행 CN 게임데이터 어디에도 없는 원문은 **내보내지 않는다** — 옛 판본의 스킬 문구
    # 같은 것이라 중섭 화면에서 마주칠 일이 없다 (2026-09-17 실측 388건). 장부에는
    # 남겨 둔다 — 다른 스크립트가 옛 산출물을 보정하는 데 쓸 수 있다.
    if cn not in CN_LIVE:
        dropped += 1
        continue
    op_fut[cn] = entry
if dropped:
    print(f"  현행 CN 데이터에 없어 제외한 옛 원문 {dropped:,}건")
files["op-fut.json"] = op_fut
labels["op-fut.json"] = "오퍼·재료·아이템 — 아직 한국 서버에 없는 것 (비공식 번역)"

# ⚠ **op-past 는 폐지했다** (2026-09-17, 사용자 지적 "공식이 덮었으면 필요 없잖아").
#   "출시로 덮인 옛 번역"이라는 갈래 자체가 성립하지 않았다 — 공식 한국어가 실재하면
#   그건 kr-* 대조본이 더 정확하게 담고, 실재하지 않으면 그건 옛것이 아니라 미래시다
#   (실측: 남아 있던 412건 중 292건은 공식이 있었고, 나머지는 CN 쪽이 앞선 재능·모듈
#   문구였다). 그래서 살아남는 것은 전부 op-fut 으로 간다.

# 생존연산
ra = {}
for cn, ko in load("scripts/sandbox-cn-ko.json").items():
    if not cn.startswith("_") and isinstance(ko, str) and ko and ko != cn:
        ra[cn] = {"ko": ko}
files["ra.json"] = ra
labels["ra.json"] = "생존연산 (중국 서버 선행)"

# 통합전략 1~6
for tag, rel in ROGUE_FILES:
    files[f"{tag}.json"] = harvest_rogue(load(rel))
    labels[f"{tag}.json"] = (f"통합전략 {tag[2:]}"
                             + (" (중국 서버 선행)" if tag in FUT_THEMES else ""))

# 통합전략 공통 — 테마 구분이 없는 조우 편집자 텍스트
common = {}
for cn, val in load("scripts/rogue-enc-i18n.json").items():
    if cn.startswith("_") or not isinstance(val, dict):
        continue
    entry = {k: v for k, v in val.items() if k in ("ko", "en", "ja") and v}
    if entry.get("ko") and entry["ko"] != cn:
        common[cn] = entry
files["is-common.json"] = {"encounters": common}
labels["is-common.json"] = "통합전략 공통 — 조우 안내·판정 문구 (테마 구분 없음)"

# ── 공식 CN↔KO 대조본 (한섭 출시분) ─────────────────────────────────────────
# 받는 쪽은 **중섭 화면**을 본다 — 한섭에 나왔든 말든 화면은 전부 중국어다. 그래서
# "한섭에 있으니 게임에서 얻으세요"는 그 앱한테 아무 쓸모가 없었다 (사용자 지적
# 2026-09-17). 여기서 내는 것은 번역이 아니라 **양쪽 공식 텍스트를 id 로 짝지은 것**이다.
# 미실장분(op-fut)과 달리 AI 번역이 한 글자도 섞이지 않는다.
#
# ⚠ 입력이 .gamedata 의 cn_*/kr_* 표다. 없으면 **그 갈래를 통째로 건너뛴다** — CI 에
#   테이블이 없다고 빌드가 죽으면 안 되고, 옛 산출물이 남아 있으면 그대로 쓰인다.
def official_pairs():
    """{갈래: {중국어 원문: {"ko": 공식 한국어}}} — 양쪽 공식 표를 id 로 조인한다."""
    out = {k: {} for k in ("op", "item", "enemy", "stage")}
    tag_re = re.compile(r"<[^>]+>")

    def add(tag, cn, ko):
        cn = tag_re.sub("", cn).strip() if isinstance(cn, str) else ""
        ko = tag_re.sub("", ko).strip() if isinstance(ko, str) else ""
        # 한국어 쪽에 한자가 남아 있으면 번역이 안 된 자리다 — 넣어 봐야 헷갈린다
        if cn and ko and cn != ko and CJK.search(cn) and not CJK.search(ko):
            out[tag].setdefault(cn, {"ko": ko})

    def both(name):
        # KR 표는 접두사 없이 저장되기도 한다 (fetch-gamedata-cdn.py 의 기본 언어)
        c, k = _t(f"cn_{name}"), (_t(f"kr_{name}") or _t(name))
        return (c, k) if c and k else (None, None)

    c, k = both("character_table")
    if c:
        for cid, a in c.items():
            b = k.get(cid)
            if not isinstance(b, dict) or not isinstance(a, dict):
                continue
            for f in ("name", "appellation", "description"):
                add("op", a.get(f), b.get(f))
            for ta, tb in zip(a.get("talents") or [], b.get("talents") or []):
                for ca, cb in zip(ta.get("candidates") or [], tb.get("candidates") or []):
                    add("op", ca.get("name"), cb.get("name"))
                    add("op", ca.get("description"), cb.get("description"))
    c, k = both("skill_table")
    if c:
        for sid, a in c.items():
            b = k.get(sid)
            if not isinstance(b, dict):
                continue
            for la, lb in zip(a.get("levels") or [], b.get("levels") or []):
                add("op", la.get("name"), lb.get("name"))
                add("op", la.get("description"), lb.get("description"))
    c, k = both("uniequip_table")
    if c:
        kd = k.get("equipDict") or {}
        for eid, a in (c.get("equipDict") or {}).items():
            b = kd.get(eid)
            if not isinstance(b, dict):
                continue
            for f in ("uniEquipName", "uniEquipDesc", "typeName1", "typeName2"):
                add("op", a.get(f), b.get(f))
    c, k = both("item_table")
    if c:
        kd = k.get("items") or {}
        for iid, a in (c.get("items") or {}).items():
            b = kd.get(iid)
            if not isinstance(b, dict):
                continue
            for f in ("name", "description", "usage"):
                add("item", a.get(f), b.get(f))
    c, k = both("enemy_handbook_table")
    if c:
        ca, kb = c.get("enemyData") or c, k.get("enemyData") or k
        for eid, a in ca.items():
            b = kb.get(eid)
            if not isinstance(a, dict) or not isinstance(b, dict):
                continue
            for f in ("name", "description", "ability"):
                add("enemy", a.get(f), b.get(f))
    # 통합전략 조우 분기 — choiceScenes(씬 제목·본문) + choices(선택지 제목·결과·잠금 사유).
    # 이름·설명만 담고 분기 전문은 빠져 있던 자리다 (사용자 지적 2026-09-17). IS1~5 는
    # 한섭에 나와 공식 한국어가 있고, id 가 CN 과 그대로 같아 짝이 바로 맞는다.
    # IS6 는 미실장이라 KR 표에 없어 자동으로 빠진다.
    # 통합전략 조우 분기 — **테마별 파일에 들어간다** (is1~is6). 갈래는 encounters.
    c, k = both("roguelike_topic_table")
    if c:
        kd = k.get("details") or {}
        for theme, a2 in (c.get("details") or {}).items():
            b2 = kd.get(theme)
            if not isinstance(b2, dict):
                continue
            m = re.fullmatch(r"rogue_(\d+)", theme)
            if not m:
                continue
            slot = f"is{m.group(1)}"
            out.setdefault(slot, {})
            for coll, fields in (("choiceScenes", ("title", "description")),
                                 ("choices", ("title", "description", "lockedCoverDesc"))):
                kc = b2.get(coll) or {}
                for cid, ea in (a2.get(coll) or {}).items():
                    eb = kc.get(cid)
                    if not isinstance(ea, dict) or not isinstance(eb, dict):
                        continue
                    for f in fields:
                        add(slot, ea.get(f), eb.get(f))

    # 보이스 대사 — 자막으로 화면에 뜨므로 OCR 대상이다. 기록(핸드북 산문)은 9MB 라
    # 분량 대비 실익이 얇아 뺐다 (사용자 판단 2026-09-17). 필요해지면 같은 방식으로 얹는다.
    c, k = both("charword_table")
    if c:
        kd = k.get("charWords") or {}
        for wid, a in (c.get("charWords") or {}).items():
            b = kd.get(wid)
            if not isinstance(b, dict): continue
            for f in ("voiceTitle", "voiceText"):
                add("op", a.get(f), b.get(f))

    c, k = both("stage_table")
    if c:
        kd = k.get("stages") or {}
        for sid, a in (c.get("stages") or {}).items():
            b = kd.get(sid)
            if not isinstance(b, dict):
                continue
            for f in ("name", "description"):
                add("stage", a.get(f), b.get(f))
    return out



def official_any():
    """공식 한국어가 **실재하는** 중국어 원문 전부 — 내보내지 않는 갈래까지 포함한다.
    비공식 번역을 걷어낼 때 이걸 기준으로 삼는다. 공식이 있는데 AI 번역을 같이 내보내면
    받는 쪽에 둘 중 하나를 고르게 시키는 꼴이고, 그 자리는 공식이 옳다."""
    out = set()
    tag = re.compile(r"<[^>]+>")
    def mark(x, y):
        x = tag.sub("", x).strip() if isinstance(x, str) else ""
        y = tag.sub("", y).strip() if isinstance(y, str) else ""
        if x and y and x != y and CJK.search(x) and not CJK.search(y):
            out.add(x)
            for lx, ly in zip(x.split("\n"), y.split("\n")):
                lx, ly = lx.strip(), ly.strip()
                if lx and ly and CJK.search(lx) and not CJK.search(ly): out.add(lx)
    def both(n):
        c, k = _t(f"cn_{n}"), (_t(f"kr_{n}") or _t(n))
        return (c, k) if c and k else (None, None)
    c, k = both("character_table")
    if c:
        for cid, a in c.items():
            b = k.get(cid)
            if not isinstance(b, dict) or not isinstance(a, dict): continue
            for f in ("name", "appellation", "description", "itemUsage", "itemDesc", "itemObtainApproach"):
                mark(a.get(f), b.get(f))
            for pa, pb in zip(a.get("potentialRanks") or [], b.get("potentialRanks") or []):
                mark(pa.get("description"), pb.get("description"))
    c, k = both("handbook_info_table")
    if c:
        kd = k.get("handbookDict") or {}
        for hid, a in (c.get("handbookDict") or {}).items():
            b = kd.get(hid)
            if not isinstance(b, dict): continue
            for da, db in zip(a.get("storyTextAudio") or [], b.get("storyTextAudio") or []):
                for sa, sb in zip(da.get("stories") or [], db.get("stories") or []):
                    mark(sa.get("storyText"), sb.get("storyText"))
    c, k = both("building_data")
    if c:
        kb = k.get("buffs") or {}
        for bid, a in (c.get("buffs") or {}).items():
            b = kb.get(bid)
            if not isinstance(b, dict): continue
            for f in ("buffName", "description"):
                mark(a.get(f), b.get(f))
    return out


OFFICIAL = official_pairs()
OFF_LABEL = {
    "op":    "오퍼레이터 — 이름·직위·특성·재능·스킬·모듈 (한섭 공식 한국어)",
    "item":  "아이템·재료 — 이름·설명·용도 (한섭 공식 한국어)",
    "enemy": "적 — 이름·설명·능력 (한섭 공식 한국어)",
    "stage": "작전 — 이름·설명 (한섭 공식 한국어)",
}
OFF_ORDER = []
for tag in ("op", "item", "enemy", "stage", "is-enc"):
    if OFFICIAL.get(tag):
        name = f"kr-{tag}.json"
        files[name] = OFFICIAL[tag]
        labels[name] = OFF_LABEL[tag]
        OFF_ORDER.append(name)

# ── 갈래별로 합친다 ─────────────────────────────────────────────────────────
# 파일은 **내용 갈래**로만 가른다 (사용자 지시 2026-09-17 "오퍼랑 재료 두 파일만 나오면
# 되겠네"). 종전에는 축이 둘 섞여 있었다 — kr-* 는 갈래로, op-fut 은 공식/비공식으로
# 갈라서, 같은 갈래가 두 군데에 다른 이름으로 앉아 있었고 op-fut 하나에 여덟 갈래가
# 뒤섞여 있었다 (실측: 기록 847 · 보이스 556 · 아이템 213 · 오퍼 159 …).
#
# 공식/비공식은 파일이 아니라 **항목에 표시**한다 — 비공식일 때만 `"x": 1`.
# 같은 원문에 둘 다 있으면 **공식이 이긴다** (공식이 있는 자리는 공식이 옳다).
KIND_LABEL = {
    # ⚠ **보이스·기록은 op 에 합친다** (사용자 지적 2026-09-17). 셋을 갈라 두면 받는 쪽이
    #   필요 없는 걸 안 받을 수 있다고 봤는데 실제로는 이점이 없었다 — 신규 오퍼 하나가
    #   character_table·charword_table·handbook_info_table 에 **동시에** 들어가서
    #   (실측: 미실장 19명 전원) 세 파일의 해시가 같이 바뀌고 결국 다 받게 된다.
    #   전량을 한두 달에 한 번 받는 것이라 용량 차이도 없다.
    "op":      "오퍼레이터 — 이름·특성·재능·스킬·모듈·기반시설·보이스 대사·기록",
    "item":    "아이템·재료 — 이름·설명·용도",
    "enemy":   "적 — 이름·설명·능력",
    "stage":   "작전 — 이름·설명",
    "ra":      "생존연산",
}
KIND_ORDER = ["op", "item", "enemy", "stage", "ra"]

# 비공식(장부에서 온 것)을 갈래로 흩는다 — 원문이 CN 게임데이터의 어느 표에서 왔는지로 판정
def _kind_index():
    idx, tag = {}, re.compile(r"<[^>]+>")
    def walk(o, kind):
        if isinstance(o, dict):
            for v in o.values(): walk(v, kind)
        elif isinstance(o, list):
            for v in o: walk(v, kind)
        elif isinstance(o, str) and CJK.search(o):
            t = tag.sub("", o).strip()
            if not t: return
            idx.setdefault(t, kind)
            for ln in t.split("\n"):
                ln = ln.strip()
                if ln: idx.setdefault(ln, kind)
    # 뒤에 오는 표가 먼저 온 표를 못 덮게 — 구체적인 갈래부터 넣는다
    for tbl, kind in (("charword_table", "op"), ("handbook_info_table", "op"),
                      ("item_table", "item"), ("enemy_handbook_table", "enemy"),
                      ("stage_table", "stage"), ("skill_table", "op"),
                      ("uniequip_table", "op"), ("building_data", "op"),
                      ("character_table", "op")):
        t2 = _t(f"cn_{tbl}")
        if t2: walk(t2, kind)
    return idx


KIND_OF = _kind_index()
merged = {k: {} for k in KIND_ORDER}
# ① 공식 먼저
for tag, body in OFFICIAL.items():
    dest = merged.setdefault(tag, {})
    for cn, e in body.items():
        dest[cn] = e
# ② 비공식 — 공식이 없는 자리에만
_unofficial_src = {"op-fut.json": None, "ra.json": "ra"}
_official_any = official_any() | {k for b in OFFICIAL.values() for k in b}
_pruned = 0
for fname, fixed in _unofficial_src.items():
    for cn, e in (files.get(fname) or {}).items():
        if cn in _official_any:
            _pruned += 1
            continue
        kind = fixed or KIND_OF.get(cn)
        if kind is None:
            kind = "op"          # 어느 표에도 없으면 오퍼 상세로 둔다 (대부분 스킬 문구다)
        merged.setdefault(kind, {})[cn] = {**e, "x": 1}
# ③ 통합전략 — **테마 1~6과 공통을 한 파일로 합친다** (사용자 지시 2026-09-17
#    "파일을 7개나 만들 필요가 없음"). 갈래 구조(collectibles/…)는 그대로 둔다.
#    테마가 달라 같은 원문의 번역이 갈리는 자리가 9건 있었는데 전부 표기 흔들림
#    ("성의를 표시한다"/"표한다")이라 먼저 온 것을 남긴다.
is_body = {}
for fname, body in list(files.items()):
    if not re.fullmatch(r"is\d\.json|is-common\.json", fname):
        continue
    off = OFFICIAL.get(fname[:-5]) or {}     # 그 테마의 공식 조우 분기 (평면)
    for g, inner in body.items():
        dest = is_body.setdefault(g, {})
        for cn, e in inner.items():
            if cn in dest:
                continue
            if cn in off:
                dest[cn] = off[cn]           # 공식이 있으면 공식이 이긴다
            elif cn in _official_any:
                _pruned += 1
            else:
                dest[cn] = {**e, "x": 1}
    # 비공식 쪽에 없던 공식 조우 분기는 encounters 갈래로 붙인다
    enc = is_body.setdefault("encounters", {})
    for cn, e in off.items():
        if not any(cn in g for g in is_body.values()):
            enc[cn] = e
if is_body:
    merged["is"] = {g: is_body[g] for g in IS_ORDER if is_body.get(g)}
    KIND_LABEL["is"] = "통합전략 1~6 — 소장품·노드·조우·엔딩·전투 (테마 구분 없이 한 벌)"
    if "is" not in KIND_ORDER: KIND_ORDER.append("is")
if _pruned:
    print(f"  공식이 있어 뺀 비공식 번역 {_pruned:,}건")

# 공개본에는 **한국어만** 싣는다 (사용자 지시 2026-09-17 "일본어랑 영어는 싹 지우자").
# 받는 쪽이 중섭 화면에 한국어를 덧씌우는 앱이라 en/ja 를 쓸 데가 없고, 용량만 는다.
# ⚠ scripts/cn-translations.json(장부)에는 그대로 둔다 — build-i18n.py 가 사이트의
#   EN/JA 판을 만들 때 그걸 쓴다. 여기서 빼는 것은 **내보내는 파일**뿐이다.
def _ko_only(body):
    out = {}
    for k, v in body.items():
        if isinstance(v, dict) and ("ko" in v or "x" in v):
            e = {"ko": v["ko"]} if v.get("ko") else {}
            if v.get("x"): e["x"] = 1
            if e: out[k] = e
        elif isinstance(v, dict):
            inner = _ko_only(v)
            if inner: out[k] = inner
    return out


for _k in list(merged):
    merged[_k] = _ko_only(merged[_k])

files, labels = {}, {}
for kind in KIND_ORDER:
    body = merged.get(kind)
    if not body: continue
    name = f"{kind}.json"
    files[name] = body
    lab = KIND_LABEL[kind]
    nx = sum(1 for v in body.values() if isinstance(v, dict) and v.get("x"))
    if nx and not kind.startswith("is"):
        lab += f" — 공식 한국어 {len(body)-nx:,} + 비공식 번역 {nx:,}" if nx < len(body) else " (비공식 번역)"
    labels[name] = lab

# ── 내보내기 ─────────────────────────────────────────────────────────────────
os.makedirs(OUT, exist_ok=True)
ORDER = [f"{k}.json" for k in KIND_ORDER if f"{k}.json" in files]
rows, counts, group_counts, changed = [], {}, {}, 0
for name in ORDER:
    body = files[name]
    path = os.path.join(OUT, name)
    # indent=1 — 사람이 열어 읽을 파일이다. gzip 을 타면 들여쓰기 비용은 거의 없다.
    raw = json.dumps(body, ensure_ascii=False, indent=1) + "\n"
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != raw:
        with open(path, "w", encoding="utf-8") as fp:
            fp.write(raw)
        changed += 1
    h = digest(body)
    # ⚠ manifest 에는 **받는 쪽이 실제로 쓸 것만** 싣는다 (사용자 지적 2026-09-17).
    #   file  로컬에 저장할 때의 이름표 — url 은 내용이 바뀌면 같이 바뀌므로 키로 못 쓴다
    #   url   바로 요청할 주소 (?v=<hash> 가 붙어 캐시가 옛 바이트를 못 돌려준다)
    #   label 받아 보기 전에 무엇인지 알려 준다 (고르는 화면을 만든다면 여기 쓴다)
    #   hash  바뀌었나 — 증분의 전부다
    #   항목 수(n)·갈래별 개수(groups)·합계(total)는 뺐다. 파일은 통째로 받으므로 미리
    #   알아야 정할 일이 없고, 받고 나면 세면 그만이며, 무결성은 hash 가 더 정확히 본다.
    row = {"file": name, "url": f"{BASE}/{name}?v={h}", "label": labels[name], "hash": h}
    # 아래 둘은 **콘솔 출력 전용**이다 — manifest 로는 나가지 않는다
    counts[name] = leaves(body)
    first = next(iter(body.values()), None)
    grouped = isinstance(first, dict) and not ({"ko", "en", "ja"} & set(first))
    group_counts[name] = {g: len(v) for g, v in body.items()} if grouped else None
    rows.append(row)

# 옛 조각 파일(c0000·op-000·is-relic-000 …)을 치운다 — 이제 안 쓴다
keep = {"manifest.json", "README.md", "readme.html"} | set(ORDER)
for name in os.listdir(OUT):
    if name not in keep:
        os.remove(os.path.join(OUT, name))

# base 도 두지 않는다 — 항목마다 완전한 url 이 있어서 주소를 조합할 사람이 없다
manifest = {"updated": time.strftime("%Y-%m-%d"), "files": rows}
with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fp:
    json.dump(manifest, fp, ensure_ascii=False, indent=1)
    fp.write("\n")

# ── 규격서를 읽을 수 있는 주소로도 낸다 ──────────────────────────────────────
# 브라우저는 마크다운을 **어떤 content-type 으로도 그려 주지 않는다** — text/markdown 이면
# 내려받고, text/plain 이면 서식 없는 맨 글자다 (2026-09-17 실측). 받는 쪽에 "주소 하나
# 누르면 읽을 수 있는 문서"를 주려면 HTML 을 같이 내는 수밖에 없다. README.md 가 정본이고
# 이건 그걸 그대로 옮긴 것이라, 손으로 고칠 일이 없다.
# 표의 숫자를 먼저 맞춘 뒤 HTML 을 굽는다 — 순서가 바뀌면 페이지만 옛 숫자로 남는다
update_readme_table(os.path.join(OUT, "README.md"), counts, ORDER)
write_html(os.path.join(OUT, "README.md"), os.path.join(OUT, "readme.html"))

size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith(".json"))
for r in rows:
    g = group_counts.get(r["file"])
    extra = ("   " + " · ".join(f"{k} {n}" for k, n in g.items())) if g else ""
    print(f"  {r['file']:16} {counts[r['file']]:6,}{extra}")
print(f"파일 {len(rows)}개 (이번에 바뀐 파일 {changed}개) · "
      f"{sum(counts.values()):,}항목 · {size/1024/1024:.1f}MB → public/tl/")
