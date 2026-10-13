// 마지막 인식이 OCR 로 읽은 줄 — '화면 모으기'(bridge.ts, 관리자 시험 기능)가 판정 옆에 같이 남긴다 (2026-10-13).
// run.ts 와 bridge.ts 가 서로를 불러오지 않게 따로 둔다
let last: string[] = [];
export function traceOcr(lines: string[]): void { last = lines.slice(0, 400); }
export const lastOcrLines = (): string[] => last;
