---
name: dc-promo
description: 디시 미니 갤러리 terra_archive 의 소개글(no=5)을 최신 업데이트 내역으로 갱신한다. "디시 소개글 갱신", "디시 글 업데이트해줘", "미니갤 소개글 새로고침" 같은 요청에 사용.
---

# 디시 소개글 갱신 (미니갤 terra_archive no=5)

사용자가 글쓴이이고, 크롬(Claude in Chrome)에 디시가 로그인돼 있다. 본문은 `/admin` 업데이트 내역 탭의
'소개글 HTML (링크 없음)' + "마지막 갱신 · <시각> (한국 시간) · 자동 갱신" + 글 맨 밑 사이트 링크 카드
(`scripts/dc-promo-footer.html`, 사용자가 디시 에디터로 만든 그대로)다.

**탐색 금지 — 아래 순서 그대로.** 스크린샷·페이지 전체 읽기 없이 크롬 호출 6번이면 끝난다 (2026-10-07 확정).
본문 1만 3천 자를 모델이 읽고 붙이면 1회 8~9만 토큰이 들었다 — 그래서 본문은 R2 에 올리고 디시 페이지가 직접 받는다.

## 순서

1. Bash: `cd /Users/byeonghoseong/Documents/workspace/terra-archive && npx tsx scripts/dc-promo-html.ts 2>/dev/null`
   → `올림 N자 · <시각> → https://files.terra-archive.net/uploads/dc-promo.html`. 이 <시각>을 기억한다.
   (`--print` 를 붙이면 올리지 않고 HTML 만 출력한다.)
2. 크롬 도구 로드: ToolSearch `select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__tabs_close_mcp`
3. navigate(탭 id 없이) → `https://gall.dcinside.com/mini/board/modify/?id=terra_archive&no=5` (결과의 tabId 를 이어서 쓴다)
4. javascript_tool, 코드 그대로:
   ```js
   await new Promise(r=>setTimeout(r,1500)); if(!/board\/modify/.test(location.pathname)||!window.$||!document.querySelector('#memo')){({stop:'수정 페이지가 아님(로그인 풀림?)'})}else{const html=await(await fetch('https://files.terra-archive.net/uploads/dc-promo.html?t='+Date.now(),{cache:'no-store'})).text();$('#memo').summernote('code',html);const stamp=(html.match(/마지막 갱신[^<]*/)||[''])[0];const ok=!!stamp&&document.querySelector('.note-editable').innerHTML.includes(stamp);const btn=document.querySelector('button.btn_lightpurple.write');if(ok&&btn)setTimeout(()=>btn.click(),100);({ok,btn:!!btn,stamp})}
   ```
   `stop` 이 있거나 `ok`·`btn` 이 false 면 멈추고 보고한다.
5. navigate(같은 tabId) → `https://gall.dcinside.com/mini/board/view/?id=terra_archive&no=5`
6. javascript_tool, 코드 그대로 — 갱신 시각을 읽고, **공지 등록**을 누른다 (글을 수정하면 공지가 풀린다. 사용자 지시 2026-10-07:
   "수정이 끝나면 view 로 다시 접속해서 게시물 관리 → 공지 등록까지"). 확인창은 자동으로 '예', 누르면 페이지가 새로 고쳐진다:
   ```js
   await new Promise(r=>setTimeout(r,1200)); const stamp=(document.body.innerText.match(/마지막 갱신[^\n]*/)||['없음'])[0]; const w=document.querySelector('.mini_mng_adminset'); const li=w&&[...w.querySelectorAll('li')].find(l=>l.textContent.trim()==='공지 등록'); if(li){window.confirm=()=>true; const t=[...w.querySelectorAll('*')].find(e=>/게시물 ?관리/.test(e.textContent.trim())&&e.children.length<3&&e.offsetParent); t&&t.click(); setTimeout(()=>li.click(),300);} ({stamp, notice: li?'등록 누름':(w?[...w.querySelectorAll('li')].map(l=>l.textContent.trim()).join('/'):'관리 메뉴 없음')})
   ```
   `notice` 가 '공지 해제/…' 면 이미 공지라 누르지 않은 것이다.
7. 2초쯤 뒤 javascript_tool: `[...document.querySelectorAll('.mini_mng_adminset li')].some(l=>l.textContent.trim()==='공지 해제')` → true 면 공지 등록 완료.
8. tabs_close_mcp 로 탭을 닫고, 6의 시각이 1의 시각과 같은지·공지가 걸렸는지 한 줄로 보고한다.

## 지켜야 할 것

- 로그인 화면·비밀번호 요구·캡차가 보이면 **입력하거나 풀지 말고** 멈춘 뒤 "디시 로그인이 필요합니다"라고 알린다.
- 디시 에디터는 **Summernote** 다. 'HTML' 체크박스나 보이는 코드 입력칸(`textarea.note-codable`)에 값을 넣어도
  제출에 반영되지 않는다(실측 실패). 반드시 `$('#memo').summernote('code', html)`.
- 제출 버튼은 보이는 `button.btn_lightpurple.write`('등록')다. 숨은 '수정'·'등록' 버튼이 여럿 있다.
- 글쓰기 요청을 직접 재전송하는 방식은 쓰지 않는다 — 페이지가 만드는 봇 방지 값(service_code 등)을 우회해야 해서다.
- 본문 내용(기능 표·최근 업데이트)을 바꾸려면 `app/admin/promo-html.ts`(관리자 버튼과 공용), 하단 카드는
  `scripts/dc-promo-footer.html`, 갱신 시각 줄은 `scripts/dc-promo-html.ts` 를 고친다.
- 매일 6시 예약 작업(`dc-promo-daily`)은 2026-10-07 지웠다 — 예약 작업은 매번 새 세션이라 권한이 풀리고 모델을 고를 수 없어서,
  생각날 때 이 스킬로 돌리기로 했다(사용자 결정).
