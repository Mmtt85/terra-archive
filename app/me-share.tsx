"use client";

// 내 정보 내보내기 — 공유용 요약 카드를 이미지로 만들어 모달에 띄운다 (사용자 지시 2026-10-04).
// 화면을 그대로 찍지 않는다 — 한 장에서 눈에 잘 들어오게 따로 짠 배치다(박사 정보 · 보유 · 육성 숫자 · 성급별 막대 ·
// 진행 상황 · 내가 만든 맞춤 칸 · 지원 유닛). 새 탭은 쓰지 않는다 (새 탭에서 이미지가 안 뜬 전례).
// 카드는 사이트 테마와 무관하게 고정 색(어두운 판)으로 그린다 — 이미지가 어디에 붙든 같은 모양이어야 해서다.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { asset } from "./assets";
import { useI18n, DT_LOCALE } from "./i18n";
import { ModalWindow } from "./modal-window";
import type { AccountChar } from "./account";
import { eliteText, masteryText, potText, WALLET_ROWS, type MeData } from "./me-store";
import type { ItemDoc } from "./items";
import { evalTile, tileLabel, useCustomTiles } from "./me-custom";
import type { StageDoc } from "./stage-data";
import { openChecker } from "./stage-open";
import qrcode from "qrcode-generator";

// 카드 안 그림 — R2 아바타는 CORS 로 받아야 이미지에 들어간다. ?cors 는 캐시 키를 갈라 그리드 <img> 가 남긴
// 무-CORS 응답을 재사용하지 않게 한다 (planner.tsx 편성표 이미지와 같은 규약)
const corsAvatar = (id: string) => `${asset(`/avatars/${id}.webp`)}?cors`;
const corsItem = (icon: string) => `${asset(`/items/icon/${icon}.webp`)}?cors`;
// 재화 칸은 늘 넣는다 (사용자 지시 2026-10-05 "재화도 내보낼 수 있게" → "켜건말건 보여줘" — '재화 포함' 체크는 걷어냈다)

type ShareOp = { id: string; name: string; rarity: number; modules: { id: string; type?: string }[] };

/** 카드에 실제로 쓰인 글자가 든 @font-face 만 — 한글 서체가 유니코드 범위별 조각 수십 개라 전부 넣으면 수십 초가 걸린다 */
function usedFontCss(el: HTMLElement): string {
  const cps = new Set<number>();
  for (const ch of el.innerText) cps.add(ch.codePointAt(0)!);
  const hits = (range: string) => range.split(",").some((part) => {
    const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
    if (!m) return true;
    const lo = parseInt(m[1].replace(/\?/g, "0"), 16);
    const hi = m[2] ? parseInt(m[2], 16) : m[1].includes("?") ? parseInt(m[1].replace(/\?/g, "F"), 16) : lo;
    for (const cp of cps) if (cp >= lo && cp <= hi) return true;
    return false;
  });
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const range = rule.style.getPropertyValue("unicode-range");
      if (range && !hits(range)) continue;
      const base = sheet.href ?? location.href;
      css += rule.cssText.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (_, u: string) => `url("${new URL(u, base).href}")`) + "\n";
    }
  }
  return css;
}

/** 정품 인증 QR — 검증 창 주소를 담는다. 이미지로 찍혀야 해서 <svg> 로 그린다 */
function QrSvg({ text, size }: { text: string; size: number }) {
  const qr = qrcode(0, "L");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} width={size} height={size} shapeRendering="crispEdges" aria-hidden>
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#151b1e" />
    </svg>
  );
}

