#!/usr/bin/env python3
"""이벤트 부가 기록(미니게임·수집 요소로 풀리는 읽을거리) → app/data/eventlore*.json

사용자 제보(2026-08-22): "중생의 여정에서 미니게임으로 등장인물 과거사를 해금하는 글이
있었는데 아카이브 가능한가요. 다른 한정 이벤트에도 있었던 것 같은데 같이."

이벤트 본편 스토리(story_review_table)와 달리, 이런 글은 **activity_table 안에** 흩어져
있다 — 의뢰서·신문 기사·편지·오페라 평론·탐색 조우문 등. 이벤트마다 자료 구조가 완전히
달라서 이벤트별 추출기를 따로 둔다(EXTRACT). 세 로케일 모두 같은 키 구조라 한 파일에서
ko/en/ja를 한 번에 낸다 (build-i18n.py 불필요 — build-autochess.py와 같은 규약).

⚠ **읽을거리만 싣는다.** 카드 조합 레시피(태양을 뿌리쳐라), 스테이지 기믹 설명(폴리비전
박물관), 토큰 능력(테라밥) 같은 순수 기능 텍스트는 제보 취지(서사)와 달라 뺐다.

사용: python3 scripts/build-eventlore.py
입력: .gamedata/{kr,en,jp}_activity_table.json  (scripts/fetch-gamedata.py로 받는다)
"""
import json, os, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(REPO, ".gamedata")
DATA = os.path.join(REPO, "app", "data")
PUB = os.path.join(REPO, "public", "lore")
ASSETS = "https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn/ui"
NO_ICONS = "--no-icons" in sys.argv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from imgutil import save_webp  # noqa: E402

PREFIX = {"ko": "kr", "en": "en", "ja": "jp"}
SUFFIX = {"ko": "", "en": ".en", "ja": ".ja"}


# ── 게임 마크업 정리 ──────────────────────────────────────────────────────────
# build-autochess.py와 같은 규칙: 강조는 **굵게**(화면의 rich()가 <b>로), 나머지는 제거.
# ⚠ 태그를 통째로 지우면 안 된다 — 본문에 <장소 효과>·<폐허>처럼 **홑화살괄호로 감싼 말**이
#   흔하다. @ / $ / color 로 시작하는 것만 태그로 본다.
EMPH_RE = re.compile(r"<@[^>]*>(.*?)</>", re.S)
DROP_RE = re.compile(r"<@[^>]*>|<\$[^>]*>|</?color[^>]*>|</>")


def rich(s):
    if not s:
        return ""
    s = str(s).replace("\r\n", "\n").replace("\\n", "\n")
    s = re.sub(r"</?color[^>]*>", "", s)
    prev = None
    while prev != s:
        prev = s
        s = EMPH_RE.sub(lambda m: f"**{m.group(1)}**" if m.group(1).strip() else "", s)
    s = DROP_RE.sub("", s)
    s = re.sub(r"\*\*\s*\*\*", "", s)
    s = re.sub(r"[ \t]+\n", "\n", s)
    return re.sub(r"\n{3,}", "\n\n", s).strip()


def V(x):
    """dict든 list든 값 목록으로."""
    if isinstance(x, list):
        return x
    if isinstance(x, dict):
        return list(x.values())
    return []


def item(t="", d="", by="", d2="", tag="", img="", face=""):
    """img = 항목 그림(가로로 크게), face = 화자·인물 얼굴(작은 원판)."""
    o = {}
    for k, v in (("t", t), ("by", by), ("tag", tag), ("d", d), ("d2", d2)):
        v = rich(v)
        if v:
            o[k] = v
    for k, v in (("img", img), ("face", face)):
        if v:
            o[k] = v
    return o if o.get("d") or o.get("d2") or o.get("t") else None


def sec(name, items):
    items = [i for i in items if i]
    return {"n": name, "items": items} if items else None


def joinlist(lines):
    return "\n\n".join(rich(x) for x in (lines or []) if isinstance(x, str) and x.strip())


