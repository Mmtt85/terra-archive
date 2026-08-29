#!/usr/bin/env python3
"""Build public/story/script/<eventId>.json — 스토리 '전문 보기' (풀 스크립트 + 컷씬).

Usage:
  python3 scripts/build-story-scripts.py            # 요약이 있는 전 이벤트 (사이드+메인)
  python3 scripts/build-story-scripts.py act49side  # 한 이벤트만

- 대상: app/data/story-summaries.json 에 요약이 있는 이벤트 중 story_review_table 에
  에피소드 구성이 있는 것 (사이드 act*·1stact + 메인 main_0~16). rogue_N 은 원문이
  조각(월별 대화·엔딩)이라 제외 — UI 는 story-script-ids.json 에 있는 id 만 버튼을 띄운다.
- 산출물은 정적 JSON — JS 번들에 import 하지 말 것 (home 청크 폭증). UI 가 fetch 로 로드.
- 컷씬([Image(image=…)])은 public/story/cut/<name>.webp 재사용, 없는 것만 다운로드.
- 텍스트는 한국어 게임 원문 그대로 (EN/JA 로케일은 UI 에서 KO 전용 안내).

라인 스키마 (lines[]):
  {"n": 화자, "x": 대사}   | {"x": 지문/나레이션}      | {"st": 자막/스티커 텍스트}
  {"img": 컷씬 이름}        | {"loc": 장소 스탬프}       | {"opts": [선택지…]}
  {"br": "1;2"}            (직전 opts 의 값 참조 — 분기 시작 마커)
"""
import json, os, re, sys, urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAMEDATA = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master"
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn"
CACHE = os.path.join(REPO, ".gamedata", "story-cache")
OUT_DIR = os.path.join(REPO, "public", "story", "script")
CUT_DIR = os.path.join(REPO, "public", "story", "cut")

# 빌드 대상 언어 — main()이 설정. story txt는 언어별 폴더(kr/en/jp)에서 받고,
# 컷씬·스프라이트·storyTxt 경로는 언어 공용이라 KR 빌드 산출물을 그대로 재사용한다.
LANG = "kr"                                             # 레포 폴더명 (kr/en/jp)
NICKNAME = "박사"                                       # {@nickname} 플레이어 호칭 (언어별)
NICK = {"kr": "박사", "en": "Doctor", "jp": "ドクター"}
LOC = {"kr": "ko", "en": "en", "jp": "ja"}              # 레포 폴더 → 사이트 로케일


