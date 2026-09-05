import type { Metadata, Viewport } from "next";
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
// ⚠ viewportFit: "cover" 가 없으면 iOS 에서 env(safe-area-inset-*) 이 **항상 0** 이다
// (2026-08-25 실측: 사파리에서 하단 시트가 홈 인디케이터·툴바 밑으로 내려가 잘렸다).
// 노치·홈 인디케이터 영역까지 레이아웃을 넓히고, 가려지면 안 되는 것만 CSS 에서 inset 만큼
// 띄운다 (globals.css 의 모바일 푸터 시트).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

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
  // lang은 서버 렌더에선 ko 고정이지만, 빌드 후처리(scripts/fix-html-lang.mjs)가
  // /en·/ja 정적 HTML의 lang을 실제 로케일로 교정한다 (2026-07 — 원문 HTML의 lang="ko"가
  // EN/JA 페이지에 한국어 문서라는 모순 신호를 줘서 색인·언어 타게팅을 해쳤다).
  // 하이드레이션 직후엔 Home이 document.documentElement.lang을 다시 로케일로 맞춘다.
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
        {/* 죽은 청크 자동 복구 (사용자 요청 2026-07-25) — 열어 둔 탭이 물고 있는
            /assets/index-<해시>.js 는 재빌드·재배포가 일어나면 사라져서, 지연 로딩(lazy import)이
            "Failed to fetch dynamically imported module"로 터진다. 개발 중 npm run build를 돌릴
            때마다, 그리고 실사용자가 배포 직후 오래된 탭에서 이동할 때 똑같이 발생한다.
            Vite의 vite:preloadError + 청크 로드 실패를 잡아 새로고침한다(새 HTML을 받으면 해시가
            갱신돼 복구).

            ⚠ 2026-08-06 개선 — 종전엔 가드가 **10초 고정**이라, 배포 직후 404가 30~60초
            이어지면 그동안 10초마다 새로고침을 반복했다. 사용자에겐 그게 곧 "배포하면
            30초~1분 접속이 안 된다"였다 (제보). 이제 **0 → 3초 → 10초 → 30초 → 1분으로
            물러서며 8회(약 4분 반)까지** 버틴다 — 실제 사고가 3~4분이었기 때문.

            ⚠ 2026-08-06 밤 재수정 (제보 스크린샷 2장) — 두 구멍이 드러났다.
            ① 청크가 404나면 React.lazy가 undefined를 받아 "Cannot read properties of
               undefined (reading 'default')"로 **동기 예외**를 던지며 흰 화면이 된다.
               이건 unhandledrejection도 SCRIPT 로드 실패도 아니라 종전 핸들러가 다 놓쳤다.
               → /assets/ 요청이 한 번이라도 실패했으면(hit 플래그) 뒤이은 렌더 예외도
                 청크 사고로 간주한다. 무관한 앱 버그로 새로고침 루프를 돌지 않도록
                 **플래그가 섰을 때만** 그렇게 본다.
            ② modulepreload는 LINK 태그라 tagName==='SCRIPT' 검사에 안 걸렸다. → LINK 추가.
            재시도를 다 쓰면 흰 화면 대신 안내와 '다시 시도' 버튼을 띄운다.

            ⚠ 2026-08-31 3차 수정 (제보 01dbfebd — /en/rogue/is5, UA:
               "It would be great if site didn't refresh on its own every 5 seconds").
               물러섬(W)이 통째로 무력화되는 구멍이 둘 있었다. 둘 다 결과가 같다 —
               **n이 영원히 0이라 물러섬도 8회 상한도 안내 패널도 없는 무한 새로고침.**
               ① **정상 로드 5초 뒤 카운터를 지우던 줄**. 청크가 로드 5초 '뒤에' 실패하면
                  (느린 회선에서 rogue5.en.json 940KB·rogue-routes.json 1.3MB가 늘어지다
                  죽는 경우 — 제보자가 있던 화면이 정확히 그것) 카운터는 이미 지워진 뒤였다.
                  → 지우지 않는다. 대신 **이 페이지가 Q(60초) 넘게 멀쩡히 살아 있다가
                    터졌을 때만** 새 사고로 보고 n을 0으로 되돌린다(페이지당 1회).
                    배포 사고는 몇 초 간격으로 연달아 터지므로 물러섬이 그대로 살고,
                    한참 뒤의 별개 사고(재빌드 등)는 종전처럼 즉시 복구된다.
                  ⚠ 기준을 '마지막 새로고침에서 Q 경과'로 잡으면 안 된다 — W의 60초를
                    기다리는 것 자체가 그 조건을 만족시켜 n이 되감긴다.
               ② sessionStorage가 막힌 브라우저(프라이버시 설정·차단 확장)에선 카운터가
                  아예 저장되지 않아 역시 항상 n=0이었다.
                  → 저장이 실패하면 window.name으로 물러선다(같은 탭의 새로고침을 넘어
                    살아남는다). 우리 접두사가 붙었거나 비어 있을 때만 건드린다.
               ③ 세션 절대 상한 CAP회 — 어떤 경로로도 그 이상은 자동 새로고침하지 않는다.
                  무한히 도는 가드는 가드가 없느니만 못하다.
               ④ 안내 패널이 한국어 고정이라 /en·/ja 방문자는 읽지 못했다(이 제보자가 /en).
                  → 경로 접두사로 3개 언어. 포기한 뒤엔 "곧 다시 불러옵니다"가 거짓말이
                    되므로 문구도 바꾼다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var K='ta-chunk-reload',P='ta-chunk-reload:',W=[0,3000,10000,30000,30000,60000,60000,60000],Q=60000,CAP=20,T0=Date.now(),first=1,hit=0,box=null,timer=0;
function isChunk(m){return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch dynamically/i.test(m);}
function rd(){try{var s=sessionStorage.getItem(K);if(s)return JSON.parse(s);}catch(e){}
try{var w=window.name||'';if(w.slice(0,P.length)===P)return JSON.parse(w.slice(P.length));}catch(e){}
return {};}
function wr(v){var s=JSON.stringify(v);try{sessionStorage.setItem(K,s);return;}catch(e){}
try{var w=window.name||'';if(!w||w.slice(0,P.length)===P)window.name=P+s;}catch(e){}}
function say(fin){var p=location.pathname,l=p==='/en'||p.slice(0,4)==='/en/'?'en':p==='/ja'||p.slice(0,4)==='/ja/'?'ja':'ko';
var T={ko:['새 버전을 배포하는 중이라 일부 파일을 불러오지 못했습니다. 곧 자동으로 다시 불러옵니다. ','일부 파일을 계속 불러오지 못해 자동 새로고침을 멈췄습니다. 잠시 후 다시 시도해 주세요. ','지금 다시 시도'],en:['Some files could not be loaded while a new version is being deployed. Reloading shortly. ','Some files still fail to load, so automatic reloading has stopped. Please try again in a moment. ','Retry now'],ja:['新しいバージョンの配信中のため、一部のファイルを読み込めませんでした。まもなく自動で読み込み直します。 ','一部のファイルを読み込めない状態が続くため、自動再読み込みを停止しました。しばらくしてからお試しください。 ','今すぐ再試行']};
var a=T[l]||T.ko;return [fin?a[1]:a[0],a[2]];}
function panel(fin){var s=say(fin);
if(box){if(fin)box.firstChild.nodeValue=s[0];return;}
var d=document.createElement('div');d.setAttribute('style','position:fixed;inset:auto 0 0 0;margin:0 auto 18px;width:max-content;max-width:92vw;z-index:2147483647;padding:12px 16px;border-radius:12px;background:#171b1d;color:#e7eaeb;font:600 13px/1.5 system-ui,-apple-system,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.45)');d.textContent=s[0];var b=document.createElement('button');b.textContent=s[1];b.setAttribute('style','margin-left:8px;padding:5px 12px;border:0;border-radius:8px;background:#4a9eff;color:#fff;font:600 13px system-ui;cursor:pointer');b.onclick=function(){location.reload();};d.appendChild(b);(document.body||document.documentElement).appendChild(d);box=d;}
function bust(){var v=rd(),n=v.n||0,at=v.at||0,tot=v.t||0;
if(first){first=0;if(Date.now()-T0>Q)n=0;}
if(tot>=CAP||n>=W.length){panel(1);return;}
var wait=W[n]-(Date.now()-at);
if(wait>0){if(n>=2)panel(0);if(!timer)timer=setTimeout(function(){timer=0;bust();},wait+50);return;}
wr({n:n+1,at:Date.now(),t:tot+1});
location.reload();}
window.addEventListener('vite:preloadError',function(e){e.preventDefault();hit=1;bust();});
window.addEventListener('unhandledrejection',function(e){var m=''+((e&&e.reason&&(e.reason.message||e.reason))||'');if(isChunk(m)){hit=1;bust();}});
window.addEventListener('error',function(e){var t=e&&e.target;
if(t&&t!==window&&(t.tagName==='SCRIPT'||t.tagName==='LINK')){var u=t.src||t.href||'';if(u.indexOf('/assets/')>-1){hit=1;bust();}return;}
var m=''+((e&&e.message)||'');if(isChunk(m)||(hit&&/reading '?default'?|of undefined|of null/i.test(m)))bust();},true);})();`,
          }}
        />
        {/* 언어 자동 전환 (사용자 요청 2026-08-16 — 트위터로 유입된 일본 방문자가 한국어
            페이지에 떨어져 바로 이탈): 저장된 언어(ta-locale, 헤더 스위처가 기록)가 있으면
            그 언어로, 없으면 브라우저 언어(ja→/ja, ko→/, 그 외→/en)로 경로를 맞춘다.
            첫 페인트 전 location.replace라 플래시·히스토리 오염 없음. 크롤러(UA)와
            자동화 브라우저(navigator.webdriver — 우리 Playwright 검증·about 캡처 포함)는
            제외해 SEO·스크립트에 영향을 주지 않는다.

            ⚠ 경로에 /en·/ja 가 붙은 URL은 **손대지 않는다** (사용자 지시 2026-09-05).
            경로에 언어가 적혀 있으면 그 자체가 이미 언어 선택이다 — 종전엔 저장된 선호와
            다르면 되돌려 버려서, 한국어 선호 방문자가 https://terra-archive.net/en/autochess
            같은 **영어 링크를 열면 곧장 /autochess(한국어)로 튕겼다.** 공유된 EN/JA 딥링크가
            사실상 동작하지 않던 것. 이제 접두사가 붙은 URL은 그대로 그 언어로 뜨고,
            그 뒤 내부 링크는 전부 localeBase를 달고 다니므로 세션 내내 그 언어를 유지한다.
            대신 저장된 선호(ta-locale)는 **덮어쓰지 않는다** — EN 링크 한 번 눌렀다고
            사이트 언어가 영구히 바뀌면 안 된다. 영구 전환은 헤더·푸터 스위처의 몫.
            (그래서 '한국어로 돌아가기'는 여전히 접두사 없는 경로 + 스위처가 기록하는
            ta-locale 조합으로 동작한다 — home.tsx 푸터 주석 참조.)

            접두사 없는 경로만 판정 대상이고, /admin(dev 전용, ko만 존재)도 함께 제외한다 —
            언어 경로가 없어서 리다이렉트하면 404로 떨어진다 (사용자 지시 2026-08-17). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(!navigator.webdriver&&!/^\\/(en|ja|admin)(\\/|$)/.test(location.pathname)&&!/bot|crawl|spider|slurp|lighthouse|headless|preview/i.test(navigator.userAgent)){var lp=null;try{lp=localStorage.getItem('ta-locale')}catch(e){}if(lp!=='ko'&&lp!=='en'&&lp!=='ja'){var nl=(navigator.language||'').slice(0,2).toLowerCase();lp=nl==='ko'?'ko':nl==='ja'?'ja':'en';}if(lp!=='ko'){var rest=location.pathname==='/'?'':location.pathname;location.replace('/'+lp+rest+location.search+location.hash);}}}catch(e){}`,
          }}
        />
        {/* 첫 페인트 전에 해시를 읽어 초기 탭을 표시 — 서버 HTML은 항상 백과사전이라
            #infra·#recruit로 새로고침 시 백과사전이 잠깐 보이는 플래시를 막는다.
            React 하이드레이션 후 home.tsx의 useLayoutEffect가 data-route를 지운다.

            ⚠ 마지막 data-hashboot은 **범용 장치**다 (2026-08-24). 프리렌더 HTML은 해시를 볼 수
            없어 언제나 그 페이지의 **기본 화면**이 그려져 있다. 그래서 딥링크로 바로 들어오면
            "기본 탭이 잠깐 보였다가 딥링크 탭으로 튀는" 플래시가 난다 — 새 메뉴가 생길 때마다
            되풀이된 버그다. 해시가 있으면 하이드레이션 전까지 [data-hashswap] 영역을 가리고,
            해시를 읽어 상태를 맞춘 화면이 useLayoutEffect에서 이 플래그를 뗀다.
            JS가 아예 안 뜨는 상황에 대비해 4초 뒤 스스로 풀린다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var h=location.hash;var r=h==='#infra'?'infra':h==='#recruit'?'recruit':h==='#farm'?'farm':h.indexOf('#story')===0?'story':'';if(r)document.documentElement.setAttribute('data-route',r);if(/^#story-.+/.test(h))document.documentElement.setAttribute('data-story-detail','1');if(h.length>1&&!/^#(changelog|devnotes|broadcast|replay|prts-help|roster|op-)/.test(h)){var de=document.documentElement;de.setAttribute('data-hashboot','1');setTimeout(function(){de.removeAttribute('data-hashboot')},4000);}}catch(e){}`,
          }}
        />
        {/* 다크모드 — 저장값(ta-theme) 우선, 없으면 OS 설정. 첫 페인트 전에 html.dark를
            부여해 라이트→다크 플래시를 막는다. 토글은 헤더 버튼(home.tsx). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ta-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');}catch(e){}`,
          }}
        />
        {/* 모든 모달 ESC 닫기 (사용자 요청 2026-07-24) — app/esc-close.ts와 동일 로직의 인라인판.
            React 셸(home.tsx)도 같은 바인딩을 하므로 window.__taEsc 가드로 1회만 붙는다
            (인라인이 안 도는 환경 ↔ React가 안 뜨는 환경 상호 보완). 규칙: 겹친 모달은 z-index
            최상단만, .modal-close 클릭 → 없으면 백드롭 자기-타깃 mousedown. 로직 수정 시
            esc-close.ts와 함께 고칠 것. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(!window.__taEsc){window.__taEsc=1;document.addEventListener('keydown',function(e){if((e.key!=='Escape'&&e.key!=='Esc'&&e.keyCode!==27)||e.isComposing)return;var els=document.querySelectorAll('.modal-backdrop:not(.mw-pinned)');if(!els.length)return;var top=null,tz=-1;for(var i=0;i<els.length;i++){var z=parseInt(getComputedStyle(els[i]).zIndex,10)||0;if(z>=tz){tz=z;top=els[i];}}if(!top)return;var btn=top.querySelector('.modal-close');if(btn){btn.click();return;}top.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));});}`,
          }}
        />
        {children}
        {/* Cloudflare Web Analytics — 정본 도메인에서만 + 자동화 브라우저 제외.
            localhost·프리뷰(해시.pages.dev)에 더해 navigator.webdriver(Playwright·Selenium 등
            헤드리스 검증 크롤)도 걸러낸다 — 2026-07-21 스토리 전수 크롤 293건이 실방문으로
            집계된 회귀. 크롤이 pages.dev로 들어와도 리다이렉트 후 .net에서 비콘이 떴었다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(location.hostname==='terra-archive.net'&&!navigator.webdriver){var s=document.createElement('script');s.defer=true;s.src='https://static.cloudflareinsights.com/beacon.min.js';s.setAttribute('data-cf-beacon','{"token":"e173a2e6c1cd466988379d4338063b89","spa":false}');document.body.appendChild(s);}`,
          }}
        />
      </body>
    </html>
  );
}
