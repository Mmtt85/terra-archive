"use client";

// 어드민 '방문' 탭 — 방문 동선 기록(docs/supabase-visits.sql · app/visit-track.ts)을 그래프로
// (사용자 요청 2026-10-04 "통계는 어드민 페이지에서 그래프화 시켜서"). 차트는 라이브러리 없이 SVG·CSS 로
// 직접 그린다(사용자 확정 — 의존성을 늘리지 않는다).
//
// 데이터는 같은 오리진 `/api/visits/rpc/<함수>` — 실서비스는 admin-api 워커, localhost 는 dev 프록시가
// 관리자 키를 붙여 방문 기록 전용 Supabase 프로젝트로 중계한다. 프로젝트가 아직 없으면 503 → 안내만 띄운다.
// 기간 7·30·90일은 원장에서, '1년'은 매일 밤 말아 둔 일별 집계표에서 읽는다. 원장은 기간으로 자르지 않고
// DB 가 80% 차면 오래된 것부터 지운다(docs/supabase-visits.sql visits_maintain).

import { useEffect, useMemo, useState } from "react";
import { Dropdown } from "../dropdown";
import operatorsData from "../data/operators.json";
import storiesData from "../data/stories.json";

type Kv = { k: string | null; n: number };
type FlowRow = { step: number; src: string; dst: string; n: number };
type Summary = {
  total: { sessions: number; visitors: number; views: number; active_ms: number; revisit: number; bounce: number; bots: number };
  days: { day: string; sessions: number; visitors: number; views: number; active_ms: number }[];
  src: { src: string; sessions: number; views: number; active_ms: number }[];
  ref: { ref: string; sessions: number }[];
  landing: { path: string; sessions: number; bounces: number }[];
  pages: { path: string; views: number; sessions: number; avg_active: number; med_active: number; exits: number; scroll: number | null }[];
  sections: { section: string; views: number; avg_active: number; exits: number }[];
  hours: [number, number, number][];
  /** 오늘 보기 전용 — 시작 시각(KST)의 시별 (옛 DB 함수엔 없다) */
  hourly?: { hr: number; sessions: number; visitors: number; views: number }[];
  device: Kv[]; site_lang: Kv[]; tz: Kv[];
  out: { host: string; n: number }[];
  flow: FlowRow[];
};
type TrendRow = { day: string; sessions: number; human_sessions: number; visitors: number; new_visitors: number; views: number; active_ms: number };
type SessView = { path: string; hash: string | null; t0: number | null; vis: number; act: number; scroll: number | null; out: string | null };
type SessRow = {
  id: string; at: string; src: string; ref: string | null; landing: string; device: string | null; site_lang: string | null;
  tz: string | null; revisit: boolean | null; human: boolean; utm: string | null; views: SessView[];
};

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/visits/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (res.status === 503) throw new Error("not-configured");
  if (!res.ok) throw new Error(`${name} 조회 실패 (${res.status})`);
  return res.json() as Promise<T>;
}

// ── 이름표 ─────────────────────────────────────────────────────────────────────

const OP_NAME = new Map((operatorsData as { id: string; name: string }[]).map((o) => [o.id, o.name]));
const STORY_NAME = new Map((storiesData as unknown as { events: { id: string; name: { ko: string } }[] }).events.map((e) => [e.id, e.name.ko]));
const SECTION_KO: Record<string, string> = {
  홈: "홈", operators: "오퍼레이터", stories: "스토리", enemies: "적 도감", stages: "작전", events: "이벤트",
  infra: "인프라", recruit: "공채", farm: "파밍", upgrade: "육성", items: "아이템", rogue: "통합전략",
  ra: "생존연산", autochess: "위수 협의", gallery: "갤러리", sim: "시뮬레이터", about: "소개",
};
const DEVICE_KO: Record<string, string> = { mobile: "폰", tablet: "태블릿", desktop: "PC" };
// 통합전략은 몇 번 테마인지가 제일 중요하다 (사용자 지시 2026-10-04) — 맨 /rogue 는 1번 테마가 열린다.
// 별명은 커뮤니티 호칭(omni.ts TOPIC_NICKS 첫 낱말), 화면 이름은 rogue.tsx viewsFor 와 같다.
const ROGUE_NICK = ["팬텀", "미즈키", "사미", "살카즈", "쉐이", "블랙플로우"];
const ROGUE_VIEW_KO: Record<string, string> = { map: "맵·노드", enemy: "적 도감", relic: "소장품", archive: "전시관", diff: "난이도", ending: "엔딩" };
function rogueLabel(slug: string): string {
  const n = Number(/^is(\d)$/.exec(slug || "is1")?.[1]);
  return n ? `통합전략 ${n} · ${ROGUE_NICK[n - 1] ?? ""}` : `통합전략 · ${slug}`;
}

