import type { Metadata } from "next";
import Watch from "../../watch";

// 훈수방 보는 사람 화면 — 링크(/w/<코드>)로만 들어오는 페이지라 검색에 싣지 않는다 (2026-10-24)
export const metadata: Metadata = {
  title: "コーチ部屋 | テラアーカイブ",
  description: "PRTSリンクで共有されたアークナイツの画面を一緒に見てアドバイスします。",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <Watch locale="ja" />;
}
