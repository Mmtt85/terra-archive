import type { Metadata } from "next";
import Watch from "../watch";

// 훈수방 보는 사람 화면 — 링크(/w/<코드>)로만 들어오는 페이지라 검색에 싣지 않는다 (2026-10-24)
export const metadata: Metadata = {
  title: "게임 화면 같이 보기 | 테라 아카이브",
  description: "PRTS 링크로 공유된 명일방주 화면을 함께 보며 채팅·추천을 보냅니다.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <Watch locale="ko" />;
}
