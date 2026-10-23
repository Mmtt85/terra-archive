"use client";

import { ImageActions } from "./image-actions";
import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { ModalWindow } from "./modal-window";

// ── 파밍 미래시 이미지 — 표를 캔버스에 직접 그려 미리보기·PNG 저장 (사용자 요청 2026-10-18) ──
// DOM 캡처 라이브러리 대신 손으로 그린다: 표 짜임이 단순하고(머리 = 재료, 줄 = 이벤트, 칸 = 작전 칩),
// 화면 테마(라이트·다크)와 상관없이 늘 같은 어두운 판으로 나와야 공유했을 때 보기 좋다.
// 재료 그림은 R2(files.terra-archive.net, CORS *)라 crossOrigin 으로 받아야 캔버스가 오염되지 않는다.
// 보유 수량은 켜고 끌 수 있다(사용자 지시 같은 날) — 끄면 '적게 가진 재료' 세로줄 강조도 같이 뺀다.

export type FfImgCell = { code: string; occ: string; extra: boolean };
export type FfImgData = {
  cols: { id: string; name: string; img: string; own?: number }[];
  rows: { name: string; live: boolean; cells: FfImgCell[][] }[];
  /** 적게 가진 재료 순위 (재료 id → 1·2·3) */
  hot: Map<string, number>;
};

const C = {
  bg: "#121417", panel: "#1a1d21", head: "#20242a", line: "#2b3038", lineSoft: "#23272d",
  ink: "#e8ebef", ink2: "#b4bcc7", muted: "#7f8895", gold: "#d6b25e", live: "#8fcf5a",
  hot: ["#d6b25e2e", "#d6b25e1f", "#d6b25e14"],
};
const S = 2;            // 해상도 배율
const PAD = 24, EV_W = 156, COL_W = 74, HEAD_H = 96, TITLE_H = 70, FOOT_H = 34, CHIP_H = 40;   // 칩 안 위아래 여백 — 20px 은 번호·효율이 붙어 보였다 (사용자 지적 2026-10-18)

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => res(null);
    // 화면에 이미 뜬 같은 그림은 CORS 없이 캐시돼 있어 crossOrigin 으로 다시 받으면 막힌다 — 꼬리를 붙여 따로 받는다
    im.src = src.startsWith("http") ? `${src}${src.includes("?") ? "&" : "?"}cors=1` : src;
  });
}

