---
name: cn-small-patch
description: 중국서버 작은 패치(闪断更新 — 16시~16시10분 순단, 리소스만) 뒤 미래시 데이터를 가볍게 따라잡는 절차. "중섭 순단 있었어", "중섭 리소스 업뎃됐네", "중섭 뭐 바뀌었나 봐줘" 같은 요청에 사용. 클라 버전이 오르는 큰 패치는 cn-big-patch.
---

# 중국서버 작은 패치 대응 — 가볍게, 그러나 확인은 한다

중섭의 작은 패치는 **闪断更新**이다 — 서버를 세우지 않고 16:00~16:10(중국 표준시)
10분간 순단만 낸다. **한국시간으로는 17:00~17:10**이다 (중국 UTC+8, 한국 UTC+9 —
한섭 작은 점검이 16시인 것과 헷갈리지 말 것).

큰 패치 때 클라에 이미 들어와 있던 것을 **해금**하거나 리소스를 미리 받아 두는 것이
대부분이라 새 데이터가 없는 날도 많다. 그래도 **확인은 한다** — 아래 ⚠ 참조.

중섭이 무엇이고 무엇이 사이트에 닿는지는 [`cn-big-patch`](../cn-big-patch/SKILL.md)
맨 위 절이 정본. 여기서 반복하지 않는다.

전 과정에서 `bash scripts/deploy.sh`는 실행 금지 (CLAUDE.md).

---

## 1. 새 리소스가 올라왔나 (1초)

```bash
python3 scripts/fetch-gamedata-cdn.py --server cn --check
```

- **`resVersion`만 올랐다** → 작은 패치. 이 스킬 그대로.
- **`clientVersion`도 올랐다** → 큰 패치다. [`cn-big-patch`](../cn-big-patch/SKILL.md)로 넘어간다.
- **둘 다 그대로** → 데이터상 변화 없음. **없으면 없다고 보고**하고 끝낸다 —
  억지로 파이프라인을 돌리지 말 것.

> 2026-09-04 기준선: `26-08-17-11-25-42_dbc172` / client `2.7.61` / 배포 8/21 17:00 KST.

⚠ **"점검 없는 리소스 업데이트"도 콘텐츠를 싣는다.** 순단 공지가 안 떴다고 데이터가
안 바뀐 것이 아니다 — 판단은 공지가 아니라 위 `--check` 결과로 한다.
(중섭 공지 엔드포인트는 2025년 5월에서 멈춰 있다. `cn-big-patch` §1 참조.)

## 2. 받고 비교한다

```bash
python3 scripts/fetch-gamedata-cdn.py --server cn
python3 scripts/whatsnew-gamedata.py --local --server cn
```

여기서 **아무것도 안 나오면 그걸로 끝이다.** 커밋할 것도 없다.

⚠ **신규 항목만 보지 말 것.** 기존 항목이 속으로 바뀌는 경우가 있다 — 기존 오퍼에
모듈이 조용히 붙거나(`uniequip_table`), 인프라 스킬 수치가 바뀌거나(`building_data`).
whatsnew의 "변경" 줄을 신규 줄과 같은 무게로 읽는다.

## 3. 바뀐 게 있으면 반영

```bash
SKIP_FETCH=1 bash scripts/ci-refresh.sh fast     # 오퍼·다국어·프로필·모듈감사 (~40초)
```

> ⚠ **`SKIP_FETCH=1` 없이 돌리면 방금 받은 CDN 데이터가 클뜯 레포판으로 덮인다** —
> 레포는 며칠씩 밀리므로 조용히 옛 데이터로 사이트가 만들어진다.

`fast` 레인으로 충분한 것 — 신규 오퍼·모듈·프로필. 아래에 걸리면 `rest`까지 돌린다:

| whatsnew 신호 | 추가로 |
|---|---|
| `item_table` 신규 | `SKIP_FETCH=1 bash scripts/ci-refresh.sh rest` (재료비용·파밍) |
| `building_data` 변경 | 〃 (인프라 + 플래너 회귀검증) |
| `skin_table` 신규 | `python3 scripts/build-skins.py` → `node scripts/r2-sync.mjs` |
| `sandbox_perm_table` 변경 | `python3 scripts/build-sandbox.py` |

## 4. 중국어 원문이 남았는지 — 작은 패치에서도 본다

신규 오퍼·재료가 하나라도 들어왔으면 텍스트는 중국어 원문 그대로다.

```bash
SKIP_FETCH=1 bash scripts/ci-refresh.sh fast 2>&1 | grep -Ei "미번역|未|译" | sort -u
```

걸리면 [`cn-translation-fill`](../cn-translation-fill/SKILL.md) 스킬로.

## 5. 마무리

```bash
npm run build
```

빌드 통과 → 커밋 → `git push`. **배포는 사용자가 직접.**
`public/sitemap.xml`은 건드리지 않는다 —
`git stash push -q public/sitemap.xml` → `git pull --rebase -q` → `git push -q` → `git stash pop -q`.

## 보고

작은 패치는 **"뭐가 열렸는지"**가 알맹이다. 데이터 변화가 없으면 그렇게 보고하고 끝낸다 —
없는 걸 지어내지 말 것. 변화가 있으면 신규 오퍼·모듈·재료를 **이름까지** 적고,
미래시 토글을 켜야 보인다는 점을 같이 알린다.
