#!/usr/bin/env node
// 오퍼 지연 로딩 에셋 전수 검사 — "한쪽만 반영됐다"를 잡는다 (사용자 요청 2026-08-02).
//
//   node scripts/audit-assets.mjs          # 로컬 완결성만 (키 없어도 됨)
//   node scripts/audit-assets.mjs --r2     # + R2 원격 대조 (미동기 파일 잡아냄)
//
// 왜 필요한가: 이 사이트의 데이터는 **두 경로**로 나간다 (docs/PROJECT-GUIDE.md §7 참고).
//   ① 번들 — app/data/*.json 은 코드가 import 한다 → **배포해야** 반영
//   ② R2   — public/{avatars,skills,profiles,voice,skins,…} 는 fetch 한다 → **동기화만** 하면 반영
// 신규 오퍼 1명은 양쪽을 다 건드리므로 한쪽만 돌면 반쪽이 된다. 2026-08-01에 실제로 당했다:
// R2_SYNC_KEY가 없어 아바타가 안 올라갔는데 배포는 성공해서, 중섭 신규 4명이 도감에는
// 뜨는데 섬네일만 404였다. deploy.sh가 경고만 찍고 넘어갔기 때문에 아무도 몰랐다.
//
// 판정 기준은 데이터에서 유도한다 (기준선 파일을 두면 관리가 안 된다):
//   · 아바타      — 전원 필수
//   · 스킬 파일   — operators.json에 스킬이 있는 오퍼만 필수 (로봇·토큰은 스킬 0개라 정상 없음)
//   · 로케일 짝   — ko/en/ja 중 일부에만 있으면 무조건 버그 (프로필·보이스·스킨 공통)
//   · 프로필·보이스·스킨이 3개 로케일 모두 없는 것은 정상일 수 있어(예비 오퍼레이터 등)
//     개수만 알린다.
// 종료 코드는 항상 0 — 리포트용이라 파이프라인을 죽이지 않는다. 경고는 stderr로 낸다.

import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const API = "https://terra-archive-upload.nzkonaru.workers.dev";
const LOCALES = ["ko", "en", "ja"];

const ops = JSON.parse(readFileSync(join(ROOT, "app/data/operators.json"), "utf8"));
const has = (p) => existsSync(join(PUBLIC, p));

const errors = [];
const notes = [];

// ── 1. 아바타 — 전원 필수 ────────────────────────────────────────────────────
const noAvatar = ops.filter((o) => !has(`avatars/${o.id}.webp`));
if (noAvatar.length) {
  errors.push(`아바타 없음 ${noAvatar.length}명 — ${noAvatar.slice(0, 5).map((o) => o.name).join(", ")}`);
}

// ── 2. 스킬 파일 — 스킬이 있는 오퍼만 ────────────────────────────────────────
// ── 3. 로케일 짝 — 일부 로케일에만 있으면 버그 ──────────────────────────────
const partial = [];
const emptyAll = { skills: 0, profiles: 0, voice: 0, skins: 0 };
for (const kind of ["skills", "profiles", "voice", "skins"]) {
  for (const o of ops) {
    const found = LOCALES.filter((lc) => has(`${kind}/${lc}/${o.id}.json`));
    if (found.length === 0) {
      emptyAll[kind] += 1;
      if (kind === "skills" && (o.skills?.length ?? 0) > 0) {
        errors.push(`스킬 ${o.skills.length}개인데 레벨 파일이 없다: ${o.name} (${o.id})`);
      }
    } else if (found.length !== LOCALES.length) {
      partial.push(`${kind}/${o.id} — ${found.join("·")}만 있음`);
    }
  }
}
if (partial.length) {
  errors.push(`로케일 일부만 있는 파일 ${partial.length}건 — ${partial.slice(0, 4).join(" / ")}`);
}

// ── 4. R2 원격 대조 (--r2) ──────────────────────────────────────────────────
let r2Line = "R2 대조: 건너뜀 (--r2 없음)";
if (process.argv.includes("--r2")) {
  const KEY = process.env.R2_SYNC_KEY
    ?? (existsSync(join(ROOT, ".r2-sync-key")) ? readFileSync(join(ROOT, ".r2-sync-key"), "utf8").trim() : null);
  if (!KEY) {
    r2Line = "R2 대조: 키 없음 (.r2-sync-key 또는 R2_SYNC_KEY)";
    errors.push("R2 동기화 키가 없어 원격 대조를 못 했다 — 배포해도 에셋이 안 올라간다");
  } else {
    const res = await fetch(`${API}/files`, { headers: { "x-admin-key": KEY } });
    if (!res.ok) {
      r2Line = `R2 대조: 목록 조회 실패 (${res.status})`;
      errors.push(`R2 목록 조회 실패 (${res.status}) — 워커·시크릿 확인`);
    } else {
      const remote = new Map((await res.json()).files.map((f) => [f.key, f.etag]));
      const walk = async (dir) => {
        const out = [];
        for (const ent of await readdir(dir, { withFileTypes: true })) {
          const p = join(dir, ent.name);
          if (ent.isDirectory()) out.push(...(await walk(p)));
          else if (ent.isFile() && !ent.name.startsWith(".")) out.push(p);
        }
        return out;
      };
      // 오퍼 지연 데이터만 본다 — 스토리·OCR까지 훑으면 느리고, 여기서 잡고 싶은 건
      // "신규 오퍼를 넣고 r2-sync를 안 돌렸다"이다.
      const pending = [];
      for (const kind of ["avatars", "skills", "profiles", "voice", "skins"]) {
        const abs = join(PUBLIC, kind);
        if (!existsSync(abs)) continue;
        for (const p of await walk(abs)) {
          const key = "assets/" + relative(PUBLIC, p).split("\\").join("/");
          const md5 = createHash("md5").update(await readFile(p)).digest("hex");
          if (remote.get(key) !== md5) pending.push(key);
        }
      }
      r2Line = `R2 대조: 오퍼 에셋 ${pending.length}건 미동기`;
      if (pending.length) {
        errors.push(`R2에 안 올라간 오퍼 에셋 ${pending.length}건 — \`node scripts/r2-sync.mjs\` 를 돌릴 것`
          + ` (예: ${pending.slice(0, 3).join(", ")})`);
      }
    }
  }
}

console.log(`오퍼 ${ops.length}명 · 아바타 ${ops.length - noAvatar.length}개`);
console.log(`3개 로케일 모두 없음(정상일 수 있음): `
  + Object.entries(emptyAll).map(([k, v]) => `${k} ${v}`).join(" · "));
console.log(r2Line);
for (const n of notes) console.log("  " + n);

if (errors.length) {
  console.error("  ⚠ 에셋 검사: " + errors.join(" / "));
} else {
  console.log("✔ 에셋 이상 없음");
}