# ── 이벤트별 추출기 ───────────────────────────────────────────────────────────
# 각 함수는 (활동 블록, 섹션이름 3로케일 사전, 로케일) → 섹션 목록.
# 섹션 이름은 데이터에 없으므로 여기서 3로케일로 붙인다.
N = lambda ko, en, ja: {"ko": ko, "en": en, "ja": ja}

SEC = {
    "task":     N("의뢰", "Commissions", "依頼"),
    "gun":      N("총기", "Firearms", "銃器"),
    "news":     N("신문 기사", "Newspaper", "新聞記事"),
    "encounter": N("조우", "Encounters", "遭遇"),
    "choice":   N("선택", "Choices", "選択"),
    "treasure": N("탐색", "Finds", "探索"),
    "tech":     N("장비", "Gear", "装備"),
    "landmark": N("이정표", "Landmarks", "道標"),
    "zone":     N("구역", "Zones", "区域"),
    "dialog":   N("대사", "Dialogue", "セリフ"),
    "customer": N("손님", "Customers", "客"),
    "trait":    N("손님 특성", "Customer traits", "客の特性"),
    "keeper":   N("점주 대사", "Owner's lines", "店主のセリフ"),
    "meal":     N("식사", "Meals", "食事"),
    "mail":     N("편지", "Letters", "手紙"),
    "photo":    N("사진", "Photos", "写真"),
    "product":  N("제품군", "Product lines", "製品ライン"),
    "opera":    N("오페라", "Operas", "オペラ"),
    "review":   N("오페라 평론", "Opera reviews", "オペラ評論"),
    "squad":    N("소대", "Squads", "小隊"),
    "event":    N("사건", "Incidents", "事件"),
    "target":   N("목표", "Objectives", "目標"),
    "plot":     N("지형", "Terrain", "地形"),
    "band":     N("출연진", "The Line-up", "出演者"),
}
RESULT = {
    "FAIL": N("실패", "Failure", "失敗"),
    "GOOD": N("성공", "Success", "成功"),
    "EXCELLENT": N("완벽", "Perfect", "完璧"),
}


def ex_act42side(d, loc):
    tasks = sorted(V(d.get("taskData")), key=lambda x: x.get("sortId") or 0)
    guns = V(d.get("gunData"))
    face = {t.get("trustorId"): t.get("trustorIconLarge") for t in V(d.get("trustorData"))}
    P = "/lore/act42side"
    return [
        # 물건 그림 = 그 기억을 불러온 물건이다 (afterTaskItemIcon) — 글과 짝이라 같이 싣는다
        sec(SEC["task"][loc], [item(t=x.get("taskName"), by=x.get("trustorName"),
                                    d=x.get("taskContent"), d2=x.get("afterTaskContent"),
                                    img=f"{P}/item_{x['afterTaskItemIcon']}.webp" if x.get("afterTaskItemIcon") else "",
                                    face=f"{P}/face_{face[x['trustorId']]}.webp" if face.get(x.get("trustorId")) else "")
                               for x in tasks]),
        sec(SEC["gun"][loc], [item(t=x.get("gunName"), by=x.get("trustorName"), d=x.get("gunContent"),
                                   img=f"{P}/gun_{x['gunColorIcon']}.webp" if x.get("gunColorIcon") else "")
                              for x in guns]),
    ]


def ex_act13d5(d, loc):
    news = sorted(V(d.get("newsInfoList")), key=lambda x: x.get("newsSortId") or 0)
    out = []
    for x in news:
        body = [ln.get("content") for ln in (x.get("newsLines") or [])
                if ln.get("lineType") == "TextContent"]
        out.append(item(t=x.get("newsTitle"), by=(x.get("styleInfo") or {}).get("typeName"),
                        tag=x.get("newsFrom"), d=x.get("newsText"), d2=joinlist(body)))
    return [sec(SEC["news"][loc], out)]


