"use client";

// 방문 통계 → 한 장짜리 리포트 이미지 (사용자 지시 2026-10-05 "이미지로 레포트 만들어 열기 버튼 … 기간은 지금 선택돼 있는 기간").
// 화면을 그대로 찍지 않고, 읽기 좋게 따로 짠 판(.vzr)을 화면 밖에 그려 PNG 로 바꾼 뒤 창에 띄운다 —
// 내 정보 '이미지로 내보내기'(me-share.tsx)와 같은 방식. 새 탭은 쓰지 않는다 (새 탭에서 이미지가 안 뜬 전례).
// 판은 관리자 테마와 무관하게 고정 색(밝은 판)이다 — 어디에 붙여도 같은 모양이어야 해서.

import { useEffect, useRef, useState } from "react";
import { ModalWindow } from "../modal-window";
import { usedFontCss } from "../me-share";
import { fmtDur, Heatmap, pathLabel, Sankey, SECTION_KO, type Summary } from "./visits";

const n = (v: number) => v.toLocaleString("ko-KR");
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const DEVICE: Record<string, string> = { desktop: "PC", mobile: "폰", tablet: "태블릿" };
const LANG: Record<string, string> = { ko: "한국어", en: "영어", ja: "일본어" };
const TZ: Record<string, string> = {
  "Asia/Seoul": "한국", "Asia/Tokyo": "일본", "Asia/Saigon": "베트남", "Asia/Ho_Chi_Minh": "베트남", "Asia/Jakarta": "인도네시아",
  "Asia/Shanghai": "중국", "America/Los_Angeles": "미국 서부", "America/New_York": "미국 동부", "Asia/Manila": "필리핀",
  "Asia/Taipei": "대만", "Asia/Singapore": "싱가포르", "Asia/Bangkok": "태국", "Asia/Hong_Kong": "홍콩", "Europe/London": "영국",
  "Etc/GMT-9": "UTC+9",
};
const SRC: Record<string, string> = { "duckduckgo.com": "덕덕고", "search.brave.com": "브레이브", "noai.duckduckgo.com": "덕덕고" };
// 관리자 화면의 짧은 이름표 → 리포트는 사이트 메뉴 이름 그대로 (밖에 보여 줄 이미지라)
const FULL: Record<string, string> = {
  인프라: "인프라 자동편성기", 공채: "공개채용 도우미", 파밍: "재료파밍 도우미", 육성: "육성 비용 계산기", 오퍼레이터: "오퍼 백과사전",
  작전: "작전 도감", 아이템: "아이템 도감", me: "내 정보", events: "이벤트", 시뮬레이터: "작전 시뮬레이터", 소개: "테라 아카이브 소개", "위수 협의": "위수협의",
};
const full = (label: string) => {
  const m = /^\/(?:en\/|ja\/)?autochess\/s(\d+)/.exec(label);
  if (m) return `위수협의 · 시즌 ${m[1]}`;
  const main = /^\/(?:en\/|ja\/)?stories\/main_(\d+)/.exec(label);
  if (main) return `스토리 · 메인 ${Number(main[1])}장`;
  const [head, ...rest] = label.split(" · ");
  return [FULL[head] ?? head, ...rest].join(" · ");
};
const pageName = (path: string) => full(pathLabel(path));
const featName = (head: string) => (head === "rogue" ? "통합전략" : full(SECTION_KO[head] ?? head));

type Row = [label: string, value: number, note: string];

function Bars({ rows, color, compact }: { rows: Row[]; color: string; compact?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className={`vzr-bars${compact ? " compact" : ""}`}>
      {rows.map(([label, value, note], i) => (
        <div key={`${label}-${i}`} className="vzr-bar">
          <span className="vzr-bl">{label}</span>
          <span className="vzr-bt"><i style={{ width: `${Math.max(1.5, (value / max) * 100)}%`, background: color }} /></span>
          <b>{n(value)}</b>
          <em>{note}</em>
        </div>
      ))}
    </div>
  );
}

/** 기간 표시 — '2026년 10월 4일 ~ 10월 5일' */
function periodText(from: string, to: string) {
  const f = (d: string, withYear: boolean) => {
    const [y, m, dd] = d.split("-").map(Number);
    return withYear ? `${y}년 ${m}월 ${dd}일` : `${m}월 ${dd}일`;
  };
  return from === to ? f(from, true) : `${f(from, true)} ~ ${f(to, from.slice(0, 4) !== to.slice(0, 4))}`;
}

