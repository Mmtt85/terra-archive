// 검색 정규화 — 소문자로 낮추고 공백을 전부 제거한다.
// 검색어와 후보 문자열 양쪽에 똑같이 적용하면 "론트"로 "론 트레일"이 히트한다.
export const normSearch = (s: string) => s.toLowerCase().replace(/\s+/g, "");
