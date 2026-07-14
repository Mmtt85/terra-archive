---
name: story-summary
description: 명일방주 이벤트 스토리를 정독해 AI 스토리 요약 탭(story-summaries.json)에 요약을 집필·추가한다. "스토리 요약 추가해줘", "○○ 이벤트 요약해줘", "새 이벤트 스토리 정리" 같은 요청에 사용.
---

# AI 스토리 요약 집필

`app/data/story-summaries.json`에 이벤트 요약을 추가한다. 이벤트 목록·썸네일은
`scripts/build-story.py`가 자동 생성하지만, **요약 본문은 AI(Claude)가 스토리 스크립트
전문을 정독하고 직접 집필한다** — 시놉시스 짜깁기 금지, 반드시 원문을 읽을 것.
상세 규칙: [docs/PROJECT-GUIDE.md](../../../docs/PROJECT-GUIDE.md) §6.6.

## 절차

1. **대상 확인**: `app/data/stories.json`에서 이벤트 id 확인 (없으면
   `python3 scripts/build-story.py` 먼저 — 신규 이벤트 목록·썸네일 갱신).
2. **스크립트 다운로드**: 클뜯 레포 `kr/gamedata/excel/story_review_table.json`의
   해당 이벤트 `infoUnlockDatas[].storyTxt` 경로대로
   `kr/gamedata/story/<storyTxt>.txt`를 스크래치 폴더에 받는다 (에피소드 15~25개).
   ⚠ 일부 구 이벤트(예: act24side)는 kr 폴더에 스크립트가 없다 — cn밖에 없으면
   중국어 원문 기반 집필이 되므로 사용자에게 먼저 알릴 것.
3. **대사 추출**: `[name="X"] 대사` / 태그 없는 줄(나레이션) / `[Image(image=...)]`(컷씬
   위치)만 뽑아 플레인 텍스트로 변환 후 **storySort 순서대로 전부 정독**한다.
   에피소드마다 노트(인물·사건·명대사·개그 포인트·CG 위치)를 남겨가며 읽는다.
4. **컷씬 수집**: `python3 scripts/build-story.py --cuts <eventId>` →
   `public/story/cut/<name>.jpg`. 요약에 쓸 장면을 고른다.
4-1. **등장인물 스탠딩 CG**: `--chars <eventId>`로 스프라이트↔화자 매칭표를 뽑고,
   주역만 골라 `--chars <eventId> <스프라이트명…>`으로 다운로드
   (→ `public/story/char/<base>.png`, 표정 미지정 시 #1$1). summary JSON의 `chars`
   배열에 {name, desc(스포일러 없는 한 줄), img}로 넣으면 상세 상단에 갤러리로 표시된다.
   ⚠ 정체가 반전인 인물(예: act48side 이타코스의 부친)은 갤러리에 넣지 않는다.
   일부 스프라이트는 에셋 레포에 없다(404) — 그 인물은 빼면 된다.
5. **집필**: story-summaries.json에 이벤트 id 키로 추가.
   **문체·구조·컷씬 배치·감정선 설계는 [WRITING-GUIDE.md](WRITING-GUIDE.md)를 그대로
   따른다** (사용자 승인 방법론 — 반드시 먼저 읽을 것).

## 집필 규칙 요약 (상세: WRITING-GUIDE.md)

- **분량 5,500~9,000자** (본문+캡션 합산, 1만 자 미만 필수. 파이썬으로 실측).
- **구어체 해요체 + 한 문단 1~3문장** — 줄바꿈 자주. 개그 구간과 감정 구간의 문체를
  다르게 (감정 클라이맥스에는 농담 금지).
- **결말 포함 전체 스포일러** (UI가 스포일러 경고를 자동 표시).
- **컷씬은 원문 [Image] 태그가 붙은 장면을 서술하는 문단 옆에 배치**, 캡션 필수.
- **본문은 한국어 전용** — EN/JA 번역하지 않는다 (UI가 "한국어로만 제공" 안내 표시).
- 명대사는 quote 블록으로(리프레인·티키타카·주제 문장만). 과장·창작 금지.

## JSON 형식

```jsonc
"act48side": {
  "tagline": "한 줄 소개 (목록·상세 상단에 노출)",
  "blocks": [
    { "t": "h",     "x": "챕터 제목" },
    { "t": "p",     "x": "본문 문단 — **굵게** 지원(rich)" },
    { "t": "img",   "src": "/story/cut/69_i01.jpg", "cap": "캡션(선택)" },
    { "t": "quote", "who": "화자", "x": "명대사" }
  ]
}
```

## 마무리

- `npm run build` + eslint 통과 확인, 이미지 경로 존재 검증.
- **빌드 → 커밋 → 푸시까지만**. `scripts/deploy.sh` 자동 실행 금지 (배포는 사용자가 직접).
