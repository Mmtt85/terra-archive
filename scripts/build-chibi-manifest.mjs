#!/usr/bin/env node
// 기지 치비(SD) 렌더 매니페스트 생성 — app/data/chibi.json (베타 2026-08-03)
//
// 소스: ArknightsAssets/ArknightsSpines @cn 브랜치 build/Relax/*.webm
//   — 기지 대기 모션을 VP9+알파 WebM으로 미리 렌더해 둔 공식 클뜯 계열 레포.
//   베타는 R2 이관 없이 jsDelivr CDN에서 그대로 스트리밍한다 (사이트 정본 에셋이 아니라
//   외부 미러 참조라는 뜻 — 정착하면 r2-sync 관할로 옮긴다).
// 변형(스킨) 이름: .gamedata/{kr,en,jp}_skin_table.json 의 skinId(char_xxx@suffix)와
//   파일명 suffix를 대조해 3개 언어 표시명을 박는다 (fetch-gamedata.py가 먼저 돌아 있어야 함).
//
//   node scripts/build-chibi-manifest.mjs        # app/data/chibi.json 재생성
//
// 산출 형식: { base, chars: { charId: [ { f, n?: [ko,en,ja] } ] } }
//   n 없음 = 기본 치비 (UI가 "기본 스킨"으로 표기), n의 빈 언어는 null → UI가 suffix로 폴백.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TREE_URL = "https://api.github.com/repos/ArknightsAssets/ArknightsSpines/git/trees/cn?recursive=1";
const BASE = "https://cdn.jsdelivr.net/gh/ArknightsAssets/ArknightsSpines@cn/build/Relax/";

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const res = await fetch(TREE_URL, { headers: { "User-Agent": "terra-archive" } });
if (!res.ok) throw new Error(`트리 조회 실패 (${res.status})`);
const tree = await res.json();
if (tree.truncated) throw new Error("트리가 잘렸다 — 페이지네이션 구현 필요");

const files = tree.tree
  .map((t) => t.path)
  .filter((p) => p.startsWith("build/Relax/") && p.endsWith(".webm"))
  .map((p) => p.slice("build/Relax/".length));

// 스킨 표시명: (charId@suffix 소문자) → [ko, en, ja]
const skinNames = new Map();
for (const [idx, table] of [["kr", 0], ["en", 1], ["jp", 2]].map(([code], i) => [i, `${["kr", "en", "jp"][i]}_skin_table.json`])) {
  let doc;
  try { doc = readJson(`.gamedata/${table}`); } catch { continue; }
  for (const skin of Object.values(doc.charSkins ?? {})) {
    const id = String(skin.skinId ?? "").toLowerCase();
    if (!id.includes("@")) continue;
    const name = skin.displaySkin?.skinName ?? null;
    if (!skinNames.has(id)) skinNames.set(id, [null, null, null]);
    skinNames.get(id)[idx] = name;
  }
}

const opIds = new Set(readJson("app/data/operators.json").map((op) => op.id));

const chars = {};
let matched = 0, unnamed = 0, skippedForeign = 0;
for (const file of files.sort()) {
  const lower = file.toLowerCase().replace(/\.webm$/, "");
  const m = /^build_(char_\d+_[a-z0-9]+)(?:_(.+))?$/.exec(lower);
  if (!m) { skippedForeign += 1; continue; }
  const [, charId, suffix] = m;
  if (!opIds.has(charId)) { skippedForeign += 1; continue; } // 오퍼가 아닌 렌더(적·NPC 등) 제외
  const entry = { f: file };
  if (suffix) {
    const names = skinNames.get(`${charId}@${suffix}`);
    if (names && names.some(Boolean)) { entry.n = names; matched += 1; }
    else { entry.n = [null, null, null]; unnamed += 1; } // UI가 suffix 원문으로 폴백
  }
  (chars[charId] ??= []).push(entry);
}
// 기본 치비 먼저, 스킨은 파일명순
for (const list of Object.values(chars)) list.sort((a, b) => (a.n ? 1 : 0) - (b.n ? 1 : 0) || a.f.localeCompare(b.f));

const out = { base: BASE, chars };
fs.writeFileSync(path.join(ROOT, "app/data/chibi.json"), JSON.stringify(out));
console.log(`chibi.json — 오퍼 ${Object.keys(chars).length}명 · 파일 ${files.length - skippedForeign}개 (스킨명 매칭 ${matched} · 미매칭 ${unnamed} · 제외 ${skippedForeign})`);