def ex_act17side(d, loc):
    return [
        sec(SEC["encounter"][loc], [item(t=x.get("eventTitle"), d=joinlist(x.get("eventDesList")))
                                    for x in V(d.get("eventDataMap"))]),
        sec(SEC["choice"][loc], [item(t=x.get("choiceName"), d=joinlist(x.get("choiceDesList")))
                                 for x in V(d.get("choiceNodeDataMap"))]),
        sec(SEC["treasure"][loc], [item(t=x.get("treasureName"), d=joinlist(x.get("treasureDesList")))
                                   for x in V(d.get("treasureNodeDataMap"))]),
        sec(SEC["tech"][loc], [item(t=x.get("techTreeName"), d=joinlist(x.get("techDesList")))
                               for x in V(d.get("techNodeDataMap"))]),
        sec(SEC["landmark"][loc], [item(t=x.get("landmarkName"), d=joinlist(x.get("landmarkDesList")))
                                   for x in V(d.get("landmarkNodeDataMap"))]),
    ]


def ex_act46side(d, loc):
    stages = sorted(V(d.get("monopolyStageDataMap")), key=lambda x: x.get("sortId") or 0)
    name_of = {x.get("stageId"): x.get("stageName") for x in stages}
    lines = []
    for sid, res in (d.get("settleDialogDataMap") or {}).items():
        for key, arr in (res or {}).items():
            label = RESULT.get(key, N(key, key, key))[loc]
            for one in arr or []:
                lines.append(item(t=name_of.get(sid, ""), tag=label, d=one.get("dialogText")))
    return [
        sec(SEC["zone"][loc], [item(t=x.get("stageName"), d=x.get("stageDesc")) for x in stages]),
        sec(SEC["dialog"][loc], lines),
    ]


def ex_act44side(d, loc):
    P = "/lore/act44side"
    return [
        sec(SEC["customer"][loc], [item(t=x.get("name"), d=x.get("description"),
                                        face=f"{P}/cust_{x['iconId'].lower()}.webp" if x.get("iconId") else "")
                                   for x in V(d.get("customerDataMap"))]),
        sec(SEC["trait"][loc], [item(t=x.get("name"), d=x.get("description")) for x in V(d.get("tagDataMap"))]),
        sec(SEC["news"][loc], [item(t=x.get("title"), tag=x.get("desc1"), d=x.get("desc2"),
                                    img=f"{P}/news_{x['imgId'].lower()}.webp" if x.get("imgId") else "")
                               for x in V(d.get("newsDataMap"))]),
        sec(SEC["dialog"][loc], [item(d=v) for v in V(d.get("customerDialogMap"))]),
        sec(SEC["keeper"][loc], [item(d=v) for v in V(d.get("keeperDialogMap"))]),
    ]


def ex_act24side(d, loc):
    return [
        sec(SEC["task"][loc], [item(t=x.get("taskTitle"), by=x.get("taskClient"), tag=x.get("taskTypeName"),
                                    d=x.get("taskClientDesc")) for x in V(d.get("missionDataList"))]),
        sec(SEC["meal"][loc], [item(t=x.get("mealName"), tag=x.get("mealEffectDesc"), d=x.get("mealDesc"))
                               for x in sorted(V(d.get("mealDataList")), key=lambda x: x.get("sortId") or 0)]),
    ]


def ex_act45side(d, loc):
    mails = sorted(V(d.get("mailData")), key=lambda x: x.get("sortId") or 0)
    return [sec(SEC["mail"][loc], [item(t=x.get("mailTitle"), by=x.get("charName"), d=x.get("mailContent")) for x in mails])]


def ex_act12side(d, loc):
    dialogs = []
    for arr in V(d.get("recycleDialogDict")):
        for one in arr or []:
            dialogs.append(item(d=one.get("dialog")))
    return [
        sec(SEC["photo"][loc], [item(t=x.get("picName"), d=x.get("picDesc")) for x in V(d.get("photoList"))]),
        sec(SEC["dialog"][loc], dialogs),
    ]


def ex_act25side(d, loc):
    areas = sorted(V(d.get("areaInfoData")), key=lambda x: x.get("sortId") or 0)
    return [sec(SEC["zone"][loc], [item(t=x.get("areaName"), d=x.get("areaInitialDesc"),
                                        d2=x.get("areaEndingDesc")) for x in areas])]


