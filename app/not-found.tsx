"use client";

// 404 — 없는 주소 (2026-10-06). 종전엔 프레임워크 기본값이라 'Not Found' 글자 하나뿐이었다.
// 빌드가 이걸 dist/client/404.html 로 굽고, Cloudflare Pages 가 맞는 파일이 없는 모든 주소에 404 상태로 낸다.
// /en·/ja 아래의 없는 주소도 같은 파일이 나가므로, 주소 앞부분을 보고 언어를 바꾼다(프리렌더는 한국어).

import { useEffect, useState } from "react";
import { I18nProvider, LOCALES, useI18n, type Locale } from "./i18n";

function NotFoundBody() {
  const { locale, t } = useI18n();
  const home = LOCALES.find((l) => l.code === locale)?.path ?? "/";
  return (
    <main className="nf">
      <title>{`${t("페이지를 찾을 수 없습니다")} | ${t("테라 아카이브")}`}</title>
      <meta name="robots" content="noindex" />
      <p className="nf-code">404</p>
      <h1>{t("페이지를 찾을 수 없습니다")}</h1>
      <p className="nf-lead">{t("주소가 바뀌었거나 없어진 페이지입니다. 주소를 다시 확인하거나 홈에서 찾아 주세요.")}</p>
      <a className="nf-home" href={home}>{t("홈으로")}</a>
    </main>
  );
}

export default function NotFound() {
  const [locale, setLocale] = useState<Locale>("ko");
  useEffect(() => {
    const seg = window.location.pathname.split("/")[1];
    if (seg === "en" || seg === "ja") {
      setLocale(seg);
      document.documentElement.lang = seg;
    }
  }, []);
  return (
    <I18nProvider locale={locale}>
      <NotFoundBody />
    </I18nProvider>
  );
}
