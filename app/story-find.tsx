"use client";

// 대사 검색 — 스토리 대사 전체에서 글자로 찾아 그 줄의 리더기로 (제안 게시판 요청 2026-10-08:
// "스샷 레이더 외에 스크립트를 검색해서 찾는 기능"). 색인은 scripts/build-story-find.py.
//
// 대사 전체는 한국어만 압축 9MB라 통째로 받지 않는다 — ① 검색어의 글자 조각이 든 색인 조각
// (64개 중 몇 개, 하나 25KB 안팎)만 받아 후보 이야기를 좁히고 ② 후보의 대사 파일만 차례로 받아
// 실제로 맞춰 본다. 흔한 말("켈시")은 후보가 많으니 결과가 RESULT_CAP 줄을 넘으면 멈추고 '더 찾기'.
// 정규화·조각 규칙·해시는 build-story-find.py 와 자구까지 같아야 한다.

import { useEffect, useMemo, useRef, useState } from "react";
import { asset } from "./assets";
import { useI18n } from "./i18n";
import { ModalWindow } from "./modal-window";
import { useSearchInput } from "./search";

type LocText = { ko: string; en?: string; ja?: string };
type Meta = { ver: string } & Record<"ko" | "en" | "ja", { id: string; name: LocText }[]>;
/** [화, 줄, 화자, 대사] — 화·줄은 전문 JSON 의 eps[화].lines[줄] */
type Row = [number, number, string, string];
type Hit = { ep: number; line: number; who: string; text: string; at: [number, number] | null };
type Group = { id: string; name: string; hits: Hit[] };

const SHARDS = 64;
const RESULT_CAP = 80;   // 이만큼 모이면 멈추고 '더 찾기'
const STORY_CAP = 30;    // 한 이야기에서 보여 줄 줄 수 (나머지는 'n줄 더')
const KEEP = /[0-9a-z가-힣ぁ-ゖァ-ヺー一-鿿]/;

/** 정규화한 글자열 + 각 글자의 원문 위치 (강조 표시를 원문에 되돌려 칠하려고) */
function normMap(s: string): { n: string; pos: number[] } {
  const low = s.toLowerCase();
  let n = "";
  const pos: number[] = [];
  for (let i = 0; i < low.length; i++) {
    const c = low[i];
    if (KEEP.test(c)) { n += c; pos.push(i); }
  }
  return { n, pos };
}
const norm = (s: string) => normMap(s).n;

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), 16777619);
    h = Math.imul(h ^ (c >>> 8), 16777619);
  }
  return h >>> 0;
}

/** 검색어 안에 온전히 든 조각 — 두 글자가 다 ASCII 면 3글자, 아니면 2글자 */
function gramsOf(s: string): string[] {
  const out = new Set<string>();
  for (let k = 0; k < s.length - 1; k++) {
    const n = s.charCodeAt(k) < 128 && s.charCodeAt(k + 1) < 128 ? 3 : 2;
    if (k + n <= s.length) out.add(s.slice(k, k + n));
  }
  return [...out];
}

