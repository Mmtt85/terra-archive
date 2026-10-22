---
name: match-flag
description: 친구 찾기(친구 매칭) 공개 목록의 닉네임·한마디를 하이쿠로 불량 검사해 판정 표(match_flag)에 적는다. 불량으로 적힌 값은 사이트가 흐리게 가린다. "/match-flag", "닉네임 불량 검사", "친구 찾기 불량 검사 돌려줘" 같은 요청에 사용. 운영자가 생각날 때 돌린다(하루 한 번쯤).
---

# 친구 찾기 불량 검사 — 뽑고 · 하이쿠가 판정하고 · 적는다

판정은 **하이쿠(새 하위 에이전트, model: haiku)** 에게 맡긴다 — 긴 대화 맥락 없이 목록만 보고 판단하게 해야 싸고,
2026-10-22 시험에서 하이쿠도 분명한 불량은 근거까지 정확히 잡았다. 나는 뽑기·전달·쓰기·보고만 한다.

## 1. 아직 판정 안 한 값 뽑기

```bash
node /Users/byeonghoseong/Documents/workspace/terra-archive/scripts/match-flag.mjs pending
```

`[{field: "nick"|"resume", value, server}]`. 닉네임은 `#번호`를 뗀 이름이다. 이미 판정한 값(정상 포함)은 안 나온다.
빈 배열이면 "새로 볼 것 없음"으로 보고하고 끝.

## 2. 하이쿠에게 판정 맡기기

Agent 도구 — `model: "haiku"`, `subagent_type: "general-purpose"`, 포그라운드. 아래 프롬프트에 1의 JSON 을 그대로 붙인다.
**내 판단을 미리 알려 주지 않는다**(하이쿠 판단이 흐려진다).

```
당신은 명일방주 팬사이트 '친구 찾기' 공개 목록을 검수합니다. 도구는 쓰지 말고 아래 JSON 만 보고 판단하세요.
field 가 nick 이면 닉네임, resume 이면 자기소개 한마디입니다.

불량(bad): **누가 봐도 심각한 것만** — 아동 대상 성적 표현, 노골적인 성적 표현, 특정 집단(지역·성별·인종·장애 등)을
겨냥한 혐오·비하, 실존 인물·참사 조롱. 한국어·일본어·영어 은어, 초성, 붙여 쓴 말장난도 풀어서 읽으세요.
정상(ok): 그 밖의 전부. **흔한 욕설·거친 말투는 정상**입니다(심각한 경우만 가린다). 귀여운 말투·의성어·오타·
외국어 인사·게임 용어도 정상(예: "뜌따이", "뉴비에오", "으흐흐흐", "Hogirl" 같은 이름은 정상).
애매(unsure): 심각한 불량일 수도 있는데 확신이 없을 때만.

반드시 JSON 배열 하나만 출력하세요(설명 없이):
[{"field": "...", "value": "...", "verdict": "bad"|"ok"|"unsure", "why": "한 줄 근거"}]

목록:
<1의 JSON>
```

## 3. 결과 적기

하이쿠가 낸 JSON 배열을 스크래치패드에 파일로 저장한 뒤:

```bash
node /Users/byeonghoseong/Documents/workspace/terra-archive/scripts/match-flag.mjs apply <결과.json 절대경로>
```

value 는 하이쿠가 낸 그대로 쓴다(1의 값과 글자가 달라졌으면 1의 값으로 고쳐 넣는다 — 글자 그대로 맞아야 가려진다).

## 4. 보고 (한국어, 짧게)

- 새로 본 값 N개 · 불량 n · 애매 n
- 불량·애매는 값과 하이쿠 근거를 그대로 적는다
- 애매는 **사용자가 정한다** — 정상이면 `set <nick|resume> <값> ok`, 불량이면 `set ... bad`
- 불량을 가리는 건 자동이다 — 워커가 목록 줄에 `hidden` 을 싣고, 사이트가 카드를 흐리게 맨 뒤로 보내
  "AI에 의해 감춰진 카드입니다. 보시려면 클릭해 주세요"(올리면 안내, 누르면 보임). **지우지 않는다** (사용자 지시 2026-10-22)
- 기준은 '누가 봐도 심각한 것만' — 흔한 욕은 가리지 않는다 (사용자 지시 2026-10-22)

## 사람이 고치기

```bash
node /Users/byeonghoseong/Documents/workspace/terra-archive/scripts/match-flag.mjs list          # 불량·애매 전부
node /Users/byeonghoseong/Documents/workspace/terra-archive/scripts/match-flag.mjs set nick "<이름>" ok   # 오탐 풀기
```

사용자가 정상이라고 정해 준 예는 위 프롬프트의 정상 예시에 더해 둔다(같은 오탐을 되풀이하지 않게).
