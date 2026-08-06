#!/usr/bin/env node
// 직전 빌드들의 /assets 청크를 이번 배포에도 함께 올린다 (2026-08-06).
//
// 왜: 청크 파일명은 내용 해시라 재배포하면 옛 이름이 통째로 사라진다. Pages는 **현재
// 배포에 있는 파일만** 서빙하므로, 배포 순간에 열려 있던 탭이 물고 있는
// /assets/home-ko-<옛해시>.js 는 404(그것도 text/html인 404 페이지)가 되고 지연 로딩이
// 터진다 — 사용자 제보 "배포하면 30초~1분 접속이 안 되고 콘솔에 청크를 못 불러온다".
// layout.tsx의 자동 새로고침이 받아내지만, 애초에 옛 청크를 남겨 두면 새로고침조차 필요 없다.
//
// 방식: 로컬 캐시(.deploy-assets/)에 최근 KEEP회분 자산을 모아 두고, 이번 스테이지에 없는
// 것만 채워 넣는다. 같은 이름이면 **이번 빌드 것이 항상 우선**(덮어쓰지 않는다).
// 자산은 1회분이 48개·27MB 수준이라 3회분을 남겨도 파일 수·용량 모두 여유가 크다
// (Pages 배포당 20,000파일 한도, 현재 배포 3,225개).
//
//   node scripts/keep-assets.mjs <스테이지경로>
// deploy.sh가 wrangler 직전에 부른다. 실패해도 배포는 계속된다(부가 작업).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".deploy-assets");
const MANIFEST = join(CACHE, "manifest.json");
/** 몇 번의 배포까지 옛 청크를 남길지 — 3이면 직전 두 배포분이 살아 있다 */
const KEEP = 3;

const stage = process.argv[2];
if (!stage) { console.error("사용법: node scripts/keep-assets.mjs <스테이지경로>"); process.exit(1); }
const stageAssets = join(stage, "assets");
if (!existsSync(stageAssets)) { console.log("keep-assets: 스테이지에 assets가 없어 건너뜀"); process.exit(0); }

mkdirSync(CACHE, { recursive: true });
/** { 파일명: 몇 번째 배포 전에 마지막으로 등장했나 } — 0 = 이번 빌드 */
let ages = {};
try { ages = JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { ages = {}; }

const fresh = readdirSync(stageAssets).filter((f) => statSync(join(stageAssets, f)).isFile());
const freshSet = new Set(fresh);

// ① 나이 한 살씩 — 이번 빌드에 있는 건 0으로 되돌린다
const next = {};
for (const [file, age] of Object.entries(ages)) {
  const aged = freshSet.has(file) ? 0 : age + 1;
  if (aged < KEEP) next[file] = aged;
  else if (existsSync(join(CACHE, file))) rmSync(join(CACHE, file));   // 만료 — 캐시에서 제거
}
for (const file of fresh) next[file] = 0;

// ② 이번 빌드 자산을 캐시에 축적
for (const file of fresh) cpSync(join(stageAssets, file), join(CACHE, file));

// ③ 캐시에만 있는(=옛 배포) 자산을 스테이지에 채워 넣는다. 같은 이름은 건드리지 않는다.
let added = 0, bytes = 0;
for (const file of Object.keys(next)) {
  if (freshSet.has(file)) continue;
  const from = join(CACHE, file);
  if (!existsSync(from)) { delete next[file]; continue; }
  cpSync(from, join(stageAssets, file));
  added += 1; bytes += statSync(from).size;
}

writeFileSync(MANIFEST, `${JSON.stringify(next, null, 1)}\n`);
console.log(added > 0
  ? `keep-assets: 옛 청크 ${added}개(${Math.round(bytes / 104857.6) / 10}MB)를 함께 올린다 — 배포 순간 열려 있던 탭이 404를 안 맞는다 (최근 ${KEEP}회분 유지)`
  : `keep-assets: 남길 옛 청크 없음 (캐시 ${Object.keys(next).length}개, 최근 ${KEEP}회분 유지)`);
