// 구조화 데이터(JSON-LD) 출력의 단일 창구.
//
// 왜 컴포넌트로 뽑았나 (2026-08-26): 60개 라우트가 저마다
//   <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(x) }} />
// 를 손으로 적고 있었다. JSON.stringify 는 `<` 를 이스케이프하지 않는데, 우리 설명문에는
// 클뜯 게임 텍스트가 그대로 들어간다 — 실측으로 `<대역>` `<지원 장치>` `<身替り>` 같은
// 꺾쇠가 **451회** 박혀 있었다(빌드 전수 검사, 2026-08-26).
//
// 지금 당장 깨지는 건 없다. <script> 안에서는 `</script` 만이 블록을 끝내기 때문이다.
// 하지만 게임 텍스트에 그 조합이 한 번이라도 들어오면 스크립트가 거기서 끊기고 **그 뒤
// 페이지 HTML 전체가 깨진다** — 데이터가 바꾸는 것이라 코드 리뷰로는 절대 안 잡힌다.
// 그래서 `<` 를 통째로 < 로 바꾼다. JSON 문자열 안에서 의미가 같고(파서가 되돌린다),
// `</script` 와 `<!--`(script data escaped state 진입) 두 부류를 한 번에 막는다.
//
// `&` 는 건드리지 않는다 — <script> 는 raw text 요소라 엔티티 해석이 없다.

/** 구조화 데이터 객체를 <script> 안에 넣어도 안전한 문자열로 만든다 */
export function ldText(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** 페이지의 JSON-LD 한 블록. 검증은 빌드의 scripts/check-jsonld.mjs 가 전수로 한다. */
export default function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldText(data) }} />;
}