def ex_act29side(d, loc):
    return [sec(SEC["product"][loc], [item(t=x.get("groupName"), d=x.get("groupDesc"))
                                      for x in V(d.get("productGroupDataMap"))])]


def ex_act1vhalfidle(d, loc):
    plots = sorted(V(d.get("plotData")), key=lambda x: x.get("sortId") or 0)
    return [sec(SEC["plot"][loc], [item(t=x.get("plotName"), tag=x.get("funcDesc"), d=x.get("flavorDesc")) for x in plots])]


def ex_act3d0(d, loc):
    camps = V(d.get("campBasicInfo"))
    return [sec(SEC["band"][loc], [item(t=x.get("campName"), tag=x.get("rewardDesc"), d=x.get("campDesc")) for x in camps])]


# 활동 블록이 아니라 **최상위**에 있는 것들 (소유 이벤트에 붙인다)
def ex_siracusa(root, loc):
    operas = sorted(V((root.get("siracusaData") or {}).get("operaInfoMap")), key=lambda x: x.get("sortId") or 0)
    oname = {x.get("operaId"): x.get("operaName") for x in operas}
    reviews = sorted(V((root.get("siracusaData") or {}).get("operaCommentInfoMap")),
                     key=lambda x: (x.get("columnIndex") or 0, x.get("columnSortId") or 0))
    return [
        sec(SEC["opera"][loc], [item(t=x.get("operaName"), tag=x.get("operaSubName"),
                                     d=f"★ {x.get('operaScore')}") for x in operas]),
        sec(SEC["review"][loc], [item(t=x.get("commentTitle"), by=oname.get(x.get("referenceOperaId"), ""),
                                      tag=f"★ {x.get('score')}" if x.get("score") else "",
                                      d=x.get("commentContent")) for x in reviews]),
    ]


def ex_fifth(root, loc):
    f = root.get("fifthAnnivExploreData") or {}
    choices = V(f.get("exploreChoiceData"))
    return [
        sec(SEC["squad"][loc], [item(t=x.get("name"), tag=x.get("code"), d=x.get("desc")) for x in V(f.get("exploreGroupData"))]),
        sec(SEC["event"][loc], [item(t=x.get("name"), tag=x.get("typeName"), d=x.get("desc")) for x in V(f.get("exploreEventData"))]),
        sec(SEC["choice"][loc], [item(t=x.get("name"), d=x.get("desc"),
                                      d2="\n\n".join(y for y in [rich(x.get("successDesc")), rich(x.get("failureDesc"))] if y))
                                 for x in choices]),
        sec(SEC["target"][loc], [item(t=x.get("name"), d=x.get("desc"), d2=x.get("successDesc")) for x in V(f.get("exploreTargetData"))]),
    ]


# actId → (추출기, 최상위에서 읽는지)
EXTRACT = {
    "act42side": (ex_act42side, False),
    "act13d5": (ex_act13d5, False),
    "act17side": (ex_act17side, False),
    "act46side": (ex_act46side, False),
    "act44side": (ex_act44side, False),
    "act24side": (ex_act24side, False),
    "act45side": (ex_act45side, False),
    "act12side": (ex_act12side, False),
    "act25side": (ex_act25side, False),
    "act29side": (ex_act29side, False),
    "act1vhalfidle": (ex_act1vhalfidle, False),
    "act3d0": (ex_act3d0, False),
    "act21side": (ex_siracusa, True),
    "act1mainss": (ex_fifth, True),
}

