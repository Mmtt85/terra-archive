// 재능 설명 줄바꿈 (2026-09-04 사용자 요청) — 게임 원문은 효과 여러 개를 쉼표로 이어
// **한 덩어리**로 준다(한국어 평균 53자, 영어 105자). 2열 카드에 그대로 넣으면 벽처럼
// 보이므로 효과 단위로 끊어 준다. **표시용일 뿐 데이터는 손대지 않는다** — 원문이
// 그대로 있어야 검색·번역 대조가 된다.
//
// 언어를 가리지 않아야 해서 라벨을 찾지 않고 **문장부호만** 본다:
//   ① 문장 끝(。！？ / ". ") → 항상 끊는다
//   ② 세미콜론(; ；) → 항상 (영어 원문이 효과를 나누는 방식)
//   ③ 쉼표(, ， 、) → **한중일 글자가 있고 길 때만**
// ⚠ ③에 한중일 조건이 붙는 이유: 영어 쉼표는 효과 구분이 아니라 문법이다
//   ("reduces its ATK, DEF, and RES by 20%"를 끊으면 뜻이 깨진다). 한국어·일본어는
//   서술어가 절 끝에 오므로 쉼표마다 끊어도 각 줄이 홀로 읽힌다.
// ⚠ 괄호 안은 절대 끊지 않는다 — 뮤엘시스 "속성(최대 HP, 공격력, …)" 이 조각난다.

const OPEN = "([{（［｛〈《【「『";
const CLOSE = ")]}）］｝〉》】」』";
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
const TRAILING = /[,，、;；]$/;

/** 한중일 글자는 두 칸으로 세는 표시 폭 — 줄 길이 판단은 글자 수가 아니라 이걸로 한다. */
function width(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
  return n;
}

/** 괄호 밖에 있는 `marks` 뒤에서 끊는다. `needSpace`면 뒤가 공백/끝일 때만 (영문
 *  마침표를 소수점·약어와 구별하려고 — "1.5초"가 갈라지면 안 된다). */
function cut(s: string, marks: string, needSpace = false): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (OPEN.includes(ch)) depth += 1;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    buf += ch;
    const next = i + 1 < s.length ? s[i + 1] : "";
    if (depth === 0 && marks.includes(ch) && (!needSpace || next === "" || next === " ")) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** 토막(짧은 조각)은 이웃에 도로 붙인다. 구분자를 살려서 붙여야 "ATK, DEF, and RES"가
 *  "ATK DEF and RES"로 뭉개지지 않는다 — 최종 출력에서만 꼬리 쉼표를 떼는 이유. */
function tidy(parts: string[], minWidth = 18): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (out.length && (width(part.trim()) < minWidth || width(out[out.length - 1].trim()) < minWidth)) {
      out[out.length - 1] += part;
    } else {
      out.push(part);
    }
  }
  return out;
}

/** 재능·소환물 재능 설명을 읽기 좋은 줄로 나눈다. 나눌 데가 없으면 원문 한 줄 그대로. */
export function descLines(text: string, wrap = 72): string[] {
  if (!text) return [];
  let parts = tidy(cut(text, "。！？"));
  parts = parts.flatMap((p) => tidy(cut(p, ".!?", true)));
  parts = parts.flatMap((p) => tidy(cut(p, ";；")));
  parts = parts.flatMap((p) => (width(p.trim()) >= wrap && CJK.test(p) ? tidy(cut(p, ",，、")) : [p]));
  return parts.map((p) => p.trim().replace(TRAILING, "")).filter(Boolean);
}