let metaP: Promise<Meta> | null = null;
const loadMeta = () => (metaP ??= import("./data/story-find-meta.json").then((m) => (m.default ?? m) as unknown as Meta));
const jsonCache = new Map<string, Promise<unknown>>();
function getJson<T>(path: string, ver: string): Promise<T> {
  let p = jsonCache.get(path);
  if (!p) {
    p = fetch(`${asset(path)}?v=${ver}`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    p.catch(() => jsonCache.delete(path));   // 실패는 기억하지 않는다 — 다시 찾으면 다시 받는다
    jsonCache.set(path, p);
  }
  return p as Promise<T>;
}

export default function StoryFindWindow({ onClose, onOpen }: {
  onClose: () => void;
  /** 결과 줄을 누르면 — 그 이야기의 그 화·줄에서 리더기를 연다 */
  onOpen: (id: string, ep: number, line: number, name: string) => void;
}) {
  const { locale, t } = useI18n();
  const loc = (locale === "en" || locale === "ja" ? locale : "ko") as "ko" | "en" | "ja";
  const { term, inputProps, inputRef } = useSearchInput();
  const q = useMemo(() => norm(term), [term]);
  const ascii = /^[\x00-\x7f]*$/.test(q);
  const tooShort = q.length > 0 && q.length < (ascii ? 3 : 2);

  // 결과에는 어느 검색의 것인지 꼬리표(key)를 붙인다 — 검색어가 바뀌면 꼬리표가 어긋나 빈 결과로 보이므로
  // 이펙트에서 결과를 손으로 비울 필요가 없다 (동기 setState 금지 — react-hooks/set-state-in-effect)
  const key = `${loc}:${q}`;
  const [res, setRes] = useState<{ key: string; groups: Group[]; state: "busy" | "more" | "done" | "error" }>({ key: "", groups: [], state: "done" });
  const [open, setOpen] = useState<Record<string, boolean>>({});   // `${key}|${이야기}` → 줄 전부 펼침
  const searching = Boolean(q) && !tooShort;
  const groups = res.key === key ? res.groups : [];
  const state = !searching ? "idle" : res.key === key ? res.state : "busy";
  const put = (k: string, fn: (r: typeof res) => typeof res) =>
    setRes((r) => fn(r.key === k ? r : { key: k, groups: [], state: "busy" }));
  // 이어 찾기용 — 남은 후보와 지금 검색 번호(새 검색이 시작되면 옛 검색은 손을 뗀다)
  const run = useRef({ seq: 0, rest: [] as number[], meta: null as Meta | null, total: 0 });
  useEffect(() => { inputRef.current?.focus(); void loadMeta(); }, [inputRef]);

  const scan = async (seq: number, k: string, budget: number) => {
    const r = run.current;
    const meta = r.meta!;
    const list = meta[loc];
    let found = 0;
    while (r.rest.length && found < budget) {
      const batch = r.rest.splice(0, 4);
      const texts = await Promise.all(batch.map((si) =>
        getJson<Row[]>(`/story/find/${loc}/t/${list[si].id}.json`, meta.ver).catch(() => [] as Row[])));
      if (seq !== r.seq) return;
      const add: Group[] = [];
      batch.forEach((si, bi) => {
        const hits: Hit[] = [];
        for (const [ep, line, who, text] of texts[bi]) {
          const m = normMap(text);
          const at = m.n.indexOf(q);
          if (at < 0) continue;
          hits.push({ ep, line, who, text, at: [m.pos[at], m.pos[at + q.length - 1] + 1] });
        }
        if (hits.length) {
          const s = list[si];
          add.push({ id: s.id, name: (loc !== "ko" && s.name[loc]) || s.name.ko, hits });
          found += hits.length;
        }
      });
      if (add.length) {
        r.total += add.reduce((a, g) => a + g.hits.length, 0);
        put(k, (cur) => ({ ...cur, groups: [...cur.groups, ...add] }));
      }
    }
    if (seq === r.seq) put(k, (cur) => ({ ...cur, state: r.rest.length ? "more" : "done" }));
  };

  useEffect(() => {
    const seq = ++run.current.seq;
    if (!searching) return;
    void (async () => {
      try {
        const meta = await loadMeta();
        const grams = gramsOf(q);
        // 조각마다 그 조각이 든 이야기 — 교집합이 후보. 조각이 없으면(짧은 영문) 전부가 후보
        let cand = null as Set<number> | null;
        const posts = await Promise.all(grams.map((g) =>
          getJson<Record<string, number[]>>(`/story/find/${loc}/g/${fnv(g) % SHARDS}.json`, meta.ver)
            .then((shard) => shard[g] ?? [])));
        if (seq !== run.current.seq) return;
        for (const p of posts) {
          const s = new Set(p);
          cand = cand ? new Set([...cand].filter((x) => s.has(x))) : s;
          if (!cand.size) break;
        }
        // 이야기 번호가 곧 늘어놓을 순서다 (빌더가 한섭 최신 이벤트 → 메인 → 통합전략 → 미실장 순으로 매긴다)
        const rest = cand ? [...cand].sort((a, b) => a - b) : meta[loc].map((_, i) => i);
        run.current = { seq, rest, meta, total: 0 };
        await scan(seq, key, RESULT_CAP);
      } catch {
        if (seq === run.current.seq) put(key, (cur) => ({ ...cur, state: "error" }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 검색어·언어가 바뀔 때만 새로 찾는다
  }, [key, searching]);

  const more = () => {
    const seq = run.current.seq;
    put(key, (cur) => ({ ...cur, state: "busy" }));
    void scan(seq, key, RESULT_CAP).catch(() => { if (seq === run.current.seq) put(key, (cur) => ({ ...cur, state: "error" })); });
  };

  const total = groups.reduce((a, g) => a + g.hits.length, 0);
  return (
    <ModalWindow label={t("대사 검색")} className="operator-modal sf-modal" onClose={onClose}>
      <div className="sf-root">
        <div className="search-wrap sf-input">
          <span aria-hidden>⌕</span>
          <input {...inputProps} placeholder={t("대사 한 구절을 입력하세요")} aria-label={t("대사 검색")} />
        </div>
        <p className="sf-status" role="status">
          {tooShort ? t("두 글자 이상 입력하세요 (영문은 세 글자)")
            : state === "idle" ? t("스토리 대사 전체에서 찾습니다. 띄어쓰기·문장부호는 무시합니다.")
            : state === "error" ? t("검색 데이터를 받지 못했습니다 — 잠시 뒤 다시 시도해 주세요.")
            : state === "busy" && total === 0 ? t("찾는 중…")
            : total === 0 ? t("맞는 대사가 없습니다.")
            : t("{stories}편에서 {lines}줄", { stories: groups.length, lines: total })
              + (state === "more" ? ` · ${t("아직 다 찾지 않았어요")}` : state === "busy" ? ` · ${t("찾는 중…")}` : "")}
        </p>
        <div className="sf-list">
          {groups.map((g) => {
            const wide = open[`${key}|${g.id}`];
            const shown = wide ? g.hits : g.hits.slice(0, STORY_CAP);
            return (
              <section key={g.id} className="sf-group">
                <h4>{g.name}<small>{t("{n}줄", { n: g.hits.length })}</small></h4>
                <ul>
                  {shown.map((h) => (
                    <li key={`${h.ep}:${h.line}`}>
                      <button type="button" onClick={() => onOpen(g.id, h.ep, h.line, g.name)}>
                        <span className="sf-ep">{t("{n}화", { n: h.ep + 1 })}</span>
                        {h.who && <b>{h.who}</b>}
                        <span className="sf-text">
                          {h.at ? <>{h.text.slice(0, h.at[0])}<mark>{h.text.slice(h.at[0], h.at[1])}</mark>{h.text.slice(h.at[1])}</> : h.text}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {!wide && g.hits.length > STORY_CAP && (
                  <button type="button" className="sf-more-lines" onClick={() => setOpen((o) => ({ ...o, [`${key}|${g.id}`]: true }))}>
                    {t("{n}줄 더 보기", { n: g.hits.length - STORY_CAP })}
                  </button>
                )}
              </section>
            );
          })}
          {state === "more" && <button type="button" className="sf-more" onClick={more}>{t("더 찾기")}</button>}
        </div>
      </div>
    </ModalWindow>
  );
}
