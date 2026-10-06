// 커뮤니티(디시 등) 소개글 HTML 생성기 (사용자 지시 2026-10-05 "어드민 페이지에 버튼 하나 … 누르면 룰에 따라서 HTML 코드
// 만들어내게. 새로운 기능이나 새로운 업뎃 내역 나오면 알아서 자동 갱신").
//
// 손으로 적는 목록이 없다 — 기능 표는 홈 화면 칸 정의(PORTAL_TILES), 최근 업데이트는 업데이트 내역 DB(changelog) 를
// 그대로 읽는다. 홈에 칸이 생기거나 내역이 올라오면 버튼만 다시 누르면 된다.
//
// 디시 'HTML로 쓰기'는 <style>·<script> 를 지운다 — 스타일은 전부 태그에 직접(inline) 넣고, 아코디언은 스크립트 없는
// <details>/<summary> 로 만든다 → 디시가 그 태그를 풀어 버려(2026-10-05 실측) 카드(div)로 바꿨다. <ul> 글머리표도 지워져 '·' 를 직접 쓴다.

import { PORTAL_TILES } from "../portal-themes";
import { tabHasNewFeature } from "../whats-new";
import type { ChangeRow } from "../changelog-api";
import rogueIndex from "../data/rogue-index.json";

const SITE = "https://terra-archive.net";
// 맨 위 배너 — 사용자가 /admin 파일 탭으로 올린 이격 스카디 배너 (2026-10-06, 종전 인프라 자동편성 배너는 'AI 티'로 교체).
// 링크 없는 판에도 그림은 싣는다(사용자 지시). 같은 이름으로 다시 올리면 캐시 때문에 최대 1일 늦게 바뀐다
const BANNER = "https://files.terra-archive.net/uploads/terra-archive-banner3-skadi-1280x408.jpg";
const bannerImg = `<img src="${BANNER}" alt="테라 아카이브" style="display:block;width:100%;height:auto;border-radius:12px;border:0;">`;
// 탭 → 주소 (home.tsx TAB_SEG 와 같은 값 — home.tsx 를 관리자 번들에 끌어오지 않으려고 따로 둔다)
const TAB_PATH: Record<string, string> = {
  planner: "/infra", archive: "/operators", enemy: "/enemies", stage: "/stages", item: "/items", gallery: "/gallery",
  recruit: "/recruit", farm: "/farm", upgrade: "/upgrade", sim: "/sim", story: "/stories", event: "/events",
  rogue: "/rogue", ra: "/ra", autochess: "/autochess", me: "/me", about: "/about",
};
// 업데이트 내역 area → 홈 칸 탭 (아이콘을 빌린다)
const AREA_TAB: Record<string, string> = {
  infra: "planner", archive: "archive", enemy: "enemy", stage: "stage", sim: "sim", recruit: "recruit", farm: "farm",
  upgrade: "upgrade", story: "story", rogue: "rogue", ra: "ra", autochess: "autochess",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 내역 본문의 **굵게** 만 살린다 */
const rich = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const mmdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

const C = {
  ink: "#1d2326", muted: "#6b7479", link: "#2f6a80", line: "#ebe9e2", soft: "#f4f3ef", accent: "#4f7a8c",
};
const h2 = (text: string, sub = "") =>
  `<div style="font-size:19px;font-weight:bold;margin:30px 0 10px;border-left:4px solid ${C.accent};padding-left:10px;">${text}${sub ? ` <span style="font-size:13px;font-weight:normal;color:${C.muted};">${sub}</span>` : ""}</div>`;

// noLinks — 디시가 주소가 든 글을 지워 버려서(사용자 2026-10-06) 링크·외부 이미지·도메인 글자를 다 뺀 판.
// 배너는 디시 이미지 첨부로 따로 올리고, 사이트는 '검색해서 오라'고만 안내한다.
export type PromoOptions = { updates: number; days: number; noLinks?: boolean };

export function buildPromoHtml(changes: ChangeRow[], opt: PromoOptions = { updates: 5, days: 60 }): string {
  const nl = !!opt.noLinks;
  // ── 기능 표 — 홈 칸 순서 그대로 (배너·동작 칸 제외), 소개는 맨 끝
  const tiles = PORTAL_TILES.filter((t) => t.tab && TAB_PATH[t.tab]);
  const ordered = [...tiles.filter((t) => t.tab !== "about"), ...tiles.filter((t) => t.tab === "about")];
  const iconOf = new Map(tiles.map((t) => [t.tab!, t.icon]));
  const rogueThemes = Object.keys(rogueIndex).map((k) => Number(k.split("_")[1])).filter(Boolean).sort((a, b) => a - b);
  const rows = ordered.map((t, i) => {
    const last = i === ordered.length - 1;
    const td = `padding:8px 10px;${last ? "" : `border-bottom:1px solid ${C.line};`}`;
    const isNew = tabHasNewFeature(t.tab!);
    const badge = isNew ? ` <span style="font-size:11px;color:#fff;background:#e5484d;border-radius:8px;padding:1px 6px;">NEW</span>` : "";
    let desc = esc(t.desc ? t.desc : "");
    if (t.tab === "rogue" && rogueThemes.length > 1) {
      desc += " · " + rogueThemes.map((n) => (nl ? `IS${n}` : `<a href="${SITE}/rogue/is${n}" target="_blank" style="color:${C.link};">IS${n}</a>`)).join(" · ");
    }
    const label = `${t.icon} ${esc(t.label)}${badge}`;
    const cell = nl ? `<b style="color:${C.link};">${label}</b>` : `<a href="${SITE}${TAB_PATH[t.tab!]}" target="_blank" style="color:${C.link};font-weight:bold;">${label}</a>`;
    return `  <tr><td style="${td}">${cell}</td><td style="${td}">${desc}</td></tr>`;
  }).join("\n");

  // ── 최근 업데이트 — 신기능·개선만, 최근 N일, 최신순(날짜 → seq). 첫 항목만 펼친 채로
  const since = new Date(Date.now() + 9 * 3600_000 - opt.days * 86400_000).toISOString().slice(0, 10);
  const recent = changes
    .filter((r) => (r.kind === "new" || r.kind === "improve") && r.released_at >= since)
    .sort((a, b) => (a.released_at < b.released_at ? 1 : a.released_at > b.released_at ? -1 : a.seq - b.seq))
    // 최신이 맨 위 (사용자 지시 2026-10-06 — 10-05 의 '최신이 맨 아래'를 되돌림)
    .slice(0, opt.updates);
  // 디시는 <details>/<summary> 를 풀어 버린다(스타일도 날아간다 — 2026-10-05 실측) → 테두리 카드(div)에 제목 + 짧은 요약.
  // 펼침이 없으니 본문은 '종전에는 …' 앞까지, 160자 안쪽으로 자른다
  const short = (body: string) => {
    let t = body.split(/\s*종전에는/)[0].trim();
    if (t.length > 160) t = `${t.slice(0, 160).replace(/\s+\S*$/, "")}…`;
    // 자르다 굵게(**) 가 반쪽만 남으면 닫아 준다
    if ((t.match(/\*\*/g) ?? []).length % 2) t = t.replace(/…$/, "**…");
    return t;
  };
  const updates = recent.map((r) => {
    const cut = r.ko.indexOf(" — ");
    const title = cut > 0 ? r.ko.slice(0, cut) : r.ko;
    const body = cut > 0 ? short(r.ko.slice(cut + 3)) : "";
    // 아이콘 — 기능 영역, 없으면(사이트 전반) 바로가기 주소의 기능
    const hrefTab = Object.entries(TAB_PATH).find(([, path]) => r.href && (r.href === path || r.href.startsWith(`${path}/`)))?.[0];
    const icon = iconOf.get(AREA_TAB[r.area ?? ""] ?? "") ?? (hrefTab && iconOf.get(hrefTab)) ?? "◆";
    const imp = r.important ? ` <span style="font-size:11px;color:#fff;background:#e5484d;border-radius:8px;padding:1px 6px;">중요</span>` : "";
    const link = r.href && !nl ? ` <a href="${SITE}${esc(r.href)}" target="_blank" style="color:${C.link};font-size:13px;white-space:nowrap;">바로 가기 ↗</a>` : "";
    return `<div style="margin:8px 0;border:1px solid #e3e1da;border-radius:10px;padding:10px 14px;background:#fff;">
  <div style="font-weight:bold;">${icon} ${rich(title)}${imp} <span style="color:${C.muted};font-weight:normal;font-size:13px;">${mmdd(r.released_at)}</span></div>
  ${body ? `<div style="margin-top:4px;font-size:14px;color:#3b4448;">${rich(body)}${link}</div>` : link ? `<div style="margin-top:4px;">${link}</div>` : ""}
</div>`;
  }).join("\n");

  const th = `text-align:left;padding:8px 10px;border-bottom:2px solid #d9d6cc;`;
  return `<div style="width:100%;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:${C.ink};line-height:1.7;font-size:15px;">

${nl ? bannerImg : `<a href="${SITE}" target="_blank">${bannerImg}</a>`}
<div style="margin:12px 2px 0;font-size:14.5px;color:#3b4448;">
  <b>테라 아카이브</b>는 명일방주 박사를 위한 비영리 팬 도구 모음입니다. 설치·회원가입 없이 웹에서 바로 쓰고, 게임 데이터를 직접 받아 점검 당일 최신으로 맞춥니다.
  ${nl ? `<b>구글·네이버에서 「테라 아카이브 명일방주」로 검색</b>해도 바로 나옵니다.` : `<a href="${SITE}" target="_blank" style="color:${C.link};font-weight:bold;">terra-archive.net ↗</a>`}
</div>

${h2("기능별 바로가기")}
<table style="width:100%;border-collapse:collapse;font-size:14px;">
  <tr style="background:${C.soft};"><th style="${th}width:34%;">기능</th><th style="${th}">한 줄 설명</th></tr>
${rows}
</table>
${nl ? `<div style="font-size:12.5px;color:${C.muted};margin-top:6px;">영어·일본어판은 사이트 오른쪽 위 언어 버튼(KO)으로 바꿀 수 있습니다</div>` : `<div style="font-size:12.5px;color:${C.muted};margin-top:6px;">영어·일본어판은 주소 앞에 /en, /ja 를 붙이면 됩니다 (예: terra-archive.net/en/infra)</div>`}

${recent.length ? `${h2("최근 업데이트")}\n${updates}` : ""}

${h2("알아 두면 좋은 것")}
<div style="margin:4px 0;padding-left:14px;text-indent:-14px;">· <b>미래시 데이터</b> — 헤더의 '미래시 데이터 포함'을 켜면 중국 서버에 먼저 나온 오퍼·재료·이벤트를 미리 볼 수 있습니다 (미실장 텍스트는 비공식 번역으로 표시)</div>
<div style="margin:4px 0;padding-left:14px;text-indent:-14px;">· <b>공유 링크</b> — 인프라 편성·육성 계획·위수협의 덱처럼 대부분의 화면은 주소에 상태가 담겨, 링크만 보내면 같은 화면이 열립니다</div>
<div style="margin:4px 0;padding-left:14px;text-indent:-14px;">· <b>업데이트 내역</b> — 사이트 헤더의 🛠 버튼에서 날짜별 변경 사항을 볼 수 있습니다</div>
<div style="margin:4px 0;padding-left:14px;text-indent:-14px;">· <b>데이터 갱신</b> — 한국 서버 점검 당일 게임 데이터를 직접 받아 반영합니다</div>

<div style="margin:26px 0 6px;padding:14px 16px;border-radius:10px;background:${C.soft};font-size:14px;">
  오류 제보·기능 제안은 사이트 각 화면의 <b>💬 피드백 버튼</b>이 가장 빠릅니다 (어느 화면에서 보냈는지 함께 전달됩니다).${nl ? "" : `<br>
  그 밖의 문의: <a href="mailto:contact@terra-archive.net" style="color:${C.link};">contact@terra-archive.net</a>`}
</div>

</div>
`;
}
