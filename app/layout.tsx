import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 제목·설명·OG·hreflang 등 로케일별 메타데이터는 각 라우트 페이지(app/seo.ts)가 담당하고,
// 레이아웃은 metadataBase 등 공통값만 제공한다. 정적 내보내기(output: "export")라
// 요청 헤더를 읽을 수 없으므로 정본 도메인을 고정한다 (OG·canonical 절대 URL 기준).
export const metadata: Metadata = {
  metadataBase: new URL("https://terra-archive.net"),
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: [{ url: "/favicon-180.png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // lang은 서버에선 ko 고정 — /en·/ja 라우트는 하이드레이션 직후 Home이
  // document.documentElement.lang을 로케일로 바꾼다 (검색엔진 신호는 hreflang이 담당)
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* 정본 도메인 정리 — Cloudflare Pages 기본 도메인(정확히 terra-archive.pages.dev)으로
            들어온 방문자를 terra-archive.net으로 보낸다. 프리뷰 배포(해시.terra-archive.pages.dev)와
            localhost는 정확 일치가 아니라 건드리지 않는다. SEO는 canonical(app/seo.ts)이 담당하고
            이 스크립트는 UX용. 첫 페인트 전에 실행되도록 body 최상단에 둔다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(location.hostname==='terra-archive.pages.dev'){location.replace('https://terra-archive.net'+location.pathname+location.search+location.hash);}`,
          }}
        />
        {/* 첫 페인트 전에 해시를 읽어 초기 탭을 표시 — 서버 HTML은 항상 백과사전이라
            #infra·#recruit로 새로고침 시 백과사전이 잠깐 보이는 플래시를 막는다.
            React 하이드레이션 후 home.tsx의 useLayoutEffect가 data-route를 지운다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var h=location.hash;var r=h==='#infra'?'infra':h==='#recruit'?'recruit':h==='#farm'?'farm':h.indexOf('#story')===0?'story':'';if(r)document.documentElement.setAttribute('data-route',r);if(/^#story-.+/.test(h))document.documentElement.setAttribute('data-story-detail','1');}catch(e){}`,
          }}
        />
        {/* 다크모드 — 저장값(ta-theme) 우선, 없으면 OS 설정. 첫 페인트 전에 html.dark를
            부여해 라이트→다크 플래시를 막는다. 토글은 헤더 버튼(home.tsx). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ta-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');}catch(e){}`,
          }}
        />
        {children}
        {/* Cloudflare Web Analytics — 정본 도메인에서만 집계한다. localhost·프리뷰
            (해시.pages.dev)·헤드리스 테스트에서 beacon이 프로드 토큰으로 조회수를
            부풀리던 문제를 막는다 (2026-07). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(location.hostname==='terra-archive.net'){var s=document.createElement('script');s.defer=true;s.src='https://static.cloudflareinsights.com/beacon.min.js';s.setAttribute('data-cf-beacon','{"token":"e173a2e6c1cd466988379d4338063b89","spa":false}');document.body.appendChild(s);}`,
          }}
        />
      </body>
    </html>
  );
}
