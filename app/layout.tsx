import type { Metadata } from "next";
import { headers } from "next/headers";
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

// 프리뷰 배포(*.pages.dev 해시 서브도메인)도 항상 본 사이트를 정본으로 가리킨다
const SITE_URL = "https://terra-archive.pages.dev";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const title = "테라 아카이브 | 명일방주(Arknights) KR 팬사이트";
  const description =
    "명일방주(아크나이츠) 한국 서버 팬사이트 — 오퍼레이터 백과사전, 기반시설(인프라) 자동 편성 플래너, 공개모집(공채) 태그 계산기.";
  return {
    metadataBase: base,
    title,
    description,
    keywords: [
      "명일방주",
      "아크나이츠",
      "Arknights",
      "오퍼레이터",
      "오퍼레이터 도감",
      "인프라",
      "기반시설",
      "기반시설 편성",
      "공개모집",
      "공채 계산기",
      "공개모집 태그",
      "테라 아카이브",
    ],
    alternates: { canonical: `${SITE_URL}/` },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${SITE_URL}/`,
      siteName: "테라 아카이브",
      locale: "ko_KR",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "테라 아카이브" }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "테라 아카이브",
  alternateName: ["Terra Archive", "명일방주 팬사이트"],
  url: `${SITE_URL}/`,
  description:
    "명일방주(Arknights) 한국 서버 팬사이트 — 오퍼레이터 백과사전, 기반시설 편성 플래너, 공개모집 계산기.",
  inLanguage: "ko",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* 첫 페인트 전에 해시를 읽어 초기 탭을 표시 — 서버 HTML은 항상 백과사전이라
            #infra·#recruit로 새로고침 시 백과사전이 잠깐 보이는 플래시를 막는다.
            React 하이드레이션 후 page.tsx의 useLayoutEffect가 data-route를 지운다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var h=location.hash;var r=h==='#infra'?'infra':h==='#recruit'?'recruit':'';if(r)document.documentElement.setAttribute('data-route',r);}catch(e){}`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {children}
        {/* Cloudflare Web Analytics */}
        <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "e173a2e6c1cd466988379d4338063b89"}' />
      </body>
    </html>
  );
}
