import type { Metadata } from "next";
import Watch from "../../watch";

// 훈수방 보는 사람 화면 — 링크(/w/<코드>)로만 들어오는 페이지라 검색에 싣지 않는다 (2026-10-24)
export const metadata: Metadata = {
  title: "Watch Game Together | Terra Archive",
  description: "Watch an Arknights screen shared through PRTS Link together and send chat and votes.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <Watch locale="en" />;
}
