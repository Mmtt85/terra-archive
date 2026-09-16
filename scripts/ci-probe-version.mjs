// 점검 감시기 — 게임 CDN의 resVersion이 움직였는지만 본다 (몇 초짜리).
//
// 왜 (사용자 확정 2026-09-16): 데이터가 바뀌는 건 결국 **점검 때**다. 한섭 큰 점검
// (10시~16시)·작은 점검(16시~16시10분), 중섭 순단(17시~17시10분). 그런데 종전 무인 CI는
// "하루 세 번 정해진 시각"이라 점검이 끝나고도 한 시간을 놀았고, 무엇보다 클뜯 레포를
// 봐서 **볼 게 없었다** — 3개월간 신규 오퍼를 한 번도 못 들여왔다(전수 확인).
// 이제 CDN을 직접 보므로 게임과 동시에 알 수 있다. 시각이 아니라 **버전 변화**를 본다.
//
// 상태는 `.ci/resversion.json` 에 커밋해 둔다. 캐시가 아니라 레포에 두는 이유:
// 러너 캐시는 조용히 비워져서 헛발동을 부르고, 커밋해 두면 "언제 뭐가 움직였나"가
// 그대로 기록으로 남는다.
//
// 출력: GITHUB_OUTPUT 에 changed(true//false) · moved(움직인 서버 요약)
// 사용:  node scripts/ci-probe-version.mjs [--write]
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SERVERS = ["kr", "cn", "en", "jp"];
const STATE = ".ci/resversion.json";

const now = {};
const failed = [];
for (const srv of SERVERS) {
  try {
    const out = execFileSync("python3", ["scripts/fetch-gamedata-cdn.py", "--server", srv, "--check"],
      { encoding: "utf8", timeout: 120_000 });
    const m = out.match(/resVersion (\S+)/);
    if (m) now[srv] = m[1];
    else failed.push(`${srv}(파싱 실패)`);
  } catch (err) {
    // 한 서버가 죽어도 나머지는 본다 — CDN 일시 오류로 감시가 통째로 멈추면 안 된다
    failed.push(`${srv}(${String(err.message || err).slice(0, 40)})`);
  }
}

const prev = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const moved = SERVERS.filter((s) => now[s] && now[s] !== prev[s]);

for (const s of SERVERS) {
  const tag = moved.includes(s) ? "← 움직였다" : "";
  console.log(`  ${s.padEnd(3)} ${prev[s] ?? "(기록 없음)"} → ${now[s] ?? "(확인 실패)"} ${tag}`);
}
if (failed.length) console.log("  확인 실패:", failed.join(", "));

// 첫 실행(기록 없음)은 발동하지 않는다 — 기준선만 심는다. 안 그러면 네 서버가 한꺼번에
// '변했다'로 잡혀 쓸데없는 풀런이 돈다.
const first = Object.keys(prev).length === 0;
const changed = !first && moved.length > 0;

if (process.argv.includes("--write")) {
  mkdirSync(".ci", { recursive: true });
  writeFileSync(STATE, JSON.stringify({ ...prev, ...now }, null, 1) + "\n");
  console.log(first ? "기준선을 심었다 (이번엔 발동 안 함)" : "기준선 갱신");
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT,
    `changed=${changed}\nmoved=${moved.join(",")}\n`);
}
console.log(changed ? `발동: ${moved.join(", ")} 의 데이터가 새로 올라왔다` : "변화 없음");