function sectionLabel(s: string): string {
  const [head, hash] = s.split(" #");
  if (head.startsWith("rogue/")) return rogueLabel(head.slice(6)) + (hash ? ` · ${ROGUE_VIEW_KO[hash] ?? hash}` : "");
  return (SECTION_KO[head] ?? head) + (hash ? ` · 모달(${hash})` : "");
}
function pathLabel(path: string, hash?: string | null): string {
  const p = path.replace(/^\/(en|ja)(?=\/|$)/, "") || "/";
  const [, head = "", id = ""] = p.split("/");
  const key = decodeURIComponent(id);
  if (head === "rogue") {
    const m = hash && /^#rg-([a-z]+)(?:~[a-z]+~(.+))?$/.exec(hash);
    const tail = m ? ` · ${ROGUE_VIEW_KO[m[1]] ?? m[1]}${m[2] ? ` ${decodeURIComponent(m[2])}` : ""}` : hash ? ` ${hash}` : "";
    return rogueLabel(id) + tail;
  }
  const name =
    p === "/" ? "홈"
    : !id && SECTION_KO[head] ? SECTION_KO[head]
    : head === "operators" && OP_NAME.has(key) ? `오퍼 · ${OP_NAME.get(key)}`
    : head === "stories" && STORY_NAME.has(key) ? `스토리 · ${STORY_NAME.get(key)}`
    : decodeURIComponent(p);
  return name + (hash ? ` ${hash}` : "");
}
function fmtDur(ms: number | null | undefined): string {
  const s = Math.round((ms ?? 0) / 1000);
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분 ${s % 60}초`;
  return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
}
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const num = (n: number) => n.toLocaleString("ko-KR");

// ── 차트 ───────────────────────────────────────────────────────────────────────

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
}

/** 일별 꺾은선 — 빈 날은 0으로 채운다. 날짜 칸에 올리면(폰은 터치) 그날의 정확한 숫자 (사용자 지시 2026-10-04) */
const WEEK = "일월화수목금토";
function LineChart({ days, series, fmt = (d) => d.slice(5).replace("-", "/"), tip }: {
  days: string[]; series: { name: string; cls: string; values: number[] }[];
  fmt?: (label: string) => string;
  /** 숫자 상자의 머리글 — 기본은 '10/03 (금)' */
  tip?: (label: string) => string;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 960, H = 230, L = 44, R = 12, T = 12, B = 28;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const n = days.length;
  const x = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const every = Math.max(1, Math.ceil(n / 12));
  const step = n <= 1 ? W - L - R : (W - L - R) / (n - 1);
  const head = tip ?? ((d: string) => {
    const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(dt.getTime()) ? d : `${d.slice(5, 10).replace("-", "/")} (${WEEK[dt.getUTCDay()]})`;
  });
  return (
    <div className="vz-chart">
      <div className="vz-legend">
        {series.map((s) => <span key={s.name} className={s.cls}><i />{s.name}</span>)}
      </div>
      <div className="vz-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="추이" onMouseLeave={() => setHi(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f} className="vz-grid">
              <line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} />
              <text x={L - 6} y={y(max * f) + 4} textAnchor="end">{num(Math.round(max * f))}</text>
            </g>
          ))}
          {days.map((d, i) => (i % every === 0 || i === n - 1) && (
            <text key={d} className="vz-axis" x={x(i)} y={H - 8} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 && n > 1 ? "start" : "middle"}>{fmt(d)}</text>
          ))}
          {hi != null && <line className="vz-guide" x1={x(hi)} x2={x(hi)} y1={T} y2={H - B} />}
          {series.map((s) => (
            <g key={s.name} className={`vz-series ${s.cls}`}>
              <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={i === hi ? 4.5 : n > 45 ? 1.6 : 2.6} />
              ))}
            </g>
          ))}
          {/* 날짜 칸 전체가 올림 영역 — 작은 점을 정확히 노리지 않아도 된다 */}
          {days.map((d, i) => (
            <rect key={d} className="vz-hit" x={x(i) - step / 2} y={T} width={step} height={H - T - B}
                  onMouseEnter={() => setHi(i)} onPointerDown={() => setHi(i)} />
          ))}
        </svg>
        {hi != null && (
          <div className={`vz-tip${x(hi) > W * 0.62 ? " left" : ""}`} style={{ left: `${(x(hi) / W) * 100}%` }}>
            <b>{head(days[hi])}</b>
            {series.map((s) => <span key={s.name} className={s.cls}><i />{s.name} <em>{num(s.values[hi])}</em></span>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** 가로 막대 목록 */
function BarList({ rows, top, unit = "" }: { rows: { label: string; n: number; sub?: string; title?: string }[]; top: number; unit?: string }) {
  const total = rows.reduce((a, r) => a + r.n, 0);   // % 는 잘라 낸 뒤가 아니라 전체 기준
  rows = top ? rows.slice(0, top) : rows;
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="vz-empty">기록 없음</p>;
  return (
    <ol className="vz-bars">
      {rows.map((r) => (
        <li key={r.label} title={r.title ?? r.label}>
          <span className="vz-bar" style={{ width: `${(r.n / max) * 100}%` }} />
          <span className="vz-bar-label">{r.label}</span>
          {r.sub && <span className="vz-bar-sub">{r.sub}</span>}
          <span className="vz-bar-n">{num(r.n)}{unit} <small>{pct(r.n, total)}</small></span>
        </li>
      ))}
    </ol>
  );
}

/** 요일 × 시간 (KST) */
function Heatmap({ cells }: { cells: [number, number, number][] }) {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const [d, h, n] of cells) if (grid[d]) grid[d][h] += n;
  const max = Math.max(1, ...grid.flat());
  const CW = 36, CH = 20, L = 26, T = 16;
  return (
    <svg className="vz-heat" viewBox={`0 0 ${L + CW * 24} ${T + CH * 7}`} role="img" aria-label="요일·시간대별 방문">
      {Array.from({ length: 24 }, (_, h) => h % 3 === 0 && (
        <text key={h} className="vz-axis" x={L + h * CW + CW / 2} y={11} textAnchor="middle">{h}시</text>
      ))}
      {"월화수목금토일".split("").map((w, d) => (
        <g key={w}>
          <text className="vz-axis" x={L - 6} y={T + d * CH + 14} textAnchor="end">{w}</text>
          {grid[d].map((n, h) => (
            <rect key={h} x={L + h * CW + 1} y={T + d * CH + 1} width={CW - 2} height={CH - 2} rx={2}
                  style={{ fillOpacity: n ? 0.12 + 0.88 * (n / max) : 0.04 }}>
              <title>{`${w}요일 ${h}시 · ${num(n)}세션`}</title>
            </rect>
          ))}
        </g>
      ))}
    </svg>
  );
}

/** 흐름도 — 유입원 → 첫 화면 → 두 번째 → 세 번째. 칸마다 상위 7개만, 나머지는 '기타' */
function Sankey({ flow }: { flow: FlowRow[] }) {
  const TOP = 7;
  const W = 960, H = 380, NODE = 10, GAP = 8, LABEL = 150;
  const layout = useMemo(() => {
    const steps = [0, 1, 2];
    const raw = flow.filter((f) => steps.includes(f.step));
    // 칸 c 의 이름별 흐름량 (나가는 쪽·들어오는 쪽 중 큰 값)
    const tot = Array.from({ length: 4 }, () => new Map<string, number>());
    for (const f of raw) {
      tot[f.step].set(f.src, (tot[f.step].get(f.src) ?? 0) + f.n);
      tot[f.step + 1].set(f.dst, (tot[f.step + 1].get(f.dst) ?? 0) + f.n);
    }
    const keep = tot.map((m) => new Set([...m.entries()].filter(([k]) => k !== "이탈").sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k]) => k)));
    const norm = (c: number, k: string) => (k === "이탈" || keep[c].has(k) ? k : "기타");
    const links = new Map<string, { c: number; src: string; dst: string; n: number }>();
    for (const f of raw) {
      const src = norm(f.step, f.src), dst = norm(f.step + 1, f.dst);
      if (src === "이탈") continue;
      const key = `${f.step}|${src}|${dst}`;
      const cur = links.get(key) ?? { c: f.step, src, dst, n: 0 };
      cur.n += f.n;
      links.set(key, cur);
    }
    type Node = { c: number; k: string; inN: number; outN: number; v: number; y: number; h: number; inOff: number; outOff: number };
    const nodes = new Map<string, Node>();
    const node = (c: number, k: string) => {
      const id = `${c}|${k}`;
      if (!nodes.has(id)) nodes.set(id, { c, k, inN: 0, outN: 0, v: 0, y: 0, h: 0, inOff: 0, outOff: 0 });
      return nodes.get(id)!;
    };
    for (const l of links.values()) { node(l.c, l.src).outN += l.n; node(l.c + 1, l.dst).inN += l.n; }
    const cols = [0, 1, 2, 3].map((c) => [...nodes.values()].filter((n) => n.c === c));
    for (const n of nodes.values()) n.v = Math.max(n.inN, n.outN);
    const rank = (k: string) => (k === "이탈" ? 2 : k === "기타" ? 1 : 0);
    for (const col of cols) col.sort((a, b) => rank(a.k) - rank(b.k) || b.v - a.v);
    const maxSum = Math.max(1, ...cols.map((col) => col.reduce((a, n) => a + n.v, 0)));
    const maxCount = Math.max(1, ...cols.map((col) => col.length));
    const scale = (H - 24 - GAP * (maxCount - 1)) / maxSum;
    const colX = (c: number) => 4 + c * ((W - LABEL - 8) / 3);
    for (const col of cols) {
      let y = 22;
      for (const n of col) { n.y = y; n.h = Math.max(2, n.v * scale); y += n.h + GAP; }
    }
    const paths = [...links.values()].sort((a, b) => b.n - a.n).map((l) => {
      const s = node(l.c, l.src), d = node(l.c + 1, l.dst);
      const h = l.n * scale;
      const x0 = colX(l.c) + NODE, x1 = colX(l.c + 1), xm = (x0 + x1) / 2;
      const y0 = s.y + s.outOff, y1 = d.y + d.inOff;
      s.outOff += h; d.inOff += h;
      return { key: `${l.c}|${l.src}|${l.dst}`, n: l.n, src: l.src, dst: l.dst, exit: l.dst === "이탈",
        d: `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + h} C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h} Z` };
    });
    return { cols, paths, colX };
  }, [flow]);
  if (!layout.paths.length) return <p className="vz-empty">기록 없음</p>;
  const name = (c: number, k: string) => (c === 0 || k === "이탈" || k === "기타" ? k : sectionLabel(k));
  return (
    <svg className="vz-sankey" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="방문 동선 흐름">
      {["유입", "첫 화면", "두 번째", "세 번째"].map((t, c) => (
        <text key={t} className="vz-axis" x={layout.colX(c)} y={12}>{t}</text>
      ))}
      {layout.paths.map((p) => (
        <path key={p.key} d={p.d} className={p.exit ? "vz-link exit" : "vz-link"}>
          <title>{`${p.src} → ${p.dst} · ${num(p.n)}`}</title>
        </path>
      ))}
      {layout.cols.flat().map((n) => (
        <g key={`${n.c}|${n.k}`} className={n.k === "이탈" ? "vz-node exit" : "vz-node"}>
          <rect x={layout.colX(n.c)} y={n.y} width={NODE} height={n.h} />
          <text x={layout.colX(n.c) + NODE + 5} y={n.y + Math.min(n.h, 24) / 2 + 4}>
            {name(n.c, n.k)} <tspan className="vz-node-n">{num(n.v)}</tspan>
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── 목록 길이 — 모든 목록은 상위 5·10·20·50·100·전체, 기본 10, 바꾸면 이 브라우저에 남는다 (사용자 지시 2026-10-04) ──

const TOPS = [5, 10, 20, 50, 100, 0];   // 0 = 전체
const SESSIONS_ALL = 5000;                // 세션 타임라인 '전체'의 상한 (visits_sessions 도 5,000 에서 자른다)

function TopPick({ value, onChange, what }: { value: number; onChange: (n: number) => void; what: string }) {
  return (
    <Dropdown
      label={value ? `상위 ${value}` : "전체 보기"}
      items={TOPS.map((n) => ({ value: String(n), label: n ? `상위 ${n}` : "전체 보기" }))}
      selected={[String(value)]}
      onPick={(v) => onChange(Number(v))}
      ariaLabel={`${what} 보여 줄 개수`}
    />
  );
}

/** 제목 + (목록이면) 개수 고르기 */
function Head({ title, sub, top, setTop, children }: { title: string; sub?: string; top?: number; setTop?: (n: number) => void; children?: React.ReactNode }) {
  return (
    <div className="vz-head">
      <h3 className="vz-h">{title}{sub && <small> — {sub}</small>}</h3>
      <div className="vz-head-tools">
        {children}
        {top != null && setTop && <TopPick value={top} onChange={setTop} what={title} />}
      </div>
    </div>
  );
}

type TopKey = "src" | "ref" | "landing" | "pages" | "sections" | "devlang" | "tz" | "out" | "sessions";
const TOP_DEFAULT: Record<TopKey, number> = { src: 10, ref: 10, landing: 10, pages: 10, sections: 10, devlang: 10, tz: 10, out: 10, sessions: 10 };
const TOPS_KEY = "ta-admin-visit-tops";   // localStorage — 목록마다 고른 개수

function loadTops(): Record<TopKey, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(TOPS_KEY) ?? "{}") as Partial<Record<TopKey, number>>;
    const out = { ...TOP_DEFAULT };
    for (const k of Object.keys(out) as TopKey[]) if (TOPS.includes(saved[k] as number)) out[k] = saved[k] as number;
    return out;
  } catch { return { ...TOP_DEFAULT }; }
}

// ── 패널 ───────────────────────────────────────────────────────────────────────

function fillDays(days: Summary["days"], span: number) {
  const byDay = new Map(days.map((d) => [d.day.slice(0, 10), d]));
  const out: { day: string; sessions: number; visitors: number; views: number; active_ms: number }[] = [];
  const today = new Date(Date.now() + 9 * 3600_000);   // KST
  for (let i = span - 1; i >= 0; i--) {
    const key = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, sessions: 0, visitors: 0, views: 0, active_ms: 0 });
  }
  return out;
}

function SessionLine({ s }: { s: SessRow }) {
  const at = new Date(s.at);
  const when = at.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const last = s.views[s.views.length - 1];
  return (
    <li className={s.human ? "" : "bot"}>
      <header>
        <time>{when}</time>
        <b>{s.src}</b>
        {s.ref && s.ref !== s.src && <span className="vz-muted" title={s.ref}>{s.ref.replace(/^https?:\/\//, "").slice(0, 60)}</span>}
        {s.utm && <span className="vz-tag">utm:{s.utm}</span>}
        <span className="vz-tag">{DEVICE_KO[s.device ?? ""] ?? s.device}</span>
        {s.site_lang && s.site_lang !== "ko" && <span className="vz-tag">{s.site_lang}</span>}
        {s.revisit && <span className="vz-tag">재방문</span>}
        {!s.human && <span className="vz-tag warn">조작 없음</span>}
        {s.tz && s.tz !== "Asia/Seoul" && <span className="vz-muted">{s.tz}</span>}
      </header>
      <p className="vz-trail">
        {s.views.map((v, i) => (
          <span key={i}>
            {i > 0 && <i>→</i>}
            <span className="vz-step" title={`${v.path}${v.hash ?? ""} · 보인 ${fmtDur(v.vis)} · 조작 ${fmtDur(v.act)}${v.scroll != null ? ` · 스크롤 ${v.scroll}%` : ""}`}>
              {pathLabel(v.path, v.hash)} <small>{fmtDur(v.act || v.vis)}</small>
            </span>
            {v.out && <><i>↗</i><span className="vz-step out">{v.out.replace(/^https?:\/\//, "").slice(0, 40)}</span></>}
          </span>
        ))}
        {last && !last.out && <><i>→</i><span className="vz-step exit">이탈</span></>}
      </p>
    </li>
  );
}

export function VisitsPanel() {
  const [days, setDays] = useState<0 | 7 | 30 | 90 | 365>(0);   // 0 = 오늘 (KST 0시 00분부터) — 기본 (사용자 지시 2026-10-04)
  const [human, setHuman] = useState(true);
  const [data, setData] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<TrendRow[] | null>(null);
  const [sessions, setSessions] = useState<SessRow[] | null>(null);
  const [srcFilter, setSrcFilter] = useState<string>("");
  const [tops, setTops] = useState(TOP_DEFAULT);
  useEffect(() => { setTops(loadTops()); }, []);   // 하이드레이션 뒤에 저장값을 읽는다
  const top = (k: TopKey) => ({
    top: tops[k],
    setTop: (n: number) => setTops((t) => {
      const next = { ...t, [k]: n };
      try { localStorage.setItem(TOPS_KEY, JSON.stringify(next)); } catch { /* 프라이빗 모드 */ }
      return next;
    }),
  });
  const limit = tops.sessions || SESSIONS_ALL;
  const [status, setStatus] = useState("");
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  // 받아오는 중 표시 (사용자 지시 2026-10-04) — 요약·세션 두 갈래 중 하나라도 돌면 새로고침 버튼이 '불러오는 중'으로 바뀐다
  const [loadMain, setLoadMain] = useState(false);
  const [loadSess, setLoadSess] = useState(false);
  const busy = loadMain || loadSess;

  // 켜 둔 동안 1분마다 새로고침 (사용자 지시 2026-10-04, 5분 → 1분). 탭이 가려져 있으면 쉬었다가, 다시 보일 때 1분이 지났으면 곧바로.
  useEffect(() => {
    const EVERY = 60_000;
    let last = Date.now();
    const bump = () => { last = Date.now(); setTick((n) => n + 1); };
    const timer = setInterval(() => { if (document.visibilityState === "visible" && Date.now() - last >= EVERY) bump(); }, 5_000);
    const onVis = () => { if (document.visibilityState === "visible" && Date.now() - last >= EVERY) bump(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoadMain(true);
    const fail = (e: unknown) => {
      if (!alive) return;
      if ((e as Error).message === "not-configured") { setMissing(true); setStatus(""); }
      else setStatus(String((e as Error).message ?? e));
    };
    const done = () => { if (alive) setLoadMain(false); };
    if (days === 365) {
      rpc<TrendRow[]>("visits_trend", { p_days: 365 })
        .then((t) => { if (alive) { setTrend(t); setStatus(""); setLoadedAt(new Date()); } }).catch(fail).finally(done);
    } else {
      rpc<Summary>("visits_summary", { p_days: days, p_human: human })
        .then((d) => { if (alive) { setData(d); setStatus(""); setLoadedAt(new Date()); } }).catch(fail).finally(done);
    }
    return () => { alive = false; };
  }, [days, human, tick]);

  useEffect(() => {
    if (days === 365) return;
    let alive = true;
    setLoadSess(true);
    rpc<SessRow[]>("visits_sessions", { p_days: Math.min(days, 90), p_human: human, p_src: srcFilter || null, p_limit: limit })
      .then((s) => { if (alive) setSessions(s); }).catch(() => { if (alive) setSessions(null); })
      .finally(() => { if (alive) setLoadSess(false); });
    return () => { alive = false; };
  }, [days, human, srcFilter, limit, tick]);

  if (missing) {
    return (
      <section className="vz">
        <p className="admin-status">
          방문 기록 DB 가 아직 연결되지 않았습니다. 방문 기록 전용 Supabase 프로젝트를 만든 뒤{" "}
          <code>node scripts/make-visits-sql.mjs</code> 로 만든 <code>.visits-setup.generated.sql</code> 을 그 프로젝트의 SQL Editor 에서 실행하고,{" "}
          프로젝트 주소·anon 키를 <code>app/visit-track.ts</code> · <code>scripts/admin-dev-proxy.ts</code> · <code>workers/admin-api/wrangler.toml</code> 에 넣으세요 (docs/supabase-visits.sql 머리말).
        </p>
      </section>
    );
  }

  const t = data?.total;
  const filled = data ? fillDays(data.days, days) : [];
  return (
    <section className="vz">
      <div className="admin-tools vz-controls">
        {([0, 7, 30, 90, 365] as const).map((d) => (
          <button key={d} className={days === d ? "selected" : ""} onClick={() => setDays(d)}>{d === 0 ? "오늘" : d === 365 ? "1년(일별 집계)" : `${d}일`}</button>
        ))}
        <button className={human ? "selected" : ""} onClick={() => setHuman((h) => !h)} disabled={days === 365}
                title="세션 동안 스크롤·클릭·터치·키 입력이 한 번도 없으면 사람이 아닌 것으로 본다 (JS 를 도는 위장 크롤러 거르기)">
          {human ? "사람만" : "봇 포함"}
        </button>
        <button className={`vz-refresh${busy ? " busy" : ""}`} onClick={() => setTick((n) => n + 1)} disabled={busy} aria-busy={busy}>
          <span>새로고침</span>
          <span role="status"><i className="vz-spin" aria-hidden />불러오는 중</span>
        </button>
        {loadedAt && <span className="vz-muted vz-loaded">{loadedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })} 갱신 · 1분마다 자동</span>}
      </div>
      {status && <p className="admin-status">{status}</p>}

      {days === 365 ? (
        trend && (
          <>
            <h3 className="vz-h">일별 추이 (최근 1년 · 매일 밤 말아 둔 집계 — 오늘은 내일 반영)</h3>
            <LineChart days={trend.map((r) => r.day)} series={[
              { name: "세션(사람)", cls: "s1", values: trend.map((r) => r.human_sessions) },
              { name: "방문자", cls: "s2", values: trend.map((r) => r.visitors) },
              { name: "세션(전체)", cls: "s3", values: trend.map((r) => r.sessions) },
            ]} />
            <p className="vz-note">1년 보기는 추이만 있습니다 — 유입·페이지·동선의 원본은 DB 가 80% 차면 오래된 것부터 지워집니다.</p>
          </>
        )
      ) : data && t && (
        <>
          <div className="vz-kpis">
            <div><b>{num(t.visitors)}</b><span>방문자</span></div>
            <div><b>{num(t.sessions)}</b><span>세션</span></div>
            <div><b>{num(t.views)}</b><span>화면 조회</span></div>
            <div><b>{t.sessions ? (t.views / t.sessions).toFixed(1) : "–"}</b><span>세션당 화면</span></div>
            <div><b>{fmtDur(t.sessions ? t.active_ms / t.sessions : 0)}</b><span>세션당 조작 시간</span></div>
            <div><b>{pct(t.bounce, t.sessions)}</b><span>한 화면만 보고 이탈</span></div>
            <div><b>{pct(t.revisit, t.sessions)}</b><span>재방문</span></div>
            <div><b>{num(t.bots)}</b><span>거른 세션(조작 없음)</span></div>
          </div>

          {days === 0 ? (() => {
            // 오늘 — 시간대별 (KST 0시~지금, 세션 시작 시각 기준). 방문자·세션·화면 조회를 일별 추이와 같은 세 선으로
            const nowHour = new Date(Date.now() + 9 * 3600_000).getUTCHours();
            const hrs = Array.from({ length: nowHour + 1 }, (_, h) => h);
            const by = new Map((data.hourly ?? []).map((r) => [r.hr, r]));
            return (
              <>
                <Head title="오늘 시간대별" sub="KST 0시 00분부터 지금까지, 세션이 시작된 시각 기준" />
                <LineChart days={hrs.map(String)} fmt={(h) => `${h}시`} tip={(h) => `오늘 ${h}시대`} series={[
                  { name: "방문자", cls: "s1", values: hrs.map((h) => by.get(h)?.visitors ?? 0) },
                  { name: "세션", cls: "s2", values: hrs.map((h) => by.get(h)?.sessions ?? 0) },
                  { name: "화면 조회", cls: "s3", values: hrs.map((h) => by.get(h)?.views ?? 0) },
                ]} />
              </>
            );
          })() : (
            <>
              <h3 className="vz-h">일별 추이</h3>
              <LineChart days={filled.map((d) => d.day)} series={[
                { name: "방문자", cls: "s1", values: filled.map((d) => d.visitors) },
                { name: "세션", cls: "s2", values: filled.map((d) => d.sessions) },
                { name: "화면 조회", cls: "s3", values: filled.map((d) => d.views) },
              ]} />
            </>
          )}

          <div className="vz-cols">
            <div>
              <Head title="유입원" {...top("src")} />
              <BarList top={tops.src} rows={data.src.map((r) => ({ label: r.src, n: r.sessions, sub: `세션당 ${fmtDur(r.active_ms / Math.max(1, r.sessions))}` }))} />
              {data.ref.length > 0 && (
                <>
                  <Head title="경로까지 온 리퍼러" sub={`${data.ref.length}개`} {...top("ref")} />
                  <BarList top={tops.ref} rows={data.ref.map((r) => ({ label: r.ref.replace(/^https?:\/\//, ""), n: r.sessions, title: r.ref }))} />
                </>
              )}
            </div>
            <div>
              <Head title="첫 화면 (랜딩)" {...top("landing")} />
              <BarList top={tops.landing} rows={data.landing.map((r) => ({ label: pathLabel(r.path), n: r.sessions, sub: `바로 이탈 ${pct(r.bounces, r.sessions)}`, title: r.path }))} />
            </div>
          </div>

          <Head title="동선 흐름" sub="띠 굵기 = 세션 수. 줄에 올리면 수가 나온다" />
          <Sankey flow={data.flow} />

          <Head title="화면 순위" sub={`${data.pages.length}개 화면`} {...top("pages")} />
          <table className="vz-table">
            <thead>
              <tr><th>화면</th><th>조회</th><th>세션</th><th>평균 조작</th><th>중앙 조작</th><th>여기서 이탈</th><th>스크롤</th></tr>
            </thead>
            <tbody>
              {(tops.pages ? data.pages.slice(0, tops.pages) : data.pages).map((p) => {
                const maxV = data.pages[0]?.views || 1;
                return (
                  <tr key={p.path}>
                    <td title={p.path}><span className="vz-cellbar" style={{ width: `${(p.views / maxV) * 100}%` }} />{pathLabel(p.path)}</td>
                    <td>{num(p.views)}</td>
                    <td>{num(p.sessions)}</td>
                    <td>{fmtDur(p.avg_active)}</td>
                    <td>{fmtDur(p.med_active)}</td>
                    <td>{pct(p.exits, p.views)}</td>
                    <td>{p.scroll != null ? `${p.scroll}%` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="vz-cols">
            <div>
              <Head title="갈래별 (모달 포함)" {...top("sections")} />
              <BarList top={tops.sections} rows={data.sections.map((r) => ({ label: sectionLabel(r.section), n: r.views, sub: `평균 ${fmtDur(r.avg_active)}` }))} />
            </div>
            <div>
              <Head title="요일·시간 (KST)" />
              <Heatmap cells={data.hours} />
              <Head title="기기 · 사이트 언어" {...top("devlang")} />
              <BarList top={tops.devlang} rows={[...data.device.map((r) => ({ label: DEVICE_KO[r.k ?? ""] ?? String(r.k), n: r.n })),
                              ...data.site_lang.map((r) => ({ label: `언어 ${r.k ?? "?"}`, n: r.n }))]} />
            </div>
          </div>

          <div className="vz-cols">
            <div>
              <Head title="시간대 (나라 대신)" {...top("tz")} />
              <BarList top={tops.tz} rows={data.tz.map((r) => ({ label: r.k ?? "?", n: r.n }))} />
            </div>
            <div>
              <Head title="눌러서 나간 바깥 링크" {...top("out")} />
              <BarList top={tops.out} rows={data.out.map((r) => ({ label: r.host, n: r.n }))} />
            </div>
          </div>

          <Head title="세션 타임라인" sub="한 줄이 한 사람의 동선 · 최근 순. 시간은 조작 시간(없으면 보인 시간)" {...top("sessions")}>
            <Dropdown
              label={srcFilter || "유입원 전체"}
              items={[{ value: "", label: "유입원 전체" }, ...data.src.map((r) => ({ value: r.src, label: r.src, count: r.sessions }))]}
              selected={[srcFilter]}
              onPick={setSrcFilter}
              ariaLabel="세션 타임라인 유입원"
              scroll
            />
          </Head>
          {sessions == null ? <p className="vz-empty">불러오는 중…</p> : (
            <>
              <ol className="vz-sessions">{sessions.map((s) => <SessionLine key={s.id} s={s} />)}</ol>
              {!tops.sessions && sessions.length >= SESSIONS_ALL && <p className="vz-note">한 번에 {num(SESSIONS_ALL)}개까지만 보여 줍니다 — 기간을 줄이거나 유입원으로 거르세요.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}
