// 관리자 사이트 단독 진입점 (2026-10-11) — 본사이트 빌드(vinext, 프리렌더 8,600장)와 떼어 이 한 장만 Vite 로 빌드한다
// (사용자 지시 "관리자 사이트만 따로 빼자. 빌드도 따로"). 화면 코드는 그대로 app/admin/page.tsx 를 쓴다 —
// 본사이트 /admin 경로는 deploy.sh 가 원래 지우므로(옛 주소는 301) 겹치지 않는다. 빌드: vite.admin.config.ts
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import AdminPage from "../app/admin/page";

createRoot(document.getElementById("root")!).render(<AdminPage />);