def fetch(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": "terra-archive-script/1.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read()
        return raw if binary else json.loads(raw.decode("utf-8"))


def fetch_txt_cached(path):
    """story txt 를 .gamedata/story-cache/ 에 언어별로 캐시하며 가져온다. 404 는 None."""
    prefix = "" if LANG == "kr" else f"{LANG}__"  # kr은 무접두(기존 캐시 호환)
    dest = os.path.join(CACHE, prefix + path.replace("/", "__") + ".txt")
    if os.path.exists(dest):
        return open(dest, encoding="utf-8").read()
    try:
        raw = fetch(f"{GAMEDATA}/{LANG}/gamedata/story/{path}.txt", binary=True)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    os.makedirs(CACHE, exist_ok=True)
    open(dest, "w", encoding="utf-8").write(raw.decode("utf-8"))
    return raw.decode("utf-8")


# 인라인 마크업 제거 — <p=2>·</>·<color=…>·<i> 류. {@nickname} 은 플레이어 호칭 '박사'.
MARKUP = re.compile(r"</?[@$a-zA-Z][^>]*>|</>")

def clean(s):
    s = re.sub(r"\{@nickname\}", NICKNAME, s, flags=re.I)  # 플레이어 호칭 (언어별: 박사/Doctor/ドクター)
    s = s.replace("{@nbs}", " ")          # 비개행 공백 토큰 → 일반 공백 (예: "Ave Mujica")
    s = re.sub(r"\{@[^}]*\}", "", s)        # 그 외 미처리 제어 토큰({@...}) 제거
    s = MARKUP.sub("", s)
    s = re.sub(r"[ \t]{2,}", " ", s)        # 토큰 제거로 생긴 이중 공백 정리
    s = s.replace("\\n", "\n").replace("\r", "")
    return s.strip()


RE_NAME = re.compile(r'\[name\s*=\s*"([^"]*)"[^\]]*\]\s*(.*)', re.I)
RE_MULTI = re.compile(r'\[multiline\([^)]*name\s*=\s*"([^"]*)"[^\]]*\]\s*(.*)', re.I)
RE_IMAGE = re.compile(r'\[image\s*\([^\]]*?image\s*=\s*"([^"]+)"', re.I)
RE_STICK = re.compile(r'\[(?:sticker|subtitle)\s*\([^\]]*?text\s*=\s*"([^"]*)"', re.I)
RE_DECIS = re.compile(r'\[decision\s*\([^\]]*?options\s*=\s*"([^"]*)"(?:[^\]]*?values\s*=\s*"([^"]*)")?', re.I)
RE_PRED = re.compile(r'\[predicate\s*\([^\]]*?references\s*=\s*"([^"]*)"', re.I)
RE_ANIM = re.compile(r'\[animtext\s*\([^\]]*\)\]\s*(.*)', re.I)

# ── VN 연출 트랙 (2026-08-25) ────────────────────────────────────────────────
# 종전엔 이 태그들을 전부 버렸다. 이제 **무대 상태**(배경·스탠딩·가림막)를 같이 뽑아
# '장면 모드'가 원작처럼 그릴 수 있게 한다. 자세한 규약은 build-story-vn.py 참고.
RE_BG = re.compile(r'\[background\s*\(([^)]*)\)', re.I)
RE_CHAR = re.compile(r'\[character\s*(?:\(([^)]*)\))?\s*\]', re.I)
RE_CHARSLOT = re.compile(r'\[charslot\s*\(([^)]*)\)', re.I)
RE_BLOCKER = re.compile(r'\[blocker\s*\(([^)]*)\)', re.I)
RE_SHAKE = re.compile(r'\[camerashake\s*\(', re.I)
# ⚠ 컷씬 내리기는 **괄호 없는 `[Image]` 로도 온다** (사용자 제보 2026-08-29, 10-9 작전 후).
# 종전 정규식이 괄호 있는 형태만 봐서 `[Image]` 를 통째로 흘렸고, 그러면 컷씬이 안 내려간 채
# 다음 [Image(image=…)] 가 나올 때까지 화면을 덮는다 — 10-9 작전 후는 60쪽부터 97쪽 동안
# 같은 컷씬(27_i22)이 깔려 있어 그 아래에서 배경이 세 번 바뀌는 게 하나도 안 보였다.
# KR 원문 1,900편 중 **664편**이 같은 상태였다 (놓친 해제 1,104건).
RE_IMG_ANY = re.compile(r'\[image\s*(?:\(([^)]*)\))?\s*\]', re.I)
_ATTR_S = lambda k, a: (re.search(k + r'\s*=\s*"([^"]*)"', a, re.I) or [None, None])[1] \
    if re.search(k + r'\s*=\s*"([^"]*)"', a, re.I) else None
def _attr_f(k, a, default=None):
    m = re.search(k + r"\s*=\s*(-?\d+(?:\.\d+)?)", a, re.I)
    return float(m.group(1)) if m else default

def sprite_ref(raw):
    """'char_002_amiya_1#6$1 ' → ['char_002_amiya_1-p1', 6]. 표정 없으면 1.

    #N = 표정 번호, **$N = 몸 변형 번호**. char_empty 는 빈 슬롯 표식으로 그대로 둔다
    — 슬롯 순번이 focus= 와 맞아야 하므로 지우면 안 된다.

    ⚠ $N 을 버리면 안 된다 (2026-08-25 사용자 제보 'Mon3tr 일러스트가 이상하다').
      미러의 파일 이름이 실제로 `<이름>#<표정>$<몸>` 이라, $N 을 떼면 그 인물 폴더에서
      아무거나(정렬상 첫 파일 = 표정1) 집어 오게 된다. 표정이 늘 1번으로 고정되고,
      Mon3tr 처럼 `#N$M` 이 **얼굴만 잘라 둔 파일**인 인물은 얼굴 클로즈업이 전신 자리에
      들어가 화면이 깨진다.
      파일 이름에 $ 를 그대로 쓰면 URL·키에서 성가시므로 `-p<N>` 으로 바꿔 싣는다."""
    name = raw.strip()
    body, _, part = name.partition("$")
    base, _, expr = body.partition("#")
    # ⚠ **소문자로 통일**한다 (사용자 제보 2026-08-25 '스프라이트 404').
    #   게임 대본이 같은 인물을 두 대소문자로 부르는 경우가 실재한다 — act15d0 안에
    #   char_214_Kafka_1 과 char_214_kafka_1 이 같이 나온다. 파일은 이름 하나로만
    #   저장되고 맥은 대소문자를 무시해 로컬에선 안 드러나지만, **R2 는 구분하므로**
    #   배포하면 한쪽 참조가 통째로 404 가 된다. 미러 색인도 이미 소문자로 찾으니
    #   여기서 눕혀 두면 이 부류가 아예 사라진다.
    base = base.strip().lower()
    try:
        n = int(expr.strip() or 1)
    except ValueError:
        n = 1
    part = part.strip()
    if base != "char_empty" and part.isdigit():
        base = f"{base}-p{part}"
    return [base, n]



def parse_story(txt, vn=None):
    """스크립트 원문 → 라인 배열. vn 리스트를 주면 **무대 상태 스냅샷**도 함께 채운다.

    스냅샷은 무대가 바뀐 채로 처음 그려지는 줄에만 찍힌다 (i = 그 줄의 인덱스):
      {"i": 12, "bg": "bg_park", "ch": [["char_010_chen_1", 3], …], "f": 2, "bk": "#000", "sh": 1}
      · ch = [스프라이트 base, 표정번호] 목록 (무대 왼→오른쪽 순, char_empty = 빈 슬롯)
      · f  = 포커스된 슬롯 (1-base, 0이면 없음)   · bk = 가림막 색   · sh = 화면 흔들림
    UI 는 "현재 줄 이하의 마지막 스냅샷"만 찾으면 되므로 상태 기계가 필요 없다.
    """
    last_img = None
    stage = {"bg": None, "cut": None, "ch": [], "f": 0, "bk": None, "sh": 0}
    snaps, last_key = {}, None

    class Lines(list):
        """append 를 가로채 '이 줄이 그려질 때의 무대'를 찍는다 — 호출부를 안 건드리려고
        리스트를 상속했다 (append 지점이 10곳 가까이 흩어져 있다)."""
        def append(self, item):
            nonlocal last_key
            key = json.dumps(stage, sort_keys=True, ensure_ascii=False)
            if key != last_key:
                snaps[len(self)] = {k: v for k, v in stage.items() if v}
                last_key = key
                stage["sh"] = 0          # 흔들림은 1회성 — 찍고 나면 끈다
            super().append(item)

    lines = Lines()
    for raw in txt.splitlines():
        line = raw.strip()
        if not line:
            continue
        if not line.startswith("["):
            x = clean(line)
            if x:
                lines.append({"x": x})
            continue
        m = RE_NAME.match(line)
        if m:
            x = clean(m.group(2))
            if x:
                lines.append({"n": clean(m.group(1)) or "???", "x": x})
            continue
        m = RE_MULTI.match(line)
        if m:
            x = clean(m.group(2))
            if x:
                # 같은 화자의 직전 대사에 이어붙인다 (multiline 은 한 말풍선의 연속)
                prev = lines[-1] if lines else None
                who = clean(m.group(1)) or "???"
                if prev and prev.get("n") == who:
                    prev["x"] += "\n" + x
                else:
                    lines.append({"n": who, "x": x})
            continue
        m = RE_IMAGE.match(line)
        if m:
            name = m.group(1)
            stage["cut"] = name          # 내릴 때까지 무대에 깔려 있다 (아래 RE_IMG_ANY 에서 해제)
            if name != last_img:
                lines.append({"img": name})
                last_img = name
            continue
        m = RE_STICK.match(line)
        if m:
            x = clean(m.group(1))
            if x:
                lines.append({"st": x})
            continue
        m = RE_DECIS.match(line)
        if m:
            opts = [clean(o) for o in m.group(1).split(";") if clean(o)]
            if opts:
                ln = {"opts": opts}
                # 분기(Predicate references)는 옵션 '순번'이 아니라 values 를 참조한다 (3;4 등)
                vals = [v.strip() for v in (m.group(2) or "").split(";") if v.strip()]
                if len(vals) == len(opts):
                    ln["vals"] = vals
                lines.append(ln)
            continue
        m = RE_PRED.match(line)
        if m:
            lines.append({"br": m.group(1)})
            continue
        m = RE_ANIM.match(line)
        if m:
            x = clean(m.group(1))
            if x:
                lines.append({"loc": x})
            continue
        # ── 무대 상태 (버리지 않고 vn 트랙으로) ──
        m = RE_BG.search(line)
        if m:
            img = _ATTR_S("image", m.group(1))
            if img:
                stage["bg"] = img
            continue
        m = RE_CHAR.search(line)
        if m:
            attrs = m.group(1) or ""
            names = RE_CHARNAME.findall(attrs)
            stage["ch"] = [sprite_ref(n) for n in names]
            stage["f"] = int(RE_FOCUS.search(attrs).group(1)) if RE_FOCUS.search(attrs) else 0
            continue
        m = RE_CHARSLOT.search(line)
        if m:
            # 슬롯 지정형 — l/m/r 자리에 하나씩 올린다 (act6d5 엔 없고 후기 이벤트에서 쓴다)
            attrs = m.group(1)
            names = RE_CHARNAME.findall(attrs)
            slot = (_ATTR_S("slot", attrs) or "m").lower()
            idx = {"l": 0, "m": 1, "r": 2}.get(slot, 1)
            ch = list(stage["ch"]) + [["char_empty", 1]] * max(0, idx + 1 - len(stage["ch"]))
            ch[idx] = sprite_ref(names[0]) if names else ["char_empty", 1]
            stage["ch"] = ch
            stage["f"] = int(RE_FOCUS.search(attrs).group(1)) if RE_FOCUS.search(attrs) else 0
            continue
        m = RE_BLOCKER.search(line)
        if m:
            a = _attr_f("a", m.group(1), 0.0) or 0.0
            if a >= 0.5:
                rgb = [int(max(0.0, min(1.0, _attr_f(c, m.group(1), 0.0) or 0.0)) * 255) for c in "rgb"]
                stage["bk"] = "#%02x%02x%02x" % tuple(rgb)
            else:
                stage["bk"] = None
            continue
        if RE_SHAKE.search(line):
            stage["sh"] = 1
            continue
        if RE_IMG_ANY.search(line) and not RE_IMAGE.match(line):
            stage["cut"] = None         # [Image(fadetime=0)] = 컷씬 내리기
            stage["bk"] = None
            last_img = None
            continue
        # 그 외 연출 태그는 전부 무시
    # 앞뒤 의미 없는 br 정리: opts 없이 나온 br(연출 분기)은 버린다
    out, seen_opts, remap = [], False, {}
    for i, ln in enumerate(lines):
        if "opts" in ln:
            seen_opts = True
        if "br" in ln and not seen_opts:
            continue
        remap[i] = len(out)
        out.append(ln)
    if vn is not None:
        # ⚠ 위에서 줄이 빠지면 인덱스가 밀린다 — 스냅샷을 살아남은 줄 기준으로 다시 매긴다.
        #   빠진 줄에 걸린 스냅샷은 그 다음 살아있는 줄로 옮긴다 (무대를 잃지 않게).
        alive = sorted(remap)
        merged = {}
        for i in sorted(snaps):
            j = remap.get(i)
            if j is None:
                nxt = next((k for k in alive if k > i), None)
                if nxt is None:
                    continue
                j = remap[nxt]
            merged[j] = {"i": j, **snaps[i]}   # 같은 줄에 겹치면 마지막 무대가 이긴다
        vn.extend(merged[k] for k in sorted(merged))
    return out


# CG 레이어 (`[cgitem(...)]`) — 컷씬 `[Image(image="X")]` 위에 얹히는 인물 파츠.
# 이걸 무시하면 **배경만** 남은 그림이 나온다 (사용자 제보 2026-07-25: "지와 이가 대화하는
# CG에서 배경만 출력됨"). 레이어 png는 avg/items/ 에 있고, layer 오름차순으로 겹친다.
RE_CGITEM = re.compile(r'\[cgitem\s*\(([^)]*)\)', re.I)
RE_ATTR_STR = lambda k: re.compile(k + r'\s*=\s*"([^"]*)"', re.I)
RE_ATTR_NUM = lambda k: re.compile(k + r'\s*=\s*(-?\d+(?:\.\d+)?)', re.I)

def scan_cg_layers(txt, layers):
    """컷씬 이름 → [{img, layer, pos, scale}] 수집. 위치·배율은 **등장 시점**(pfrom/sfrom)을
    쓴다 — 이후 tween은 느린 패럴랙스라 첫 구도가 그림의 정본에 가깝다."""
    cur = None
    for line in txt.splitlines():
        m = RE_IMAGE.match(line.strip())
        if m:
            cur = m.group(1)
            continue
        m = RE_CGITEM.search(line)
        if not m or not cur:
            continue
        a = m.group(1)
        name = RE_ATTR_STR("image").search(a)
        if not name:
            continue
        pos = RE_ATTR_STR("pfrom").search(a) or RE_ATTR_STR("pto").search(a)
        px, py = (0.0, 0.0)
        if pos:
            parts = pos.group(1).split(",")
            if len(parts) == 2:
                try: px, py = float(parts[0]), float(parts[1])
                except ValueError: pass
        sc = RE_ATTR_NUM("sfrom").search(a) or RE_ATTR_NUM("sto").search(a)
        lay = RE_ATTR_NUM("layer").search(a)
        entry = {"img": name.group(1), "layer": float(lay.group(1)) if lay else 0.0,
                 "pos": (px, py), "scale": float(sc.group(1)) if sc else 1.0}
        bucket = layers.setdefault(cur, [])
        if entry not in bucket:
            bucket.append(entry)


RE_CHARTAG = re.compile(r'\[[Cc]har(?:acter|slot)\s*\(([^)]*)\)', )
RE_CHARNAME = re.compile(r'name2?\s*=\s*"([^"]+)"')
RE_FOCUS = re.compile(r'focus\s*=\s*(\d)')

def scan_faces(txt, votes):
    """무대 위 스탠딩 스프라이트와 뒤따르는 화자를 짝지어 votes[화자][스프라이트] 집계.
    focus= 속성이 있으면 포커스된 스프라이트에만 투표 (오퍼가 아닌 NPC 얼굴 연결용)."""
    active = []
    for line in txt.splitlines():
        m = RE_CHARTAG.search(line)
        if m:
            attrs = m.group(1)
            names = [n.split("#")[0] for n in RE_CHARNAME.findall(attrs)]
            f = RE_FOCUS.search(attrs)
            if f and names:
                i = int(f.group(1)) - 1
                active = [names[i]] if 0 <= i < len(names) else names
            else:
                active = names
            continue
        m = RE_NAME.match(line.strip())
        if m and active:
            who = clean(m.group(1))
            for spr in active:
                votes[who][spr] += 1


# 안내방송·시스템 음성 등 실체 없는 화자 — 무대 위 스프라이트를 물려받아 얼굴이 오귀속되므로
# 배정에서 제외 (예: '수송차 안내 방송'이 옆에 선 워미 얼굴로 붙던 버그, 사용자 리포트 2026-07-20).
ANNOUNCE_RE = re.compile(r"(방송|안내음|알림음|스피커|자동\s*음성|시스템\s*음성|아나운스)")
# 실체 없는 '목소리' 화자 — 정체를 감추려고 붙인 서술형 이름이라 무대 위 스프라이트를 물려받으면
# 엉뚱한 인물 얼굴이 붙는다 (사용자 제보 2026-07-25: '쉬어버린 목소리'가 아미야로,
# '망연자실한 목소리'가 몬삼터로, '중후한 남성의 목소리'가 기업 직원으로 뜨던 건).
VOICE_RE = re.compile(r"(목소리|비명|외침|함성|음성|울음|웃음|중얼거림|속삭임|소리)")

# 스프라이트 base → 오퍼레이터 이름 (avg_1037_amiya3_1 → char_1037_amiya3 → 아미야).
# 스탠딩이 오퍼레이터 것이면 그 오퍼가 곧 주인이라, 본인이 화자로 등장하면 무조건 본인에게 준다.
_OPS_JSON = json.load(open(os.path.join(REPO, "app", "data", "operators.json"), encoding="utf-8"))
OP_NAME_BY_ID = {o["id"]: o["name"] for o in _OPS_JSON}

def sprite_op_name(spr):
    s = re.sub(r"_\d+$", "", spr)
    s = re.sub(r"_na$", "", s)
    for cand in (("char_" + s[4:]) if s.startswith("avg_") else None, s if s.startswith("char_") else None):
        if cand and cand in OP_NAME_BY_ID:
            return OP_NAME_BY_ID[cand]
    return None

def resolve_faces(votes):
    """화자 ↔ 스탠딩을 **1:1**로 배정한다 (전수조사 후 전면 교체, 2026-07-25).

    종전에는 화자별 다수결만 봤다 — 무대에 선 스프라이트는 '지금 말하는 사람'이 아니라 그냥
    무대 상태라, 같은 장면에서 말한 단역·익명 화자가 옆에 선 주역의 스탠딩을 그대로 물려받았다
    (전수조사: 오퍼 스탠딩 오귀속 434건, 한 스프라이트를 여러 화자가 공유 448건).
    새 규칙:
      ① 서술형 화자(목소리·비명·방송·'???')는 아예 얼굴을 주지 않는다.
      ② 스프라이트마다 **주인 한 명**만 둔다 — 최다 득표자, 동률이면 아무에게도 주지 않는다.
         단 오퍼레이터 스탠딩은 그 오퍼 본인이 화자 목록에 있으면 **무조건 본인** 것.
      ③ 화자는 자기가 주인인 스프라이트 중 다수결(2표 이상·과반) 조건을 만족하는 것만 갖는다.
    """
    def skip(who):
        return (not who) or who.startswith("?") or ANNOUNCE_RE.search(who) or VOICE_RE.search(who)

    by_spr = {}
    for who, cnt in votes.items():
        if skip(who):
            continue
        for spr, n in cnt.items():
            by_spr.setdefault(spr, Counter())[who] += n

    owner = {}
    for spr, cnt in by_spr.items():
        oname = sprite_op_name(spr)
        mine = [w for w in cnt if oname and w.strip("'\"‘’“”") == oname]
        if mine:
            owner[spr] = mine[0]
            continue
        top = cnt.most_common(2)
        if len(top) > 1 and top[0][1] == top[1][1]:
            continue  # 동률 — 누구 얼굴인지 알 수 없으므로 배정하지 않는다
        owner[spr] = top[0][0]

    faces = {}
    for who, cnt in votes.items():
        if skip(who):
            continue
        total = sum(cnt.values())
        for spr, n in cnt.most_common():
            if owner.get(spr) != who:
                continue
            if n >= 2 and n * 2 > total:
                faces[who] = spr
            break
    return faces


def download_sprites(names):
    """스탠딩 스프라이트(기본 표정 #1$1) → public/story/char/<base>.webp. 실패분 반환."""
    from imgutil import save_webp
    char_dir = os.path.join(REPO, "public", "story", "char")
    os.makedirs(char_dir, exist_ok=True)
    missing = [n for n in names if not os.path.exists(os.path.join(char_dir, f"{n}.webp"))]
    failed = []

    def dl(base):
        for variant in (f"{base}#1$1", f"{base}#1", base):
            url = f"{ASSETS}/avg/characters/{base}/{urllib.request.quote(variant)}.png"
            try:
                png = fetch(url, binary=True)
            except urllib.error.HTTPError:
                continue
            save_webp(png, os.path.join(char_dir, f"{base}.webp"), max_px=640)
            return
        failed.append(base)

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(dl, missing))
    return failed


