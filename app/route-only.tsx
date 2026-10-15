"use client";

// 서버 안내 칸(app/page-seo/*)을 그 주소에 있을 때만 — 같은 화면 안에서 주소만 바꿔 다른 테마·탭으로 넘어가면 앞 안내가 남지 않게 (2026-10-15).
// 화면은 pushState 로 주소를 바꾸고 그 알림이 없어서 가볍게 들여다본다(0.7초). 서버·첫 그림은 그 주소라고 보고 그린다 — 서버 HTML 에 들어가야 하므로
import { useSyncExternalStore, type ReactNode } from "react";

const norm = (p: string) => p.replace(/\/+$/, "") || "/";
const subscribe = (cb: () => void) => {
  const id = window.setInterval(cb, 700);
  window.addEventListener("popstate", cb);
  return () => { window.clearInterval(id); window.removeEventListener("popstate", cb); };
};

export default function RouteOnly({ path, children }: { path: string; children: ReactNode }) {
  const here = useSyncExternalStore(subscribe, () => norm(window.location.pathname), () => norm(path));
  return here === norm(path) ? <>{children}</> : null;
}