# 미니게임 이름과 한 줄 안내 — 데이터에 없어 손으로 적는다 (3로케일).
META = {
    "act42side": {
        "mini": N("제총사의 밤", "The Gunsmith's Night", "銃匠の夜"),
        "note": N("의뢰를 하나 완성할 때마다 그 손님의 과거가 한 편씩 풀립니다.",
                  "Finishing a commission unlocks a piece of that client's past.",
                  "依頼を一つ仕上げるたびに、その客の過去が一編ずつ明かされます。"),
    },
    "act13d5": {
        "mini": N("신문", "The Papers", "新聞"),
        "note": N("진행에 따라 풀리는 카시미어 신문 기사입니다.",
                  "Kazimierz newspaper articles unlocked as you progress.",
                  "進行に応じて解放されるカジミエーシュの新聞記事です。"),
    },
    "act17side": {
        "mini": N("항해", "The Voyage", "航海"),
        "note": N("항로에서 마주치는 조우문과 선택지, 주워 든 물건의 사연입니다.",
                  "Encounters, choices and the stories behind what you pick up along the route.",
                  "航路で出会う遭遇文と選択肢、拾った物にまつわる話です。"),
    },
    "act46side": {
        "mini": N("기지 복구", "Station Rebuild", "基地復旧"),
        "note": N("구역 설명과, 결과에 따라 달라지는 동료들의 반응입니다.",
                  "Zone briefings and how your companions react to each outcome.",
                  "区域の説明と、結果によって変わる仲間たちの反応です。"),
    },
    "act44side": {
        "mini": N("가게 운영", "Running the Shop", "店の経営"),
        "note": N("손님 유형과 그들이 흘리는 말, 그리고 가게에 꽂히는 신문입니다.",
                  "Customer types, the lines they let slip, and the papers that land in the shop.",
                  "客のタイプと彼らが漏らす言葉、そして店に届く新聞です。"),
    },
    "act24side": {
        "mini": N("개척 퀘스트", "Frontier Requests", "開拓クエスト"),
        "note": N("마을 사람들이 붙인 의뢰문과 식당 메뉴 설명입니다.",
                  "Requests posted by the townsfolk, plus the diner's menu.",
                  "村人たちが貼った依頼文と食堂のメニュー説明です。"),
    },
    "act45side": {
        "mini": N("우편함", "The Mailbox", "郵便受け"),
        "note": N("가구를 보내며 오퍼레이터들이 함께 부친 편지입니다.",
                  "Letters the operators sent along with their furniture gifts.",
                  "家具を送る際にオペレーターたちが添えた手紙です。"),
    },
    "act12side": {
        "mini": N("스티커 회수", "Sticker Recycling", "シール回収"),
        "note": N("사건 뒤에 남은 사진들과 회수소에서 오가는 잡담입니다.",
                  "Photos left behind after the case, and chatter at the recycling desk.",
                  "事件の後に残された写真と、回収所で交わされる雑談です。"),
    },
    "act25side": {
        "mini": N("구역 탐사", "Area Survey", "区域探査"),
        "note": N("구역마다 처음 들어섰을 때와 다 보고 난 뒤의 기록이 다릅니다.",
                  "Each area reads differently when you first arrive and once you're done.",
                  "区域ごとに、初めて足を踏み入れた時と見終えた後で記録が異なります。"),
    },
    "act29side": {
        "mini": N("제품 개발", "Product Development", "製品開発"),
        "note": N("제품군마다 붙은 짧은 시입니다.",
                  "A short poem attached to each product line.",
                  "製品ラインごとに添えられた短い詩です。"),
    },
    "act1vhalfidle": {
        "mini": N("지형 개조", "Terraforming", "地形改造"),
        "note": N("황무지에 놓는 지형 조각마다 붙은 설명입니다.",
                  "The note attached to every terrain piece you place on the wasteland.",
                  "荒野に置く地形パーツごとに添えられた説明です。"),
    },
    "act3d0": {
        "mini": N("무대", "The Stage", "ステージ"),
        "note": N("무대에 오르는 밴드와 아티스트의 소개입니다.",
                  "Profiles of the bands and artists taking the stage.",
                  "ステージに立つバンドとアーティストの紹介です。"),
    },
    "act21side": {
        "mini": N("오페라 하우스", "The Opera House", "オペラハウス"),
        "note": N("공연을 보고 나면 시라쿠사 사람들이 남긴 평론이 열립니다.",
                  "Watch a performance and the reviews Siracusans left open up.",
                  "公演を観ると、シラクーザの人々が残した評論が開きます。"),
    },
    "act1mainss": {
        "mini": N("전선 탐사", "Frontline Survey", "前線探査"),
        "note": N("소대를 이끌고 런디니움으로 가는 길에 벌어지는 사건과 선택입니다.",
                  "The incidents and choices on the way to Londinium with your squad.",
                  "小隊を率いてロンディニウムへ向かう道中の事件と選択です。"),
    },
}