def build_event(eid, entry):
    infos = sorted(entry["infoUnlockDatas"], key=lambda i: i["storySort"])
    eps, images = [], []
    votes = defaultdict(Counter)
    cg_layers = {}   # 컷씬 이름 → 인물 파츠 레이어 (배경만 나오는 CG 방지)
    txts = {}
    with ThreadPoolExecutor(8) as ex:
        for info, txt in zip(infos, ex.map(lambda i: fetch_txt_cached(i["storyTxt"]), infos)):
            txts[info["storyId"]] = txt
    for info in infos:
        txt = txts.get(info["storyId"])
        if not txt:
            continue
        vn = []
        lines = parse_story(txt, vn)
        if not lines:
            continue
        scan_faces(txt, votes)
        scan_cg_layers(txt, cg_layers)
        for ln in lines:
            if "img" in ln and ln["img"] not in images:
                images.append(ln["img"])
        eps.append({
            "code": info.get("storyCode") or "",
            "name": info.get("storyName") or "",
            "tag": info.get("avgTag") or "",
            "lines": lines,
            # 무대 연출 트랙 — '장면 모드'가 쓴다. 배경·스탠딩이 하나도 없으면 싣지 않는다
            # (옛 이벤트엔 연출 태그가 거의 없어 빈 배열이 파일만 키운다).
            **({"vn": vn} if any(v.get("bg") or v.get("ch") for v in vn) else {}),
        })
    # 화자 → 스탠딩 스프라이트 얼굴 (오퍼가 아닌 인물도 썸네일 연결, 사용자 요청 2026-07-18)
    faces = resolve_faces(votes)
    failed = download_sprites(sorted(set(faces.values())))
    if failed:
        bad = set(failed)
        faces = {w: s for w, s in faces.items() if s not in bad}
    return eps, images, faces, cg_layers


