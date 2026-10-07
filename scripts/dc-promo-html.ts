// 디시 소개글(미니갤 terra_archive no=5) 본문을 만들어 R2 에 올린다 — /admin 업데이트 내역 탭의 '소개글 HTML (링크 없음)'과
// 같은 내용 + 갱신 시각 + 글 맨 밑 사이트 링크 카드(scripts/dc-promo-footer.html, 사용자가 디시 에디터로 만든 그대로).
// 매일 아침 루틴이 쓴다 (사용자 지시 2026-10-07). 루틴(크롬)은 본문을 직접 다루지 않고, 디시 페이지 안에서
// files.terra-archive.net/uploads/dc-promo.html 을 받아 넣는다 — 본문 1만 3천 자가 모델을 거치지 않아 토큰이 적게 든다.
// 사용: npx tsx scripts/dc-promo-html.ts            → 올리고 주소 출력
//       npx tsx scripts/dc-promo-html.ts --print    → 올리지 않고 HTML 만 출력
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchAllChanges } from "../app/changelog-api";
import { buildPromoHtml } from "../app/admin/promo-html";

const ROOT = join(import.meta.dirname, "..");
const API = "https://terra-archive-upload.nzkonaru.workers.dev";   // r2-sync.mjs 와 같은 업로드 워커
const R2_KEY = "uploads/dc-promo.html";

const changes = await fetchAllChanges();
// 갱신 시각 — 글이 실제로 바뀌었는지 보는 표식 (사용자 지시 2026-10-07). 한국 시간, 분 단위
const at = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const stamp = `<div style="margin:14px 2px 0;font-size:12.5px;color:#6b7479;text-align:right;">마지막 갱신 · ${at} (한국 시간) · 자동 갱신</div>`;
const footer = readFileSync(join(ROOT, "scripts", "dc-promo-footer.html"), "utf8").trim();
const html = buildPromoHtml(changes, { updates: 5, days: 60, noLinks: true }) + stamp + footer;

if (process.argv.includes("--print")) {
  process.stdout.write(html);
} else {
  const key = process.env.R2_SYNC_KEY ?? (existsSync(join(ROOT, ".r2-sync-key")) ? readFileSync(join(ROOT, ".r2-sync-key"), "utf8").trim() : "");
  if (!key) throw new Error("동기화 키가 없습니다 — .r2-sync-key 또는 R2_SYNC_KEY");
  const res = await fetch(`${API}/files/${encodeURIComponent(R2_KEY)}`, {
    method: "PUT",
    headers: { "x-admin-key": key, "Content-Type": "text/html; charset=utf-8", "x-cache-control": "no-store" },
    body: html,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`올리기 실패 ${res.status}`);
  console.log(`올림 ${html.length}자 · ${at} → https://files.terra-archive.net/${R2_KEY}`);
}
