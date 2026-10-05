// 지금 한섭에서 들어갈 수 있는 작전인가 — 내 정보 '진행 상황'이 미클리어·3성 미달성 목록에서 못 들어가는 작전을 뺀다
// (사용자 지시 2026-10-04). 기준표는 scripts/build-stage-open.py 산출물(app/data/stage-open.json):
//   메인 스토리·막간 = 늘 열림 · 이벤트 = 상설 사이드 스토리이거나 지금 기간 중인 이벤트 · 섬멸 = 상설이거나 현재 순환 회차.
import open from "./data/stage-open.json";

type OpenDoc = { retro: string[]; events: [string, string, string[]][]; camp: { permanent: string[]; rotate: [string, number][] } };
const doc = open as unknown as OpenDoc;
const retro = new Set(doc.retro);
const permanentCamp = new Set(doc.camp.permanent);

/** KST 날짜 (YYYY-MM-DD) — events.json 의 시작·끝 날짜와 같은 기준 */
const kstDay = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

export function openChecker(nowMs: number): (stage: { id: string; t: string }) => boolean {
  const today = kstDay(nowMs);
  const running = new Set(doc.events.filter(([s, e]) => s <= today && today <= e).flatMap(([, , ids]) => ids));
  const nowSec = nowMs / 1000;
  const rot = doc.camp.rotate.filter(([, ts]) => ts <= nowSec).sort((a, b) => b[1] - a[1])[0]?.[0];
  return (s) => {
    if (s.t === "MAIN" || s.t === "SUB") return true;
    if (s.t === "ACTIVITY") return retro.has(s.id) || running.has(s.id);
    if (s.t === "CAMPAIGN") return permanentCamp.has(s.id) || s.id === rot;
    return true;
  };
}