# 이벤트 썸네일·출시월은 스토리 아카이브(stories.json)가 이미 갖고 있다 — 새로 받지 않는다.
THUMB_KEY = {"ko": "thumb", "en": "thumbEn", "ja": "thumbJa"}

# stories.json에 없는 이벤트(스토리가 없거나 메인스토리에 묶인 것)의 썸네일 보정.
#   · 재건 계획 — 스토리가 없는 미니게임 이벤트라 storyentrypic이 없다.
#     홈 화면 진입 아트(arts/ui/stage/[uc]homeentry/<act>.png, 280×166)를 받아 쓴다.
#   · 자비의 등대 — 메인스토리 14장과 같은 존(main_14)이라 이미 받아 둔 장 썸네일을 그대로.
THUMB_FIX = {
    "act1vhalfidle": "/lore/act1vhalfidle/thumb.webp",
    "act1mainss": "/story/main_14.webp",
}
HOMEENTRY = ASSETS.rsplit("/", 1)[0] + "/arts/ui/stage/%5Buc%5Dhomeentry"


def story_meta():
    path = os.path.join(DATA, "stories.json")
    if not os.path.exists(path):
        return {}
    raw = json.load(open(path, encoding="utf-8"))
    evs = raw.get("events") if isinstance(raw, dict) else raw
    return {e["id"]: e for e in (evs or []) if e.get("id")}


# ── 그림 ─────────────────────────────────────────────────────────────────────
# 이벤트 번들은 이름이 제각각이다 (중생의 여정 = [uc]guntask). 새 이벤트의 그림을 실으려면
# https://github.com/ArknightsAssets/ArknightsAssets2/tree/cn/assets/dyn/ui 에서 번들을 찾아
# 여기에 (원본경로 → public/lore/<act>/<이름>.webp) 짝을 더한다.
GUNTASK = f"{ASSETS}/%5Buc%5Dguntask/arts"          # 중생의 여정
INFORMANT = f"{ASSETS}/%5Buc%5Dinformant/arts"      # 폐허 (⚠ 파일명이 전부 소문자다)


def download(jobs):
    def one(job):
        url, dest = job
        if os.path.exists(dest):
            return None
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "terra-archive-eventlore/1.0"})
            raw = urllib.request.urlopen(req, timeout=60).read()
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            save_webp(raw, dest, method=4)
            return None
        except Exception as err:  # noqa: BLE001 — 그림 한 장 실패해도 글은 낸다
            return (url, str(err))
    with ThreadPoolExecutor(12) as ex:
        return [f for f in ex.map(one, jobs) if f]


def fetch_images(d, d44):
    """중생의 여정 — 의뢰인 초상 4 · 기억을 부른 물건 12 · 총기 4.
       폐허 — 손님 초상 12 · 신문 사진 10."""
    jobs = []
    if d44:
        out44 = os.path.join(PUB, "act44side")
        for c in V(d44.get("customerDataMap")):
            if c.get("iconId"):
                jobs.append((f"{INFORMANT}/customericon/{c['iconId'].lower()}.png",
                             os.path.join(out44, f"cust_{c['iconId'].lower()}.webp")))
        for n in V(d44.get("newsDataMap")):
            if n.get("imgId"):
                jobs.append((f"{INFORMANT}/newsicon/{n['imgId'].lower()}.png",
                             os.path.join(out44, f"news_{n['imgId'].lower()}.webp")))
    jobs.append((f"{HOMEENTRY}/act1vhalfidle.png",
                 os.path.join(PUB, "act1vhalfidle", "thumb.webp")))
    if not d:
        return _run(jobs)
    out = os.path.join(PUB, "act42side")
    for t in V(d.get("trustorData")):
        if t.get("trustorIconLarge"):
            jobs.append((f"{GUNTASK}/avatarlarge/{t['trustorIconLarge']}.png",
                         os.path.join(out, f"face_{t['trustorIconLarge']}.webp")))
    for icon in {t.get("afterTaskItemIcon") for t in V(d.get("taskData")) if t.get("afterTaskItemIcon")}:
        jobs.append((f"{GUNTASK}/itemicon/{icon}.png", os.path.join(out, f"item_{icon}.webp")))
    for g in V(d.get("gunData")):
        if g.get("gunColorIcon"):
            jobs.append((f"{GUNTASK}/gunlarge/{g['gunColorIcon']}.png",
                         os.path.join(out, f"gun_{g['gunColorIcon']}.webp")))
    return _run(jobs)