/** tops — 관리자 화면 목록마다 고른 개수(상위 5·10·20·30)를 그대로 따른다 (사용자 지시 2026-10-05 "페이지 설정값에 맞춰서") */
type Tops = { src: number; landing: number; pages: number; sections: number; device: number; lang: number; tz: number; out: number };
function ReportCard({ data, from, to, who, onlyHuman, tops }: { data: Summary; from: string; to: string; who: string; onlyHuman: boolean; tops: Tops }) {
  const T = data.total;
  const sessions = Math.max(1, T.sessions);

  // 기능별 — 갈래 머리 단위로 모은다(모달·창 포함). 평균 조작은 조회 수로 가중
  const heads = new Map<string, { views: number; active: number }>();
  for (const s of data.sections) {
    let head = s.section.split(" #")[0];
    if (head.startsWith("rogue/")) head = "rogue";
    const cur = heads.get(head) ?? { views: 0, active: 0 };
    cur.views += s.views;
    cur.active += (s.avg_active ?? 0) * s.views;
    heads.set(head, cur);
  }
  const feats = [...heads.entries()].filter(([h]) => h !== "이탈" && h !== "기타").sort((a, b) => b[1].views - a[1].views);
  const allViews = Math.max(1, feats.reduce((a, [, v]) => a + v.views, 0));
  const featRows: Row[] = feats.slice(0, tops.sections).map(([h, v]) => [featName(h), v.views, `평균 ${fmtDur(v.active / Math.max(1, v.views))}`]);

  const srcRows: Row[] = data.src.slice(0, tops.src).map((s) => [SRC[s.src] ?? s.src, s.sessions,
    `세션당 ${(s.views / Math.max(1, s.sessions)).toFixed(1)}화면${s.med_visible != null ? ` · 머문 ${fmtDur(s.med_visible)}` : ""}`]);
  const outRows: Row[] = data.out.slice(0, tops.out).map((o) => [o.host, o.n, ""]);
  const landRows: Row[] = data.landing.slice(0, tops.landing).map((l) => [pageName(l.path), l.sessions, `바로 나감 ${pct(l.bounces, l.sessions)}`]);
  const share = (rows: { k: string | null; n: number }[], names: Record<string, string>, top = 7): Row[] => {
    const tot = Math.max(1, rows.reduce((a, r) => a + r.n, 0));
    return rows.slice(0, top).map((r) => [names[r.k ?? ""] ?? r.k ?? "알 수 없음", r.n, `${Math.round((r.n / tot) * 100)}%`]);
  };

  // 시간대 — 요일을 합쳐 24칸
  const hrs = Array<number>(24).fill(0);
  for (const [, h, c] of data.hours) if (h >= 0 && h < 24) hrs[h] += c;
  const peak = hrs.indexOf(Math.max(...hrs));

  // 한눈에 보기 — 수치에서 바로 나오는 것만 (해석을 지어내지 않는다)
  const top = feats[0];
  const google = data.src.find((s) => s.src === "구글");
  const direct = data.src.find((s) => s.src === "직접");
  const bounceTop = [...data.landing].filter((l) => l.sessions >= 10).sort((a, b) => b.bounces / b.sessions - a.bounces / a.sessions)[0];
  const langTot = data.site_lang.reduce((a, r) => a + r.n, 0);
  const foreign = data.site_lang.filter((r) => r.k !== "ko").reduce((a, r) => a + r.n, 0);
  const deep = [...data.src].filter((s) => s.sessions >= 10).sort((a, b) => b.views / b.sessions - a.views / a.sessions)[0];
  const insights: React.ReactNode[] = [];
  if (top) insights.push(<><b>{featName(top[0])}가 전체 화면 조회의 {pct(top[1].views, allViews)}</b>를 차지합니다 (모달·창 포함).</>);
  if (deep) insights.push(<><b>{SRC[deep.src] ?? deep.src} 유입이 세션당 {(deep.views / deep.sessions).toFixed(1)}화면</b>으로 가장 깊이 둘러봅니다{deep !== direct && direct ? ` (직접 방문 ${(direct.views / Math.max(1, direct.sessions)).toFixed(1)}화면)` : ""}.</>);
  else if (google) insights.push(<><b>구글 유입 {n(google.sessions)}세션</b> · 세션당 {(google.views / Math.max(1, google.sessions)).toFixed(1)}화면.</>);
  if (bounceTop) insights.push(<><b>{pageName(bounceTop.path)}로 들어온 방문의 {pct(bounceTop.bounces, bounceTop.sessions)}가 그 화면만 보고 나갑니다</b> — 첫 화면 중 가장 높습니다.</>);
  if (langTot) insights.push(<><b>영어·일본어 화면 이용 {pct(foreign, langTot)}</b> (세션 {n(foreign)}개).</>);
  if (onlyHuman && T.bots) insights.push(<><b>사람이 아닌 세션 {n(T.bots)}개를 걸러냈습니다</b> — 아래 수치는 모두 사람만 센 것입니다.</>);

  // 내 정보 로그인 수는 리포트에 싣지 않는다 (사용자 지시 2026-10-05)
  const days = data.days;

  return (
    <div className="vzr">
      <header className="vzr-head">
        <div>
          <h1>방문 통계 리포트</h1>
          <p>{periodText(from, to)} · {who} · 시각은 한국 시간</p>
        </div>
        <div className="vzr-brand">TERRA ARCHIVE<span>terra-archive.net</span></div>
      </header>

      {/* 관리자 화면 지표와 같은 아홉 칸 — 시간은 전부 중앙값 (2026-10-07 "리포트도 화면에 있는 건 전부") */}
      <section className="vzr-kpis">
        <div><span>방문자</span><b>{n(T.visitors)}</b><em>익명 방문자 수</em></div>
        <div><span>세션</span><b>{n(T.sessions)}</b><em>방문 횟수</em></div>
        <div><span>화면 조회</span><b>{n(T.views)}</b><em>모달·창 포함</em></div>
        <div><span>세션당 화면</span><b>{T.med_views != null ? (T.med_views % 1 ? T.med_views.toFixed(1) : n(T.med_views)) : (T.views / sessions).toFixed(1)}</b><em>중앙값</em></div>
        <div><span>세션당 조작 시간</span><b>{fmtDur(T.med_active ?? T.active_ms / sessions)}</b><em>실제로 만진 시간 · 중앙값</em></div>
        {T.med_visible != null && <div><span>세션당 머문 시간</span><b>{fmtDur(T.med_visible)}</b><em>화면이 떠 있던 시간 · 중앙값</em></div>}
        <div><span>재방문</span><b>{pct(T.revisit, T.sessions)}</b><em>세션 {n(T.revisit)}개</em></div>
        <div><span>한 화면만 보고 이탈</span><b>{pct(T.bounce, T.sessions)}</b><em>세션 {n(T.bounce)}개</em></div>
        <div><span>거른 세션</span><b>{n(T.bots)}</b><em>조작이 한 번도 없음</em></div>
      </section>

      {insights.length > 0 && (
        <section className="vzr-ins"><h2>한눈에 보기</h2><ul>{insights.map((x, i) => <li key={i}>{x}</li>)}</ul></section>
      )}

      {/* 가장 많이 본 화면은 한눈에 보기 바로 밑 (사용자 지시 2026-10-05) */}
      <section className="vzr-card vzr-top">
        <h2>많이 본 화면 TOP {Math.min(tops.pages, data.pages.length)}</h2><p className="vzr-hint">주소 단위 · 평균 조작 시간 · 스크롤은 화면을 내려 본 깊이(평균)</p>
        <table>
          <thead><tr><th /><th className="l">화면</th><th>조회</th><th>세션</th><th>평균 조작</th><th>스크롤</th></tr></thead>
          <tbody>
            {data.pages.slice(0, tops.pages).map((p, i) => (
            <tr key={p.path}><td>{i + 1}</td><td className="l">{pageName(p.path)}</td><td>{n(p.views)}</td><td>{n(p.sessions)}</td><td>{fmtDur(p.avg_active)}</td><td>{p.scroll != null ? `${p.scroll}%` : "–"}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="vzr-grid">
        <section className="vzr-card"><h2>기능별 이용</h2><p className="vzr-hint">화면 조회 수 (모달·창 포함) · 오른쪽은 한 번 볼 때 평균 조작 시간</p><Bars rows={featRows} color="#4f7a8c" /></section>
        <section className="vzr-card">
          <h2>어디서 왔나</h2><p className="vzr-hint">유입 경로별 세션 수 · 오른쪽은 세션당 본 화면 수</p><Bars rows={srcRows} color="#7c8f4a" />
          <h2 className="vzr-h2b">처음 들어온 화면</h2><p className="vzr-hint">첫 화면별 세션 수 · 그 화면만 보고 나간 비율</p><Bars rows={landRows} color="#8a7bb0" />
        </section>


        {/* 동선 흐름 (사용자 지시 2026-10-05) — 관리자 화면과 같은 흐름도, 이름표만 메뉴 이름으로 */}
        <section className="vzr-card wide vzr-flow">
          <h2>동선 흐름</h2><p className="vzr-hint">유입 → 첫 화면 → 두 번째 → 세 번째 · 띠 굵기 = 세션 수 · 같은 기능 안의 이동(모달 등)은 한 칸으로 셉니다</p>
          <Sankey flow={data.flow} nameOf={(l) => full(SRC[l] ?? l)} links={false} />
        </section>

        <section className="vzr-card wide vzr-heatcard">
          <h2>요일·시간대별 방문</h2><p className="vzr-hint">세션 시작 시각(한국 시간) · 진할수록 많음 · 가장 붐비는 때는 {peak}시</p>
          <Heatmap cells={data.hours} />
        </section>

        <section className="vzr-card wide vzr-three">
          <div><h2>기기</h2><p className="vzr-hint">세션 비율</p><Bars rows={share(data.device, DEVICE, tops.device)} color="#4f7a8c" compact /></div>
          <div><h2>사이트 언어</h2><p className="vzr-hint">세션 비율</p><Bars rows={share(data.site_lang, LANG, tops.lang)} color="#c39a3a" compact /></div>
          <div><h2>접속 지역</h2><p className="vzr-hint">브라우저 시간대 기준 상위 {tops.tz}</p><Bars rows={share(data.tz, TZ, tops.tz)} color="#7c8f4a" compact /></div>
          <div><h2>눌러서 나간 바깥 링크</h2><p className="vzr-hint">클릭 수</p>{outRows.length ? <Bars rows={outRows} color="#8a7bb0" compact /> : <p className="vzr-hint">없음</p>}</div>
        </section>

        {days.length > 1 && (
          <section className="vzr-card wide">
            <h2>날짜별</h2><p className="vzr-hint">세션 수 · 방문자 · 화면 조회</p>
            <Bars rows={days.slice(-14).map((x) => [`${x.day.slice(5, 7)}/${x.day.slice(8, 10)}`, x.sessions, `방문자 ${n(x.visitors)} · 화면 ${n(x.views)}`])} color="#4f7a8c" />
          </section>
        )}
      </div>
      <footer className="vzr-foot">
        <span>{onlyHuman ? "자동화 도구·크롤러로 보이는 세션(조작이 한 번도 없는 세션)은 뺐습니다." : who === "봇만" ? "조작이 한 번도 없는 세션(자동화 도구·크롤러로 보이는 것)만 센 수치입니다." : "사람과 자동화 도구·크롤러로 보이는 세션을 모두 센 수치입니다."}</span>
        <span>뽑은 시각 {new Date().toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short", hour12: false })}</span>
      </footer>
    </div>
  );
}

export function VisitsReport({ data, from, to, who, onlyHuman, tops, onClose }: { data: Summary; from: string; to: string; who: string; onlyHuman: boolean; tops: Tops; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    void (async () => {
      const el = ref.current?.firstElementChild as HTMLElement | null;
      if (!el) return;
      try {
        const { domToBlob } = await import("modern-screenshot");
        const b = await domToBlob(el, { scale: 2, type: "image/png", timeout: 1500, font: { cssText: usedFontCss(el) } });
        if (!alive) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      } catch { if (alive) setFailed(true); }
    })();
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, []);

  const save = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `terra-archive-visits-${from}${from === to ? "" : `_${to}`}.png`;
    a.click();
  };
  const copy = async () => {
    try {
      if (!blob) throw new Error("blob");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setMsg("이미지를 클립보드에 복사했습니다.");
    } catch { setMsg("이 브라우저에서는 복사할 수 없습니다 — PNG로 저장해 주세요."); }
  };

  return (
    <ModalWindow label="방문 통계 리포트" className="operator-modal vzr-modal" onClose={onClose}>
      <div className="vzr-wrap">
        <header className="vzr-bar-top">
          {msg && <span className="vz-muted">{msg}</span>}
          <div className="admin-tools">
            <button type="button" disabled={!blob} onClick={() => void copy()}>복사</button>
            <button type="button" className="selected" disabled={!url} onClick={save}>PNG 저장</button>
          </div>
        </header>
        <div className="vzr-stage">
          {url && <img className="vzr-img" src={url} alt="방문 통계 리포트" />}
          {!url && !failed && <p className="vz-muted">리포트 이미지 만드는 중…</p>}
          {failed && <p className="vz-muted">이미지로 바꾸지 못했습니다 — 아래 원판을 그대로 보여 줍니다.</p>}
          <div className={`vzr-src${failed ? " failed" : ""}`} ref={ref} aria-hidden={!failed}>
            <ReportCard data={data} from={from} to={to} who={who} onlyHuman={onlyHuman} tops={tops} />
          </div>
        </div>
      </div>
    </ModalWindow>
  );
}
