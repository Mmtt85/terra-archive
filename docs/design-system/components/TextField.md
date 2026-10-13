# 입력란
텍스트·숫자·날짜 입력란 — 불투명한 옅은 바탕에 평소에도 1px 밑줄이 보인다.

- 사용: `<input class="ta-field">` (textarea·select 도 같은 결).
- 바탕 `field-fill`, 평소 밑줄 `field-rule` 1px. 포커스면 `field-fill-focus` + `tab-line` 2px 밑줄이 왼쪽에서 자란다.
- 상자 테두리·모서리 없음(반경 0). 자리표시 글자는 `muted`.
- 모바일(≤760px)에선 글자 16px 강제 — iOS 확대 방지.
- 체크박스·라디오·range·파일 입력은 이 결에서 뺀다.
- 소비자가 줄 것: 값, 자리표시 문구, 라벨.
