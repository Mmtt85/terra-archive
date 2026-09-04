"use client";

// 위수 협의 시즌 고르기 (사용자 요청 2026-09-05 "예전 맹약 어땠는지 궁금해하는 사람들도 많더라",
// 같은 날 "시즌1이랑 2는 메뉴에다가 서브메뉴로 넣어줘").
//
// ⚠ 시즌 고르기는 **메뉴 부메뉴에만** 있다 (통합전략 테마·생존연산 시즌과 같은 자리).
//   화면 안 전환 버튼은 사용자 지시로 걷어냈다 — 다시 넣지 말 것. 여기는 home.tsx 가 준
//   시즌 번호로 문서만 고르는 자리다.
//
// ⚠ 시즌 데이터는 **정적 임포트**다 (지연 로드 아님). /autochess/s1 은 프리렌더된 정적
//   페이지라, 지연 로드로 두면 그 HTML에 시즌2 내용이 박혀 색인된다. 이 청크 자체가
//   위수 협의 탭을 열 때만 받아지므로 첫 화면 번들에는 영향이 없다.
//
// ⚠ 시즌이 바뀌면 `key` 로 가이드를 **통째로 새로 마운트**한다. 편성 판·필터·열린 모달이
//   전부 그 시즌의 기물·맹약 id 를 들고 있어서, 상태를 이어 주면 시즌1 화면에 시즌2 기물이
//   남는다. 시즌1↔2 는 같은 id 인데 수치가 갈아엎어져 있어(밴드 29/29 · 맹약 18/18 ·
//   기물 195/200 실측) 섞이면 틀린 수치가 그대로 보인다.
import AutochessGuide, { type AutochessDoc } from "./autochess";
import seasonList from "./data/autochess-seasons.json";

const LATEST = Math.max(...(seasonList as { n: number }[]).map((x) => x.n), 1);

export default function AutochessSeasons({ docs, season, onShowOperator }: {
  /** 시즌 번호 → 그 시즌 문서 (래퍼가 자기 언어 것으로 채운다) */
  docs: Record<number, AutochessDoc>;
  /** 지금 보는 시즌 — home.tsx 가 /autochess/s<N> 주소와 함께 들고 있다 */
  season?: number;
  onShowOperator?: (id: string) => void;
}) {
  const doc = docs[season ?? LATEST] ?? docs[LATEST];
  return <AutochessGuide key={doc.season} doc={doc} onShowOperator={onShowOperator} />;
}
