---
name: about-shots
description: 소개(/about) 페이지 스크린샷 전면 재촬영·교체 절차. "소개 페이지 갱신", "소개 스샷 다시 찍어줘", "about 스크린샷 교체" 같은 요청에 사용. ko/en/ja × 라이트/다크 × 데스크탑/모바일 108장을 자동 촬영한다.
---

# 소개 페이지 스크린샷 재촬영 (/about)

소개 페이지는 각 기능 화면의 실제 캡처(webp)를 보여준다. UI가 눈에 띄게 바뀌면
(새 버튼·배지·레이아웃) 전면 재촬영해 교체한다. 절차는 전부 스크립트화돼 있다.

## 표준 절차 (3단계)

```bash
# 0) 최신 코드가 반영된 프로덕션 빌드가 전제 — 안 돼 있으면 npm run build 먼저
npm run start &                       # 로컬 프로덕션 서버 :3000 (반드시 프로덕션 — dev 아님)

# 1) 촬영 — ko/en/ja × light/dark × 데스크탑(1200×760)/모바일(440×952) × 9화면 = 108장 PNG (~5분)
node scripts/capture-about.mjs <임시출력폴더>

# 2) webp 변환·배치 — ko는 public/about/ 루트(기존 URL 유지), en/ja는 public/about/{en,ja}/
python3 scripts/convert-about.py <임시출력폴더>
```

끝나면 서버 종료(`pkill -f "vinext start"`) → `git status public/about`으로 108개 변경 확인 →
몇 장 열어 품질 확인(아래 체크리스트) → 커밋·push. **deploy.sh는 돌리지 않는다** (CLAUDE.md 규칙).

## 스크립트가 자동으로 처리하는 것 (다시 구현하지 말 것)

- **제안 버튼 숨김** (모바일 헤더 버튼·PC FAB·패널) — 소개 스샷에 노출 금지 (사용자 확정 2026-07-22)
- 첫 페인트 전 테마 고정(`ta-theme` localStorage) — 다크/라이트 플래시 방지
- 헤더 펼치기(접힘이 기본) — 진행중 이벤트·공식방송·미래시 토글까지 보이게
- 연대기 화면은 /stories 로드 후 탭 버튼 클릭(언어별 버튼 텍스트 매칭)
- 로케일 라우트: ko는 `/`, en/ja는 `/en`·`/ja` prefix

## 촬영 대상 (capture-about.mjs SHOTS)

portal(홈) · planner(/infra) · archive(/operators) · recruit · farm ·
upgrade(예시 오퍼 2명 쿼리) · story · rogue · chronicle(스토리→연대기 탭).
**새 기능 페이지가 생기면 SHOTS 배열에 추가**하고 about.tsx의 SHOT_MAP도 함께 갱신.

## 품질 체크리스트 (몇 장만 샘플 확인)

- 제안 버튼(💬)이 어디에도 안 보이는지
- 다크 파일(`-dark`)이 실제로 다크 테마인지 (플래시로 라이트가 찍히는 회귀 있었음)
- ko 화면에 최신 UI(새 버튼·새기능 배지)가 담겼는지 — 이게 재촬영의 이유
- en/ja 파일이 진짜 그 언어 UI인지 (ko 전용 기능 버튼은 en/ja에 없는 게 정상 — 스샷 레이더 등)

## 함정

- **dev 서버(:3000 IPv6)가 떠 있으면** 프로덕션은 127.0.0.1(IPv4)로 접속된다 — capture 스크립트는
  localhost라 충돌 시 dev 화면을 찍을 수 있음. dev를 끄거나 프로덕션만 띄우고 실행할 것.
- 방송·이벤트 배너는 fetch 타이밍에 따라 다르게 찍힐 수 있다 (1.8초 대기가 이미 들어 있음).
- upgrade 화면은 쿼리로 예시 오퍼(첸·애쉬)를 미리 채운다 — 쿼리 파라미터를 지우지 말 것.
