#!/usr/bin/env python3
"""재집필 결과 점검 + 사이트 요약 파일에 병합. 사용: python3 merge.py <id> [--dry]
점검: 형식 · 그림 실존 · 분량(목표 범위) · 문체 단일성(문단 끝 ~요/~다) · 3문장 초과 문단 · 카드 이름이 본문에 나오는지 · op 실존."""
import json, os, re, sys
REPO = "/Users/byeonghoseong/Documents/workspace/terra-archive"
R = os.path.dirname(os.path.abspath(__file__))
eid = sys.argv[1]; dry = "--dry" in sys.argv
d = json.load(open(f"{R}/out/{eid}.json", encoding="utf-8"))
meta = json.load(open(f"{R}/src/{eid}.meta.json"))
ops = {o["id"] for o in json.load(open(f"{REPO}/app/data/operators.json"))}
_dirs = {}
def _names(d):
    if d not in _dirs: _dirs[d] = set(os.listdir(f"{REPO}/public{d}")) if os.path.isdir(f"{REPO}/public{d}") else set()
    return _dirs[d]
probs, warns = [], []
if set(d) != {"tagline", "chars", "terms", "blocks"}: probs.append(f"키 {sorted(d)}")
bl = d["blocks"]
for b in bl:
    if b.get("t") not in ("h", "p", "img", "quote"): probs.append(f"블록 종류 {b.get('t')}")
    # 대소문자까지 맞아야 한다 — macOS 는 23_I01 도 찾아 주지만 라이브(R2)는 404 (2026-10-04)
    if b.get("t") == "img" and os.path.basename(b["src"]) not in _names(os.path.dirname(b["src"])): probs.append(f"그림 없음(대소문자 포함) {b['src']}")
n = sum(len(b.get("x", "")) + len(b.get("cap", "")) for b in bl)
lo, hi = meta["target"]
if not (lo - 300 <= n <= hi + 300): warns.append(f"분량 {n} (목표 {lo}~{hi})")
ps = [re.sub(r"[\"“”'‘’「」『』)\]]+$", "", b["x"].strip()) for b in bl if b["t"] == "p"]
# '~습니다'는 해요체와 함께 쓰는 존댓말이라 '요' 쪽으로 센다 (평서체 '~다'만 '다')
yo = sum(1 for p in ps if re.search(r"(요|니다)[.?!…~]*$", p)); da = sum(1 for p in ps if re.search(r"다[.?!…~]*$", p) and not re.search(r"니다[.?!…~]*$", p))
style = "다" if da > yo * 3 else "요" if yo > da * 3 else "섞임"
if style == "섞임": warns.append(f"문체 섞임 (~요 {yo} / ~다 {da})")
long = [p[:30] for p in ps if len(re.findall(r"[.?!](?=\s|$)", p)) > 3]
if long: warns.append(f"3문장 초과 {len(long)}")
txt = " ".join(b.get("x", "") + " " + b.get("cap", "") for b in bl)
unused = [c["name"] for c in d["chars"] + d["terms"] if not any(a and a in txt for a in [c["name"]] + c.get("alias", []))]
if unused: warns.append(f"본문에 안 나오는 카드 {unused}")
badop = [c.get("op") for c in d["chars"] if c.get("op") and c["op"] not in ops]
if badop: probs.append(f"없는 op {badop}")
print(f"{eid}: {n:,}자 · 문체 '~{style}' · 그림 {sum(1 for b in bl if b['t']=='img')} · 카드 {len(d['chars'])}+{len(d['terms'])}"
      + (f" · ⚠ {' / '.join(warns)}" if warns else "") + (f" · ✗ {' / '.join(probs)}" if probs else ""))
if probs or dry:
    sys.exit(1 if probs else 0)
p = f"{REPO}/app/data/story-summaries.json"
raw = open(p, encoding="utf-8").read(); s = json.loads(raw)
s[eid] = {"tagline": d["tagline"], "chars": d["chars"], "terms": d["terms"], "blocks": bl}
open(p, "w", encoding="utf-8").write(json.dumps(s, ensure_ascii=False, indent=1) + ("\n" if raw.endswith("\n") else ""))
print("  → app/data/story-summaries.json 에 넣음")
