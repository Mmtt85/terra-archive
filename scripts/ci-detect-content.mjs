// LLM 레인 감지 — "이미 시작됐는데 아직 AI 요약이 없는 이벤트"를 찾는다.
//
// stories.json(빌드가 만든 이벤트 목록, start = "YYYY-MM")과 story-summaries.json(요약 본문,
// 키 = 이벤트 id)을 비교해, 시작 시점이 지났는데 요약이 없는 사이드/이벤트를 낸다.
// rogue_N·메인은 요약 파이프라인이 다르므로 제외(수동/별도 레인).
//
// 출력: .ci/content-tasks.json + GITHUB_OUTPUT(has_tasks, count, ids), .ci/llm-task.md(Claude 프롬프트)
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";

mkdirSync(".ci", { recursive: true });
const load = (p) => JSON.parse(readFileSync(p, "utf-8"));
const stories = load("app/data/stories.json");
const events = Array.isArray(stories) ? stories : stories.events;
const summaries = load("app/data/story-summaries.json");

// 현재 연-월 (CI 러너 UTC 기준이면 충분 — 이벤트 start도 월 단위)
const now = new Date();
const curYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

// start "YYYY-MM" (또는 "YYYY-MM-DD") ≤ 현재월 이고, 요약이 없고, 사이드/이벤트 id인 것
const started = (e) => (e.start || "").slice(0, 7) <= curYM;
const isEventId = (id) => !/^(rogue_|rogue\d|main_|story_)/.test(id); // rogue/메인 제외
// 미출시(CN 미래시) 이벤트는 자동 요약에서 제외 — KR 스크립트가 없어(콜라보 등) 헤드리스
// 집필이 CN 원문에 의존하게 되므로 위험. KR 출시되면 unreleased가 풀려 자동 대상이 된다.
const pending = events.filter((e) => started(e) && isEventId(e.id) && !summaries[e.id] && !e.unreleased);

const tasks = pending.map((e) => ({ id: e.id, name: e.name?.ko || e.id, episodes: e.episodes, start: e.start }));
writeFileSync(".ci/content-tasks.json", JSON.stringify(tasks, null, 2));

// Claude에게 줄 프롬프트 작성 (스킬·파이프라인 문서 경로를 명시)
if (tasks.length) {
  const list = tasks.map((t) => `- \`${t.id}\` — ${t.name} (${t.episodes}화, ${t.start})`).join("\n");
  const prompt = `테라 아카이브 무인 유지보수 — 신규 이벤트 스토리 요약 자동 집필.

아래 이벤트들이 KR에 출시됐는데 아직 AI 스토리 요약(app/data/story-summaries.json)이 없다.
각 이벤트에 대해 **story-summary 스킬(.claude/skills/story-summary/SKILL.md)과 PROJECT-GUIDE §6.6을 정독하고**
그 절차를 정확히 따라 요약을 집필·추가하라:

${list}

필수 준수 사항 (어기면 롤백된다):
1. 시놉시스 짜깁기 절대 금지 — 반드시 스토리 스크립트 전문(public/story/script/<id>.json)을 정독하고 집필한다.
   스크립트가 없으면 \`python3 scripts/build-story-scripts.py <id>\`로 먼저 생성한다.
2. 집필 후 EN/JA 번역까지 완료한다 — story-i18n-setup → 번역 → story-i18n-merge
   (메모리 [[terra-archive-story-i18n-pipeline]] / PROJECT-GUIDE의 스토리 i18n 절차).
3. **환각 자체검증**: 요약을 다 쓴 뒤, 각 이벤트마다 요약의 인물명·지명·핵심 사건이
   스크립트 원문에 실제로 존재하는지 한 번 더 대조하라. 원문에 근거 없는 서술은 삭제한다.
4. story-summaries.json은 반드시 minified(separators=',':')로 저장한다 — pretty-print 금지.
5. 도메인 규칙(플레이어 호칭 '독타' 등)은 CLAUDE.md·메모리를 따른다.

집필이 끝나면 변경 파일을 git add 하되, 커밋·배포는 워크플로가 처리하므로 하지 마라.
완료한 이벤트 id와 각 요약의 근거(스크립트에서 확인한 핵심 사건)를 마지막에 요약 보고하라.`;
  writeFileSync(".ci/llm-task.md", prompt);
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `has_tasks=${tasks.length > 0}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `count=${tasks.length}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `ids=${tasks.map((t) => t.id).join(",")}\n`);
}
console.log(`content tasks: ${tasks.length}`, tasks.map((t) => t.id).join(", "));
