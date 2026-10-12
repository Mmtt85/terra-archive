// 이미지 내보내기(modern-screenshot)에 넣을 글꼴 — 내 정보 공유 카드·가챠 결과·관리자 리포트가 같이 쓴다 (2026-10-12 me-share.tsx 에서 옮김)
/** 카드에 실제로 쓰인 글자가 든 @font-face 만 — 한글 서체가 유니코드 범위별 조각 수십 개라 전부 넣으면 수십 초가 걸린다 */
export function usedFontCss(el: HTMLElement): string {
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
