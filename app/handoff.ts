// 탭 간 1회성 우편함 — 헤더 만능검색(omni.tsx)이 다른 탭의 **내부 상태**(재료 상세 모달,
// 공채 태그 선택)를 지목할 때 쓴다. 탭 컴포넌트는 tab이 바뀔 때 마운트/언마운트되므로
// (home.tsx의 `{tab === "farm" && <FarmGuide/>}`) 마운트 시 읽고, 이미 마운트돼 있으면
// 커스텀 이벤트로 깨운다 — 스샷 레이더의 ta:lens-handoff와 같은 패턴.
//
// URL 해시로 표현되는 목표(오퍼 모달 #op-, 스토리 #story-)는 여기를 거치지 않는다.

const KEY = "ta:omni-handoff";
export const HANDOFF_EVENT = "ta:omni-handoff";

export type Handoff = {
  page: "farm" | "recruit";
  item?: string;      // farm: 재료 id (상세 모달)
  query?: string;     // farm: 검색어
  tags?: string[];    // recruit: 선택할 태그 (KR 정본 이름)
};

export function stashHandoff(h: Handoff): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(h)); } catch { /* ignore */ }
}

/** 내 몫이면 꺼내면서 지운다. 다른 페이지 몫이면 건드리지 않는다(그 탭이 소비). */
export function takeHandoff(page: Handoff["page"]): Handoff | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  let h: Handoff;
  try { h = JSON.parse(raw) as Handoff; } catch { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } return null; }
  if (h.page !== page) return null;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  return h;
}

/** 이미 마운트된 탭에 "우편 왔다"고 알린다 (탭 전환이 없는 경우). */
export function notifyHandoff(): void {
  window.dispatchEvent(new CustomEvent(HANDOFF_EVENT));
}