def actual_case_map(directory):
    """실제 파일명(확장자 제외)을 소문자 키로 매핑. macOS는 대소문자 무시 FS라
    참조가 20_I06이어도 20_i06.webp를 '있다'고 판정해 그대로 통과하는데, 배포처
    (Cloudflare Pages)는 케이스를 구별해 404가 난다 (실측 28건, 2026-07-21) —
    JSON에 싣는 참조를 항상 디스크의 실제 케이스로 정규화한다."""
    return {f[:-5].lower(): f[:-5] for f in os.listdir(directory) if f.endswith(".webp")}


def normalize_case(eps, faces):
    """eps의 컷씬 참조·faces의 스탠딩 참조를 디스크 실제 파일명 케이스로 교정."""
    cut_case = actual_case_map(CUT_DIR)
    char_dir = os.path.join(REPO, "public", "story", "char")
    char_case = actual_case_map(char_dir) if os.path.isdir(char_dir) else {}
    for ep in eps:
        for ln in ep["lines"]:
            if "img" in ln:
                ln["img"] = cut_case.get(ln["img"].lower(), ln["img"])
    return {w: char_case.get(s.lower(), s) for w, s in (faces or {}).items()}


def fetch_cut_png(name):
    """컷씬/레이어 원본 png — 대문자 참조(21_I1)는 소문자로도 재시도. 없으면 None."""
    for cand in dict.fromkeys([name, name.lower()]):
        try:
            return fetch(f"{ASSETS}/avg/images/{cand}.png", binary=True)
        except urllib.error.HTTPError:
            continue
    for cand in dict.fromkeys([name, name.lower()]):
        try:
            return fetch(f"{ASSETS}/avg/items/{cand}.png", binary=True)
        except urllib.error.HTTPError:
            continue
    return None


