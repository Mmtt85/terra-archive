# 드롭다운 단추
목록을 여는 드롭다운·실행 단추 — 테두리 없는 옅은 단색 바탕에 호버 때 밑줄이 자란다.

- 사용: `<button class="ta-drop" aria-expanded="false">라벨<span class="caret">▾</span></button>` + 목록 `<ul class="ta-menu">`.
- 바탕 `soft-fill`(불투명 — 반투명이면 뒤 격자가 비친다), 호버 `soft-fill-hover` + `tab-line` 밑줄이 왼쪽에서 폭 끝까지.
- 열림(`aria-expanded="true"`)은 밑줄 고정 + ▾ 를 X축으로 뒤집는다(글리프를 ▴ 로 바꿔 끼우지 않는다).
- 값이 골라진 상태(`.on`)는 라벨 앞 6px `tab-line` 점 + 밑줄 고정.
- 목록 판: `bg-panel`, `line` 테두리, `r-sm`, `sh-2`. 행 호버 `btn-ghost-hover`, 고른 행 `btn-on-*`.
- 소비자가 줄 것: 라벨, 열림 상태, 목록 항목.

app/globals.css 의 '공용 단추·입력란 결' 규칙을 손으로 옮겨 그린 정적 재현이다.
