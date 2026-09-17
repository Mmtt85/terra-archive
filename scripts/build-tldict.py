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

내는 것 (11개):
  manifest.json      파일 목록·해시·항목 수 + **바로 요청할 수 있는 URL**
  op-fut.json        미실장 오퍼·재료 — 중섭 패치마다 늘어난다
  op-past.json       한섭 출시로 공식 번역이 덮은 옛 장부 — 거의 안 바뀐다
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
op_fut, op_past = {}, {}
for cn, val in load("scripts/cn-translations.json").items():
    if cn.startswith("_") or not isinstance(val, dict):
        continue
    entry = {k: v for k, v in val.items() if k in ("ko", "en", "ja") and v}
    if not entry.get("ko") or entry["ko"] == cn:
        continue
    (op_fut if any(entry["ko"] in b for b in blobs) else op_past)[cn] = entry
files["op-fut.json"] = op_fut
labels["op-fut.json"] = "오퍼레이터·재료 — 아직 한국 서버에 없는 것"
files["op-past.json"] = op_past
# ⚠ 라벨을 "오퍼레이터·재료"로 달아 뒀다가 실측으로 틀린 것을 잡았다 (2026-09-17).
#   2,451건의 실제 구성은 CN 게임데이터 표와 대조해 보면 이렇다:
#     오퍼 기록(핸드북 산문) 1,090 · 보이스 대사 715 · 특성/재능 60 · 아이템 34
#     기반시설 21 · 모듈 21 · 스킬 16 · 지금 CN 데이터에도 없는 옛 원문 ~494
#   즉 **73%가 기록과 보이스**다. 실장된 오퍼의 스킬·모듈 설명은 여기 거의 없다 —
#   그건 한섭 공식 한국어가 덮어서 산출물에 남지 않았기 때문이다(그래서 past 로 갈렸다).
labels["op-past.json"] = "오퍼 기록·보이스 대사 중심 — 공식 한국어가 덮기 전의 옛 번역"

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

# ── 내보내기 ─────────────────────────────────────────────────────────────────
os.makedirs(OUT, exist_ok=True)
ORDER = ["op-fut.json", "op-past.json", "ra.json",
         *[f"{t}.json" for t, _ in ROGUE_FILES], "is-common.json"]
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
write_html(os.path.join(OUT, "README.md"), os.path.join(OUT, "readme.html"))

size = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith(".json"))
for r in rows:
    g = group_counts.get(r["file"])
    extra = ("   " + " · ".join(f"{k} {n}" for k, n in g.items())) if g else ""
    print(f"  {r['file']:16} {counts[r['file']]:6,}{extra}")
print(f"파일 {len(rows)}개 (이번에 바뀐 파일 {changed}개) · "
      f"{sum(counts.values()):,}항목 · {size/1024/1024:.1f}MB → public/tl/")