export function MeShare({ me, owned, released, opById, stages, items, onClose }: {
  me: MeData; owned: AccountChar[]; released: ShareOp[]; opById: Map<string, ShareOp>; stages: StageDoc | null; items: ItemDoc | null; onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const fmt = useMemo(() => new Intl.NumberFormat(DT_LOCALE[locale]).format, [locale]);
  const layout = useCustomTiles();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 복사 완료는 토스트로 (사용자 지시 2026-10-05) — 인프라 플래너와 같은 .toast, 모달 위에 뜨게 body 로 띄운다
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  const inv = me.profile?.inventory;
  const wallet = useMemo(() => {
    if (!inv || !items) return null;
    const byId = new Map(items.items.map((i) => [i.id, i]));
    return WALLET_ROWS.flat().map((id) => ({ id, it: byId.get(id), n: inv[id] ?? 0 }));
  }, [inv, items]);

  const st = me.profile?.status;
  const rar = (c: AccountChar) => opById.get(c.id)?.rarity ?? 0;
  const six = released.filter((op) => op.rarity === 6).length;
  const sixOwned = owned.filter((c) => rar(c) === 6).length;
  const [now] = useState(() => Date.now());
  const days = st?.register ? Math.floor((now / 1000 - st.register) / 86400) + 1 : 0;
  const joined = st?.register ? new Date(st.register * 1000).toLocaleDateString(DT_LOCALE[locale], { year: "numeric", month: "long", day: "numeric" }) : "";
  const secretary = st?.secretary && opById.has(st.secretary) ? st.secretary : null;

  // 한눈에 보기 배치 그대로 (보유 오퍼·6성 보유는 위 큰 칸이 맡는다) — 기본 칸을 지우거나 고친 것도 따라간다
  const ctx = { owned, released, opById, profile: me.profile };
  const stats: [string, string][] = layout
    .filter((tile) => !(tile.kind === "builtin" && (tile.key === "owned" || tile.key === "six")) && tile.id !== "d-six")
    .filter((tile) => !(tile.kind === "builtin" && (tile.key === "skins" || tile.key === "medals") && !me.profile))
    .map((tile) => { const v = evalTile(tile, ctx); return [tileLabel(tile, t), v.total != null ? `${fmt(v.value)} / ${fmt(v.total)}` : fmt(v.value)]; });
  const rarityRows = [6, 5, 4, 3, 2, 1].map((r) => {
    const all = released.filter((op) => op.rarity === r).length;
    const n = owned.filter((c) => rar(c) === r).length;
    return { r, n, all };
  });
  const progress = useMemo(() => {
    const rec = me.profile?.stages;
    if (!stages || !rec) return null;
    const isOpen = openChecker(now);   // 지금 못 들어가는 작전은 미클리어·3성 미달성에서 뺀다 (진행 상황 카드와 같은 기준)
    let left = 0, star = 0, campDone = 0, camps = 0;
    for (const s of stages.stages) {
      if (s.id.startsWith("tr_") || s.sub) continue;
      if (s.t === "CAMPAIGN") { camps += 1; if ((me.profile?.campaigns[s.id] ?? 0) >= 400) campDone += 1; continue; }
      if (s.t !== "MAIN" && s.t !== "SUB" && s.t !== "ACTIVITY") continue;
      if (!isOpen(s)) continue;
      const state = rec[s.id] ?? -1;
      if (state < 2) left += 1; else if (state === 2) star += 1;
    }
    const next = me.profile?.status.progress ? stages.stages.find((s) => s.id === me.profile!.status.progress) : null;
    return { left, star, campDone, camps, next };
  }, [stages, me.profile, now]);
  // 정품 인증 — 동기화 때 워커가 서명한 코드. QR 은 /me#verify=… 검증 창을 연다
  const seal = me.profile?.seal ?? null;
  const verifyUrl = seal ? `https://terra-archive.net${locale === "ko" ? "" : `/${locale}`}/me#verify=${seal}` : null;
  const sealCode = seal ? seal.split(".")[1]?.slice(0, 8).toUpperCase().replace(/^(.{4})/, "$1-") : null;
  const assist = (me.profile?.assist ?? []).map((a) => ({ a, c: owned.find((c) => c.id === a.id), op: opById.get(a.id) })).filter((x) => x.c && x.op);

  // 카드가 그려지고 그림이 다 받아지면 이미지로 바꾼다
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setUrl(null); setBlob(null); setFailed(false);
    const run = async () => {
      const el = cardRef.current;
      if (!el) return;
      try {
        // 그림은 여기서 다 받아 둔다 — 변환기의 '불러오기 대기'는 다 받은 뒤에도 한도(timeout)를 꽉 채워
        // 기다리는 경우가 있어서(실측: 한도 8초면 8초, 기본 30초) 한도를 짧게 준다
        await Promise.all(Array.from(el.querySelectorAll("img")).map((img) => (img.complete ? null : img.decode().catch(() => null))));
        const { domToBlob } = await import("modern-screenshot");
        const css = usedFontCss(el);
        const b = await domToBlob(el, {
          scale: 2, type: "image/png", timeout: 1500,
          font: { cssText: css },
          fetch: { requestInit: { mode: "cors" } },
        });
        if (!alive) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      } catch { if (alive) setFailed(true); }
    };
    void run();
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
    // 카드 내용은 열 때 한 번 찍는다 — 작전 데이터(stages)·아이템 표(재화 그림)가 늦게 오거나 재화 칸을 켜고 끄면 다시
  }, [stages, wallet]);

  const save = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `terra-archive-${me.player.nickName || "doctor"}.png`;
    a.click();
  };
  const copy = async () => {
    try {
      if (!blob) throw new Error("blob");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setMsg(null);
      setToast({ text: t("이미지를 클립보드에 복사했습니다."), key: Date.now() });
    } catch { setMsg(t("이 브라우저에서는 복사할 수 없습니다 — PNG로 저장해 주세요.")); }
  };

  return (
    <ModalWindow label={t("이미지로 내보내기")} className="operator-modal me-share-modal" onClose={onClose}>
      <div className="me-share-wrap">
        <header className="me-share-bar">
          <div className="me-share-actions">
            <button type="button" className="import-action" disabled={!blob} onClick={() => void copy()}><span className="btn-icon" aria-hidden>⧉</span>{t("복사")}</button>
            <button type="button" className="import-action apply" disabled={!url} onClick={save}><span className="btn-icon" aria-hidden>⤓</span>{t("PNG 저장")}</button>
          </div>
        </header>
        {msg && <p className="me-note">{msg}</p>}
        {toast && createPortal(<div key={toast.key} className="toast me-share-toast" role="status">{toast.text}</div>, document.body)}
        <div className="me-share-stage">
          {url && <img className="me-share-img" src={url} alt={t("내 정보 요약 이미지")} />}
          {!url && !failed && <p className="me-note">{t("이미지 만드는 중…")}</p>}
          {/* 이미지의 원판 — 다 찍으면 안 보이게 둔다 (실패하면 이 판을 그대로 보여 준다) */}
          <div className={`me-share-src${url ? " done" : ""}${failed ? " failed" : ""}`} aria-hidden={!!url}>
            <div className="me-share" ref={cardRef}>
              <div className="me-share-head">
                <span className="me-share-av">{secretary && <img src={corsAvatar(secretary)} crossOrigin="anonymous" alt="" width={112} height={112} />}</span>
                <div>
                  <b className="me-share-name">{me.player.nickName}<small>#{me.player.nickNumber}</small></b>
                  <span>Lv.{me.player.level}{days > 0 && <> · {t("박사 경력")} D+{fmt(days)}</>}</span>
                  <span className="dim">{joined && <>{t("{date} 입사", { date: joined })} · </>}UID {me.player.uid}</span>
                </div>
                <i className="me-share-brand">TERRA ARCHIVE</i>
              </div>

              <div className="me-share-body">
                <div className="me-share-l">
                  <div className="me-share-hero">
                    <div><span>{t("보유 오퍼")}</span><b>{fmt(owned.length)}<small>/{fmt(released.length)}</small></b><em>{Math.round((owned.length / Math.max(1, released.length)) * 100)}%</em></div>
                    <div><span>{t("6성 보유")}</span><b>{fmt(sixOwned)}<small>/{fmt(six)}</small></b><em>{Math.round((sixOwned / Math.max(1, six)) * 100)}%</em></div>
                  </div>

                  <div className="me-share-grid">
                    {stats.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
                  </div>

                  {wallet && (
                    <section>
                      <h4>{t("재화")}</h4>
                      <ul className="me-share-wallet">
                        {wallet.map(({ id, it, n }) => (
                          <li key={id}>
                            {it?.i ? <img src={corsItem(it.i)} crossOrigin="anonymous" alt="" width={40} height={40} /> : <i />}
                            <div><b>{fmt(n)}</b><span>{it?.n ?? id}</span></div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {assist.length > 0 && (
                    <section className="me-share-assist">
                      <h4>{t("내 지원 유닛")}</h4>
                      <div>
                        {assist.map(({ a, c, op }, i) => {
                          const m = a.skillIndex >= 0 ? c!.mastery[a.skillIndex] ?? 0 : 0;
                          return (
                            <figure key={`${a.id}-${i}`}>
                              <img src={corsAvatar(a.id)} crossOrigin="anonymous" alt="" width={88} height={88} />
                              <figcaption><b>{op!.name}</b><span>{eliteText(locale, c!.elite, c!.level)} · {potText(locale, c!.potential)}{m ? ` · ${t("{n}스킬", { n: a.skillIndex + 1 })} ${masteryText(locale, m)}` : ""}</span></figcaption>
                            </figure>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </div>

                <div className="me-share-r">
                  <section>
                    <h4>{t("성급별 보유")}</h4>
                    {rarityRows.map((x) => (
                      <div key={x.r} className="me-share-bar-row">
                        <span className={`r${x.r}`}>{"★".repeat(x.r)}</span>
                        <i><i style={{ width: `${(x.n / Math.max(1, x.all)) * 100}%` }} /></i>
                        <b>{fmt(x.n)}<small>/{fmt(x.all)}</small></b>
                      </div>
                    ))}
                  </section>
                  <section>
                    <h4>{t("진행 상황")}</h4>
                    {progress ? (
                      <dl className="me-share-prog">
                        <div><dt>{t("메인 스토리 진행")}</dt><dd>{progress.next ? `${progress.next.code} ${progress.next.name}` : t("모두 클리어")}</dd></div>
                        <div><dt>{t("미클리어 작전")}</dt><dd>{fmt(progress.left)}</dd></div>
                        <div><dt>{t("3성 미달성")}</dt><dd>{fmt(progress.star)}</dd></div>
                        <div><dt>{t("섬멸 작전 400 달성")}</dt><dd>{fmt(progress.campDone)} / {fmt(progress.camps)}</dd></div>
                      </dl>
                    ) : <p className="dim">—</p>}
                  </section>
                </div>

              </div>

              <footer className="me-share-foot">
                {verifyUrl ? (
                  <div className="me-share-seal">
                    <QrSvg text={verifyUrl} size={76} />
                    <div>
                      <b>{t("정품 인증")} · {sealCode}</b>
                      <span>{t("QR을 찍으면 terra-archive.net에서 동기화 원본 숫자를 확인할 수 있습니다")}</span>
                    </div>
                  </div>
                ) : <span>terra-archive.net</span>}
                <span>{t("동기화")} {new Date(me.syncedAt).toLocaleString(DT_LOCALE[locale], { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
              </footer>
            </div>
          </div>
        </div>
      </div>
    </ModalWindow>
  );
}
