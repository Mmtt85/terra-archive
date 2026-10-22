// 사이트 전체 숫자 굴리기 (사용자 지시 2026-10-22 "클릭해서 수치가 바뀌는 부분은 쫘라라락 — 사이트 내 모든 부분").
// 화면마다 손대지 않고 공용으로 한 번 건다: React 가 이미 있는 글자 노드의 값을 바꾸는 순간(characterData 변경)을 지켜보다가,
// 바뀌기 전과 뒤가 둘 다 '앞뒤 글자가 같은 숫자'(예: "+127%" → "+226%", "≈51,820" → "≈54,197", "34개" → "41개")면
// 이전 값에서 새 값까지 짧게 굴린다. 마지막엔 React 가 쓴 글자 그대로 끝나므로 화면 값은 바뀌지 않는다.
//  · 새로 그려지는 글자(처음 나타나는 숫자)는 건드리지 않는다 — 바뀌는 순간만
//  · 입력칸·편집 칸·data-no-tween 안은 건드리지 않는다 · 시각(10:18)처럼 숫자가 둘 이상인 글자는 건드리지 않는다
//  · 움직임 줄이기(prefers-reduced-motion)를 켠 사람에겐 끈다
const DUR = 520;
// 앞 글자 · 부호 · 숫자(쉼표·소수점) · 뒤 글자 — 앞뒤 글자엔 숫자가 없어야 한다
const RE = /^(\D*?)([+\-−]?)(\d[\d,]*(?:\.\d+)?)(\D*)$/;
type Parsed = { pre: string; sign: string; n: number; dec: number; comma: boolean; post: string };
function parse(s: string | null): Parsed | null {
  if (!s || s.length > 32) return null;
  const m = RE.exec(s.trim() === s ? s : s);
  if (!m) return null;
  const raw = m[3];
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const neg = m[2] === "-" || m[2] === "−";
  return { pre: m[1], sign: m[2], n: neg ? -n : n, dec: raw.includes(".") ? raw.split(".")[1].length : 0, comma: raw.includes(","), post: m[4] };
}
function format(v: number, to: Parsed): string {
  const abs = Math.abs(v);
  const body = to.comma
    ? abs.toLocaleString("en-US", { minimumFractionDigits: to.dec, maximumFractionDigits: to.dec })
    : abs.toFixed(to.dec);
  // 부호는 새 값의 표기를 따른다('+' 를 늘 붙이는 칸이면 굴리는 동안에도 '+')
  const sign = v < 0 ? (to.sign === "−" ? "−" : "-") : to.sign === "+" ? "+" : "";
  return `${to.pre}${sign}${body}${to.post}`;
}

let started = false;
export function startNumberTween(): void {
  if (started || typeof window === "undefined" || typeof MutationObserver === "undefined") return;
  started = true;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const running = new Map<Text, { raf: number; mine: string }>();
  // 우리가 마지막으로 쓴 값 — 우리 쓰기도 변경으로 잡히므로 그건 넘긴다(끝난 뒤의 마지막 쓰기까지)
  const wrote = new WeakMap<Text, string>();
  const skip = (node: Text) => {
    const el = node.parentElement;
    return !el || !!el.closest("input, textarea, [contenteditable=''], [contenteditable='true'], [data-no-tween], script, style");
  };
  const mo = new MutationObserver((records) => {
    if (reduce?.matches) return;
    for (const r of records) {
      if (r.type !== "characterData") continue;
      const node = r.target as Text;
      const now = node.nodeValue;
      const run = running.get(node);
      if (now === wrote.get(node)) continue;          // 우리가 쓴 값
      const from = parse(run ? run.mine : r.oldValue);   // 굴리던 중에 또 바뀌면 지금 보이는 값에서 이어서
      const to = parse(now);
      if (run) { cancelAnimationFrame(run.raf); running.delete(node); }
      if (!from || !to || from.n === to.n || from.pre !== to.pre || from.post !== to.post || skip(node)) continue;
      const target = now!;
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / DUR);
        const e = 1 - Math.pow(1 - k, 3);   // 처음 빠르게, 끝에서 천천히
        const text = k >= 1 ? target : format(from.n + (to.n - from.n) * e, to);
        const entry = running.get(node);
        if (!entry || !node.isConnected) { running.delete(node); return; }
        entry.mine = text;
        wrote.set(node, text);
        node.nodeValue = text;
        if (k >= 1) { running.delete(node); return; }
        entry.raf = requestAnimationFrame(step);
      };
      const entry = { raf: 0, mine: format(from.n, to) };
      running.set(node, entry);
      wrote.set(node, entry.mine);
      node.nodeValue = entry.mine;   // 바로 이전 값에서 출발
      entry.raf = requestAnimationFrame(step);
    }
  });
  mo.observe(document.body, { characterData: true, characterDataOldValue: true, subtree: true });
}