/** 단어(띄어쓰기) 단위로 줄을 나눈다 — '고리탄화수소 응/집질' 이 아니라 '고리탄화수소/응집질' (사용자 지시 2026-10-18).
 *  한 단어가 칸보다 길 때만(일본어처럼 띄어쓰기가 없을 때) 글자 단위로 자른다. 최대 줄 수를 넘으면 마지막 줄 끝을 … 로 */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  const fits = (x: string) => ctx.measureText(x).width <= width;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (fits(next)) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = "";
    if (fits(word)) { cur = word; continue; }
    for (const ch of word) {
      if (!fits(cur + ch) && cur) { out.push(cur); cur = ch; }
      else cur += ch;
    }
  }
  if (cur) out.push(cur);
  if (out.length > max) {
    const keep = out.slice(0, max);
    let last = keep[max - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    keep[max - 1] = `${last}…`;
    return keep;
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function drawFutureFarm(data: FfImgData, opts: { own: boolean; title: string; note: string; evLabel: string; liveLabel: string; ownLabel: string; stamp: string; font: string }): Promise<HTMLCanvasElement> {
  const imgs = await Promise.all(data.cols.map((c) => loadImg(c.img)));
  const font = (w: number, px: number) => `${w} ${px}px ${opts.font}`;
  const probe = document.createElement("canvas").getContext("2d")!;
  // 줄 높이 — 칸 안 작전 칩 수 · 이벤트 이름 줄 수 중 큰 쪽
  probe.font = font(600, 12);
  const rowH = data.rows.map((r) => {
    const chips = Math.max(1, ...r.cells.map((c) => c.length));
    const nameLines = wrap(probe, r.name, EV_W - 20, 3).length + (r.live ? 1 : 0);
    // 위아래 여백을 넉넉히 — 칸이 꽉 차 보였다 (사용자 지적 2026-10-18)
    return Math.max(64, chips * (CHIP_H + 4) + 24, nameLines * 16 + 32);
  });
  const tableW = EV_W + data.cols.length * COL_W;
  const W = PAD * 2 + tableW;
  const H = TITLE_H + HEAD_H + rowH.reduce((a, b) => a + b, 0) + FOOT_H + PAD;

  const cv = document.createElement("canvas");
  cv.width = W * S;
  cv.height = H * S;
  const ctx = cv.getContext("2d")!;
  ctx.scale(S, S);
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // 제목·안내
  ctx.fillStyle = C.ink;
  ctx.font = font(700, 20);
  ctx.textAlign = "left";
  ctx.fillText(opts.title, PAD, 30);
  ctx.fillStyle = C.muted;
  ctx.font = font(400, 11);
  ctx.fillText(opts.note, PAD, 54);

  const x0 = PAD, y0 = TITLE_H;
  const tableH = HEAD_H + rowH.reduce((a, b) => a + b, 0);
  // 판
  ctx.fillStyle = C.panel;
  roundRect(ctx, x0, y0, tableW, tableH, 8);
  ctx.fill();
  ctx.save();
  roundRect(ctx, x0, y0, tableW, tableH, 8);
  ctx.clip();
  // 적게 가진 재료 세로줄
  if (opts.own) {
    data.cols.forEach((c, i) => {
      const rank = data.hot.get(c.id);
      if (!rank) return;
      ctx.fillStyle = C.hot[rank - 1];
      ctx.fillRect(x0 + EV_W + i * COL_W, y0, COL_W, tableH);
    });
  }
  // 머리
  ctx.fillStyle = C.head;
  ctx.fillRect(x0, y0, tableW, HEAD_H);
  ctx.restore();

  ctx.textAlign = "center";
  data.cols.forEach((c, i) => {
    const cx = x0 + EV_W + i * COL_W + COL_W / 2;
    // 보유 수량을 끄면 아이콘·이름이 위로 쏠렸다 — 머리 높이 안에서 세로 가운데로 (사용자 지적 2026-10-18)
    let top = y0 + (opts.own ? 8 : 14);
    if (opts.own) {
      ctx.fillStyle = data.hot.has(c.id) ? C.gold : C.muted;
      ctx.font = font(600, 9);
      ctx.fillText(`${opts.ownLabel} ${(c.own ?? 0).toLocaleString("en-US")}`, cx, top + 5);
      top += 12;
    }
    const im = imgs[i];
    if (im) ctx.drawImage(im, cx - 18, top, 36, 36);
    ctx.fillStyle = C.ink;
    ctx.font = font(600, 10);
    wrap(ctx, c.name, COL_W - 8, 2).forEach((l, k) => ctx.fillText(l, cx, top + 46 + k * 12));
  });
  ctx.textAlign = "left";
  ctx.font = font(700, 11);
  ctx.fillStyle = C.muted;
  ctx.fillText(opts.evLabel, x0 + 12, y0 + HEAD_H / 2);

  // 줄
  let y = y0 + HEAD_H;
  data.rows.forEach((r, ri) => {
    const h = rowH[ri];
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y + 0.5);
    ctx.lineTo(x0 + tableW, y + 0.5);
    ctx.stroke();
    // 이벤트 이름
    ctx.font = font(600, 12);
    const lines = wrap(ctx, r.name, EV_W - 20, 3);
    const blockH = lines.length * 16 + (r.live ? 18 : 0);
    let ty = y + (h - blockH) / 2 + 8;
    ctx.fillStyle = C.ink;
    ctx.textAlign = "left";
    lines.forEach((l) => { ctx.fillText(l, x0 + 12, ty); ty += 16; });
    if (r.live) {
      ctx.font = font(700, 10);
      const tw = ctx.measureText(opts.liveLabel).width + 10;
      ctx.strokeStyle = C.live;
      roundRect(ctx, x0 + 12, ty - 6, tw, 15, 3);
      ctx.stroke();
      ctx.fillStyle = C.live;
      ctx.fillText(opts.liveLabel, x0 + 17, ty + 1.5);
    }
    // 칸
    r.cells.forEach((cells, ci) => {
      const cx = x0 + EV_W + ci * COL_W;
      const startY = y + (h - cells.length * (CHIP_H + 4) + 4) / 2;
      cells.forEach((c, k) => {
        const cy = startY + k * (CHIP_H + 4);
        ctx.globalAlpha = c.extra ? 0.5 : 1;
        ctx.fillStyle = "#2a2f36";
        roundRect(ctx, cx + 5, cy, COL_W - 10, CHIP_H, 4);
        ctx.fill();
        ctx.fillStyle = C.ink;
        ctx.font = font(700, 12);   // 작전 번호 2px 키움 (사용자 지시 2026-10-18)
        ctx.textAlign = "center";
        ctx.fillText(c.code, cx + COL_W / 2, cy + CHIP_H / 2 - (c.occ ? 7 : 0));
        if (c.occ) {
          ctx.fillStyle = C.gold;
          ctx.font = font(500, 9);
          ctx.fillText(c.occ, cx + COL_W / 2, cy + CHIP_H / 2 + 8);
        }
        ctx.globalAlpha = 1;
      });
    });
    y += h;
  });
  // 재료 칸 사이 흐릿한 세로 점선 (사용자 지시 2026-10-18 "세로 흐릿한 점선으로 칸별 구분")
  ctx.save();
  ctx.strokeStyle = "#3a404a";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  for (let i = 1; i < data.cols.length; i += 1) {
    const lx = x0 + EV_W + i * COL_W + 0.5;
    ctx.beginPath();
    ctx.moveTo(lx, y0 + 8);
    ctx.lineTo(lx, y0 + tableH - 8);
    ctx.stroke();
  }
  ctx.restore();
  // 세로 구분선 (이벤트 칸 오른쪽)
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(x0 + EV_W + 0.5, y0);
  ctx.lineTo(x0 + EV_W + 0.5, y0 + tableH);
  ctx.stroke();

  // 바닥줄
  ctx.textAlign = "left";
  ctx.fillStyle = C.muted;
  ctx.font = font(500, 11);
  ctx.fillText(opts.stamp, PAD, y0 + tableH + 20);
  ctx.textAlign = "right";
  ctx.fillStyle = C.gold;
  ctx.font = font(700, 11);
  ctx.fillText("terra-archive.net", W - PAD, y0 + tableH + 20);
  return cv;
}

/** 미리보기 창 — 보유 수량 켜기/끄기 · PNG 저장 */
export function FutureFarmImageModal({ data, hasOwn, onClose }: { data: FfImgData; hasOwn: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [own, setOwn] = useState(false);   // 기본은 끈 상태 — 공유용이라 (사용자 지시 2026-10-18)
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  // 창은 늘 이미지 크기에 맞춘다 (사용자 지시 2026-10-18) — 캔버스는 2배로 그렸으니 보이는 폭은 절반, 화면보다 크면 줄여 보인다
  const [dim, setDim] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setUrl(null);
    setBlob(null);
    setErr(false);
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    void drawFutureFarm(data, {
      own: own && hasOwn,
      title: t("파밍 미래시"),
      note: t("진행 중 이벤트와 중국 서버에 먼저 열린 이벤트의 작전에서 나오는 T3 이상 재료 · 연한 칸은 추가 드랍"),
      evLabel: t("이벤트"),
      liveLabel: t("진행중"),
      ownLabel: t("보유"),
      stamp: ymd,
      font: getComputedStyle(document.body).fontFamily || "sans-serif",
    }).then((cv) => new Promise<Blob | null>((res) => cv.toBlob(res, "image/png")))
      .then((blob) => {
        if (!alive) return;
        if (!blob) { setErr(true); return; }
        setBlob(blob);
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [data, own, hasOwn, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  // 저장·복사 — 공용 단추가 WebP / PNG 를 고르게 한다 (app/image-actions.tsx, 2026-10-23)
  const fileName = (() => { const d = new Date(); return `terra-archive-farm-future-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; })();
  return (
    <ModalWindow label={t("파밍 미래시 이미지")} className="ff-img-modal" onClose={onClose}>
      <div className="ff-img-tools">
        {hasOwn && (
          <label className="ff-img-own">
            <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
            {t("내 보유 수량 표시")}
          </label>
        )}
        <ImageActions blob={blob} name={fileName} buttonClassName="act-btn farm-future-btn" copyLabel={t("복사하기")} saveLabel={t("다운로드")} />
      </div>
      <div className="ff-img-view">
        {err ? <p className="recruit-empty">{t("이미지를 만들지 못했습니다.")}</p>
          : url ? <img src={url} alt={t("파밍 미래시")} style={{ width: dim ? dim / 2 : undefined }}
            onLoad={(e) => setDim(e.currentTarget.naturalWidth)} />
            : <p className="recruit-empty">{t("이미지를 만드는 중…")}</p>}
      </div>
    </ModalWindow>
  );
}
