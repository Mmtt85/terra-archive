# 스토리 요약 번역 지시 (하위 에이전트용 — 이벤트 하나, EN·JA)

저장소: /Users/byeonghoseong/Documents/workspace/terra-archive

1. `scripts/story-i18n/TRANSLATE.md` 를 끝까지 읽고 그대로 따른다 (구조 보존이 가장 중요). 용어집 `scripts/story-i18n/glossary.en.json`, `glossary.ja.json`, `common-terms.md` 를 참고한다.
2. 원본 `scripts/story-i18n/ko/<id>.json` → 출력 `scripts/story-i18n/en/<id>.json`, `scripts/story-i18n/ja/<id>.json`. 한국어 본문이 통째로 새로 쓰였으므로 기존 en/ja 파일은 **덮어쓴다**. 다만 덮어쓰기 전에 기존 파일의 chars/terms name 번역을 읽어, 같은 대상이면 같은 표기를 재사용한다(공식 표기와 어긋난 옛 표기는 공식 쪽으로 고친다).
3. 고유명사: glossary → `app/data/operators.en.json`·`operators.ja.json` 의 name → 게임 공식 글로벌/일본판 표기 순. 공식 표기가 없는 인물은 합리적으로 음역한다.
3-1. **별칭(alias)** — 한국어 별칭은 **그대로 앞에 둔다**(전문 보기 한국어 원문의 화자 매칭에 쓰인다). 그 **뒤에** 이 언어 본문에서 그 인물·용어를 부르는 짧은 이름·호칭을 덧붙인다 — 예 KO `["리사"]` → EN `["리사", "Lisa"]`, 카드 이름이 "Severin Hawthorn" 인데 본문에 "Severin" 만 나오면 `"Severin"` 추가. 본문에 글자 그대로 나오는 고유 호칭만(직함·일반 명사·대명사 금지, JA 두 글자 가타카나처럼 다른 낱말에 박히는 말 금지). 화면 밑줄이 이 목록으로 걸린다 (2026-10-04).
4. **말투는 한국어 본문의 문체를 따른다**:
   - 한국어가 평서체 '~다'(무거운 이벤트)면 → EN 은 농담·감탄 없이 짧고 담담한 서술, JA 는 だ・である調(常体). 한국어가 일부러 뺀 위트를 되살리지 않는다.
   - 한국어가 해요체면 → EN 은 친근한 해설체(농담은 살려서), JA 는 です・ます. 감정이 가라앉는 구간은 한국어처럼 차분하게.
   - 짧은 문단·여백의 호흡을 유지한다.
5. 끝나면 TRANSLATE.md 의 자기 점검과 JSON 파싱 확인을 하고, `python3 scripts/story-i18n-merge.py` 를 돌려 <id> 줄에 구조 오류(✗ 개수 불일치 등)가 없는지 본다. 다른 이벤트 때문에 '중단'이 떠도 정상이다(아무것도 쓰지 않는다). **`--publish` 는 돌리지 않는다.**
6. 위 두 출력 파일 말고 저장소의 다른 파일은 고치지 않는다. git 도 쓰지 않는다. 위임하지 않는다.

마지막 보고(한국어, 2줄): 두 파일을 썼는지 · <id> 구조 오류 유무 · 옛 표기를 공식 표기로 바꾼 것이 있으면 한 줄.
