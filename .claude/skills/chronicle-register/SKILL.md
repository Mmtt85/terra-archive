---
name: chronicle-register
description: 테라 연대기(chronology.json)에 아직 등록 안 된 이벤트를 테라력 연도·테마 아크와 함께 손수 등록한다. 무인 파이프라인 리포트가 "테라 연대기 미등록 N건"으로 지목하면 실행. "연대기 등록해줘", "테라 연대기에 추가" 같은 요청에도 사용.
---

# 테라 연대기 등록

`app/data/chronology.json`은 **손수 큐레이트하는 스캐폴드**다 (게임 데이터에서 자동 도출
불가 — 각 이벤트의 테라력 위치·주제를 사람이 판단해 넣어야 함). 무인 파이프라인은
이 파일을 자동으로 못 채우므로, 미등록 이벤트가 생기면 이 스킬로 등록한다.

## 절차

1. **미등록 목록 확인** — 파이프라인 리포트의 "테라 연대기 미등록" 항목, 또는:
   ```bash
   node -e "const ch=require('./app/data/chronology.json');const st=require('./app/data/stories.json');const refs=new Set(ch.entries.map(e=>e.ref));const evs=st.events||st;console.log(evs.filter(e=>!refs.has(e.id)&&!/^(rogue|main)/.test(e.id)).map(e=>e.id+' '+(e.name?.ko||'')).join('\n'))"
   ```

2. **각 이벤트의 테라력 연도·아크 판단** — 아무렇게나 넣지 말 것:
   - `chronology.json`의 `arcs` 목록(테마 아크 id·이름)을 먼저 읽는다.
   - 해당 이벤트의 AI 요약(`app/data/story-summaries.json`)과 필요하면 전문 스크립트
     (`public/story/script/<id>.json`)를 읽어 **줄거리·등장 진영·시점**을 파악한다.
   - **나무위키 '테라 연대기(테라 연표)'** 문서를 교차 참조해 테라력(terraYear) 연도와
     소속 테마 아크(arc)를 확정한다. 연도가 불명확하면 `terraYear: null`로 두고 `dateNote`에
     근거를 남긴다. 메모리 [[terra-archive-main-story-chronicle]]의 14개 테마 아크 구조 참고.

3. **entries에 추가** — 기존 항목 스키마를 그대로 따른다:
   ```json
   { "ref": "<이벤트 id>", "kind": "event", "terraYear": <숫자 또는 null>, "arc": "<arc id>" }
   ```
   `ref`는 stories.json의 이벤트 id와 일치해야 이름·썸네일·출시월이 연결된다.
   시간순 배치가 중요하면 terraYear 순서에 맞는 위치에 삽입한다.

4. **검증·마무리**:
   - 빌드 확인(`npm run build`)으로 story.tsx가 정상 렌더링되는지 본다.
   - **UI 문구 변경은 없다** (이름은 stories.json에서 옴) — i18n 사전 손댈 것 없음.
   - `arc` id가 arcs 목록에 실제로 있는지 확인. 새 아크가 필요하면 `arcs`에도 추가하고
     ko/en/ja 이름을 채운다.
   - 커밋 → push. (배포는 사용자가 직접, CLAUDE.md 규칙)

## 주의

- 연대기는 **선별 큐레이션**이다. 모든 잔이벤트를 넣을 필요는 없지만, 스토리 요약이 있는
  사이드/메인 이벤트는 연표에 포함하는 게 기본. 애매하면 사용자에게 편입 여부를 묻는다.
- terraYear는 실제 연표 근거 없이 추정하지 말 것 — 근거 없으면 null + dateNote.