def _run(jobs):
    fails = download(jobs)
    print(f"그림 {len(jobs) - len(fails)}/{len(jobs)}장 → public/lore/")
    for url, err in fails[:6]:
        print(f"  ⚠ {url.rsplit('/', 1)[-1]}: {err}")


def main():
    load = lambda p: json.load(open(os.path.join(S, p), encoding="utf-8"))
    smeta = story_meta()
    roots = {}
    for loc, pre in PREFIX.items():
        path = os.path.join(S, f"{pre}_activity_table.json")
        if not os.path.exists(path):
            sys.exit(f"{path} 가 없다 — python3 scripts/fetch-gamedata.py 를 먼저 돌릴 것")
        roots[loc] = load(f"{pre}_activity_table.json")

    def block(root, act_id):
        for acts in (root.get("activity") or {}).values():
            if act_id in acts:
                return acts[act_id]
        return None

    kr = roots["ko"]
    basic = kr.get("basicInfo") or {}
    order = sorted(EXTRACT, key=lambda a: -(basic.get(a, {}).get("startTime") or 0))

    out = {loc: {"events": []} for loc in PREFIX}
    report = []
    for act_id in order:
        fn, from_root = EXTRACT[act_id]
        for loc in PREFIX:
            root = roots[loc]
            src = root if from_root else block(root, act_id)
            if not src:
                if loc == "ko":
                    report.append(f"⚠ {act_id}: KR 데이터 없음 — 건너뜀")
                break
            secs = [s for s in fn(src, loc) if s]
            if not secs:
                break
            name = (root.get("basicInfo") or {}).get(act_id, {}).get("name") \
                or basic.get(act_id, {}).get("name") or act_id
            m = META.get(act_id, {})
            ev = {"id": act_id, "n": name, "secs": secs}
            sm = smeta.get(act_id) or {}
            thumb = sm.get(THUMB_KEY[loc]) or sm.get("thumb") or THUMB_FIX.get(act_id)
            if thumb:
                ev["thumb"] = thumb
            if sm.get("start"):
                ev["start"] = sm["start"]
            if m.get("mini"):
                ev["mini"] = m["mini"][loc]
            if m.get("note"):
                ev["note"] = m["note"][loc]
            out[loc]["events"].append(ev)
        else:
            n = sum(len(s["items"]) for s in out["ko"]["events"][-1]["secs"])
            report.append(f"  {act_id:<14} {basic.get(act_id, {}).get('name', ''):<22} 섹션 {len(out['ko']['events'][-1]['secs'])} · 글 {n}")

    if not NO_ICONS:
        fetch_images(block(kr, "act42side"), block(kr, "act44side"))

    for loc, suf in SUFFIX.items():
        path = os.path.join(DATA, f"eventlore{suf}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out[loc], f, ensure_ascii=False, separators=(",", ":"))
        kb = os.path.getsize(path) / 1024
        print(f"{os.path.relpath(path, REPO)}  {len(out[loc]['events'])}개 이벤트  {kb:.0f}KB")
    print("\n".join(report))


if __name__ == "__main__":
    main()
