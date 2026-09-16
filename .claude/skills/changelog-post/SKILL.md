---
name: changelog-post
description: 업데이트 내역(헤더 🛠)에 항목을 올린다. "업뎃 내역 올려줘", "업데이트 내역에 추가", "오늘 작업한 거 올려줘" 같은 요청에 사용. 순서·제목 길이·무엇을 쓰고 무엇을 안 쓰는지가 전부 여기 정본이다.
---

# 업데이트 내역 등록

Supabase `changelog` 테이블에 직접 쓴다. 코드가 아니라 DB라서 **배포와 무관하게 즉시** 사이트에 뜬다.

## 절대룰 — 순서 (사용자가 여섯 번 지적했다)

**같은 날짜 안에서도 최신이 맨 위.** `seq` 는 작을수록 위이므로 **seq = 등록 역순**이다.
즉 **새로 올리는 항목이 언제나 `seq 0`** 이고, 그날 이미 있던 항목은 전부 +1 밀어야 한다.

> 절대 금지: 새 항목을 그날 마지막 번호로 붙이기(그러면 최신이 맨 밑으로 간다).
> '신기능 먼저' 같은 임의 정렬도 금지 — 등록 역순 하나뿐이다.

```bash
KEY=$(grep -o 'eyJ[A-Za-z0-9._-]*' app/feedback.ts | head -1); ADMIN=$(cat .supabase-admin-key)
API=https://exirlkhpkgxsflbglhld.supabase.co/rest/v1/changelog
H=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "x-admin-key: $ADMIN" \
   -H "Content-Type: application/json" -H "Prefer: return=representation")

# ① 그날 기존 항목의 seq 를 +1 (큰 번호부터 올려야 충돌이 안 난다)
curl -s "$API?select=id,seq&released_at=eq.$DATE&order=seq.desc" "${H[@]}"
#    → 각 id 마다: curl -X PATCH "$API?id=eq.<id>" "${H[@]}" -d '{"seq": <seq+1>}'
# ② 새 항목을 seq 0 으로 POST
curl -X POST "$API" "${H[@]}" --data-binary @row.json
# ③ 확인 — 등록 시각이 내림차순이어야 맞다
curl -s "$API?select=seq,created_at,ko&released_at=eq.$DATE&order=seq.asc" "${H[@]}"
```

⚠ **RLS 는 거부해도 HTTP 200 에 빈 배열**을 준다. 응답 행이 0개면 실패다 — 성공으로 읽지 말 것.

## 무엇을 쓰고, 무엇을 안 쓰나 (사용자 지적 2026-09-16)

읽는 사람은 **사이트 이용자**다. 우리 사정이 아니라 **그들에게 뭐가 달라졌는지**만 쓴다.

- ❌ **"원래 됐어야 하는 것"은 항목이 아니다.** 우리 버그로 잠깐 깨졌다 고친 것, 원래 있어야 할
  기능이 뒤늦게 붙은 것을 신기능·수정으로 올리지 않는다. 생색으로 읽힌다.
- ❌ 내부 사정(파이프라인·CI·저장소·스크립트)은 안 쓴다. 이용자가 볼 수 없는 것이다.
- ✅ **점검이 있었으면 "무슨 오퍼레이터와 무슨 스토리가 열렸다"** 로 쓴다. 그게 이용자가
  기다린 내용이다. 새 읽기 방식은 신기능이 아니라 **읽는 방법**으로만 곁들인다.
- ✅ 계산 방식·규칙이 실제로 바뀌어 **결과가 달라지는 것**은 쓴다 (예: 편성 배치 규칙 변경).

## 형식

- **제목 = 첫 ` — ` 앞.** 한국어 **40자 이내**. 엠대시가 없으면 본문 전체가 제목이 돼 200자짜리
  제목이 나간다 — 반드시 넣을 것.
- 본문은 200자 안팎. `**굵게**` 로 핵심을 잡고, "종전에는 …" 으로 뭐가 달랐는지 한 번 짚는다.
- **하루치는 묶는다.** 커밋 1개 = 항목 1개 금지. 사소한 건 아예 빼고, 한 날에 두세 건을 넘기지 않는다.
- **한·영·일 셋 다** 채운다 (`ko`/`en`/`ja`). 비우면 프론트가 한국어로 폴백해 그대로 나간다.
- `kind`: `new`(신기능) · `improve`(개선) · `change`(일반 변경) · `fix`(버그) · `data`(데이터 갱신)
- `area`: `infra archive enemy stage sim recruit farm upgrade story rogue ra autochess site`
  — `app/changelog-api.ts` 의 `CHANGE_AREAS` 와 **같은 집합**이어야 한다.
- `href`: 사이트 내부 경로 하나 (`/operators`, `/infra`, `/stories` …). 없으면 생략.
- `released_at`: 생략하면 오늘. 배포한 날로 맞춘다.

## 언제 올리나

**배포가 끝난 뒤.** DB라서 먼저 올리면 아직 없는 기능을 가리킨다. 사용자가 "배포 끝났다"고
하면 그때 등록한다 (`gamedata-pull` 스킬 §5 와 같은 규칙).

## 고칠 때

행 수정은 `PATCH ?id=eq.<id>`, 삭제는 `DELETE ?id=eq.<id>`. 문구를 잘못 올렸으면
지우고 다시 쓰는 편이 낫다 — 등록 시각이 바뀌지 않으니 순서는 그대로다.