def composite_cg(base_png, layers):
    """배경 CG 위에 인물 파츠(cgitem)를 layer 오름차순으로 얹어 한 장으로 만든다.
    좌표는 화면 중앙 기준 오프셋(y는 위가 +), 배율은 등장 시점 값. 파츠를 못 받으면 건너뛴다."""
    from io import BytesIO
    from PIL import Image
    base = Image.open(BytesIO(base_png)).convert("RGBA")
    W, H = base.size
    for spec in sorted(layers, key=lambda d: d["layer"]):
        png = fetch_cut_png(spec["img"])
        if not png:
            continue
        im = Image.open(BytesIO(png)).convert("RGBA")
        scale = spec.get("scale") or 1.0
        if scale != 1.0:
            im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
        px, py = spec.get("pos") or (0, 0)
        base.paste(im, ((W - im.width) // 2 + int(px), (H - im.height) // 2 - int(py)), im)
    out = BytesIO()
    base.convert("RGB").save(out, format="PNG")
    return out.getvalue()


def download_cuts(names, cg_layers=None):
    """컷씬 webp — 이미 있으면 스킵. 404(에셋 미러 누락)는 건너뛰고 목록 반환.
    cgitem 레이어가 있는 컷씬은 **항상 다시 합성**한다 (배경만 저장된 구버전 교체)."""
    from imgutil import save_webp
    cg_layers = cg_layers or {}
    os.makedirs(CUT_DIR, exist_ok=True)
    missing = [n for n in names
               if n in cg_layers or not os.path.exists(os.path.join(CUT_DIR, f"{n}.webp"))]
    failed = []

    def dl(name):
        png = fetch_cut_png(name)
        if png is None:
            failed.append(name)
            return
        if cg_layers.get(name):
            try:
                png = composite_cg(png, cg_layers[name])
            except Exception as exc:   # 합성 실패는 배경만이라도 살린다
                print(f"  ! CG 합성 실패 {name}: {exc}")
        save_webp(png, os.path.join(CUT_DIR, f"{name}.webp"), photo=True, max_px=1080)

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(dl, missing))
    return failed


# ── CN 선행(미실장) 이벤트: 원문 파싱 → AI 번역 → 병합 ─────────────────────────
# python3 scripts/build-story-scripts.py --cn act51side       # CN 파싱 → scripts/story-cn/<id>/
# (AI가 scripts/story-cn/<id>/ko/ep_NN.json 에 번역을 채운다 — 구조 보존)
# python3 scripts/build-story-scripts.py --cn-merge act51side # 검증·병합 → public/story/script/

def cn_prepare(eid):
    review = fetch(f"{GAMEDATA}/cn/gamedata/excel/story_review_table.json")
    entry = review.get(eid) or sys.exit(f"CN 리뷰 테이블에 없음: {eid}")
    base = os.path.join(REPO, "scripts", "story-cn", eid)
    os.makedirs(os.path.join(base, "ko"), exist_ok=True)
    infos = sorted(entry["infoUnlockDatas"], key=lambda i: i["storySort"])
    meta, images, speakers = [], [], {}
    for idx, info in enumerate(infos):
        # CN 브랜치 txt — 캐시 키가 KR과 겹치지 않게 접두
        dest = os.path.join(CACHE, "cn__" + info["storyTxt"].replace("/", "__") + ".txt")
        if os.path.exists(dest):
            txt = open(dest, encoding="utf-8").read()
        else:
            txt = fetch(f"{GAMEDATA}/cn/gamedata/story/{info['storyTxt']}.txt", binary=True).decode("utf-8")
            os.makedirs(CACHE, exist_ok=True)
            open(dest, "w", encoding="utf-8").write(txt)
        lines = parse_story(txt)
        for ln in lines:
            if "img" in ln and ln["img"] not in images:
                images.append(ln["img"])
            if "n" in ln:
                speakers[ln["n"]] = speakers.get(ln["n"], 0) + 1
        ep = {"idx": idx, "code": info.get("storyCode") or "", "name": info.get("storyName") or "",
              "tag": info.get("avgTag") or "", "lines": lines}
        json.dump(ep, open(os.path.join(base, f"ep_{idx:02d}.json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        meta.append({"idx": idx, "code": ep["code"], "name": ep["name"], "tag": ep["tag"], "nlines": len(lines)})
    json.dump({"id": eid, "eps": meta}, open(os.path.join(base, "meta.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    # 화자 목록 (빈도순) — AI가 speakers.json(CN→KR 통일 표기)을 만들 때 참고
    json.dump(dict(sorted(speakers.items(), key=lambda x: -x[1])),
              open(os.path.join(base, "speakers-raw.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    failed = download_cuts(images)
    print(f"{eid}: {len(meta)}편 파싱 → {base}/ep_*.json · 화자 {len(speakers)}종 · 컷 {len(images)}장"
          + (f" (누락 {failed})" if failed else ""))


def cn_merge(eid):
    import re as _re
    base = os.path.join(REPO, "scripts", "story-cn", eid)
    meta = json.load(open(os.path.join(base, "meta.json"), encoding="utf-8"))
    hanzi = _re.compile(r"[一-鿿]")
    eps, bad = [], []
    for m in meta["eps"]:
        src = json.load(open(os.path.join(base, f"ep_{m['idx']:02d}.json"), encoding="utf-8"))
        ko_path = os.path.join(base, "ko", f"ep_{m['idx']:02d}.json")
        if not os.path.exists(ko_path):
            bad.append((m["idx"], "번역 파일 없음")); continue
        ko = json.load(open(ko_path, encoding="utf-8"))
        errs = []
        if len(ko.get("lines", [])) != len(src["lines"]):
            errs.append(f"라인 수 {len(src['lines'])}→{len(ko.get('lines', []))}")
        else:
            for i, (a, b) in enumerate(zip(src["lines"], ko["lines"])):
                if set(a.keys()) - {"vals"} != set(b.keys()) - {"vals"}:
                    errs.append(f"L{i} 키 불일치 {sorted(a)}→{sorted(b)}"); break
                if a.get("img") != b.get("img") or a.get("br") != b.get("br"):
                    errs.append(f"L{i} img/br 변조"); break
            nhan = sum(1 for b in ko["lines"] for v in (b.get("n"), b.get("x"), b.get("st"), b.get("loc"))
                       if isinstance(v, str) and hanzi.search(v))
            if nhan > 0:
                errs.append(f"중국어 잔존 {nhan}줄")
        if errs:
            bad.append((m["idx"], "; ".join(errs))); continue
        eps.append({"code": ko.get("code") or m["code"], "name": ko.get("name") or m["name"],
                    "tag": ko.get("tag") or m["tag"], "lines": ko["lines"]})
    if bad:
        for idx, msg in bad:
            print(f"  ✗ ep_{idx:02d}: {msg}")
        sys.exit(f"{eid}: {len(bad)}편 불량 — 병합 중단")
    out = {"id": eid, "tr": "cn", "eps": eps}
    dest = os.path.join(OUT_DIR, f"{eid}.json")
    json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    ids_path = os.path.join(REPO, "app", "data", "story-script-ids.json")
    ids = set(json.load(open(ids_path, encoding="utf-8")))
    ids.add(eid)
    json.dump(sorted(ids), open(ids_path, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{eid}: {len(eps)}편 병합 → {dest} ({os.path.getsize(dest)//1024}KB) · ids 갱신")


def main():
    global LANG, NICKNAME
    args = sys.argv[1:]
    if args and args[0] == "--cn":
        cn_prepare(args[1]); return
    if args and args[0] == "--cn-merge":
        cn_merge(args[1]); return
    # --lang en|ja (또는 kr) — story txt 언어. 기본 kr. EN/JA는 KR 요약이 있는 이벤트 중
    # 해당 서버에 이미 풀린 것만 생성(리뷰 테이블에 없으면 스킵 — UI가 KR로 폴백).
    if args and args[0] == "--lang":
        LANG = {"ko": "kr", "en": "en", "ja": "jp"}.get(args[1], args[1]); args = args[2:]
    NICKNAME = NICK[LANG]
    site_loc = LOC[LANG]
    only = args[0] if args else None
    summaries = json.load(open(os.path.join(REPO, "app", "data", "story-summaries.json"), encoding="utf-8"))
    review = fetch(f"{GAMEDATA}/{LANG}/gamedata/excel/story_review_table.json")
    out_dir = OUT_DIR if LANG == "kr" else os.path.join(OUT_DIR, site_loc)
    os.makedirs(out_dir, exist_ok=True)

    ids, total_kb, all_failed = [], 0, []
    # 요약이 있는 이벤트 + 미니 이벤트(스토리 컬렉션) 전부 전문 생성 — 미니는 요약이 없어도
    # 전문부터 공개한다(사용자 확정 2026-07-20). KR 스크립트가 없는 미니는 build_event가 빈
    # eps를 돌려주므로 자동 스킵된다.
    mini_ids = {eid for eid, v in review.items() if v.get("actType") == "MINI_STORY"}
    targets = [only] if only else sorted(set(summaries.keys()) | mini_ids)
    for eid in targets:
        entry = review.get(eid)
        if not entry:  # rogue_N 등 리뷰 테이블에 없는 합성 이벤트
            continue
        eps, images, faces, cg_layers = build_event(eid, entry)
        if not eps:
            continue
        failed = download_cuts(images, cg_layers)
        all_failed += failed
        # 다운로드 실패(미러 누락) 컷씬 마커는 빼서 UI 깨짐 방지
        if failed:
            bad = set(failed)
            for ep in eps:
                ep["lines"] = [ln for ln in ep["lines"] if ln.get("img") not in bad]
        faces = normalize_case(eps, faces)
        out = {"id": eid, "eps": eps, "faces": faces}
        dest = os.path.join(out_dir, f"{eid}.json")
        json.dump(out, open(dest, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        kb = os.path.getsize(dest) // 1024
        total_kb += kb
        ids.append(eid)
        nlines = sum(len(e["lines"]) for e in eps)
        print(f"{eid}: {len(eps)}편 {nlines}라인 {len(images)}컷 → {kb}KB" + (f" (컷 누락 {len(failed)})" if failed else ""))

    if not only:
        ids_name = "story-script-ids.json" if LANG == "kr" else f"story-script-ids.{site_loc}.json"
        json.dump(sorted(ids), open(os.path.join(REPO, "app", "data", ids_name), "w", encoding="utf-8"),
                  ensure_ascii=False)
        sub = "" if LANG == "kr" else f"{site_loc}/"
        print(f"\n합계 {len(ids)}이벤트 {total_kb/1024:.1f}MB → public/story/script/{sub} · ids → app/data/{ids_name}")
    if all_failed:
        print("미러에 없는 컷씬:", sorted(set(all_failed)))


if __name__ == "__main__":
    main()
