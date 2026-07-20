// 결정론 리프레시 후 변경 감지 + 사람이 읽을 리포트 생성.
//
// - farm/costs/stories.json의 매일 바뀌는 `updated` 날짜만 다른 건 "무의미"로 보고
//   진짜 데이터가 바뀐 게 있을 때만 커밋·배포하도록 meaningful 플래그를 낸다.
// - 신규/삭제 오퍼레이터, 공채 풀 변동, 파밍 스테이지 개폐, 미실장(CN) 신규 오퍼,
//   파이프라인 경고(.ci/warnings.log)를 요약해 .ci/report.md에 쓴다 — 이메일 본문용.
//
// 출력: GITHUB_OUTPUT에 meaningful/subject 기록(있으면), .ci/report.md 파일.
// 사용: node scripts/ci-report.mjs [kr|cn]
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";

mkdirSync(".ci", { recursive: true });
const LANE = process.argv[2] || "kr";
const sh = (cmd) => execSync(cmd, { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
const gitShowHead = (path) => {
  try { return sh(`git show HEAD:${path}`); } catch { return null; } // 신규 파일
};
const parse = (txt) => { try { return JSON.parse(txt); } catch { return null; } };

// 최상위 `updated`(날짜)만 다른 건 무시하고 정규화 비교한다.
const stripVolatile = (obj) => {
  if (obj && typeof obj === "object" && !Array.isArray(obj) && "updated" in obj) {
    const { updated, ...rest } = obj; // eslint-disable-line no-unused-vars
    return rest;
  }
  return obj;
};
const meaningfulChange = (path) => {
  const oldTxt = gitShowHead(path);
  const newTxt = existsSync(path) ? readFileSync(path, "utf-8") : null;
  if (oldTxt === null) return newTxt !== null;            // 신규 파일 = 의미 있음
  if (newTxt === null) return true;                        // 삭제 = 의미 있음
  const a = parse(oldTxt), b = parse(newTxt);
  if (a === null || b === null) return oldTxt !== newTxt;  // JSON 아니면 바이트 비교
  return JSON.stringify(stripVolatile(a)) !== JSON.stringify(stripVolatile(b));
};

// ── 바뀐/신규 추적 파일 목록 ──────────────────────────────────────────
const changed = new Set();
try {
  sh("git diff --name-only HEAD -- app/data public")
    .split("\n").map((s) => s.trim()).filter(Boolean).forEach((f) => changed.add(f));
} catch { /* HEAD 없음 등 */ }
try {
  sh("git ls-files --others --exclude-standard -- app/data public")
    .split("\n").map((s) => s.trim()).filter(Boolean).forEach((f) => changed.add(f));
} catch { /* noop */ }

const dataFiles = [...changed].filter((f) => f.startsWith("app/data/") && f.endsWith(".json"));
const meaningfulData = dataFiles.filter(meaningfulChange);
const newAvatars = [...changed].filter((f) => f.startsWith("public/avatars/"));
const newStory = [...changed].filter((f) => f.startsWith("public/story/"));
const newItems = [...changed].filter((f) => f.startsWith("public/items/"));

const meaningful = meaningfulData.length > 0 || newAvatars.length > 0 || newStory.length > 0 || newItems.length > 0;

// ── 세부 요약: 오퍼/공채/파밍 diff ────────────────────────────────────
const lines = [];
const diffById = (path, keyer, labeler) => {
  const oldA = parse(gitShowHead(path) || "null");
  const newA = existsSync(path) ? parse(readFileSync(path, "utf-8")) : null;
  if (!Array.isArray(oldA) || !Array.isArray(newA)) return { added: [], removed: [] };
  const oldK = new Map(oldA.map((x) => [keyer(x), x]));
  const newK = new Map(newA.map((x) => [keyer(x), x]));
  const added = newA.filter((x) => !oldK.has(keyer(x))).map(labeler);
  const removed = oldA.filter((x) => !newK.has(keyer(x))).map(labeler);
  return { added, removed };
};

let newReleasedOpNames = [];  // 인프라 시너지 검토 안내용 (출시 오퍼만)
if (meaningfulData.includes("app/data/operators.json")) {
  const oldOps = parse(gitShowHead("app/data/operators.json") || "[]") || [];
  const oldIds = new Set(oldOps.map((o) => o.id));
  const curOps = parse(readFileSync("app/data/operators.json", "utf-8")) || [];
  newReleasedOpNames = curOps.filter((o) => !oldIds.has(o.id) && !o.unreleased).map((o) => o.name);
  const { added, removed } = diffById(
    "app/data/operators.json", (o) => o.id,
    (o) => `${o.name}${o.rarity ? ` (${o.rarity}★)` : ""}${o.unreleased ? " · 미실장(CN)" : ""}`);
  if (added.length) lines.push(`### 신규 오퍼레이터 ${added.length}명\n` + added.map((s) => `- ${s}`).join("\n"));
  if (removed.length) lines.push(`### 사라진 오퍼레이터 ${removed.length}명\n` + removed.map((s) => `- ${s}`).join("\n"));
  const unrel = (parse(readFileSync("app/data/operators.json", "utf-8")) || []).filter((o) => o.unreleased);
  const oldUnrel = new Set(((parse(gitShowHead("app/data/operators.json") || "[]")) || []).filter((o) => o.unreleased).map((o) => o.id));
  const newUnrel = unrel.filter((o) => !oldUnrel.has(o.id));
  if (newUnrel.length) lines.push(`> ⚠ 미실장(CN) 신규 ${newUnrel.length}명 — cn-translations.json 번역 필요 시 LLM 레인에서 처리`);
}

if (meaningfulData.includes("app/data/recruit.json")) {
  const oldR = parse(gitShowHead("app/data/recruit.json") || "null");
  const newR = parse(readFileSync("app/data/recruit.json", "utf-8"));
  const oldNames = new Set((oldR?.ops || []).map((o) => o.name));
  const newNames = new Set((newR?.ops || []).map((o) => o.name));
  const addedPool = [...newNames].filter((n) => !oldNames.has(n));
  const removedPool = [...oldNames].filter((n) => !newNames.has(n));
  if (addedPool.length) lines.push(`### 공채 풀 추가 ${addedPool.length}\n- ${addedPool.join(", ")}`);
  if (removedPool.length) lines.push(`### 공채 풀 제외 ${removedPool.length}\n- ${removedPool.join(", ")}`);
}

if (meaningfulData.includes("app/data/farm.json")) {
  const oldF = parse(gitShowHead("app/data/farm.json") || "null");
  const newF = parse(readFileSync("app/data/farm.json", "utf-8"));
  const oldS = new Set(oldF?.openStages || []);
  const newS = new Set(newF?.openStages || []);
  const opened = [...newS].filter((s) => !oldS.has(s));
  const closed = [...oldS].filter((s) => !newS.has(s));
  if (opened.length) lines.push(`### 파밍 스테이지 개방 ${opened.length}\n- ${opened.join(", ")}`);
  if (closed.length) lines.push(`### 파밍 스테이지 종료 ${closed.length}\n- ${closed.join(", ")}`);
}

// 그 외 바뀐 데이터 파일(수치·텍스트 갱신)은 목록만
const detailed = new Set(["app/data/operators.json", "app/data/recruit.json", "app/data/farm.json"]);
const otherData = meaningfulData.filter((f) => !detailed.has(f));
if (otherData.length) lines.push(`### 기타 갱신 데이터\n- ${otherData.map((f) => f.replace("app/data/", "")).join(", ")}`);
if (newAvatars.length) lines.push(`### 신규 아바타 ${newAvatars.length}개`);
if (newStory.length) lines.push(`### 신규 스토리 이미지 ${newStory.length}개`);

// ── 파이프라인 경고 (미번역 CN·미매칭 이름 등) ────────────────────────
let warnBlock = "";
if (existsSync(".ci/warnings.log")) {
  const warnLines = readFileSync(".ci/warnings.log", "utf-8").split("\n")
    .filter((l) => /WARN|경고|미번역|not matched|미매칭|未|译|fail|실패|Traceback|Error/i.test(l))
    .filter(Boolean);
  if (warnLines.length) {
    const shown = warnLines.slice(0, 40);
    warnBlock = `\n## ⚠ 파이프라인 경고 (${warnLines.length}건)\n` +
      "```\n" + shown.join("\n") + (warnLines.length > shown.length ? `\n… 외 ${warnLines.length - shown.length}건` : "") + "\n```";
  }
}

// ── 🖐 사람 손 필요 (세션 열어서 스킬 실행) ───────────────────────────
// 자동화가 못 하는(도메인 판단이 필요한) 일만 골라, 실행할 스킬을 콕 집어 안내한다.
const manual = [];
// 1) 테라 연대기 미등록 이벤트 — chronicle-register 스킬
try {
  const ch = parse(readFileSync("app/data/chronology.json", "utf-8"));
  const refs = new Set((ch?.entries || []).map((e) => e.ref).filter(Boolean));
  const st = parse(readFileSync("app/data/stories.json", "utf-8"));
  const evs = Array.isArray(st) ? st : st.events;
  // 미출시(CN 미래시) 이벤트는 연대기 대상이 아니다 — KR 출시(unreleased 해제) 후 등록한다.
  const gaps = evs.filter((e) => !refs.has(e.id) && !e.unreleased && !/^(rogue|main)/.test(e.id))
    .map((e) => `${e.id}${e.name?.ko ? ` (${e.name.ko})` : ""}`);
  if (gaps.length) manual.push(`### 테라 연대기 미등록 ${gaps.length}건 → \`chronicle-register\` 스킬\n` +
    gaps.map((g) => `- ${g}`).join("\n"));
} catch { /* 파일 없으면 스킵 */ }
// 2) 신규 출시 오퍼 인프라 시너지 검토 — planner-synergy-review 스킬 (특이 시너지 없으면 무시 가능)
if (newReleasedOpNames.length) {
  manual.push(`### 신규 오퍼 인프라 시너지 검토 → \`planner-synergy-review\` 스킬\n` +
    `- ${newReleasedOpNames.join(", ")}\n` +
    `  (스탯·스킬은 자동 파싱됨. 새 시너지 팟/토큰/특이 문구가 있을 때만 rules.json 규칙 추가가 필요)`);
}
// 3) 미실장(CN) 신규 오퍼·재료 번역 — 파이프라인 경고(未/译/미번역)가 잡히면 cn-translation-fill 스킬
if (/미번역|未|译/.test(warnBlock)) {
  manual.push(`### CN 신규 텍스트 번역 → \`cn-translation-fill\` 스킬\n` +
    `- 위 파이프라인 경고의 중국어 원문을 cn-translations.json에 채운 뒤 재생성`);
}
const manualBlock = manual.length
  ? `\n## 🖐 사람 손 필요 — 세션 열어서 \`/terra-maintain\` 스킬 하나만 실행\n\n` +
    `이 스킬이 아래 항목을 감지해 필요한 하위 스킬을 알아서 실행합니다 (개별 실행 불필요):\n\n` +
    `${manual.join("\n\n")}\n`
  : "";

// ── 리포트 조립 ──────────────────────────────────────────────────────
const laneLabel = LANE === "cn" ? "CN(미래시)" : "KR";
let subject;
if (!meaningful) {
  subject = `[테라아카이브 ${laneLabel}] 변경 없음`;
} else {
  const bits = [];
  const opAdd = lines.find((l) => l.startsWith("### 신규 오퍼레이터"));
  if (opAdd) bits.push(opAdd.match(/\d+/)[0] + "명 신규오퍼");
  if (lines.some((l) => l.startsWith("### 공채"))) bits.push("공채변동");
  if (lines.some((l) => l.startsWith("### 파밍"))) bits.push("파밍변동");
  subject = `[테라아카이브 ${laneLabel}] 데이터 갱신${bits.length ? " — " + bits.join("·") : ""}`;
}

const report = `# 테라 아카이브 데이터 리프레시 — ${laneLabel}\n\n` +
  (meaningful ? "**변경 사항이 있어 커밋·배포합니다.**\n\n" : "변경 사항 없음 (또는 날짜만 갱신) — 배포하지 않습니다.\n\n") +
  (lines.length ? lines.join("\n\n") + "\n" : "") +
  manualBlock +
  warnBlock + "\n";

writeFileSync(".ci/report.md", report);
writeFileSync(".ci/subject.txt", subject);

// 경고가 있으면 데이터 변경이 없어도 알림은 보낸다 (매일 "변경 없음" 도배 방지 겸,
// 미번역 CN·미매칭 이름 같은 손볼 거리를 놓치지 않기 위해).
const hasWarnings = warnBlock.length > 0;
const notify = meaningful || hasWarnings;

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `meaningful=${meaningful}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `notify=${notify}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `subject=${subject}\n`);
}
console.log(subject);
console.log(`meaningful=${meaningful} notify=${notify}  (data:${meaningfulData.length} avatars:${newAvatars.length} story:${newStory.length})`);
