#!/usr/bin/env python3
"""Build app/data/recruit.json for the recruitment helper tab.

Usage: python3 scripts/build-recruit.py <gamedata-dir>
Needs: kr_gacha_table.json, kr_character_table.json, kr_handbook_info_table.json
       (same scratch layout as regen-operators.py) + app/data/operators.json for
       image/accent/seq.

Output shape:
  { "tags": [{"id", "name", "group"}],
    "ops":  [{"id", "name", "rarity", "tags": [..], "image", "accent", "seq"}] }

Operator tags = 직군 + 위치 + tagList(로봇/신입 포함) +
5성→특별 채용, 6성→고급 특별 채용.
※ 남성/여성 태그는 gacha_table에 남아 있지만 KR 공채에서 삭제됨 — 제외한다.
"""
import json, re, sys, os

S = sys.argv[1] if len(sys.argv) > 1 else ".gamedata"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load(p):
    return json.load(open(p, encoding="utf-8"))

gacha = load(f"{S}/kr_gacha_table.json")
chars = load(f"{S}/kr_character_table.json"); chars = chars.get("chars", chars)
handbook = load(f"{S}/kr_handbook_info_table.json"); handbook = handbook.get("handbookDict", handbook)
ops_meta = {o["id"]: o for o in load(f"{REPO}/app/data/operators.json")}

JOB_KO = {"WARRIOR": "가드", "SNIPER": "스나이퍼", "TANK": "디펜더", "MEDIC": "메딕",
          "SUPPORT": "서포터", "CASTER": "캐스터", "SPECIAL": "스페셜리스트", "PIONEER": "뱅가드"}
TIER = {"TIER_1": 1, "TIER_2": 2, "TIER_3": 3, "TIER_4": 4, "TIER_5": 5, "TIER_6": 6}

def gender_of(cid):
    e = handbook.get(cid)
    if not e: return None
    for audio in e.get("storyTextAudio", []):
        for st in audio.get("stories", []):
            m = re.search(r"\[성별\]\s*([^\n\[]+)", st.get("storyText") or "")
            if m:
                g = m.group(1).strip()
                if g.startswith("남"): return "남성"
                if g.startswith("여"): return "여성"
                return None
    return None

# recruit pool from recruitDetail: ★-count sections, names separated by " / "
# KR recruitDetail 오기 보정 — 공채 상세문과 character_table의 표기가 다른 오퍼
NAME_FIX = {"샤미르": "샤마르"}
detail = gacha["recruitDetail"]
byname = {c["name"]: cid for cid, c in chars.items() if cid.startswith("char_")}
pool = []  # (cid, rarity)
seen_cids = set()
for m in re.finditer(r"\n(★+)\n(.*?)(?=\n-{5,}|\Z)", detail, re.S):
    stars = len(m.group(1))
    body = re.sub(r"<@rc\.eml>(.*?)</>", r"\1", m.group(2))
    for name in (n.strip() for n in body.replace("\n", " ").split("/")):
        if not name: continue
        cid = byname.get(NAME_FIX.get(name, name))
        if not cid:
            print(f"WARN: recruit name not matched: {name!r}", file=sys.stderr)
            continue
        pool.append((cid, stars))
        seen_cids.add(cid)

# KR 클라이언트에 실제로 공채 추가가 적용됐지만 데이터마인 recruitDetail이 아직 갱신되지
# 않은 오퍼 (id로 중복 제외됨, 성급은 character_table 자동 판정, 즉시 모집 가능).
RECRUIT_SUPPLEMENT: list[str] = []

# "공채 추가 예정" — 공지는 됐으나 아직 KR 클라에 미적용. 풀에는 넣되 pending 플래그로
# 표시만 하고, 조합 결과에서는 "예정" 배지로 구분한다 (실제 적용되면 SUPPLEMENT로 옮김).
RECRUIT_PENDING = ["카넬리안", "키라라", "인디고"]
pending_cids = set()
for name in RECRUIT_PENDING:
    cid = byname.get(name)
    if not cid:
        print(f"WARN: pending name not matched: {name!r}", file=sys.stderr)
        continue
    if cid in seen_cids:
        continue
    pool.append((cid, TIER[chars[cid]["rarity"]]))
    seen_cids.add(cid)
    pending_cids.add(cid)
for name in RECRUIT_SUPPLEMENT:
    cid = byname.get(name)
    if not cid:
        print(f"WARN: supplement name not matched: {name!r}", file=sys.stderr)
        continue
    if cid in seen_cids:
        continue  # 데이터마인이 이미 반영함
    pool.append((cid, TIER[chars[cid]["rarity"]]))
    seen_cids.add(cid)

ops = []
for cid, stars in pool:
    c = chars[cid]
    assert TIER[c["rarity"]] == stars, f"{c['name']}: pool {stars}★ vs table {c['rarity']}"
    tags = [JOB_KO[c["profession"]], "근거리" if c["position"] == "MELEE" else "원거리"]
    tags += c.get("tagList") or []
    if stars == 5: tags.append("특별 채용")
    if stars == 6: tags.append("고급 특별 채용")
    meta = ops_meta.get(cid) or {}
    entry = {"id": cid, "name": c["name"], "rarity": stars, "tags": tags,
             "image": meta.get("image") or f"/avatars/{cid}.png",
             "accent": meta.get("accent") or "#6b7a86", "seq": meta.get("seq", -1)}
    if cid in pending_cids: entry["pending"] = True
    ops.append(entry)

known = {t["tagName"] for t in gacha["gachaTags"]}
used = {t for o in ops for t in o["tags"]}
unknown = used - known
if unknown:
    print(f"WARN: tags not in gachaTags: {sorted(unknown)}", file=sys.stderr)

out = {"tags": [{"id": t["tagId"], "name": t["tagName"], "group": t["tagGroup"]} for t in gacha["gachaTags"]
                if t["tagName"] not in ("남성", "여성")],
       "ops": ops}
json.dump(out, open(f"{REPO}/app/data/recruit.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"recruit pool: {len(ops)} ops, tags: {len(out['tags'])}")
for r in range(1, 7):
    print(f"  {r}★: {sum(1 for o in ops if o['rarity'] == r)}")
