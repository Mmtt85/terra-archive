# Supabase 플래너 지식 베이스의 최신 발행 스냅샷을 app/data/rules.json으로 베이크한다.
# Usage: python3 scripts/build-rules.py
#
# 흐름: /admin '플래너 규칙' 탭에서 편집·발행 → 이 스크립트로 베이크 → 후속 절차(아래 안내
# 출력)를 밟고 커밋. rules.json은 이 스크립트가 쓰는 파일이므로 손으로 고치지 말 것 —
# 손으로 고치면 다음 베이크가 덮어쓴다 (드리프트 감지 시 경고).
# 테이블·RLS·시드: docs/supabase-planner-rules.sql · 설계: docs/PLANNER-RULES-DB.md
import json, os, sys, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULES_PATH = f"{REPO}/app/data/rules.json"

# anon 키 — app/feedback.ts와 동일한 공개 키 (RLS가 rule_releases SELECT만 허용)
URL = "https://exirlkhpkgxsflbglhld.supabase.co"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4aXJsa2hwa2d4c2ZsYmdsaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTAwNDEsImV4cCI6MjA5ODgyNjA0MX0.IKwvqp0OyHOacl89JWIoRwzvJRDc2t0678qs3NPZ4fw"

req = urllib.request.Request(
    f"{URL}/rest/v1/rule_releases?select=*&order=version.desc&limit=1",
    headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"},
)
try:
    rows = json.load(urllib.request.urlopen(req, timeout=15))
except Exception as e:
    sys.exit(f"발행 스냅샷 조회 실패: {e}\n→ docs/supabase-planner-rules.sql을 Supabase SQL Editor에서 실행했는지 확인")
if not rows:
    sys.exit("발행된 릴리스가 없습니다 — supabase-planner-rules.sql의 v1 시드가 실행됐는지 확인")

release = rows[0]
snapshot = release["snapshot"]
old = json.load(open(RULES_PATH, encoding="utf-8")) if os.path.exists(RULES_PATH) else None

if old == snapshot:
    print(f"변경 없음 — rules.json이 이미 v{release['version']}과 동일합니다")
    sys.exit(0)

# 드리프트 경고: 로컬 파일이 같은 버전인데 내용이 다르면 손편집이 끼어든 것 —
# 그 변경은 DB(원장)에 없으므로 이대로 덮어쓰면 사라진다.
if old is not None and old.get("version") == snapshot.get("version"):
    print(f"⚠ 드리프트: 로컬 rules.json(v{old.get('version')})이 발행본과 다릅니다 — "
          "손편집이 있었다면 /admin에서 원장에 반영 후 재발행할 것. 지금은 발행본으로 덮어씁니다.",
          file=sys.stderr)

# jsonb는 키 순서를 보존하지 않으므로 정렬 덤프로 결정적 출력 (배열 순서는 보존됨)
json.dump(snapshot, open(RULES_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2, sort_keys=True)
open(RULES_PATH, "a", encoding="utf-8").write("\n")
print(f"베이크 완료: rules.json ← v{release['version']} ({release.get('published_at', '')}) "
      f"{('— ' + release['note']) if release.get('note') else ''}")

# 후속 절차 안내 — 어떤 섹션이 바뀌었는지에 따라 필요한 단계가 다르다.
# constants.OP_GROUPS(명단형 그룹)는 파서의 "1명당" 매칭 대상이라 파서 영향에 포함
def section(d, key):
    return (d or {}).get(key)
parser_changed = old is None or any(section(old, k) != section(snapshot, k) for k in ("parser", "tokens", "skillOverrides")) \
    or (section(old, "constants") or {}).get("OP_GROUPS") != (section(snapshot, "constants") or {}).get("OP_GROUPS")
print("\n다음 절차:")
if parser_changed:
    print("  1. python3 scripts/build-infra.py .gamedata   # parser/tokens/skillOverrides 변경 — infra.json 재생성 (~2분)")
    print("  2. python3 scripts/build-i18n.py .gamedata    # infra.json이 바뀌면 EN/JA도 재생성")
    print("  3. node scripts/verify-plan.mjs               # 회귀 검증")
else:
    print("  1. node scripts/verify-plan.mjs               # 회귀 검증 (constants/fixtures만 변경)")
print("  → 통과하면 빌드 확인 후 커밋·푸시")
