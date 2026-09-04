---
name: autochess-season
description: 위수 협의(오토체스·명토체스) 새 시즌을 /autochess 에 붙이는 절차. "위수 협의 시즌3 들어왔어", "명토체스 새 시즌 반영해줘", "롤토 새 시즌" 같은 요청에 사용. 지난 시즌 보기(시즌 전환기)도 이 구조를 쓴다.
---

# 위수 협의 새 시즌 붙이기

새 시즌은 **구조가 그대로고 안의 기물·맹약·밴드만 갈린다** (사용자 정리 2026-09-05).
그래서 이 스킬은 "무엇을 고쳐야 하는지"를 다시 찾는 데 시간을 쓰지 않게 하는 것이 목적이다 —
**아래 5단계만 순서대로 하면 끝난다.**

시즌 전환 기능은 2026-09-05에 들어갔다 (사용자 요청 "예전 맹약 어땠는지 궁금해하는
사람들도 많더라"). 최신 시즌은 파일명이 그대로고 지난 시즌만 `-s<N>` 이 붙는다 —
그래서 새 시즌이 오면 **옛 최신본이 자동으로 지난 시즌 자리로 내려간다.**

## 0. 먼저 이해할 것 — 여기서 헛짚기 쉽다

| | 사실 | 왜 중요한가 |
|---|---|---|
| 데이터 위치 | 별도 표가 아니라 `activity_table` 안 `activity.AUTOCHESS_SEASON.act<N>autochess` | 새 표를 찾으러 가지 말 것 |
| 시즌 목록 정본 | 최상위 `autoChessData.versionInfoDict` (`V<시즌>_<단계>` → `activityId`) | **손으로 적지 않는다.** 새 시즌이 들어오면 저절로 늘어난다 |
| 시즌 간 관계 | 같은 id 인데 **수치가 갈아엎어진다** (시즌1↔2 실측: 밴드 29/29 · 맹약 18/18 · 기물 195/200 변경) | 시즌을 섞어 참조하면 **틀린 숫자**가 나간다 |
| `autoChessData` | 시즌 **union** (밴드 41 = 시즌1 30 + 시즌2 신규 11) | 지난 시즌을 구워도 밴드 해금 조건·특훈 적 유형 이름은 **현재 값**이 나온다 (이름·조건 수준이라 그대로 둔다) |
| 중섭 | 미래시 전용이라 `activity_table` 을 **안 받는다** (14표 세트에 없다) | 중섭에 새 시즌이 있는지 보려면 `--tables activity_table` 로 일회성 수신 후 스크래치에서 볼 것. CDN 디코딩은 스키마 불일치로 실패하니 레포 폴백을 쓴다 (2026-09-05 실측) |

## 1. 새 시즌이 들어왔는지 확인

```bash
python3 -c "
import json
at=json.load(open('.gamedata/kr_activity_table.json',encoding='utf-8'))
print(json.dumps(at['autoChessData']['versionInfoDict'], ensure_ascii=False, indent=1))
print(list(at['activity']['AUTOCHESS_SEASON']))
"
```
`V3_1` 처럼 새 번호가 보이면 시즌3이 들어온 것이다. 안 보이면 **아직 없는 것** — 게임은
그 콘텐츠가 열리는 패치에서야 활동 데이터를 넣는다 (2026-09-05: 중섭조차 시즌3이 없었다).

## 2. 데이터·아이콘 굽기 — 명령 두 줄

```bash
python3 scripts/build-autochess.py --all          # 지난 시즌까지 전부 (데이터 + 아이콘)
python3 scripts/build-autochess-routes.py --all   # 전투 맵도 전부
```

`--all` 은 `autoChessData.versionInfoDict` 에서 시즌을 읽어 **시즌마다 프로세스를 새로 띄운다**
(두 스크립트 다 최상위 코드가 한 시즌 전제라 한 프로세스에서 두 번 못 돈다).
산출:

```
app/data/autochess{,.en,.ja}.json          ← 최신 시즌 (이름 안 바뀐다)
app/data/autochess-s1{,.en,.ja}.json       ← 지난 시즌
app/data/autochess-s2{,.en,.ja}.json       ← 새 시즌이 오면 옛 최신본이 여기로 내려온다
app/data/autochess-seasons.json            ← 시즌 목록 (화면 전환기가 읽는다)
app/data/autochess-routes.json             ← 최신 시즌 전투 맵
app/data/autochess-s1-routes.json          ← 지난 시즌 전투 맵
public/ac/…                                ← 새로 생긴 아이콘만 받는다 (있는 건 건너뛴다)
```

**KR/EN/JA 를 한 번에 낸다** — `build-i18n.py` 를 따로 돌리지 않는다 (CLAUDE.md 규칙 자체 충족).

### 나오는 경고 중 정상인 것
- `⚠ 맹약 victoriaShip: 블랙보드에 atk_normal_equip 없음 (BOND_CONST)` — 시즌1의 빅토리아
  맹약은 그 상수를 안 쓴다. **숫자를 지어내지 않고 건너뛴 것**이라 정상이다.
  새 시즌에서 이 경고가 뜨면 그 맹약의 상수 키가 바뀐 것이니 `BOND_CONST` 를 원문과
  대조해 갱신할지 판단한다 (모르면 그냥 두는 게 맞다 — 없는 숫자를 만들지 않는다).
- `건너뜀: …(weight 0)` — 그 시즌에서 안 뽑히는 전장이다.

## 3. 화면에 새 시즌 잇기 — **고칠 곳 4파일뿐**

나머지(메뉴 부메뉴 · `/autochess/<slug>` 라우트 · 사이트맵 · SEO 문구)는 전부
`app/data/autochess-seasons.json` 을 읽어 저절로 늘어난다. **손댈 곳은 여기뿐이다.**

| 파일 | 고치는 것 |
|---|---|
| [app/autochess.tsx](../../../app/autochess.tsx) `AC_ROUTE_IMPORT` | 최신 줄을 `-s<N>-routes` 로 내리고 새 번호가 접미사 없는 파일을 가리키게 — 예: `2: () => import("./data/autochess-s2-routes.json"), 3: () => import("./data/autochess-routes.json")` |
| [app/autochess-ko.tsx](../../../app/autochess-ko.tsx) | `import s2 from "./data/autochess-s2.json"` 로 내리고, 새 시즌을 `import s3 from "./data/autochess.json"` 으로. `SEASON_DOCS` 에 `3: s3` 추가 |
| [app/autochess-en.tsx](../../../app/autochess-en.tsx) | 같은 것, `.en.json` |
| [app/autochess-ja.tsx](../../../app/autochess-ja.tsx) | 같은 것, `.ja.json` |

⚠ **최신 시즌 줄도 같이 고쳐야 한다** — 옛 최신본이 `-s<N>` 으로 내려가며 파일명이 바뀐다.

⚠ 시즌 데이터는 **정적 임포트로 둔다** (지연 로드로 바꾸지 말 것). `/autochess/s1` 은
프리렌더된 정적 페이지라 지연 로드로 두면 **그 HTML에 최신 시즌 내용이 박혀 색인된다.**
이 청크 자체가 위수 협의 탭을 열 때만 받아지므로 첫 화면 번들에는 영향이 없다.

시즌 고르기는 [app/autochess-seasons.tsx](../../../app/autochess-seasons.tsx)(문서 고르기)와
`home.tsx`의 `switchAutochess`(주소·메뉴)로 갈려 있고 **손댈 일이 없다.**
`key={doc.season}` 로 가이드를 통째로 새로 마운트하는데, 편성 판·필터·열린 모달이 다른
시즌의 id 를 들고 넘어가지 않게 하려는 것이다 — 걷어내지 말 것.

⚠ **시즌 고르기는 메뉴 부메뉴에만 둔다.** 화면 안에도 전환 버튼을 뒀다가 사용자 지시로
걷어냈다 (2026-09-05 "페이지 안에 있는 시즌2 시즌1 버튼은 걍 없애줘") — 통합전략 테마·
생존연산 시즌과 같은 자리다. 다시 넣지 말 것.

i18n 은 이미 있다 (`"시즌 {n}"`, `"지난 시즌"`, `"종료된 시즌입니다 — …"`). 새로 넣을 문구 없음.

## 4. 검증

```bash
npm run build          # 0 에러
```

그다음 로컬(`npm run dev`, :3000)에서 **세 언어 다** 본다 — Playwright 로 훑어도 된다:

- [ ] 메뉴 → 가이드 → 위수협의 아래에 시즌이 **최신이 위**로 뜨고, 지난 시즌엔 '지난 시즌' 표식이 붙는가
- [ ] `/autochess/s<N>` 을 직접 열었을 때 **그 시즌 내용이 HTML에 들어 있는가** (프리렌더 확인)
- [ ] 지난 시즌엔 `종료된 시즌입니다 … 개최 기간 …` 안내와 **그 시즌 개최 기간**이 뜨는가
- [ ] 맹약 수가 시즌마다 다른가 (시즌1 18 · 시즌2 23 — 섞이면 잘못 물린 것이다)
- [ ] 게임 정보 → 전투 맵에서 그 시즌 전장 수가 맞는가 (시즌1 7 · 시즌2 8), 전장을 누르면 지형이 그려지는가
- [ ] 시즌을 오갔다 최신으로 돌아와도 편성 판·필터가 깨끗한가
- [ ] 콘솔 오류 0

## 5. 마무리

- `node scripts/r2-sync.mjs` — **새 아이콘이 생겼으면 필수** (안 하면 404).
- 빌드 확인 → 커밋 → `git push` 까지만. `bash scripts/deploy.sh` 자동 실행 금지 (CLAUDE.md).
  `public/sitemap.xml` 은 건드리지 않는다.
- 업데이트 내역은 **하루치를 최대한 하나로 묶어** 올린다 (커밋 1개 = 항목 1개 금지).
  area 는 `autochess`.

## 참고

- 데이터 규칙 정본: [scripts/build-autochess.py](../../../scripts/build-autochess.py) 최상단 docstring
- 시즌 해석 공용 모듈: [scripts/acseason.py](../../../scripts/acseason.py)
- 전투 맵 규칙: [route-map-rules](../route-map-rules/SKILL.md) — 렌더러는 `app/stage-route-map.tsx` 하나뿐이다
- 점검일 전체 절차: [kr-big-patch](../kr-big-patch/SKILL.md) / [cn-big-patch](../cn-big-patch/SKILL.md)
